// Engine core: the calls to the OpenSysML WebAssembly module.
//
// The module registers globalThis.sysmlWasm = { version, call(method, jsonRequest) }.
// call() answers a JSON-RPC envelope: { jsonrpc, id, result } or { jsonrpc, id, error: { code, message } }.
// The request and response fields follow the sysml-grpc protobuf messages in JSON encoding
// (see @openmbee/opensysml, dist/generated/sysml_pb.d.ts).
//
// This module has no DOM or worker dependencies, so the worker and the Node smoke test share it.

export class EngineError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "EngineError";
        this.code = code;
    }
}

function call(api, method, request) {
    const envelope = JSON.parse(api.call(method, JSON.stringify(request)));
    if (envelope.error) {
        throw new EngineError(envelope.error.message || String(envelope.error), envelope.error.code);
    }
    return envelope.result || {};
}

/** Normalizes an engine diagnostic to a flat object with its file and position. */
export function normalizeDiagnostic(d) {
    const span = d.span || {};
    return {
        severity: d.severity || "info",
        message: d.message || "",
        code: d.code || "",
        file: span.file || "",
        startLine: span.startLine || 0,
        startCol: span.startCol || 0,
        endLine: span.endLine || span.startLine || 0,
        endCol: span.endCol || span.startCol || 0,
    };
}

/**
 * Parses several documents as one model.
 * @param {object} api globalThis.sysmlWasm
 * @param {{name: string, content: string, language?: string}[]} documents
 * @returns {{modelHash: string, diagnostics: object[], documentRoots: {document: string, packageIds: string[]}[]}}
 */
export function parseSources(api, documents, { strict = false } = {}) {
    const result = call(api, "ParseSources", {
        documents: documents.map(d => ({ content: d.content, name: d.name, language: d.language || "" })),
        strictConformance: strict,
    });
    // ParseSources answers one root namespace per document, in request order.
    // An empty list (e.g. no diagnostics) is omitted from the response.
    const roots = result.roots || [];
    return {
        modelHash: result.modelHash || "",
        diagnostics: (result.diagnostics || []).map(normalizeDiagnostic),
        documentRoots: documents.map((d, i) => ({
            document: d.name,
            packageIds: [...new Set((roots[i] && roots[i].childIds) || [])],
        })),
    };
}

/** Answers the symbol with the given qualified name, or null if the model has none. */
export function getSymbol(api, modelHash, symbolId) {
    try {
        return call(api, "GetSymbol", { modelHash, symbolId }).symbol || null;
    } catch (e) {
        if (e instanceof EngineError) return null;
        throw e;
    }
}

/**
 * Collects the symbols below the given root ids, depth first.
 * Unnamed members (ids ending with "::", e.g. comments or imports) are skipped.
 * @returns {{symbols: Object<string, object>, truncated: boolean}}
 */
export function collectSymbols(api, modelHash, rootIds, { limit = 20000 } = {}) {
    const symbols = {};
    const stack = [...rootIds].reverse();
    let truncated = false;
    while (stack.length) {
        const id = stack.pop();
        if (!id || id.endsWith("::") || symbols[id]) continue;
        if (Object.keys(symbols).length >= limit) { truncated = true; break; }
        const symbol = getSymbol(api, modelHash, id);
        if (!symbol) continue;
        symbols[id] = symbol;
        const children = symbol.childIds || [];
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return { symbols, truncated };
}

/**
 * Parses the documents and collects the symbols of the documents that are not libraries.
 * One round trip for the editor: diagnostics for all documents, symbols for the user's documents.
 */
export function analyze(api, documents, { strict = false, libraryNames = [] } = {}) {
    const parsed = parseSources(api, documents, { strict });
    const rootIds = parsed.documentRoots
        .filter(r => !libraryNames.includes(r.document))
        .flatMap(r => r.packageIds);
    const { symbols, truncated } = collectSymbols(api, parsed.modelHash, rootIds);
    return { ...parsed, symbols, truncated };
}

export function evaluate(api, modelHash, expression, contextSymbolId = "") {
    return call(api, "Evaluate", { modelHash, expression, contextSymbolId }).result;
}
