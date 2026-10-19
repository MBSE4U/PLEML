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

package DroneProductLineSharedAssets {

    private import PLEML::*;
    private import DroneProductLineFeatureModelProject::*;

    occurrence def DroneProductLineProject {
        doc /* The DroneProductLineProject provides the usage context 
             * for the main engineering artifacts and links them together. 
             */

        // The Feature Model
        #featureModel occurrence droneFeatureModel : DroneProductLineFeatureModel;

        // The Base Architecture
        part droneBaseArchitectureContext : DPL_BA::DroneBaseArchitectureContext;

        // The System Requirements
        requirement droneSystemRequirements : DPL_RE::DroneSystemRequirementsSpecification {
            subject :>> drone = droneBaseArchitectureContext.systemOfInterest;
        }

        // The Drone Product Line
        part droneProduct : DPL_SA::Drone;

        // Feature Bindings from Shared Assets to the Features 
        #FeatureBinding dependency from droneSystemRequirements::minimumFlightTime::standardRange to droneFeatureModel::droneProductLineFeatureTree::standardMission;
        #FeatureBinding dependency from droneSystemRequirements::minimumFlightTime::extendedRange to droneFeatureModel::droneProductLineFeatureTree::longMission;

        #FeatureBinding dependency from droneProduct::battery::standardBattery to droneFeatureModel::droneProductLineFeatureTree::standardMission;
        #FeatureBinding dependency from droneProduct::battery::longDistanceBattery to droneFeatureModel::droneProductLineFeatureTree::longMission;

        #FeatureBinding dependency from droneProduct::body::bodyWithoutPayload to droneFeatureModel::droneProductLineFeatureTree::hasPayload;
        #FeatureBinding dependency from droneProduct::body::bodyWithSmallPayload to droneFeatureModel::droneProductLineFeatureTree::hasPayload;
        #FeatureBinding dependency from droneProduct::body::bodyWithLargePayload to droneFeatureModel::droneProductLineFeatureTree::hasPayload;
    }

    package <DPL_BA> DroneProductLineBaseArchitecture {       
        part def DroneBaseArchitectureContext {
            part systemOfInterest : CommonDrone;
        }
        part def CommonDrone {
            attribute remainingFlightTime :> ISQ::duration;
            attribute totalMass :> ISQ::mass;
            part battery {
                attribute capacity : BatteryCapacity;
            }
        }
        enum def BatteryCapacity {
            enum full;
            enum medium;
            enum low;
            enum empty;
        }
    }

    package <DPL_C> DroneProductLineSystemContext {
        part def Environment {
            attribute windspeed :> ISQ::speed;
        }
    }

    package <DPL_RE> DroneProductLineSystemRequirements {
        requirement def DroneSystemRequirementsSpecification {
            subject drone : DPL_BA::CommonDrone;

            requirement <REQ2> maximumTakeoffWeight {
                doc /* The maximum take off weight of the drone shall not exceed 42 kg. */
                subject drone : DPL_BA::CommonDrone;

                assert constraint {
                    drone.totalMass <= 42 [SI::kg]
                }
            }

            variation requirement <REQ3> minimumFlightTime : MinimumFlightTimeDef {
                variant requirement standardRange {
                    assert constraint {
                        drone.remainingFlightTime >= 60 [SI::min]
                    }
                }
                variant requirement extendedRange {
                    assert constraint {
                        drone.remainingFlightTime >= 120 [SI::min]
                    }
                }
            }

            requirement def MinimumFlightTimeDef {
                subject drone : DPL_BA::CommonDrone;
                actor environment : DPL_C::Environment;

                assume constraint {
                    environment.windspeed <= 15 [SI::'km/h']
                    and drone.battery.capacity == DPL_BA::BatteryCapacity::full
                }
            }

        }
    }

    package <DPL_SA> DroneProductLineSystemArchitecture {
        part def Drone {
            variation part body {
                variant part bodyWithoutPayload;
                variant part bodyWithSmallPayload {
                    part payloadAttachment;
                }
                variant part bodyWithLargePayload {
                    part xPayloadAttachment;
                }
            }
            part controlUnit {
                variation action charging {
                    variant action standardCharging;
                    variant action longDistanceCharging;
                }
                part flightController {
                    part observationControlModule[0..1];
                    part cameraControlModule[0..1];
                }
            }
            variation part engines [4..6] {
                variant part engines4[4];
                variant part engines6[6];
            }
            variation part battery {
                variant part standardBattery;
                variant part longDistanceBattery;
            }
            assert constraint {
                battery == battery::longDistanceBattery implies controlUnit.charging == controlUnit.charging::longDistanceCharging
            }
            assert constraint {
                engines != engines::engines4 implies battery::longDistanceBattery
            }

        }
    }
}
