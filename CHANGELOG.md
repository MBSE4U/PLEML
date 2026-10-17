# Change Log

## v1.0.0

First stable release, published on GitHub and Sysand.

- Moved `PLEML.sysml` from the `PLEML/` folder to the repository root.
- Added `doc` comments to all elements of the library: feature model, tree, feature, configuration, constraints, binding times, keywords, binding metadata, and `DeriveFeatureName`.
- Added the `name` attribute to `Feature`; `DeriveFeatureName` casts the supplier to `Feature` to read it.
- Fixed `XORConstraint`: it now checks that none of the excluded features is part of the feature configuration (previously it iterated over an index range).
- Added Sysand packaging (`.project.json`, `.meta.json`, `LICENSES/MIT.txt`) and a GitHub workflow that builds the `.kpar` package and creates a GitHub release for every `v*` tag.
- Rewrote the README.
