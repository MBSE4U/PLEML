library package PLEML {
    doc
    /* Definition of the Product Line Engineering Modeling Language (PLEML)
     *
     * PLEML is an extension for SysML v2 to enable the modeling of PLE Features.
     *
     *   PPPP   L     EEEEE  M   M  L
     *   P   P  L     E      MM MM  L
     *   PPPP   L     EEEE   M M M  L
     *   P      L     E      M   M  L
     *   P      LLLLL EEEEE  M   M  LLLLL
     *
     * Overview of the language elements:
     * - FeatureModel: container of feature trees and feature configurations
     * - FeatureTree: hierarchy of features that specifies the variability of a product line
     * - Feature: a characteristic of a product, with binding time and constraints
     * - FeatureConfiguration: a selection of features that describes a member product
     * - RequiresConstraint, XORConstraint, ImpliesConstraint: constraints between features,
     *   each parameterized with a FeatureOperand that holds two operands A and B
     * - LifeCycleKind: binding times of features
     * - Keywords: #featureModel, #featureTree, #feature, #featureConfiguration
     * - FeatureBinding (@FB), FeatureConfigurationBinding (@FCFGB): metadata to bind
     *   model elements of shared assets and product models to features and feature configurations
     *
     * Version: v1.1
     * License: MIT
     * Maintainer: Tim Weilkiens (Contact: tim@mbse4u.com), Marco Forlingieri, Vince Molnar
     *
     * Topic: MBSE, MBPLE, PLE, Methodology
     *
     * Based on the paper from Tim Weilkiens, Marco Forlingieri, and Vince Molnar
     * "Next Generation MBPLE with SysML v2: Feature Modeling, Variability Modeling, and API Potentials"
     * presented at the INCOSE Symposium 2025
     * https://doi.org/10.1002/iis2.70058
     *
     * MIT License
     *
     * Copyright (c) 2026 Tim Weilkiens, Marco Forlingieri, Vince Molnar
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in all
     * copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
     * SOFTWARE.
     */
    private import SequenceFunctions::*;

    occurrence def FeatureModel {
        doc
        /* A Feature Model is the container of the variability specification of a product line.
         * It owns the feature trees, which define the features and their constraints,
         * and the feature configurations, which select features to describe member products.
         * Apply it with the keyword #featureModel.
         */
        occurrence featureTrees[*] : FeatureTree;
        occurrence featureConfigurations : FeatureConfiguration [*];
    }
    abstract occurrence featureModels : FeatureModel [*] {
        doc /* Base usage of all feature models. It is the base type of the keyword #featureModel. */
    }

    occurrence def FeatureConfiguration :> Feature {
        doc
        /* A Feature Configuration selects features of a feature tree to describe a member product
         * of the product line. It specializes a feature tree and redefines its features:
         * a feature with multiplicity 1 is selected, a feature that is not set is not selected.
         * The configuration is valid if it only owns features, all non-root features are set,
         * their binding times are not later than the binding time of the configuration,
         * and all feature constraints of the feature tree are satisfied.
         * Apply it with the keyword #featureConfiguration.
         */
        assert constraint :>> featureConstraints [*] {
            doc
            /* Assign the feature configuration to all feature constraints in the tree to enable their verification. */
            in occurrence constrainedFeatures;
            in occurrence :>> featureConfiguration = that;
        }
        assert constraint featureConfigurationOnlyOwnsFeatures {
            doc /* A feature configuration shall only own features, no other kinds of occurrences. */
            suboccurrences->ControlFunctions::forAll({in o; o istype Feature})
        }
        assert constraint nodeFeaturesAreSet {
            doc
            /* Every feature that has an owning feature (i.e., is not the root) must be set in the configuration,
             * and its binding time must not be later than the binding time of the configuration.
             */
            suboccurrences->ControlFunctions::forAll({
                in o;
                ((o meta SysML::OccurrenceUsage).owningUsage->SequenceFunctions::size() > 0 implies o != null)
                and ((o as Feature).bindingTime <= (this as FeatureConfiguration).bindingTime)
            })
        }
    }
    abstract occurrence featureConfigurations : FeatureConfiguration [*] {
        doc /* Base usage of all feature configurations. It is the base type of the keyword #featureConfiguration. */
    }

    occurrence def FeatureTree :> Feature {
        doc
        /* A Feature Tree is a tree structure that represents the features of a product line.
         * The feature tree itself is the root feature, nested feature usages are its child features.
         * Apply it with the keyword #featureTree.
         */
    }
    abstract occurrence featureTrees : FeatureTree [*] {
        doc /* Base usage of all feature trees. It is the base type of the keyword #featureTree. */
    }

    occurrence def Feature {
        doc
        /* A Feature is a characteristic of a product in a product line
         * that distinguishes it from other products in the product line.
         * Features are arranged hierarchically by nesting. Multiplicities model optional and mandatory features,
         * and specialization models alternatives, e.g., a mission kind that is specialized by concrete missions.
         * Apply it with the keyword #feature.
         */

        attribute name : ScalarValues::String {
            doc /* The name of the feature. Feature bindings use it to refer to the feature. */
        }

        attribute externalRepresentation : ScalarValues::String default "" {
            doc /* Points to the origin of the feature, if this feature is only a proxy. */
        }
        derived attribute isAuthoritative : ScalarValues::Boolean = (externalRepresentation == "") {
            doc /* Derived attribute indicating if feature is authoritative or a proxy. */
        }

        attribute bindingTime : LifeCycleKind default LifeCycleKind::Development {
            doc
            /* The binding time of the feature with default Development. */
        }
        assert constraint featureConstraints : FeatureConstraint [*] {
            doc
            /* Set of all feature constraints owned by the feature. */
        }
        assert constraint requiresFeatures : RequiresConstraint [*] :> featureConstraints {
            doc
            /* Set of REQUIRES constraints */
        }
        assert constraint xorFeatures : XORConstraint [*] :> featureConstraints {
            doc
            /* Set of XOR constraints (aka conflict constraints) */
        }
        assert constraint impliesFeatures : ImpliesConstraint [*] :> featureConstraints {
            doc
            /* Set of IMPLIES constraints, e.g., (A and B) implies C */
        }
    }
    abstract occurrence features : Feature [0..*] {
        doc /* Base usage of all features. It is the base type of the keyword #feature. */
    }

    enum def LifeCycleKind :> ScalarValues::Natural {
        doc
        /* Definition of feature binding times. The numbers provide an order of the life cycles. */
        enum Development = 1 { doc /* The feature is bound during the development of the product. */ }
        enum Production = 2 { doc /* The feature is bound during the production of the product. */ }
        enum Operation = 3 { doc /* The feature is bound during the operation of the product. */ }
    }

    abstract constraint def FeatureConstraint {
        doc
        /* Common abstract definition of a feature constraint.
         *
         * All feature constraints have the same parameters: the constrained features as a FeatureOperand
         * and the feature configuration to verify the constraint against. A specialization gives
         * operand A and operand B their meaning, e.g., the owning and the required features of a REQUIRES constraint.
         *
         * Usage, e.g., in a feature that requires the feature d (that = the feature owning the constraint):
         *   assert constraint :>> requiresFeatures {
         *       in occurrence constrainedFeatures = new FeatureOperand(that, d);
         *   }
         *
         * The feature configuration is set by the FeatureConfiguration for all feature constraints of its features.
         */
        in occurrence constrainedFeatures : FeatureOperand {
            doc /* The features that are constrained, given as operands A and B. */
        }
        in occurrence featureConfiguration : FeatureConfiguration {
            doc /* The feature configuration to verify the constraint against. */
        }
    }

    occurrence def FeatureOperand {
        doc
        /* The operands of a feature constraint: two sets of features A and B.
         * Create it with new FeatureOperand(A, B), e.g., new FeatureOperand(that, d) or new FeatureOperand((e, f), g).
         * The feature constraint definitions define the meaning of the operands.
         */
        occurrence operandA[0..*] : Feature {
            doc /* Operand A: the left-hand side of the feature constraint. */
        }
        occurrence operandB[0..*] : Feature {
            doc /* Operand B: the right-hand side of the feature constraint. */
        }
    }

    constraint def RequiresConstraint :> FeatureConstraint {
        doc
        /* Definition of a REQUIRES constraint: A implies (B1 and B2 and ...).
         *
         * Operand A is the owning feature (typically that), operand B are the required features.
         *
         * Without a valid feature configuration,
         * no statement can be made and the constraint returns true.
         * With a valid feature configuration, it checks if the owning feature
         * is part of the feature configuration which implies that all required features
         * must also be part of the feature configuration.
         */
        ref occurrence owningFeature : Feature = constrainedFeatures.operandA {
            doc /* The feature that requires the other features (operand A). */
        }
        ref occurrence requiredFeatures[1..*] : Feature = constrainedFeatures.operandB {
            doc /* The features that are required by the owning feature. */
        }

        if featureConfiguration != null
            ? featureConfiguration.suboccurrences->includes(owningFeature) implies
                featureConfiguration.suboccurrences->includes(requiredFeatures)
            else true
    }

    constraint def XORConstraint :> FeatureConstraint {
        doc
        /* Definition of a XOR constraint: A implies not (B1 or B2 or ...).
         *
         * Operand A is the owning feature (typically that), operand B are the excluded features.
         *
         * Without a valid feature configuration, no statement can be made,
         * and the constraint returns true. With a valid feature configuration,
         * it checks if the owning feature is part of the feature configuration,
         * which implies that all excluded features shall not be part of the feature configuration.
         */
        ref occurrence owningFeature : Feature = constrainedFeatures.operandA {
            doc /* The feature that excludes the other features (operand A). */
        }
        ref occurrence excluded[1..*] : Feature = constrainedFeatures.operandB {
            doc /* The features that are excluded by the owning feature. */
        }

        if featureConfiguration != null
            ? featureConfiguration.suboccurrences->includes(owningFeature) implies
                excluded->ControlFunctions::forAll {
                    in f;
                    not featureConfiguration.suboccurrences->includes(f)
                }
            else true
    }

    constraint def ImpliesConstraint :> FeatureConstraint {
        doc
        /* Definition of an IMPLIES constraint: (premise1 and premise2 and ...) implies
         * (conclusion1 and conclusion2 and ...), e.g., (A and B) implies C.
         *
         * Operand A are the premises, operand B are the conclusions,
         * e.g., new FeatureOperand((e, f), g) for (e and f) implies g.
         *
         * It generalizes the REQUIRES constraint, which has the owning feature as its only premise.
         * The owning feature is only the container of the constraint and is not implicitly a premise;
         * list it in operand A if it shall be one.
         *
         * Without a valid feature configuration, no statement can be made and the constraint returns true.
         * With a valid feature configuration, it checks that all conclusions are part of the
         * feature configuration if all premises are part of it. Without premises, the conclusions always apply.
         */
        ref occurrence premises[0..*] : Feature = constrainedFeatures.operandA {
            doc /* The features that must all be part of the feature configuration to trigger the constraint. */
        }
        ref occurrence conclusions[0..*] : Feature = constrainedFeatures.operandB {
            doc /* The features that must all be part of the feature configuration if all premises are. */
        }

        if featureConfiguration != null
            ?   premises->ControlFunctions::forAll {
                    in f;
                    featureConfiguration.suboccurrences->includes(f)
                } implies
                conclusions->ControlFunctions::forAll {
                    in f;
                    featureConfiguration.suboccurrences->includes(f)
                }
            else true
    }

    //
    // Semantic Metadata for user-defined keywords
    //
    metadata def <featureModel> FeatureModelMetadata :> Metaobjects::SemanticMetadata {
        doc /* Keyword #featureModel: marks an occurrence (definition) as a feature model. */
        :>> baseType = featureModels meta SysML::Type;
        :> annotatedElement : SysML::OccurrenceDefinition;
        :> annotatedElement : SysML::OccurrenceUsage;
    }
    metadata def <featureTree> FeatureTreeMetadata :> Metaobjects::SemanticMetadata {
        doc /* Keyword #featureTree: marks an occurrence (definition) as a feature tree. */
        :>> baseType = featureTrees meta SysML::Type;
        :> annotatedElement : SysML::OccurrenceDefinition;
        :> annotatedElement : SysML::OccurrenceUsage;
    }
    metadata def <feature> FeatureMetadata :> Metaobjects::SemanticMetadata {
        doc /* Keyword #feature: marks an occurrence (definition) as a feature. */
        :>> baseType = features meta SysML::Type;
        :> annotatedElement : SysML::OccurrenceDefinition;
        :> annotatedElement : SysML::OccurrenceUsage;
    }
    metadata def <featureConfiguration> FeatureConfigurationMetadata
        :> Metaobjects::SemanticMetadata {
        doc /* Keyword #featureConfiguration: marks an occurrence (definition) as a feature configuration. */
        :>> baseType = featureConfigurations meta SysML::Type;
        :> annotatedElement : SysML::OccurrenceDefinition;
        :> annotatedElement : SysML::OccurrenceUsage;
    }
    metadata def <FB> FeatureBinding {
        doc
        /* Binds a model element of the shared assets or a product model to a feature of a feature model.
         * Apply it as @FB. By default, the feature name is derived from the first dependency supplier
         * of the annotated element (see DeriveFeatureName).
         */
        attribute featureName : ScalarValues::String default := DeriveFeatureName(annotatedElement) {
            doc /* The name of the bound feature. */
        }
        attribute featureModel : ScalarValues::String {
            doc /* The name of the feature model that owns the bound feature. */
        }
    }
    metadata def <FCFGB> FeatureConfigurationBinding :> FeatureBinding {
        doc
        /* Binds a model element, typically the product model of a member product, to a feature configuration.
         * Apply it as @FCFGB.
         */
        attribute featureConfiguration :>> featureName {
            doc /* The name of the bound feature configuration. */
        }
    }
    calc def DeriveFeatureName {
        doc
        /* Derives the name of a feature from the first supplier of the first dependency that annotates the given element.
         * Returns an empty string if no feature name is available.
         */
        in ref annotatedElements [*];
        ref firstAnnotatedElement = annotatedElements#(1);
        ref firstDependencySupplier = (firstAnnotatedElement meta SysML::Dependency).supplier#(1);
        occurrence feature = firstDependencySupplier meta SysML::OccurrenceUsage;
        return : ScalarValues::String;
        (feature as Feature).name ?? ""
    }
} // library package <PLEML> ProductLineEngineeringModelingLanguage
