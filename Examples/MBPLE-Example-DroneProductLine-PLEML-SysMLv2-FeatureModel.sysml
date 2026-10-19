// MIT License
//
// Copyright (c) 2026 Tim Weilkiens, Marco Forlingieri, Vince Molnar
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

package <FM> DroneProductLineFeatureModelProject {
    private import PLEML::*;

    #featureModel occurrence def DroneProductLineFeatureModel {
        doc /* Feature Model for a Drone Product Line - Example Model for PLEML. */
        #featureTree occurrence droneProductLineFeatureTree :> featureTrees {
            #feature occurrence missionKind[1..2];
            #feature occurrence deliveryMission[0..1] :> missionKind default null;
            #feature occurrence observationMission[0..1] :> missionKind default null {
                assert constraint :>> xorFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, hasPayload);
                }
            }
            #feature occurrence securityMission[0..1] :> observationMission default null;
            #feature occurrence forestFireMission[0..1] :> observationMission default null {
                assert constraint :>> requiresFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, longMission);
                }
            }
            #feature occurrence funMission[0..1] :> missionKind default null;

            #feature occurrence missionTime default standardMission;
            #feature occurrence standardMission[0..1] :> missionTime default new standardMission(); 
            #feature occurrence longMission[0..1] :> missionTime default null;

            // Optional feature
            #feature occurrence hasPayload[0..1] default null {
                assert constraint :>> requiresFeatures {
                    in occurrence constrainedFeatures = new FeatureOperand(that, payloadSize);
                }
            }
            #feature occurrence payloadSize[0..1] default null;
            #feature occurrence smallPayload[0..1] :> payloadSize default null;
            #feature occurrence largePayload[0..1] :> payloadSize default null;

            #feature occurrence badWeatherConditions[0..1] default null;
        }

        #featureConfiguration occurrence deliveryDrone :> droneProductLineFeatureTree, featureConfigurations {
            #feature occurrence :>> missionKind[1] = (deliveryMission);
            #feature occurrence :>> deliveryMission[1];
            #feature occurrence :>> missionTime[1] = (longMission);
            #feature occurrence :>> longMission[1];
            #feature occurrence :>> hasPayload[1];
            #feature occurrence :>> payloadSize[1] = largePayload;
            #feature occurrence :>> largePayload[1];
            #feature occurrence :>> badWeatherConditions[1];
        }
        #featureConfiguration occurrence observationDrone :> droneProductLineFeatureTree, featureConfigurations {
            #feature occurrence :>> missionKind = (forestFireMission);
            #feature occurrence :>> forestFireMission[1];
            #feature occurrence :>> missionTime[1] = (longMission);
            #feature occurrence :>> longMission[1];
            #feature occurrence :>> badWeatherConditions[1];
        }
        #featureConfiguration occurrence consumerDrone :> droneProductLineFeatureTree, featureConfigurations {
            #feature occurrence :>> missionKind = (securityMission, funMission);
            #feature occurrence :>> securityMission[1];
            #feature occurrence :>> funMission[1];
        }
    }
}
