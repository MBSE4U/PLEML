// Model editor for SysML v2 textual notation.
//
// A model editor executes the PLEML editing commands of the views (text, form and diagram):
//   addFeature(parentId, { name, multiplicity, specializes })
//   addConstraint(featureId, { kind, operandA, operandB })
//   addConfiguration(featureModelId, { name, treeName, selected })
//   renameElement(id, newName, scopeId)
//   setMultiplicity(featureId, multiplicity)
//   deleteElement(id)
//   deleteFeature(featureId, { configurationIds, path })
//   selectFeature(configurationId, path) / deselectFeature(configurationId, path)
// Features in operands and selections are named relative to their feature tree ("hasPayload::gripper").
//
// This editor answers each command with a list of text edits [{ document, start, end, text }] that the
// workspace applies. A model editor for the SysML v2 API answers the same commands with a commit of
// element changes instead.

import { CONSTRAINT_KINDS } from "../pleml/model.js";
import { lineIndent, tokenize } from "../text/sysml-text.js";

const INDENT = "    ";
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const QUALIFIED_NAME = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/;
const MULTIPLICITY = /^(\d+|\*)(\.\.(\d+|\*))?$/;

export class ModelEditError extends Error {}

function checkName(name, what = "name", pattern = NAME) {
    if (!pattern.test(name || "")) throw new ModelEditError(`The ${what} "${name || ""}" is not a valid name (letters, digits, _; no leading digit).`);
}

function checkMultiplicity(multiplicity) {
    if (multiplicity && !MULTIPLICITY.test(multiplicity)) throw new ModelEditError(`"${multiplicity}" is not a multiplicity, e.g. 1, 0..1 or 1..*.`);
}

/**
 * Operands are feature names relative to the feature tree, e.g. "hasPayload::gripper", or "that".
 * A nested feature is referenced as a feature chain ("hasPayload.gripper"), as SysML requires.
 */
function operandText(names) {
    if (!names.length) throw new ModelEditError("Each operand needs at least one feature.");
    names.forEach(n => n === "that" || checkName(n, "feature", QUALIFIED_NAME));
    const chains = names.map(n => n.replaceAll("::", "."));
    return chains.length === 1 ? chains[0] : `(${chains.join(", ")})`;
}

/**
 * Statements that set the selected features in a configuration body (without indentation of the body).
 * A nested feature ("a::b") is set inside the redefinition of its parent feature, which is set as well.
 */
function selectionLines(paths) {
    const root = new Map();
    for (const path of paths) {
        checkName(path, "feature", QUALIFIED_NAME);
        let level = root;
        for (const segment of path.split("::")) {
            if (!level.has(segment)) level.set(segment, new Map());
            level = level.get(segment);
        }
    }
    const lines = [];
    const emit = (level, indent) => {
        for (const [name, children] of level) {
            if (children.size) {
                lines.push(`${indent}#feature occurrence :>> ${name}[1] {`);
                emit(children, indent + INDENT);
                lines.push(`${indent}}`);
            } else {
                lines.push(`${indent}#feature occurrence :>> ${name}[1];`);
            }
        }
    };
    emit(root, "");
    return lines;
}

export class TextModelEditor {
    /**
     * @param {{locate: function(string): object|null, documentText: function(string): string}} source
     *        locate(id) answers the source location of an element, documentText(name) the current text
     */
    constructor({ locate, documentText }) {
        this.locate = locate;
        this.documentText = documentText;
    }

    // ---------- adding ----------

    addFeature(parentId, { name, multiplicity = "", specializes = "" }) {
        checkName(name);
        checkMultiplicity(multiplicity);
        if (specializes) checkName(specializes, "general feature");
        const optional = /^0(\.\.|$)/.test(multiplicity);
        const line = `#feature occurrence ${name}${multiplicity ? `[${multiplicity}]` : ""}`
            + `${specializes ? ` :> ${specializes}` : ""}${optional ? " default null" : ""};`;
        return [this.insertIntoBody(parentId, [line])];
    }

