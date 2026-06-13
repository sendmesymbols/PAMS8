
import UEISymbol from "../Symbols/UEISymbol.ts";
import TacticalPoint from "../Symbols/TacticalPoint.ts";
import TacticalPointText from "../Symbols/TacticalPointText.ts";
import TacticalPointTextBox from "../Symbols/TacticalPointTextBox.ts";
import FreehandLine from "../Symbols/FreehandLine.ts";
import FreehandLineDotted from "../Symbols/FreehandLineDotted.ts";
import FreehandArea from "../Symbols/FreehandArea.ts";
import FreehandAreaFilled from "../Symbols/FreehandAreaFilled.ts";
import CartoInformationModelSymbol from "../Symbols/CartoInformationModelSymbol.ts";
import FreehandArrow from "../Symbols/FreehandArrow.ts";
import FreehandDottedArrow from "../Symbols/FreehandDottedArrow.ts";
import FreehandDoubleLineArrow from "../Symbols/FreehandDoubleLineArrow.ts";
import ArcOfFireSD from "../Symbols/ArcOfFireSD.ts";

import ALineOfDenial from "../Symbols/ALineOfDenial.ts";
import CLineOfDenial from "../Symbols/CLineOfDenial.ts";
import Ambush from "../Symbols/Ambush.ts";
import AntiPersonnelAntiTankMine from "../Symbols/AntiPersonnelAntiTankMine.ts"; //Fixed 2D Only
import AntiPersonnelMine from "../Symbols/AntiPersonnelMine.ts"; //Fixed 2D Only
import AntiPersonnelMineDirEffct from "../Symbols/AntiPersonnelMineDirEffct.ts"; //Fixed 2D Only
import AntitankMine from "../Symbols/AntitankMine.ts"; //Fixed 2D Only
import AntiTankMineWAntiHandle from "../Symbols/AntiTankMineWAntiHandle.ts"; //Fixed 2D Only
import UnspecifiedMine from "../Symbols/UnspecifiedMine.ts"; //Fixed 2D Only
import WideAreaAntiTankMine from "../Symbols/WideAreaAntiTankMine.ts"; //Fixed 2D Only
import AreaOfOperations from "../Symbols/AreaOfOperations.ts"; //Fixed
import AssemblyArea from "../Symbols/AssemblyArea.ts"; //Fixed
import FwdAssemblyArea from "../Symbols/FwdAssemblyArea.ts"; //    -- Segments
import StratAssyArea from "../Symbols/StratAssyArea.ts"; //Fixed    -- Segments
import AttackPosition from "../Symbols/AttackPosition.ts"; //Fixed   -- Segments
import AvenueOfApchs from "../Symbols/AvenueOfApchs.ts"; //Fixed
import AxisOfAdvanceFeint from "../Symbols/AxisOfAdvanceFeint.ts"; //Fixed
import BdeAdmArea from "../Symbols/BdeAdmArea.ts"; //Fixed
import DivAdmArea from "../Symbols/DivAdmArea.ts"; //Fixed
import BridgeHeadLine from "../Symbols/BridgeHeadLine.ts"; //Fixed
import PhaseLine from "../Symbols/PhaseLine.ts"; //Fixed
import Breach from "../Symbols/Breach.ts"; //Fixed
import Bridge from "../Symbols/Bridge.ts"; //Fixed
import BtleHndOvrLn from "../Symbols/BtleHndOvrLn.ts"; //Fixed
import Block from "../Symbols/Block.ts"; //Fixed
import BlockObstacleEffect from "../Symbols/BlockObstacleEffect.ts"; //Fixed
import BOPFreehand from "../Symbols/BOPFreehand.ts"; //Fixed
import Boundary from "../Symbols/Boundary.ts"; //Fixed
import FreehandCloseSupportingAttack from "../Symbols/FreehandCloseSupportingAttack.ts";  //Fixed
import MainAttack from "../Symbols/MainAttack.ts";  //Fixed
import FriendlyAirborneAviation from "../Symbols/FriendlyAirborneAviation.ts";
import AttackHelicopter from "../Symbols/AttackHelicopter.ts";
import MultiHeadMainAttack from "../Symbols/MultiHeadMainAttack.ts";  //Fixed
import AttackByFirePosition from "../Symbols/AttackByFirePosition.ts"; //Fixed
import Clear from "../Symbols/Clear.ts"; //Fixed
import BattlePosition from "../Symbols/BattlePosition.ts"; //Fixed
import CounterAttack from "../Symbols/CounterAttack.ts"; //Fixed
import CounterAttkObj from "../Symbols/CounterAttkObj.ts"; //Fixed
import CpenPosition from "../Symbols/CpenPosition.ts"; //Fixed
import FreehandMainAttackArrow from "../Symbols/FreehandMainAttackArrow.ts"; //Fixed
import FreehandSemiCircle from "../Symbols/FreehandSemiCircle.ts"; //Fixed
import FreehandSemiCircleFilled from "../Symbols/FreehandSemiCircleFilled.ts"; //Fixed
import FreehandSupportingAttack from "../Symbols/FreehandSupportingAttack.ts"; //Fixed
import FriendlyDirOfMainAttk from "../Symbols/FriendlyDirOfMainAttk.ts"; //Fixed
import FriendlyDirOfSpAttk from "../Symbols/FriendlyDirOfSpAttk.ts"; //Fixed
import DirectionOfFeintAttack from "../Symbols/DirectionOfFeintAttack.ts"; //Fixed
import FriendlyAviationAttack from "../Symbols/FriendlyAviationAttack.ts";
import TargetAreaOfInterest from "../Symbols/TargetAreaOfInterest.ts"; //Fixed
import NamedAreaOfInterest from "../Symbols/NamedAreaOfInterest.ts"; //Fixed
import AssaultPosition from "../Symbols/AssaultPosition.ts"; //Fixed
import Encirclement from "../Symbols/Encirclement.ts"; //Fixed
import FortifiedArea from "../Symbols/FortifiedArea.ts"; //Fixed
import AirfieldZone from "../Symbols/AirfieldZone.ts";
import EngagementArea from "../Symbols/EngagementArea.ts";
import DropZone from "../Symbols/DropZone.ts";
import ExtractionZone from "../Symbols/ExtractionZone.ts";
import PickupZone from "../Symbols/PickupZone.ts";
import VitalArea from "../Symbols/VitalArea.ts"; //Fixed
import CorpsAdmArea from "../Symbols/CorpsAdmArea.ts"; //Fixed
import ZoneOfResponsibility from "../Symbols/ZoneOfResponsibility.ts"; //Fixed
import KillingGr from "../Symbols/KillingGr.ts"; //Fixed
import KillingZone from "../Symbols/KillingZone.ts"; //Fixed
import LandingZone from "../Symbols/LandingZone.ts"; //Fixed
import VitalGr from "../Symbols/VitalGr.ts";  //Fixed
import NoGo from "../Symbols/NoGo.ts";  //Fixed
import FlightZone from "../Symbols/FlightZone.ts";  //Fixed
import AirspaceArea from "../Symbols/AirspaceArea.ts";
import PenetrationBox from "../Symbols/PenetrationBox.ts";  //Fixed
import DitchEmpty from "../Symbols/DitchEmpty.ts";  //Fixed
import DitchFilledWithWater from "../Symbols/DitchFilledWithWater.ts";  //Fixed
import SingleConcertina from "../Symbols/SingleConcertina.ts";  //Fixed
import DoubleStrandConcertina from "../Symbols/DoubleStrandConcertina.ts";  //Fixed
import TripleStrandConcertina from "../Symbols/TripleStrandConcertina.ts";  //Fixed
import SingleFenceWire from "../Symbols/SingleFenceWire.ts";  //Fixed
import DoubleFenceWire from "../Symbols/DoubleFenceWire.ts";  //Fixed
import ObstacleZone from "../Symbols/ObstacleZone.ts";
import ObstacleFreeZone from "../Symbols/ObstacleFreeZone.ts";
import UARoute from "../Symbols/UARoute.ts";  //Fixed
import SafeLane from "../Symbols/SafeLane.ts";  //Fixed
import TransitCorridors from "../Symbols/TransitCorridors.ts";  //Fixed
import MinimumRiskRoute from "../Symbols/MinimumRiskRoute.ts";  //Fixed
import LowLevelTransitRoute from "../Symbols/LowLevelTransitRoute.ts";  //Fixed
import HighDensityAirspaceControlZone from "../Symbols/HighDensityAirspaceControlZone.ts";  //Fixed
import RestrictedOperationsZone from "../Symbols/RestrictedOperationsZone.ts";  //Fixed
import AirToAirRestrictedOperationsZone from "../Symbols/AirToAirRestrictedOperationsZone.ts";  //Fixed
import UnmannedAircraftRestrictedOperationsZone from "../Symbols/UnmannedAircraftRestrictedOperationsZone.ts";  //Fixed
import WeaponEngagementZone from "../Symbols/WeaponEngagementZone.ts";  //Fixed
import FighterEngagementZone from "../Symbols/FighterEngagementZone.ts";  //Fixed
import JointEngagementZone from "../Symbols/JointEngagementZone.ts";  //Fixed
import MissileEngagementZone from "../Symbols/MissileEngagementZone.ts";  //Fixed
import LowAltitudeMissileEngagementZone from "../Symbols/LowAltitudeMissileEngagementZone.ts";  //Fixed
import HighAltitudeMissileEngagementZone from "../Symbols/HighAltitudeMissileEngagementZone.ts";  //Fixed
import ShortRangeAirDefenseEngagementZone from "../Symbols/ShortRangeAirDefenseEngagementZone.ts";  //Fixed
import WeaponFreeZone from "../Symbols/WeaponFreeZone.ts";  //Fixed
import Canalize from "../Symbols/Canalize.ts";  //Fixed
import Corridors from "../Symbols/Corridors.ts"; //Fixed
import Cover from "../Symbols/Cover.ts"; //Fixed
import Delay from "../Symbols/Delay.ts"; //Fixed
import DispersalArea from "../Symbols/DispersalArea.ts"; //Fixed
import Disrupt from "../Symbols/Disrupt.ts"; //Fixed
import DisruptObstacleEffect from "../Symbols/DisruptObstacleEffect.ts"; //Fixed
import DivLineOfNoPen from "../Symbols/DivLineOfNoPen.ts"; //Fixed
import LineOfNoPen from "../Symbols/LineOfNoPen.ts"; //Fixed

