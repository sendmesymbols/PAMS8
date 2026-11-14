# 19 — Move Planner (Rd Mov, Mov & Assy, DI Mov, Rly Mov, En Mov)

`MS/Engines/MovePlanner/` · switch `features.movePlanner` (off by default) · options `movePlanner.*` · Ctrl+K → Move Planner

The five modules of the old Mov Plan web app (`Material/movplan`: rdmov, movassy, dimov, railmov, enmov) rebuilt as one
planner. Their rules were read out of the code, checked against the **SO's Handbook (2019) Sec 9 Mov** and **Staff Duties
in the Field Vol II** (Road Movement, Rail Movement), corrected where the code was wrong, and filled where it left gaps.
Every rule and figure is in `MS/Data/MoveDoctrine.json` with its basis: **R** (handbook / staff duties), **O** (the old
code), **E** (a proposal to correct).

## Use

- **🚚 Mov Plan** (info bar) turns it on and opens the panel at the foot of the map; **⚙** opens its settings.
- **U** opens / closes the panel, **Shift+U** walks its views, **Esc** closes it.
- Tabs across the top are the five kinds; each keeps its own plan (kept in the browser; **Save** / **Open** as .json).
- **+ Route on Rds**: click the SP, any points to pass, double-click the Rel P. With the road network up (GeoCore) the
  route is solved on the roads and its note gives the lowest load class, the MSR share and the weakest crossing; without
  it the clicks are the route. **+ Draw Route** by hand, **+ Selected Line** from a placed line (also right-click a line →
  **Mov Plan: Use as Route…**), **+ CP** by clicking.
- **+ From Selected Symbols** makes serials from the unit symbols selected on the map (name, SIDC → arm, place → DL).
- The **timeline** under the panel puts every column on the map at the chosen time (▶ plays it).

## Kinds and views

| Kind | Setup | Views |
| --- | --- | --- |
| Rd Mov | routes; serials with vehicles, start / delay, speeds and densities (blank = doctrine), tanks in the column, loading / unloading | Mov Table, Graph, Matrix, Flow |
| Mov & Assy | the same as columns of formations, group priority, the assembly area (✎) and its size | Mov Table, Graph, Matrix + block timings + assembly area check, Flow |
| DI Mov | units with corps / op corps / formation, priorities corps / group / unit, arm, HMT own / bus / truck, concentration time summer / winter, peace location (DL) | Mov Table, Graph, Progress, Reports (arm-wise, priority-wise, HMT by formation) |
| Rly Mov | E.Sta / D.Sta (📍), rail route or straight line x 1.25, line, mov type, gap, live line, wagons a day; units with vehicles by kind, extra personnel, stores | Trains (make-up strips), Mov Table + timetable, Graph, Stock Req |
| En Mov | enemy formations by type (trains), rail or road, stations, distance, start, gap | Mov Table, Graph, Induction (matrix by day) |

## Road rules (R unless marked)

- **TPP** (min) = vehs x 60 / flow + **2 min per 25 vehs or part thereof**; flow = density x speed. (Old code: 2/25 min per
  vehicle; `road.tpp.extra: "prorata"` restores it.) Length of column = TPP x speed.
- **Speeds** day / night: excl tanks good 40 / 30, hilly 30 / 20, bad 30 / 20; all types good 25 / 20, bad 20 / 15. Mov & Assy
  defaults 25 / 20 and DI 40 / 20 (O). **Densities**: Rd Mov night 40, day 20, day & night 25; DI day 25 / night 40 (O).
- **Halts**: 10 min after each 110 min running (R); every 3rd a 30 min long halt (O); or **at 10 min to each odd hour**,
  all columns together (R specimen).
- **Close up at last light**: the head halts Day TPP − Ni TPP, or longer when the night speed is lower, for the tail (R).
- **Mov window** Ni / Day (by first / last light at the SP, or clock times) / Day & Ni: a column that cannot reach its next
  halt before the window closes harbours at that halt until it opens (O); a halt over 2 h is a harbour (R).
- **Due** = the head reaches a point; **Clear** = the tail has passed it. The whole column halts together; past the Rel P
  it runs on until its tail has cleared it.
- **Crossings**: where routes cross, join or part (and every 10 km along road used in the same direction), the serial of
  lower priority waits until the other has cleared + 1 min (O, DI Mov). Priority is strict: corps, then group, then unit,
  then order of march. Every wait is fed forward and all points checked again. Head-on on a two-way road is no clash.
- **Light**: first / last light = sunrise / sunset (O) or civil / nautical twilight, at the place, in the plan's zone.

## Rail rules (R unless marked)

- Vehicles go on the stock the table names: 2 T-series tks or 1 M-series tk per **MBFR** (64 t with one, 96 with two),
  1 tk / ARV / dozer / crane per **MBFU**, 2 APCs / 2 jeeps with trailers / 1 2.5-ton truck per **BKF**, 1 APC / 2 jeeps per
  **KF**, an AVLB on 2 MBFRs; personnel 60 a **TLR**; stores 20 t a **C** (kinds in `vehicles.kinds`, the mapping is E).
- A train: 2 engines, brake van, 2 AD KFs, mob ramp KF, kitchen C, crew TLR (8 C units) + wagons, within **72 C units**
  excluding engines, **2,000 tons**, **18 double-loaded MBFRs**. (Old code: under 70 C including the fixed stock, no
  weight limit.)
- Night moves: stock placed **45 min after last light** at the earliest, loaded before first light; trains leave at least
  **1 h 30 min** apart; **32 kmph** main line, **24** branch; 60 min halt every 8 h (O, En Mov); loading 60, marshalling
  30, unloading 60, unforeseen 30 min (E); mob ramp +30 / +45 min on a live line. Wagons a day limit the trains a night.

## Enemy rules

- Trains by formation type (armd div **55**, R; the rest E: inf div 36, mech 48, inf bde 7 …). Train k leaves at the first
  departure + k x gap (at least 90 min); arrival adds running, halts, crossings and unforeseen; **inducted** 3 h after the
  last train has detrained (E). Formations from the same E.Sta follow one another; arrivals at a D.Sta keep the gap.
- By road: a column with the road rules (vehicles by type, speeds 40 / 30, density 20 / 30).
- The **induction matrix** (Staff Duties Annex D to Ch 7): by the end of each day, which formations are moving and which
  are in the area.

## What the old code got wrong (fixed here)

Day / night compared hours and minutes separately (no time ever counted as day); the M day was "today"; halts snapped to
route vertices and hours were rounded before x 60; the "other arrived first" crossing branch never ran (Math.abs) and the
priority test needed all three at once; crossings were found only where routes shared road; delays were not fed
forward; trains after the first left at start + one interval and never moved to their M day; rail ignored the weight
limit; En Mov ignored its M date and all seven mobilisation times.

## API

```ts
const mp = symbolEngine.movePlanner;          // null until features.movePlanner is on
mp.openPanel(true, 'graph');
mp.setPlan(planJson);                           // any kind; returns the worked-out result
mp.getPlan(); mp.result; mp.text();             // the plan, its result, the mov table as text
mp.addRoute('network' | 'draw' | 'line'); mp.useGraphic(line); mp.fromSelection();
mp.setTime(utcMs);                              // columns on the map at a time
```

Pure engines (`MoveTime`, `MoveGeo`, `MoveRoad`, `MoveRail`, `MoveEnemy`, `MoveReports`, `MovePlannerModel`) are checked by
`node tools/moveplan-test/run.mjs` (69 checks). Map layers `ms-move-planner`, `ms-move-planner-time`. The terrain bundle is
not read.