    addConstraint(featureId, { kind, operandA, operandB }) {
        const constraint = CONSTRAINT_KINDS[kind];
        if (!constraint) throw new ModelEditError(`Unknown constraint kind ${kind}.`);
        return [this.insertIntoBody(featureId, [
            `assert constraint :>> ${constraint.usage} {`,
            `${INDENT}in occurrence constrainedFeatures = new FeatureOperand(${operandText(operandA)}, ${operandText(operandB)});`,
            "}",
        ])];
    }

    /** @param {{name: string, treeName: string, selected: string[]}} options selected: feature names relative to the tree */
    addConfiguration(featureModelId, { name, treeName, selected = [] }) {
        checkName(name);
        checkName(treeName, "feature tree");
        return [this.insertIntoBody(featureModelId, [
            `#featureConfiguration occurrence ${name} :> ${treeName}, featureConfigurations {`,
            ...selectionLines(selected).map(l => INDENT + l),
            "}",
        ])];
    }

    // ---------- configurations ----------

    /** Sets a feature in a configuration, inside the redefinitions of its parents if they are set already. */
    selectFeature(configurationId, path) {
        checkName(path, "feature", QUALIFIED_NAME);
        if (this.locate(`${configurationId}::${path}`)) return [];
        const segments = path.split("::");
        for (let k = segments.length - 1; k >= 1; k--) {
            const parentId = `${configurationId}::${segments.slice(0, k).join("::")}`;
            if (this.locate(parentId)) return [this.insertIntoBody(parentId, selectionLines([segments.slice(k).join("::")]))];
        }
        return [this.insertIntoBody(configurationId, selectionLines([path]))];
    }

    /** Removes the statement that sets the feature (and the features set inside it). */
    deselectFeature(configurationId, path) {
        const id = `${configurationId}::${path}`;
        if (!this.locate(id)) {
            throw new ModelEditError(`${path.split("::").pop()} is not set by the configuration itself; it is implied by a selected nested feature or alternative.`);
        }
        return this.deleteElement(id);
    }

    // ---------- changing ----------

    /**
     * Renames an element and the references to it:
     * - every use of the name within the scope (e.g. the feature model)
     * - qualified references "owner::name" in the given documents (e.g. shared assets of the product line)
     * Other references, e.g. strings in metadata, are not changed; OpenSysML reports the ones that break.
     */
    renameElement(id, newName, scopeId = id, { documents = [] } = {}) {
        checkName(newName);
        const location = this.requireLocation(id);
        const scope = this.requireLocation(scopeId);
        if (scope.document !== location.document) throw new ModelEditError("The rename scope is in another document.");
        const text = this.documentText(location.document);
        const oldName = text.slice(location.nameStart, location.nameEnd);
        if (!oldName) throw new ModelEditError(`The declaration of ${id} has no name to rename.`);

        const edits = new Map();
        const add = (document, start, end) => edits.set(`${document}:${start}`, { document, start, end, text: newName });
        for (const t of tokenize(text.slice(scope.start, scope.end))) {
            if (t.type === "ident" && !t.quoted && t.value === oldName) add(location.document, scope.start + t.start, scope.start + t.end);
        }
        add(location.document, location.nameStart, location.nameEnd);

        const segments = id.split("::");
        const ownerName = segments.length > 1 ? segments[segments.length - 2] : "";
        if (ownerName) {
            for (const document of new Set([location.document, ...documents])) {
                const tokens = tokenize(this.documentText(document));
                for (let i = 2; i < tokens.length; i++) {
                    const t = tokens[i];
                    if (t.type === "ident" && t.value === oldName && tokens[i - 1].value === "::" && tokens[i - 2].value === ownerName) {
                        add(document, t.start, t.end);
                    }
                }
            }
        }
        return [...edits.values()];
    }