import DoubleApronFence from "../Symbols/DoubleApronFence.ts"; //Fixed
import HighWireFence from "../Symbols/HighWireFence.ts"; //Fixed
import LowWireFence from "../Symbols/LowWireFence.ts"; //Fixed
import Fix from "../Symbols/Fix.ts"; //Fixed
import FlightRoute from "../Symbols/FlightRoute.ts"; //Fixed
import FormingUpPoint from "../Symbols/FormingUpPoint.ts"; //Fixed
import Funnel from "../Symbols/Funnel.ts"; //Fixed
import FwdLineOfTps from "../Symbols/FwdLineOfTps.ts";  //Fixed
import Guard from "../Symbols/Guard.ts"; //Fixed
import Secure from "../Symbols/Secure.ts"; //Fixed
import Retain from "../Symbols/Retain.ts"; //Fixed

import InfiltrationLane from "../Symbols/InfiltrationLane.ts"; //Fixed
import Isolate from "../Symbols/Isolate.ts";  //Fixed

import Screen from "../Symbols/Screen.ts"; //Fixed
import MovingConvoy from "../Symbols/MovingConvoy.ts"; //Fixed
// Import the new TypeScript symbol classes

import ObstacleBypassEasy from "../Symbols/ObstacleBypassEasy.ts"; //Fixed
import Occupy from "../Symbols/Occupy.ts"; //Fixed
import Penetrate from "../Symbols/Penetrate.ts"; //Fixed
import SlowGo from "../Symbols/SlowGo.ts";  //Fixed
import Withdraw from "../Symbols/Withdraw.ts"; //Fixed
import WithdrawUnderPressure from "../Symbols/WithdrawUnderPressure.ts"; //Fixed
import Bypass from "../Symbols/Bypass.ts"; //Fixed
import SupportByFirePosition from "../Symbols/SupportByFirePosition.ts"; //Fixed
import PrincipalDirectionOfFire from "../Symbols/PrincipalDirectionOfFire.ts";
import SearchReconnaissanceArea from "../Symbols/SearchReconnaissanceArea.ts";
import StartLine from "../Symbols/StartLine.ts";  //Fixed
import ObjArea from "../Symbols/ObjArea.ts"; //Fixed
import SupportingAttack from "../Symbols/SupportingAttack.ts"; //Fixed
import UnspecifiedWire from "../Symbols/UnspecifiedWire.ts"; //Fixed

