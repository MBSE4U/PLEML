// Form-based editor: the selected PLEML element as a form.
//
// - Feature model: its trees and the configuration matrix (features × configurations), where a
//   checkbox selects or deselects a feature in a configuration
// - Feature: name, kind (mandatory/optional), alternatives, nested features, constraints and
//   the configurations that select it
// - Feature configuration: its feature checklist and the result of the constraint check
// - Constraint: its kind and operands
//
// Events: "select" { id }, "command" { command, id, args }, "reveal" { id }

import { FeatureModel, FeatureTree, Feature, FeatureConfiguration, FeatureConstraint, CONSTRAINT_KINDS } from "../pleml/model.js";

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const KINDS = [
    { value: "1", label: "Mandatory", hint: "every product has it" },
    { value: "0..1", label: "Optional", hint: "a product may have it" },
    { value: "1..*", label: "One or more", hint: "at least one value" },
    { value: "0..*", label: "Any number", hint: "zero or more values" },
];

export class FormView extends EventTarget {
    constructor(container) {
        super();
        this.root = container;
        this.root.classList.add("form-view");
        this.state = null;
        this.root.addEventListener("click", e => this.onClick(e));
        this.root.addEventListener("change", e => this.onChange(e));
        this.root.addEventListener("input", e => {
            if (e.target.matches("[data-rename-input]")) {
                const button = this.root.querySelector("[data-rename]");
                if (button) button.disabled = !e.target.value.trim() || e.target.value.trim() === e.target.dataset.original;
            }
        });
        this.root.addEventListener("keydown", e => {
            if (e.key === "Enter" && e.target.matches("[data-rename-input]")) {
                e.preventDefault();
                this.rename(e.target);
            }
        });
    }

