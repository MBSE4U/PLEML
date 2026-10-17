package PLEMLConstraintTests {
    doc
    /* Test models for the feature constraints of PLEML.
     *
     * Each feature configuration documents the expected verdict of the asserted constraints
     * when it is evaluated by a tool that supports the library (suboccurrences, binding of the featureConfiguration).
     * Note: OpenSysML v0.9.2 does not evaluate the constraints conclusively (see README).
     *
     * XOR:      xorValid -> constraints hold, xorViolated -> xorFeatures of "a" is violated (a excludes b)
     * REQUIRES: requiresValid -> constraints hold, requiresViolated -> requiresFeatures of "c" is violated (c requires d)
     */
    private import PLEML::*;

    #featureModel occurrence def ConstraintTestFeatureModel {
        #featureTree occurrence tree :> featureTrees {
            #feature occurrence a[0..1] default null {
                assert constraint :>> xorFeatures {
                    in #feature occurrence :>> excluded = (b);
                }
            }
            #feature occurrence b[0..1] default null;
            #feature occurrence c[0..1] default null {
                assert constraint :>> requiresFeatures {
                    in #feature occurrence :>> requiredFeatures = (d);
                }
            }
            #feature occurrence d[0..1] default null;
        }

        // a without b: XOR satisfied
        #featureConfiguration occurrence xorValid :> tree, featureConfigurations {
            #feature occurrence :>> a[1];
        }
        // a together with b: XOR violated
        #featureConfiguration occurrence xorViolated :> tree, featureConfigurations {
            #feature occurrence :>> a[1];
            #feature occurrence :>> b[1];
        }
        // c together with d: REQUIRES satisfied
        #featureConfiguration occurrence requiresValid :> tree, featureConfigurations {
            #feature occurrence :>> c[1];
            #feature occurrence :>> d[1];
        }
        // c without d: REQUIRES violated
        #featureConfiguration occurrence requiresViolated :> tree, featureConfigurations {
            #feature occurrence :>> c[1];
        }
    }
}
