// Downloads the OpenSysML engine into editor/vendor/, so the editor works without access to the CDNs
// (offline, or in networks that block them). The editor tries this local copy first.
//
// Usage (from the repository root):  node editor/tools/fetch-engine.mjs
// The files are verified against the hashes in editor/src/config.js and are not committed (.gitignore).

import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";

const editorDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { sources, wasmSha256, wasmExecSha256, version } = config.engine;
const local = sources.find(s => !/^https?:/.test(s.base));
const remotes = sources.filter(s => /^https?:/.test(s.base));
const target = resolve(editorDir, local.base);

async function fetchVerified(file, expected) {
    for (const remote of remotes) {
        try {
            const response = await fetch(remote.base + file);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            const actual = createHash("sha256").update(bytes).digest("hex");
            if (actual !== expected) throw new Error(`SHA-256 mismatch (${actual})`);
            console.log(`${file}: ${(bytes.length / 1048576).toFixed(1)} MB from ${remote.label}, SHA-256 verified`);
            return bytes;
        } catch (e) {
            console.warn(`${file} from ${remote.label} failed: ${e.message}`);
        }
    }
    throw new Error(`${file} could not be downloaded`);
}

await mkdir(target, { recursive: true });
await writeFile(resolve(target, "wasm_exec.js"), await fetchVerified("wasm_exec.js", wasmExecSha256));
await writeFile(resolve(target, "sysml-wasm.wasm"), await fetchVerified("sysml-wasm.wasm", wasmSha256));
console.log(`OpenSysML ${version} is in ${target}`);
