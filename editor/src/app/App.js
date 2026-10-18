// Application controller: connects workspace, repository, engine, model provider, model editor and views.
//
// The controller depends on interfaces only:
//   repository     ModelRepository      (LocalFileRepository now, SysmlApiRepository later)
//   provider       model provider       (TextModelProvider now, SysmlApiModelProvider later)
//   model editor   createModelEditor()  (TextModelEditor now, SysmlApiModelEditor later)
// The three editors (diagram, form, text) show the same PLEML model and share one selection.
// Diagram and form editors change the model through commands; each command is one undoable step.

import { Workspace, SourceDocument } from "../workspace/Workspace.js";
import { TextModelProvider } from "../workspace/TextModelProvider.js";
import { TextModelEditor, ModelEditError } from "../workspace/TextModelEditor.js";
import { OpenSysmlEngine } from "../engine/OpenSysmlEngine.js";
import { LocalFileRepository } from "../repository/LocalFileRepository.js";
import { CancelledError } from "../repository/ModelRepository.js";
import { FeatureModel, FeatureTree, Feature, FeatureConfiguration, FeatureConstraint } from "../pleml/model.js";
import { checkAllConfigurations } from "../pleml/ConfigurationChecker.js";
import { SNIPPETS, emptyPackage, featureModelDocument } from "../pleml/templates.js";
import { offsetOf } from "../text/sysml-text.js";
import { CodeEditor } from "../ui/CodeEditor.js";
import { FeatureModelView } from "../ui/FeatureModelView.js";
import { ProblemsView } from "../ui/ProblemsView.js";
import { DiagramView } from "../ui/DiagramView.js";
import { FormView } from "../ui/FormView.js";
import { formDialog, confirmDialog, infoDialog } from "../ui/FormDialog.js";

const $ = selector => document.querySelector(selector);
const VIEWS = ["diagram", "form", "text"];
const VIEW_KEY = "pleml-editor-view";

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function ownerId(id) {
    const i = id.lastIndexOf("::");
    return i < 0 ? "" : id.slice(0, i);
}

export class App {
    constructor(config) {
        this.config = config;
        this.workspace = new Workspace();
        this.repository = new LocalFileRepository();
        this.engine = new OpenSysmlEngine(config.engine);
        this.provider = new TextModelProvider(this.engine, { libraryNames: [config.library.name] });
        this.activeName = null;
        this.analysis = null;       // { result, revision }
        this.checks = new Map();    // configuration id -> check result
        this.selectedId = null;
        this.view = "diagram";
        this.history = { undo: [], redo: [] };
        this.checkSequence = 0;
        this.engineReady = false;
        this.engineError = null;
        this.checkTimer = null;
        this.draftTimer = null;
    }

    async start() {
        this.editor = new CodeEditor($("#code"));
        this.featureModelView = new FeatureModelView($("#feature-models"));
        this.problemsView = new ProblemsView($("#problems"), $("#problem-count"));
        this.diagramView = new DiagramView($("#diagram"));
        this.formView = new FormView($("#form"));
        this.wireUi();

        this.workspace.addEventListener("change", e => this.onWorkspaceChange(e.detail));
        const restored = this.restoreDrafts();
        await this.loadLibrary();
        if (!this.workspace.modelDocuments.length) {
            this.addDocument(new SourceDocument({ name: "ProductLine.sysml", content: featureModelDocument("ProductLine"), origin: "new" }));
        }
        if (!this.activeName || !this.workspace.get(this.activeName)) this.activate(this.workspace.modelDocuments[0].name);
        else this.activate(this.activeName);
        if (restored) this.status(`Restored ${restored} document${restored === 1 ? "" : "s"} from your last session.`);
        let view = "diagram";
        try { view = localStorage.getItem(VIEW_KEY) || view; } catch (_) { /* storage unavailable */ }
        this.setView(VIEWS.includes(view) ? view : "diagram");
        this.renderModelViews();
        this.startEngine();
    }

    // ---------- engine and checking ----------

