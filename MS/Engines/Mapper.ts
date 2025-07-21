/*
import SupportByFirePosition from "./MilSymbologySymbols/SupportByFirePosition";
import BlockObstacleEffect from "./MilSymbologySymbols/BlockObstacleEffect";
import Block from "./MilSymbologySymbols/Block";
import Canalize from "./MilSymbologySymbols/Canalize";
import Breach from "./MilSymbologySymbols/Breach";
import Bypass from "./MilSymbologySymbols/Bypass";
import Penetrate from "./MilSymbologySymbols/Penetrate";
import Disrupt from "./MilSymbologySymbols/Disrupt";
import DisruptObstacleEffect from "./MilSymbologySymbols/DisruptObstacleEffect";
import ObstacleBypassEasy from "./MilSymbologySymbols/ObstacleBypassEasy";
import Funnel from "./MilSymbologySymbols/Funnel";
import SupportingAttack from "./MilSymbologySymbols/SupportingAttack";
import AxisOfAdvanceFeint from "./MilSymbologySymbols/AxisOfAdvanceFeint";
import CounterAttack from "./MilSymbologySymbols/CounterAttack";
import Boundary from "./MilSymbologySymbols/Boundary";
import Screen from "./MilSymbologySymbols/Screen";
import Cover from "./MilSymbologySymbols/Cover";
import Secure from "./MilSymbologySymbols/Secure";
import Guard from "./MilSymbologySymbols/Guard";
import Occupy from "./MilSymbologySymbols/Occupy";
import Isolate from "./MilSymbologySymbols/Isolate";

import CpenPosition from "./MilSymbologySymbols/CpenPosition";
import Withdraw from "./MilSymbologySymbols/Withdraw";
import Ambush from "./MilSymbologySymbols/Ambush";
import Contain from "./MilSymbologySymbols/Contain";
import WithdrawUnderPressure from "./MilSymbologySymbols/WithdrawUnderPressure";
import FriendlyDirOfSpAttk from "./MilSymbologySymbols/FriendlyDirOfSpAttk";
import FriendlyDirOfMainAttk from "./MilSymbologySymbols/FriendlyDirOfMainAttk";
import SingleFenceWire from "./MilSymbologySymbols/SingleFenceWire";
import DoubleApronFence from "./MilSymbologySymbols/DoubleApronFence";
import UnspecifiedWire from "./MilSymbologySymbols/UnspecifiedWire";
import DoubleFenceWire from "./MilSymbologySymbols/DoubleFenceWire";
import LowWireFence from "./MilSymbologySymbols/LowWireFence";
import HighWireFence from "./MilSymbologySymbols/HighWireFence";
import TripleStrandConcertina from "./MilSymbologySymbols/TripleStrandConcertina";
import DoubleStrandConcertina from "./MilSymbologySymbols/DoubleStrandConcertina";
import SingleConcertina from "./MilSymbologySymbols/SingleConcertina";
import PhaseLine from "./MilSymbologySymbols/PhaseLine";
import StartLine from "./MilSymbologySymbols/StartLine";
import FwdLineOfTps from "./MilSymbologySymbols/FwdLineOfTps";
import Delay from "./MilSymbologySymbols/Delay";
import PenetrationBox from "./MilSymbologySymbols/PenetrationBox";
import AssemblyArea from "./MilSymbologySymbols/AssemblyArea";
import AreaOfOperations from "./MilSymbologySymbols/AreaOfOperations";
import AttackPosition from "./MilSymbologySymbols/AttackPosition";
import NamedAreaOfInterest from "./MilSymbologySymbols/NamedAreaOfInterest";
import ZoneOfResponsibility from "./MilSymbologySymbols/ZoneOfResponsibility";
import KillingGr from "./MilSymbologySymbols/KillingGr";
import VitalGr from "./MilSymbologySymbols/VitalGr";
import KillingZone from "./MilSymbologySymbols/KillingZone";
import VitalArea from "./MilSymbologySymbols/VitalArea";
import LandingZone from "./MilSymbologySymbols/LandingZone";
import AntiPersonnelMine from "./MilSymbologySymbols/AntiPersonnelMine";
import AntiPersonnelMineDirEffct from "./MilSymbologySymbols/AntiPersonnelMineDirEffct";
import AntitankMine from "./MilSymbologySymbols/AntitankMine";
import AntiTankMineWAntiHandle from "./MilSymbologySymbols/AntiTankMineWAntiHandle";
import WideAreaAntiTankMine from "./MilSymbologySymbols/WideAreaAntiTankMine";
import UnspecifiedMine from "./MilSymbologySymbols/UnspecifiedMine";
import AntiPersonnelAntiTankMine from "./MilSymbologySymbols/AntiPersonnelAntiTankMine";
import CLineOfDenial from "./MilSymbologySymbols/CLineOfDenial";
import DivLineOfNoPen from "./MilSymbologySymbols/DivLineOfNoPen";
import FwdAssemblyArea from "./MilSymbologySymbols/FwdAssemblyArea";
import DivAdmArea from "./MilSymbologySymbols/DivAdmArea";
import ObjArea from "./MilSymbologySymbols/ObjArea";
import DispersalArea from "./MilSymbologySymbols/DispersalArea";
import StratAssyArea from "./MilSymbologySymbols/StratAssyArea";
import CorpsAdmArea from "./MilSymbologySymbols/CorpsAdmArea";
import BdeAdmArea from "./MilSymbologySymbols/BdeAdmArea";
import BridgeHeadLine from "./MilSymbologySymbols/BridgeHeadLine";
import Fix from "./MilSymbologySymbols/Fix";
import StrongPoint from "./MilSymbologySymbols/StrongPoint";
import InfiltrationLane from "./MilSymbologySymbols/InfiltrationLane";
import MovingConvoy from "./MilSymbologySymbols/MovingConvoy";
import CounterAttkObj from "./MilSymbologySymbols/CounterAttkObj";
import FormingUpPoint from "./MilSymbologySymbols/FormingUpPoint";
import UARoute from "./MilSymbologySymbols/UARoute";
import DitchEmpty from "./MilSymbologySymbols/DitchEmpty";
import DitchFilledWithWater from "./MilSymbologySymbols/DitchFilledWithWater";
import ArcOfFireSD from "./MilSymbologySymbols/ArcOfFireSD";
import TargetAreaOfInterest from "./MilSymbologySymbols/TargetAreaOfInterest";
import SlowGo from "./MilSymbologySymbols/SlowGo";
import NoGo from "./MilSymbologySymbols/NoGo";
import AvenueOfApchs from "./MilSymbologySymbols/AvenueOfApchs";
import ALineOfDenial from "./MilSymbologySymbols/ALineOfDenial";
import LineOfNoPen from "./MilSymbologySymbols/LineOfNoPen";
import BtleHndOvrLn from "./MilSymbologySymbols/BtleHndOvrLn";
import Corridors from "./MilSymbologySymbols/Corridors";
import BOPFreehand from "./MilSymbologySymbols/BOPFreehand";
import Bridge from "./MilSymbologySymbols/Bridge";
import FlightRoute from "./MilSymbologySymbols/FlightRoute";
import FlightZone from "./MilSymbologySymbols/FlightZone";
import FreehandLine from "./MilSymbologySymbols/FreehandLine";
import FreehandLineDotted from "./MilSymbologySymbols/FreehandLineDotted";
import FreehandArea from "./MilSymbologySymbols/FreehandArea";
import FreehandDoubleLineArrow from "./MilSymbologySymbols/FreehandDoubleLineArrow";

import FreehandDottedArrow from "./MilSymbologySymbols/FreehandDottedArrow";
import FreehandMainAttackArrow from "./MilSymbologySymbols/FreehandMainAttackArrow";
import FreehandSupportingAttack from "./MilSymbologySymbols/FreehandSupportingAttack";
import FreehandCloseSupportingAttack from "./MilSymbologySymbols/FreehandCloseSupportingAttack";

import FreehandSemiCircle from "./MilSymbologySymbols/FreehandSemiCircle";
import FreehandSemiCircleFilled from "./MilSymbologySymbols/FreehandSemiCircleFilled";
*/

