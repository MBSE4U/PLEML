// Graphical editor: the feature trees of a feature model as an interactive diagram.
//
// Not SysML notation, but a feature-diagram style meant to be read without SysML knowledge:
// - features are boxes, laid out from left (tree) to right (detail)
// - a filled dot marks a mandatory feature, a hollow dot an optional one
// - alternatives are drawn in orange, with "pick n" at their general feature
// - constraints are dashed arrows: requires (blue), excludes (red), implies (purple)
// - in configuration mode, selected features are green; a click selects or deselects a feature
//
// Events: "select" { id }, "command" { command, id, args }, "mode" { configurationId }

import { CONSTRAINT_KINDS } from "../pleml/model.js";

const SVG = "http://www.w3.org/2000/svg";
const ROW = 46, NODE_H = 32, COL_GAP = 88, TREE_GAP = 40, PAD_X = 14;

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

let measureContext = null;
function textWidth(text, font) {
    if (!measureContext) measureContext = document.createElement("canvas").getContext("2d");
    measureContext.font = font;
    return measureContext.measureText(text).width;
}

function chooseLabel(multiplicity) {
    if (!multiplicity) return "pick 1";
    const { lower, upper } = multiplicity;
    if (upper === "*") return lower === "0" ? "pick any" : `pick ≥ ${lower}`;
    if (lower === upper) return `pick ${lower}`;
    if (lower === "0") return `pick ≤ ${upper}`;
    return `pick ${lower}–${upper}`;
}

export class DiagramView extends EventTarget {
    constructor(container) {
        super();
        this.root = container;
        this.root.classList.add("diagram-view");
        this.root.innerHTML = `
            <div class="dg-toolbar" role="toolbar" aria-label="Diagram">
                <label class="dg-field dg-fm-field" hidden>Feature model <select class="dg-fm"></select></label>
                <label class="dg-field">Show <select class="dg-mode" aria-label="Show the feature model or a configuration"></select></label>
                <span class="dg-status" aria-live="polite"></span>
                <span class="dg-spacer"></span>
                <span class="dg-actions"></span>
                <span class="dg-zoom">
                    <label class="dg-check"><input type="checkbox" class="dg-constraints" checked> Constraints</label>
                    <button type="button" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
                    <button type="button" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
                    <button type="button" data-zoom="fit" title="Fit to window">Fit</button>
                </span>
            </div>
            <div class="dg-canvas">
                <svg class="dg-svg" role="application" aria-label="Feature diagram">
                    <defs>
                        <marker id="dg-arrow-requires" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-arrow requires"/></marker>
                        <marker id="dg-arrow-implies" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="dg-arrow implies"/></marker>
                    </defs>
                    <g class="dg-viewport"></g>
                </svg>
                <div class="dg-empty" hidden></div>
                <ul class="dg-violations" hidden></ul>
                <div class="dg-legend" aria-label="Legend">
                    <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" class="dg-dot mandatory"/></svg>mandatory</span>
                    <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" class="dg-dot optional"/></svg>optional</span>
                    <span><i class="dg-swatch alternative"></i>alternative</span>
                    <span><i class="dg-swatch requires"></i>requires</span>
                    <span><i class="dg-swatch xor"></i>excludes</span>
                    <span><i class="dg-swatch implies"></i>implies</span>
                </div>
            </div>`;
        this.svg = this.root.querySelector(".dg-svg");
        this.viewport = this.root.querySelector(".dg-viewport");
        this.canvas = this.root.querySelector(".dg-canvas");
        this.transform = { x: 20, y: 20, k: 1 };
        this.needsFit = true;
        this.state = null;
        this.featureModelId = null;
        this.configurationId = "";
        this.showConstraints = true;
        this.wire();
    }

    /**
     * @param {{model, checks: Map, selectedId: string|null, editable: boolean}} state
     */
    show(state) {
        this.state = state;
        const { model } = state;
        const featureModels = model ? model.featureModels : [];
        if (!featureModels.some(fm => fm.id === this.featureModelId)) {
            this.featureModelId = featureModels.length ? featureModels[0].id : null;
            this.needsFit = true;
        }
        const featureModel = featureModels.find(fm => fm.id === this.featureModelId) || null;
        if (featureModel && this.configurationId && !featureModel.configurations.some(c => c.id === this.configurationId)) this.configurationId = "";
        this.renderToolbar(featureModels, featureModel);

        const empty = this.root.querySelector(".dg-empty");
        if (!featureModel) {
            this.viewport.innerHTML = "";
            empty.hidden = false;
            empty.innerHTML = model
                ? `<p>No feature model yet.</p><p>Create one with <strong>File ▸ New feature model</strong>, open a file, or try <strong>Examples</strong>.</p>`
                : `<p>${escapeHtml(state.message || "Waiting for the model check…")}</p>`;
            this.root.querySelector(".dg-violations").hidden = true;
            return;
        }
        empty.hidden = true;
        this.render(featureModel);
        if (this.needsFit) {
            this.needsFit = false;
            requestAnimationFrame(() => this.fit());
        }
    }

