// Configuration of the PLEML editor.

const ENGINE_VERSION = "0.10.1";
const ENGINE_PACKAGE = `@openmbee/opensysml-wasm@${ENGINE_VERSION}`;

export const config = {
    engine: {
        // OpenSysML WebAssembly engine (Apache License 2.0) and its matching Go runtime (BSD license),
        // from the npm package @openmbee/opensysml-wasm. The hashes are the ones published in the
        // package README; the worker refuses files that do not match.
        version: ENGINE_VERSION,
        // Tried in order. The local copy is created by "node editor/tools/fetch-engine.mjs"
        // (for offline use or networks that block the CDNs); relative URLs refer to index.html.
        sources: [
            { label: "local copy", base: `vendor/opensysml-wasm-${ENGINE_VERSION}/` },
            { label: "jsDelivr", base: `https://cdn.jsdelivr.net/npm/${ENGINE_PACKAGE}/` },
            { label: "unpkg", base: `https://unpkg.com/${ENGINE_PACKAGE}/` },
        ],
        wasmSha256: "f2b4118723b4e6af33bfd3e26f0b14fc98cc97baf0df080161b4c181ba7e4d4a",
        wasmExecSha256: "0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14",
    },

    // The PLEML library is parsed together with the user's documents. The editor tries the URLs in order:
    // the copy in this repository (when the editor is served from the repository), then the GitHub copy.
    library: {
        name: "PLEML.sysml",
        urls: ["../PLEML.sysml", "https://cdn.jsdelivr.net/gh/MBSE4U/PLEML@main/PLEML.sysml"],
    },

    // Examples of this repository, opened from the "Examples" menu.
    examples: [
        {
            label: "Drone product line",
            files: [
                "../Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-FeatureModel.sysml",
                "../Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-SharedAssets.sysml",
                "../Examples/MBPLE-Example-DroneProductLine-PLEML-SysMLv2-ProductModel.sysml",
            ],
        },
        { label: "Constraint tests", files: ["../Test/PLEML-Test-Constraints.sysml"] },
    ],

    // Delay after the last keystroke before the model is checked again.
    checkDelayMs: 700,

    // Key for the drafts of unsaved documents in the browser's local storage.
    draftStorageKey: "pleml-editor-drafts-v1",

    // SysML v2 API server for a future version (see src/sysml-api/).
    sysmlApi: { baseUrl: "" },
};
