// View of the PLEML model: feature models with their feature trees, constraints and configurations.
//
// Events:
//   "select"  detail { id }                 the user picked an element (the app shows its declaration)
//   "command" detail { command, element }   the user asked for an editing command:
//             addFeature, addAlternative, addConstraint (feature or tree), addConfiguration (feature model)

import { FeatureTree } from "../pleml/model.js";

function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const KIND_SYMBOL = { requires: "→", xor: "⊗", implies: "⇒" };

export class FeatureModelView extends EventTarget {
    constructor(container) {
        super();
        this.root = container;
        this.root.classList.add("fm-view");
        this.model = null;
        this.collapsed = new Set();
        this.editable = true;
        this.root.addEventListener("click", e => this.onClick(e));
    }

    /** @param {import("../pleml/model.js").PlemlModel|null} model */
    show(model, { editable = true, message = "", selectedId = null } = {}) {
        this.model = model;
        this.editable = editable;
        this.selectedId = selectedId;
        if (!model) {
            this.root.innerHTML = `<p class="fm-empty">${escapeHtml(message || "No model checked yet.")}</p>`;
            return;
        }
        if (!model.featureModels.length) {
            this.root.innerHTML = `<p class="fm-empty">No feature model found. Insert one with <strong>Insert ▸ Feature model</strong>
                or create a file with <strong>New ▸ Feature model</strong>.</p>`;
            return;
        }
        this.root.innerHTML = model.notes.map(n => `<p class="fm-note">${escapeHtml(n)}</p>`).join("")
            + `<ul class="fm-tree" role="tree">${model.featureModels.map(fm => this.featureModelHtml(fm)).join("")}</ul>`;
    }

    featureModelHtml(fm) {
        const trees = fm.trees.map(t => this.featureHtml(t)).join("");
        const configurations = fm.configurations.map(c => this.configurationHtml(c)).join("");
        return this.itemHtml(fm, "feature-model", "featureModel", "",
            [["addConfiguration", "+ Configuration", "Add a feature configuration to this feature model"]],
            trees + (fm.configurations.length
                ? `<li class="fm-group" role="none"><span class="fm-group-label">Configurations</span><ul role="group">${configurations}</ul></li>`
                : ""));
    }

    featureHtml(feature) {
        const isTree = feature instanceof FeatureTree;
        const tag = isTree ? "featureTree" : feature.generalId ? "alternative" : feature.isOptional ? "optional" : "feature";
        const actions = [["addFeature", "+ Feature", "Add a child feature"]];
        if (!isTree) actions.push(["addAlternative", "+ Alternative", "Add an alternative that specializes this feature"]);
        actions.push(["addConstraint", "+ Constraint", "Add a REQUIRES, XOR or IMPLIES constraint owned by this feature"]);
        const constraints = feature.constraints.map(c => `
            <li role="treeitem" class="fm-item">
                <div class="fm-row fm-constraint kind-${c.kind}${c.id === this.selectedId ? " selected" : ""}">
                    <button type="button" class="fm-label" data-select="${escapeHtml(c.id)}" title="Show the constraint in the source">
                        <span class="fm-icon" aria-hidden="true">${KIND_SYMBOL[c.kind]}</span>${escapeHtml(c.label)}
                    </button>
                </div>
            </li>`).join("");
        const children = [...feature.alternatives, ...feature.children].map(f => this.featureHtml(f)).join("");
        return this.itemHtml(feature, isTree ? "feature-tree" : "feature", tag, feature.multiplicityLabel, actions, constraints + children);
    }

    configurationHtml(c) {
        const chips = c.selections.length
            ? c.selections.map(s => `<span class="fm-chip">${escapeHtml(s.path)}</span>`).join("")
            : `<span class="fm-muted">no features set</span>`;
        return `
            <li role="treeitem" class="fm-item">
                <div class="fm-row fm-configuration${c.id === this.selectedId ? " selected" : ""}">
                    <button type="button" class="fm-label" data-select="${escapeHtml(c.id)}" title="Show the configuration in the source">
                        <span class="fm-badge tag-featureConfiguration">config</span>${escapeHtml(c.name)}
                        ${c.treeName ? `<span class="fm-muted">of ${escapeHtml(c.treeName)}</span>` : ""}
                    </button>
                </div>
                <div class="fm-chips">${chips}</div>
            </li>`;
    }

    itemHtml(element, cls, tag, suffix, actions, childrenHtml) {
        const id = escapeHtml(element.id);
        const collapsed = this.collapsed.has(element.id);
        const toggle = childrenHtml
            ? `<button type="button" class="fm-toggle" data-toggle="${id}" aria-label="${collapsed ? "Expand" : "Collapse"}" aria-expanded="${!collapsed}">${collapsed ? "▸" : "▾"}</button>`
            : `<span class="fm-toggle-spacer"></span>`;
        const actionsHtml = this.editable
            ? `<span class="fm-actions">${actions.map(([command, label, title]) =>
                `<button type="button" class="fm-action" data-command="${command}" data-id="${id}" title="${escapeHtml(title)}">${escapeHtml(label)}</button>`).join("")}</span>`
            : "";
        const labels = { featureModel: "model", featureTree: "tree", feature: "feature", optional: "optional", alternative: "alt" };
        return `
            <li role="treeitem" class="fm-item ${cls}" aria-expanded="${childrenHtml ? !collapsed : ""}">
                <div class="fm-row${element.id === this.selectedId ? " selected" : ""}">
                    ${toggle}
                    <button type="button" class="fm-label" data-select="${id}" title="Show the declaration in the source">
                        <span class="fm-badge tag-${tag}">${labels[tag]}</span>${escapeHtml(element.name)}
                        ${suffix ? `<span class="fm-muted">${escapeHtml(suffix)}</span>` : ""}
                    </button>
                    ${actionsHtml}
                </div>
                ${childrenHtml && !collapsed ? `<ul role="group">${childrenHtml}</ul>` : ""}
            </li>`;
    }

    onClick(e) {
        const toggle = e.target.closest("[data-toggle]");
        if (toggle) {
            const id = toggle.dataset.toggle;
            if (this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id);
            this.show(this.model, { editable: this.editable, selectedId: this.selectedId });
            return;
        }
        const action = e.target.closest("[data-command]");
        if (action && this.model) {
            this.dispatchEvent(new CustomEvent("command", {
                detail: { command: action.dataset.command, element: this.model.get(action.dataset.id) },
            }));
            return;
        }
        const select = e.target.closest("[data-select]");
        if (select) this.dispatchEvent(new CustomEvent("select", { detail: { id: select.dataset.select } }));
    }
}