    async startEngine() {
        const engineStatus = $("#engine-status");
        engineStatus.classList.remove("error");
        engineStatus.textContent = "Loading OpenSysML…";
        this.engineError = null;
        this.renderModelViews("Starting the OpenSysML engine…");
        try {
            const info = await this.engine.start(p => {
                if (p.stage === "download" && p.label === "OpenSysML engine") {
                    engineStatus.textContent = p.total
                        ? `Loading OpenSysML… ${Math.round(100 * p.loaded / p.total)} %`
                        : `Loading OpenSysML… ${(p.loaded / 1048576).toFixed(1)} MB`;
                } else if (p.stage === "start") {
                    engineStatus.textContent = "Starting OpenSysML…";
                }
            });
            this.engineReady = true;
            engineStatus.textContent = `OpenSysML ${info.version}`;
            engineStatus.title = `OpenSysML WebAssembly engine (Apache License 2.0), running in your browser; loaded from ${info.source}. Click for details.`;
            await this.check();
        } catch (e) {
            this.engineError = e.message;
            engineStatus.textContent = "OpenSysML not available – details";
            engineStatus.title = "Click for the reason and what to do";
            engineStatus.classList.add("error");
            this.renderModelViews("The OpenSysML engine could not be started. Click “OpenSysML not available” in the toolbar for details.");
            this.status(`The OpenSysML engine could not be started: ${e.message.split("\n")[0]}`, "error");
        }
    }

    showEngineDetails() {
        if (!this.engineError) {
            infoDialog("OpenSysML engine", [
                `Version ${this.engine.version}, loaded from ${this.engine.source}.`,
                "The engine runs in your browser; your model is not uploaded.",
                "OpenSysML: Apache License 2.0 (Open-MBEE). Go runtime: BSD license (The Go Authors).",
            ]);
            return;
        }
        const hints = [];
        if (location.protocol === "file:") hints.push("The editor was opened as a file. Serve the repository with a web server, e.g. “npx http-server . -p 8080”, and open http://localhost:8080/editor/.");
        if (/could not be loaded from any source|Failed to fetch|NetworkError|HTTP/.test(this.engineError)) {
            hints.push("The engine (about 8 MB compressed) is loaded from jsDelivr or unpkg. If your network blocks them, run “node editor/tools/fetch-engine.mjs” in the repository: it downloads a local copy that the editor uses first.");
        }
        if (/worker/i.test(this.engineError)) hints.push("Use a current Chrome, Edge, Firefox or Safari; the engine runs in a module Web Worker.");
        infoDialog("OpenSysML could not be started", [this.engineError, ...hints], {
            actionLabel: "Retry",
            action: () => {
                this.engine.stop();
                this.engine = new OpenSysmlEngine(this.config.engine);
                this.provider = new TextModelProvider(this.engine, { libraryNames: [this.config.library.name] });
                this.startEngine();
            },
        });
    }

    scheduleCheck() {
        clearTimeout(this.checkTimer);
        this.checkTimer = setTimeout(() => this.check(), this.config.checkDelayMs);
    }

    /** Parses all documents and updates the views. Results of outdated checks are dropped. */
    async check() {
        clearTimeout(this.checkTimer);
        if (!this.engineReady) return null;
        const sequence = ++this.checkSequence;
        const revision = this.workspace.revision;
        $("#check-status").textContent = "Checking…";
        const started = performance.now();
        let result;
        try {
            result = await this.provider.load(this.workspace.documents);
        } catch (e) {
            if (sequence === this.checkSequence) {
                $("#check-status").textContent = "Check failed";
                this.status(`The check failed: ${e.message}`, "error");
            }
            return null;
        }
        if (sequence !== this.checkSequence) return null;
        this.analysis = { result, revision };
        this.checks = checkAllConfigurations(result.model);
        $("#check-status").textContent = `Checked in ${Math.round(performance.now() - started)} ms`;
        if (this.selectedId && !result.model.get(this.selectedId)) this.selectedId = null;
        this.renderModelViews();
        this.problemsView.show(result.diagnostics, this.workspace.libraryNames);
        this.showDiagnosticsOfActive();
        return result;
    }

    /** Answers an analysis of the current text, checking again if the text changed since the last check. */
    async freshAnalysis() {
        if (this.analysis && this.analysis.revision === this.workspace.revision) return this.analysis.result;
        const result = await this.check();
        if (!result) throw new ModelEditError("The model could not be checked. Wait until OpenSysML has started.");
        return result;
    }

    createModelEditor(result) {
        return new TextModelEditor({ locate: result.locate, documentText: name => this.workspace.get(name).content });
    }

    // ---------- views and selection ----------

    setView(view) {
        this.view = view;
        for (const v of VIEWS) {
            $(`#view-${v}`).hidden = v !== view;
            const tab = document.querySelector(`[data-view="${v}"]`);
            tab.setAttribute("aria-selected", String(v === view));
            tab.classList.toggle("active", v === view);
        }
        try { localStorage.setItem(VIEW_KEY, view); } catch (_) { /* storage unavailable */ }
        if (view === "text" && this.active) {
            if (this.editor.value !== this.active.content) this.editor.setValue(this.active.content, { readOnly: this.active.readOnly, keepView: true });
            this.editor.render();
        }
        if (view === "diagram") this.diagramView.show(this.viewState());
    }

