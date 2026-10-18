# PLEML Library for SysML v2

SysML v2 library for Model-Based Product Line Engineering (MBPLE). **PLEML** (Product Line Engineering Modeling Language) is an extension for SysML v2 to model product line features, feature trees, feature configurations, and constraints between features.

Source: [github.com/mbse4u/pleml](https://github.com/MBSE4U/PLEML)

Sysand project: [sysand.com/projects/mbse4u/pleml](https://sysand.com/projects/mbse4u/pleml/) — Sysand is a package registry for publishing, versioning, and discovering reusable SysML v2 libraries.

PLEML is based on the paper by Tim Weilkiens, Marco Forlingieri, and Vince Molnar, "Next Generation MBPLE with SysML v2: Feature Modeling, Variability Modeling, and API Potentials", presented at the INCOSE Symposium 2025: [https://doi.org/10.1002/iis2.70058](https://doi.org/10.1002/iis2.70058)

## What's in the Library

PLEML provides the semantic metadata and structural constructs to represent variations, configurations, and constraints of a product line in SysML v2:

- **FeatureModel** — Container of the feature trees and feature configurations of a product line
- **FeatureTree** — Hierarchy of features that specifies the variability. Nesting builds the hierarchy, multiplicities model optional and mandatory features, specialization models alternatives
- **Feature** — Characteristic of a product with `name`, `bindingTime`, `externalRepresentation` (for proxy features), and the derived `isAuthoritative`
- **FeatureConfiguration** — Selection of features that describes a member product, verified by built-in constraints (only features, all non-root features set, consistent binding time, all feature constraints satisfied)
- **Feature constraints** — `RequiresConstraint` (`requiresFeatures`: A implies B), `XORConstraint` (`xorFeatures`, aka conflict constraint: A excludes B), and `ImpliesConstraint` (`impliesFeatures`: (A and B) implies C, generalizes Requires with several premises and conclusions), all evaluated against a feature configuration. All constraints have the same parameters: the constrained features as a `FeatureOperand` with the operands A and B, created with `new FeatureOperand(A, B)`, and the feature configuration
- **LifeCycleKind** — Binding times `Development`, `Production`, and `Operation`
- **PLEML keywords** — `#featureModel`, `#featureTree`, `#feature`, and `#featureConfiguration` for clean model notation
- **Feature bindings** — Metadata `@FB` (`FeatureBinding`) binds elements of shared assets to features, `@FCFGB` (`FeatureConfigurationBinding`) binds a product model to a feature configuration. `DeriveFeatureName` derives the feature name from a dependency

All elements are documented with `doc` comments in [PLEML.sysml](PLEML.sysml).

## Getting Started

Import the library into your SysML v2 model:

```sysml
package MyProductLine {
    private import PLEML::*;

    #featureModel occurrence def MyFeatureModel {
        #featureTree occurrence myFeatureTree :> featureTrees {
            #feature occurrence optionalFeature[0..1] default null;
            #feature occurrence otherFeature[0..1] default null {
                // otherFeature (that) requires optionalFeature
                assert constraint :>> requiresFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, optionalFeature);
                }
            }
        }
        #featureConfiguration occurrence myProduct :> myFeatureTree, featureConfigurations {
            #feature occurrence :>> optionalFeature[1];
            #feature occurrence :>> otherFeature[1];
        }
    }
}
```

The [Drone product line example](Examples) shows the complete approach.

## Repository Structure

```
PLEML.sysml                                                    # The PLEML library
Examples/                                                      # Drone Product Line example
  MBPLE-Example-DroneProductLine-PLEML-SysMLv2-FeatureModel.sysml    # Feature tree and feature configurations
  MBPLE-Example-DroneProductLine-PLEML-SysMLv2-SharedAssets.sysml    # Shared assets linked to features
  MBPLE-Example-DroneProductLine-PLEML-SysMLv2-ProductModel.sysml    # Product model of a member product
```

## Tests

[Test/PLEML-Test-Constraints.sysml](Test/PLEML-Test-Constraints.sysml) contains valid and violating feature configurations for the `XORConstraint`, `RequiresConstraint` and `ImpliesConstraint`, with the expected verdict documented. Evaluating the constraints requires a tool that supports `suboccurrences` and the binding of the `featureConfiguration`; OpenSysML v0.9.2 loads the models but does not evaluate the constraints conclusively.

## Contributing

Contributions are welcome — please submit issues or pull requests.

## Maintainers

- Tim Weilkiens (Contact: [tim@mbse4u.com](mailto:tim@mbse4u.com))
- Marco Forlingieri
- Vince Molnar

## License

- Copyright Tim Weilkiens, Marco Forlingieri, Vince Molnar
- MIT License — see [LICENSE](LICENSE) for details.
