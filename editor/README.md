# PLEML Editor

A web-based editor for PLEML feature models in SysML v2 textual notation. It runs entirely in the browser: the [OpenSysML](https://github.com/Open-MBEE/OpenSysML) WebAssembly engine parses and checks the model locally, and nothing is uploaded to a server.

Version 1 creates, reads and writes `.sysml` files. The architecture is prepared for a later version that works on a model in a SysML v2 API (Systems Modeling API) repository.

## Three editors on one model

The editor offers three views of the same model, switched with **Diagram | Form | Text**. They share one selection, and every change is saved to the `.sysml` text.

**Diagram.** A feature diagram, not SysML notation, meant to be read without SysML knowledge:
- Features are boxes, from the feature tree on the left to the details on the right.
- A filled dot marks a mandatory feature, a hollow dot an optional one.
- Alternatives are drawn in orange; the label at their general feature says how many a product picks, e.g. "pick 1–2".
- Constraints are dashed arrows: requires (blue), excludes (red ⊗) and implies (purple).
- **Feature model mode:** select a feature, then add features, alternatives, constraints and configurations. Double-click (or F2) renames a feature; Del deletes it.
- **Configuration mode** (Show ▸ Configuration: …): selected features are green and unselected ones fade out. Implied features have a dashed outline; a selected nested feature or alternative implies its parent or general feature.
  - Click a feature to select or deselect it.
  - Violated constraints turn red and are listed with an explanation.
- Pan with the mouse, zoom with the wheel or the buttons, and press Fit to show everything.

**Form.** A form for the selected element:
- **Feature model:** a configuration matrix with features as rows and configurations as columns. Each checkbox selects or deselects a feature in a configuration, and each column shows whether its constraints are satisfied.
- **Feature:**
  - name (rename) and kind (mandatory, optional, one or more, any number)
  - alternatives and nested features
  - constraints, which you can add or remove
  - the configurations that select the feature
  - delete
- **Configuration:** a feature checklist with the constraint check result.
- **Constraint:** the kind and the operands, with remove.

**Text.** The SysML v2 textual notation, with syntax highlighting, line numbers, auto-indent and snippets for PLEML elements (Insert menu).

Commands from the diagram and the form are single undoable steps (**Undo / Redo**, Ctrl+Z / Ctrl+Y outside the text editor). Renaming a feature also renames:
- the references to it in the feature model (constraints, configurations, alternatives)
- qualified references in your other open documents, such as the feature bindings of shared assets

## Files and checks

- **Create** a new feature model from a template, or an empty SysML v2 file (File ▸ New).
- **Read** `.sysml` files from your computer (File ▸ Open, several at once), or open the examples of this repository.
- **Write** back to the opened file (Chrome and Edge, via the File System Access API), or save as a download in other browsers.
- **SysML check (OpenSysML):** all open documents are parsed together with the PLEML library. The check covers syntax, name resolution and the SysML validation rules that OpenSysML implements. Findings appear in the Problems panel and are marked in the text.
- **Configuration check (PLEML editor):** OpenSysML does not evaluate the PLEML feature constraints, so the editor evaluates them itself on the PLEML model. It checks the REQUIRES, XOR and IMPLIES constraints of each configuration, taking implied features into account. The result appears in the diagram and the form; it is not a SysML-level verification.
- **Drafts:** open documents are kept in the browser's local storage, so they survive a reload. Files remain the source of truth.

## Run

The editor is a static web app without a build step. Serve the **repository root** with any static web server and open `/editor/`:

```bash
npx http-server . -p 8080      # then open http://localhost:8080/editor/
```

Serving the repository root lets the editor load `../PLEML.sysml` and the examples. Without them, it falls back to the PLEML library on GitHub (via jsDelivr); the Examples menu then is not available. Opening `index.html` as a file does not work, because browsers do not run module workers from `file://` URLs.

### The OpenSysML engine

The editor loads the engine (about 8 MB compressed) from the first source that works:
1. a local copy in `editor/vendor/`
2. jsDelivr
3. unpkg

The browser caches it for later visits. Before running the engine and the Go runtime, the editor checks their SHA-256 against the hashes published with the npm package. This also works on plain-HTTP addresses such as `http://192.168.x.x:8080`, where browsers offer no Web Crypto.

For offline use, or if your network blocks the CDNs, download the local copy once (it is not committed):

```bash
node editor/tools/fetch-engine.mjs
```

If the toolbar shows **OpenSysML not available**, click it to see the reason, hints and a Retry button.

## Architecture

```
            ┌──────────────────────── views (src/ui) ─────────────────────────┐
            │ DiagramView  FormView  CodeEditor  FeatureModelView  ProblemsView│
            └───────────────┬────────────────────────────────┬────────────────┘
                            │ PLEML domain model              │ commands
                     ┌──────┴───────┐                 ┌───────┴────────┐
                     │ App (src/app) │── repository ──│ ModelRepository │  LocalFileRepository
                     └──────┬───────┘                 └────────────────┘  SysmlApiRepository (prepared)
              model provider│                model editor│
   ┌────────────────────────┴───┐        ┌───────────────┴──────────────┐
   │ TextModelProvider          │        │ TextModelEditor               │  text edits
   │ SysmlApiModelProvider (prep.)│      │ SysmlApiModelEditor (prepared) │  commits
   └──────┬─────────────────────┘        └──────────────────────────────┘
          │ analyze(documents)
   ┌──────┴────────────────────────────────────┐
   │ OpenSysmlEngine ── Web Worker ── engine-core ── OpenSysML WebAssembly │
   └───────────────────────────────────────────┘
```

| Layer | Files | Responsibility |
|---|---|---|
| Domain | `src/pleml/model.js` | PLEML domain model: `FeatureModel`, `FeatureTree`, `Feature`, `FeatureConstraint`, `FeatureConfiguration`. The views know only this model, not where it comes from. |
| Model building | `src/pleml/PlemlModelBuilder.js` | Recognizes PLEML elements in the engine's symbols, e.g. a feature by its inherited `bindingTime : LifeCycleKind`, and alternatives by subsetting a sibling feature. |
| Configuration check | `src/pleml/ConfigurationChecker.js` | Evaluates the REQUIRES, XOR and IMPLIES constraints of each configuration on the domain model, including implied features (parents of nested features, general features of alternatives). |
| Views | `src/ui/` | `DiagramView` (graphical editor), `FormView` (form editor), `CodeEditor` (text editor), `FeatureModelView` (outline), `ProblemsView`, `FormDialog`. The views emit `select` and `command` events; `App` executes the commands with the model editor and keeps the undo history. |
| Engine | `src/engine/` | `engine-core.js` calls the OpenSysML module (`ParseSources`, `GetSymbol`, `Evaluate`) and is shared by the worker and the Node test. `OpenSysmlEngine` runs it in a Web Worker. |
| Text | `src/text/sysml-text.js` | Comment-aware outline of the text. The engine reports no source positions for symbols, so the outline finds declarations, constraint operands and insertion points. |
| Source | `src/workspace/` | `Workspace` holds the open documents. `TextModelProvider` turns documents into the domain model and diagnostics. `TextModelEditor` turns model commands into text edits. |
| Storage | `src/repository/` | `ModelRepository` interface. `LocalFileRepository` reads and writes local files. |
| SysML v2 API | `src/sysml-api/` | `SysmlApiClient` (REST client for projects, branches, commits, elements and commits with changes). Provider, editor and repository are stubs with the planned mapping. |

### Toward the SysML v2 API

The views and commands depend on three interfaces, so an API-based model needs no changes to them:

| Interface | Text (version 1) | SysML v2 API (prepared) |
|---|---|---|
| Model provider: `load() → { model, diagnostics, locate }` | `TextModelProvider` | `SysmlApiModelProvider` maps API elements to the PLEML domain model |
| Model editor: add, rename, set multiplicity, select/deselect in a configuration, delete | `TextModelEditor` (text edits) | `SysmlApiModelEditor` (commits of element changes) |
| Model repository: `open`, `save`, `saveAs`, `browse` | `LocalFileRepository` | `SysmlApiRepository` (projects, branches, commits) |

The planned element mapping is documented in `src/sysml-api/SysmlApiModelProvider.js`.

An alternative is to keep the text editor and convert between the API's JSON and SysML text with the OpenSysML service (`sysml-grpc`, `@openmbee/opensysml`). The WebAssembly engine does not offer conversion or source-preserving edits; the service does.

## Test

The smoke test runs the engine, model and text layers in Node against the examples and tests of this repository. It needs the engine files from the npm package [`@openmbee/opensysml-wasm`](https://www.npmjs.com/package/@openmbee/opensysml-wasm), at the version in `src/config.js`:

```bash
npm pack @openmbee/opensysml-wasm@0.10.1 && tar xzf openmbee-opensysml-wasm-0.10.1.tgz
node editor/test/smoke.mjs package/wasm_exec.js package/sysml-wasm.wasm
```

## Configuration

`src/config.js` holds:

- the engine version, its URLs and hashes
- the library URLs and the examples
- the check delay and the drafts storage key
- the (future) SysML v2 API base URL

To update the engine, change the version and the two hashes. The new hashes are published in the npm package's README.

## Licenses

- The editor is part of PLEML (MIT License).
- At runtime it loads the OpenSysML engine (Apache License 2.0, Open-MBEE) and the Go WebAssembly runtime (BSD license, The Go Authors) from the npm package `@openmbee/opensysml-wasm`. Neither is redistributed in this repository.
