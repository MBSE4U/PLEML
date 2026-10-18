// Page-side client of the OpenSysML worker.
//
// It implements the parser service the editor depends on:
//   start(onProgress) -> { version }
//   analyze(documents, { libraryNames, strict }) -> { modelHash, diagnostics, documentRoots, symbols, truncated }
// Another engine (e.g. the sysml-grpc service via @openmbee/opensysml) can replace it with the same methods.

export class OpenSysmlEngine {
    constructor(engineConfig) {
        this.config = engineConfig;
        this.worker = null;
        this.nextId = 1;
        this.pending = new Map();
        this.progressListener = null;
        this.version = "";
    }

    start(onProgress) {
        if (this.started) return this.started;
        this.progressListener = onProgress || null;
        const workerUrl = new URL("./opensysml.worker.js", import.meta.url);
        try {
            this.worker = new Worker(workerUrl, { type: "module" });
        } catch (e) {
            this.started = Promise.reject(new Error(`This browser cannot start the engine worker (${e.message}). Use a current Chrome, Edge, Firefox or Safari.`));
            return this.started;
        }
        this.worker.onmessage = ({ data }) => this.receive(data);
        // A module worker that fails to load reports an error event without a message.
        this.worker.onerror = event => this.failAll(event.message
            || `The engine worker ${workerUrl.pathname} could not be loaded. Serve the editor with a web server (not as a file) and check that it delivers .js files as JavaScript.`);
        // Relative source URLs refer to the page, not to the worker script.
        const sources = this.config.sources.map(s => ({
            label: s.label,
            wasmUrl: new URL(s.base + "sysml-wasm.wasm", document.baseURI).href,
            wasmExecUrl: new URL(s.base + "wasm_exec.js", document.baseURI).href,
        }));
        this.started = this.request("init", {
            sources,
            wasmSha256: this.config.wasmSha256,
            wasmExecSha256: this.config.wasmExecSha256,
        }).then(info => {
            this.version = info.version;
            this.source = info.source;
            return info;
        });
        this.started.catch(() => { this.started = null; });
        return this.started;
    }

    analyze(documents, options = {}) {
        return this.request("analyze", { documents, ...options });
    }

    evaluate(modelHash, expression, contextSymbolId = "") {
        return this.request("evaluate", { modelHash, expression, contextSymbolId });
    }

    request(op, args) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, op, args });
        });
    }

    receive(data) {
        if (data.type === "progress") {
            if (this.progressListener) this.progressListener(data);
            return;
        }
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        if (data.error) {
            const error = new Error(data.error.message);
            error.code = data.error.code;
            entry.reject(error);
        } else {
            entry.resolve(data.result);
        }
    }

    failAll(message) {
        for (const { reject } of this.pending.values()) reject(new Error(message));
        this.pending.clear();
    }

    /** Stops the worker, e.g. before a retry after a failed start. */
    stop() {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        this.started = null;
        this.failAll("The engine was stopped.");
    }
}
