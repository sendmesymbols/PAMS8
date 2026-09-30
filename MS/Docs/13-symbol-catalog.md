# Symbol Catalog

> Generated from `MS/Data/Symbols.json` by `tools/genSymbolCatalog.mjs`. Do not edit by hand; run `npm run docs:catalog`.

The catalog holds **1007** entries. The key is what you pass to the engine to pick a symbol.

## Geometry types

| SymGeoType | Meaning | Entries |
| --- | --- | --- |
| `FPoint` | Framed point symbol drawn from a SIDC (units, equipment, installations); uses `options` | 511 |
| `Point` | Tactical point symbol placed with one click; uses amplifier + drawEssentials | 325 |
| `Area` | Tactical area graphic (polygon) | 98 |
| `Line` | Tactical line graphic (polyline) | 73 |

## Implementation classes

| Class | Entries |
| --- | --- |
| `UEISymbol` | 511 |
| `TacticalPoint` | 323 |
| `FreehandAreaFilled` | 2 |
| `AirspaceArea` | 2 |
| `AutoShape` | 2 |
| `AutoShapeArrow` | 2 |
| `DropZone` | 1 |
| `ExtractionZone` | 1 |
| `PickupZone` | 1 |
| `Boundary` | 1 |
| `Corridors` | 1 |
| `AreaOfOperations` | 1 |
| `NamedAreaOfInterest` | 1 |
| `TargetAreaOfInterest` | 1 |
| `SlowGo` | 1 |
| `NoGo` | 1 |
| `AvenueOfApchs` | 1 |
| `AirfieldZone` | 1 |
| `MedevacMsnArea` | 1 |
| `FriendlyAviationAttack` | 1 |
| `FwdLineOfTps` | 1 |
| `PhaseLine` | 1 |
| `CounterAttkObj` | 1 |
| `FormingUpPoint` | 1 |
| `StartLine` | 1 |
| `PrincipalDirectionOfFire` | 1 |
| `FriendlyDirOfMainAttk` | 1 |
| `FriendlyDirOfSpAttk` | 1 |
| `DirectionOfFeintAttack` | 1 |
| `InfiltrationLane` | 1 |
| `BridgeHeadLine` | 1 |
| `Ambush` | 1 |
| `CLineOfDenial` | 1 |
| `ALineOfDenial` | 1 |
| `DivLineOfNoPen` | 1 |
| `LineOfNoPen` | 1 |
| `BtleHndOvrLn` | 1 |
| `AssemblyArea` | 1 |
| `FwdAssemblyArea` | 1 |
| `DivAdmArea` | 1 |
| `CorpsAdmArea` | 1 |
| `DispersalArea` | 1 |
| `StratAssyArea` | 1 |
| `BdeAdmArea` | 1 |
| `ISRMsnArea` | 1 |
| `Ethernet` | 1 |
| `PASCOMS` | 1 |
| `OFC` | 1 |
| `Wrls` | 1 |
| `FortifiedArea` | 1 |
| `BattlePosition` | 1 |
| `CpenPosition` | 1 |
| `StrongPoint` | 1 |
| `Contain` | 1 |
| `Retain` | 1 |
| `EngagementArea` | 1 |
| `FriendlyAirborneAviation` | 1 |
| `AttackHelicopter` | 1 |
| `MainAttack` | 1 |
| `SupportingAttack` | 1 |
| `AxisOfAdvanceFeint` | 1 |
| `Funnel` | 1 |
| `MultiHeadMainAttack` | 1 |
| `AssaultPosition` | 1 |
| `AttackPosition` | 1 |
| `ObjArea` | 1 |
| `Encirclement` | 1 |
| `PenetrationBox` | 1 |
| `AttackByFirePosition` | 1 |
| `SupportByFirePosition` | 1 |
| `SearchReconnaissanceArea` | 1 |
| `ArcOfFireSD` | 1 |
| `BOPFreehand` | 1 |
| `LowLevelTransitRoute` | 1 |
| `MinimumRiskRoute` | 1 |
| `SafeLane` | 1 |
| `TransitCorridors` | 1 |
| `UARoute` | 1 |
| `FlightRoute` | 1 |
| `FlightZone` | 1 |
| `HighDensityAirspaceControlZone` | 1 |
| `RestrictedOperationsZone` | 1 |
| `AirToAirRestrictedOperationsZone` | 1 |
| `UnmannedAircraftRestrictedOperationsZone` | 1 |
| `WeaponEngagementZone` | 1 |
| `FighterEngagementZone` | 1 |
| `JointEngagementZone` | 1 |
| `MissileEngagementZone` | 1 |
| `LowAltitudeMissileEngagementZone` | 1 |
| `HighAltitudeMissileEngagementZone` | 1 |
| `ShortRangeAirDefenseEngagementZone` | 1 |
| `WeaponFreeZone` | 1 |
| `VulnArea` | 1 |
| `ZoneOfResponsibility` | 1 |
| `KillingGr` | 1 |
| `VitalGr` | 1 |
| `KillingZone` | 1 |
| `VitalArea` | 1 |
| `LandingZone` | 1 |
| `ObstacleZone` | 1 |
| `ObstacleFreeZone` | 1 |
| `ObstacleRestrictedZone` | 1 |
| `BlockObstacleEffect` | 1 |
| `DisruptObstacleEffect` | 1 |
| `Turn` | 1 |
| `ObstacleBypassEasy` | 1 |
| `ObstacleBypassDifficult` | 1 |
| `ObstacleBypassImpossible` | 1 |
| `AntiPersonnelMine` | 1 |
| `AntiPersonnelMineDirEffct` | 1 |
| `AntitankMine` | 1 |
| `AntiTankMineWAntiHandle` | 1 |
| `WideAreaAntiTankMine` | 1 |
| `UnspecifiedMine` | 1 |
| `AntiPersonnelAntiTankMine` | 1 |
| `MinedArea` | 1 |
| `DecoyMinedArea` | 1 |
| `DecoyMinedAreaFenced` | 1 |
| `UXOArea` | 1 |
| `Bridge` | 1 |
| `ObstacleLine` | 1 |
| `DitchEmpty` | 1 |
| `DitchFilledWithWater` | 1 |
| `AntitankDitchReinforcedWithMines` | 1 |
| `AntitankWall` | 1 |
| `UnspecifiedWire` | 1 |
| `SingleFenceWire` | 1 |
| `DoubleFenceWire` | 1 |
| `DoubleApronFence` | 1 |
| `LowWireFence` | 1 |
| `HighWireFence` | 1 |
| `SingleConcertina` | 1 |
| `DoubleStrandConcertina` | 1 |
| `TripleStrandConcertina` | 1 |
| `LineOfContact` | 1 |
| `FortifiedLine` | 1 |
| `FARP` | 1 |
| `MovingConvoy` | 1 |
| `Block` | 1 |
| `Breach` | 1 |
| `Bypass` | 1 |
| `Canalize` | 1 |
| `Clear` | 1 |
| `CounterAttack` | 1 |
| `Withdraw` | 1 |
| `Disrupt` | 1 |
| `Fix` | 1 |
| `Isolate` | 1 |
| `Occupy` | 1 |
| `Penetrate` | 1 |
| `Retire` | 1 |
| `Secure` | 1 |
| `Cover` | 1 |
| `Guard` | 1 |
| `Screen` | 1 |
| `Delay` | 1 |
| `WithdrawUnderPressure` | 1 |
| `FreehandLine` | 1 |
| `FreehandArea` | 1 |
| `FreehandLineDotted` | 1 |
| `FreehandDoubleLineArrow` | 1 |
| `FreehandArrow` | 1 |
| `FreehandDottedArrow` | 1 |
| `FreehandMainAttackArrow` | 1 |
| `FreehandSupportingAttack` | 1 |
| `FreehandCloseSupportingAttack` | 1 |
| `TacticalPointText` | 1 |
| `TacticalPointTextBox` | 1 |
| `FreehandSemiCircle` | 1 |
| `FreehandSemiCircleFilled` | 1 |
| `CartoInformationModelSymbol` | 1 |

## Field reference

| Field | Meaning |
| --- | --- |
| `Class` | Implementation class name resolved by `Mapper.ts` |
| `Name` | Display name |
| `SymGeoType` | Geometry type (see above) |
| `Cat` | Category tags (e.g. `log`) |
| `Grp` | Group path used by the symbol browser |
| `Parameters` | Draw-time parameters (`Name`, `default`, `description`, `value`) |
| `isFreeHand`, `isObstacle`, `isAutoShape`, `Offset`, `Fill` | Optional behaviour flags where present |

## FPoint symbols

