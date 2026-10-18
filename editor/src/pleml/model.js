// PLEML domain model of the editor.
//
// The views work on this model only. It does not know where the model comes from:
// the text provider builds it from .sysml files parsed by OpenSysML, a future provider
// builds it from the elements of a SysML v2 API (Systems Modeling API) project.
//
// id            identity of the element in its source: the qualified name for text,
//               the element id (UUID) for the SysML v2 API
// qualifiedName qualified name of the element
// document      name of the document that declares the element (text sources only)

export class PlemlElement {
    constructor({ id, qualifiedName = id, name, document = "" }) {
        this.id = id;
        this.qualifiedName = qualifiedName;
        this.name = name;
        this.document = document;
    }
}

export class FeatureModel extends PlemlElement {
    constructor(props) {
        super(props);
        /** @type {FeatureTree[]} */
        this.trees = [];
        /** @type {FeatureConfiguration[]} */
        this.configurations = [];
    }
}

export class Feature extends PlemlElement {
    constructor(props) {
        super(props);
        /** Declared multiplicity { lower, upper } as strings ("0", "1", "*"), or null. */
        this.multiplicity = props.multiplicity || null;
        /** Nested features. */
        this.children = [];
        /** Features that specialize (subset) this feature: its alternatives. */
        this.alternatives = [];
        /** Id of the feature that this feature specializes, if it is an alternative. */
        this.generalId = null;
        /** Id of the feature (or tree) that owns this feature; null for a tree. */
        this.ownerFeatureId = null;
        /** Id of the feature tree of this feature (its own id for a tree). */
        this.treeId = null;
        /** Name relative to the tree, e.g. "hasPayload::gripper"; "" for a tree. */
        this.path = "";
        /** @type {FeatureConstraint[]} */
        this.constraints = [];
    }

    get isOptional() {
        return this.multiplicity !== null && this.multiplicity.lower === "0";
    }

    /** Mandatory unless the lower bound is 0; a feature without multiplicity has the default [1]. */
    get isMandatory() {
        return !this.isOptional;
    }

    /** The multiplicity as written, e.g. "0..1", or "" if none is declared. */
    get multiplicityText() {
        if (!this.multiplicity) return "";
        const { lower, upper } = this.multiplicity;
        return lower === upper ? lower : `${lower}..${upper}`;
    }

    get multiplicityLabel() {
        if (!this.multiplicity) return "";
        const { lower, upper } = this.multiplicity;
        return lower === upper ? `[${lower}]` : `[${lower}..${upper}]`;
    }
}

export class FeatureTree extends Feature {}

export class FeatureConfiguration extends PlemlElement {
    constructor(props) {
        super(props);
        /** Id and name of the feature tree that the configuration specializes. */
        this.treeId = props.treeId || "";
        this.treeName = props.treeName || "";
        /**
         * The features set in the configuration; path is the name relative to the tree ("hasPayload::gripper").
         * @type {{name: string, path: string, featureId: string, multiplicity: object|null}[]}
         */
        this.selections = [];
    }

    /** True if the configuration sets the feature, given by its name or its path relative to the tree. */
    selects(featureNameOrPath) {
        return this.selections.some(s => s.path === featureNameOrPath || s.name === featureNameOrPath);
    }
}

export const CONSTRAINT_KINDS = {
    requires: { usage: "requiresFeatures", label: "requires", operandA: "feature", operandB: "required features" },
    xor: { usage: "xorFeatures", label: "excludes", operandA: "feature", operandB: "excluded features" },
    implies: { usage: "impliesFeatures", label: "implies", operandA: "premises", operandB: "conclusions" },
};

export class FeatureConstraint extends PlemlElement {
    constructor(props) {
        super(props);
        /** "requires", "xor" or "implies" */
        this.kind = props.kind;
        this.ownerId = props.ownerId;
        /** Feature names of operand A and B, or null if they are unknown. */
        this.operandA = props.operandA || null;
        this.operandB = props.operandB || null;
    }

    get label() {
        const kind = CONSTRAINT_KINDS[this.kind];
        if (!this.operandA || !this.operandB) return kind.label + " (operands unknown)";
        const a = this.operandA.join(" and "), b = this.operandB.join(this.kind === "xor" ? " or " : " and ");
        return `${a} ${kind.label} ${b}`;
    }
}

export class PlemlModel {
    constructor() {
        /** @type {FeatureModel[]} */
        this.featureModels = [];
        /** @type {Map<string, PlemlElement>} */
        this.elements = new Map();
        /** Notes about the model that the views show, e.g. truncated symbol collection. */
        this.notes = [];
    }

    register(element) {
        this.elements.set(element.id, element);
        return element;
    }

    get(id) {
        return this.elements.get(id) || null;
    }

    /** The feature model that contains the element (or is the element). */
    featureModelOf(id) {
        return this.featureModels.find(fm => id === fm.id || id.startsWith(fm.id + "::")) || null;
    }

    /** All features of a tree in display order (alternatives before nested features), with their depth. */
    featuresOf(tree) {
        const result = [];
        const walk = (feature, depth) => {
            for (const child of [...feature.alternatives, ...feature.children]) {
                result.push({ feature: child, depth });
                walk(child, depth + 1);
            }
        };
        walk(tree, 0);
        return result;
    }

    /** The features of a tree by name; a name can occur in several places of the tree. */
    featuresByName(tree) {
        const byName = new Map();
        for (const { feature } of this.featuresOf(tree)) {
            if (!byName.has(feature.name)) byName.set(feature.name, []);
            byName.get(feature.name).push(feature);
        }
        return byName;
    }
}
