/**
 * Class Mapper.
 *
 * @class
 * @author Abdul Razak
 */


define(["dojo/_base/declare", 
    "MilSymbologySymbols/SupportByFirePosition", "MilSymbologySymbols/AttackByFirePosition", 
    "MilSymbologySymbols/Clear",  "MilSymbologySymbols/BlockObstacleEffect", "MilSymbologySymbols/Block",
    "MilSymbologySymbols/Canalize", "MilSymbologySymbols/Breach", "MilSymbologySymbols/Bypass",
    "MilSymbologySymbols/Penetrate", "MilSymbologySymbols/Disrupt", "MilSymbologySymbols/DisruptObstacleEffect",
    "MilSymbologySymbols/ObstacleBypassEasy", "MilSymbologySymbols/Funnel", 
    "MilSymbologySymbols/SupportingAttack", "MilSymbologySymbols/MainAttack",
    "MilSymbologySymbols/AxisOfAdvanceFeint", "MilSymbologySymbols/CounterAttack", "MilSymbologySymbols/Boundary",
    "MilSymbologySymbols/Screen", "MilSymbologySymbols/Cover", "MilSymbologySymbols/Secure", "MilSymbologySymbols/Guard", 
    "MilSymbologySymbols/Occupy", "MilSymbologySymbols/Isolate", "MilSymbologySymbols/BattlePosition", "MilSymbologySymbols/CpenPosition",
    "MilSymbologySymbols/Withdraw", "MilSymbologySymbols/Ambush", "MilSymbologySymbols/Contain",
    "MilSymbologySymbols/WithdrawUnderPressure", "MilSymbologySymbols/FriendlyDirOfSpAttk", 
    "MilSymbologySymbols/FriendlyDirOfMainAttk", "MilSymbologySymbols/SingleFenceWire", "MilSymbologySymbols/DoubleApronFence",
    "MilSymbologySymbols/UnspecifiedWire", "MilSymbologySymbols/DoubleFenceWire", "MilSymbologySymbols/LowWireFence",
    "MilSymbologySymbols/HighWireFence", "MilSymbologySymbols/TripleStrandConcertina", "MilSymbologySymbols/DoubleStrandConcertina",
    "MilSymbologySymbols/SingleConcertina", "MilSymbologySymbols/PhaseLine", "MilSymbologySymbols/StartLine", "MilSymbologySymbols/FwdLineOfTps",
    "MilSymbologySymbols/Delay", "MilSymbologySymbols/PenetrationBox", "MilSymbologySymbols/AssemblyArea",
    "MilSymbologySymbols/AreaOfOperations", "MilSymbologySymbols/AttackPosition", "MilSymbologySymbols/NamedAreaOfInterest", 
    "MilSymbologySymbols/ZoneOfResponsibility", 
    "MilSymbologySymbols/KillingGr", "MilSymbologySymbols/VitalGr", "MilSymbologySymbols/KillingZone",
    "MilSymbologySymbols/VitalArea", "MilSymbologySymbols/LandingZone",
    "MilSymbologySymbols/AntiPersonnelMine", "MilSymbologySymbols/AntiPersonnelMineDirEffct",
    "MilSymbologySymbols/AntitankMine", "MilSymbologySymbols/AntiTankMineWAntiHandle", "MilSymbologySymbols/WideAreaAntiTankMine",
    "MilSymbologySymbols/UnspecifiedMine", "MilSymbologySymbols/AntiPersonnelAntiTankMine", "MilSymbologySymbols/CLineOfDenial",
    "MilSymbologySymbols/DivLineOfNoPen", "MilSymbologySymbols/FwdAssemblyArea", "MilSymbologySymbols/DivAdmArea", "MilSymbologySymbols/ObjArea", "MilSymbologySymbols/DispersalArea", 
    "MilSymbologySymbols/StratAssyArea",
    "MilSymbologySymbols/CorpsAdmArea", "MilSymbologySymbols/BdeAdmArea",
    "MilSymbologySymbols/BridgeHeadLine", "MilSymbologySymbols/Fix",
    "MilSymbologySymbols/StrongPoint", "MilSymbologySymbols/InfiltrationLane", "MilSymbologySymbols/MovingConvoy",
    "MilSymbologySymbols/CounterAttkObj", "MilSymbologySymbols/FormingUpPoint", "MilSymbologySymbols/UARoute",
    "MilSymbologySymbols/DitchEmpty", "MilSymbologySymbols/DitchFilledWithWater", "MilSymbologySymbols/ArcOfFireSD",
    "MilSymbologySymbols/TargetAreaOfInterest", "MilSymbologySymbols/SlowGo", "MilSymbologySymbols/NoGo",
    "MilSymbologySymbols/AvenueOfApchs", "MilSymbologySymbols/ALineOfDenial", "MilSymbologySymbols/LineOfNoPen",
    "MilSymbologySymbols/BtleHndOvrLn", "MilSymbologySymbols/Corridors", "MilSymbologySymbols/BOPFreehand", 
    "MilSymbologySymbols/Bridge", "MilSymbologySymbols/FlightRoute", "MilSymbologySymbols/FlightZone",
    "MilSymbologySymbols/FreehandLine", "MilSymbologySymbols/FreehandLineDotted", "MilSymbologySymbols/FreehandArea",
    "MilSymbologySymbols/FreehandDoubleLineArrow", "MilSymbologySymbols/FreehandArrow", "MilSymbologySymbols/FreehandDottedArrow", 
    "MilSymbologySymbols/FreehandMainAttackArrow", "MilSymbologySymbols/FreehandSupportingAttack", "MilSymbologySymbols/FreehandCloseSupportingAttack",
    "MilSymbologySymbols/FreehandAreaFilled", "MilSymbologySymbols/FreehandSemiCircle", "MilSymbologySymbols/FreehandSemiCircleFilled",
    "MilSymbologySymbols/UEISymbol", "MilSymbologySymbols/TacticalPoint", "MilSymbologySymbols/TacticalPointText", "MilSymbologySymbols/TacticalPointTextBox", 
    "MilSymbologySymbols/VulnArea", "MilSymbologySymbols/ISRMsnArea", "MilSymbologySymbols/Ethernet", "MilSymbologySymbols/PASCOMS", "MilSymbologySymbols/OFC", 
    "MilSymbologySymbols/Wrls", "MilSymbologySymbols/MedevacMsnArea", "MilSymbologySymbols/LineOfContact"],
    function (declare, 
        SupportByFirePosition, AttackByFirePosition,
        Clear, BlockObstacleEffect, Block,
        Canalize, Breach, Bypass, 
        Penetrate, Disrupt, DisruptObstacleEffect,
        ObstacleBypassEasy, Funnel, SupportingAttack, MainAttack,
        AxisOfAdvanceFeint, CounterAttack, Boundary,
        Screen, Cover, Secure, Guard,
        Occupy, Isolate, BattlePosition, CpenPosition,
        Withdraw, Ambush, Contain,
        WithdrawUnderPressure, FriendlyDirOfSpAttk, 
        FriendlyDirOfMainAttk, SingleFenceWire, DoubleApronFence,
        UnspecifiedWire, DoubleFenceWire, LowWireFence,
        HighWireFence, TripleStrandConcertina, DoubleStrandConcertina,
        SingleConcertina, PhaseLine, StartLine, FwdLineOfTps,
        Delay, PenetrationBox, AssemblyArea,
        AreaOfOperations, AttackPosition, NamedAreaOfInterest,
        ZoneOfResponsibility, 
        KillingGr, VitalGr,KillingZone, 
        VitalArea, LandingZone,
        AntiPersonnelMine, AntiPersonnelMineDirEffct,
        AntitankMine, AntiTankMineWAntiHandle, WideAreaAntiTankMine,
        UnspecifiedMine, AntiPersonnelAntiTankMine, CLineOfDenial,
        DivLineOfNoPen, FwdAssemblyArea, DivAdmArea, ObjArea, DispersalArea,
        StratAssyArea,
        CorpsAdmArea, BdeAdmArea,
        BridgeHeadLine, Fix,
        StrongPoint, InfiltrationLane, MovingConvoy,
        CounterAttkObj, FormingUpPoint, UARoute,
        DitchEmpty, DitchFilledWithWater, ArcOfFireSD,
        TargetAreaOfInterest, SlowGo, NoGo,
        AvenueOfApchs, ALineOfDenial, LineOfNoPen,
        BtleHndOvrLn, Corridors,BOPFreehand,
        Bridge, FlightRoute,FlightZone,

        FreehandLine, FreehandLineDotted, FreehandArea,
        FreehandDoubleLineArrow, FreehandArrow, FreehandDottedArrow,
        FreehandMainAttackArrow, FreehandSupportingAttack, FreehandCloseSupportingAttack,
        FreehandAreaFilled, FreehandSemiCircle, FreehandSemiCircleFilled,
        UEISymbol ,TacticalPoint, TacticalPointText, TacticalPointTextBox,
        VulnArea, ISRMsnArea, Ethernet, PASCOMS, OFC, Wrls, MedevacMsnArea, LineOfContact) {

        var Mapper = declare(null, { declaredClass: "MilitarySymbology.Engines.Mapper",
        symName : "",
        constructor: function (symName) {
             this.symName = symName;
             
        },

        setSymName : function(symName) {
            this.symName = symName;
        },

        getInstance : function() {
            return require("MilSymbologySymbols/"+ this.symName);
        }
       });
        return Mapper;
    }); 