    viewState(message) {
        const model = this.analysis ? this.analysis.result.model : null;
        return { model, checks: this.checks, selectedId: this.selectedId, editable: true, message };
    }

    renderModelViews(message) {
        const state = this.viewState(message);
        this.featureModelView.show(state.model, { editable: true, message, selectedId: this.selectedId });
        this.formView.show(state);
        this.diagramView.show(state);
    }

    /** Selects an element in all views; in the text view, shows its declaration. */
    select(id, { reveal = this.view === "text" } = {}) {
        this.selectedId = id;
        const element = this.analysis && this.analysis.result.model.get(id);
        if (element instanceof FeatureConfiguration) this.diagramView.setConfiguration(id);
        if (element instanceof FeatureModel) this.diagramView.selectFeatureModel(id);
        this.renderModelViews();
        if (reveal) this.reveal(id);
    }

    // ---------- documents ----------

    async loadLibrary() {
        const { name, urls } = this.config.library;
        for (const url of urls) {
            try {
                const response = await fetch(url, { cache: "no-cache" });
                if (!response.ok) continue;
                this.workspace.add(new SourceDocument({ name, content: await response.text(), readOnly: true, library: true, origin: "library" }));
                return;
            } catch (_) { /* try the next URL */ }
        }
        this.status(`The PLEML library could not be loaded from ${urls.join(" or ")}. Imports of PLEML will not resolve.`, "error");
    }

    addDocument(document) {
        this.workspace.add(document);
        this.activate(document.name);
        return document;
    }

    activate(name) {
        const document = this.workspace.get(name);
        if (!document) return;
        this.activeName = name;
        this.editor.setValue(document.content, { readOnly: document.readOnly });
        this.showDiagnosticsOfActive();
        this.renderTabs();
        this.renderDocumentList();
        this.updateCursor();
        this.saveDrafts();
    }

    get active() {
        return this.workspace.get(this.activeName);
    }

    onWorkspaceChange({ reason }) {
        this.renderTabs();
        this.renderDocumentList();
        this.updateHistoryButtons();
        if (reason !== "save") {
            this.scheduleCheck();
            this.scheduleDraftSave();
        }
    }

    showDiagnosticsOfActive() {
        const diagnostics = this.analysis ? this.analysis.result.diagnostics : [];
        this.editor.setDiagnostics(diagnostics.filter(d => d.file === this.activeName));
    }

    renderTabs() {
        $("#tabs").innerHTML = this.workspace.documents.map(d => `
            <div class="tab${d.name === this.activeName ? " active" : ""}${d.library ? " library" : ""}" role="presentation">
                <button type="button" role="tab" class="tab-label" data-activate="${escapeHtml(d.name)}" aria-selected="${d.name === this.activeName}"
                    title="${escapeHtml(d.library ? "Library (read-only)" : d.name)}">${d.library ? "🔒 " : ""}${escapeHtml(d.name)}${d.dirty ? '<span class="dirty" aria-label="unsaved changes">●</span>' : ""}</button>
                ${d.library ? "" : `<button type="button" class="tab-close" data-close="${escapeHtml(d.name)}" aria-label="Close ${escapeHtml(d.name)}" title="Close">×</button>`}
            </div>`).join("");
    }

    renderDocumentList() {
        $("#documents").innerHTML = this.workspace.documents.map(d => `
            <li><button type="button" data-open-document="${escapeHtml(d.name)}" class="${d.name === this.activeName ? "active" : ""}">
                <span class="doc-name">${escapeHtml(d.name)}</span>
                <span class="doc-state">${d.library ? "library" : d.dirty ? "unsaved" : d.handle ? "saved" : d.origin === "file" ? "opened" : "not saved yet"}</span>
            </button></li>`).join("");
    }