import UEISymbol from "../Symbols/UEISymbol.ts";
import TacticalPoint from "../Symbols/TacticalPoint.ts";
import TacticalPointText from "../Symbols/TacticalPointText.ts";
import FreehandLine from "../Symbols/FreehandLine.ts";
import FreehandLineDotted from "../Symbols/FreehandLineDotted.ts";
import FreehandArea from "../Symbols/FreehandArea.ts";
import FreehandAreaFilled from "../Symbols/FreehandAreaFilled.ts";
import FreehandArrow from "../Symbols/FreehandArrow.ts";

import MainAttack from "../Symbols/MainAttack.ts";
import AttackByFirePosition from "../Symbols/AttackByFirePosition.ts";
import Clear from "../Symbols/Clear.ts";
import BattlePosition from "../Symbols/BattlePosition.ts";
import CounterAttack from "../Symbols/CounterAttack.ts";
import CounterAttkObj from "../Symbols/CounterAttkObj.ts";
import CpenPosition from "../Symbols/CpenPosition.ts";
import FreehandMainAttackArrow from "../Symbols/FreehandMainAttackArrow.ts";
import FreehandSemiCircle from "../Symbols/FreehandSemiCircle.ts";
import FreehandSemiCircleFilled from "../Symbols/FreehandSemiCircleFilled.ts";
import FreehandSupportingAttack from "../Symbols/FreehandSupportingAttack.ts";
import FriendlyDirOfMainAttk from "../Symbols/FriendlyDirOfMainAttk.ts";
import FriendlyDirOfSpAttk from "../Symbols/FriendlyDirOfSpAttk.ts";
import TargetAreaOfInterest from "../Symbols/TargetAreaOfInterest.ts";
import StratAssyArea from "../Symbols/StratAssyArea.ts";
import SingleConcertina from "../Symbols/SingleConcertina.ts";
import SingleFenceWire from "../Symbols/SingleFenceWire.ts";
import TripleStrandConcertina from "../Symbols/TripleStrandConcertina.ts";
import UARoute from "../Symbols/UARoute.ts";
import UnspecifiedMine from "../Symbols/UnspecifiedMine.ts";
import VitalArea from "../Symbols/VitalArea.ts";
import WideAreaAntiTankMine from "../Symbols/WideAreaAntiTankMine.ts";
import ZoneOfResponsibility from "../Symbols/ZoneOfResponsibility.ts";

