# 16 · Placement card & legend — GROTBC restyle (handover)

Start here to continue the Placement Advisor card and legend work. It records every decision taken so far, what
is already built, the design target, the style guide, and the bundle v2 data the new card reads. Engine and
bundle reference: [15-placement-advisor.md](15-placement-advisor.md).

**Status (2026-11-01)**

| Piece | State |
| --- | --- |
| P1 · Card and legend restyle on the v1 data (picks 1–5) | **Done** (PlacementBadge.ts, PlacementLegend.ts) |
| Bundle v2 data (GROTBC classes, 14 modes, auxiliary layers, features) | **Built** (`MS/Data/terrain-bundle`, pipeline step `grotbc`) |
| Engine reads v2 classes and modes (verdicts, overlay, legend, P, SIDC → mode) | **Done**: the current card and legend work on v2 unchanged |
| GROTBC card sections, three-per-mode while drawing, G brief | **To do** (this document) |
| Engine access to the auxiliary layers and features | **To do** (section 7) |

---

## 1 · Decisions

### 1.1 UI picks (approved, implemented in P1)

1. **Card layout B · Sectioned Bands.** Coloured verdict header, then sections on alternating bands.
2. **Why W3 · Going Scale.** The WHY section names the ground and the mode, gives the rule owner's sentence, and
   lights one step of a GO / SLOW-GO / NO-GO scale.
3. **Headings H3 · Caps Above with Verdict-Colour Key.** Section captions in small caps, coloured with the verdict's
   key colour (`--pb-k`).
4. **Legend L2 · Going Ramp**, titled "Legend", with Previous / Next and one icon per mode; the P (Change Mode) and
   S (Quick Fix) keys live in the legend; **S keycap in the card header** when the quick fix can help.
5. **Mode names:** Dismounted Force, Wheeled Vehicle, Tracked Vehicle, Surface Vessel, Gr Based (was Generic
   Land), Not Terrain-Bound. "Judged as" is now **"Mode"**.
6. **New modes (all nine):** Gun Position, Air Defence Site, Helicopter Landing Site, Amphibious, Mountain / Pack
   Transport, Road-Bound Wheeled, Over-Snow, Rail-Bound, Signals / EW Site.
7. **New layers (all nine):** finer slope bands, canals and irrigation channels, plan obstacles (live), road and
   track network, bridges / fords / crossings, railways, dominant ground, canopy height / concealment,
   wet-season going.

Keep the finalized wording, only in Title Case. Military terms set by the user: **Suitable Position**,
**SLOW-GO**, **NO-GO**, **Marginal**, **Quick Fix**, **Intermediate Gap Rule**.

### 1.2 GROTBC (approved direction)

The data is prepared **and** presented by **GROTBC**, the staff terrain headings everyone knows:
**G** Ground · **R** Roads, Tracks & Railway Network · **O** Obstacles · **T** Trafficability · **B** Built-Up Areas ·
**C** Cover, Camouflage & Concealment (detailed in `GROTBC.md` at the repo root; relabelled 2026-11-03: the first
build read R as Relief and T as Tactical Features, so relief now sits under G and roads, rail, crossings and
airfields under R. Changed again 2026-11-04: T is **Trafficability**, the going for the mode cross-country, on tracks,
roads and the MSR, dry and after rain; terrain type and vegetation moved to G). The same rules drive the pipeline and the card. Obstacles are typed by **origin**
(Natural, Man-Made, Reinforcing = placed by a force) and **kind**, with an **effect per force**: what stops a tank
need not stop infantry. Goal: the planner needs no other source about the ground.

### 1.3 GROTBC data decisions (user's answers, 2026-11-01)

