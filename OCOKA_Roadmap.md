**1. Mobility (the base for everything else)**

   Product	Decision it settles	Built from

   Combined obstacle overlay per mover and season	Where armour, wheels and foot can and cannot go, dry and after rain	class, dist_*, rci_dry/wet, wet
   Mobility corridors sized by echelon	Whether a coy, bn or bde frontage fits through this ground, and where it narrows	dist_* + frontage table
   Load-class route from A to B	Which route carries Al-Khalid or a transporter, and which bridges block it	network (load, width, crossings)
   March table	Time on route by day or night, dry or wet, with closures and slide sites	network + speed tables
   Crossing site selection	Where to cross a river or canal: ford, ferry, bridge or assault crossing	Fords and ferries, river depth/current/bank height, bank
   Detour and cut analysis	If this bridge is lost, what the detour is and what is isolated	network
2. Attack
   Product	Decision it settles	Built from
   Ranked avenues of approach	Which approach to take: going, width, cover, exposure to the objective	Corridors + line of sight from the objective + cc
   Covered approach for dismounted troops	The route in dead ground to the objective	elev, cc, nullahs and dry riverbeds
   Forming-up place and assembly area finder	Ground hidden from the objective, firm, large enough, with a route in	dist_*, cc, line of sight, route
   Fire support position finder	Where direct fire weapons see the objective within range, from cover	elev, cc, range
   Objective study	Building density and size, people inside, protected sites	bld, settlements, population, mosques/hospitals
   Breach site	Where a canal or bund is lowest or narrowest, and the nearest bypass	Canal width, bank height, bridges
3. Defence
   Product	Decision it settles	Built from
   Enemy approaches with time-distance	Where the enemy comes from and when the lead tanks arrive	Corridors + tracked speeds
   Key terrain shortlist	Which ground to hold	13,112 ITG candidates, peaks, saddles, ridgelines
   Position scoring (military crest, reverse slope)	Where to site each sub-unit, with alternates	elev, landform, cc, line of sight
   Killing area and dead ground map	What each weapon covers and what it cannot see	Line of sight + range fans
   Obstacle plan	Where natural obstacles already stop armour, and which gaps to mine or ditch	class (canals, marsh, bunds), dist_tracked
   Demolition target list	Which bridges on the enemy approach to prepare, by class	network crossings
   Reserve location and counter-attack routes	Where the reserve sits to reach each sector in time	network, corridors, speeds
4. Ambush and counter-ambush
   Product	Decision it settles	Built from
   Ambush site finder on a route	Stretches where vehicles cannot leave the road, with covered fire positions, a covered withdrawal and no village nearby	class beside the road (cuttings, embankments, canals), line of sight, cc, settlements
   Vulnerable points on own route	Where a convoy is likely to be hit: culverts, defiles, bridges, cuttings	71,454 culverts, bridges, class, elev
   Cut-off and stop positions	Where to block escape routes	Tracks and ways out, dead ground
5. Security operations (internal security, border, counter-terrorism)
   Product	Decision it settles	Built from
   Cordon and search plan	Cordon length, troops needed, every exit to block, people inside by age and sex, sensitive sites	Settlements, ways out, population, mosques/schools
   Border observation gap analysis	Ground between posts that nobody sees, and the nullahs and passes leading through it	706 border posts, 2,612 piquets, line of sight, passes
   Post and piquet siting	Fewest posts that cover a route or border stretch	Line of sight, access, water
   Route protection plan	Piquet positions that dominate the road	Line of sight along the route, high ground
   Check post siting	Junctions that cannot be bypassed	network, NO-GO flanks
   Hide search list	Caves, deserted sites, forest and broken ground near an incident	70 caves, 8,724 deserted sites, cc
6. Fire support, air defence, aviation, signals, logistics
   Product	Decision it settles	Built from
   Gun area finder	Level, firm ground with a route in and range to the targets	dist_gun, range, crest clearance
   Air defence siting	Coverage, and the valleys aircraft will use to stay masked	dist_ad, elev
   Helicopter landing site and casualty evacuation	Nearest usable landing site, wire hazards, nearest hospital and drive time	dist_hls, power lines, hospitals, network
   Relay and observation post siting	High ground with line of sight to both ends and a way up	elev, route
   Supply route with alternates	Main route, its weakest bridge, and the alternate	network
   Dump and echelon area siting	Firm, flood-free, concealed ground on a class 50+ road	wet, rci_wet, cc, route
   Water plan	Sources within reach of each position	About 480,000 water points
