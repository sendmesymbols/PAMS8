# GROTBC-R · Roads, Tracks and Railway Network: routing requirement

Status: **proposal for the owner to approve** (written 2026-11-03). Companion to `GROTBC.md` section 2 (R) and
`MS/Docs/16-placement-grotbc-card.md`. Nothing in this document is built yet except what section 2 lists as present.

## 1 · Why a routable network

The terrain bundle shows roads, rail and MSR on the map and answers "what is the road here?". It cannot answer
"how do I get from A to B, with what, and what could stop me?". A routable network turns the R heading from a
description into a planning tool:

| Need | What routing gives |
| --- | --- |
| Logistics and reinforcement | Fastest / shortest route, MSR-only route, an alternative when one link is cut, distance and ETA |
| Armour movement | Route that only uses roads **and bridges** carrying the tank (class 60+), naming the limiting bridge |
| Seasonal planning | Routes that avoid segments recorded as closed (Jun-Oct, snow ...) |
| Vulnerability | Choke points: a bridge, pass, tunnel or ford that every route between two places depends on |
| Avenues of approach (OAKOC) | Cross-country path over open ground, costed from the going layers, for tracked / wheeled / dismounted |
| Railway | Rail route between stations, level crossings on a road route |

## 2 · What exists today (verified 2026-11-03)

Bundle `MS/Data/terrain-bundle` (pipeline `tools/terrain-pipeline`, NCGDB Ver-6 read from `E:\LandUse`):

| Item | State |
| --- | --- |
| `route/` raster tiles | Type (22 kinds: motorway ... footpath, rail), load-class tier (0 not recorded, 1 below 50, 2 50-59, 3 60+), MSR bit. 38 m pixels, z8-12 |
| `features/` lines | 105,351 named / classed / MSR road lines, 6,378 railway lines, simplified to 15 m, clipped per z10 tile, attributes `n r t c w k d m x cn sl` |
| `routes.json` | 7,061 roads (1,572 MSR) and 706 railways aggregated by road number / name: from, to, km, load range, closures, condition. N-5 sums to ~1,800 km |
| Crossings | Bridges 129 k, culverts 71 k, fords 233, ferries 792, foot bridges 2.7 k, level crossings, tunnels; bridge load class derived from the road that crosses it (classes 39-45, 50) |
| Other transport | Airports / airfields / air bases / helipads / landing strips / runways (R), railway stations 1,093, KM stones 42 k, passes |
| MSR | Rule, not an official list: motorway, highway, main road, defence road, class 50+ metalled road, broad-gauge rail (`rules.yaml msr`; `namedRoutes` takes an official list) |
| Tank table | Al-Khalid ~48 t (MLC ~53), T-80UD / T-80 ~46 t (~51), Al-Zarrar ~40 t (~44); tankable = class 60+, class 50-59 = Al-Zarrar only, width under 3.5 m never tankable, HET needs class 70 |

### 2a · The routable graph (added 2026-11-04)

`D:\Imagery\Routing\Network.gdb` (1.3 GB) holds `pkroads`, an **osm2po-style graph of OpenStreetMap roads**: 2,762,810
edges between 2,153,103 junctions, 567,613 km, with `SOURCE` / `TARGET` node ids, `KM`, `KMH` (class default speed),
`CLAZZ` (OSM class), `REV_COST` (171,242 one-way edges), `OSM_NAME`; EPSG:3857, extent 60.8-77.1 E, 23.9-37.1 N. It
also carries an ArcGIS network dataset (`ND_6_*`, `N_1_*` tables), which the pipeline does not need.

`scripts/network.py` turns it into the bundle's `network/` (nodes, edges, simplified geometry, names; ~120 MB) and
attaches the NCGDB attributes to every edge by reading the burned route raster every 30 m along it:

| OSM class | km | matched to an NCGDB road | NCGDB load class known | MSR km |
| --- | --- | --- | --- | --- |
| motorway | 4,595 | 96.8 % | 26.3 % | 4,402 |
| trunk | 20,525 | 97.6 % | 67.3 % | 17,905 |
| primary | 18,395 | 97.3 % | 66.8 % | 10,157 |
| secondary | 27,290 | 93.9 % | 52.2 % | 5,593 |
| tertiary | 93,591 | 88.1 % | 26.7 % | 7,344 |
| unclassified | 197,683 | 61.3 % | 7.3 % | 6,993 |
| residential | 186,587 | 45.2 % | 5.9 % | 8,281 |
| service / track | 17,577 | ~45 % | ~11 % | 1,859 |