    /** Shows a configuration (or the plain feature model with ""). */
    setConfiguration(configurationId) {
        this.configurationId = configurationId || "";
        if (this.state) this.show(this.state);
    }

    selectFeatureModel(featureModelId) {
        if (this.featureModelId === featureModelId) return;
        this.featureModelId = featureModelId;
        this.configurationId = "";
        this.needsFit = true;
        if (this.state) this.show(this.state);
    }

    // ---------- toolbar ----------

    renderToolbar(featureModels, featureModel) {
        const fmField = this.root.querySelector(".dg-fm-field");
        fmField.hidden = featureModels.length < 2;
        this.root.querySelector(".dg-fm").innerHTML = featureModels.map(fm =>
            `<option value="${escapeHtml(fm.id)}"${fm.id === this.featureModelId ? " selected" : ""}>${escapeHtml(fm.name)}</option>`).join("");
        const configurations = featureModel ? featureModel.configurations : [];
        this.root.querySelector(".dg-mode").innerHTML = `<option value="">Feature model (all features)</option>`
            + configurations.map(c => `<option value="${escapeHtml(c.id)}"${c.id === this.configurationId ? " selected" : ""}>Configuration: ${escapeHtml(c.name)}</option>`).join("");

        const status = this.root.querySelector(".dg-status");
        const configuration = this.configuration();
        if (configuration) {
            const check = this.state.checks.get(configuration.id);
            const count = check ? check.violations.length : 0;
            status.className = "dg-status " + (count ? "bad" : "ok");
            status.textContent = count ? `✗ ${count} constraint violation${count === 1 ? "" : "s"}` : "✓ all constraints satisfied";
            status.title = "Checked by the PLEML editor: REQUIRES, XOR and IMPLIES constraints of the tree";
        } else {
            status.className = "dg-status";
            status.textContent = featureModel ? "Click a feature to select it, double-click to rename" : "";
            status.title = "";
        }

        const actions = this.root.querySelector(".dg-actions");
        if (!this.state.editable || !featureModel) { actions.innerHTML = ""; return; }
        if (configuration) {
            actions.innerHTML = `<span class="dg-hint">Click features to select or deselect them in ${escapeHtml(configuration.name)}</span>`;
            return;
        }
        const selected = this.selectedElement();
        const isFeature = selected && selected.treeId !== undefined;
        const isTree = isFeature && selected.treeId === selected.id;
        const button = (command, label, enabled, title) =>
            `<button type="button" data-command="${command}"${enabled ? "" : " disabled"} title="${escapeHtml(title)}">${escapeHtml(label)}</button>`;
        actions.innerHTML = [
            button("addFeature", "+ Feature", isFeature, "Add a nested feature to the selected feature"),
            button("addAlternative", "+ Alternative", isFeature && !isTree, "Add an alternative of the selected feature"),
            button("addConstraint", "+ Constraint", isFeature, "Add a constraint owned by the selected feature"),
            button("rename", "Rename", isFeature, "Rename the selected feature (F2)"),
            button("delete", "Delete", isFeature && !isTree, "Delete the selected feature (Del)"),
            button("addConfiguration", "+ Configuration", true, "Add a configuration of this feature model"),
        ].join("");
    }

    configuration() {
        return this.configurationId && this.state.model ? this.state.model.get(this.configurationId) : null;
    }

    selectedElement() {
        return this.state.selectedId && this.state.model ? this.state.model.get(this.state.selectedId) : null;
    }

    // ---------- layout and rendering ----------

