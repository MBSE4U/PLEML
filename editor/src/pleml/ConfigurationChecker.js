// Checks a feature configuration against the feature constraints of its tree.
//
// This is the editor's own evaluation of the PLEML semantics on the domain model. The OpenSysML
// engine checks syntax, names and SysML rules, but does not evaluate the feature constraints.
//
// Selection: the features that the configuration sets, plus what they imply:
// - the owning feature of a selected nested feature
// - the general feature of a selected alternative (an alternative specializes its general feature)
// Constraints:
// - REQUIRES  owner selected                implies all required features selected
// - XOR       owner selected                implies no excluded feature selected
// - IMPLIES   all premises selected         implies all conclusions selected

export function checkConfiguration(model, configuration) {
    const tree = model.get(configuration.treeId);
    const result = { explicit: new Set(), selected: new Set(), violations: [], notes: [] };
    if (!tree) {
        result.notes.push(`The feature tree of ${configuration.name} is unknown.`);
        return result;
    }

    // Features set by the configuration.
    for (const selection of configuration.selections) {
        const feature = model.get(selection.featureId) || model.get(`${tree.id}::${selection.path}`);
        if (feature) result.explicit.add(feature.id);
        else result.notes.push(`${selection.path} is not a feature of ${tree.name}.`);
    }

    // Closure: owners and general features of selected features.
    const add = id => {
        if (!id || id === tree.id || result.selected.has(id)) return;
        const feature = model.get(id);
        if (!feature) return;
        result.selected.add(id);
        add(feature.ownerFeatureId);
        add(feature.generalId);
    };
    result.explicit.forEach(add);

    const byName = model.featuresByName(tree);
    const resolve = name => {
        const candidates = byName.get(name) || [];
        return candidates.length ? candidates[0].id : null;
    };
    const isSelected = id => result.selected.has(id);
    const nameOf = id => (model.get(id) || { name: id }).name;

    for (const { feature } of [{ feature: tree }, ...model.featuresOf(tree)]) {
        for (const constraint of feature.constraints) {
            if (!constraint.operandA || !constraint.operandB) {
                result.notes.push(`The operands of a constraint of ${feature.name} are unknown; it was not checked.`);
                continue;
            }
            const b = constraint.operandB.map(resolve);
            if (b.includes(null)) {
                result.notes.push(`${constraint.label}: a feature was not found; the constraint was not checked.`);
                continue;
            }
            if (constraint.kind === "requires") {
                const missing = b.filter(id => !isSelected(id));
                if (isSelected(feature.id) && missing.length) {
                    result.violations.push({ constraint, message: `${feature.name} requires ${missing.map(nameOf).join(", ")}, which ${missing.length === 1 ? "is" : "are"} not selected.` });
                }
            } else if (constraint.kind === "xor") {
                const present = b.filter(isSelected);
                if (isSelected(feature.id) && present.length) {
                    result.violations.push({ constraint, message: `${feature.name} excludes ${present.map(nameOf).join(", ")}, but ${present.length === 1 ? "it is" : "they are"} selected.` });
                }
            } else if (constraint.kind === "implies") {
                const a = constraint.operandA.map(resolve);
                if (a.includes(null)) {
                    result.notes.push(`${constraint.label}: a premise was not found; the constraint was not checked.`);
                    continue;
                }
                const missing = b.filter(id => !isSelected(id));
                if (a.every(isSelected) && missing.length) {
                    result.violations.push({ constraint, message: `${a.map(nameOf).join(" and ")} imply ${missing.map(nameOf).join(", ")}, which ${missing.length === 1 ? "is" : "are"} not selected.` });
                }
            }
        }
    }
    return result;
}

/** Checks all configurations of the model. @returns {Map<string, object>} by configuration id */
export function checkAllConfigurations(model) {
    const results = new Map();
    for (const featureModel of model.featureModels) {
        for (const configuration of featureModel.configurations) results.set(configuration.id, checkConfiguration(model, configuration));
    }
    return results;
}