| Key | Name | Class | Group | Parameters |
| --- | --- | --- | --- | --- |
| `10110201` | Civil Gen Transport | `UEISymbol` | Land / Transport | size, ANGLE |
| `10110202` | Log | `UEISymbol` | Land / Log | size, ANGLE |
| `10110203` | Land Eqpt - SATCOM | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110204` | Land Eqpt - PATCOM | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110205` | Land Eqpt - PASCOM | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110206` | Land Eqpt - DEFCOM | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110207` | Land Eqpt - Node Cen | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110208` | National Guard | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10110209` | Army Light Radio Group | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110210` | Mujahid | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10110211` | Special Services Group | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10110212` | Ordnance | `UEISymbol` | Land / Log | size, ANGLE |
| `10110213` | Avn EME | `UEISymbol` | Land / Log | size, ANGLE |
| `10110214` | Army Medical Corps/ADS/FTC/AMSD | `UEISymbol` | Land / Log | size, ANGLE |
| `10110215` | Amb | `UEISymbol` | Land / Log | size, ANGLE |
| `10110216` | Loc Arty | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10110217` | Multi-Barrel Rocket Launcher | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10110218` | Multi Barrel Rocket Launcher (Self Propelled) | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10110219` | Log Area | `UEISymbol` | Land / Log | size, ANGLE |
| `10110220` | Special Services Group Light Commnado | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10110221` | CID | `UEISymbol` | Land / CID | size, ANGLE |
| `10110222` | Pakistan Rangers (Sind) | `UEISymbol` | Land / Pakistan Rangers | size, ANGLE |
| `10110223` | Land Eqpt - Data Cen | `UEISymbol` | Land / Comm | size, ANGLE |
| `10110301` | Tashkeel | `UEISymbol` | Land / Tashkeel | size, ANGLE |
| `10111000` | Sigs | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111001` | Sig - Radio | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111002` | Sig - Radio Relay | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111003` | Sig - Teletype | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111004` | Sig - Tactical Satellite | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111005` | Sig - Video Imagery (Combat Camera) | `UEISymbol` | Land / Sigs | size, ANGLE |
| `10111200` | Camera / Video Imagery | `UEISymbol` | Land / Camera | size, ANGLE |
| `10111201` | Ni Vision Camera | `UEISymbol` | Land / Camera | size, ANGLE |
| `10111300` | Army Svc Corps | `UEISymbol` | Land / Army Svc Corps | size, ANGLE |
| `10120400` | Anti Tank - Anti Armor - Armr | `UEISymbol` | Land / Anti Tank | size, ANGLE |
| `10120402` | Anti Tank - Anti Armor - Motorized | `UEISymbol` | Land / Anti Tank | size, ANGLE |
| `10120410` | Inf - LAT/Light Anti Tank | `UEISymbol` | Land / Anti Tank | size, ANGLE |
| `10120411` | Inf - Hy Anti Tank/HAT | `UEISymbol` | Land / Anti Tank | size, ANGLE |
| `10120500` | Armr | `UEISymbol` | Land / Armor | size, ANGLE |
| `10120600` | Army Avn/Avn Rotary Wing, Avn | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120601` | Aviation Rotary Wing Reconnaissance | `UEISymbol` | Land / Rotary Wing | size, ANGLE |
| `10120602` | Avn Combat Attk | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120603` | Aircraft | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120604` | Aircraft - Bomber | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120605` | Aircraft - Cargo | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120606` | Aircraft - Fighter | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120607` | Aircraft - Interceptor | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120608` | Aircraft - Tanker | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120609` | Aircraft - Utility | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120610` | Aircraft - Passenger | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120611` | Aircraft - Government | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120612` | Avn - Casevac | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120613` | Avn - Medevac | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120614` | Avn - Para Jump | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120616` | Medevac Aircraft/ Flt | `UEISymbol` | Land / Aviation | size, ANGLE |
| `10120700` | Composite Aviation (Fixed Wing and Rotary) | `UEISymbol` | Land / Composite Aviation | size, ANGLE |
| `10120801` | Aviation Fixed Wing Reconnaissance | `UEISymbol` | Land / Fixed Wing | size, ANGLE |
| `10121100` | Inf | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121101` | Inf - Amphibious | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121102` | Inf - MIB | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121103` | Inf - Main Gun Sys | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121104` | Inf - Motorized | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121105` | Inf - Fighting Veh | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121106` | Inf - Mtn | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121300` | Land Unit - Recce/Cavalry/Scout | `UEISymbol` | Land / Recce/Cavalry/Scout | size, ANGLE |
| `10121301` | Land Unit - Recce and Surv | `UEISymbol` | Land / Recce and Surv | size, ANGLE |
| `10121600` | Recce Unit | `UEISymbol` | Land / Recce | size, ANGLE |
| `10121800` | Special Ops Forces (SOF) | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121801` | Special Ops Forces (SOF) - Ground | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121806` | Para Mil Forces | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121807` | Sub Area | `UEISymbol` | Land / Sub Area | size, ANGLE |
| `10121808` | Assam Rifles | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121809` | Rashtriya Rifles | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121810` | Border Security Forces | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121811` | Sashastra Seema Bal | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121812` | Indo Tibetan Border Police | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121813` | Territorial Army | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10121814` | Central Reserver Police Force | `UEISymbol` | Land / Infantry | size, ANGLE |
| `10130100` | AD | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130101` | AD - Main Gun | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130102` | AD - Msl | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130103` | AD - Light Msl Unit | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130104` | AD - Med Msl Unit | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130105` | AD - Heavy Msl Unit | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130106` | Surface to Surface Msl Unit | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130107` | AADOC | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130108` | DOC | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130109` | DDOC | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130111` | AD Msl CP | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130112` | FAADC | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130113` | HIMAD | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130114` | LOMAD | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130115` | ESHORAD | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130116` | ASCC | `UEISymbol` | Land / Air Defense | size, ANGLE |
| `10130300` | Fd Arty | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10130301` | Fd Arty Self-propelled | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10130302` | Fd Arty - Tgt Acquisition | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10130303` | Mtn Arty | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10130395` | Fd Arty - HQ Element | `UEISymbol` | Land / Artillery | size, ANGLE |
| `10130800` | Mor | `UEISymbol` | Land / Mortar | size, ANGLE |
| `10130895` | Mor - HQ Element | `UEISymbol` | Land / Mortar | size, ANGLE |
| `10130900` | Survey | `UEISymbol` | Land / Survey | size, ANGLE |
| `10140104` | Recce Armr | `UEISymbol` | Land / Recce Armr | size, ANGLE |
| `10140700` | Engrs | `UEISymbol` | Land / Engineers | size, ANGLE |
| `10140701` | Engr - Mech | `UEISymbol` | Land / Engineers | size, ANGLE |
| `10140702` | Engr - Motorized | `UEISymbol` | Land / Engineers | size, ANGLE |
| `10140800` | Bomb Disposal | `UEISymbol` | Land / Bomb Disposal | size, ANGLE |
| `10141200` | MP | `UEISymbol` | Land / Military Police | size, ANGLE |
| `10150200` | CI | `UEISymbol` | Land / CI | size, ANGLE |
| `10150201` | OSINT | `UEISymbol` | Land / OSINT | size, ANGLE |
| `10150500` | Electronic Warfare (EW) | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150502` | EW Direction Finding | `UEISymbol` | Land / EW Direction Finding | size, ANGLE |
| `10150503` | EW - Intercept | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150504` | EW - Jamming | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150506` | EW - IWBRS HF Site | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150507` | EW - Fixed NB ROC | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150508` | EW - Manpack Interception/ DF/ Jammer Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150509` | EW - Mob Interception/ DF/ Jammer Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150510` | EW - Static Interception/ DF/ Jammer Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150511` | EW Unit | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150512` | EWOC | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150513` | EW - SAF | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150514` | EW - TA Cell | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150515` | EW - Static Interception/ Jammer Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150516` | EW - Static Jammer Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150517` | EW - Static Interception/ DF Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150518` | EW - Static DF Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150519` | EW - Static Interception Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150520` | EW - AGILE Sys ELINT Sta | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150521` | EW - Manpack PR-100 | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150522` | EW - Static EW Sys | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150523` | EW - Mob EW Sys | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150524` | EW - Manpack EW Sys | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150525` | EW - Ae EW Sys | `UEISymbol` | Land / Electronic Warfare | size, ANGLE |
| `10150700` | Interrogation | `UEISymbol` | Land / Interrogation | size, ANGLE |
| `10150800` | Jamming | `UEISymbol` | Land / Jamming | size, ANGLE |
| `10151000` | MI | `UEISymbol` | Land / Military Intelligence | size, ANGLE |
| `10161100` | EME | `UEISymbol` | Land / Maintainance | size, ANGLE |
| `10161300` | Medical | `UEISymbol` | Land / Medical | size, ANGLE |
| `10163600` | S&T | `UEISymbol` | Land / Supply & Transport | size, ANGLE |
| `10201400` | C&IT - HF | `UEISymbol` | Land Unit / C&IT - HF | size, ANGLE |
| `10201401` | C&IT - UHF | `UEISymbol` | Land Unit / C&IT - UHF | size, ANGLE |
| `10201402` | C&IT - VHF | `UEISymbol` | Land Unit / C&IT - VHF | size, ANGLE |
| `10201403` | ICT Node | `UEISymbol` | Land Unit / ICT Node | size, ANGLE |
| `10201404` | ICT - FCN | `UEISymbol` | Land Unit / ICT - FCN | size, ANGLE |
| `10201405` | ICT - NC | `UEISymbol` | Land Unit / ICT - NC | size, ANGLE |
| `10230301` | CRCP | `UEISymbol` | Land Unit / CRCP | size, ANGLE |
| `11110400` | Group/ Mob | `UEISymbol` | Organization / Group/Mob | size, ANGLE |
| `11110800` | Spy | `UEISymbol` | Land Civilian Unit / Spy | size, ANGLE |
| `11110801` | Ts | `UEISymbol` | Land Civilian Unit / Ts | size, ANGLE |
| `11111006` | Developmental Projects / WHAMs | `UEISymbol` | Organization / WHAMs | size, ANGLE |
| `15110100` | Rifle | `UEISymbol` | Land Eqpt / Rifle | size, ANGLE |
| `15110200` | MG | `UEISymbol` | Land Eqpt / Machine Gun | size, ANGLE |
| `15110201` | MG - Light | `UEISymbol` | Land Eqpt / Machine Gun | size, ANGLE |
| `15110202` | MG - Med | `UEISymbol` | Land Eqpt / Machine Gun | size, ANGLE |
| `15110203` | MG - Hy | `UEISymbol` | Land Eqpt / Machine Gun | size, ANGLE |
| `15110300` | Grenade Launcher | `UEISymbol` | Land Eqpt / Grenade Launcher | size, ANGLE |
| `15110301` | Grenade Launcher (Light) | `UEISymbol` | Land Eqpt / Grenade Launcher | size, ANGLE |
| `15110302` | Grenade Launcher (Medium) | `UEISymbol` | Land Eqpt / Grenade Launcher | size, ANGLE |
| `15110303` | Grenade Launcher (Heavy) | `UEISymbol` |  | size, ANGLE |
| `15110500` | AD Gun | `UEISymbol` | Land Eqpt / Air Defense Gun | size, ANGLE |
| `15110501` | AD Gun - Light | `UEISymbol` | Land Eqpt / Air Defense Gun | size, ANGLE |
| `15110502` | AD Gun - Med | `UEISymbol` | Land Eqpt / Air Defense Gun | size, ANGLE |
| `15110503` | AD Gun - Hy | `UEISymbol` | Land Eqpt / Air Defense Gun | size, ANGLE |
| `15110600` | Anti Tank Gun | `UEISymbol` | Land Eqpt / Anti Tank Gun | size, ANGLE |
| `15110601` | Anti Tank Gun - Light | `UEISymbol` | Land Eqpt / Anti Tank Gun | size, ANGLE |
| `15110602` | Anti Tank Gun - Med | `UEISymbol` | Land Eqpt / Anti Tank Gun | size, ANGLE |
| `15110603` | Anti Tank Gun - Hy | `UEISymbol` | Land Eqpt / Anti Tank Gun | size, ANGLE |
| `15110800` | Recoilless Gun | `UEISymbol` | Land Eqpt / Recoilless Gun | size, ANGLE |
| `15110801` | Recoilless Gun - Light | `UEISymbol` | Land Eqpt / Recoilless Gun | size, ANGLE |
| `15110802` | Recoilless Gun - Med | `UEISymbol` | Land Eqpt / Recoilless Gun | size, ANGLE |
| `15110803` | Recoilless Gun - Hy | `UEISymbol` | Land Eqpt / Recoilless Gun | size, ANGLE |
| `15110900` | Howitzer | `UEISymbol` | Land Eqpt / Howitzer | size, ANGLE |
| `15110901` | Howitzer - Light | `UEISymbol` | Land Eqpt / Howitzer | size, ANGLE |
| `15110902` | Howitzer - Med | `UEISymbol` | Land Eqpt / Howitzer | size, ANGLE |
| `15110903` | Howitzer - Heavy | `UEISymbol` | Land Eqpt / Howitzer | size, ANGLE |
| `15110904` | Arty Gun - Light | `UEISymbol` | Land Eqpt / Artillery Gun | size, ANGLE |
| `15110905` | Arty Gun - Med | `UEISymbol` | Land Eqpt / Artillery Gun | size, ANGLE |
| `15110906` | Arty Gun - Heavy | `UEISymbol` | Land Eqpt / Artillery Gun | size, ANGLE |
| `15111000` | Msl Launcher | `UEISymbol` | Land Eqpt / Missile Launcher | size, ANGLE |
| `15111100` | AD Msl Launcher | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111101` | AD Msl Launcher - Short Range | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111102` | AD Msl Launcher - Light(TLAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111103` | AD Msl Launcher - Light(TELAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111104` | AD Msl LauncheMsl Launcher - Med Range | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111105` | AD Msl Launcher - Med(TLAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111106` | AD Msl Launcher - Med(TELAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111107` | AD Msl Launcher - Long Range | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111108` | AD Msl Launcher - Hy(TLAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111109` | AD Msl Launcher - Hy(TELAR) | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `15111200` | Anti Tank Msl Launcher | `UEISymbol` | Land Eqpt / Anti Tank Missile Launcher | size, ANGLE |
| `15111300` | Surface to Surface Msl Launcher | `UEISymbol` | Land Eqpt / Surface to Surface Missile Launcher | size, ANGLE |
| `15111301` | SSM Launcher (Short range) | `UEISymbol` | Land Eqpt / Surface to Surface Missile Launcher | size, ANGLE |
| `15111302` | SSM Launcher (Intermediate / Medium Range) | `UEISymbol` | Land Eqpt / Surface to Surface Missile Launcher | size, ANGLE |
| `15111303` | SSM Launcher (Long Range) | `UEISymbol` | Land Eqpt / Surface to Surface Missile Launcher | size, ANGLE |
| `15111400` | Mor - Land Eqpt | `UEISymbol` | Land Eqpt / Mortar | size, ANGLE |
| `15111401` | Mor Light - Land Eqpt | `UEISymbol` | Land Eqpt / Mortar | size, ANGLE |
| `15111402` | Mor Med - Land Eqpt | `UEISymbol` | Land Eqpt / Mortar | size, ANGLE |
| `15111403` | Mor Hy - Land Eqpt | `UEISymbol` | Land Eqpt / Mortar | size, ANGLE |
| `15111500` | Single Rocket Launcher | `UEISymbol` | Land Eqpt / Single Rocket Launcher | size, ANGLE |
| `15111501` | Single Rocket Launcher - light | `UEISymbol` | Land Eqpt / Single Rocket Launcher | size, ANGLE |
| `15111502` | Single Rocket Launcher - medium | `UEISymbol` | Land Eqpt / Single Rocket Launcher | size, ANGLE |
| `15111503` | Single Rocket Launcher - heavy | `UEISymbol` | Land Eqpt / Single Rocket Launcher | size, ANGLE |
| `15111600` | Multiple Rocket Launcher | `UEISymbol` | Land Eqpt / Multiple Rocket Launcher | size, ANGLE |
| `15111601` | Multiple Rocket Launcher - Light | `UEISymbol` | Land Eqpt / Multiple Rocket Launcher | size, ANGLE |
| `15111602` | Multiple Rocket Launcher - Med | `UEISymbol` | Land Eqpt / Multiple Rocket Launcher | size, ANGLE |
| `15111603` | Multiple Rocket Launcher - Hy | `UEISymbol` | Land Eqpt / Multiple Rocket Launcher | size, ANGLE |
| `15111604` | MLRS | `UEISymbol` | Land Eqpt / Multiple Rocket Launcher | size, ANGLE |
| `15111700` | Anti Tank Rocket Launcher | `UEISymbol` | Land Eqpt / Anti Tank Rocket Launcher | size, ANGLE |
| `15111701` | Anti Tank Rocket Launcher - Light | `UEISymbol` | Land Eqpt / Anti Tank Rocket Launcher | size, ANGLE |
| `15111702` | Anti Tank Rocket Launcher - Med | `UEISymbol` | Land Eqpt / Anti Tank Rocket Launcher | size, ANGLE |
| `15111703` | Anti Tank Rocket Launcher - Hy | `UEISymbol` | Land Eqpt / Anti Tank Rocket Launcher | size, ANGLE |
| `15111704` | Fence Lt | `UEISymbol` | Land Eqpt / Fence Lt | size, ANGLE |
| `15120103` | APC | `UEISymbol` | Land Eqpt / APC | size, ANGLE |
| `15120200` | Tank | `UEISymbol` | Land Eqpt / Tank | size, ANGLE |
| `15120201` | Tank - Light | `UEISymbol` | Land Eqpt / Tank | size, ANGLE |
| `15120202` | Tank - Med | `UEISymbol` | Land Eqpt / Tank | size, ANGLE |
| `15120203` | Tank - Hy | `UEISymbol` | Land Eqpt / Tank | size, ANGLE |
| `15120300` | Tank Rec Veh | `UEISymbol` | Land Eqpt / Tank Recovery Vehicle | size, ANGLE |
| `15120301` | ARV - Light | `UEISymbol` | Land Eqpt / ARV - Light | size, ANGLE |
| `15120302` | ARV - Med | `UEISymbol` | Land Eqpt / ARV - Med | size, ANGLE |
| `15120303` | ARV - Hy | `UEISymbol` | Land Eqpt / ARV - Hy | size, ANGLE |
| `15130100` | Engr Bridge | `UEISymbol` | Land Eqpt / Engineer Bridge | size, ANGLE |
| `15130901` | Mine Clearing Vehicle (Trailer mounted) | `UEISymbol` | Land Eqpt / Mine Clearing Eqpt | size, ANGLE |
| `15130902` | Mine Clearing Vehicle (Troll Anti Mine) | `UEISymbol` | Land Eqpt / Mine Clearing Eqpt | size, ANGLE |
| `15131001` | Mechanical Mine Layer/ MML | `UEISymbol` | Land Eqpt / Mechanical Mine Layer | size, ANGLE |
| `15131100` | Engineer Vehicle Dozer | `UEISymbol` | Land Eqpt / Engineer Vehicle Dozer | size, ANGLE |
| `15140600` | Utility Vehicle Semi (Tractor Trailer) | `UEISymbol` | Land Eqpt / Utility Vehicle | size, ANGLE |
| `15140700` | Limited Cross-Country Truck | `UEISymbol` | Land Eqpt / Limited Cross-Country Truck | size, ANGLE |
| `15140800` | Cross-Country Truck | `UEISymbol` | Land Eqpt / Cross-Country Truck | size, ANGLE |
| `15150100` | Train - Locomotive | `UEISymbol` | Land Eqpt / Train | size, ANGLE |
| `15150200` | Train - Railcar | `UEISymbol` | Land Eqpt / Train | size, ANGLE |
| `15190000` | Msl Sp | `UEISymbol` | Land Eqpt / Missile Support | size, ANGLE |
| `15200300` | Booby Trap Eqpt | `UEISymbol` | Land Eqpt / Booby Trap | size, ANGLE |
| `15200400` | CBRN Eqpt | `UEISymbol` | Land Eqpt / CBRN Eqpt | size, ANGLE |
| `15210100` | Land Mine | `UEISymbol` | Land Eqpt / Land Mine | size, ANGLE |
| `15210200` | Antipersonnel Land Mine (APL) | `UEISymbol` | Land Eqpt / Antipersonnel Land Mine | size, ANGLE |
| `15210300` | Anti Tank Mine (Eqpt) | `UEISymbol` | Land Eqpt / Anti Tank Mine | size, ANGLE |
| `15210400` | IED | `UEISymbol` | Land Eqpt / IED | size, ANGLE |
| `15220300` | Sensor Radar | `UEISymbol` | Land Eqpt / Radar | size, ANGLE |
| `15220301` | Arty Radar | `UEISymbol` | Land Eqpt / Radar | size, ANGLE |
| `15220302` | Sound Ranging Radar | `UEISymbol` | Land Eqpt / Radar | size, ANGLE |
| `15220303` | AD Radar | `UEISymbol` | Land Eqpt / Radar | size, ANGLE |
| `15230100` | Land Eqpt - Amb | `UEISymbol` | Land Eqpt / Ambulance | size, ANGLE |
| `15230302` | Surv Radar | `UEISymbol` | Land eqpt / Surv Radar | size, ANGLE |
| `15230303` | Fire Con Radar | `UEISymbol` | Land eqpt / Fire Con Radar | size, ANGLE |
| `20110500` | Black List Loc | `UEISymbol` | Land Installation / Black List Loc | size, ANGLE |
| `20110600` | Chemical-Biological-Radiological and Nuclear (CBRN) | `UEISymbol` | Land Installation / CBRN | size, ANGLE |
| `20110701` | Land Instl - Bridge | `UEISymbol` | Land Installation / Bridge | size, ANGLE |
| `20111000` | Gray List Loc | `UEISymbol` | Land Installation / Gray List Loc | size, ANGLE |
| `20111400` | Msl and Space Sys Prod | `UEISymbol` | Land Installation / Missile and Space Systems Production | size, ANGLE |
| `20111600` | Printing Press / Printed Media | `UEISymbol` | Land Installation / Printing Press / Printed Media | size, ANGLE |
| `20111700` | Safe House | `UEISymbol` | Land Installation / Safe House | size, ANGLE |
| `20111800` | White List Loc | `UEISymbol` | Land Installation / White List Loc | size, ANGLE |
| `20112000` | Warehouse/ Storage Facility | `UEISymbol` | Land Installation / Warehouse/ Storage Facility | size, ANGLE |
| `20112200` | Relief Camp | `UEISymbol` | Land Installation / Relief Camp | size, ANGLE |
| `20112203` | Med Relief Camp | `UEISymbol` | Land Installation / Med Relief Camp | size, ANGLE |
| `20112204` | Transit Camp | `UEISymbol` | Land Installation / Transit Camp | size, ANGLE |
| `20120100` | Agriculture and Food Infra | `UEISymbol` | Land Installation / Agriculture and Food Infra | size, ANGLE |
| `20120204` | Banking Infra | `UEISymbol` | Land Installation / Banking Infra | size, ANGLE |
| `20120300` | Commercial Infra | `UEISymbol` | Land Installation / Commercial Infra | size, ANGLE |
| `20120305` | Hazardous Material Facility | `UEISymbol` | Land Installation / Hazardous Material Facility | size, ANGLE |
| `20120400` | Educational Facility Infra | `UEISymbol` | Land Installation / Educational Facility Infra | size, ANGLE |
| `20120402` | School | `UEISymbol` | Land Installation / School | size, ANGLE |
| `20120500` | Energy Facility Infra | `UEISymbol` | Land Installation / Energy Facility Infra | size, ANGLE |
| `20120504` | Petroleum Facility / POL Depot | `UEISymbol` | Land Installation / Petroleum Facility / POL Depot | size, ANGLE |
| `20120507` | Ord Depot | `UEISymbol` | Land Installation / Ord Depot | size, ANGLE |
| `20120508` | Sup Depot | `UEISymbol` | Land Installation / Sup Depot | size, ANGLE |
| `20120509` | Base Wksp | `UEISymbol` | Land Installation / Base Wksp | size, ANGLE |
| `20120600` | Government Site Infra | `UEISymbol` | Land Installation / Government Site Infra | size, ANGLE |
| `20120601` | Ammo Depot | `UEISymbol` | Land Installation / Ammo Depot | size, ANGLE |
| `20120702` | Hospital | `UEISymbol` | Land Installation / Hospital | size, ANGLE |
| `20120800` | Mil Infra | `UEISymbol` | Land Installation / Mil Infra | size, ANGLE |
| `20120802` | Mil Infra - Mil Base | `UEISymbol` | Land Installation / Mil Infra - Mil Base | size, ANGLE |
| `20120900` | Postal Svc Infra | `UEISymbol` | Land Installation / Postal Svc Infra | size, ANGLE |
| `20121000` | Public Venues Infra | `UEISymbol` | Land Installation / Public Venues Infra | size, ANGLE |
| `20121100` | Special Needs Infra | `UEISymbol` | Land Installation / Special Needs Infra | size, ANGLE |
| `20121200` | Comm Infra | `UEISymbol` | Land Installation / Comm Infra | size, ANGLE |
| `20121203` | Telecomm Tower | `UEISymbol` | Land Installation / Telecomm Tower | size, ANGLE |
| `20121300` | Tpt Infra | `UEISymbol` | Land Installation / Tpt Infra | size, ANGLE |
| `20121301` | Airport / Airbase | `UEISymbol` | Land Installation / Airport / Airbase | size, ANGLE |
| `20121305` | Helicopter Landing Site | `UEISymbol` | Land Installation / Helicopter Landing Site | size, ANGLE |
| `20121308` | Rest Stop | `UEISymbol` | Land Installation / Rest Stop | size, ANGLE |
| `20121400` | Water Sup Infra | `UEISymbol` | Land Installation / Water Sup Infra | size, ANGLE |
| `20121402` | Dam | `UEISymbol` | Land Installation / Dam | size, ANGLE |
| `20121404` | Ground Water Well | `UEISymbol` | Land Installation / Ground Water Well | size, ANGLE |
| `20121407` | Water Storage Tower | `UEISymbol` | Land Installation / Water Storage Tower | size, ANGLE |
| `20121410` | Water Sup Infra - Water | `UEISymbol` | Land Installation / Water Sup Infra - Water | size, ANGLE |
| `20121412` | Medical Facility | `UEISymbol` | Land Installation / Medical Facility | size, ANGLE |
| `20121413` | Maddarassa | `UEISymbol` | Land Installation / Maddarassa | size, ANGLE |
| `20121414` | Markaz | `UEISymbol` | Land Installation / Markaz | size, ANGLE |
| `20121415` | Proj Site | `UEISymbol` | Land Installation / Proj Site | size, ANGLE |
| `20121416` | Work Site | `UEISymbol` | Land Installation / Work Site | size, ANGLE |
| `20121417` | Adm Camp | `UEISymbol` | Land Installation / Adm Camp | size, ANGLE |
| `20121418` | Syphon | `UEISymbol` | Land Installation / Syphon | size, ANGLE |
| `20121419` | Barrage | `UEISymbol` | Land Installation / Barrage | size, ANGLE |
| `20121420` | Head Works | `UEISymbol` | Land Installation / Head Works | size, ANGLE |
| `20121421` | Hotel | `UEISymbol` | Land Installation / Hotel | size, ANGLE |
| `20121422` | House | `UEISymbol` | Land Installation / House | size, ANGLE |
| `20121423` | Rented House | `UEISymbol` | Land Installation / Rented House | size, ANGLE |
| `20121424` | Shrine | `UEISymbol` | Land Installation / Shrine | size, ANGLE |
| `20121425` | Vuln Place | `UEISymbol` | Land Installation / Vulnerable Place | size, ANGLE |
| `20121426` | Breaching Sec | `UEISymbol` | Land Installation / Breaching Sec | size, ANGLE |
| `20121427` | Flood Con Center | `UEISymbol` |  | size, ANGLE |
| `20121428` | Flood Relief Hub | `UEISymbol` | Land Installation / Flood Relief Hub | size, ANGLE |
| `20121429` | Disaster Mgmt Hub | `UEISymbol` | Land Installation / Disaster Mgmt Hub | size, ANGLE |
| `20121430` | Rly Line | `UEISymbol` | Land Installation / Rly Line | size, ANGLE |
| `20121431` | SEZ | `UEISymbol` | Land Installation / SEZ | size, ANGLE |
| `20121432` | Dry Port | `UEISymbol` | Land Installation / Dry Port | size, ANGLE |
| `20121433` | DTMB | `UEISymbol` | Land Installation / DTMB | size, ANGLE |
| `20121434` | Solar Power Park | `UEISymbol` | Land Installation / Solar Power Park | size, ANGLE |
| `20121435` | Orange Line | `UEISymbol` | Land Installation / Orange Line | size, ANGLE |
| `20121436` | Optical Fiber | `UEISymbol` | Land Installation / Optical Fiber | size, ANGLE |
| `20121437` | Wind Farm | `UEISymbol` | Land Installation / Wind Farm | size, ANGLE |
| `20121438` | Tx Line | `UEISymbol` | Land Installation / Tx Line | size, ANGLE |
| `20121439` | Coal | `UEISymbol` | Land Installation / Coal | size, ANGLE |
| `20121440` | Hydro | `UEISymbol` | Land Installation / Hydro | size, ANGLE |
| `20121441` | Motorway | `UEISymbol` | Land Installation / Motorway | size, ANGLE |
| `20121442` | COD | `UEISymbol` | Land Installation / COD | size, ANGLE |
| `20121443` | CAD | `UEISymbol` | Land Installation / CAD | size, ANGLE |
| `20121444` | FAD | `UEISymbol` | Land Installation / FAD | size, ANGLE |
| `20121445` | EME Spares Dep | `UEISymbol` | Land Installation / EME Spares Dep | size, ANGLE |
| `20121446` | OCP/BLP/Store Coy/TDR | `UEISymbol` | Land Installation / OCP/BLP/Store Coy/TDR | size, ANGLE |
| `20121447` | EME Recovery Post | `UEISymbol` | Land Installation / EME Recovery Post | size, ANGLE |
| `20121448` | EME - MRT | `UEISymbol` | Land Installation / EME - MRT | size, ANGLE |
| `20121449` | EME - SRT | `UEISymbol` | Land Installation / EME - SRT | size, ANGLE |
| `20121451` | AFV RG | `UEISymbol` |  | size, ANGLE |
| `20121452` | Arty RG | `UEISymbol` |  | size, ANGLE |
| `20121453` | Cl Rg/ SA Rg | `UEISymbol` |  | size, ANGLE |
| `20121454` | Short Rg | `UEISymbol` |  | size, ANGLE |
| `20121455` | Miniature Rg | `UEISymbol` |  | size, ANGLE |
| `20121456` | Sub Cal Rg | `UEISymbol` |  | size, ANGLE |
| `20121457` | Up/ Down Hill Rg | `UEISymbol` |  | size, ANGLE |
| `20121458` | Bullet Arrester Rg | `UEISymbol` |  | size, ANGLE |
| `20121459` | Ditch Cumb Bund (DCB) Facility | `UEISymbol` |  | size, ANGLE |
| `20121460` | Gren Throwing Rg | `UEISymbol` |  | size, ANGLE |
| `20121461` | NBCW/ CBRN Complex | `UEISymbol` |  | size, ANGLE |
| `20121462` | Trg Shed | `UEISymbol` |  | size, ANGLE |
| `20121463` | Close Quarter Battle CQB Rg | `UEISymbol` |  | size, ANGLE |
| `20121464` | Aslt Course Facility | `UEISymbol` |  | size, ANGLE |
| `20121465` | Counter Terrorism Complex (CTC) | `UEISymbol` |  | size, ANGLE |
| `20121466` | Quick Reaction Course (QRC) | `UEISymbol` |  | size, ANGLE |
| `20121467` | Infantry Reaction Course IRC | `UEISymbol` |  | size, ANGLE |
| `20121468` | Integrated Crew Reaction Course CRC/ICRC | `UEISymbol` |  | size, ANGLE |
| `20121469` | Stress Course Fire | `UEISymbol` |  | size, ANGLE |
| `20121470` | Pl Post | `UEISymbol` |  | size, ANGLE |
| `20121471` | Cine Tgt System/ CTTS | `UEISymbol` |  | size, ANGLE |
| `20121472` | Misc Facilities | `UEISymbol` |  | size, ANGLE |
| `20121473` | Sports Facilities | `UEISymbol` |  | size, ANGLE |
| `20121474` | FFR | `UEISymbol` |  | size, ANGLE |
| `30180000` | Reserves | `UEISymbol` | Sea surface / Reserves | size, ANGLE |
| `30180001` | CBG | `UEISymbol` | Sea surface / CBG | size, ANGLE |
| `30181000` | Helicopter Landing Site (Sea) | `UEISymbol` | Sea surface / Helicopter Landing Site | size, ANGLE |
| `40110101` | Arrest | `UEISymbol` | Land eqpt / Arrest | size, ANGLE |
| `40110102` | Arson | `UEISymbol` | Activities / Arson | size, ANGLE |
| `40110103` | Phy Attk | `UEISymbol` | Activities / Phy Attk | size, ANGLE |
| `40110104` | Suspicious Mov | `UEISymbol` | Land Civilian Unit / Suspicious Mov | size, ANGLE |
| `40110106` | Extortion | `UEISymbol` | Activities / Extortion | size, ANGLE |
| `40110108` | Tgt of Civ/Killing | `UEISymbol` | Land Civilian Unit / Tgt of Civ/Killing | size, ANGLE |
| `40110109` | Poisoning | `UEISymbol` | Activities / Poisoning | size, ANGLE |
| `40110110` | Mob Attk / Scuffle / Quarrel | `UEISymbol` | Activities / Mob Attk / Scuffle / Quarrel | size, ANGLE |
| `40110200` | Bomb | `UEISymbol` | Activities / Bomb | size, ANGLE |
| `40110201` | Bomb Threat | `UEISymbol` | Activities / Bomb Threat | size, ANGLE |
| `40110202` | Threat | `UEISymbol` | Activities / Threat | size, ANGLE |
| `40110203` | Shelling | `UEISymbol` | Activities / Shelling | size, ANGLE |
| `40110300` | IED Event | `UEISymbol` | Activities / IED Event | size, ANGLE |
| `40110301` | IED Explosion | `UEISymbol` | Activities / IED Explosion | size, ANGLE |
| `40110304` | IED Suicide Bomber | `UEISymbol` | Activities / IED Explosion | size, ANGLE |
| `40110305` | IED Rec | `UEISymbol` | Activities / IED Rec | size, ANGLE |
| `40110306` | B on B | `UEISymbol` | Activities / B on B | size, ANGLE |
| `40110307` | Adm Cas | `UEISymbol` | Activities / Adm Cas | size, ANGLE |
| `40110308` | Abduction / Kidnapping | `UEISymbol` | Activities / Abduction / Kidnapping | size, ANGLE |
| `40110309` | Electrocution | `UEISymbol` | Activities / Electrocution | size, ANGLE |
| `40110310` | Beheading | `UEISymbol` | Activities / Beheading | size, ANGLE |
| `40110311` | Change of Comd | `UEISymbol` | Activities / Change of Comd | size, ANGLE |
| `40110400` | Shooting / Attk on Civ LEAs | `UEISymbol` | Activities / Shooting / Attk on Civ LEAs | size, ANGLE |
| `40110401` | Sniping | `UEISymbol` | Activities / Sniping | size, ANGLE |
| `40110402` | En Sniping Response | `UEISymbol` | Activities / En Sniping Response | size, ANGLE |
| `40110403` | Tr Maint | `UEISymbol` | Activities / Tr Maint | size, ANGLE |
| `40110404` | Intercept | `UEISymbol` | Activities / Intercept | size, ANGLE |
| `40110405` | Dumping Activity | `UEISymbol` | Activities / Dumping Activity | size, ANGLE |
| `40110406` | Def Construction | `UEISymbol` | Activities / Def Construction | size, ANGLE |
| `40110407` | Own Dumping Activity | `UEISymbol` | Activities / Own Dumping Activity | size, ANGLE |
| `40110408` | Own Tr Maint | `UEISymbol` | Activities / Own Tr Maint | size, ANGLE |
| `40110409` | Suicidal Attk | `UEISymbol` | Activities / Suicidal Attk | size, ANGLE |
| `40110600` | Explosion | `UEISymbol` | Activities / Explosion | size, ANGLE |
| `40110601` | Explosion - Grenade | `UEISymbol` | Activities / Explosion - Grenade | size, ANGLE |
| `40110603` | Mine Expl / APM Blast | `UEISymbol` | Land Civilian Unit / Mine Expl / APM Blast | size, ANGLE |
| `40110604` | Incidents - Mor Fire Explosion | `UEISymbol` | Activities / Incidents - Mor Fire Explosion | size, ANGLE |
| `40110605` | Explosion - Rocket | `UEISymbol` | Activities / Explosion - Rocket | size, ANGLE |
| `40110606` | Explosion - Bomb | `UEISymbol` | Activities / Explosion - Bomb | size, ANGLE |
| `40110607` | UXO Blast | `UEISymbol` | Activities / UXO Blast | size, ANGLE |
| `40110608` | Fence Damage | `UEISymbol` | Activities / Fence Damage | size, ANGLE |
| `40120100` | Demonstration | `UEISymbol` | Activities / Demonstration | size, ANGLE |
| `40130100` | Patrolling | `UEISymbol` | Activities / Patrolling | size, ANGLE |
| `40130200` | Psy Ops | `UEISymbol` | Activities / Psy Ops | size, ANGLE |
| `40130201` | Propaganda | `UEISymbol` | Activities / Propaganda | size, ANGLE |
| `40130300` | Foraging Searching | `UEISymbol` | Activities / Foraging Searching | size, ANGLE |
| `40130301` | Combing | `UEISymbol` | Activities / Combing | size, ANGLE |
| `40130302` | IBO | `UEISymbol` | Activities / IBO | size, ANGLE |
| `40130303` | Snap Checking | `UEISymbol` | Activities / Snap Checking | size, ANGLE |
| `40130304` | Cordon and Search | `UEISymbol` | Activities / Cordon and Search | size, ANGLE |
| `40130401` | Willing Recruit | `UEISymbol` | Activities / Willing Recruit | size, ANGLE |
| `40130403` | Ft Mov (Sldrs) | `UEISymbol` | Activities / Ft Mov (Sldrs) | size, ANGLE |
| `40130404` | UNFS Team Visit | `UEISymbol` | Activities / UNFS Team Visit | size, ANGLE |
| `40130405` | Unit Mov | `UEISymbol` | Activities / Unit Mov | size, ANGLE |
| `40130406` | Mjdn Mov | `UEISymbol` | Activities / Mjdn Mov | size, ANGLE |
| `40130407` | Chinese Mov | `UEISymbol` | Activities / Chinese Mov | size, ANGLE |
| `40130408` | Mjdn Conc | `UEISymbol` | Activities / Mjdn Conc | size, ANGLE |
| `40130409` | Adm Activities | `UEISymbol` | Activities / Adm Activities | size, ANGLE |
| `40130410` | Firing Competition | `UEISymbol` | Activities / Firing Competition | size, ANGLE |
| `40130411` | Sports Competition | `UEISymbol` | Activities / Sports Competition | size, ANGLE |
| `40130412` | Field Excercise | `UEISymbol` | Activities / Field Excercise | size, ANGLE |
| `40130413` | Surgical Strike | `UEISymbol` | Activities / Surgical Strike | size, ANGLE |
| `40130414` | Chinese Violation | `UEISymbol` | Activities / Chinese Violation | size, ANGLE |
| `40130415` | Trg Ex | `UEISymbol` | Activities / Trg Ex | size, ANGLE |
| `40130416` | Tests/ Trials | `UEISymbol` | Activities / Tests/ Trials | size, ANGLE |
| `40130417` | Zaireen Mov | `UEISymbol` | Activities / Zaireen Mov | size, ANGLE |
| `40130418` | Ts Activity | `UEISymbol` | Activities / Ts Activity | size, ANGLE |
| `40130500` | Mine Laying / Mine Recharging | `UEISymbol` | Activities / Mine Laying / Mine Recharging | size, ANGLE |
| `40130800` | Exfiltration | `UEISymbol` | Activities / Exfiltration | size, ANGLE |
| `40130900` | Infiltration | `UEISymbol` | Activities / Infiltration | size, ANGLE |
| `40131000` | Meeting / Own HLC | `UEISymbol` | Activities / Meeting / Own HLC | size, ANGLE |
| `40131004` | En HLC | `UEISymbol` | Activities / En HLC | size, ANGLE |
| `40131005` | Border Crossing | `UEISymbol` | Activities / Border Crossing | size, ANGLE |
| `40131006` | Jirga | `UEISymbol` | Activities / Jirga | size, ANGLE |
| `40131007` | Shoora | `UEISymbol` | Activities / Shoora | size, ANGLE |
| `40131008` | Passenger Crossing | `UEISymbol` | Activities / Passenger Crossing | size, ANGLE |
| `40131009` | Veh Border Crossing | `UEISymbol` | Activities / Veh Border Crossing | size, ANGLE |
| `40131010` | Conf | `UEISymbol` | Activities / Conf | size, ANGLE |
| `40131200` | Cas Evac | `UEISymbol` | Activities / Cas Evac | size, ANGLE |
| `40131201` | Emergency Collection Evacuation Pt | `UEISymbol` | Activities / Emergency Collection Evacuation Pt | size, ANGLE |
| `40131209` | Rescue Op | `UEISymbol` | Activities / Rescue Op | size, ANGLE |
| `40131210` | Flag Meeting | `UEISymbol` | Activities / Flag Meeting | size, ANGLE |
| `40131211` | VDC Meeting | `UEISymbol` | Activities / VDC Meeting | size, ANGLE |
| `40131212` | Surv Lights | `UEISymbol` | Activities / Surv Lights | size, ANGLE |
| `40131300` | Heli Cas Msn | `UEISymbol` | Activities / Heli Cas Msn | size, ANGLE |
| `40131301` | EMT Sta Loc | `UEISymbol` | Activities / EMT Sta Loc | size, ANGLE |
| `40131304` | Emergency Medical Op - Morgue | `UEISymbol` | Activities / Emergency Medical Op - Morgue | size, ANGLE |
| `40131307` | Adm Heli Sorties | `UEISymbol` | Activities / Adm Heli Sorties | size, ANGLE |
| `40131308` | Hel Msn | `UEISymbol` | Activities / Hel Msn | size, ANGLE |
| `40131309` | Weather Events | `UEISymbol` | Activities / Weather Events | size, ANGLE |
| `40131310` | Visits | `UEISymbol` | Activities / Visits | size, ANGLE |
| `40131500` | LEA Ops | `UEISymbol` | Activities / LEA Ops | size, ANGLE |
| `40131507` | Police | `UEISymbol` | Activities / Police | size, ANGLE |
| `40131514` | Anti-Narco Trg Activities | `UEISymbol` | Activities / Anti-Narco Trg Activities | size, ANGLE |
| `40131515` | Anti-Narco Visits of Foreign Delegations | `UEISymbol` | Activities / Anti-Narco Visits of Foreign Delegations | size, ANGLE |
| `40131516` | Recovery of Narcotics | `UEISymbol` | Activities / Recovery of Narcotics | size, ANGLE |
| `40131517` | Imp Ctgy Rehs | `UEISymbol` | Activities / Imp Ctgy Rehs | size, ANGLE |
| `40131518` | Estbs Army Img Bldg Activity | `UEISymbol` | Activities / Estbs Army Img Bldg Activity | size, ANGLE |
| `40131519` | Mil Comds Visit | `UEISymbol` | Activities / Mil Comds Visit | size, ANGLE |
| `40131520` | Pol Ldrship Visit | `UEISymbol` | Activities / Pol Ldrship Visit | size, ANGLE |
| `40131521` | Media Visit | `UEISymbol` | Activities / Media Visit | size, ANGLE |
| `40131522` | Diplomat / Foreign Dignitaries Visit | `UEISymbol` | Activities / Diplomat / Foreign Dignitaries Visit | size, ANGLE |
| `40140000` | Fire Event | `UEISymbol` | Activities / Fire Event | size, ANGLE |
| `40140001` | CFV | `UEISymbol` | Activities / CFV | size, ANGLE |
| `40140002` | CFV Response | `UEISymbol` | Activities / CFV Response | size, ANGLE |
| `40140003` | En Speculative Fire | `UEISymbol` | Activities / En Speculative Fire | size, ANGLE |
| `40140004` | Practice Fire | `UEISymbol` | Activities / Practice Fire | size, ANGLE |
| `40140005` | Own Practice Fire | `UEISymbol` | Activities / Own Practice Fire | size, ANGLE |
| `40140006` | Own Speculative Fire | `UEISymbol` | Activities / Own Speculative Fire | size, ANGLE |
| `40140007` | Accidental Fire | `UEISymbol` | Activities / Accidental Fire | size, ANGLE |
| `40140008` | Lt On | `UEISymbol` | Activities / Lt On | size, ANGLE |
| `40140009` | Lt Off | `UEISymbol` | Activities / Lt Off | size, ANGLE |
| `40140800` | Jungle Fire | `UEISymbol` | Activities / Jungle Fire | size, ANGLE |
| `40150114` | Toxic Incident | `UEISymbol` | Activities / Toxic Incident | size, ANGLE |
| `40150115` | Hazard Materials Incident - Unexploded Ordnance | `UEISymbol` | Activities / Hazard Materials Incident - Unexploded Ordnance | size, ANGLE |
| `40160000` | Tpt Incident | `UEISymbol` | Activities / Tpt Incident | size, ANGLE |
| `40160100` | Tpt Incident - Air | `UEISymbol` | Activities / Tpt Incident - Air | size, ANGLE |
| `40160104` | Fire Raid | `UEISymbol` | Activities / Fire Raid | size, ANGLE |
| `40160105` | Physical Raid | `UEISymbol` | Activities / Physical Raid | size, ANGLE |
| `40160300` | Tpt Incident - Rail | `UEISymbol` | Activities / Tpt Incident - Rail | size, ANGLE |
| `40160400` | Tpt Incident - En Veh Mov | `UEISymbol` | Activities / Tpt Incident - En Veh Mov | size, ANGLE |
| `40160401` | Tpt Incident - Own Veh Mov | `UEISymbol` | Activities / Tpt Incident - Own Veh Mov | size, ANGLE |
| `40160402` | Trk Svc | `UEISymbol` | Activities / Trk Svc | size, ANGLE |
| `40160500` | Tpt Incident - Veh Mov | `UEISymbol` | Activities / Tpt Incident - Veh Mov | size, ANGLE |
| `40170000` | Lightening | `UEISymbol` | Activities / Lightening | size, ANGLE |
| `40170102` | Geologic - Avalanche Snow Slide | `UEISymbol` | Activities / Geologic - Avalanche Snow Slide | size, ANGLE |
| `40170103` | Geologic - Earthquake | `UEISymbol` | Activities / Geologic - Earthquake | size, ANGLE |
| `40170104` | Geologic - Landslide | `UEISymbol` | Activities / Geologic - Landslide | size, ANGLE |
| `40170202` | Flood | `UEISymbol` | Activities / Flood | size, ANGLE |
| `40170302` | Insect | `UEISymbol` | Activities / Insect | size, ANGLE |
| `40180201` | Incidents - Digging | `UEISymbol` | Activities / Incidents - Digging | size, ANGLE |
| `40180202` | Incidents - Mor Fire | `UEISymbol` | Activities / Incidents - Mor Fire | size, ANGLE |
| `40180203` | Incidents - Hy Wpn Fire - Light | `UEISymbol` | Activities / Incidents - Hy Wpn Fire - Light | size, ANGLE |
| `40180204` | Incidents - Hy Wpn Fire - Med | `UEISymbol` | Activities / Incidents - Hy Wpn Fire - Med | size, ANGLE |
| `40180205` | Incidents - Hy Wpn Fire - Hy | `UEISymbol` | Activities / Incidents - Hy Wpn Fire - Hy | size, ANGLE |
| `40180206` | Recce | `UEISymbol` | Activities / Recce | size, ANGLE |
| `40180207` | Protest | `UEISymbol` | Activities / Protest | size, ANGLE |
| `40180208` | Rally | `UEISymbol` | Activities / Rally | size, ANGLE |
| `40180209` | Sectarian Clash | `UEISymbol` | Activities / Sectarian Clash | size, ANGLE |
| `40180210` | Blocking of Rd | `UEISymbol` | Activities / Blocking of Rd | size, ANGLE |
| `40180211` | En Raised Red Flag | `UEISymbol` | Activities / En Raised Red Flag | size, ANGLE |
| `40180212` | Own Raised Red Flag | `UEISymbol` | Activities / Own Raised Red Flag | size, ANGLE |
| `40180213` | Press Conf | `UEISymbol` | Activities / Press Conf | size, ANGLE |
| `40180214` | Sanitization Op | `UEISymbol` | Activities / Sanitization Op | size, ANGLE |
| `40180215` | RSO | `UEISymbol` | Activities / RSO | size, ANGLE |
| `40180216` | ASO | `UEISymbol` | Activities / ASO | size, ANGLE |
| `40180217` | Curfew | `UEISymbol` | Activities / Curfew | size, ANGLE |
| `40180221` | Murder | `UEISymbol` | Activities / Murder | size, ANGLE |
| `40180222` | Execution | `UEISymbol` | Activities / Execution | size, ANGLE |
| `40180223` | Assassination | `UEISymbol` | Activities / Assassination | size, ANGLE |
| `40180224` | Refugees | `UEISymbol` | Activities / Refugees | size, ANGLE |
| `40180225` | Terrorist | `UEISymbol` | Activities / Terrorist | size, ANGLE |
| `40180226` | Foreign Fighters | `UEISymbol` | Activities / Foreign Fighters | size, ANGLE |
| `40180227` | Veh Hijacking | `UEISymbol` | Activities / Veh Hijacking | size, ANGLE |
| `01110104` | Fixed-Wing - Fighter | `UEISymbol` | Air / Fixed Wing / Fighter | size, ANGLE |
| `01110200` | Fixed-Wing - Rotary Wing | `UEISymbol` | Air / Fixed Wing / Rotary Wing | size, ANGLE |
| `01110300` | UA/ UAV/ UAS/ RPV | `UEISymbol` | Air / UAV | size, ANGLE |
| `01110301` | Quad-Copter | `UEISymbol` | Air / UAV | size, ANGLE |
| `02110000` | Air Msl | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |
| `06110000` | Space Msl | `UEISymbol` | Land Eqpt / Air Defense Missile Launcher | size, ANGLE |

## Point symbols

| Key | Name | Class | Group | Parameters |
| --- | --- | --- | --- | --- |
| `20121450` | Composite Ord Det | `TacticalPoint` | Land Installation / Composite Ord Det | size, ANGLE |
| `25120615` | Avn - Combat Team | `TacticalPoint` | Land / Aviation | size, ANGLE |
| `25130100` | Action Pts(Gen) | `TacticalPoint` | Control Measures / Action Pts(Gen) | SIZE, ANGLE |
| `25130200` | Amnesty Pt | `TacticalPoint` | Control Measures / Amnesty Pt | SIZE, ANGLE |
| `25130300` | CheckPt | `TacticalPoint` | Control Measures / CheckPt | SIZE, ANGLE |
| `25130301` | Joint Check Post | `TacticalPoint` | Control Measures / Joint Check Post | SIZE, ANGLE |
| `25130400` | Cen of Main Effort | `TacticalPoint` | Control Measures / Cen of Main Effort | SIZE, ANGLE |
| `25130500` | Contact Pt / U (Surface Unknown) | `TacticalPoint` | Control Measures / Contact Pt / U (Surface Unknown) | SIZE, ANGLE |
| `25130600` | Coordinating Pt | `TacticalPoint` | Control Measures / Coordinating Pt | SIZE, ANGLE |
| `25130700` | Decision Pt | `TacticalPoint` | Control Measures / Decision Pt | SIZE, ANGLE |
| `25130800` | Distress Call | `TacticalPoint` | Control Measures / Distress Call | SIZE, ANGLE |
| `25130900` | Entry Con Pt | `TacticalPoint` | Control Measures / Entry Con Pt | SIZE, ANGLE |
| `25131001` | Fly-To-Pt (Sonobuoy) | `TacticalPoint` | Control Measures / Fly-To-Pt (Sonobuoy) | SIZE, ANGLE |
| `25131002` | Fly-To-Pt(Wpn) | `TacticalPoint` | Control Measures / Fly-To-Pt(Wpn) | SIZE, ANGLE |
| `25131003` | Fly-To-Pt(Normal) | `TacticalPoint` | Control Measures / Fly-To-Pt(Normal) | SIZE, ANGLE |
| `25131100` | Linkup Pt | `TacticalPoint` | Control Measures / Linkup Pt | SIZE, ANGLE |
| `25131200` | Passage Pt | `TacticalPoint` | Control Measures / Passage Pt | SIZE, ANGLE |
| `25131300` | Pt of Interest | `TacticalPoint` | Control Measures / Pt of Interest | SIZE, ANGLE |
| `25131301` | Pt of Interest - Launch Event | `TacticalPoint` | Control Measures / Pt of Interest - Launch Event | SIZE, ANGLE |
| `25131400` | Rally Pt | `TacticalPoint` | Control Measures / Rally Pt | SIZE, ANGLE |
| `25131500` | Release Pt | `TacticalPoint` | Control Measures / Release Pt | SIZE, ANGLE |
| `25131600` | Start Pt | `TacticalPoint` | Control Measures / Start Pt | SIZE, ANGLE |
| `25131700` | Special Pt | `TacticalPoint` | Control Measures / Special Pt | SIZE, ANGLE |
| `25131800` | Waypoint / Destructions of Brs, rds etc | `TacticalPoint` | Control Measures / Waypoint | SIZE, ANGLE |
| `25131900` | Airfield(AEGIS Only) | `TacticalPoint` | Control Measures / Airfield(AEGIS Only) | SIZE, ANGLE |
| `25160100` | Obsn Post/Outpost(Unspecified) | `TacticalPoint` | Control Measures / Obsn Post/Outpost(Unspecified) | SIZE, ANGLE |
| `25160201` | Post / BOP | `TacticalPoint` | Control Measures / Post / BOP | SIZE, ANGLE |
| `25160202` | Fwd Observer Outpost/Posn | `TacticalPoint` | Control Measures / Fwd Observer Outpost/Posn | SIZE, ANGLE |
| `25160203` | NBC Obsn Post | `TacticalPoint` | Control Measures / NBC Obsn Post | SIZE, ANGLE |
| `25160204` | Sensor Outpost/Listening Post | `TacticalPoint` | Control Measures / Sensor Outpost/Listening Post | SIZE, ANGLE |
| `25160205` | Combat Outpost | `TacticalPoint` | Control Measures / Combat Outpost | SIZE, ANGLE |
| `25160206` | Recce Outpost | `TacticalPoint` | Control Measures / Recce Outpost | SIZE, ANGLE |
| `25160300` | Arty DF/Grid Origin | `TacticalPoint` | Control Measures / Arty DF/Grid Origin | SIZE, ANGLE |
| `25160301` | CP | `TacticalPoint` | Control Measures / CP | SIZE, ANGLE |
| `25160302` | FAC | `TacticalPoint` | Control Measures / FAC | SIZE, ANGLE |
| `25160303` | Tgt | `TacticalPoint` | Control Measures / Tgt | SIZE, ANGLE |
| `25160304` | Quarantine Center | `TacticalPoint` | Control Measures / Quarantine Center | SIZE, ANGLE |
| `25160305` | Testing Center | `TacticalPoint` | Control Measures / Testing Center | SIZE, ANGLE |
| `25160306` | Isolation Center | `TacticalPoint` | Control Measures / Isolation Center | SIZE, ANGLE |
| `25160400` | Pt of Departure | `TacticalPoint` | Control Measures / Pt of Departure | SIZE, ANGLE |
| `25180100` | Air Con Pt | `TacticalPoint` | Control Measures / Air Con Pt | SIZE, ANGLE |
| `25180200` | Comm Check Pt | `TacticalPoint` | Control Measures / Comm Check Pt | SIZE, ANGLE |
| `25180300` | Downed Aircrew Pick-Up Pont | `TacticalPoint` | Control Measures / Downed Aircrew Pick-Up Pont | SIZE, ANGLE |
| `25180400` | Pop-Up Pt (PUP) | `TacticalPoint` | Control Measures / Pop-Up Pt (PUP) | SIZE, ANGLE |
| `25180500` | Air Con Rendezvous | `TacticalPoint` | Control Measures / Air Con Rendezvous | SIZE, ANGLE |
| `25180600` | TACAN | `TacticalPoint` | Control Measures / TACAN | SIZE, ANGLE |
| `25180700` | CAP Sta | `TacticalPoint` | Control Measures / CAP Sta | SIZE, ANGLE |
| `25180800` | AEW Sta | `TacticalPoint` | Control Measures / AEW Sta | SIZE, ANGLE |
| `25180900` | ASW (Helo and F/W) Sta | `TacticalPoint` | Control Measures / ASW (Helo and F/W) Sta | SIZE, ANGLE |
| `25181000` | Strike Initial Pt | `TacticalPoint` | Control Measures / Strike Initial Pt | SIZE, ANGLE |
| `25181100` | Replenishment Sta | `TacticalPoint` | Control Measures / Replenishment Sta | SIZE, ANGLE |
| `25181101` | Replenishment Pt | `TacticalPoint` | Control Measures / Replenishment Pt | SIZE, ANGLE |
| `25181102` | POL Pt | `TacticalPoint` | Control Measures / POL Pt | SIZE, ANGLE |
| `25181200` | Tanking | `TacticalPoint` | Control Measures / Tanking | SIZE, ANGLE |
| `25181300` | Antisubmarine Warfare, Rotary Wing | `TacticalPoint` | Control Measures / Antisubmarine Warfare, Rotary Wing | SIZE, ANGLE |
| `25181400` | SUCAP - Fixed Wing | `TacticalPoint` | Control Measures / SUCAP - Fixed Wing | SIZE, ANGLE |
| `25181500` | SUCAP - Rotary Wing | `TacticalPoint` | Control Measures / SUCAP - Rotary Wing | SIZE, ANGLE |
| `25181600` | MIW - Fixed Wing | `TacticalPoint` | Control Measures / MIW - Fixed Wing | SIZE, ANGLE |
| `25181700` | MIW - Rotary Wing | `TacticalPoint` | Control Measures / MIW - Rotary Wing | SIZE, ANGLE |
| `25181800` | Tomcat | `TacticalPoint` | Control Measures / Tomcat | SIZE, ANGLE |
| `25181900` | Rescue | `TacticalPoint` | Control Measures / Rescue | SIZE, ANGLE |
| `25182000` | Unmanned Aerial Sys (UAS/UA) | `TacticalPoint` | Control Measures / Unmanned Aerial Sys (UAS/UA) | SIZE, ANGLE |
| `25182100` | VTUA | `TacticalPoint` | Control Measures / VTUA | SIZE, ANGLE |
| `25182200` | Orbit | `TacticalPoint` | Control Measures / Orbit | SIZE, ANGLE |
| `25182300` | Orbit - Figure Eight | `TacticalPoint` | Control Measures / Orbit | SIZE, ANGLE |
| `25182400` | Orbit - Race Track | `TacticalPoint` | Control Measures / Orbit | SIZE, ANGLE |
| `25182500` | Orbit - Random Closed | `TacticalPoint` | Control Measures / Orbit | SIZE, ANGLE |
| `25200500` | Active Maneuver Area | `TacticalPoint` | Control Measures / Active Maneuver Area | SIZE, ANGLE |
| `25200600` | Cued Acquisition Doctrine | `TacticalPoint` | Control Measures / Cued Acquisition Doctrine | SIZE, ANGLE |
| `25200700` | Radar Search Doctrine | `TacticalPoint` | Control Measures / Radar Search Doctrine | SIZE, ANGLE |
| `25210100` | Plan Ship / Merchant Ship | `TacticalPoint` | Control Measures / Plan Ship / Merchant Ship | SIZE, ANGLE |
| `25210200` | Aim Pt / Convoy Navy | `TacticalPoint` | Control Measures / Aim Pt / Convoy Navy | SIZE, ANGLE |
| `25210300` | Defended Asset | `TacticalPoint` | Control Measures / Defended Asset | SIZE, ANGLE |
| `25210400` | Drop Pt | `TacticalPoint` | Control Measures / Drop Pt | SIZE, ANGLE |
| `25210500` | Entry Pt | `TacticalPoint` | Control Measures / Entry Pt | SIZE, ANGLE |
| `25210600` | Air Detonation | `TacticalPoint` | Control Measures / Air Detonation | SIZE, ANGLE |
| `25210700` | Ground Zero | `TacticalPoint` | Control Measures / Ground Zero | SIZE, ANGLE |
| `25210800` | Impact Pt | `TacticalPoint` | Control Measures / Impact Pt | SIZE, ANGLE |
| `25210900` | Predicted Impact Pt | `TacticalPoint` | Control Measures / Predicted Impact Pt | SIZE, ANGLE |
| `25211000` | Launched Torpedo | `TacticalPoint` | Control Measures / Launched Torpedo | SIZE, ANGLE |
| `25211100` | Msl Detection Pt | `TacticalPoint` | Control Measures / Msl Detection Pt | SIZE, ANGLE |
| `25211200` | Acoustic Countermeasure(Decoy) | `TacticalPoint` | Control Measures / Acoustic Countermeasure(Decoy) | SIZE, ANGLE |
| `25211300` | Electronic Countermeasures (ECM) Decoy | `TacticalPoint` | Control Measures / Electronic Countermeasures (ECM) Decoy | SIZE, ANGLE |
| `25211400` | Brief Contact | `TacticalPoint` | Control Measures / Brief Contact | SIZE, ANGLE |
| `25211500` | Datum Lost Contact | `TacticalPoint` | Control Measures / Datum Lost Contact | SIZE, ANGLE |
| `25211600` | BT Buoy Drop | `TacticalPoint` | Control Measures / BT Buoy Drop | SIZE, ANGLE |
| `25211700` | Reported Bottomed Sub | `TacticalPoint` | Control Measures / Reported Bottomed Sub | SIZE, ANGLE |
| `25211800` | Moving Haven | `TacticalPoint` | Control Measures / Moving Haven | SIZE, ANGLE |
| `25211900` | Screen Cen | `TacticalPoint` | Control Measures / Screen Cen | SIZE, ANGLE |
| `25212000` | Lost Contact | `TacticalPoint` | Control Measures / Lost Contact | SIZE, ANGLE |
| `25212100` | Sinker | `TacticalPoint` | Control Measures / Sinker | SIZE, ANGLE |
| `25212200` | Trial Track | `TacticalPoint` | Control Measures / Trial Track | SIZE, ANGLE |
| `25212300` | Acoustic Fix | `TacticalPoint` | Control Measures / Acoustic Fix | SIZE, ANGLE |
| `25212400` | EM Fix | `TacticalPoint` | Control Measures / EM Fix | SIZE, ANGLE |
| `25212500` | EM-Magnetic Anomaly Detection (MAD) | `TacticalPoint` | Control Measures / EM-Magnetic Anomaly Detection (MAD) | SIZE, ANGLE |
| `25212600` | Optical Fix | `TacticalPoint` | Control Measures / Optical Fix | SIZE, ANGLE |
| `25212700` | Formation | `TacticalPoint` | Control Measures / Formation | SIZE, ANGLE |
| `25212800` | Harbor | `TacticalPoint` | Control Measures / Harbor | SIZE, ANGLE |
| `25213000` | Dip Posn | `TacticalPoint` | Control Measures / Dip Posn | SIZE, ANGLE |
| `25213100` | Search | `TacticalPoint` | Control Measures / Search | SIZE, ANGLE |
| `25213200` | Search Area | `TacticalPoint` | Control Measures / Search Area | SIZE, ANGLE |
| `25213300` | Search Cen | `TacticalPoint` | Control Measures / Search Cen | SIZE, ANGLE |
| `25213400` | Nav Ref Pt | `TacticalPoint` | Control Measures / Nav Ref Pt | SIZE, ANGLE |
| `25213500` | Sonobuoy | `TacticalPoint` | Control Measures / Sonobuoy | SIZE, ANGLE |
| `25213501` | Ambient Noise Sonobuoy | `TacticalPoint` | Control Measures / Ambient Noise Sonobuoy | SIZE, ANGLE |
| `25213502` | Air Transportable Comm (ATAC) | `TacticalPoint` | Control Measures / Air Transportable Comm (ATAC) | SIZE, ANGLE |
| `25213503` | Barra | `TacticalPoint` | Control Measures / Barra | SIZE, ANGLE |
| `25213504` | Bathythermograph Transmitting Sonobuoy (BT) | `TacticalPoint` | Control Measures / Bathythermograph Transmitting Sonobuoy (BT) | SIZE, ANGLE |
| `25213505` | Comd Active Multi-Beam Sonobuoy (CAMBS) | `TacticalPoint` | Control Measures / Comd Active Multi-Beam Sonobuoy (CAMBS) | SIZE, ANGLE |
| `25213506` | Comd Active Sonobuoy Directional Comd Active Sonobuoy Sys (CASS) | `TacticalPoint` | Control Measures / Comd Active Sonobuoy Directional Comd Active Sonobuoy Sys (CASS) | SIZE, ANGLE |
| `25213508` | Directional Comd Active Sonobuoy Sys (DICASS) | `TacticalPoint` | Control Measures / Directional Comd Active Sonobuoy Sys (DICASS) | SIZE, ANGLE |
| `25213509` | Expendable Reliable Acoustic Path Sonobuoy(ERAPS) | `TacticalPoint` | Control Measures / Expendable Reliable Acoustic Path Sonobuoy(ERAPS) | SIZE, ANGLE |
| `25213510` | Expired Sonobuoy | `TacticalPoint` | Control Measures / Expired Sonobuoy | SIZE, ANGLE |
| `25213511` | Sonobuoy, Kingpin | `TacticalPoint` | Control Measures / Sonobuoy, Kingpin | SIZE, ANGLE |
| `25213512` | Low Frequency Analyzing and Recording Sonobuoy (LOFAR) | `TacticalPoint` | Control Measures / Low Frequency Analyzing and Recording Sonobuoy (LOFAR) | SIZE, ANGLE |
| `25213513` | Pattern Cen Sonobuoy | `TacticalPoint` | Control Measures / Pattern Cen Sonobuoy | SIZE, ANGLE |
| `25213514` | Range Only Sonobuoy | `TacticalPoint` | Control Measures / Range Only Sonobuoy | SIZE, ANGLE |
| `25213515` | Vertical Line Array Directional Frequency Analysis and Recording (DIFAR) Sonobuoy | `TacticalPoint` | Control Measures / Vertical Line Array Directional Frequency Analysis and Recording (DIFAR) Sonobuoy | SIZE, ANGLE |
| `25213600` | Ref Pt | `TacticalPoint` | Control Measures / Ref Pt | SIZE, ANGLE |
| `25213700` | Special Pt-Ref Pts | `TacticalPoint` | Control Measures / Special Pt-Ref Pts | SIZE, ANGLE |
| `25213800` | Nav Ref Pt-Ref Pts | `TacticalPoint` | Control Measures / Nav Ref Pt | SIZE, ANGLE |
| `25213900` | Data Link Ref Pt | `TacticalPoint` | Control Measures / Data Link Ref Pt | SIZE, ANGLE |
| `25214000` | Arty Obsn Post | `TacticalPoint` | Control Measures / Arty Obsn Post | SIZE, ANGLE |
| `25214100` | Vital Area Cen | `TacticalPoint` | Control Measures / Vital Area Cen | SIZE, ANGLE |
| `25214200` | Corridor Tab Pt | `TacticalPoint` | Control Measures / Corridor Tab Pt | SIZE, ANGLE |
| `25214300` | En Pt | `TacticalPoint` | Control Measures / En Pt | SIZE, ANGLE |
| `25214400` | Marshall Pt | `TacticalPoint` | Control Measures / Marshall Pt | SIZE, ANGLE |
| `25214500` | Posn and Intended Movement (PIM) | `TacticalPoint` | Control Measures / Posn and Intended Movement (PIM) | SIZE, ANGLE |
| `25214600` | Pre-Landfall Waypoint | `TacticalPoint` | Control Measures / Pre-Landfall Waypoint | SIZE, ANGLE |
| `25214700` | Estimated Posn (EP) | `TacticalPoint` | Control Measures / Estimated Posn (EP) | SIZE, ANGLE |
| `25214800` | Waypoint-Ref Pts | `TacticalPoint` | Control Measures / Waypoint-Ref Pts | SIZE, ANGLE |
| `25214801` | Vuln Pt | `TacticalPoint` | Control Measures / Vuln Pt | SIZE, ANGLE |
| `25214803` | Fwd Area Arming and Refueling Pt (FAARP) | `TacticalPoint` | Control Measures / Fwd Area Arming and Refueling Pt (FAARP) | SIZE, ANGLE |
| `25214804` | Res | `TacticalPoint` | Control Measures / Res | SIZE, ANGLE |
| `25214812` | Armour Tank Recovery | `TacticalPoint` | Control Measures / Armour Tank Recovery | SIZE, ANGLE |
| `25214900` | Gen Subsurface Sta | `TacticalPoint` | Control Measures / Gen Subsurface Sta | SIZE, ANGLE |
| `25215000` | Submarine Subsurface Sta | `TacticalPoint` | Control Measures / Submarine Subsurface Sta | SIZE, ANGLE |
| `25215100` | Submarine Antisubmarine Warfare Subsurface Sta | `TacticalPoint` | Control Measures / Submarine Antisubmarine Warfare Subsurface Sta | SIZE, ANGLE |
| `25215200` | Unmanned Underwater Veh Subsurface Sta | `TacticalPoint` | Control Measures / Unmanned Underwater Veh Subsurface Sta | SIZE, ANGLE |
| `25215300` | Antisubmarine Warfare (ASW) Unmanned Underwater Veh Subsurface Sta | `TacticalPoint` | Control Measures / Antisubmarine Warfare (ASW) Unmanned Underwater Veh Subsurface Sta | SIZE, ANGLE |
| `25215400` | Mine Warfare Unmanned Underwater Veh Subsurface Sta | `TacticalPoint` | Control Measures / Mine Warfare Unmanned Underwater Veh Subsurface Sta | SIZE, ANGLE |
| `25215500` | Surface Warfare Unmanned Underwater Veh Subsurface Sta | `TacticalPoint` | Control Measures / Surface Warfare Unmanned Underwater Veh Subsurface Sta | SIZE, ANGLE |
| `25215600` | Gen Surface Sta | `TacticalPoint` | Control Measures / Gen Surface Sta | SIZE, ANGLE |
| `25215700` | Antisubmarine Warfare (ASW) Surface Sta | `TacticalPoint` | Control Measures / Antisubmarine Warfare (ASW) Surface Sta | SIZE, ANGLE |
| `25215800` | Mine Warfare Surface Sta | `TacticalPoint` | Control Measures / Mine Warfare Surface Sta | SIZE, ANGLE |
| `25215900` | Non-Combatant Surface Sta | `TacticalPoint` | Control Measures / Non-Combatant Surface Sta | SIZE, ANGLE |
| `25216000` | Picket Surface Sta | `TacticalPoint` | Control Measures / Picket Surface Sta | SIZE, ANGLE |
| `25216100` | Rendezvous Surface Sta | `TacticalPoint` | Control Measures / Rendezvous Surface Sta | SIZE, ANGLE |
| `25216200` | Replenishment at Sea Surface Sta | `TacticalPoint` | Control Measures / Replenishment at Sea Surface Sta | SIZE, ANGLE |
| `25216300` | Rescue Surface Sta | `TacticalPoint` | Control Measures / Rescue Surface Sta | SIZE, ANGLE |
| `25216400` | Surface Warfare Surface Sta | `TacticalPoint` | Control Measures / Surface Warfare Surface Sta | SIZE, ANGLE |
| `25216500` | Unmanned Underwater Veh Surface Sta | `TacticalPoint` | Control Measures / Unmanned Underwater Veh Surface Sta | SIZE, ANGLE |
| `25216600` | Antisubmarine Warfare (ASW) Unmanned Underwater Veh Surface Sta | `TacticalPoint` | Control Measures / Antisubmarine Warfare (ASW) Unmanned Underwater Veh Surface Sta | SIZE, ANGLE |
| `25216700` | Mine Warfare Unmanned Underwater Veh Surface Sta | `TacticalPoint` | Control Measures / Mine Warfare Unmanned Underwater Veh Surface Sta | SIZE, ANGLE |
| `25216800` | Remote Multi Msn Veh Unmanned Underwater Veh Surface Sta | `TacticalPoint` | Control Measures / Remote Multi Msn Veh Unmanned Underwater Veh Surface Sta | SIZE, ANGLE |
| `25216900` | Surface Warfare Unmanned Underwater Veh Surface Sta | `TacticalPoint` | Control Measures / Surface Warfare Unmanned Underwater Veh Surface Sta | SIZE, ANGLE |
| `25217000` | Shore Con Sta | `TacticalPoint` | Control Measures / Shore Con Sta | SIZE, ANGLE |
| `25217100` | Gen Route | `TacticalPoint` | Control Measures / Gen Route | SIZE, ANGLE |
| `25217200` | Diversion Route | `TacticalPoint` | Control Measures / Diversion Route | SIZE, ANGLE |
| `25217300` | Posn and Intended Movement (PIM) Route | `TacticalPoint` | Control Measures / Posn and Intended Movement (PIM) Route | SIZE, ANGLE |
| `25217400` | Picket Route | `TacticalPoint` | Control Measures / Picket Route | SIZE, ANGLE |
| `25217500` | Pt R Route | `TacticalPoint` | Control Measures / Pt R Route | SIZE, ANGLE |
| `25217600` | Rendezvous Route | `TacticalPoint` | Control Measures / Rendezvous Route | SIZE, ANGLE |
| `25217700` | Waypoint Route | `TacticalPoint` | Control Measures / Waypoint Route | SIZE, ANGLE |
| `25217800` | Clutter, Staary or Cease Reporting | `TacticalPoint` | Control Measures / Clutter, Staary or Cease Reporting | SIZE, ANGLE |
| `25217900` | Tentative or Provisional Track | `TacticalPoint` | Control Measures / Tentative or Provisional Track | SIZE, ANGLE |
| `25218000` | Distressed Vessel | `TacticalPoint` | Control Measures / Distressed Vessel | SIZE, ANGLE |
| `25218100` | Ditched Aircraft/Downed Aircraft | `TacticalPoint` | Control Measures / Ditched Aircraft/Downed Aircraft | SIZE, ANGLE |
| `25218200` | Person In Water/Bailout | `TacticalPoint` | Control Measures / Person In Water/Bailout | SIZE, ANGLE |
| `25218300` | Iceberg | `TacticalPoint` | Control Measures / Iceberg | SIZE, ANGLE |
| `25218500` | Oil Rig | `TacticalPoint` | Control Measures / Oil Rig | SIZE, ANGLE |
| `25218600` | Sea Mine-Like | `TacticalPoint` | Control Measures / Sea Mine-Like | SIZE, ANGLE |
| `25218700` | Bottom Return/Non-Mine, Mine Like Bottom Object(NOMBO) | `TacticalPoint` | Control Measures / Bottom Return/Non-Mine, Mine Like Bottom Object(NOMBO) | SIZE, ANGLE |
| `25218800` | Bottom Return/Non-Mine, MineLike Bottom Object(NOMBO)/Instl/Manmade | `TacticalPoint` | Control Measures / Bottom Return/Non-Mine, MineLike Bottom Object(NOMBO)/Instl/Manmade | SIZE, ANGLE |
| `25218900` | Marine Life | `TacticalPoint` | Control Measures / Marine Life | SIZE, ANGLE |
| `25219000` | Sea Anomaly(Wake, Current,Knuckle) | `TacticalPoint` | Control Measures / Sea Anomaly(Wake, Current,Knuckle) | SIZE, ANGLE |
| `25219100` | Bottom Return / Non MILCO, Wreck ,Dangerous | `TacticalPoint` | Control Measures / Bottom Return / Non MILCO, Wreck ,Dangerous | SIZE, ANGLE |
| `25219200` | Bottom Return/ Non MILCO,Wreck,Non Dangerous | `TacticalPoint` | Control Measures / Bottom Return/ Non MILCO,Wreck,Non Dangerous | SIZE, ANGLE |
| `25240603` | Tgt-Recorded | `TacticalPoint` | Control Measures / Tgt-Recorded | SIZE, ANGLE |
| `25240900` | Fire Sp Sta | `TacticalPoint` | Control Measures / Fire Sp Sta | SIZE, ANGLE |
| `25250100` | Firing Pt | `TacticalPoint` | Control Measures / Firing Pt | SIZE, ANGLE |
| `25250200` | Hide Pt | `TacticalPoint` | Control Measures / Hide Pt | SIZE, ANGLE |
| `25250300` | Launch Pt | `TacticalPoint` | Control Measures / Launch Pt | SIZE, ANGLE |
| `25250400` | Reload Pt | `TacticalPoint` | Control Measures / Reload Pt | SIZE, ANGLE |
| `25250500` | Survey Con Pt | `TacticalPoint` | Control Measures / Survey Con Pt | SIZE, ANGLE |
| `25271204` | Road Cratering / Road block | `TacticalPoint` | Control Measures / Road Cratering / Road block | SIZE, ANGLE |
| `25271205` | Aircraft Carrier | `TacticalPoint` | Control Measures / Aircraft Carrier | SIZE, ANGLE |
| `25271206` | Aircraft Carrier (Msl Armed) | `TacticalPoint` | Control Measures / Aircraft Carrier (Msl Armed) | SIZE, ANGLE |
| `25271207` | Aircraft Carrier Force | `TacticalPoint` | Control Measures / Aircraft Carrier Force | SIZE, ANGLE |
| `25271208` | MineLayer | `TacticalPoint` | Control Measures / MineLayer | SIZE, ANGLE |
| `25271209` | Helicopter | `TacticalPoint` | Control Measures / Helicopter | SIZE, ANGLE |
| `25271210` | Armed Merchant Cruiser | `TacticalPoint` | Control Measures / Armed Merchant Cruiser | SIZE, ANGLE |
| `25271211` | Submarine Subsurfaced / Submerged / Sonrting | `TacticalPoint` | Control Measures / Submarine Subsurfaced / Submerged / Sonrting | SIZE, ANGLE |
| `25271212` | Fishing Vessel / AG | `TacticalPoint` | Control Measures / Fishing Vessel / AG | SIZE, ANGLE |
| `25271213` | Flagship | `TacticalPoint` | Control Measures / Flagship | SIZE, ANGLE |
| `25271214` | Mayday / Ditched Aircraft | `TacticalPoint` | Control Measures / Mayday / Ditched Aircraft | SIZE, ANGLE |
| `25271215` | Master Jezbuoy | `TacticalPoint` | Control Measures / Master Jezbuoy | SIZE, ANGLE |
| `25271216` | Refined Kingpin | `TacticalPoint` | Control Measures / Refined Kingpin | SIZE, ANGLE |
| `25271217` | Expired Buoy | `TacticalPoint` | Control Measures / Expired Buoy | SIZE, ANGLE |
| `25271218` | N (Surface Friend) | `TacticalPoint` | Control Measures / N (Surface Friend) | SIZE, ANGLE |
| `25271219` | Radar Servicale / Unservicable | `TacticalPoint` | Control Measures / Radar Servicale / Unservicable | SIZE, ANGLE |
| `25271220` | SMCC | `TacticalPoint` | Control Measures / SMCC | SIZE, ANGLE |
| `25271221` | OCC | `TacticalPoint` | Control Measures / OCC | SIZE, ANGLE |
| `25271222` | Bulls Eye | `TacticalPoint` | Control Measures / Bulls Eye | SIZE, ANGLE |
| `25271223` | TWCC | `TacticalPoint` | Control Measures / TWCC | SIZE, ANGLE |
| `25271224` | ADOC / Nav Pt | `TacticalPoint` | Control Measures / ADOC / Nav Pt | SIZE, ANGLE |
| `25271225` | Vital Pt | `TacticalPoint` | Control Measures / Vital Pt | SIZE, ANGLE |
| `25271226` | Ground Force Friendly / Hostile | `TacticalPoint` | Control Measures / Ground Force Friendly / Hostile | SIZE, ANGLE |
| `25271227` | Ship Friendly / Hostile | `TacticalPoint` | Control Measures / Ship Friendly / Hostile | SIZE, ANGLE |
| `25271228` | Gun Avn / Not Avn | `TacticalPoint` | Control Measures / Gun Avn / Not Avn | SIZE, ANGLE |
| `25271229` | SAM Site Avn / Not Avn | `TacticalPoint` | Control Measures / SAM Site Avn / Not Avn | SIZE, ANGLE |
| `25271230` | Air Base Operable Friendly / Hostile | `TacticalPoint` | Control Measures / Air Base Operable Friendly / Hostile | SIZE, ANGLE |
| `25271231` | Land Mark | `TacticalPoint` | Control Measures / Land Mark | SIZE, ANGLE |
| `25271232` | ADCP | `TacticalPoint` | Control Measures / ADCP | SIZE, ANGLE |
| `25271233` | H (Hostile Surface) | `TacticalPoint` | Control Measures / H (Hostile Surface) | SIZE, ANGLE |
| `25271234` | Restricted Area | `TacticalPoint` | Control Measures / Restricted Area | SIZE, ANGLE |
| `25271236` | Air Msl (Unknow / Hostile / Friendly) | `TacticalPoint` | Control Measures / Air Msl (Unknow / Hostile / Friendly) | SIZE, ANGLE |
| `25271237` | SAM Site (En / SU) | `TacticalPoint` | Control Measures / SAM Site (En / SU) | SIZE, ANGLE |
| `25271238` | Air Base (Hostile / SU) | `TacticalPoint` | Control Measures / Air Base (Hostile / SU) | SIZE, ANGLE |
| `25271239` | Strike Not Specified (Hostile / Friendly) | `TacticalPoint` | Control Measures / Strike Not Specified (Hostile / Friendly) | SIZE, ANGLE |
| `25271240` | H (Air Hostile) | `TacticalPoint` | Control Measures / H (Air Hostile) | SIZE, ANGLE |
| `25271241` | F (Air Friend) | `TacticalPoint` | Control Measures / F (Air Friend) | SIZE, ANGLE |
| `25271242` | SU ASRT (Radar) | `TacticalPoint` | Control Measures / SU ASRT (Radar) | SIZE, ANGLE |
| `25271243` | Own ERIEYE Aircraft | `TacticalPoint` | Control Measures / Own ERIEYE Aircraft | SIZE, ANGLE |
| `25271244` | U (Air Unknow) | `TacticalPoint` | Control Measures / U (Air Unknow) | SIZE, ANGLE |
| `25271245` | Strike Sp | `TacticalPoint` | Control Measures / Strike Sp | SIZE, ANGLE |
| `25271246` | MHQ SU | `TacticalPoint` | Control Measures / MHQ SU | SIZE, ANGLE |
| `25271247` | Emergency | `TacticalPoint` | Control Measures / Emergency | SIZE, ANGLE |
| `25271248` | Special Msn | `TacticalPoint` | Control Measures / Special Msn | SIZE, ANGLE |
| `25271249` | Air Sta | `TacticalPoint` | Control Measures / Air Sta | SIZE, ANGLE |
| `25271250` | Helo | `TacticalPoint` | Control Measures / Helo | SIZE, ANGLE |
| `25271251` | Hazard | `TacticalPoint` | Control Measures / Hazard | SIZE, ANGLE |
| `25271252` | Gen Sta / Gen Ref Pt | `TacticalPoint` | Control Measures / Gen Sta / Gen Ref Pt | SIZE, ANGLE |
| `25271253` | JF 17 | `TacticalPoint` | Control Measures / JF 17 | SIZE, ANGLE |
| `25271254` | MIR | `TacticalPoint` | Control Measures / MIR | SIZE, ANGLE |
| `25271255` | F 7 | `TacticalPoint` | Control Measures / F 7 | SIZE, ANGLE |
| `25271256` | F 16 | `TacticalPoint` | Control Measures / F 16 | SIZE, ANGLE |
| `25271257` | Msl Site | `TacticalPoint` | Control Measures / Msl Site | SIZE, ANGLE |
| `25271258` | Decoy | `TacticalPoint` | Control Measures / Decoy | SIZE, ANGLE |
| `25271259` | Chaff Jamming | `TacticalPoint` | Control Measures / Chaff Jamming | SIZE, ANGLE |
| `25271260` | Contact Faded | `TacticalPoint` | Control Measures / Contact Faded | SIZE, ANGLE |
| `25271261` | Contact Lost | `TacticalPoint` | Control Measures / Contact Lost | SIZE, ANGLE |
| `25271262` | Airfield | `TacticalPoint` | Control Measures / Airfield | SIZE, ANGLE |
| `25271263` | Oil Rig (Boxed) | `TacticalPoint` | Control Measures / Oil Rig | SIZE, ANGLE |
| `25271264` | Outboard (Initiation Pt) | `TacticalPoint` | Control Measures / Outboard (Initiation Pt) | SIZE, ANGLE |
| `25271265` | Minesweeper | `TacticalPoint` | Control Measures / Minesweeper | SIZE, ANGLE |
| `25271266` | Surface Effects MCMV | `TacticalPoint` | Control Measures / Surface Effects MCMV | SIZE, ANGLE |
| `25271267` | Frigate | `TacticalPoint` | Control Measures / Frigate | SIZE, ANGLE |
| `25271268` | Frigate (Guided Msl) (With Tail - TA) | `TacticalPoint` | Control Measures / Frigate (Guided Msl) (With Tail - TA) | SIZE, ANGLE |
| `25271269` | Destroyer Squaddron | `TacticalPoint` | Control Measures / Destroyer Squaddron | SIZE, ANGLE |
| `25271270` | Destroyer | `TacticalPoint` | Control Measures / Destroyer | SIZE, ANGLE |
| `25271271` | Destroyer (Guided Msl) | `TacticalPoint` | Control Measures / Destroyer (Guided Msl) | SIZE, ANGLE |
| `25271272` | Cruiser | `TacticalPoint` | Control Measures / Cruiser | SIZE, ANGLE |
| `25271273` | Cruiser (Guided Msl) | `TacticalPoint` | Control Measures / Cruiser (Guided Msl) | SIZE, ANGLE |
| `25271274` | Cruiser Force | `TacticalPoint` | Control Measures / Cruiser Force | SIZE, ANGLE |
| `25271275` | Landing Craft (Minor) | `TacticalPoint` | Control Measures / Landing Craft (Minor) | SIZE, ANGLE |
| `25271276` | Landing Craft (Major) | `TacticalPoint` | Control Measures / Landing Craft (Major) | SIZE, ANGLE |
| `25271277` | Landing Ship | `TacticalPoint` | Control Measures / Landing Ship | SIZE, ANGLE |
| `25271278` | Fast Power Boat | `TacticalPoint` | Control Measures / Fast Power Boat | SIZE, ANGLE |
| `25271279` | Surface Effect FPB | `TacticalPoint` | Control Measures / Surface Effect FPB | SIZE, ANGLE |
| `25271280` | Helipad | `TacticalPoint` | Control Measures / Helipad | SIZE, ANGLE |
| `25271282` | Para Drops | `TacticalPoint` | Control Measures / Para Drops | SIZE, ANGLE |
| `25271283` | Gas Fds | `TacticalPoint` | Control Measures / Gas Fds | SIZE, ANGLE |
| `25271284` | Industrial Cen | `TacticalPoint` | Control Measures / Industrial Cen | SIZE, ANGLE |
| `25271285` | Oil Fds | `TacticalPoint` | Control Measures / Oil Fds | SIZE, ANGLE |
| `25271286` | DP | `TacticalPoint` | Control Measures / DP | SIZE, ANGLE |
| `25271287` | Comm Cen | `TacticalPoint` | Control Measures / Comm Cen | SIZE, ANGLE |
| `25280200` | Antipersonnel Mine | `TacticalPoint` | Control Measures / Antipersonnel Mine | SIZE, ANGLE |
| `25280201` | Antipersonnel Mine with Directional Effects | `TacticalPoint` | Control Measures / Antipersonnel Mine with Directional Effects | SIZE, ANGLE |
| `25280300` | Anti Tank Mine | `TacticalPoint` | Control Measures / Anti Tank Mine | SIZE, ANGLE |
| `25280400` | Anti Tank Mine with Anti-handling Device | `TacticalPoint` | Control Measures / Anti Tank Mine with Anti-handling Device | SIZE, ANGLE |
| `25280500` | Wide Area Anti Tank Mine | `TacticalPoint` | Control Measures / Wide Area Anti Tank Mine | SIZE, ANGLE |
| `25280600` | Unspecified Mine | `TacticalPoint` | Control Measures / Unspecified Mine | SIZE, ANGLE |
| `25280700` | Booby Trap | `TacticalPoint` | Control Measures / Booby Trap | SIZE, ANGLE |
| `25280800` | Engr Regulating Pt | `TacticalPoint` | Control Measures / Engr Regulating Pt | SIZE, ANGLE |
| `25280900` | Shelter | `TacticalPoint` | Control Measures / Shelter | SIZE, ANGLE |
| `25281000` | Above Ground Shelter | `TacticalPoint` | Control Measures / Above Ground Shelter | SIZE, ANGLE |
| `25281100` | Below Ground Shelter | `TacticalPoint` | Control Measures / Below Ground Shelter | SIZE, ANGLE |
| `25281200` | Fort | `TacticalPoint` | Control Measures / Fort | SIZE, ANGLE |
| `25281300` | Chemical Event | `TacticalPoint` | Control Measures / Chemical Event | SIZE, ANGLE |
| `25281301` | Chemical - Toxic Industrial Material | `TacticalPoint` | Control Measures / Chemical - Toxic Industrial Material | SIZE, ANGLE |
| `25281400` | Biological Event | `TacticalPoint` | Control Measures / Biological Event | SIZE, ANGLE |
| `25281401` | Biological - Toxic Industrial Material | `TacticalPoint` | Control Measures / Biological - Toxic Industrial Material | SIZE, ANGLE |
| `25281500` | Nuclear Event | `TacticalPoint` | Control Measures / Nuclear Event | SIZE, ANGLE |
| `25281600` | Nuclear Fallout Producing Event | `TacticalPoint` | Control Measures / Nuclear Fallout Producing Event | SIZE, ANGLE |
| `25281700` | Radiological Event | `TacticalPoint` | Control Measures / Radiological Event | SIZE, ANGLE |
| `25281701` | Radiological - Toxic Industrial Material | `TacticalPoint` | Control Measures / Radiological - Toxic Industrial Material | SIZE, ANGLE |
| `25281800` | Gen Decontamination Pt/Site | `TacticalPoint` | Control Measures / Gen Decontamination Pt/Site | SIZE, ANGLE |
| `25281801` | Alternate Decontamination Pt/Site | `TacticalPoint` | Control Measures / Alternate Decontamination Pt/Site | SIZE, ANGLE |
| `25281802` | Eqpt Decontamination Pt/Site | `TacticalPoint` | Control Measures / Eqpt Decontamination Pt/Site | SIZE, ANGLE |
| `25281803` | Troop Decontamination Pt/Site | `TacticalPoint` | Control Measures / Troop Decontamination Pt/Site | SIZE, ANGLE |
| `25281804` | Eqpt / Troop Decontamination Pt/Site | `TacticalPoint` | Control Measures / Eqpt / Troop Decontamination Pt/Site | SIZE, ANGLE |
| `25281805` | Opal Decontamination Pt/Site | `TacticalPoint` | Control Measures / Opal Decontamination Pt/Site | SIZE, ANGLE |
| `25281806` | Thorough Decontamination Pt/Site | `TacticalPoint` | Control Measures / Thorough Decontamination Pt/Site | SIZE, ANGLE |
| `25281807` | Main Eqpt Decontamination Pt/Site | `TacticalPoint` | Control Measures / Main Eqpt Decontamination Pt/Site | SIZE, ANGLE |
| `25281808` | Fwd Troop Decontamination Pt/Site | `TacticalPoint` | Control Measures / Fwd Troop Decontamination Pt/Site | SIZE, ANGLE |
| `25281809` | Wounded Personnel Decontamination Site | `TacticalPoint` | Control Measures / Wounded Personnel Decontamination Site | SIZE, ANGLE |
| `25281901` | Fixed and Prefabricated Tetrahedron | `TacticalPoint` | Control Measures / Fixed and Prefabricated Tetrahedron | SIZE, ANGLE |
| `25281902` | Tetrahedrons, Dragons Teeth - Movable | `TacticalPoint` | Control Measures / Tetrahedrons, Dragons Teeth - Movable | SIZE, ANGLE |
| `25281903` | Tetrahedrons, Dragons Teeth - Movable and Prefabricated | `TacticalPoint` | Control Measures / Tetrahedrons, Dragons Teeth - Movable and Prefabricated | SIZE, ANGLE |
| `25320100` | Amb Exchange Pt | `TacticalPoint` | Control Measures / Amb Exchange Pt | SIZE, ANGLE |
| `25320200` | Ammo Sup Pt | `TacticalPoint` | Control Measures / Ammo Sup Pt | SIZE, ANGLE |
| `25320300` | Ammo Transfer Pt | `TacticalPoint` | Control Measures / Ammo Transfer Pt | SIZE, ANGLE |
| `25320400` | Cannibalization Pt | `TacticalPoint` | Control Measures / Cannibalization Pt | SIZE, ANGLE |
| `25320500` | Cas Collection Pt | `TacticalPoint` | Control Measures / Cas Collection Pt | SIZE, ANGLE |
| `25320600` | Civilian Collection Pt | `TacticalPoint` | Control Measures / Civilian Collection Pt | SIZE, ANGLE |
| `25320700` | Detainee Collection Pt | `TacticalPoint` | Control Measures / Detainee Collection Pt | SIZE, ANGLE |
| `25320800` | En Prisoner of War (EPW) Collection Pt | `TacticalPoint` | Control Measures / En Prisoner of War (EPW) Collection Pt | SIZE, ANGLE |
| `25320900` | Log Release Pt (LRP) | `TacticalPoint` | Control Measures / Log Release Pt (LRP) | SIZE, ANGLE |
| `25321000` | Maint Collection Pt (MCP) | `TacticalPoint` | Control Measures / Maint Collection Pt (MCP) | SIZE, ANGLE |
| `25321100` | Medical Evacuation (MEDEVAC) Pick-up Pt | `TacticalPoint` | Control Measures / Medical Evacuation (MEDEVAC) Pick-up Pt | SIZE, ANGLE |
| `25321200` | Rearm, Refuel and Resupply Pt (R3P) | `TacticalPoint` | Control Measures / Rearm, Refuel and Resupply Pt (R3P) | SIZE, ANGLE |
| `25321300` | Refuel On the Move (ROM) Pt | `TacticalPoint` | Control Measures / Refuel On the Move (ROM) Pt | SIZE, ANGLE |
| `25321400` | Traffic Con Post (TCP) | `TacticalPoint` | Control Measures / Traffic Con Post (TCP) | SIZE, ANGLE |
| `25321500` | Trailer Transfer Pt (TTP) | `TacticalPoint` | Control Measures / Trailer Transfer Pt (TTP) | SIZE, ANGLE |
| `25321600` | Unit Maint Collection Pt (UMCP) | `TacticalPoint` | Control Measures / Unit Maint Collection Pt (UMCP) | SIZE, ANGLE |
| `25321700` | Gen Sup Pt | `TacticalPoint` | Control Measures / Gen Sup Pt | SIZE, ANGLE |
| `25321711` | Ammunition Point (All Types) | `TacticalPoint` | Control Measures / Ammunition Point (All Types) | SIZE, ANGLE |
| `25321800` | Medical Sup Pt | `TacticalPoint` | Control Measures / Medical Sup Pt | SIZE, ANGLE |
| `25340900` | Destroy | `TacticalPoint` | Control Measures / Destroy | SIZE, ANGLE |
| `25341400` | Interdict | `TacticalPoint` | Control Measures / Interdict | SIZE, ANGLE |
| `25341600` | Neutralize | `TacticalPoint` | Control Measures / Neutralize | SIZE, ANGLE |
| `00000005` | Freehand - Dot | `TacticalPoint` | Freehand / Dot | SIZE, ANGLE |
| `00000110` | Freehand - Text | `TacticalPointText` |  |  |
| `00000111` | Freehand - TextBox | `TacticalPointTextBox` |  |  |

## Area symbols

| Key | Name | Class | Group | Parameters |
| --- | --- | --- | --- | --- |
| `25060000` | Drop Zone | `DropZone` | Control Measures / Drop Zone | DRAW_TYPE |
| `25070000` | Extraction Zone | `ExtractionZone` | Control Measures / Extraction Zone | DRAW_TYPE |
| `25090000` | Pickup Zone | `PickupZone` | Control Measures / Pickup Zone | DRAW_TYPE |
| `25120100` | Area of Ops | `AreaOfOperations` | Control Measures / Area of Ops | DRAW_TYPE |
| `25120200` | Named Area of Interest | `NamedAreaOfInterest` | Control Measures / Named Area of Interest | DRAW_TYPE |
| `25120201` | Tgt Area of Interest | `TargetAreaOfInterest` | Control Measures / Tgt Area of Interest | DRAW_TYPE |
| `25120202` | Slow Go Area | `SlowGo` | Control Measures / Slow Go Area | DRAW_TYPE |
| `25120203` | No Go Area | `NoGo` | Control Measures / No Go Area | DRAW_TYPE |
| `25120204` | Avenue of Apchs | `AvenueOfApchs` | Control Measures / Avenue of Apchs | HEAD_RATIO, TAIL_FACTOR |
| `25120400` | Airfield Zone | `AirfieldZone` | Control Measures / Airfield Zone | DRAW_TYPE |
| `25120617` | Msn Area - Medevac | `MedevacMsnArea` | Land / Aviation | DRAW_TYPE |
| `25150200` | Assy Area / AA | `AssemblyArea` | Control Measures / Assy Area / AA | DRAW_TYPE |
| `25150201` | Fwd Assy Area / FAA | `FwdAssemblyArea` | Control Measures / Fwd Assy Area / FAA | DRAW_TYPE |
| `25150202` | Div Adm Area / DAA | `DivAdmArea` | Control Measures / Div Adm Area / DAA | DRAW_TYPE |
| `25150203` | Corps Adm Area / CAA | `CorpsAdmArea` | Control Measures / Corps Adm Area / CAA | DRAW_TYPE |
| `25150204` | Dispersal Area | `DispersalArea` | Control Measures / Dispersal Area | DRAW_TYPE |
| `25150205` | Strat Assy Area / SAA | `StratAssyArea` | Control Measures / Strat Assy Area / SAA | DRAW_TYPE |
| `25150207` | Bde Adm Area / BAA | `BdeAdmArea` | Control Measures / Bde Adm Area / BAA | DRAW_TYPE |
| `25150208` | Msn Area - ISR | `ISRMsnArea` | Control Measures / Msn Area - ISR | DRAW_TYPE |
| `25151000` | Fortified Area | `FortifiedArea` | Control Measures / Fortified Area | DRAW_TYPE |
| `25151200` | Battle Posn | `BattlePosition` | Control Measures / Battle Posn | FACE_GAP, DRAW_TYPE |
| `25151201` | C Pen Posn | `CpenPosition` | Control Measures / C Pen Posn | FACE_GAP, DRAW_TYPE |
| `25151203` | Strong Pt | `StrongPoint` | Control Measures / Strong Pt | FACE_GAP, DRAW_TYPE |
| `25151300` | Engagement Area | `EngagementArea` | Control Measures / Engagement Area | DRAW_TYPE |
| `25151401` | Friendly Airborne Aviation | `FriendlyAirborneAviation` | Control Measures / Friendly Airborne Aviation | HEAD_RATIO, TAIL_FACTOR |
| `25151402` | Attack Helicopter | `AttackHelicopter` | Control Measures / Attack Helicopter | HEAD_RATIO, TAIL_FACTOR |
| `25151403` | Main Attk | `MainAttack` | Control Measures / Main Attk | HEAD_RATIO, TAIL_FACTOR |
| `25151406` | Axis Of Advance For Feint | `AxisOfAdvanceFeint` | Control Measures / Axis Of Advance For Feint | HEAD_RATIO, TAIL_FACTOR |
| `25151408` | Multi Head Main Attk | `MultiHeadMainAttack` | Control Measures / Multi Head Main Attk | HEAD_RATIO, TAIL_FACTOR |
| `25151500` | Assault Position | `AssaultPosition` | Control Measures / Assault Position | DRAW_TYPE |
| `25151600` | Attack Position | `AttackPosition` | Control Measures / Attack Position | DRAW_TYPE |
| `25151700` | Obj Area | `ObjArea` | Control Measures / Obj Area | DRAW_TYPE |
| `25151801` | Encirclement | `Encirclement` | Control Measures / Encirclement | DRAW_TYPE |
| `25151900` | Pen Box | `PenetrationBox` | Control Measures / Pen Box | DRAW_TYPE |
| `25152000` | Attk by Fire Posn | `AttackByFirePosition` | Control Measures / Attk by Fire Posn | BK_LN_DIST_RATIO, BK_LN_ANGL_RATIO |
| `25152100` | BOF/Support By Fire Position | `SupportByFirePosition` | Control Measures / BOF/Support By Fire Position | BK_LN_DIST_RATIO, BK_LN_ANGL_RATIO, FRNT_LN_ANGL_RATIO |
| `25152300` | Arc of Fire | `ArcOfFireSD` | Control Measures / Arc of Fire |  |
| `25160207` | Post / BOP Freehand | `FreehandAreaFilled` | Control Measures / Post / BOP Freehand | DRAW_TYPE |
| `25160208` | Post / BOP Freehand Transparent | `BOPFreehand` | Control Measures / Post / BOP Freehand Transparent | DRAW_TYPE |
| `25170702` | Flight Zone | `FlightZone` | Control Measures / Flight Zone | DRAW_TYPE |
| `25170900` | High-Density Airspace Control Zone | `HighDensityAirspaceControlZone` | Control Measures / Airspace |  |
| `25171000` | Restricted Operations Zone | `RestrictedOperationsZone` | Control Measures / Airspace |  |
| `25171100` | Air to Air Restricted Operations Zone | `AirToAirRestrictedOperationsZone` | Control Measures / Airspace |  |
| `25171200` | Unmanned Aircraft Restricted Operations Zone | `UnmannedAircraftRestrictedOperationsZone` | Control Measures / Airspace |  |
| `25171300` | Weapon Engagement Zone | `WeaponEngagementZone` | Control Measures / Airspace |  |
| `25171400` | Fighter Engagement Zone | `FighterEngagementZone` | Control Measures / Airspace |  |
| `25171500` | Joint Engagement Zone | `JointEngagementZone` | Control Measures / Airspace |  |
| `25171600` | Missile Engagement Zone | `MissileEngagementZone` | Control Measures / Airspace |  |
| `25171700` | Low Altitude Missile Engagement Zone | `LowAltitudeMissileEngagementZone` | Control Measures / Airspace |  |
| `25171800` | High Altitude Missile Engagement Zone | `HighAltitudeMissileEngagementZone` | Control Measures / Airspace |  |
| `25171900` | Short Range Air Defense Engagement Zone | `ShortRangeAirDefenseEngagementZone` | Control Measures / Airspace |  |
| `25172000` | Weapon Free Zone | `WeaponFreeZone` | Control Measures / Airspace |  |
| `25214802` | Vuln Area | `VulnArea` | Control Measures / Vuln Area | DRAW_TYPE |
| `25241901` | Zone of Responsibility | `ZoneOfResponsibility` | Control Measures / Zone of Responsibility | DRAW_TYPE |
| `25242300` | Killing Gr | `KillingGr` | Control Measures / Killing Gr | DRAW_TYPE |
| `25242301` | Vital Gr | `VitalGr` | Control Measures / Vital Gr | DRAW_TYPE |
| `25242302` | Killing Zone | `KillingZone` | Control Measures / Killing Zone | DRAW_TYPE |
| `25242303` | Vital Area | `VitalArea` | Control Measures / Vital Area | DRAW_TYPE |
| `25242304` | Landing Zone | `LandingZone` | Control Measures / Landing Zone | DRAW_TYPE |
| `25251001` | ROZ — Restricted Operations Zone | `AirspaceArea` | Control Measures / Airspace | DRAW_TYPE |
| `25251002` | ACA — Airspace Coordination Area | `AirspaceArea` | Control Measures / Airspace | DRAW_TYPE |
| `25270200` | Obstacle Zone | `ObstacleZone` | Control Measures / Obstacle Zone |  |
| `25270300` | Obstacle Free Zone | `ObstacleFreeZone` | Control Measures / Obstacle Free Zone |  |
| `25270400` | Obstacle Restricted Zone | `ObstacleRestrictedZone` | Control Measures / Obstacle Restricted Zone |  |
| `25270501` | Block / Obs Effect | `BlockObstacleEffect` | Control Measures / Block / Obs Effect |  |
| `25270502` | Disrupt / Obs Effect | `DisruptObstacleEffect` | Control Measures / Disrupt / Obs Effect |  |
| `25270601` | Obs Bypass Easy | `ObstacleBypassEasy` | Control Measures / Obs Bypass Easy |  |
| `25270602` | Obs Bypass Difficult | `ObstacleBypassDifficult` | Control Measures / Obs Bypass Difficult |  |
| `25270603` | Obs Bypass Impossible | `ObstacleBypassImpossible` | Control Measures / Obs Bypass Impossible |  |
| `25270701` | Minefield - Antipersonnel Mine | `AntiPersonnelMine` | Control Measures / Minefield - Antipersonnel Mine | DRAW_TYPE |
| `25270702` | Minefield - Antipersonnel Mine with Directional Effects | `AntiPersonnelMineDirEffct` | Control Measures / Minefield - Antipersonnel Mine with Directional Effects | DRAW_TYPE |
| `25270703` | Minefield - Anti Tank Mine | `AntitankMine` | Control Measures / Minefield - Anti Tank Mine | DRAW_TYPE |
| `25270704` | Minefield - Anti Tank Mine with Anti-handling Device | `AntiTankMineWAntiHandle` | Control Measures / Minefield - Anti Tank Mine with Anti-handling Device | DRAW_TYPE |
| `25270705` | Minefield - Wide Area Anti Tank Mine | `WideAreaAntiTankMine` | Control Measures / Minefield - Wide Area Anti Tank Mine | DRAW_TYPE |
| `25270706` | Minefield - Unspecified Mine | `UnspecifiedMine` | Control Measures / Minefield - Unspecified Mine | DRAW_TYPE |
| `25270707` | Minefield - Anti Personnel + Anti Tank Mine | `AntiPersonnelAntiTankMine` | Control Measures / Minefield - Anti Personnel + Anti Tank Mine | DRAW_TYPE |
| `25270800` | Mined Area | `MinedArea` | Control Measures / Mined Area | DRAW_TYPE |
| `25270900` | Decoy Mined Area | `DecoyMinedArea` | Control Measures / Decoy Mined Area | DRAW_TYPE |
| `25270901` | Decoy Mined Area Fenced | `DecoyMinedAreaFenced` | Control Measures / Decoy Mined Area Fenced | DRAW_TYPE |
| `25271000` | Unexploded Explosive Ordnance (UXO) Area | `UXOArea` | Control Measures / Unexploded Explosive Ordnance (UXO) Area | DRAW_TYPE |
| `25310300` | Forward Arming and Refueling Point (FARP) | `FARP` | Control Measures / Forward Arming and Refueling Point (FARP) | DRAW_TYPE |
| `25340100` | Block | `Block` | Control Measures / Block |  |
| `25340200` | Breach | `Breach` | Control Measures / Breach |  |
| `25340300` | Bypass | `Bypass` | Control Measures / Bypass |  |
| `25340400` | Canalize | `Canalize` | Control Measures / Canalize |  |
| `25340500` | Clear | `Clear` | Control Measures / Clear |  |
| `25340600` | Counter Attk | `CounterAttack` | Control Measures / Counter Attk | HEAD_RATIO, TAIL_FACTOR |
| `25341000` | Disrupt | `Disrupt` | Control Measures / Disrupt |  |
| `25341800` | Penetrate | `Penetrate` | Control Measures / Penetrate |  |
| `00000002` | Freehand - Area | `FreehandArea` | Freehand / Shapes | DRAW_TYPE |
| `00000008` | Freehand - Main Attk Like Arrow | `FreehandMainAttackArrow` | Freehand / Main Attack Arrow | HEAD_RATIO, TAIL_FACTOR |
| `00000010` | Freehand - Close Sp Attk Like Arrow | `FreehandCloseSupportingAttack` | Freehand / Close Supporting Attack | HEAD_RATIO, TAIL_FACTOR |
| `00000120` | Freehand - Area Filled | `FreehandAreaFilled` | Freehand / Shapes | DRAW_TYPE |
| `00000130` | Freehand - Semi Circle | `FreehandSemiCircle` | Freehand / Shapes |  |
| `00000140` | Freehand - Semi Circle Filled | `FreehandSemiCircleFilled` | Freehand / Shapes |  |
| `00000150` | Carto Symbol | `CartoInformationModelSymbol` | Freehand / Shapes | DRAW_TYPE |
| `00000200` | Auto Shape - Area | `AutoShape` | Freehand / AutoShapes | DRAW_TYPE |
| `00000201` | Auto Shape - Block Arrows | `AutoShape` | Freehand / AutoShapes | DRAW_TYPE |

## Line symbols

| Key | Name | Class | Group | Parameters |
| --- | --- | --- | --- | --- |
| `25110100` | Boundary / Bdry | `Boundary` | Control Measures / Boundary |  |
| `25110101` | Mob Corridors | `Corridors` | Control Measures / Mob Corridors | TAIL_FACTOR |
| `25140060` | Friendly Aviation Attack | `FriendlyAviationAttack` | Control Measures / Friendly Aviation Attack | DRAW_TYPE |
| `25140101` | Fwd Line of Troops | `FwdLineOfTps` | Control Measures / Fwd Line of Troops |  |
| `25140300` | Phase Line | `PhaseLine` | Control Measures / Phase Line | DRAW_TYPE |
| `25140301` | Counter Attk Obj | `CounterAttkObj` | Control Measures / Counter Attk Obj | DRAW_TYPE |
| `25140302` | FUP | `FormingUpPoint` | Control Measures / FUP | DRAW_TYPE |
| `25140303` | Start Line | `StartLine` | Control Measures / Start Line | DRAW_TYPE |
| `25140500` | Principal Direction of Fire | `PrincipalDirectionOfFire` | Control Measures / Principal Direction of Fire |  |
| `25140602` | Friendly Direction of Main Attk | `FriendlyDirOfMainAttk` | Control Measures / Friendly Direction of Main Attk |  |
| `25140603` | Friendly Direction of Sp Attk, Dir Arrow | `FriendlyDirOfSpAttk` | Control Measures / Friendly Direction of Sp Attk, Dir Arrow | DRAW_TYPE |
| `25140605` | Direction of Feint Attack | `DirectionOfFeintAttack` | Control Measures / Direction of Feint Attack | DRAW_TYPE |
| `25140800` | Infiltration Lane | `InfiltrationLane` | Control Measures / Infiltration Lane |  |
| `25141400` | Bridgehead Line | `BridgeHeadLine` | Control Measures / Bridgehead Line | DRAW_TYPE |
| `25141700` | Ambush | `Ambush` | Control Measures / Ambush | TEETH_SIZE, TEETH_GAP |
| `25141800` | Corps Line of Denial | `CLineOfDenial` | Control Measures / Corps Line of Denial | DRAW_TYPE |
| `25141801` | Army Line of Denial | `ALineOfDenial` | Control Measures / Army Line of Denial | DRAW_TYPE |
| `25141900` | Div Line Of No Pen | `DivLineOfNoPen` | Control Measures / Div Line Of No Pen | DRAW_TYPE |
| `25141901` | Line Of No Pen | `LineOfNoPen` | Control Measures / Line Of No Pen | DRAW_TYPE |
| `25141902` | Battle Handover Line (BHOL) | `BtleHndOvrLn` | Control Measures / Battle Handover Line (BHOL) | DRAW_TYPE |
| `25150209` | Ethernet | `Ethernet` | Control Measures / Ethernet |  |
| `25150210` | PASCOMS | `PASCOMS` | Control Measures / PASCOMS |  |
| `25150211` | OFC | `OFC` | Control Measures / OFC |  |
| `25150212` | Wrls | `Wrls` | Control Measures / Wrls |  |
| `25151204` | Contain | `Contain` | Control Measures / Contain | TEETH_SIZE, TEETH_GAP |
| `25151205` | Retain | `Retain` | Control Measures / Retain |  |
| `25151404` | Sp Attk | `SupportingAttack` | Control Measures / Sp Attk | HEAD_RATIO, TAIL_FACTOR |
| `25151407` | Funnel | `Funnel` | Control Measures / Funnel | FRNT_LN_ANGL_RATIO, FLAP_DIST_RATIO, FRNT_LN_DIST_RATIO |
| `25152200` | Search Reconnaissance Area | `SearchReconnaissanceArea` | Control Measures / Search Reconnaissance Area |  |
| `25170200` | Low Level Transit Route | `LowLevelTransitRoute` | Control Measures / UAV Route |  |
| `25170300` | Minimum Risk Route | `MinimumRiskRoute` | Control Measures / UAV Route |  |
| `25170400` | Safe Lane | `SafeLane` | Control Measures / UAV Route |  |
| `25170600` | Transit Corridors | `TransitCorridors` | Control Measures / UAV Route |  |
| `25170700` | UAV Route | `UARoute` | Control Measures / UAV Route |  |
| `25170701` | Flight Route | `FlightRoute` | Control Measures / Flight Route | DRAW_TYPE |
| `25270504` | Turn / Obs Effect | `Turn` | Control Measures / Turn / Obs Effect |  |
| `25271100` | Bridge - Gap | `Bridge` | Control Measures / Bridge - Gap | TAIL_FACTOR, FLAP_ANGLE |
| `25290100` | Obstacle Line | `ObstacleLine` | Control Measures / Obstacle Line | DRAW_TYPE |
| `25290201` | DCB | `DitchEmpty` | Control Measures / DCB | TEETH_SIZE, TEETH_GAP |
| `25290202` | DCB - Filled With Water | `DitchFilledWithWater` | Control Measures / DCB - Filled With Water | TEETH_SIZE, TEETH_GAP |
| `25290203` | AT Ditch Reinforced w/ AT Mines | `AntitankDitchReinforcedWithMines` | Control Measures / AT Ditch Reinforced w/ AT Mines | TEETH_SIZE, TEETH_GAP |
| `25290204` | Antitank Wall | `AntitankWall` | Control Measures / Antitank Wall | DRAW_TYPE |
| `25290301` | Wire Obs - Unspecified Wire | `UnspecifiedWire` | Control Measures / Wire Obstacles |  |
| `25290302` | Wire Obs - Single Fence Wire | `SingleFenceWire` | Control Measures / Wire Obs - Single Fence Wire |  |
| `25290303` | Wire Obs - Double Fence Wire | `DoubleFenceWire` | Control Measures / Wire Obs - Double Fence Wire |  |
| `25290304` | Wire Obs - Double Apron Fence | `DoubleApronFence` | Control Measures / Wire Obs - Double Apron Fence |  |
| `25290305` | Wire Obs - Low Wire Fence | `LowWireFence` | Control Measures / Wire Obs - Low Wire Fence |  |
| `25290306` | Wire Obs - High Wire Fence | `HighWireFence` | Control Measures / Wire Obs - High Wire Fence |  |
| `25290307` | Wire Obs - Single Concertina | `SingleConcertina` | Control Measures / Wire Obs - Single Concertina |  |
| `25290308` | Wire Obs - Double Strand Concertina | `DoubleStrandConcertina` | Control Measures / Wire Obs - Double Strand Concertina |  |
| `25290309` | Wire Obs - Triple Strand Concertina | `TripleStrandConcertina` | Control Measures / Wire Obs - Triple Strand Concertina |  |
| `25290310` | Line of Contact | `LineOfContact` | Control Measures / Line of Contact |  |
| `25290900` | Fortified Line | `FortifiedLine` | Control Measures / Fortified Line | DRAW_TYPE |
| `25330100` | Moving Convoy / Approach | `MovingConvoy` | Control Measures / Moving Convoy / Approach |  |
| `25340800` | Withdraw | `Withdraw` | Control Measures / Withdraw |  |
| `25341100` | Fixation | `Fix` | Control Measures / Fixation | TEETH_SIZE, TEETH_GAP, HEAD_RATIO, TAIL_FACTOR |
| `25341500` | Isolate | `Isolate` | Control Measures / Isolate | TEETH_SIZE |
| `25341700` | Occupy | `Occupy` | Control Measures / Occupy |  |
| `25342000` | Retire | `Retire` | Control Measures / Retire |  |
| `25342100` | Secure | `Secure` | Control Measures / Secure |  |
| `25342201` | Covering Tps | `Cover` | Control Measures / Covering Tps |  |
| `25342202` | Guard | `Guard` | Control Measures / Guard |  |
| `25342203` | Screen | `Screen` | Control Measures / Screen |  |
| `25342400` | Delay | `Delay` | Control Measures / Delay |  |
| `25342500` | Withdraw Under Pressure | `WithdrawUnderPressure` | Control Measures / Withdraw Under Pressure |  |
| `00000001` | Freehand - Line | `FreehandLine` | Freehand / Line | DRAW_TYPE |
| `00000003` | Freehand - Line Dotted | `FreehandLineDotted` | Freehand / Line Dotted | DRAW_TYPE |
| `00000004` | Freehand - Double Line Arrow | `FreehandDoubleLineArrow` | Freehand / Double Line Arrow |  |
| `00000006` | Freehand - Arrow | `FreehandArrow` | Freehand / Arrow | DRAW_TYPE |
| `00000007` | Freehand - Dotted Arrow | `FreehandDottedArrow` | Freehand / Dotted Arrow | DRAW_TYPE, TEETH_GAP |
| `00000009` | Freehand - Sp Attk Like Arrow | `FreehandSupportingAttack` | Freehand / Supporting Attack | HEAD_RATIO, TAIL_FACTOR |
| `00000210` | Auto Shape - Arrow | `AutoShapeArrow` | Freehand / AutoShapes | DRAW_TYPE |
| `00000211` | Auto Shape - Line | `AutoShapeArrow` | Freehand / AutoShapes | DRAW_TYPE |