So the two sources agree on the main network, the NCGDB supplies load class and MSR for most of it, and OSM adds
about 200,000 km of minor and residential roads the NCGDB does not carry. Each edge also keeps the worst crossing on
it (bridge class, foot bridge, ford / ferry), so a class 40 bridge makes a class 70 road non-tankable at that point.
Decision 9.1 below is therefore settled in practice: **OSM topology, NCGDB attributes**.

Still to do for phase 1: the connectivity report (components, dead ends) and golden routes in `validate.py`, NCGDB
closures / condition on the edges (they are on the NCGDB lines, not in the raster), and a router.

**What is missing for routing**

- **No router yet.** The graph above is in the bundle; nothing reads it. The feature lines remain display fragments.
- **Load class is on about 31 % of road segments** (74,302 of 238,173 in `Roads_updated_2016_Pakmap`). The rest are
  "class not recorded".
- **Condition ~4 %** (9,742 segments), **surface 1,000**, **seasonal closure 540** (`CLOSED_DUE`), **landslide sites 71**
  (`NO_OF_SLID`), **bottlenecks 21** (`NO_OF_BOTT`), **bridge counts per segment** (`NO_OF_BRS`, `NO_OF_CULV`).
- **No speeds, no turn rules, no one-way flags** beyond a few `oneway` values.
- **Foreign roads are included.** The data extent is the whole relief-map sheet (59.5-80.5 E, 20.5-37.5 N), so
  Indian-administered and Afghan roads are present ("Amritsar - Bhatinda", "Kholm - Qalatak"). Routing must decide
  whether to use them.

## 3 · Sources for the network

| Source | Gives | Limits |
| --- | --- | --- |
| NCGDB `Roads_updated_2016_Pakmap` (238,173), `Road` (185,774), `Tracks` (902,103), `Railways_Pakmap` (6,378), `Railway` | The authoritative attributes: `CLASSIFICA` (load class + weather + lanes, e.g. 40A1), `WIDTH_M`, `DEFENCE_RD`, `ROAD_NO`, `NAME`, `SECNAME`, `CONDITION`, `SURFACE`, `CLOSED_DUE`, `NO_OF_SLID`, `MAINT_BY`, `PRIORITY`, `SHOULDER_*` | Not guaranteed to be noded at junctions; gaps; restricted (the bundle is marked restricted) |
| NCGDB `Crossings_Point` (198,563), `Crosings_line` | Bridge / culvert / ford / ferry positions with names | Load class is not recorded on the crossing; it is inherited from the road |
| OpenStreetMap, Geofabrik `pakistan-261028.osm.pbf` (already in `work/raw/osm_pakistan`) | Well-connected topology, `highway`, `maxspeed`, `surface`, `bridge`, `tunnel`, `oneway`, names | No military load class; ODbL (derived data must stay ODbL-compatible) |

**Recommended basis (decision for the owner, section 9):** build the topology from the NCGDB lines, snap them to
each other within a tolerance (~15 m, tunable), and use OSM only to fill gaps and to supply speed / surface where the
NCGDB is silent. The NCGDB stays the authority for load class, MSR and defence roads.

## 4 · Graph model

**Nodes**: junctions (3+ links or an end), plus every bridge, ford, ferry, level crossing, tunnel, pass and
station so a restriction can sit on a node.

**Links** (one per road section between nodes) carry:

| Field | Source / rule |
| --- | --- |
| `id`, `name`, `no` (road number), `type` (route codebook) | NCGDB `NAME`, `ROAD_NO`, `TYPE` |
| `len_m` | geodesic length (planar length x cos latitude) |
| `load` (number), `load_known` (bool), `tier` (0-3) | `CLASSIFICA`; `tier_of()` in `grotbc.py` |
| `width_m` | `WIDTH_M` |
| `surface` / `all_weather` | `CATEGORY`, `SURFACE`; `A` = all-weather, `F` = fair-weather (inferred convention, unconfirmed) |
| `lanes` | digit of the load code (inferred) |
| `msr`, `defence` | `rules.yaml msr`, `DEFENCE_RD` |
| `closed` (seasons as text, also parsed to months), `cond`, `slides` | `CLOSED_DUE`, `CONDITION`, `NO_OF_SLID` |
| `speed_kmh` | by type and surface (table in `rules.yaml`, to be added; OSM `maxspeed` where known) |
| `limit_load` | lowest load class of any bridge / culvert on the link (min over its crossings) |
| `country` | from the NCGDB `Country` field or the boundary polygon |

**Railway** is a second layer on the same graph with its own links (gauge, status) and nodes (stations, level crossings
connect rail and road).

## 5 · Functional requirements

### 5.1 Road routes

1. **Route(A, B, profile)** returns the best path, total distance, ETA, and per-leg list (road name / number, km, type,
   class), with the limiting link named.
2. **Profiles** (cost functions): `fastest`, `shortest`, `msr_only`, `tank` (every link and bridge >= class 60, or
   Al-Zarrar class 50 as a separate profile), `wheeled`, `het` (class 70), `all_weather` (no `F` roads), `avoid_closed(month)`.
3. **Unknown class handling** is explicit: a profile either treats unrecorded class as **blocked**, **allowed with a
   warning**, or **allowed** (default for fastest / shortest, blocked for `tank`). The result lists every
   "class not recorded" link on the route.
4. **Via points and avoid areas / links** (e.g. "avoid this bridge", "avoid this district").
5. **Alternatives**: the best route and up to 2 materially different alternatives.
6. **Reachability / isochrone**: everything reachable from A within a time or distance for a profile.
7. **Choke points**: given A and B (or an area), the links / nodes whose removal disconnects them or lengthens the
   route by more than a threshold.
8. **Snap**: map-click to nearest node / link within a tolerance, with the snap distance reported.

### 5.2 Cross-country (avenues of approach)

Cost surface from the existing layers: `dist_<mode>` (distance to no-go, 0 = no-go), `terrain`, `soil` + `soilBearing`,
slope band, `wet`, `class` (SLOW-GO / NO-GO per mode in `rules.yaml`). `route(A, B, mode)` returns a path over open
ground for `dismounted`, `wheeled`, `tracked`, `pack`, `oversnow`; roads inside the corridor are used at road speed.
Optional **dry / monsoon** switch reading `wet` and `soilBearing.wet`.

### 5.3 Railway

Station to station route on the rail layer; list level crossings; gauge change warning.

### 5.4 Presentation (GROTBC card)

- **R section** of the card shows, for the cursor / selected symbol: nearest MSR (name / number, class, tankable or
  not, distance), nearest crossing and its class, road condition and closure where recorded.
- **G brief** adds the route summary for the selected symbol to a chosen destination.
- Every route result shows its **assumptions** (unknown class handling, season, profile) and a **confidence** note
  (share of the route length whose class and surface are recorded).

## 6 · Data requirements (pipeline)

New step `network` (after `grotbc`, before `package`):

1. Read the NCGDB road, track and railway lines (and, optionally, the OSM extract for roads).
2. Clip to the chosen area (Pakistan boundary or the frame; decision 9.4).
3. Node the lines: split at intersections and at crossing points; snap ends within tolerance; report unsnapped ends
   (dead ends are normal, near-misses of under 40 m are suspicious and listed).
4. Attach crossings and compute `limit_load` per link; attach closures, condition, slides, width, surface.
5. Write the graph as a compact static file(s) in the bundle, tiled so a view only loads what it needs:
   `network/{z}/{x}/{y}.bin` (z8-9 overview of MSR / highways, z10 full) plus `network/index.json` (link / node
   schema, profile cost tables, version). Target size: under 150 MB total; hierarchy of "major roads only" for
   long routes (contraction-hierarchy style shortcuts or a precomputed MSR skeleton).
6. `validate.py` additions: connectivity report (components, size of the largest), count of snapped / unsnapped
   ends, share of links with class recorded, route spot checks against known city pairs (golden routes, e.g.
   Karachi - Lahore by N-5 about 1,200 km, Rawalpindi - Peshawar by M-1 / N-5).