    layout(featureModel) {
        const font = "600 13px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
        const nodes = [];
        const columnWidths = [];
        let row = 0;
        const build = (feature, depth) => {
            const label = feature.name + (feature.multiplicityText && feature.treeId !== feature.id ? `  ${feature.multiplicityText}` : "");
            const node = { feature, depth, children: [], w: Math.ceil(textWidth(label, font)) + 2 * PAD_X + 18, h: NODE_H };
            columnWidths[depth] = Math.max(columnWidths[depth] || 0, node.w);
            for (const alternative of feature.alternatives) node.children.push({ ...build(alternative, depth + 1), alternative: true });
            for (const child of feature.children) node.children.push(build(child, depth + 1));
            if (node.children.length) {
                node.y = (node.children[0].y + node.children[node.children.length - 1].y) / 2;
            } else {
                node.y = row * ROW;
                row++;
            }
            nodes.push(node);
            return node;
        };
        const roots = [];
        for (const tree of featureModel.trees) {
            roots.push(build(tree, 0));
            row += TREE_GAP / ROW;
        }
        const columnX = [];
        columnWidths.reduce((x, w, i) => { columnX[i] = x; return x + w + COL_GAP; }, 0);
        // Re-link: build() returned copies for alternatives; index nodes by feature id.
        const byId = new Map(nodes.map(n => [n.feature.id, n]));
        for (const n of nodes) {
            n.x = columnX[n.depth];
            n.children = n.children.map(c => Object.assign(byId.get(c.feature.id), { alternative: !!c.alternative }));
        }
        return { nodes, roots, byId };
    }

    render(featureModel) {
        const { model, checks } = this.state;
        const { nodes, byId } = this.layout(featureModel);
        const configuration = this.configuration();
        const check = configuration ? checks.get(configuration.id) : null;
        const violated = new Set(check ? check.violations.map(v => v.constraint.id) : []);
        const selectedId = this.state.selectedId;
        let edges = "", groups = "", constraintEdges = "", boxes = "";

        for (const node of nodes) {
            const px = node.x + node.w, py = node.y + node.h / 2;
            const alternatives = node.children.filter(c => c.alternative);
            for (const child of node.children) {
                const cx = child.x, cy = child.y + child.h / 2, mx = (px + cx) / 2;
                const cls = child.alternative ? "alternative" : "nested";
                edges += `<path class="dg-edge ${cls}" d="M${px},${py} C${mx},${py} ${mx},${cy} ${cx - 6},${cy}"/>`;
                if (!child.alternative) {
                    edges += `<circle class="dg-dot ${child.feature.isOptional ? "optional" : "mandatory"}" cx="${cx - 6}" cy="${cy}" r="4.5"><title>${child.feature.isOptional ? "optional" : "mandatory"}</title></circle>`;
                }
            }
            if (alternatives.length) {
                const label = chooseLabel(node.feature.multiplicity);
                const width = Math.ceil(textWidth(label, "600 11px system-ui")) + 12;
                groups += `<g class="dg-group" transform="translate(${px + 8},${py - 22})"><rect width="${width}" height="16" rx="8"/><text x="${width / 2}" y="11.5">${escapeHtml(label)}</text>`
                    + `<title>${escapeHtml(node.feature.name)} has ${alternatives.length} alternatives; a product picks ${escapeHtml(label.replace("pick ", ""))} of them</title></g>`;
            }
        }

        if (this.showConstraints) {
            const byName = new Map();
            for (const node of nodes) {
                if (!byName.has(node.feature.name)) byName.set(node.feature.name, node);
            }
            for (const node of nodes) {
                for (const constraint of node.feature.constraints) {
                    if (!constraint.operandA || !constraint.operandB) continue;
                    const sources = constraint.kind === "implies" ? constraint.operandA.map(n => byName.get(n)) : [node];
                    const targets = constraint.operandB.map(n => byName.get(n));
                    const cls = `dg-constraint ${constraint.kind}${violated.has(constraint.id) ? " violated" : ""}${constraint.id === selectedId ? " selected" : ""}`;
                    for (const source of sources) {
                        for (const target of targets) {
                            if (!source || !target || source === target) continue;
                            constraintEdges += this.constraintPath(source, target, constraint, cls);
                        }
                    }
                }
            }
        }

        for (const node of nodes) {
            const f = node.feature;
            const isTree = f.treeId === f.id;
            let state = "";
            if (check) state = check.explicit.has(f.id) ? "chosen" : check.selected.has(f.id) ? "implied" : isTree ? "chosen" : "off";
            const cls = ["dg-node", isTree ? "tree" : "", node.alternative ? "alt" : "", state, f.id === selectedId ? "selected" : ""].join(" ");
            const mark = state === "chosen" && !isTree ? "✓" : state === "implied" ? "•" : "";
            const label = `${f.name}${f.multiplicityText && !isTree ? `, multiplicity ${f.multiplicityText}` : ""}${state ? `, ${state === "off" ? "not selected" : state === "implied" ? "implied" : "selected"}` : ""}`;
            boxes += `<g class="${cls}" data-id="${escapeHtml(f.id)}" transform="translate(${node.x},${node.y})" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
                <rect width="${node.w}" height="${node.h}" rx="${isTree ? 4 : 9}"/>
                <text x="${PAD_X + (mark ? 12 : 0)}" y="${node.h / 2 + 4.5}"><tspan class="dg-name">${escapeHtml(f.name)}</tspan>${f.multiplicityText && !isTree ? `<tspan class="dg-mult" dx="6">${escapeHtml(f.multiplicityText)}</tspan>` : ""}</text>
                ${mark ? `<text class="dg-mark" x="${PAD_X - 2}" y="${node.h / 2 + 4.5}">${mark}</text>` : ""}
                <title>${escapeHtml(this.tooltip(f, state, check))}</title>
            </g>`;
        }

        this.viewport.innerHTML = `<g class="dg-edges">${edges}</g><g class="dg-constraints">${constraintEdges}</g><g>${groups}</g><g class="dg-nodes">${boxes}</g>`;
        this.applyTransform();
        this.layoutNodes = byId;
        this.renderViolations(check);
    }

