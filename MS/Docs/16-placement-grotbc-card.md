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
**G** Ground · **R** Relief · **O** Obstacles · **T** Tactical Features · **B** Boundaries & Built-Up ·
**C** Cover & Concealment. The same rules drive the pipeline and the card. Obstacles are typed by **origin**
(Natural, Man-Made, Reinforcing = placed by a force) and **kind**, with an **effect per force**: what stops a tank
need not stop infantry. Goal: the planner needs no other source about the ground.

### 1.3 GROTBC data decisions (user's answers, 2026-11-01)

| # | Question | Answer | How the data implements it |
| --- | --- | --- | --- |
| 1 | Load class code (40A1, 70A2) | Probably a military route class; exact convention unconfirmed | Read from the data as `<class><A all-weather / F fair-weather><1 single / 2 double lane>`: highways are almost all 70A2, motorways 80A2, the 3–4 m roads A1, F1 roads mostly unmetalled. Only the number is used; an `F` road counts as unmetalled. Flagged "inferred" in `rules.json grotbc.loadClassCode`. |
| 2 | Tankable threshold | Other: see 8 | **Class 60+** = tankable for every main tank; **50–59** = Al-Zarrar only; below 50 = non-tankable; no class = "class not recorded" (never shown as tankable). Width under 3.5 m is never tankable. HET (tank on a transporter) needs class 70. |
| 3 | What counts as an MSR | Motorway, highway, main road, defence road, broad-gauge railway, **plus metalled roads of class 40 and above** | MSR bit in the `route` layer; `m: 1` on road and railway lines in features. |
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
| Wheeled Vehicle | **G O T** | firm ground; all water, bunds, railways; road within 1 km, crossings by class |
| Tracked Vehicle | **R O T** | slope under 30°; canals by width, bunds over 2 m, AT mines; tankable route and crossings |
| Gun Position | **R T C** | slope under 7° (3° ideal); road within 500 m; concealment from the air |
| Air Defence Site | **R T C** | dominant ground; access road; open arcs (low vegetation) |
| Helicopter Landing Site | **G R O** | firm, no dunes; slope under 7°; no wires within 100 m, no trees, no built-up |
| Signals / EW Site | **R T B** | high ground; access road; away from power lines |
| Amphibious | **O T G** | water is SLOW-GO; entry and exit points |
| Mountain / Pack Transport | **R O T** | steep slope SLOW-GO, snow SLOW-GO; pack tracks, passes |
| Over-Snow | **G R O** | snow cover; slope; obstacles |
| Road-Bound Wheeled | **T O B** | on a metalled road (within 50 m); crossings by class |
| Rail-Bound | **T B O** | on a railway; stations |
| Surface Vessel | **O T B** | water; crossings; banks |
| Gr Based | **G O B** | water |

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
| **G Ground** | Surface (class label, firm / soft) · Going for the mode (scale) · Monsoon going · X-country speed (later) | `class` + `rules.json classes[c].kind`; `wet` layer; profile nogo / caution |
| **R Relief** | Elevation · Slope (degrees + band: Level 0–3, Gentle 3–7, Sloping 7–15, Moderate 15–30, Steep over 30) · Landform (Crest / Upper slope / Mid-slope / Lower slope / Valley floor / Flat) · High ground nearby (spot height, distance, direction, height above) | `elev_hi`/`elev_lo` (slope from a 3×3 gradient); `landform`; features `spot_height` / `trig_station` (`e` = elevation) |
| **O Obstacles** | Nearest obstacle: name · origin · kind · effect for the mode · distance / direction · Nearest crossing (bridge class, foot bridge, ford / ferry) · Plan obstacles (live, from drawn minefields / obstacle lines) | class scan with `rules.json classes[c].origin/kind`; crossing classes 39–45, 50; features crossings; plan graphics |
| **T Tactical Features** | MSR (name / number, class, Tankable / Non-Tankable, distance) · Route at the point · Water: nearest of each kind · Helipad / airfield · Rail (line, station) · Chokepoints (pass, tunnel, headworks) | `route` layer; features `road` / `railway` lines (`n`, `r`, `c`, `k`, `m`); water kinds 1–9; air 40–47; rail 50; 55–58 |
| **B Boundaries & Built-Up** | Nearest BUA (name, size class, population) · Border (distance to IB / LoC) · Admin (tehsil, district, province) · Sheet (1:50k number) | features 110–114; `boundaries.geojson`; `admin.geojson`; `sheets.json` |
| **C Cover & Concealment** | Concealment (None / Poor / Fair / Good + what gives it) · Cover (… + nearest bund / wall / nullah) · Hide area (later) | `cc` layer (concealment = v >> 4, cover = v & 15); class `grotbc` contains `C` |

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
strip, each repainting the overlay and the key: G going ramp (today's), R slope bands (Level / Gentle / Sloping /
Moderate / Steep + crest line), O obstacles by origin (Natural / Man-Made / Reinforcing + crossing points),
T routes (MSR, tankable road, non-tankable road, track, railway, helipad / LZ, water source, pass), B built-up and
boundaries (BUA, IB / LoC, district / tehsil, 1:50k sheet grid), C concealment (Good / Fair / Poor) and cover.
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
| Elevation | `elev_hi/…`, `elev_lo/…` | metres = hi × 256 + lo − 500; hi 255 = nodata; overviews = mean |
| Features | `features/10/{x}/{y}.json` + `features/index.json` | per z10 tile: `p` = `[kind, x, y, attrs?]`, `l` = `[kind, [x0, y0, x1, y1, …], attrs?]`, tile-local units 0…4095 (Web Mercator, y down). Kinds and attribute keys in `index.json` |
| Admin | `admin.geojson` | province / district / tehsil / corps_aor polygons (WGS84, simplified) |
| Boundaries | `boundaries.geojson` | IB, LoC, LAC, province, corps operational lines |
| Map sheets | `sheets.json` | `[sheet number, w, s, e, n]` for 50k / 250k / 500k / 1m |
| Doctrine numbers | `rules.json grotbc` | `tanks`, `tankable`, `msr`, `water`, `loadClassCode`, `layers` (codebooks) |

Class codes 18–50: 18 gentle slope 3–7°, 19 sloping 7–15°, 20 canal, 21 distributary / minor, 22 drain,
23 irrigated cropland, 24 embankment over 2 m, 25 bund 1–2 m, 26 cutting, 27 cliff / escarpment / broken edge,
28 railway, 29 walled orchard, 30 orchard / garden, 31 forest (enclosed), 32 graveyard, 33 power line corridor,
34–37 metalled road by load tier (60+, 50–59, below 50, not recorded), 38 unmetalled road, 39–42 bridge by load
tier, 43 railway bridge, 44 foot bridge, 45 ford / ferry, 46 perennial stream, 47 dry nullah, 48 irrigated
cropland under power lines, 49 wall / fence, 50 level crossing.

**Known limits of the data** (say them in the card, never hide them): load class is recorded on about 31 % of
road segments ("class not recorded" otherwise); field channels and power lines are mapped unevenly (none near
Lahore); slope comes from a surface model, so cities and tree lines read a little steep; tank MLCs are estimates.

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
6. **Season switch** (dry / monsoon) reading `wet` for the G section's Monsoon line.

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