    async newDocument(kind) {
        const values = await formDialog({
            title: kind === "featureModel" ? "New feature model" : "New SysML v2 file",
            submitLabel: "Create",
            fields: [{ name: "packageName", label: "Package name", value: kind === "featureModel" ? "MyProductLine" : "MyPackage", required: true }],
            validate: v => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.packageName) ? null : "Use letters, digits and _ only, no leading digit."),
        });
        if (!values) return;
        const content = kind === "featureModel" ? featureModelDocument(values.packageName) : emptyPackage(values.packageName);
        this.addDocument(new SourceDocument({ name: this.workspace.uniqueName(values.packageName), content, origin: "new" }));
    }

    async open() {
        let opened;
        try {
            opened = await this.repository.open();
        } catch (e) {
            if (!(e instanceof CancelledError)) this.status(`Opening failed: ${e.message}`, "error");
            return;
        }
        for (const props of opened) {
            const existing = this.workspace.get(props.name);
            if (existing && existing.library) {
                this.status(`${props.name} has the name of the library and was not opened.`, "error");
                continue;
            }
            if (existing && existing.dirty && !(await confirmDialog(`${props.name} is open with unsaved changes. Replace it with the file?`, { confirmLabel: "Replace" }))) continue;
            this.addDocument(new SourceDocument(props));
        }
    }

    async openExample(example) {
        try {
            const documents = await Promise.all(example.files.map(async path => {
                const response = await fetch(path, { cache: "no-cache" });
                if (!response.ok) throw new Error(`${path} (HTTP ${response.status})`);
                return new SourceDocument({ name: path.split("/").pop(), content: await response.text(), origin: "example" });
            }));
            documents.forEach(d => this.workspace.add(d));
            this.activate(documents[0].name);
            this.status(`Opened the example "${example.label}". Save it to keep your changes.`);
        } catch (e) {
            this.status(`The example could not be loaded: ${e.message}. Serve the editor from the repository to use the examples.`, "error");
        }
    }

    async save(document = this.active, { as = false } = {}) {
        if (!document || document.library) return;
        try {
            const saved = as ? await this.repository.saveAs(document) : await this.repository.save(document);
            const wasActive = document.name === this.activeName;
            if (saved.name && saved.name !== document.name) {
                this.workspace.rename(document.name, saved.name);
                if (wasActive) this.activeName = saved.name;
            }
            document.handle = saved.handle;
            document.origin = "file";
            document.markSaved();
            this.workspace.changed("save", document.name);
            this.saveDrafts();
            this.status(saved.handle ? `Saved ${document.name}.` : `Downloaded ${document.name}.`);
        } catch (e) {
            if (!(e instanceof CancelledError)) this.status(`Saving failed: ${e.message}`, "error");
        }
    }

    async close(name = this.activeName) {
        const document = this.workspace.get(name);
        if (!document || document.library) return;
        if (document.dirty && !(await confirmDialog(`${name} has unsaved changes. Close it anyway?`, { confirmLabel: "Close without saving" }))) return;
        this.workspace.remove(name);
        if (this.activeName === name) {
            const next = this.workspace.modelDocuments[0] || this.workspace.documents[0];
            if (next) this.activate(next.name);
        }
        this.saveDrafts();
    }

    // ---------- drafts (per browser convenience; files remain the source of truth) ----------

    scheduleDraftSave() {
        clearTimeout(this.draftTimer);
        this.draftTimer = setTimeout(() => this.saveDrafts(), 1000);
    }

    saveDrafts() {
        try {
            const drafts = this.workspace.modelDocuments.map(d => ({ name: d.name, content: d.content, savedContent: d.savedContent, origin: d.origin }));
            localStorage.setItem(this.config.draftStorageKey, JSON.stringify({ active: this.activeName, drafts }));
        } catch (_) { /* storage unavailable or full: drafts are a convenience only */ }
    }

    restoreDrafts() {
        try {
            const stored = JSON.parse(localStorage.getItem(this.config.draftStorageKey) || "null");
            if (!stored || !Array.isArray(stored.drafts)) return 0;
            for (const draft of stored.drafts) {
                if (typeof draft.name !== "string" || typeof draft.content !== "string") continue;
                const document = new SourceDocument({ name: draft.name, content: draft.content, origin: "draft" });
                // Restored documents have lost their file handle; keep their unsaved state visible.
                document.savedContent = typeof draft.savedContent === "string" ? draft.savedContent : "";
                this.workspace.add(document);
            }
            this.activeName = stored.active || null;
            return stored.drafts.length;
        } catch (_) {
            return 0;
        }
    }

    // ---------- PLEML editing commands (shared by diagram, form and feature model views) ----------

    /**
     * Runs an editing command on an element. The handler answers text edits (or null if cancelled);
     * they are applied as one undoable step, and the model is checked again.
     */
    async runCommand(command, id, args = {}) {
        if (this.commandRunning) return;
        this.commandRunning = true;
        try {
            const result = await this.freshAnalysis();
            const element = result.model.get(id);
            if (!element) throw new ModelEditError("The element is no longer in the model. Check the text for errors.");
            const handler = this.commands[command];
            if (!handler) throw new ModelEditError(`Unknown command ${command}.`);
            const outcome = await handler.call(this, element, result, args);
            if (!outcome || !outcome.edits || !outcome.edits.length) return;
            this.applyCommandEdits(outcome.edits, outcome.label || command);
            if (outcome.select !== undefined) this.selectedId = outcome.select;
            await this.check();
            if (this.view === "text" && outcome.edits[0]) {
                const edit = outcome.edits.find(e => e.document === this.activeName) || outcome.edits[0];
                if (edit.document !== this.activeName) this.activate(edit.document);
                this.editor.reveal(edit.start, edit.start + edit.text.length);
            }
            this.status(outcome.message || "");
        } catch (e) {
            this.status(e.message, "error");
        } finally {
            this.commandRunning = false;
        }
    }

    applyCommandEdits(edits, label) {
        const changes = this.workspace.applyEdits(edits);
        this.history.undo.push({ label, changes: changes.map(c => ({ name: c.document.name, before: c.before, after: c.document.content })) });
        if (this.history.undo.length > 100) this.history.undo.shift();
        this.history.redo = [];
        this.refreshActiveText();
        this.updateHistoryButtons();
    }

    undo(redo = false) {
        const from = redo ? this.history.redo : this.history.undo;
        const to = redo ? this.history.undo : this.history.redo;
        const step = from.pop();
        if (!step) return;
        for (const change of step.changes) {
            const document = this.workspace.get(change.name);
            if (document) this.workspace.setContent(change.name, redo ? change.after : change.before);
        }
        to.push(step);
        this.refreshActiveText();
        this.updateHistoryButtons();
        this.status(`${redo ? "Redone" : "Undone"}: ${step.label}`);
        this.check();
    }

    refreshActiveText() {
        if (this.active && this.editor.value !== this.active.content) this.editor.setValue(this.active.content, { readOnly: this.active.readOnly, keepView: true });
    }

    updateHistoryButtons() {
        const undo = $("#undo"), redo = $("#redo");
        const last = this.history.undo[this.history.undo.length - 1];
        const next = this.history.redo[this.history.redo.length - 1];
        undo.disabled = !last;
        redo.disabled = !next;
        undo.title = last ? `Undo: ${last.label} (Ctrl+Z)` : "Undo (Ctrl+Z)";
        redo.title = next ? `Redo: ${next.label} (Ctrl+Y)` : "Redo (Ctrl+Y)";
    }

    /** The features of the trees as names relative to their tree, e.g. "hasPayload::gripper". */
    featurePaths(model, trees) {
        return trees.flatMap(tree => model.featuresOf(tree).map(({ feature }) => feature.path));
    }

    validateNewName(name, ownerElementId, result) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Use letters, digits and _ only, no leading digit.";
        if (result.model.get(`${ownerElementId}::${name}`) || (result.locate && result.locate(`${ownerElementId}::${name}`))) return `${name} already exists here.`;
        return null;
    }

    get commands() {
        return {
            async addFeature(parent, result) {
                if (!(parent instanceof Feature)) throw new ModelEditError("Select a feature or a feature tree to add a feature to.");
                const values = await formDialog({
                    title: `Add a feature to ${parent.name}`,
                    fields: [
                        { name: "name", label: "Feature name", value: "newFeature", required: true },
                        {
                            name: "multiplicity", label: "Kind", type: "select", value: "0..1", options: [
                                { value: "0..1", label: "Optional [0..1]" }, { value: "1", label: "Mandatory [1]" },
                                { value: "1..*", label: "One or more [1..*]" }, { value: "0..*", label: "Any number [0..*]" },
                            ],
                        },
                    ],
                    validate: v => this.validateNewName(v.name, parent.id, result),
                });
                if (!values) return null;
                return { edits: this.createModelEditor(result).addFeature(parent.id, values), label: `add feature ${values.name}`, select: `${parent.id}::${values.name}` };
            },

            async addAlternative(feature, result) {
                if (!(feature instanceof Feature) || feature instanceof FeatureTree) throw new ModelEditError("Select a feature to add an alternative of it.");
                const values = await formDialog({
                    title: `Add an alternative of ${feature.name}`,
                    fields: [{ name: "name", label: "Feature name", value: "newAlternative", required: true,
                        hint: `The new feature specializes ${feature.name}: a product that has it also has ${feature.name}.` }],
                    validate: v => this.validateNewName(v.name, ownerId(feature.id), result),
                });
                if (!values) return null;
                return {
                    edits: this.createModelEditor(result).addFeature(ownerId(feature.id), { name: values.name, multiplicity: "0..1", specializes: feature.name }),
                    label: `add alternative ${values.name}`, select: `${ownerId(feature.id)}::${values.name}`,
                };
            },

            async addConstraint(feature, result) {
                if (!(feature instanceof Feature)) throw new ModelEditError("Select a feature to add a constraint to it.");
                const tree = result.model.get(feature.treeId);
                const ownPath = feature.path || feature.name;
                const options = this.featurePaths(result.model, tree ? [tree] : []).filter(p => p !== ownPath).map(p => ({ value: p, label: p }));
                const values = await formDialog({
                    title: `Add a constraint to ${feature.name}`,
                    fields: [
                        {
                            name: "kind", label: "Constraint", type: "select", value: "requires", options: [
                                { value: "requires", label: `REQUIRES: ${feature.name} requires all selected features` },
                                { value: "xor", label: `XOR: ${feature.name} excludes all selected features` },
                                { value: "implies", label: "IMPLIES: all premises imply all selected features" },
                            ],
                        },
                        { name: "premises", label: "Premises (operand A)", type: "checkboxes", options: [{ value: ownPath, label: ownPath }, ...options], value: [ownPath],
                            showWhen: { field: "kind", values: ["implies"] } },
                        { name: "operandB", label: "Features (operand B)", type: "checkboxes", options,
                            hint: "For REQUIRES and XOR, operand A is the feature that owns the constraint." },
                    ],
                    validate: v => (!v.operandB.length ? "Select at least one feature for operand B."
                        : v.kind === "implies" && !v.premises.length ? "Select at least one premise." : null),
                });
                if (!values) return null;
                const operandA = values.kind === "implies" ? values.premises.map(p => (p === ownPath ? "that" : p)) : ["that"];
                return { edits: this.createModelEditor(result).addConstraint(feature.id, { kind: values.kind, operandA, operandB: values.operandB }), label: `add ${values.kind} constraint` };
            },

            async addConfiguration(featureModel, result) {
                if (!(featureModel instanceof FeatureModel)) featureModel = result.model.featureModelOf(featureModel.id);
                if (!featureModel || !featureModel.trees.length) throw new ModelEditError("The feature model has no feature tree to configure.");
                let tree = featureModel.trees[0];
                if (featureModel.trees.length > 1) {
                    const choice = await formDialog({
                        title: "Feature tree of the configuration", submitLabel: "Next",
                        fields: [{ name: "tree", label: "Feature tree", type: "select", value: tree.id, options: featureModel.trees.map(t => ({ value: t.id, label: t.name })) }],
                    });
                    if (!choice) return null;
                    tree = featureModel.trees.find(t => t.id === choice.tree);
                }
                const options = this.featurePaths(result.model, [tree]).map(p => ({ value: p, label: p }));
                const values = await formDialog({
                    title: `Add a configuration of ${tree.name}`,
                    fields: [
                        { name: "name", label: "Configuration name", value: "newProduct", required: true },
                        { name: "selected", label: "Selected features", type: "checkboxes", options,
                            hint: "You can change the selection later in the diagram or the form. Selecting a nested feature or an alternative implies its parent or general feature." },
                    ],
                    validate: v => this.validateNewName(v.name, featureModel.id, result),
                });
                if (!values) return null;
                const id = `${featureModel.id}::${values.name}`;
                this.diagramView.setConfiguration(id);
                return {
                    edits: this.createModelEditor(result).addConfiguration(featureModel.id, { name: values.name, treeName: tree.name, selected: values.selected }),
                    label: `add configuration ${values.name}`, select: id,
                };
            },

            async rename(element, result, { newName } = {}) {
                if (element instanceof FeatureConstraint || element instanceof FeatureModel) throw new ModelEditError("Rename this element in the text.");
                if (!newName) {
                    const values = await formDialog({
                        title: `Rename ${element.name}`, submitLabel: "Rename",
                        fields: [{ name: "name", label: "New name", value: element.name, required: true,
                            hint: "References in the feature model and qualified references in your other documents are renamed too." }],
                        validate: v => (v.name === element.name ? "Enter a new name." : this.validateNewName(v.name, ownerId(element.id), result)),
                    });
                    if (!values) return null;
                    newName = values.name;
                } else {
                    const problem = this.validateNewName(newName, ownerId(element.id), result);
                    if (problem) throw new ModelEditError(problem);
                }
                const scope = result.model.featureModelOf(element.id);
                const documents = this.workspace.modelDocuments.map(d => d.name);
                const edits = this.createModelEditor(result).renameElement(element.id, newName, scope ? scope.id : element.id, { documents });
                const renamedId = `${ownerId(element.id)}::${newName}`;
                if (this.diagramView.configurationId === element.id) this.diagramView.configurationId = renamedId;
                return { edits, label: `rename ${element.name} to ${newName}`, select: renamedId };
            },

            async setMultiplicity(feature, result, { multiplicity }) {
                if (!(feature instanceof Feature) || feature instanceof FeatureTree) throw new ModelEditError("Only features have a kind.");
                if (feature.multiplicityText === multiplicity) return null;
                return { edits: this.createModelEditor(result).setMultiplicity(feature.id, multiplicity), label: `make ${feature.name} [${multiplicity}]` };
            },

            async toggleSelection(feature, result, { configurationId, select }) {
                const configuration = result.model.get(configurationId);
                if (!configuration || !(feature instanceof Feature)) return null;
                const editor = this.createModelEditor(result);
                const edits = select ? editor.selectFeature(configurationId, feature.path) : editor.deselectFeature(configurationId, feature.path);
                return { edits, label: `${select ? "select" : "deselect"} ${feature.name} in ${configuration.name}` };
            },

            async delete(element, result) {
                const editor = this.createModelEditor(result);
                if (element instanceof FeatureConstraint) {
                    return { edits: editor.deleteElement(element.id), label: "remove constraint", select: element.ownerId };
                }
                if (element instanceof FeatureConfiguration) {
                    if (!(await confirmDialog(`Delete the configuration ${element.name}?`, { confirmLabel: "Delete" }))) return null;
                    if (this.diagramView.configurationId === element.id) this.diagramView.setConfiguration("");
                    return { edits: editor.deleteElement(element.id), label: `delete configuration ${element.name}`, select: (result.model.featureModelOf(element.id) || {}).id || null };
                }
                if (element instanceof Feature && !(element instanceof FeatureTree)) {
                    const nested = result.model.featuresOf(element).length;
                    const ok = await confirmDialog(`Delete ${element.name}${nested ? ` and its ${nested} nested feature${nested === 1 ? "" : "s"} and alternatives` : ""}? `
                        + "It is also removed from the configurations. Constraints that refer to it are reported in Problems.", { confirmLabel: "Delete" });
                    if (!ok) return null;
                    const featureModel = result.model.featureModelOf(element.id);
                    const configurationIds = featureModel ? featureModel.configurations.filter(c => c.treeId === element.treeId).map(c => c.id) : [];
                    // Alternatives specialize the feature; they are separate declarations and go with it.
                    const doomed = [];
                    const collect = f => { doomed.push(f); f.alternatives.forEach(collect); };
                    collect(element);
                    const edits = doomed.flatMap(f => editor.deleteFeature(f.id, { configurationIds, path: f.path }));
                    return { edits, label: `delete ${element.name}`, select: element.ownerFeatureId };
                }
                throw new ModelEditError("Delete this element in the text.");
            },
        };
    }

    // ---------- navigation ----------

    async reveal(id) {
        const result = this.analysis && this.analysis.result;
        const location = result && result.locate(id);
        if (!location) {
            this.status("The declaration was not found in the text.", "error");
            return;
        }
        if (this.view !== "text") this.setView("text");
        if (location.document !== this.activeName) this.activate(location.document);
        if (this.analysis.revision !== this.workspace.revision) {
            // The text changed since the last check: find the declaration again.
            const fresh = (await this.freshAnalysis()).locate(id);
            if (fresh) this.editor.reveal(fresh.nameStart ?? fresh.start, fresh.nameEnd ?? fresh.start);
            return;
        }
        this.editor.reveal(location.nameStart ?? location.start, location.nameEnd ?? location.start);
    }

    revealDiagnostic(d) {
        if (!d.file || !this.workspace.get(d.file)) return;
        if (this.view !== "text") this.setView("text");
        if (d.file !== this.activeName) this.activate(d.file);
        const text = this.active.content;
        const start = offsetOf(text, d.startLine || 1, d.startCol || 1);
        const end = Math.max(start, offsetOf(text, d.endLine || d.startLine || 1, d.endCol || d.startCol || 1));
        this.editor.reveal(start, end);
    }

    updateCursor() {
        const { line, col } = this.editor.cursor;
        $("#cursor").textContent = `Ln ${line}, Col ${col}`;
    }

    status(message, kind = "info") {
        const element = $("#message");
        element.textContent = message;
        element.className = kind;
        clearTimeout(this.statusTimer);
        if (kind !== "error") this.statusTimer = setTimeout(() => { element.textContent = ""; }, 6000);
    }

    // ---------- user interface wiring ----------

    wireUi() {
        this.editor.addEventListener("change", () => {
            if (this.active && !this.active.readOnly) this.workspace.setContent(this.activeName, this.editor.value);
        });
        this.editor.addEventListener("cursor", () => this.updateCursor());
        this.featureModelView.addEventListener("select", e => this.select(e.detail.id));
        this.featureModelView.addEventListener("command", e => this.runCommand(e.detail.command, e.detail.element.id));
        this.problemsView.addEventListener("select", e => this.revealDiagnostic(e.detail.diagnostic));
        for (const view of [this.diagramView, this.formView]) {
            view.addEventListener("select", e => this.select(e.detail.id, { reveal: false }));
            view.addEventListener("command", e => this.runCommand(e.detail.command, e.detail.id, e.detail.args));
        }
        this.formView.addEventListener("reveal", e => this.reveal(e.detail.id));

        const actions = {
            "new-feature-model": () => this.newDocument("featureModel"),
            "new-package": () => this.newDocument("package"),
            "open": () => this.open(),
            "save": () => this.save(),
            "save-as": () => this.save(this.active, { as: true }),
            "save-all": async () => { for (const d of this.workspace.dirtyDocuments) await this.save(d); },
            "close": () => this.close(),
            "check": () => this.check(),
            "undo": () => this.undo(),
            "redo": () => this.undo(true),
            "engine": () => this.showEngineDetails(),
        };
        document.addEventListener("click", e => {
            const action = e.target.closest("[data-action]");
            if (action && actions[action.dataset.action]) {
                closeMenus();
                actions[action.dataset.action]();
                return;
            }
            const view = e.target.closest("[data-view]");
            if (view) { this.setView(view.dataset.view); return; }
            const openDocument = e.target.closest("[data-open-document]");
            if (openDocument) { this.activate(openDocument.dataset.openDocument); this.setView("text"); return; }
            const activate = e.target.closest("[data-activate]");
            if (activate) { this.activate(activate.dataset.activate); return; }
            const close = e.target.closest("[data-close]");
            if (close) { this.close(close.dataset.close); return; }
            if (!e.target.closest(".menu")) closeMenus();
        });

        $("#examples-menu").innerHTML = this.config.examples.map((x, i) =>
            `<button type="button" role="menuitem" data-example="${i}">${escapeHtml(x.label)}</button>`).join("");
        $("#examples-menu").addEventListener("click", e => {
            const item = e.target.closest("[data-example]");
            if (item) { closeMenus(); this.openExample(this.config.examples[Number(item.dataset.example)]); }
        });
        $("#insert-menu").innerHTML = SNIPPETS.map((s, i) =>
            `<button type="button" role="menuitem" data-snippet="${i}">${escapeHtml(s.label)}</button>`).join("");
        $("#insert-menu").addEventListener("click", e => {
            const item = e.target.closest("[data-snippet]");
            if (!item) return;
            closeMenus();
            if (!this.active || this.active.readOnly) { this.status("The library is read-only. Insert into one of your documents.", "error"); return; }
            this.setView("text");
            this.editor.insertAtCursor(SNIPPETS[Number(item.dataset.snippet)].text);
        });

        document.addEventListener("keydown", e => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod) return;
            const key = e.key.toLowerCase();
            const typing = e.target.closest("textarea, input, select");
            if (key === "s") { e.preventDefault(); this.save(this.active, { as: e.shiftKey }); }
            else if (key === "o") { e.preventDefault(); this.open(); }
            else if (!typing && key === "z") { e.preventDefault(); this.undo(e.shiftKey); }
            else if (!typing && key === "y") { e.preventDefault(); this.undo(true); }
        });
        window.addEventListener("beforeunload", e => {
            this.saveDrafts();
            if (this.workspace.dirtyDocuments.length) { e.preventDefault(); e.returnValue = ""; }
        });

        function closeMenus() {
            document.querySelectorAll("details.menu[open]").forEach(d => d.removeAttribute("open"));
        }
        document.querySelectorAll("details.menu").forEach(menu => menu.addEventListener("toggle", () => {
            if (menu.open) document.querySelectorAll("details.menu[open]").forEach(d => d !== menu && d.removeAttribute("open"));
        }));
        this.updateHistoryButtons();
    }
}