import StrongPoint from "../Symbols/StrongPoint.ts"; //Fixed
import Contain from "../Symbols/Contain.ts"; //Fixed



import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

type ViewType = MapView | SceneView;

interface ISymbolConstructor {
    new (view: ViewType, isLine: boolean): any;  // Generic return type to support all symbol types
}

const SYMBOL_MAP: Record<string, ISymbolConstructor> = {
    "CLineOfDenial": CLineOfDenial,
    "ALineOfDenial": ALineOfDenial,
    "PhaseLine": PhaseLine,
    "Ambush": Ambush,
    "ArcOfFireSD": ArcOfFireSD,
    "AntiPersonnelAntiTankMine": AntiPersonnelAntiTankMine,
    "AntiPersonnelMine": AntiPersonnelMine,
    "AntiPersonnelMineDirEffct": AntiPersonnelMineDirEffct,
    "AntitankMine": AntitankMine,
    "AntiTankMineWAntiHandle": AntiTankMineWAntiHandle,
    "AreaOfOperations": AreaOfOperations,
    "AssemblyArea": AssemblyArea,
    "AttackPosition": AttackPosition,
    "AvenueOfApchs": AvenueOfApchs,
    "AxisOfAdvanceFeint": AxisOfAdvanceFeint,
    "BdeAdmArea": BdeAdmArea,
    "BridgeHeadLine": BridgeHeadLine,
    "Breach": Breach,
    "Bridge": Bridge,
    "BtleHndOvrLn": BtleHndOvrLn,
    "Block": Block,
    "BlockObstacleEffect": BlockObstacleEffect,
    "BOPFreehand": BOPFreehand,
    "Boundary": Boundary,
    "FreehandCloseSupportingAttack": FreehandCloseSupportingAttack,
    "FreehandDottedArrow": FreehandDottedArrow,
    "FreehandDoubleLineArrow": FreehandDoubleLineArrow,
    "FreehandArrow": FreehandArrow,
    "FreehandLine": FreehandLine,
    "FreehandArea": FreehandArea,
    "FreehandAreaFilled": FreehandAreaFilled,
    "CartoInformationModelSymbol": CartoInformationModelSymbol,
    "TacticalPointText": TacticalPointText,
    "TacticalPointTextBox": TacticalPointTextBox,
    "TacticalPoint": TacticalPoint,
    "UEISymbol": UEISymbol,
    "MainAttack": MainAttack,
    "FriendlyAirborneAviation": FriendlyAirborneAviation,
    "AttackHelicopter": AttackHelicopter,
    "MultiHeadMainAttack": MultiHeadMainAttack,
    "AttackByFirePosition": AttackByFirePosition,
    "Clear": Clear,
    "BattlePosition": BattlePosition,
    "CounterAttack": CounterAttack,
    "CounterAttkObj": CounterAttkObj,
    "CpenPosition": CpenPosition,
    "FreehandLineDotted": FreehandLineDotted,
    "FreehandMainAttackArrow": FreehandMainAttackArrow,
    "FreehandSemiCircle": FreehandSemiCircle,
    "FreehandSemiCircleFilled": FreehandSemiCircleFilled,
    "FreehandSupportingAttack": FreehandSupportingAttack,
    "FriendlyDirOfMainAttk": FriendlyDirOfMainAttk,
    "FriendlyDirOfSpAttk": FriendlyDirOfSpAttk,
    "DirectionOfFeintAttack": DirectionOfFeintAttack,
    "FriendlyAviationAttack": FriendlyAviationAttack,
    "TargetAreaOfInterest": TargetAreaOfInterest,
    "NamedAreaOfInterest": NamedAreaOfInterest,
    "AssaultPosition": AssaultPosition,
    "Encirclement": Encirclement,
    "FortifiedArea": FortifiedArea,
    "AirfieldZone": AirfieldZone,
    "EngagementArea": EngagementArea,
    "DropZone": DropZone,
    "ExtractionZone": ExtractionZone,
    "PickupZone": PickupZone,
    "StratAssyArea": StratAssyArea,
    "SingleConcertina": SingleConcertina,
    "SingleFenceWire": SingleFenceWire,
    "TripleStrandConcertina": TripleStrandConcertina,
    "UARoute": UARoute,
    "SafeLane": SafeLane,
    "TransitCorridors": TransitCorridors,
    "MinimumRiskRoute": MinimumRiskRoute,
    "LowLevelTransitRoute": LowLevelTransitRoute,
    "HighDensityAirspaceControlZone": HighDensityAirspaceControlZone,
    "RestrictedOperationsZone": RestrictedOperationsZone,
    "AirToAirRestrictedOperationsZone": AirToAirRestrictedOperationsZone,
    "UnmannedAircraftRestrictedOperationsZone": UnmannedAircraftRestrictedOperationsZone,
    "WeaponEngagementZone": WeaponEngagementZone,
    "FighterEngagementZone": FighterEngagementZone,
    "JointEngagementZone": JointEngagementZone,
    "MissileEngagementZone": MissileEngagementZone,
    "LowAltitudeMissileEngagementZone": LowAltitudeMissileEngagementZone,
    "HighAltitudeMissileEngagementZone": HighAltitudeMissileEngagementZone,
    "ShortRangeAirDefenseEngagementZone": ShortRangeAirDefenseEngagementZone,
    "WeaponFreeZone": WeaponFreeZone,
    "UnspecifiedMine": UnspecifiedMine,
    "VitalArea": VitalArea,
    "WideAreaAntiTankMine": WideAreaAntiTankMine,
    "ZoneOfResponsibility": ZoneOfResponsibility,
    "Canalize": Canalize,
    "Contain": Contain,
    "CorpsAdmArea": CorpsAdmArea,
    "Corridors": Corridors,
    "Cover": Cover,
    "Delay": Delay,
    "DispersalArea": DispersalArea,
    "Disrupt": Disrupt,
    "DisruptObstacleEffect": DisruptObstacleEffect,
    "DitchEmpty": DitchEmpty,
    "DitchFilledWithWater": DitchFilledWithWater,
    "DivAdmArea": DivAdmArea,
    "DivLineOfNoPen": DivLineOfNoPen,
    "DoubleApronFence": DoubleApronFence,
    "DoubleFenceWire": DoubleFenceWire,
    "ObstacleZone": ObstacleZone,
    "ObstacleFreeZone": ObstacleFreeZone,
    "DoubleStrandConcertina": DoubleStrandConcertina,
    "Fix": Fix,
    "FlightRoute": FlightRoute,
    "FlightZone": FlightZone,
    "AirspaceArea": AirspaceArea,
    "FormingUpPoint": FormingUpPoint,
    "Funnel": Funnel,
    "FwdAssemblyArea": FwdAssemblyArea,
    "FwdLineOfTps": FwdLineOfTps,
    "Guard": Guard,
    "HighWireFence": HighWireFence,
    "InfiltrationLane": InfiltrationLane,
    "Isolate": Isolate,
    "KillingGr": KillingGr,
    "KillingZone": KillingZone,
    "LandingZone": LandingZone,
    "LineOfNoPen": LineOfNoPen,
    "LowWireFence": LowWireFence,
    "MovingConvoy": MovingConvoy,
    "NoGo": NoGo,
    "ObstacleBypassEasy": ObstacleBypassEasy,
    "Occupy": Occupy,
    "Penetrate": Penetrate,
    "PenetrationBox": PenetrationBox,
    "Retain": Retain,
    "Screen": Screen,
    "Secure": Secure,
    "SlowGo": SlowGo,
    "StrongPoint": StrongPoint,
    "SupportingAttack": SupportingAttack,
    "UnspecifiedWire": UnspecifiedWire,
    "VitalGr": VitalGr,
    "Withdraw": Withdraw,
    "WithdrawUnderPressure": WithdrawUnderPressure,
    "SupportByFirePosition": SupportByFirePosition,
    "PrincipalDirectionOfFire": PrincipalDirectionOfFire,
    "SearchReconnaissanceArea": SearchReconnaissanceArea,
    "Bypass": Bypass,
    "StartLine": StartLine,
    "ObjArea": ObjArea,
};

export default class Mapper {
    public symName: string = "";

    constructor(symName?: string) {
        if (symName) {
            this.symName = symName;
        }
    }

    public setSymName(symName: string): void {
        this.symName = symName;
    }

    public getInstance(): ISymbolConstructor {
        const symbolClass = SYMBOL_MAP[this.symName];
        if (!symbolClass) {
            throw new Error(`Symbol class ${this.symName} not found`);
        }

        return symbolClass;
    }
}
