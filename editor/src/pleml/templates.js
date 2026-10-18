// Templates for new documents and snippets for the Insert menu.

export function emptyPackage(packageName) {
    return `package ${packageName} {
    private import PLEML::*;

}
`;
}

export function featureModelDocument(packageName) {
    return `package ${packageName} {
    private import PLEML::*;

    #featureModel occurrence def ${packageName}FeatureModel {
        doc /* Feature model of the product line. */

        #featureTree occurrence ${lowerFirst(packageName)}FeatureTree :> featureTrees {
            // Mandatory feature with alternatives
            #feature occurrence edition[1];
            #feature occurrence basicEdition[0..1] :> edition default null;
            #feature occurrence premiumEdition[0..1] :> edition default null;

            // Optional feature that requires another feature
            #feature occurrence extension[0..1] default null {
                assert constraint :>> requiresFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, premiumEdition);
                }
            }
        }

        #featureConfiguration occurrence basicProduct :> ${lowerFirst(packageName)}FeatureTree, featureConfigurations {
            #feature occurrence :>> edition[1] = (basicEdition);
            #feature occurrence :>> basicEdition[1];
        }
    }
}
`;
}

export const SNIPPETS = [
    {
        label: "Feature model",
        text: `#featureModel occurrence def MyFeatureModel {
    #featureTree occurrence myFeatureTree :> featureTrees {
        #feature occurrence myFeature[0..1] default null;
    }
}`,
    },
    {
        label: "Feature tree",
        text: `#featureTree occurrence myFeatureTree :> featureTrees {
}`,
    },
    { label: "Mandatory feature", text: "#feature occurrence myFeature[1];" },
    { label: "Optional feature", text: "#feature occurrence myFeature[0..1] default null;" },
    {
        label: "Alternative features",
        text: `#feature occurrence myChoice[1];
#feature occurrence optionA[0..1] :> myChoice default null;
#feature occurrence optionB[0..1] :> myChoice default null;`,
    },
    {
        label: "REQUIRES constraint",
        text: `assert constraint :>> requiresFeatures {
    in occurrence constrainedFeatures = new FeatureOperand(that, requiredFeature);
}`,
    },
    {
        label: "XOR constraint",
        text: `assert constraint :>> xorFeatures {
    in occurrence constrainedFeatures = new FeatureOperand(that, excludedFeature);
}`,
    },
    {
        label: "IMPLIES constraint",
        text: `assert constraint :>> impliesFeatures {
    in occurrence constrainedFeatures = new FeatureOperand((premiseA, premiseB), conclusion);
}`,
    },
    {
        label: "Feature configuration",
        text: `#featureConfiguration occurrence myProduct :> myFeatureTree, featureConfigurations {
    #feature occurrence :>> myFeature[1];
}`,
    },
];

function lowerFirst(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
}