7. Senior official and higher headquarters
   Product	Decision it settles	Built from
   Sector assessment	What force type this sector supports, by season (% GO for armour, dry versus monsoon)	class, rci_*, terrain
   Campaign window	Which months are workable: passes closed, heat, frost, monsoon	Climate grids, recorded closures
   Critical infrastructure dependency	Which barrage, bridge or grid station isolates the most people or forces if lost	Dams and barrages, network, population
   Civil impact estimate	People within range of the operation, likely displacement, evacuation routes	Population, settlements, network
   Bridge upgrade priority	Which few bridges, raised to class 70, open a complete tank route	network load classes
   Flood response	Population on flood-prone ground and villages cut off	wet, population, crossings
8. Field soldier (offline, at a point)
   Ground card: going here, nearest cover, nearest water, the way out, nearest landing site and hospital.
   Patrol route card: legs, bearings, time, stretches in dead ground, exposed stretches.
   Visibility sketch from a position: what I see and what I cannot see.
   Three things that decide whether commanders will trust it
   Every product must list what to confirm on the ground. With 114,459 bridges of unknown class and 33 m pixels, the system’s output is a plan plus a recce task list, not a replacement for recce.
   The bundle has no enemy, own-force or live weather data. Enemy positions must be entered by the user, and every attack, defence and ambush product depends on them.
   Every answer should show its reason and data date (for example “NO-GO: canal, 2021 land cover”). Without that, a planner cannot defend the decision to a commander.






1. Ground appreciation (feeds everything)
   Application → output	Rule applied	Built on	Status
   GROUND trace: character, ridge lines, viewpoints, cover, non-passable ground, defilade	The GROUND keyword map study (IC S24), done on a talc trace	Peaks, Key Terrain, Dead Ground, class, cc	Assemble
   Terrain analysis sheet: approaches, ground of tactical importance, observation and fields of fire, cover, obstacles, killing ground	The six outputs IBB S53 requires	OCOKA engine	Extend
   Who leads: tanks or infantry	Open: tanks lead. Fields of fire 400–500 m or less: infantry leads. 100–200 m or less: infantry, one tank troop at most (IBB S35)	Intervisibility + cc + bld	New
   Tank obstacle check	Stops tanks: ditch over 2.5 m wide, step over 0.9 m, marsh, thick woods; ditch of 24 m is a full obstacle	class, canal width, rci_*	Extend
   Water obstacle classifier	The ten obstacle types in IBB Annex P, with home bank vs far bank height	Canal/river features, bank, elev	New
   March table	Plains 4/3 km/h day/night, desert 3/2.5, mountain ascent 2/1; halts 15–20 min after 2 h	MovementSpeeds.json already matches	Have
2. Attack
   Application → output	Rule applied	Built on	Status
   Left or right approach comparison + H-hour time sum	Quick appreciation: cover in the forming-up place (FUP), obstacles from FUP to objective, distances, fire base range and angle (IC S15)	Dead Ground, Corridor, routes	New
   Assembly area finder	1–5 miles from the enemy, unobserved, vehicle entry and exit, beyond field artillery range if possible	dist_*, line of sight, network	New
   FUP and start line finder	Unobserved, home side of the minefield, no change of direction inside; start line a linear feature square to the axis, never behind an obstacle	Line of sight, linear features	New
   Night attack check	FUP at least 1000–1200 m from the objective in plains; tank FUP 2500–3000 m; enemy night sights reach 1000–1200 m, thermal 3000–4000 m	Line of sight with range rings	New
   Base of fire siter	Higher than and to the flank of the assault line, sees the whole objective; layered pattern in mountains, linear in plains (IBB S43)	Intervisibility, Weapon Effect	Extend
   Fire lift rings on the objective	Fire covers movement to within 450 m (120 mm mortar), 360 m (medium), 275 m (battalion mortars), 180 m (field)	Buffer engine	Extend
   Night march chart	Bearings and paced legs (120 paces = 100 m), FUP marking layout	Routes, measurement	New
   Reorganisation plan	Arcs and defensive fire on enemy counter-attack approaches onto the objective	OCOKA, Weapon Effect	Extend
3. Water obstacle crossing
   Application → output	Rule applied	Built on	Status
   Crossing recce sheet per site, with unknowns flagged	Width, depth, current, bed, bank height and slope, approaches and exits, boat and raft places (IC S71, IBB S46)	River and canal attributes, fords, bank	New
   Crossing calculator	Boat: 12 men, 10 min round trip per 30 m gap; bridge build times by day, moonlight and dark; entry point upstream by twice the width for drift	Annex Q table	New
   Bridgehead template fitted to ground	Brigade phase 1: 300–600 m beyond the bund, 1800–2000 m wide; phase 2: 3500–4000 m × 1500–1800 m; armoured division needs about 8 × 6 km	Deployment Builder, dist_tracked	New
   Crossing area layout	Concentration area out of artillery range, assembly area, boat off-loading point, FUP, vehicle waiting areas	Site finders above	New