import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

type ViewType = MapView | SceneView;

interface ISymbolConstructor {
    new (view: ViewType, isLine?: boolean): UEISymbol;  // Update this to return UEISymbol (or a more specific class type)
}

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
        const symbolMap: Record<string, ISymbolConstructor> = {
            /*
            "SupportByFirePosition": SupportByFirePosition,
            "AttackByFirePosition": AttackByFirePosition,
            "Clear": Clear,
            "BlockObstacleEffect": BlockObstacleEffect,
            "Block": Block,
            "Canalize": Canalize,
            "Breach": Breach,
            "Bypass": Bypass,
            "Penetrate": Penetrate,
            "Disrupt": Disrupt,
            "DisruptObstacleEffect": DisruptObstacleEffect,
            "ObstacleBypassEasy": ObstacleBypassEasy,
            "Funnel": Funnel,
            "SupportingAttack": SupportingAttack,
            "AxisOfAdvanceFeint": AxisOfAdvanceFeint,
            "CounterAttack": CounterAttack,
            "Boundary": Boundary,
            "Screen": Screen,
            "Cover": Cover,
            "Secure": Secure,
            "Guard": Guard,
            "Occupy": Occupy,
            "Isolate": Isolate,
            "BattlePosition": BattlePosition,
            "CpenPosition": CpenPosition,
            "Withdraw": Withdraw,
            "Ambush": Ambush,
            "Contain": Contain,
            "WithdrawUnderPressure": WithdrawUnderPressure,
            "FriendlyDirOfSpAttk": FriendlyDirOfSpAttk,
            "FriendlyDirOfMainAttk": FriendlyDirOfMainAttk,
            "SingleFenceWire": SingleFenceWire,
            "DoubleApronFence": DoubleApronFence,
            "UnspecifiedWire": UnspecifiedWire,
            "DoubleFenceWire": DoubleFenceWire,
            "LowWireFence": LowWireFence,
            "HighWireFence": HighWireFence,
            "TripleStrandConcertina": TripleStrandConcertina,
            "DoubleStrandConcertina": DoubleStrandConcertina,
            "SingleConcertina": SingleConcertina,
            "PhaseLine": PhaseLine,
            "StartLine": StartLine,
            "FwdLineOfTps": FwdLineOfTps,
            "Delay": Delay,
            "PenetrationBox": PenetrationBox,
            "AssemblyArea": AssemblyArea,
            "AreaOfOperations": AreaOfOperations,
            "AttackPosition": AttackPosition,
            "NamedAreaOfInterest": NamedAreaOfInterest,
            "ZoneOfResponsibility": ZoneOfResponsibility,
            "KillingGr": KillingGr,
            "VitalGr": VitalGr,
            "KillingZone": KillingZone,
            "VitalArea": VitalArea,
            "LandingZone": LandingZone,
            "AntiPersonnelMine": AntiPersonnelMine,
            "AntiPersonnelMineDirEffct": AntiPersonnelMineDirEffct,
            "AntitankMine": AntitankMine,
            "AntiTankMineWAntiHandle": AntiTankMineWAntiHandle,
            "WideAreaAntiTankMine": WideAreaAntiTankMine,
            "UnspecifiedMine": UnspecifiedMine,
            "AntiPersonnelAntiTankMine": AntiPersonnelAntiTankMine,
            "CLineOfDenial": CLineOfDenial,
            "DivLineOfNoPen": DivLineOfNoPen,
            "FwdAssemblyArea": FwdAssemblyArea,
            "DivAdmArea": DivAdmArea,
            "ObjArea": ObjArea,
            "DispersalArea": DispersalArea,
            "StratAssyArea": StratAssyArea,
            "CorpsAdmArea": CorpsAdmArea,
            "BdeAdmArea": BdeAdmArea,
            "BridgeHeadLine": BridgeHeadLine,
            "Fix": Fix,
            "StrongPoint": StrongPoint,
            "InfiltrationLane": InfiltrationLane,
            "MovingConvoy": MovingConvoy,
            "CounterAttkObj": CounterAttkObj,
            "FormingUpPoint": FormingUpPoint,
            "UARoute": UARoute,
            "DitchEmpty": DitchEmpty,
            "DitchFilledWithWater": DitchFilledWithWater,
            "ArcOfFireSD": ArcOfFireSD,
            "TargetAreaOfInterest": TargetAreaOfInterest,
            "SlowGo": SlowGo,
            "NoGo": NoGo,
            "AvenueOfApchs": AvenueOfApchs,
            "ALineOfDenial": ALineOfDenial,
            "LineOfNoPen": LineOfNoPen,
            "BtleHndOvrLn": BtleHndOvrLn,
            "Corridors": Corridors,
            "BOPFreehand": BOPFreehand,
            "Bridge": Bridge,
            "FlightRoute": FlightRoute,
            "FlightZone": FlightZone,
            "FreehandLine": FreehandLine,
            "FreehandLineDotted": FreehandLineDotted,
            "FreehandArea": FreehandArea,
            "FreehandDoubleLineArrow": FreehandDoubleLineArrow,
            "FreehandArrow": FreehandArrow,
            "FreehandDottedArrow": FreehandDottedArrow,
            "FreehandMainAttackArrow": FreehandMainAttackArrow,
            "FreehandSupportingAttack": FreehandSupportingAttack,
            "FreehandCloseSupportingAttack": FreehandCloseSupportingAttack,
            "FreehandAreaFilled": FreehandAreaFilled,
            "FreehandSemiCircle": FreehandSemiCircle,
            "FreehandSemiCircleFilled": FreehandSemiCircleFilled,
            "TacticalPointText": TacticalPointText,
            */
            "FreehandArrow": FreehandArrow,
            "FreehandLine": FreehandLine,
            "FreehandArea": FreehandArea,
            "FreehandAreaFilled": FreehandAreaFilled,
           "TacticalPointText": TacticalPointText,
            "TacticalPoint": TacticalPoint,
            "UEISymbol": UEISymbol,
            "MainAttack": MainAttack,
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
            "TargetAreaOfInterest": TargetAreaOfInterest,
            "StratAssyArea": StratAssyArea,
            "SingleConcertina": SingleConcertina,
            "SingleFenceWire": SingleFenceWire,
            "TripleStrandConcertina": TripleStrandConcertina,
            "UARoute": UARoute,
            "UnspecifiedMine": UnspecifiedMine,
            "VitalArea": VitalArea,
            "WideAreaAntiTankMine": WideAreaAntiTankMine,
            "ZoneOfResponsibility": ZoneOfResponsibility
        };

        const symbolClass = symbolMap[this.symName];
        if (!symbolClass) {
            throw new Error(`Symbol class ${this.symName} not found`);
        }

        return symbolClass;
    }
}