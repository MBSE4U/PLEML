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
     * IMPLIES:  impliesValid1/impliesValid2 -> constraints hold, impliesViolated -> impliesFeatures of "e" is violated ((e and f) implies g)
     */
    private import PLEML::*;

    #featureModel occurrence def ConstraintTestFeatureModel {
        #featureTree occurrence tree :> featureTrees {
            #feature occurrence a[0..1] default null {
                assert constraint :>> xorFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, b);
                }
            }
            #feature occurrence b[0..1] default null;
            #feature occurrence c[0..1] default null {
                assert constraint :>> requiresFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, d);
                }
            }
            #feature occurrence d[0..1] default null;
            #feature occurrence e[0..1] default null {
                assert constraint :>> impliesFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand((e, f), g);
                }
            }
            #feature occurrence f[0..1] default null;
            #feature occurrence g[0..1] default null;
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
        // e, f and g: (e and f) implies g satisfied
        #featureConfiguration occurrence impliesValid1 :> tree, featureConfigurations {
            #feature occurrence :>> e[1];
            #feature occurrence :>> f[1];
            #feature occurrence :>> g[1];
        }
        // e without f: premises not fully met, IMPLIES satisfied without g
        #featureConfiguration occurrence impliesValid2 :> tree, featureConfigurations {
            #feature occurrence :>> e[1];
        }
        // e and f without g: IMPLIES violated
        #featureConfiguration occurrence impliesViolated :> tree, featureConfigurations {
            #feature occurrence :>> e[1];
            #feature occurrence :>> f[1];
        }
    }
}