    /**
     * Changes the multiplicity of a feature declaration. An optional feature (lower bound 0) gets
     * "default null", so it is not selected unless a configuration sets it; a mandatory one loses it.
     */
    setMultiplicity(featureId, multiplicity) {
        checkMultiplicity(multiplicity);
        const location = this.requireLocation(featureId);
        if (location.nameEnd === null) throw new ModelEditError(`The declaration of ${featureId} was not found.`);
        const text = this.documentText(location.document);
        const headerEnd = location.bodyOpen !== null ? location.bodyOpen : location.end - 1;
        const header = text.slice(location.nameEnd, headerEnd);
        const bracket = /^\s*\[[^\]]*\]/.exec(header);
        let rest = bracket ? header.slice(bracket[0].length) : header;
        const optional = /^0(\.\.|$)/.test(multiplicity);
        if (optional && !/\bdefault\b|=/.test(rest)) rest = rest.replace(/\s*$/, " default null") + (/\s$/.test(rest) ? " " : "");
        if (!optional) rest = rest.replace(/\s+default\s+null\b/, "");
        const newHeader = (multiplicity ? `[${multiplicity}]` : "") + rest;
        return [{ document: location.document, start: location.nameEnd, end: headerEnd, text: newHeader }];
    }

    // ---------- deleting ----------

    /** Removes the declaration of an element, including its body and its lines. */
    deleteElement(id) {
        const location = this.requireLocation(id);
        const text = this.documentText(location.document);
        let start = location.start, end = location.end;
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        if (/^[ \t]*$/.test(text.slice(lineStart, start))) start = lineStart;
        const after = /^[ \t]*(\r?\n)?/.exec(text.slice(end));
        end += after[0].length;
        return [{ document: location.document, start, end, text: "" }];
    }

    /** Removes a feature and the statements that set it in the given configurations. */
    deleteFeature(featureId, { configurationIds = [], path = "" } = {}) {
        const edits = this.deleteElement(featureId);
        if (path) {
            for (const configurationId of configurationIds) {
                if (this.locate(`${configurationId}::${path}`)) edits.push(...this.deleteElement(`${configurationId}::${path}`));
            }
        }
        return edits;
    }

    // ---------- helpers ----------

    requireLocation(id) {
        const location = this.locate(id);
        if (!location) throw new ModelEditError(`The declaration of ${id} was not found in the text.`);
        return location;
    }

    /** Inserts statements at the end of the body of an element, creating the body if it has none. */
    insertIntoBody(ownerId, lines) {
        const location = this.requireLocation(ownerId);
        const text = this.documentText(location.document);
        const indent = lineIndent(text, location.start);
        const inner = indent + INDENT;
        const block = lines.map(l => inner + l).join("\n");

        if (location.bodyOpen !== null && location.bodyClose !== null) {
            const lineStart = text.lastIndexOf("\n", location.bodyClose - 1) + 1;
            const beforeClose = text.slice(lineStart, location.bodyClose);
            if (/^[ \t]*$/.test(beforeClose) && lineStart > location.bodyOpen) {
                return { document: location.document, start: lineStart, end: lineStart, text: block + "\n" };
            }
            return { document: location.document, start: location.bodyClose, end: location.bodyClose, text: "\n" + block + "\n" + indent };
        }
        // A declaration without a body ends with ";": replace it with a body.
        const semicolon = location.end - 1;
        if (text[semicolon] !== ";") throw new ModelEditError(`The declaration of ${ownerId} has an unexpected form.`);
        return { document: location.document, start: semicolon, end: location.end, text: " {\n" + block + "\n" + indent + "}" };
    }
}

/** Applies edits to a text; edits must not overlap. */
export function applyEditsToText(text, edits) {
    return [...edits].sort((a, b) => b.start - a.start)
        .reduce((current, e) => current.slice(0, e.start) + e.text + current.slice(e.end), text);
}
