// Smoke test of the editor's engine and model layers in Node, without a browser.
//
// Usage (from the repository root):
//   node editor/test/smoke.mjs <path/to/wasm_exec.js> <path/to/sysml-wasm.wasm>
// Both files come from the npm package @openmbee/opensysml-wasm (same version as editor/src/config.js).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";

import { analyze } from "../src/engine/engine-core.js";
import { buildFromAnalysis } from "../src/workspace/TextModelProvider.js";
import { buildOutline, locate } from "../src/text/sysml-text.js";
import { TextModelEditor, applyEditsToText } from "../src/workspace/TextModelEditor.js";
import { checkConfiguration } from "../src/pleml/ConfigurationChecker.js";
import { SNIPPETS, emptyPackage, featureModelDocument } from "../src/pleml/templates.js";

const [wasmExecPath, wasmPath] = process.argv.slice(2);
if (!wasmExecPath || !wasmPath) {
    console.error("usage: node editor/test/smoke.mjs <wasm_exec.js> <sysml-wasm.wasm>");
    process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = path => readFileSync(resolve(repo, path), "utf8");

createRequire(import.meta.url)(resolve(wasmExecPath));
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), go.importObject);
go.run(instance);
while (!globalThis.sysmlWasm) await new Promise(r => setTimeout(r, 20));
const api = globalThis.sysmlWasm;
console.log("engine", api.version);

let failures = 0;
const check = (label, fn) => {
    try { fn(); console.log("ok  ", label); }
    catch (e) { failures++; console.log("FAIL", label, "\n     ", e.message); }
};

const library = { name: "PLEML.sysml", content: read("PLEML.sysml") };
const load = documents => buildFromAnalysis(
    analyze(api, [library, ...documents], { libraryNames: [library.name] }), [library, ...documents]);

// --- Drone product line example (three documents that import each other) ---
const examples = [
    "Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-FeatureModel.sysml",
    "Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-SharedAssets.sysml",
    "Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-ProductModel.sysml",
].map(path => ({ name: path.split("/").pop(), content: read(path) }));
const drone = load(examples);

check("drone example has no errors", () => {
    const errors = drone.diagnostics.filter(d => d.severity === "error");
    assert.equal(errors.length, 0, JSON.stringify(errors, null, 1));
});
const fm = drone.model.featureModels.find(m => m.name === "DroneProductLineFeatureModel");
check("feature model found", () => assert.ok(fm, drone.model.featureModels.map(m => m.name).join()));
check("one feature tree, three configurations", () => {
    assert.deepEqual(fm.trees.map(t => t.name), ["droneProductLineFeatureTree"]);
    assert.deepEqual(fm.configurations.map(c => c.name), ["deliveryDrone", "observationDrone", "consumerDrone"]);
});
const tree = fm.trees[0];
check("alternatives are grouped under their general feature", () => {
    const missionKind = tree.children.find(f => f.name === "missionKind");
    assert.deepEqual(missionKind.alternatives.map(f => f.name), ["deliveryMission", "observationMission", "funMission"]);
    const observation = missionKind.alternatives.find(f => f.name === "observationMission");
    assert.deepEqual(observation.alternatives.map(f => f.name), ["securityMission", "forestFireMission"]);
});
check("optional feature multiplicity", () => {
    const hasPayload = tree.children.find(f => f.name === "hasPayload");
    assert.equal(hasPayload.isOptional, true);
    assert.equal(hasPayload.multiplicityLabel, "[0..1]");
});
check("constraints and operands", () => {
    const all = [...drone.model.elements.values()].filter(e => e.kind);
    const labels = all.map(c => c.label).sort();
    assert.deepEqual(labels, [
        "forestFireMission requires longMission",
        "hasPayload requires payloadSize",
        "observationMission excludes hasPayload",
    ]);
});
check("configuration selections", () => {
    const delivery = fm.configurations.find(c => c.name === "deliveryDrone");
    assert.equal(delivery.treeName, "droneProductLineFeatureTree");
    assert.ok(delivery.selects("largePayload") && delivery.selects("deliveryMission"));
    assert.ok(!delivery.selects("funMission"));
});
check("locate a feature in its document", () => {
    const location = drone.locate(tree.id + "::hasPayload");
    assert.equal(location.document, examples[0].name);
    assert.equal(examples[0].content.slice(location.nameStart, location.nameEnd), "hasPayload");
});

// --- Constraint test model ---
const tests = load([{ name: "PLEML-Test-Constraints.sysml", content: read("Test/PLEML-Test-Constraints.sysml") }]);
check("implies constraint with two premises", () => {
    const implies = [...tests.model.elements.values()].find(e => e.kind === "implies");
    assert.equal(implies.label, "e and f implies g");
});