    constraintPath(source, target, constraint, cls) {
        const kind = constraint.kind;
        const sx = source.x + source.w, sy = source.y + source.h / 2 + (kind === "xor" ? 6 : -6);
        const tx = target.x + target.w, ty = target.y + target.h / 2 + (kind === "xor" ? 6 : -6);
        const bulge = 40 + Math.min(160, Math.abs(ty - sy) * 0.35);
        const cx = Math.max(sx, tx) + bulge;
        const marker = kind === "xor" ? "" : ` marker-end="url(#dg-arrow-${kind})"`;
        const midY = (sy + ty) / 2, midX = cx - bulge * 0.25;
        const label = CONSTRAINT_KINDS[kind].label;
        return `<g class="${cls}" data-id="${escapeHtml(constraint.id)}">
            <path d="M${sx},${sy} C${cx},${sy} ${cx},${ty} ${tx + (kind === "xor" ? 0 : 2)},${ty}"${marker}/>
            <path class="dg-hit" d="M${sx},${sy} C${cx},${sy} ${cx},${ty} ${tx},${ty}"/>
            ${kind === "xor" ? `<circle class="dg-xor" cx="${midX}" cy="${midY}" r="6"/><path class="dg-xor-x" d="M${midX - 3.5},${midY - 3.5} L${midX + 3.5},${midY + 3.5} M${midX + 3.5},${midY - 3.5} L${midX - 3.5},${midY + 3.5}"/>` : ""}
            <title>${escapeHtml(constraint.label)}</title>
            <text class="dg-constraint-label" x="${midX + (kind === "xor" ? 10 : 4)}" y="${midY + 4}">${escapeHtml(label)}</text>
        </g>`;
    }

    tooltip(feature, state, check) {
        const lines = [feature.name];
        if (feature.treeId === feature.id) lines.push("Feature tree");
        else lines.push(feature.isOptional ? "Optional feature" : "Mandatory feature");
        if (feature.generalId) lines.push(`Alternative of ${this.state.model.get(feature.generalId)?.name || ""}`);
        for (const c of feature.constraints) lines.push(c.label);
        if (state === "implied") lines.push("Selected implicitly (by a selected nested feature or alternative)");
        if (state && check && feature.treeId !== feature.id) lines.push(state === "off" ? "Click to select" : state === "chosen" ? "Click to deselect" : "");
        return lines.filter(Boolean).join("\n");
    }

    renderViolations(check) {
        const list = this.root.querySelector(".dg-violations");
        if (!check || (!check.violations.length && !check.notes.length)) { list.hidden = true; return; }
        list.hidden = false;
        list.innerHTML = check.violations.map(v => `<li class="bad">✗ ${escapeHtml(v.message)}</li>`).join("")
            + check.notes.map(n => `<li class="note">${escapeHtml(n)}</li>`).join("");
    }

    // ---------- interaction ----------

