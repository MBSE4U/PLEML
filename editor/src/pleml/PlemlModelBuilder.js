// Builds the PLEML domain model from the symbols of the OpenSysML engine.
//
// PLEML elements are recognized by what the engine reports about them:
// - a feature (also a tree or a configuration) inherits the attribute bindingTime : PLEML::LifeCycleKind
// - a feature tree subsets featureTrees (or specializes PLEML::FeatureTree)
// - a feature configuration subsets featureConfigurations (or specializes PLEML::FeatureConfiguration)
// - a feature model is the owner of feature trees and configurations (or specializes PLEML::FeatureModel)
// - a feature constraint redefines requiresFeatures, xorFeatures or impliesFeatures
// - a feature that subsets a sibling feature is an alternative of it
//
// The keywords (#feature, ...) themselves are not reported by the engine, so the builder relies on
// these semantic facts. The source-specific parts are passed in as hooks:
//   documentOf(id)                      -> name of the declaring document
//   readOperands(constraintId, ownerName) -> { a: string[], b: string[] } | null

import {
    PlemlModel, FeatureModel, Feature, FeatureTree, FeatureConfiguration, FeatureConstraint, CONSTRAINT_KINDS,
} from "./model.js";

const USAGE_TO_KIND = Object.fromEntries(Object.entries(CONSTRAINT_KINDS).map(([kind, k]) => [k.usage, kind]));

function lastSegment(id) {
    const i = id.lastIndexOf("::");
    return i < 0 ? id : id.slice(i + 2);
}

function ownerOf(id) {
    const i = id.lastIndexOf("::");
    return i < 0 ? "" : id.slice(0, i);
}

function targets(symbol, kinds) {
    return (symbol.specializations || [])
        .filter(s => !kinds || kinds.includes(s.kind))
        .map(s => s.targetId || s.declared || "");
}

export function isFeatureLike(symbol) {
    return (symbol.attributes || []).some(a => a.name === "bindingTime" && /(^|::)LifeCycleKind$/.test(a.type || ""));
}

export function isFeatureTree(symbol) {
    return targets(symbol).some(t => /(^|::)featureTrees$/.test(t) || t === "PLEML::FeatureTree");
}

export function isFeatureConfiguration(symbol) {
    return targets(symbol).some(t => /(^|::)featureConfigurations$/.test(t) || t === "PLEML::FeatureConfiguration");
}

export function isFeatureModel(symbol) {
    return targets(symbol).some(t => /(^|::)featureModels$/.test(t) || t === "PLEML::FeatureModel");
}

export function constraintKind(symbol) {
    if (symbol.kind !== "constraintUsage") return null;
    for (const t of targets(symbol, ["redefines", "subsets"])) {
        const kind = USAGE_TO_KIND[lastSegment(t)];
        if (kind) return kind;
    }
    return USAGE_TO_KIND[symbol.name] || null;
}

/**
 * @param {Object<string, object>} symbols the engine symbols by qualified name
 * @param {{documentOf?: function, readOperands?: function, truncated?: boolean}} hooks
 * @returns {PlemlModel}
 */
export function buildPlemlModel(symbols, { documentOf = () => "", readOperands = () => null, truncated = false } = {}) {
    const model = new PlemlModel();
    if (truncated) model.notes.push("The model is large: only part of it was read.");
    const get = id => symbols[id] || null;
    const props = s => ({ id: s.id, name: s.name, document: documentOf(s.id) });

    // Feature models: owners of trees and configurations, and explicit feature models.
    const featureModelIds = [];
    for (const symbol of Object.values(symbols)) {
        const isTreeOrConfiguration = isFeatureLike(symbol) && (isFeatureTree(symbol) || isFeatureConfiguration(symbol));
        const candidate = isTreeOrConfiguration ? ownerOf(symbol.id) : isFeatureModel(symbol) ? symbol.id : null;
        if (candidate && get(candidate) && !featureModelIds.includes(candidate)) featureModelIds.push(candidate);
    }

    const buildFeature = (symbol, FeatureClass, owner = null) => {
        const feature = model.register(new FeatureClass({ ...props(symbol), multiplicity: symbol.multiplicity || null }));
        feature.ownerFeatureId = owner ? owner.id : null;
        feature.treeId = owner ? owner.treeId : feature.id;
        feature.path = owner ? symbol.id.slice(feature.treeId.length + 2) : "";
        const children = [];
        for (const childId of symbol.childIds || []) {
            const child = get(childId);
            if (!child) continue;
            const kind = constraintKind(child);
            if (kind) {
                const operands = readOperands(child.id, feature.name);
                feature.constraints.push(model.register(new FeatureConstraint({
                    ...props(child), kind, ownerId: feature.id,
                    operandA: operands && operands.a, operandB: operands && operands.b,
                })));
            } else if (isFeatureLike(child)) {
                children.push(buildFeature(child, Feature, feature));
            }
        }
        // A feature that subsets a sibling feature is one of its alternatives.
        const siblings = new Map(children.map(c => [c.id, c]));
        for (const child of children) {
            const general = targets(get(child.id), ["subsets", "specializes"]).find(t => siblings.has(t) && t !== child.id);
            if (general) {
                child.generalId = general;
                siblings.get(general).alternatives.push(child);
            }
        }
        feature.children = children.filter(c => !c.generalId);
        return feature;
    };

    for (const id of featureModelIds) {
        const owner = get(id);
        const featureModel = model.register(new FeatureModel(props(owner)));
        for (const childId of owner.childIds || []) {
            const child = get(childId);
            if (!child || !isFeatureLike(child)) continue;
            if (isFeatureConfiguration(child)) {
                const treeId = targets(child, ["subsets", "specializes", "typing"]).find(t => get(t) && isFeatureTree(get(t))) || "";
                const configuration = model.register(new FeatureConfiguration({
                    ...props(child), treeId, treeName: treeId ? lastSegment(treeId) : "",
                }));
                // Features set in the configuration, nested ones inside the redefinition of their parent.
                const collect = (symbol, prefix) => {
                    for (const selectedId of symbol.childIds || []) {
                        const selected = get(selectedId);
                        if (!selected || !isFeatureLike(selected)) continue;
                        if (selected.multiplicity && selected.multiplicity.upper === "0") continue;
                        const path = prefix ? `${prefix}::${selected.name}` : selected.name;
                        configuration.selections.push({
                            name: selected.name, path,
                            featureId: targets(selected, ["redefines"])[0] || "",
                            multiplicity: selected.multiplicity || null,
                        });
                        collect(selected, path);
                    }
                };
                collect(child, "");
                featureModel.configurations.push(configuration);
            } else if (isFeatureTree(child)) {
                featureModel.trees.push(buildFeature(child, FeatureTree));
            }
        }
        model.featureModels.push(featureModel);
    }
    return model;
}