// --- Configuration checker: the expected verdicts documented in the test model ---
check("configuration checker matches the documented verdicts", () => {
    const verdicts = {};
    for (const c of tests.model.featureModels[0].configurations) {
        verdicts[c.name] = checkConfiguration(tests.model, c).violations.map(v => v.constraint.kind);
    }
    assert.deepEqual(verdicts, {
        xorValid: [], xorViolated: ["xor"], requiresValid: [], requiresViolated: ["requires"],
        impliesValid1: [], impliesValid2: [], impliesViolated: ["implies"],
    });
});
check("drone configurations are valid; alternatives imply their general feature", () => {
    for (const c of fm.configurations) {
        const result = checkConfiguration(drone.model, c);
        assert.deepEqual(result.violations.map(v => v.message), [], c.name);
    }
    const consumer = checkConfiguration(drone.model, fm.configurations.find(c => c.name === "consumerDrone"));
    assert.ok(consumer.selected.has(tree.id + "::observationMission"), "securityMission implies observationMission");
});

// --- Text model editor: rename, multiplicity, selection, delete ---
check("text editor renames, changes multiplicity, selects and deletes", () => {
    const documents = examples.map(d => ({ ...d }));
    const document = documents[0];
    const byName = name => documents.find(d => d.name === name);
    const apply = edits => {
        for (const d of documents) d.content = applyEditsToText(d.content, edits.filter(e => e.document === d.name));
    };
    const reload = () => buildFromAnalysis(
        analyze(api, [library, ...documents], { libraryNames: [library.name] }), [library, ...documents]);
    const editorFor = result => new TextModelEditor({ locate: result.locate, documentText: name => byName(name).content });
    const errorsOf = result => result.diagnostics.filter(d => d.severity === "error");

    let result = reload();
    apply(editorFor(result).renameElement(tree.id + "::hasPayload", "payload", fm.id, { documents: documents.map(d => d.name) }));
    result = reload();
    assert.deepEqual(errorsOf(result), [], document.content);
    assert.ok(result.model.get(tree.id + "::payload") && !result.model.get(tree.id + "::hasPayload"));
    assert.ok([...result.model.elements.values()].some(e => e.kind === "xor" && e.label === "observationMission excludes payload"));
    assert.ok(result.model.featureModels[0].configurations.find(c => c.name === "deliveryDrone").selects("payload"));

    apply(editorFor(result).setMultiplicity(tree.id + "::badWeatherConditions", "1"));
    result = reload();
    assert.deepEqual(errorsOf(result), []);
    const bad = result.model.get(tree.id + "::badWeatherConditions");
    assert.equal(bad.multiplicityText, "1");
    assert.ok(!/badWeatherConditions\[1\] default null/.test(document.content), "default null removed");
    apply(editorFor(result).setMultiplicity(tree.id + "::missionTime", "0..1"));
    result = reload();
    assert.deepEqual(errorsOf(result), []);
    assert.equal(result.model.get(tree.id + "::missionTime").multiplicityText, "0..1");

    const consumerId = fm.id + "::consumerDrone";
    apply(editorFor(result).selectFeature(consumerId, "payload"));
    result = reload();
    assert.ok(result.model.get(consumerId).selects("payload"));
    const violations = checkConfiguration(result.model, result.model.get(consumerId)).violations.map(v => v.message);
    assert.ok(violations.some(m => /observationMission excludes payload/.test(m)), violations.join("; "));
    apply(editorFor(result).deselectFeature(consumerId, "payload"));
    result = reload();
    assert.ok(!result.model.get(consumerId).selects("payload"));

    const configurationIds = result.model.featureModels[0].configurations.map(c => c.id);
    apply(editorFor(result).deleteFeature(tree.id + "::badWeatherConditions", { configurationIds, path: "badWeatherConditions" }));
    result = reload();
    assert.deepEqual(errorsOf(result), [], document.content);
    assert.ok(!result.model.get(tree.id + "::badWeatherConditions"));
});

// --- Diagnostics carry the document name ---
const broken = load([{ name: "broken.sysml", content: "package B {\n  part x : Undefined;\n}\n" }]);
check("diagnostic with file and line", () => {
    const d = broken.diagnostics.find(x => x.severity === "error");
    assert.equal(d.file, "broken.sysml");
    assert.equal(d.startLine, 2);
});