4. Defence
   Application → output	Rule applied	Built on	Status
   Frontage templates snapped to ground	Battalion in plains 3000–5000 m × 2000–3000 m; on a canal 2750–4115 m with three companies up; platoon 270 m normal, 600 m extended	GroundGuideFootprint.ts, Deployment Builder	Extend
   Anti-tank layout (the framework of the position)	On tank approaches, flank shots from defilade, in depth; missile detachments 400–500 m apart, alternates 800–1000 m; short-range weapons 500–600 m forward; back-blast area clear	OCOKA, Weapon Effect, Position Scorer	Extend
   Field of fire test per post	100 m minimum, 200 m plus the wire belt, 270–500 m desirable	Intervisibility	Extend
   Mutual support and gap report	Each locality’s front covered by its neighbour’s fire; gaps covered by mines, fire and patrols	Intervisibility	New
   Dead ground in front of the forward localities	Goes to mortar tasks, denser mines, listening posts (300–400 m out) and standing patrols (1000–1500 m out)	Dead Ground Mapper	Extend
   Defensive fire planner → task table	Targets: enemy FUPs and assembly areas, defiles, dead ground; no closer than 400 m (field), 500 m (medium), 550 m (mortar); 8–12 per battalion; one emergency task on the most dangerous approach	Enemy template + Dead Ground	New
   Reverse slope check	Crest within small-arms range of forward localities; depth on the next high ground behind; not overlooked from a flank	elev, landform, Position Scorer	Extend
   Counter-penetration positions with time to occupy	2–3 per battalion, astride the enemy axis, on an obstacle or built-up area; decision 1.5–2 h after enemy H hour; company counter-attack in 30 min, battalion in 1 h	Routes, speeds	New
   Canal and ditch defence	Bulk on the higher bank, far bank if equal; bridges held as strong points; mask positions 300–500 m forward; tracks behind the home bank	Obstacle classifier	New
   Obstacle stores and labour + minefield record	Wire at least 40 m from posts; protective minefield 250–300 m deep; stores, men and hours per 100 m of wire	IC S107 tables	New
   Ready-by time	Company position complete in 24–36 h; digging hours by soil	soil, rci_*	New
5. Withdrawal
   Application → output	Rule applied	Built on	Status
   Intermediate position finder	Far enough that the enemy must move his field guns; behind an obstacle; covered routes back	Artillery range table, class	New
   Control points and timed programme	Platoon and company meeting points, checkpoint where routes converge, embussing point 1500–2000 m back; denial time and thinning-out time	Routes	New
6. Patrols, ambush, infiltration
   Application → output	Rule applied	Built on	Status
   Patrol route planner → night march chart	Legs end on features recognisable at night; bounds 550–750 m apart; final meeting point 400–500 m from the objective; night routes avoid wood edges, villages, tracks and skylines; route out differs from route in	Routes, cc, landform	New
   Ambush site scorer with layout	Defile or bend, target hidden from following vehicles, covered withdrawal, away from reinforcements; line, L or V layout; meeting point 750–900 m back	Vulnerable-point data, line of sight	New
   Road block and tank ambush siter	Round a bend or over a crest, no bypass, no room to turn, tied to natural obstacles	network, class	New
   Infiltration lane finder (and its mirror, anti-infiltration posts)	Lanes through gaps in dead ground, off roads; objective within one night’s march (15 km in hills, 24 km at most); link-up in 24–36 h	Dead Ground, Corridor	New
7. Internal security
   Application → output	Rule applied	Built on	Status
   Cordon calculator	15 men per 100 m facing inward, +5 for rooftops, +2–3 per side road; outer cordon of road blocks on every exit; rural: sections on escape routes only	Settlements, network, bld	New
   Route picketing plan	Pickets on both sides, spaced so fire covers the ground between; a platoon each	Intervisibility along route	New
   Convoy plan	Packets of 5–10 vehicles, up to 5 min apart, bounds of 10–15 km, likely ambush sites cleared first	Ambush scorer, network	New
   Likely mine sites	Crossroads, turning places, places where vehicles slow	network, culverts	New
8. Shared data the tools need
   One weapon and sensor table (ranges, back-blast, mortar minimum range, safety distances, night sights, artillery ranges and frontages) feeding every range fan and safety ring.
   Enemy doctrinal template from IC S113–114: assembly area 2–3 km from contact, attack rate 100 m in 4 minutes against prepared defences, night attack frontages, minefield lanes 400–500 m apart.

