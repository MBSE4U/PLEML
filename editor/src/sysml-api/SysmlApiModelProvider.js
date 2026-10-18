// Model provider and model editor for a SysML v2 API project (prepared, not implemented yet).
//
// They have the same interfaces as TextModelProvider and TextModelEditor, so the views
// (feature model outline, problems, dialogs) work unchanged when the model comes from an API server:
//
//   provider.load()  -> { model: PlemlModel, diagnostics: [], locate(id) }
//   editor.addFeature / addConstraint / addConfiguration  -> a commit instead of a text edit
//
// Planned mapping from API elements (JSON, "@type" = metaclass) to the PLEML domain model:
//   Feature model   OccurrenceDefinition/Usage owning feature trees and configurations
//   Feature         OccurrenceUsage whose type conforms to PLEML::Feature (via its Specialization,
//                   Subsetting and the semantic metadata #feature, i.e. a MetadataUsage of FeatureMetadata)
//   Alternatives    Subsetting between sibling features
//   Constraint      ConstraintUsage redefining PLEML::Feature::requiresFeatures / xorFeatures / impliesFeatures;
//                   operands from the FeatureValue of constrainedFeatures (an InstantiationExpression of FeatureOperand)
//   Configuration   OccurrenceUsage subsetting featureConfigurations; selections are its redefining features
// The element id is the API's @id (UUID); qualifiedName is the element's qualifiedName.
// The PLEML library elements must be available to the project (e.g. as a project usage) to resolve the types.
//
// Alternative route: let the OpenSysML service (sysml-grpc, @openmbee/opensysml) convert between
// "api-json" and "sysml" and keep the text-based editor. The WebAssembly engine does not serve conversion.

export class NotImplementedError extends Error {
    constructor(what) {
        super(`${what} is planned for a future version of the PLEML editor.`);
        this.name = "NotImplementedError";
    }
}

export class SysmlApiModelProvider {
    /**
     * @param {import("./SysmlApiClient.js").SysmlApiClient} client
     * @param {{projectId: string, commitId: string}} target
     */
    constructor(client, { projectId, commitId }) {
        this.client = client;
        this.projectId = projectId;
        this.commitId = commitId;
    }

    async load() {
        // 1. const elements = await this.client.getElements(this.projectId, this.commitId);
        // 2. index elements by @id, resolve ownership (owningRelatedElement / ownedRelatedElement)
        // 3. map to the PLEML domain model as described above
        throw new NotImplementedError("Reading feature models from a SysML v2 API server");
    }
}

export class SysmlApiModelEditor {
    constructor(client, { projectId, branchId }) {
        this.client = client;
        this.projectId = projectId;
        this.branchId = branchId;
    }

    // Each command creates the new elements and relationships as DataVersion changes and posts them
    // with client.postCommit(projectId, { change, previousCommitId }, branchId).
    async addFeature() { throw new NotImplementedError("Adding features via the SysML v2 API"); }
    async addConstraint() { throw new NotImplementedError("Adding constraints via the SysML v2 API"); }
    async addConfiguration() { throw new NotImplementedError("Adding configurations via the SysML v2 API"); }
}