    wire() {
        this.root.querySelector(".dg-mode").addEventListener("change", e => {
            this.configurationId = e.target.value;
            this.dispatchEvent(new CustomEvent("mode", { detail: { configurationId: this.configurationId } }));
            this.show(this.state);
        });
        this.root.querySelector(".dg-fm").addEventListener("change", e => this.selectFeatureModel(e.target.value));
        this.root.querySelector(".dg-constraints").addEventListener("change", e => {
            this.showConstraints = e.target.checked;
            this.show(this.state);
        });
        this.root.querySelector(".dg-zoom").addEventListener("click", e => {
            const zoom = e.target.closest("[data-zoom]");
            if (!zoom) return;
            if (zoom.dataset.zoom === "fit") this.fit();
            else this.zoomBy(zoom.dataset.zoom === "in" ? 1.25 : 0.8);
        });
        this.root.querySelector(".dg-actions").addEventListener("click", e => {
            const button = e.target.closest("[data-command]");
            if (!button || !this.state) return;
            const command = button.dataset.command;
            const id = command === "addConfiguration" ? this.featureModelId : this.state.selectedId;
            if (id) this.dispatchEvent(new CustomEvent("command", { detail: { command, id } }));
        });

        // Nodes: click selects (or toggles in a configuration), double-click renames.
        this.svg.addEventListener("click", e => {
            if (this.dragged) return;
            const target = e.target.closest("[data-id]");
            if (!target) return;
            this.activate(target.dataset.id);
        });
        this.svg.addEventListener("dblclick", e => {
            const node = e.target.closest(".dg-node");
            if (!node || this.configuration() || !this.state.editable) return;
            const element = this.state.model.get(node.dataset.id);
            if (element) this.dispatchEvent(new CustomEvent("command", { detail: { command: "rename", id: element.id } }));
        });
        this.svg.addEventListener("keydown", e => {
            const node = e.target.closest(".dg-node");
            if (!node) return;
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.activate(node.dataset.id); }
            else if (this.state.editable && !this.configuration() && e.key === "F2") { e.preventDefault(); this.dispatchEvent(new CustomEvent("command", { detail: { command: "rename", id: node.dataset.id } })); }
            else if (this.state.editable && !this.configuration() && e.key === "Delete") { e.preventDefault(); this.dispatchEvent(new CustomEvent("command", { detail: { command: "delete", id: node.dataset.id } })); }
        });

        // Pan with the mouse, zoom with the wheel.
        let drag = null;
        this.svg.addEventListener("pointerdown", e => {
            if (e.button !== 0) return;
            drag = { x: e.clientX, y: e.clientY, tx: this.transform.x, ty: this.transform.y, moved: false };
            this.dragged = false;
        });
        window.addEventListener("pointermove", e => {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) < 4) return;
            drag.moved = true;
            this.svg.classList.add("panning");
            this.transform.x = drag.tx + dx;
            this.transform.y = drag.ty + dy;
            this.applyTransform();
        });
        window.addEventListener("pointerup", () => {
            if (drag && drag.moved) {
                this.dragged = true;
                setTimeout(() => { this.dragged = false; }, 0);
            }
            drag = null;
            this.svg.classList.remove("panning");
        });
        this.svg.addEventListener("wheel", e => {
            e.preventDefault();
            const rect = this.svg.getBoundingClientRect();
            this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
        }, { passive: false });
        new ResizeObserver(() => { if (this.needsFit) this.fit(); }).observe(this.canvas);
    }

    activate(id) {
        const element = this.state.model.get(id);
        if (!element) return;
        const configuration = this.configuration();
        if (configuration && element.treeId !== undefined && element.treeId !== element.id) {
            if (!this.state.editable) return;
            const check = this.state.checks.get(configuration.id);
            const select = !(check && check.explicit.has(id));
            this.dispatchEvent(new CustomEvent("command", { detail: { command: "toggleSelection", id, args: { configurationId: configuration.id, select } } }));
            return;
        }
        this.dispatchEvent(new CustomEvent("select", { detail: { id } }));
    }

    zoomBy(factor, cx, cy) {
        const rect = this.svg.getBoundingClientRect();
        if (cx === undefined) { cx = rect.width / 2; cy = rect.height / 2; }
        const k = Math.min(3, Math.max(0.2, this.transform.k * factor));
        const ratio = k / this.transform.k;
        this.transform.x = cx - (cx - this.transform.x) * ratio;
        this.transform.y = cy - (cy - this.transform.y) * ratio;
        this.transform.k = k;
        this.applyTransform();
    }

    fit() {
        const rect = this.svg.getBoundingClientRect();
        if (!rect.width || !rect.height || !this.viewport.firstChild) return;
        const box = this.viewport.getBBox();
        if (!box.width || !box.height) return;
        const margin = 24;
        const k = Math.min(1.15, (rect.width - 2 * margin) / box.width, (rect.height - 2 * margin - 30) / box.height);
        this.transform.k = Math.max(0.2, k);
        this.transform.x = margin - box.x * this.transform.k;
        this.transform.y = margin - box.y * this.transform.k;
        this.applyTransform();
    }

    applyTransform() {
        const { x, y, k } = this.transform;
        this.viewport.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    }

    /** Focuses the node of an element, e.g. after it was selected elsewhere. */
    focusElement(id) {
        const node = this.viewport.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (node && node.focus) node.focus({ preventScroll: true });
    }
}