Static-file rule: nothing is fetched at routing time other than bundle tiles (the host may be air-gapped).

## 7 · Engine requirements (library)

- **Headless**, no DOM: `MS/Engines/Placement/` style, individually tear-down-able, scoped to the view container.
- A `RoutingEngine` (or an extension of the existing **RoadNetwork** and **Trafficability** analysis engines in
  `AnalysisEngineRegistry`) reading the bundle graph; when no graph is present it degrades to the current
  straight-line estimate, as those engines already do offline.
- Router in a **Web Worker** (A* / bidirectional Dijkstra on the loaded tiles; hierarchy for long routes), so
  mouse-move stays synchronous and never waits on routing.
- **Geodesic correctness**: distances through `GeoTools` (see `CLAUDE.md` note 7); never `wkid === 3857` alone.
- **MeasurementEngine** supplies ETA from the march-time setting; routing supplies the path and per-link speed.
- Public API additions documented in `MS/Docs`, exercised in the `index.html` / `src/main.ts` API Test panel, and a
  `*SettingsManifest` / `*SettingsWidget` pair for the Ctrl+K palette (profile, season, unknown-class policy).

## 8 · Quality, limits and honesty

- The network is **modelled from survey and open data**, not a verified trafficability survey. The result must say so.
- **Load class gaps** (69 % of segments) are the main weakness: show them; never present an unrecorded road as
  tankable.
- **Closures and conditions are sparse**; "none recorded" is not "none".
- **Speeds are assumed** from road type and surface until an authority gives march rates.
- Tank MLCs are estimates (1.1 x tonnes) until the official figures are supplied.
- The graph inherits the bundle's **restricted** status (NCGDB). OSM-derived parts carry ODbL obligations.
- Sensitive layers (defence roads, cantonments, bunkers) are already in the main bundle (decision 5); routing does not
  widen that, but route outputs near them should not be exported without the same marking.

## 9 · Decisions needed from the owner

1. **Basis**: settled by Network.gdb (2026-11-04): the OSM graph is the topology, the NCGDB gives load class, MSR,
   defence roads and crossings. Confirm.
2. **Official MSR list**: supply it for `msr.namedRoutes`; until then the rule (class 50+) stands.
3. **Official MLCs** for Al-Khalid, T-80UD, T-80, Al-Zarrar, and the load-code convention (A / F, 1 / 2).
4. **Area**: Pakistan only, or the whole relief-map sheet (Indian-administered and Afghan roads included)?
5. **Speeds / march rates** for the profiles (or accept the defaults in `rules.yaml`).
6. **Unknown-class policy** for `tank` (blocked, as recommended) and for `wheeled`.
7. **Cross-country**: in scope now, or after road routing?
8. **Also treat river banks and bunds in routing?** Bunds as cover along a route, river banks as halt / deployment
   points (proposal from the 2026-11-03 discussion; bund ground concealment would rise from poor to fair, and a bank
   strip along perennial rivers would be a positive feature).

## 10 · Phases and acceptance

| Phase | Deliverable | Accepted when |
| --- | --- | --- |
| 1 | `network` pipeline step + `validate` connectivity report | Largest component holds >= 95 % of MSR length; golden city pairs connect; unsnapped-end list reviewed |
| 2 | `RoutingEngine` road profiles (fastest, shortest, msr_only, tank, closed-month), alternatives, choke points | Karachi - Lahore, Rawalpindi - Peshawar, Quetta - Taftan routes within 10 % of reference distance; `tank` route names its limiting bridge or says "class not recorded" |
| 3 | R section of the card and G brief route summary | Card shows MSR / crossing / closure lines with sources; assumptions visible |
| 4 | Cross-country routing on the cost surface | Path respects NO-GO per mode; roads in corridor used at road speed |
| 5 | Railway routing | Station pairs route; level crossings listed |

Estimated effort (rough, one developer with the data already in hand): phase 1 about 3-4 days, phase 2 about 4-5
days, phase 3 about 2 days, phase 4 about 3-4 days, phase 5 about 1-2 days. These are estimates, not commitments.
