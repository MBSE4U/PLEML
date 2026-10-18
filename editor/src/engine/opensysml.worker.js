// Web Worker that runs the OpenSysML WebAssembly engine off the UI thread.
//
// Protocol: the page posts { id, op, args }; the worker answers { id, result } or { id, error },
// and posts { type: "progress", stage, loaded, total } while it loads the engine.

import * as core from "./engine-core.js";
import { sha256Hex } from "./sha256.js";

let api = null;

async function verify(buffer, expected, label) {
    if (!expected) return;
    const actual = await sha256Hex(buffer);
    if (actual !== expected) {
        throw new Error(`${label} does not match its published SHA-256 (expected ${expected}, got ${actual})`);
    }
}

async function download(url, label) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${label} could not be loaded from ${url} (HTTP ${response.status})`);
    const total = Number(response.headers.get("Content-Length") || 0);
    if (!response.body || !response.body.getReader) return response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        postMessage({ type: "progress", stage: "download", label, loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes.buffer;
}

/** Downloads and verifies the Go runtime and the module from the first source that delivers both. */
async function loadFiles(sources, wasmSha256, wasmExecSha256) {
    const failures = [];
    for (const source of sources) {
        try {
            postMessage({ type: "progress", stage: "source", label: source.label });
            const runtime = await download(source.wasmExecUrl, "Go runtime");
            await verify(runtime, wasmExecSha256, "Go runtime");
            const module = await download(source.wasmUrl, "OpenSysML engine");
            await verify(module, wasmSha256, "OpenSysML engine");
            return { runtime, module, source: source.label };
        } catch (e) {
            failures.push(`${source.label}: ${e && e.message ? e.message : e}`);
        }
    }
    throw new Error("The engine files could not be loaded from any source.\n" + failures.join("\n"));
}

async function init({ sources, wasmSha256, wasmExecSha256 }) {
    if (api) return { version: api.version };

    const { runtime, module, source } = await loadFiles(sources, wasmSha256, wasmExecSha256);
    // The Go runtime defines globalThis.Go. It must match the toolchain of the module.
    new Function(new TextDecoder().decode(runtime))();
    postMessage({ type: "progress", stage: "start", label: source });

    const go = new globalThis.Go();
    const { instance } = await WebAssembly.instantiate(module, go.importObject);
    go.run(instance); // runs for the lifetime of the worker
    const started = Date.now();
    while (!globalThis.sysmlWasm) {
        if (Date.now() - started > 20000) throw new Error("the engine did not start");
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    api = globalThis.sysmlWasm;
    return { version: api.version, source };
}

const operations = {
    init,
    parseSources: ({ documents, strict }) => core.parseSources(api, documents, { strict }),
    analyze: ({ documents, strict, libraryNames }) => core.analyze(api, documents, { strict, libraryNames }),
    getSymbol: ({ modelHash, symbolId }) => core.getSymbol(api, modelHash, symbolId),
    evaluate: ({ modelHash, expression, contextSymbolId }) => core.evaluate(api, modelHash, expression, contextSymbolId),
};

self.onmessage = async ({ data }) => {
    const { id, op, args } = data;
    try {
        const operation = operations[op];
        if (!operation) throw new Error(`unknown operation ${op}`);
        if (op !== "init" && !api) throw new Error("the engine is not started");
        postMessage({ id, result: await operation(args || {}) });
    } catch (e) {
        postMessage({ id, error: { message: e && e.message ? e.message : String(e), code: e && e.code } });
    }
};
