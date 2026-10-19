# Change Log

## v1.1.1

Same content as v1.1.0, republished with LF line endings.

- Fixed the line endings of the package: the v1.1.0 package on the Sysand index contained `PLEML.sysml`, `README.md` and `CHANGELOG.md` with Windows (CRLF) line endings, so its checksums differed from the git tag. The library itself is unchanged.
- Added `.gitattributes` to keep LF line endings on every platform, also in Windows working trees, and normalized the example models to LF.
- The release workflow now checks that the files in the built `.kpar` package are byte-identical to the committed files.

## v1.1.0

- Breaking: all feature constraints now have the same parameters: `constrainedFeatures` of the new type `FeatureOperand` with the operands `operandA` and `operandB`, and `featureConfiguration`. The specific features (`owningFeature`, `requiredFeatures`, `excluded`, `premises`, `conclusions`) are derived from the operands. Set the operands with `in occurrence constrainedFeatures = new FeatureOperand(that, d);` instead of redefining `requiredFeatures` or `excluded`. `FeatureConstraint` no longer has the parameter `owningFeature`.
- Added `ImpliesConstraint` (usage `Feature::impliesFeatures`) for constraints with several premises (operand A) and conclusions (operand B), e.g., `new FeatureOperand((e, f), g)` for `(e and f) implies g`. The owning feature is only the container, list it in operand A if it is a premise.
- Removed `featureSet`. A default selected feature is now created with `new`, e.g., `default new standardMission()`.
- Added test configurations for `ImpliesConstraint` to `Test/PLEML-Test-Constraints.sysml` and updated the tests to the new constraint parameters.
- Updated the Drone product line example to the new constraint parameters.
- Updated the README to the new constraint parameters.

## v1.0.0

First stable release, published on GitHub and Sysand.

- Moved `PLEML.sysml` from the `PLEML/` folder to the repository root.
- Added `doc` comments to all elements of the library: feature model, tree, feature, configuration, constraints, binding times, keywords, binding metadata, and `DeriveFeatureName`.
- Added the `name` attribute to `Feature`; `DeriveFeatureName` casts the supplier to `Feature` to read it.
- Fixed `XORConstraint`: it now checks that none of the excluded features is part of the feature configuration (previously it iterated over an index range).
- Added Sysand packaging (`.project.json`, `.meta.json`, `LICENSES/MIT.txt`) and a GitHub workflow that builds the `.kpar` package and creates a GitHub release for every `v*` tag.
- Rewrote the README.