| # | Question | Answer | How the data implements it |
| --- | --- | --- | --- |
| 1 | Load class code (40A1, 70A2) | Probably a military route class; exact convention unconfirmed | Read from the data as `<class><A all-weather / F fair-weather><1 single / 2 double lane>`: highways are almost all 70A2, motorways 80A2, the 3–4 m roads A1, F1 roads mostly unmetalled. Only the number is used; an `F` road counts as unmetalled. Flagged "inferred" in `rules.json grotbc.loadClassCode`. |
| 2 | Tankable threshold | Other: see 8 | **Class 60+** = tankable for every main tank; **50–59** = Al-Zarrar only; below 50 = non-tankable; no class = "class not recorded" (never shown as tankable). Width under 3.5 m is never tankable. HET (tank on a transporter) needs class 70. |
| 3 | What counts as an MSR | Motorway, highway, main road, defence road, broad-gauge railway, **plus metalled roads of class 50 and above** (first answer was 40; at 40 the commonest class, 40A1, made 63 % of road fragments MSR, so it was raised on 2026-11-03). `rules.yaml msr.namedRoutes` takes an official list when there is one | MSR bit in the `route` layer; `m: 1` on road and railway lines in features. |
| 4 | Water sources on the card | **Nearest of each kind** (tube well, well, spring, tank) | Water points in `features/` by kind (tube well, lined / unlined well, spring, perennial / seasonal tank, karez, hand pump, overhead tank); `rules.json grotbc.water.kinds` lists the card's kinds. |
| 5 | Sensitive layers | **In the main bundle** | Corps AOR (admin.geojson, `sensitive: true`), Corps ops lines, cantonments, posts, bunkers, trenches, forts, border posts, air bases with their units: all in the main bundle. LICENSES.txt marks the whole bundle restricted. |
| 6 | Card while drawing | **Three sections for the mode, G for the full brief** | Section 3 below. |
| 7 | Order of work | P1 restyle first, then the v2 data | Both done; the GROTBC card is next. |
| 8 | Corrections | **Al-Khalid, T-80, T-80UD and Al-Zarrar are the main tanks: find the road class they need** | `rules.yaml tanks`: Al-Khalid ~48 t (≈ MLC 53), T-80UD / T-80 ~46 t (≈ MLC 51), Al-Zarrar ~40 t (≈ MLC 44). MLC estimated as 1.1 × tonnes for tracked vehicles; replace with official figures when available. The recorded road classes are 9…35, 40, 50, 52, 56, 60, 70, 80, so the threshold is 60. |

---

## 2 · What is built (do not redo)

