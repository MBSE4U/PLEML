// Model provider for SysML v2 textual notation.
//
// A model provider turns a model source into what the views show:
//   load() -> { model: PlemlModel, diagnostics: Diagnostic[], locate(id): SourceLocation | null }
// This provider parses the open .sysml documents (and the PLEML library) with the OpenSysML engine.
// A provider for the SysML v2 API answers the same shape from the elements of a project commit.

import { buildPlemlModel } from "../pleml/PlemlModelBuilder.js";
import { buildOutline, locate, readFeatureOperand } from "../text/sysml-text.js";

/**
 * Builds the provider result from an engine analysis of the given documents.
 * Pure function: the Node smoke test uses it without a worker.
 * @param {object} analysis result of engine.analyze()
 * @param {{name: string, content: string}[]} documents
 */
export function buildFromAnalysis(analysis, documents) {
    const outlines = new Map(documents.map(d => [d.name, buildOutline(d.content)]));
    const texts = new Map(documents.map(d => [d.name, d.content]));

    // Each document root lists the top-level packages declared by the document.
    const documentOfPackage = new Map();
    for (const root of analysis.documentRoots) {
        for (const packageId of root.packageIds) {
            if (!documentOfPackage.has(packageId)) documentOfPackage.set(packageId, root.document);
        }
    }
    const documentOf = id => documentOfPackage.get(id.split("::")[0]) || "";

    const locateNode = id => {
        const document = documentOf(id);
        const outline = outlines.get(document);
        const node = outline ? locate(outline, id) : null;
        return node ? { document, node } : null;
    };

    const model = buildPlemlModel(analysis.symbols, {
        documentOf,
        truncated: analysis.truncated,
        readOperands: (constraintId, ownerName) => {
            const found = locateNode(constraintId);
            return found ? readFeatureOperand(texts.get(found.document), found.node, ownerName) : null;
        },
    });

    return {
        model,
        diagnostics: analysis.diagnostics,
        modelHash: analysis.modelHash,
        /** Source location of an element: { document, start, end, nameStart, nameEnd, bodyOpen, bodyClose } */
        locate: id => {
            const found = locateNode(id);
            if (!found) return null;
            const { start, end, nameStart, nameEnd, bodyOpen, bodyClose } = found.node;
            return { document: found.document, start, end, nameStart, nameEnd, bodyOpen, bodyClose };
        },
    };
}

export class TextModelProvider {
    /**
     * @param {object} engine parser service with analyze(documents, options)
     * @param {{libraryNames: string[], strict?: boolean}} options
     */
    constructor(engine, { libraryNames = [], strict = false } = {}) {
        this.engine = engine;
        this.libraryNames = libraryNames;
        this.strict = strict;
    }

    /** @param {{name: string, content: string}[]} documents all documents, libraries included */
    async load(documents) {
        const plain = documents.map(d => ({ name: d.name, content: d.content }));
        const analysis = await this.engine.analyze(plain, { libraryNames: this.libraryNames, strict: this.strict });
        return buildFromAnalysis(analysis, plain);
    }
}