// --- Text model editor: edits are valid SysML ---
check("text editor adds a feature, a constraint and a configuration", () => {
    const document = { name: "fm.sysml", content: examples[0].content };
    const editor = new TextModelEditor({ locate: drone.locate, documentText: () => document.content });
    const apply = edits => { document.content = applyEditsToText(document.content, edits); };
    apply(editor.addFeature(tree.id, { name: "camera", multiplicity: "0..1" }));
    const relocated = () => buildFromAnalysis(
        analyze(api, [library, document, ...examples.slice(1)], { libraryNames: [library.name] }),
        [library, document, ...examples.slice(1)]);
    let result = relocated();
    const camera = result.model.get(tree.id + "::camera");
    assert.ok(camera && camera.isOptional, "camera not added");
    const editor2 = new TextModelEditor({ locate: result.locate, documentText: () => document.content });
    apply(editor2.addConstraint(camera.id, { kind: "requires", operandA: ["that"], operandB: ["hasPayload"] }));
    result = relocated();
    const editor3 = new TextModelEditor({ locate: result.locate, documentText: () => document.content });
    apply(editor3.addConfiguration(fm.id, { name: "cameraDrone", treeName: tree.name, selected: ["camera", "hasPayload"] }));
    result = relocated();
    const errors = result.diagnostics.filter(d => d.severity === "error");
    assert.equal(errors.length, 0, JSON.stringify(errors) + "\n" + document.content);
    const labels = [...result.model.elements.values()].filter(e => e.kind).map(c => c.label);
    assert.ok(labels.includes("camera requires hasPayload"), labels.join("; "));
    const config = result.model.featureModels[0].configurations.find(c => c.name === "cameraDrone");
    assert.ok(config && config.selects("camera") && config.selects("hasPayload"));

    // A nested feature: configurations and operands name it relative to the tree.
    const editor4 = new TextModelEditor({ locate: result.locate, documentText: () => document.content });
    apply(editor4.addFeature(tree.id + "::hasPayload", { name: "gripper", multiplicity: "0..1" }));
    result = relocated();
    const editor5 = new TextModelEditor({ locate: result.locate, documentText: () => document.content });
    apply(editor5.addConstraint(camera.id, { kind: "xor", operandA: ["that"], operandB: ["hasPayload::gripper"] }));
    result = relocated();
    const editor6 = new TextModelEditor({ locate: result.locate, documentText: () => document.content });
    apply(editor6.addConfiguration(fm.id, { name: "gripperDrone", treeName: tree.name, selected: ["hasPayload::gripper", "deliveryMission"] }));
    result = relocated();
    const nestedErrors = result.diagnostics.filter(d => d.severity === "error");
    assert.equal(nestedErrors.length, 0, JSON.stringify(nestedErrors) + "\n" + document.content);
    const gripperDrone = result.model.featureModels[0].configurations.find(c => c.name === "gripperDrone");
    assert.deepEqual(gripperDrone.selections.map(s => s.path), ["hasPayload", "hasPayload::gripper", "deliveryMission"]);
    const xor = [...result.model.elements.values()].filter(e => e.kind === "xor").map(c => c.label);
    assert.ok(xor.includes("camera excludes gripper"), xor.join("; "));
});

// --- Templates for new documents parse without errors ---
check("feature model template is valid and complete", () => {
    const result = load([{ name: "ProductLine.sysml", content: featureModelDocument("ProductLine") }]);
    assert.deepEqual(result.diagnostics.filter(d => d.severity === "error"), []);
    const tree = result.model.featureModels[0].trees[0];
    const edition = tree.children.find(f => f.name === "edition");
    assert.deepEqual(edition.alternatives.map(f => f.name), ["basicEdition", "premiumEdition"]);
    assert.equal(result.model.featureModels[0].configurations[0].selections.length, 2);
});
check("empty package template is valid", () => {
    const result = load([{ name: "P.sysml", content: emptyPackage("P") }]);
    assert.deepEqual(result.diagnostics.filter(d => d.severity === "error"), []);
});
check("insert snippets parse inside a feature model", () => {
    const snippet = label => SNIPPETS.find(s => s.label === label).text;
    const features = ["Mandatory feature", "Alternative features"].map(snippet).join("\n");
    const constraints = ["REQUIRES constraint", "XOR constraint", "IMPLIES constraint"].map(snippet).join("\n")
        .replace(/requiredFeature|excludedFeature|premiseA|premiseB|conclusion/g, "myFeature");
    const content = `package S {\n private import PLEML::*;\n${snippet("Feature model")}\n#featureModel occurrence def M2 {\n`
        + `#featureTree occurrence myFeatureTree :> featureTrees {\n${features}\n`
        + `#feature occurrence holder[0..1] default null {\n${constraints}\n}\n}\n`
        + `${snippet("Feature configuration")}\n}\n}\n`;
    const result = load([{ name: "S.sysml", content }]);
    const problems = result.diagnostics.filter(d => d.severity === "error" && d.code !== "duplicate");
    assert.deepEqual(problems, [], content);
});

// --- Outline handles doc comments, short names and redefinitions ---
check("outline names", () => {
    const outline = buildOutline(read("PLEML.sysml"));
    assert.ok(locate(outline, "PLEML::FeatureConfiguration::nodeFeaturesAreSet"));
    assert.ok(locate(outline, "PLEML::LifeCycleKind::Operation"));
    assert.ok(locate(outline, "PLEML::ImpliesConstraint::premises"));
});

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