**Card** (`MS/Engines/Placement/PlacementBadge.ts`): verdict header (icon, title, `NN% Inside` pill, S Quick Fix
keycap pill); sections WHY (ground · mode, reason sentence, going scale), INSIDE (bar + "NN% of the Footprint /
Shape"), NEAREST (compass dial that follows map rotation, feature name, big distance, direction), INTERMEDIATE GAP
RULE; red Enforce Mode strip; loading and notice lines; touch placement above the finger.

**Legend** (`PlacementLegend.ts`): "Legend" + "Mode i / n" + ▾ details toggle (remembered in localStorage
`ms-placement-legend-details`); Previous / icon grid / Next (icons wrap into rows, so 14 modes fit in two rows of
7); mode name + tag (Auto · From Symbol / Set by Hand / Set in Settings); 4-colour ramp (Suitable, Marginal,
SLOW-GO, NO-GO) and the Marginal note; NO-GO and SLOW-GO chip lists from `rules.json` (scroll after 190 px);
P Change Mode and S Quick Fix keys (S lights green when the fix can help). Shown while the overlay is on or a
terrain-bound draw is armed.

**Engine for v2** (`PlacementAdvisor.ts`, `PlacementProfiles.ts`, `PlacementEvaluator.ts`, `PlacementTypes.ts`):
the 9 new modes in `PlacementProfile`, the mode order of P and the legend, SIDC → mode overrides from the bundle
(artillery → Gun Position, AD → Air Defence Site, signals / EW → Signals / EW Site, amphibious → Amphibious,
trains → Rail-Bound, tractor-trailer → Road-Bound, HLS / LZ → Helicopter Landing Site), and the nearest-NO-GO scan
limited to what the distance layer measures to (`CompiledProfile.target`, `rules.marginalIgnore`).

---

## 3 · Target: the GROTBC card

### 3.1 While drawing: three sections for the mode (decision 6)

The verdict header and the WHY going scale stay as they are. Under them the card shows the **three GROTBC sections
that matter most for the mode**, in GROTBC order, from this table (bold in the agreed requirements table):

| Mode | Sections while drawing | What the mode needs (data) |
| --- | --- | --- |
| Dismounted Force | **G O C** | going; water, snow, AP mines; cover within 100 m |
| Wheeled Vehicle | **G R O** | firm ground; road within 1 km, crossings by class; all water, bunds, railways |
| Tracked Vehicle | **G R O** | slope under 30°; tankable route and crossings; canals by width, bunds over 2 m, AT mines |
| Gun Position | **G R C** | slope under 7° (3° ideal); road within 500 m; concealment from the air |
| Air Defence Site | **G R C** | dominant ground; access road; open arcs (low vegetation) |
| Helicopter Landing Site | **G O T** | firm, no dunes, slope under 7°; no wires within 100 m; no trees, no built-up |
| Signals / EW Site | **G R O** | high ground; access road; away from power lines |
| Amphibious | **G O T** | water is SLOW-GO; entry and exit banks |
| Mountain / Pack Transport | **G R O** | steep slope SLOW-GO, snow SLOW-GO; pack tracks, passes |
| Over-Snow | **G O T** | snow cover and slope; obstacles; going over snow |
| Road-Bound Wheeled | **R O B** | on a metalled road (within 50 m); crossings by class; built-up on the route |
| Rail-Bound | **R O B** | on a railway; stations; level crossings |
| Surface Vessel | **G O R** | water and banks; crossings |
| Gr Based | **G O B** | water |

(Remapped 2026-11-03 from the first table, which used R = Relief and T = Tactical Features: slope and high ground
are now G, roads, rail, crossings and airfields are R. Since 2026-11-04 T is Trafficability and terrain type,
vegetation and landform are G; the T column above still fits, since HLS, Amphibious and Over-Snow most need the
going at the site. Open question: should Dismounted, Wheeled and Tracked show T in place of one section? The WHY
going scale already gives their verdict.)

Keep NEAREST and INTERMEDIATE GAP RULE as they are today; they sit after the three sections. The INSIDE section
stays for lines and areas.

### 3.2 G: the full brief

Pressing **G** (keycap in the legend's key list, next to P and S) opens the **Ground Brief** for the cursor or the
selected symbol: all six sections, a header line with mode · 1:50k sheet · tehsil · district, the sources line,
and **Copy as Text** for orders. Esc or G again closes it. The brief is a panel, not the cursor card: it does not
follow the pointer.

### 3.3 Section content and its data

| Section | Lines | Source (bundle v2) |
| --- | --- | --- |
| **G Ground** | Surface (class label, firm / soft) · Terrain type at the point and the nearest change ("Plain (Irrigated), Hilly to the N 2 km") · Vegetation (type, density) · Relief: Elevation, Slope (degrees + band: Level 0–3, Gentle 3–7, Sloping 7–15, Moderate 15–30, Steep over 30), Landform (Crest / Upper slope / Mid-slope / Lower slope / Valley floor / Flat), High ground nearby (spot height, distance, direction, height above) · Water: nearest of each kind · Soil and bearing ("Clay Loam (Modelled) · Firm When Dry, Soft After Rain") | `class` + `rules.json classes[c].kind`; `terrain` layer (`rules.json grotbc.terrainType`); `veg`-based `cc`; `elev_hi`/`elev_lo` (slope from a 3×3 gradient); `landform`; `soil` layer; features `spot_height` / `trig_station` (`e` = elevation); water kinds 1–9 |
| **R Roads, Tracks & Railway Network** | MSR (name / number, from – to, length, class, Tankable / Non-Tankable, distance) · Route at the point (type, class, condition, seasonal closure) · Crossings by class (bridge, foot bridge, ford / ferry) · Rail (line, station) · Airfield / helipad · Chokepoints (pass, tunnel, headworks) | `route` layer; `routes.json` (from, to, km, load, closed, cond); features `road` / `railway` lines (`n`, `r`, `c`, `k`, `m`, `x`, `cn`, `sl`); crossing classes 39–45, 50; air 40–47; rail 50; 55–58 |
| **O Obstacles** | Nearest obstacle: name · origin · kind · effect for the mode · distance / direction · Plan obstacles (live, from drawn minefields / obstacle lines) · Temporary / seasonal: flood-prone and waterlogged ground, roads closed by season, landslide sites | class scan with `rules.json classes[c].origin/kind`; `wet` layer; features road `x` / `sl`; plan graphics |
| **T Trafficability** | Going for the mode cross-country, dry ("SLOW-GO for Wheeled Vehicle (Watercourses) · Dry Season") and after rain (soil bearing for the month) · Dismounted, Wheeled and Tracked at a glance · Tracks and fair-weather roads (SLOW-GO after rain) · On road: nearest road or MSR fit for the mode (load class against the mode, A / F, lanes; "Tankable") · Monsoon going (flood-prone, waterlogged) · Season for the month ("Jul: 35° / 26°, 149 mm, Monsoon") · Air: landing-site going for Helicopter Landing Site · Cross-country speed (planned) | `class` + `rules.json profiles[mode].nogo / caution` (`dist_<mode>`); `wet` layer; `soil` layer + `grotbc.soilBearing[code]` `{dry, wet}`; `route` layer (load tier, MSR bit) + `grotbc.loadClassCode`; `routes.json`; `grotbc.tankable` / `tanks`; climate grid (`prec` by month, `monsoon_pct`, `frost_months`, `wet_months`); classes whose `grotbc` contains `T` are the ones that mainly change the going |
| **B Built-Up Areas** | Nearest BUA (name, size class, population) · Public infrastructure nearby (hospital, police, grid station…) · Border (distance to IB / LoC) · Admin (tehsil, district, province) · Sheet (1:50k number) | features 110–114 and 70–77; `boundaries.geojson`; `admin.geojson`; `sheets.json` |
| **C Cover, Camouflage & Concealment** | Four lines: Cover from direct fire · from indirect fire · Concealment from ground observation · from aerial observation (None / Poor / Fair / Good + what gives it) · Nearest bund / wall / nullah | `rules.json grotbc.coverSplit.byClass[class]` = `[direct, indirect, ground, aerial]` (a proposal for the owner to correct); `cc` layer for the local density (concealment = v >> 4, cover = v & 15); class `grotbc` contains `C` |

Water line format (decision 4): `Tube Well 250 m W · Spring 3 km N · Well 600 m SE · Tank 1.2 km E` (only kinds
found within the search radius; nearest first).

---

## 4 · Style guide

### 4.1 Tokens

| Token | Value | Use |
| --- | --- | --- |
| Card background | `#1b1f25` | card and legend body (`rgba(27,31,37,.95)` for the legend) |
| Band background | `#222830` | every second section (`.ms-pb-sec:nth-child(even)`) |
| Border | `1.5px solid var(--pb-c)` (card), `#39414b` (legend) | |
| Text | `#f3f5f7` body, `#fff` bold, `#9aa3ad` soft | |
| Verdict colours `--pb-c` (header) | ok `#1c8247` · near `#e9a526` · caution `#e08a1e` · partial `#d9622b` · in `#d63a3f` · neutral `#5b6470` | header fill and card border |
| Header text `--pb-fg` | `#fff` on ok / in, `#1b1f25` on near / caution / partial | |
| Caption key `--pb-k` | ok `#3fc07a` · near `#f2b84b` · caution `#f0a04b` · partial `#ef7d4a` · in `#ff6b6f` · neutral `#aab3bd` | section captions |
| Going scale | GO `#2fa862` · SLOW-GO `#f0932b` (dark text) · NO-GO `#e5484d`; off steps `rgba(255,255,255,.06)` / `#6b737c` | WHY scale, legend chips captions (`#ff8a8d` NO-GO, `#ffb766` SLOW-GO) |
| Overlay ramp | Suitable, Marginal, SLOW-GO, NO-GO from `PlacementOverlay.OVERLAY_COLORS` | legend ramp (swatch alpha raised to ≥ .55 on the dark card) |
| Keycap | `#3a424d → #2b313a`, border `#545e6b`, 2 px bottom; lit: `#3f8f5b → #2b6b42`, border `#5fc183`, glow `rgba(47,168,98,.25)` | P, S, G keys |
| Enforce strip | background `rgba(229,72,77,.14)`, top border `rgba(229,72,77,.45)`, text `#ffb3b5`, icon `#e5484d` | |
| Focus ring | `2px solid #8ec1ea`, offset 1 px | legend buttons |
| Selected mode | background / border `#8ec1ea`, icon `#1b1f25` | legend icon grid |

**GROTBC letters** (proposal; confirm before use): one accent per heading for the brief's letter badges and the
legend's layer switch. Keep them clear of the verdict colours: G `#8fb35a`, R `#c9a46b`, O `#7a5cc9`, T `#5aa9e6`,
B `#9a8f86`, C `#1f8a5a`. Obstacle origin chips: Natural `#2f7fbf`, Man-Made `#7a5cc9`, Reinforcing hatched
`#c4383c`.

### 4.2 Type and spacing

- Font: `system-ui, Segoe UI, Arial, sans-serif`; body 12 px / 1.4; header 13 px 600; big figures 18 px 700 with
  `tabular-nums`; captions 10 px 700, letter-spacing .12em, uppercase; soft lines 11 px; keycaps
  `ui-monospace, Consolas` 10–11.5 px 700.
- Card width 280 px (max `100vw − 8px`), legend 290 px (max `100vw − 24px`). Radius 10 px; pills 999 px;
  scale steps 2 px; chips 999 px.
- Section padding `7px 11px 8px`; header `6px 11px`; caption → content 5 px.
- One idea per section; at most two lines of text plus one graphic (scale, bar, dial).

### 4.3 Wording

- Title Case for headlines and labels through `titleCase()` (minor words stay lower: a, an, and, at, for, in, of,
  on, or, the, to). Words already in capitals (NO-GO, SLOW-GO, MSR, BUA) stay as they are.
- Say it in words: `plain()` turns ">30°" into "over 30°" and "15–30°" into "15 to 30°". No symbols or dashes in
  sentences.
- Reasons are the rule owner's sentences from `rules.json` (`profiles[mode].why[code]`, else `classes[code].note`).
  The engine never writes its own reason.
- Distances through `fmtDistance()` (metric / imperial / nautical setting); directions as 8-point compass words
  (N, NE, …).
- Mode names exactly as in `rules.json` labels; "Mode", never "Judged as".

### 4.4 Behaviour and accessibility

- DOM nodes and `textContent` only: class labels, names and unit text can never inject markup.
- The card never takes the pointer (`pointer-events: none`); the legend stops pointer and click events reaching
  the map.
- Screen readers: verdict read after the cursor rests 500 ms (`aria-live`); legend buttons have `aria-label` and
  `aria-pressed`; focus is restored after a re-render.
- `prefers-reduced-motion`: no transitions.
- Touch: card above the fingertip (28 px gap), kept inside a narrow viewport; keys hidden on touch input.
- Library rule: engines stay headless; anything in `index.html` / `src/main.ts` is harness only.

---

## 5 · Legend next steps (proposal; confirm)

The proposal mock-up added a **GROTBC layer switch** to the legend: six letter buttons G R O T B C under the mode
strip, each repainting the overlay and the key: G terrain type with slope bands (Level / Gentle / Sloping /
Moderate / Steep + crest line) and water sources, R routes (MSR, tankable road, non-tankable road, track, railway,
helipad / LZ, pass, crossings), O obstacles by origin (Natural / Man-Made / Reinforcing + crossing points),
T trafficability (today's going ramp for the mode, roads fit for the mode, soil poor after rain; the default
layer), B built-up and boundaries (BUA, IB / LoC, district / tehsil, 1:50k sheet grid),
C concealment (Good / Fair / Poor) and cover.
The G key joins P and S in the key list. Not yet approved: ask before building.

---

## 6 · Bundle v2 data contract (what the card can read)

Everything below is in `MS/Data/terrain-bundle` (pipeline: `tools/terrain-pipeline`, step `grotbc`).
`manifest.json` keeps `version: 1` (an engine that reads v1 loads it) and adds `dataVersion: 2` and a `grotbc`
block naming the layers and files.

| Item | Path | Encoding |
| --- | --- | --- |
| Classes | `class/{z}/{x}/{y}.png` | codes 0–50; `rules.json classes[c]` has `label`, `note`, `grotbc` (letters), `origin`, `kind` |
| Distance per mode | `dist_<mode>/…` | as v1; thin lines in `rules.marginalIgnore` are 0 on the line but cast no Marginal band; road- / rail-bound have no band (`marginal: false`) |
| Routes | `route/…` | bit 7 MSR, bits 5–6 load tier (0 not recorded, 1 below 50, 2 50–59, 3 60+), bits 0–4 type (`rules.json grotbc.layers.route.types`); overviews MAX |
| Landform | `landform/…` | 1 valley floor, 2 lower slope, 3 flat, 4 mid-slope, 5 upper slope, 6 crest / ridge; 255 nodata |
| Cover & concealment | `cc/…` | concealment = v >> 4, cover = v & 15; 0 none, 1 poor, 2 fair, 3 good; 255 nodata |
| Wet season | `wet/…` | 0 normal, 1 flood-prone, 2 seasonal water, 3 riverbed / floodplain, 4 waterlogged / marsh, 5 permanent water; overviews MAX |
| Terrain type (G, read by T) | `terrain/…` | 1 Plain, 2 Hilly, 3 Solid (rock / scree / stony bed), 4 Marshy, 5 Wet (open water), 6 Desert, 7 Mountainous (15°+), 8 Built-up, 9 Snow / ice; 255 nodata; overviews = majority. Rules in `rules.yaml terrainType` (starting proposal), shipped in `rules.json grotbc.terrainType` |
| Soil (G) | `soil/…` | USDA texture of the top 30 cm, 1 Sand … 12 Clay (`rules.json grotbc.layers.soil`); `rules.json grotbc.soilBearing[code]` = `{dry, wet, note}` going (used by T). SoilGrids 2.0, ~250 m, modelled; 255 nodata |
| Huts (B, construction) | `hut/…` | bits 0–6 permanent (kacha / mud) huts per km², bit 7 temporary huts nearby; 255 nodata |
| Climate (T, season for the going) | `climate/climate.json` + `climate.bin` | 252 × 204 cells of 5′ (WorldClim 1970–2000 normals); int16 layers: monthly `tmin` / `tmax` (0.1 °C), `prec` (mm), `wind` (0.1 m/s), plus `tmean`, `prec_year`, `monsoon_pct`, `frost_months`, `hot_months`, `wet_months`. Row 0 = north |
| Elevation | `elev_hi/…`, `elev_lo/…` | metres = hi × 256 + lo − 500; hi 255 = nodata; overviews = mean |
| Features | `features/10/{x}/{y}.json` + `features/index.json` | per z10 tile: `p` = `[kind, x, y, attrs?]`, `l` = `[kind, [x0, y0, x1, y1, …], attrs?]`, tile-local units 0…4095 (Web Mercator, y down). Kinds and attribute keys in `index.json` |
| Admin | `admin.geojson` | province / district / tehsil / corps_aor polygons (WGS84, simplified) |
| Boundaries | `boundaries.geojson` | IB, LoC, LAC, province, corps operational lines |
| Map sheets | `sheets.json` | `[sheet number, w, s, e, n]` for 50k / 250k / 500k / 1m |
| Named detail (features) | `features/` kinds 130–146 | mosque, graveyard / grave (single graves only when named), temple, church, eidgah, telephone / TV booster, post office, telephone exchange, market, bus stand, mill, stadium, toll plaza, waterfall, lake (named, or 0.25 km² and over; `a` = km²), glacier (named), river reach (`s` bed, `dp` / `dm` depth, `cu` current, `ws` wet span, `dc` discharge). Places carry `p` (official population where recorded), `wp` (WorldPop 2026 people nearest this place) and, for cities, district HQs and towns, `wc` (people within 12 / 8 / 4 km); `pv` province |
| Road graph (R) | `network/network.json` + `nodes.bin`, `edges.bin`, `geom.bin`, `names.json` | OSM road graph (2.76 M edges, 567,613 km) with per-edge NCGDB route code, MSR, tankable flag and worst crossing; schema in `network.json`. No router reads it yet (`GROTBC-Roads.md`) |
| Banks (O / C) | `bank/…` | land along water: kind = value >> 2 (1 river / lake, 2 floodplain edge, 3 perennial stream, 4 canal, 5 distributary), band = value & 3 (0 within 30 m, 1 75 m, 2 150 m); what a bank gives in `rules.json grotbc.banks` (cover four ways + deployment line) |
| Buildings (B) | `bld/…` | Open Buildings per ~150 m cell: density = value & 7 (`grotbc.layers.bld.density`), mean footprint class = (value >> 3) & 7 (huts under 40 m² … industrial over 1,000 m²), GHSL height class = value >> 6 (low / medium / multi-storey) |
| Population (B, civil considerations) | `population/population.json` + `population.bin` | 2034 × 1611 cells of 30″ (~1 km), uint16, value = file / `scale`, 65535 = no data, row 0 = north: `pop`, `males15_49`, `under15`, `over65` (WorldPop 2026, constrained: only cells with buildings), `density_2020` (people / km², unconstrained, so it also shows people living among the fields). `provinces.rows` = population weighted density per province (2020; GADM 3.6 names, F.A.T.A. still separate). Every layer names its source, `dataDate` and `released` |
| Settlements (B) | `settlements.json`, `settlements.geojson` | every built-up settlement: `name`, `alsoNames`, `class` / `label` (Metropolitan city 1 M+, Large city 500 k+, Mid-size city 100 k+, Town 20 k+, Large village 5 k+, Village 500+, Hamlet), `pop` (WorldPop 2026 inside the built-up patch), `males15_49`, `under15`, `over65`, `perKm2`, `km2`, `buildings`, `meanFootprintM2`, `meanHeightM`, `dou` / `douLabel` (GHSL degree of urbanisation), district / tehsil / province; outlines for 5,000+ people |
| GeoNames detail | `features/` kinds 147–159 | schools, banks, government offices, named mountains / hills / ridges (`e` elevation), dunes, landforms, streams, canals, wells, marshes, localities, forests, road junctions; `src: gn`; places carry `an` (alternate names) and `gn` (GeoNames id) |
| Named routes | `routes.json` | `roads` (by road number, else name) and `rails` (by name): `id`, `name` / `no` + `segs`, `from`, `to` (when the name reads "A - B"), `km` (sum of the mapped lines, geodesic), `type`, `msr`, `load` `[min, max]`, `closed` (seasons as recorded), `cond`, `bbox` `[w, s, e, n]`. Routes under 1 km that are neither MSR nor closed are left out |
| Terrain features + ITG candidates (G) | `features/` kinds 160–166, line kind 204 (`scripts/ground.py`) | peak, hill, knoll / raised ground, saddle (`t: pass` near a recorded pass), plateau (`a` km²), closed depression (`dp` depth), junction of main roads (`m` on an MSR, `mx` highway ways out), ridgeline (`e`, `lk` km). Points carry `e`, `rr` relative relief, `iso` dominance km, `vs` % of ground in view within 5 km, `mv` nearest MSR in view km, `sp` slope, `lc` class, `cv` cover code, `dr` / `dn` nearest MSR / road km, `hs` surveyed height, `src: dem` (modelled). **`ig`** (reason letters H O R P C J) and **`it`** (1 candidate, 2 strong: check as MITG) mark an ITG candidate, also on existing bridges, fords, ferries, tunnels, passes, barrages and dams. Codebook in `rules.json grotbc.itg.reasons`. The bundle never designates ITG / MITG: the card says "ITG candidate", and designation is the user's, saved with the plan |
| Doctrine numbers | `rules.json grotbc` | `tanks`, `tankable`, `msr`, `water`, `loadClassCode`, `layers` (codebooks), `coverSplit` (`fields`, `byClass`), `itg` |

Class codes 18–50: 18 gentle slope 3–7°, 19 sloping 7–15°, 20 canal, 21 distributary / minor, 22 drain,
23 irrigated cropland, 24 embankment over 2 m, 25 bund 1–2 m, 26 cutting, 27 cliff / escarpment / broken edge,
28 railway, 29 walled orchard, 30 orchard / garden, 31 forest (enclosed), 32 graveyard, 33 power line corridor,
34–37 metalled road by load tier (60+, 50–59, below 50, not recorded), 38 unmetalled road, 39–42 bridge by load
tier, 43 railway bridge, 44 foot bridge, 45 ford / ferry, 46 perennial stream, 47 dry nullah, 48 irrigated
cropland under power lines, 49 wall / fence, 50 level crossing.

**Known limits of the data** (say them in the card, never hide them): load class is recorded on about 31 % of
road segments ("class not recorded" otherwise); field channels and power lines are mapped unevenly (none near
Lahore); slope comes from a surface model, so cities and tree lines read a little steep; tank MLCs are estimates.
Road **condition** is recorded on about 4 % of road segments, **seasonal closure** on about 540 and **landslide
sites** on 71 (the NCGDB fields `CONDITION`, `CLOSED_DUE`, `NO_OF_SLID`), so "no closure" means "none recorded". Road
and rail lines also cover the Indian-administered side, because the data extent is the whole relief-map sheet.
Not in the NCGDB or the open data used: schools, government buildings and unnamed markets (77 markets, no
names), building construction type beyond hut symbols (`hut`), and any soil survey (`soil` is a 250 m model).
`wp` / `wc` are WorldPop estimates, not census counts; huts are mapped symbols, not a building survey.

---

## 7 · Engine work the GROTBC card needs

1. **Auxiliary tile layers.** `TerrainTileCache` / the worker decode any L8 PNG layer by name; add `route`, `cc`,
   `wet`, `landform`, `elev_hi`, `elev_lo` with their own overview rule, fetched only for the point under the
   card (not prefetched for the whole view). The manifest's `grotbc.layers` lists them.
2. **Features.** Load `features/10/x/y.json` for the cursor's tile and its 8 neighbours; keep a small per-kind grid
   index; nearest-of-kind is synchronous on cached tiles (hot path rule: no I/O on mouse-move).
3. **Section chooser.** The mode → three sections table (3.1) in the engine, overridable from `rules.json`.
4. **G brief panel** with Copy as Text; G key in `KeyboardShortcutManager`, scoped to the view's container.
5. **Plan obstacles (live).** Minefields, obstacle lines / zones, AT ditch and DCB symbols already on the map count
   as Reinforcing obstacles for the O section and the verdict, with no rebuild.
6. **Season switch** (dry / monsoon, or the month) reading `wet`, the soil bearing and the climate grid for the
   T section's after-rain and Monsoon going lines.
7. **ITG in the G section.** *Done 2026-11-04* as a card section of its own (*Important Tactical Ground*) until the
   G section exists: `PlacementFeatures.ts` loads `features/` tiles (the first engine reader of them, so item 2 is
   started), `advisor.groundCandidates()` is the API, `symbolEngine.designateGround(target, 'ITG' | 'MITG')` draws
   an Imp Gr ("IG", new local symbol `00000160`, `MS/Symbols/ImpGr.ts`) or a Vital Gr ("VG") as an ordinary plan
   symbol. Open: `KeyTerrainIdentificationEngine` ranking the bundle's candidates for the user's axis instead of
   recomputing them from the elevation service.

---

## 8 · Open questions for the user

1. Approve the GROTBC letter colours and the legend layer switch (section 5)?
2. Official MLC figures for Al-Khalid, T-80UD, T-80 and Al-Zarrar, to replace the estimates.
3. Confirm the load-code reading (A / F = all- / fair-weather, 1 / 2 = lanes).
4. Correct the per-mode NO-GO / SLOW-GO tables in `tools/terrain-pipeline/rules.yaml` (they are a starting
   proposal) and the three-sections table above.
5. Should "Irrigated cropland" stay SLOW-GO for Wheeled Vehicle year-round, or only in the monsoon?

## 9 · Acceptance checklist for the restyle

- [ ] Each mode shows its three sections while drawing; G opens all six; Copy as Text works.
- [ ] Every line names its source when the data is missing ("class not recorded", "no water source mapped within
      5 km"), never an empty row.
- [ ] Card stays 280 px wide, never covers the cursor, flips at screen edges, works in 2D and 3D and on touch.
- [ ] No reflow on mouse-move (measure once per show), no I/O on mouse-move.
- [ ] Title Case and the military wording above throughout; no symbols in sentences.
- [ ] Works on a v1 bundle too (sections without data are left out).
- [ ] `tsc -p tsconfig.build.json` clean for the touched files; browser check with screenshots.