    /** @param {{model, checks: Map, selectedId: string|null, editable: boolean, message?: string}} state */
    show(state) {
        this.state = state;
        const { model } = state;
        if (!model) {
            this.root.innerHTML = `<div class="fv-empty">${escapeHtml(state.message || "Waiting for the model check…")}</div>`;
            return;
        }
        let element = state.selectedId ? model.get(state.selectedId) : null;
        if (!element && model.featureModels.length) element = model.featureModels[0];
        if (!element) {
            this.root.innerHTML = `<div class="fv-empty"><p>No feature model yet.</p>
                <p>Create one with <strong>File ▸ New feature model</strong>, open a file, or try <strong>Examples</strong>.</p></div>`;
            return;
        }
        const focused = document.activeElement && this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
        const body = element instanceof FeatureModel ? this.featureModelForm(element)
            : element instanceof FeatureConfiguration ? this.configurationForm(element)
                : element instanceof FeatureConstraint ? this.constraintForm(element)
                    : this.featureForm(element);
        this.root.innerHTML = `<div class="fv-page">${this.breadcrumb(element)}${body}</div>`;
        if (focused) {
            const again = this.root.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`);
            if (again) again.focus({ preventScroll: true });
        }
    }

    // ---------- pages ----------

    breadcrumb(element) {
        const { model } = this.state;
        const chain = [];
        for (let e = element; e; ) {
            chain.unshift(e);
            if (e instanceof FeatureModel) break;
            const ownerId = e instanceof FeatureConstraint ? e.ownerId
                : e instanceof Feature && e.ownerFeatureId ? e.ownerFeatureId
                    : (model.featureModelOf(e.id) || {}).id;
            e = ownerId && ownerId !== e.id ? model.get(ownerId) : null;
        }
        return `<nav class="fv-crumbs" aria-label="Location">${chain.map((e, i) => i === chain.length - 1
            ? `<span aria-current="page">${escapeHtml(e.name || "constraint")}</span>`
            : `<button type="button" class="fv-link" data-select="${escapeHtml(e.id)}">${escapeHtml(e.name)}</button>`).join('<span class="fv-sep">›</span>')}</nav>`;
    }

    header(element, kindLabel, renameable = true) {
        const editable = this.state.editable && renameable;
        return `<header class="fv-header">
            <span class="fv-kind">${escapeHtml(kindLabel)}</span>
            ${editable
                ? `<div class="fv-rename"><label class="sr-only" for="fv-name">Name</label>
                    <input id="fv-name" class="fv-name-input" data-rename-input data-focus-key="name" data-original="${escapeHtml(element.name)}" value="${escapeHtml(element.name)}" spellcheck="false" autocomplete="off">
                    <button type="button" data-rename disabled>Rename</button></div>`
                : `<h2 class="fv-title">${escapeHtml(element.name || CONSTRAINT_KINDS[element.kind]?.label || "")}</h2>`}
            <span class="fv-source">${escapeHtml(element.document || "")}
                <button type="button" class="fv-link" data-reveal="${escapeHtml(element.id)}">Show in text</button></span>
        </header>`;
    }

    featureModelForm(fm) {
        const { model, checks, editable } = this.state;
        const configurations = fm.configurations;
        const trees = fm.trees.map(tree => {
            const rows = model.featuresOf(tree);
            const headerCells = configurations.map(c => {
                const check = checks.get(c.id);
                const count = check ? check.violations.length : 0;
                return `<th scope="col"><button type="button" class="fv-link" data-select="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>
                    <span class="fv-badge ${count ? "bad" : "ok"}" title="${escapeHtml(count ? check.violations.map(v => v.message).join("\n") : "All constraints satisfied")}">${count ? `✗ ${count}` : "✓"}</span></th>`;
            }).join("");
            const body = rows.map(({ feature, depth }) => `<tr>
                <th scope="row" style="padding-left:${0.5 + depth * 1.1}rem">${this.featureLabel(feature)}</th>
                ${configurations.map(c => this.selectionCell(c, feature)).join("")}
            </tr>`).join("");
            return `<section class="fv-section">
                <h3>Feature tree <button type="button" class="fv-link" data-select="${escapeHtml(tree.id)}">${escapeHtml(tree.name)}</button>
                    <span class="fv-count">${rows.length} feature${rows.length === 1 ? "" : "s"}</span></h3>
                ${editable ? `<div class="fv-buttons">
                    <button type="button" data-command="addFeature" data-id="${escapeHtml(tree.id)}">+ Feature</button>
                    <button type="button" data-command="addConfiguration" data-id="${escapeHtml(fm.id)}">+ Configuration</button></div>` : ""}
                ${configurations.length || rows.length ? `<div class="fv-matrix-wrap"><table class="fv-matrix">
                    <caption>Configurations: which product has which feature${configurations.length ? "" : " (no configuration yet)"}</caption>
                    <thead><tr><th scope="col">Feature</th>${headerCells}</tr></thead>
                    <tbody>${body}</tbody></table></div>` : ""}
            </section>`;
        }).join("");
        const legend = configurations.length
            ? `<p class="fv-note">☑ set by the configuration · <span class="fv-implied-sample">●</span> implied by a selected nested feature or alternative.
               The constraint check (✓/✗) is done by the PLEML editor; OpenSysML checks the SysML.</p>` : "";
        return this.header(fm, "Feature model", false) + trees + legend;
    }

    featureLabel(feature) {
        const tag = feature.generalId ? "alt" : feature.isOptional ? "optional" : "mandatory";
        return `<button type="button" class="fv-link fv-feature" data-select="${escapeHtml(feature.id)}">
            <span class="fv-tag ${tag}">${tag === "alt" ? "alt" : tag === "optional" ? "opt" : "man"}</span>${escapeHtml(feature.name)}</button>`;
    }

    selectionCell(configuration, feature) {
        const check = this.state.checks.get(configuration.id);
        const explicit = check && check.explicit.has(feature.id);
        const implied = !explicit && check && check.selected.has(feature.id);
        const label = `${feature.name} in ${configuration.name}`;
        return `<td class="${implied ? "implied" : ""}"><input type="checkbox" data-toggle-config="${escapeHtml(configuration.id)}" data-feature="${escapeHtml(feature.id)}"
            data-focus-key="cell:${escapeHtml(configuration.id)}:${escapeHtml(feature.id)}"
            ${explicit ? "checked" : ""} ${this.state.editable ? "" : "disabled"} aria-label="${escapeHtml(label)}"
            title="${escapeHtml(implied ? `${label}: implied by a selected nested feature or alternative. Check to set it explicitly.` : label)}">${implied ? '<span class="fv-implied" aria-hidden="true">●</span>' : ""}</td>`;
    }

    featureForm(feature) {
        const { model, editable } = this.state;
        const isTree = feature instanceof FeatureTree;
        const fm = model.featureModelOf(feature.id);
        const general = feature.generalId ? model.get(feature.generalId) : null;
        const link = f => `<button type="button" class="fv-link fv-chip" data-select="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`;
        const list = (items, empty) => (items.length ? `<div class="fv-chips">${items.map(link).join("")}</div>` : `<p class="fv-muted">${empty}</p>`);
        const current = feature.multiplicityText;
        const custom = current && !KINDS.some(k => k.value === current);
        const kinds = isTree ? "" : `<fieldset class="fv-section"><legend>Kind</legend><div class="fv-kinds">
            ${KINDS.map(k => `<label class="fv-radio"><input type="radio" name="kind" value="${k.value}" data-focus-key="kind:${k.value}"
                ${(current || "1") === k.value ? "checked" : ""} ${editable ? "" : "disabled"}>
                <span><strong>${k.label}</strong> <span class="fv-muted">[${k.value}] ${k.hint}</span></span></label>`).join("")}
            </div>${custom ? `<p class="fv-muted">Declared multiplicity: [${escapeHtml(current)}]</p>` : ""}
        </fieldset>`;
        const constraints = feature.constraints.map(c => `<li>
            <button type="button" class="fv-link" data-select="${escapeHtml(c.id)}"><span class="fv-ckind ${c.kind}">${escapeHtml(CONSTRAINT_KINDS[c.kind].label)}</span> ${escapeHtml(c.label)}</button>
            ${editable ? `<button type="button" class="fv-remove" data-command="delete" data-id="${escapeHtml(c.id)}" aria-label="Remove constraint ${escapeHtml(c.label)}">Remove</button>` : ""}
        </li>`).join("");
        const configurations = fm && !isTree ? fm.configurations.filter(c => c.treeId === feature.treeId) : [];
        const selections = configurations.map(c => {
            const check = this.state.checks.get(c.id);
            const explicit = check && check.explicit.has(feature.id);
            const implied = !explicit && check && check.selected.has(feature.id);
            return `<label class="fv-check"><input type="checkbox" data-toggle-config="${escapeHtml(c.id)}" data-feature="${escapeHtml(feature.id)}" data-focus-key="sel:${escapeHtml(c.id)}"
                ${explicit ? "checked" : ""} ${editable ? "" : "disabled"}> ${escapeHtml(c.name)}${implied ? ' <span class="fv-muted">(implied)</span>' : ""}</label>`;
        }).join("");

        return this.header(feature, isTree ? "Feature tree" : general ? "Alternative feature" : "Feature")
            + (general ? `<p class="fv-line">Alternative of ${link(general)} — a product with ${escapeHtml(feature.name)} has ${escapeHtml(general.name)}.</p>` : "")
            + kinds
            + `<section class="fv-section"><h3>Alternatives</h3>${list(feature.alternatives, isTree ? "A tree has no alternatives." : "No alternatives.")}
                ${editable && !isTree ? `<div class="fv-buttons"><button type="button" data-command="addAlternative" data-id="${escapeHtml(feature.id)}">+ Alternative</button></div>` : ""}</section>`
            + `<section class="fv-section"><h3>Nested features</h3>${list(feature.children, "No nested features.")}
                ${editable ? `<div class="fv-buttons"><button type="button" data-command="addFeature" data-id="${escapeHtml(feature.id)}">+ Feature</button></div>` : ""}</section>`
            + `<section class="fv-section"><h3>Constraints</h3>${constraints ? `<ul class="fv-constraints">${constraints}</ul>` : '<p class="fv-muted">No constraints.</p>'}
                ${editable ? `<div class="fv-buttons"><button type="button" data-command="addConstraint" data-id="${escapeHtml(feature.id)}">+ Constraint</button></div>` : ""}</section>`
            + (configurations.length ? `<section class="fv-section"><h3>Selected in configurations</h3><div class="fv-checks">${selections}</div></section>` : "")
            + (editable && !isTree ? `<section class="fv-section fv-danger"><button type="button" data-command="delete" data-id="${escapeHtml(feature.id)}">Delete feature</button></section>` : "");
    }

    configurationForm(configuration) {
        const { model, checks, editable } = this.state;
        const tree = model.get(configuration.treeId);
        const check = checks.get(configuration.id);
        const status = check
            ? (check.violations.length
                ? `<div class="fv-status bad" role="status"><strong>✗ ${check.violations.length} constraint violation${check.violations.length === 1 ? "" : "s"}</strong>
                    <ul>${check.violations.map(v => `<li><button type="button" class="fv-link" data-select="${escapeHtml(v.constraint.id)}">${escapeHtml(v.message)}</button></li>`).join("")}</ul></div>`
                : `<div class="fv-status ok" role="status"><strong>✓ All constraints satisfied</strong></div>`)
            : "";
        const notes = check && check.notes.length ? `<ul class="fv-notes">${check.notes.map(n => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "";
        const rows = tree ? model.featuresOf(tree).map(({ feature, depth }) => {
            const explicit = check && check.explicit.has(feature.id);
            const implied = !explicit && check && check.selected.has(feature.id);
            return `<label class="fv-check" style="padding-left:${depth * 1.2}rem">
                <input type="checkbox" data-toggle-config="${escapeHtml(configuration.id)}" data-feature="${escapeHtml(feature.id)}" data-focus-key="sel:${escapeHtml(feature.id)}"
                ${explicit ? "checked" : ""} ${editable ? "" : "disabled"}>
                ${escapeHtml(feature.name)} ${feature.generalId ? '<span class="fv-tag alt">alt</span>' : feature.isOptional ? '<span class="fv-tag optional">opt</span>' : ""}
                ${implied ? '<span class="fv-muted">(implied)</span>' : ""}</label>`;
        }).join("") : `<p class="fv-muted">The feature tree of this configuration is unknown.</p>`;
        return this.header(configuration, "Feature configuration")
            + `<p class="fv-line">Configures ${tree ? `<button type="button" class="fv-link" data-select="${escapeHtml(tree.id)}">${escapeHtml(tree.name)}</button>` : "an unknown tree"}.</p>`
            + status + notes
            + `<section class="fv-section"><h3>Features</h3><div class="fv-checks fv-tree-checks">${rows}</div>
                <p class="fv-note">Selecting a nested feature or an alternative implies its parent or general feature.</p></section>`
            + (editable ? `<section class="fv-section fv-danger"><button type="button" data-command="delete" data-id="${escapeHtml(configuration.id)}">Delete configuration</button></section>` : "");
    }

    constraintForm(constraint) {
        const { model, editable } = this.state;
        const owner = model.get(constraint.ownerId);
        const kind = CONSTRAINT_KINDS[constraint.kind];
        const names = list => (list ? list.map(n => `<span class="fv-chip static">${escapeHtml(n)}</span>`).join("") : '<span class="fv-muted">unknown</span>');
        return this.header({ ...constraint, name: `${constraint.kind.toUpperCase()} constraint` }, "Constraint", false)
            + `<p class="fv-line fv-big">${escapeHtml(constraint.label)}</p>
               <dl class="fv-dl">
                 <dt>Owned by</dt><dd>${owner ? `<button type="button" class="fv-link" data-select="${escapeHtml(owner.id)}">${escapeHtml(owner.name)}</button>` : "—"}</dd>
                 <dt>${escapeHtml(kind.operandA)} (operand A)</dt><dd><div class="fv-chips">${names(constraint.operandA)}</div></dd>
                 <dt>${escapeHtml(kind.operandB)} (operand B)</dt><dd><div class="fv-chips">${names(constraint.operandB)}</div></dd>
               </dl>`
            + (editable ? `<section class="fv-section fv-danger"><button type="button" data-command="delete" data-id="${escapeHtml(constraint.id)}">Remove constraint</button></section>` : "");
    }

    // ---------- events ----------

    onClick(e) {
        const command = e.target.closest("[data-command]");
        if (command) {
            this.dispatchEvent(new CustomEvent("command", { detail: { command: command.dataset.command, id: command.dataset.id } }));
            return;
        }
        if (e.target.closest("[data-rename]")) { this.rename(this.root.querySelector("[data-rename-input]")); return; }
        const reveal = e.target.closest("[data-reveal]");
        if (reveal) { this.dispatchEvent(new CustomEvent("reveal", { detail: { id: reveal.dataset.reveal } })); return; }
        const select = e.target.closest("[data-select]");
        if (select) this.dispatchEvent(new CustomEvent("select", { detail: { id: select.dataset.select } }));
    }

    onChange(e) {
        const target = e.target;
        if (target.matches("[data-toggle-config]")) {
            this.dispatchEvent(new CustomEvent("command", { detail: {
                command: "toggleSelection", id: target.dataset.feature,
                args: { configurationId: target.dataset.toggleConfig, select: target.checked },
            } }));
        } else if (target.name === "kind" && target.checked) {
            this.dispatchEvent(new CustomEvent("command", { detail: { command: "setMultiplicity", id: this.state.selectedId || "", args: { multiplicity: target.value } } }));
        }
    }

    rename(input) {
        if (!input) return;
        const name = input.value.trim();
        if (!name || name === input.dataset.original) return;
        const element = this.state.selectedId ? this.state.model.get(this.state.selectedId) : null;
        if (element) this.dispatchEvent(new CustomEvent("command", { detail: { command: "rename", id: element.id, args: { newName: name } } }));
    }
}
