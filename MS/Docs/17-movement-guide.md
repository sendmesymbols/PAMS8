# 17 · Movement Guide (Mov Guide cards)

Nine cards for the safety of the move (the ninth, Water, classifies a water obstacle), read from the terrain bundle (the same bundle as the Ground Guide). They are
**not tied to any symbol**: each card has its own input (click a town, draw a route, click two points, draw a line, or
use a selected placed line / area), works out its plan at once, draws it on the map, and can **create it on the map as
ordinary symbols** (saved, edited, undone like any other) or give its brief with **Copy as Text**.

Code: `MS/Engines/MovementGuide/` · rules and figures: `MS/Data/MovementDoctrine.json` (R = roadmap rule from the
pamphlets, E = proposal) · checks: `node tools/movement-test/run.mjs` (route scan, 38) and
`node tools/movement-test/plans.mjs` (the cards, 31), `node tools/movement-test/water.mjs` (the water obstacle classifier, 56).

| Card | Input | What it gives | Create on Map |
| --- | --- | --- | --- |
| **Cordon** | Click a Town / Draw Area / Use Selected | Inner cordon (15 men / 100 m + 5 for rooftops + 3 per side road) split into platoon sectors of 200 m in companies, rooftop sections, side-road posts; outer ring of road blocks on every exit; rural: a section on each escape route; people inside by age, sensitive sites, possible hides | Inner (line) and outer (dotted) cordon, Cordon and Search, Pl Posts per sector, Blocking of Rd, Check Pts, Obsn Posts on rooftops |
| **Picket** | Draw Route / Use Selected | Route picketing on both sides, or piqueting with the fewest posts (a platoon each; high Gr, named heights, posts / towers, rooftops in BUA); when each is up (along the road, then the climb); gaps; check posts; clear first; casevac | The route, Pl Posts P1…, Check Pts |
| **Convoy** | the same route | Packets (5-10 vehicles, up to 5 min apart), SP / RP times by day or night (MovementSpeeds columns, halts), bounds of about 10-15 km ending at safe halts, what each bound must clear | The route, Start Pt, Release Pt, Check Pts at the bounds |
| **Mines** | the same route | Likely mine / IED sites ranked: junctions, bends, culverts, crossings, level crossings, climbs, BUA | Unspecified Mine points L1… |
| **Patrol** | Start + Objective | A route out and a different route back (A* avoiding wood edges, villages, tracks, skylines and the threat's view), the night march chart from the Platoon Guide's `patrolCard`: legs with bearing, distance, paces, night / day time, the landmark at each turn, FMP, exposed stretches, skylines, obstacles | Route out (arrow), route in (dotted arrow), Start Pt, FMP (Rally Pt), Check Pts at leg ends |
| **Ambush** | the route (the enemy's) | Sites ranked on the rule (defile or bend, hidden from the vehicles behind, covered withdrawal, away from reinforcements, no village); for the chosen site a line / L / V layout: killing zone, fire group, stop groups, meeting point 750-900 m back | Killing zone, Fire Gp, Stop groups, MP (Rally Pt) |
| **Rd Block** | the route | Road block / tank ambush sites (round a bend or over a crest, no bypass, no room to turn, tied to an obstacle) with flanking positions that see the approach | Blocking of Rd, AT positions |
| **Infil** | Draw Line (border / LoC / own line), enemy side | The band the existing posts see, likely lanes through the ground they do not, and the fewest new anti-infiltration posts that see the lanes | Infiltration Lanes (hostile), Obsn Posts AIP… |
| **Water** | Click the Bank / Draw Axis / Along the Reach / Use Selected (a point, an AT Ditch / DCB / Obstacle Line, an axis) | The water obstacle as IBB Annex P types it (1 dammed river, 2 undammed river, 3 irrigation canal (and distributaries as its tail), 4 link, 5 feeder, 6 twin canal, 7 drain, 8 anti-tank ditch, 9 defence drain, 10 double ditch; streams, nalas and lakes named but not Annex P); home bank against far bank; width, depth, current, bed, bank heights above water and land, each with its source; the tank / wheels / foot check; crossings with load class and months; the season; what to confirm on the ground. Axis: every obstacle in order. Reach: stations every 500 m, narrowest and lowest far bank | The obstacle as an Obstacle Line named by its type, bridges (Land Instl - Bridge, with class), fords and ferries (Check Pts) |

The Picket, Convoy, Mines, Ambush and Rd Block cards share one route. While a route is drawn the danger ribbon follows
the cursor. A row with a place moves the map to it; on Ambush and Rd Block a row picks the site whose layout is drawn.

## The Mov Detail, keys and the cursor card

The cards live in the **Mov Detail**, a wide card docked at the foot of the map in the Ground Detail's manner: tabs
with their keys, an **answer strip** (the card's answer in one big figure and its key facts), and a **band** of fixed
height where the card's sections run down newspaper columns. It never scrolls: what does not fit goes to the next page.
The grip on its top edge sets its height (kept for next time).

| Key | |
| --- | --- |
| **N** | open / close the Mov Detail |
| **1-9** (while it is open) | 1 Cordon, 2 Picket, 3 Convoy, 4 Mines, 5 Patrol, 6 Ambush, 7 Rd Block, 8 Infil, 9 Water |
| **9** again on Water | the lens's next page, then the next lens (Shift+9 back) |
| **Q** (Water open) | the Water cursor card's next style: Section, Plan, Gauges (kept for next time) |
| the same number again | next page (Shift: back; past the last page it starts again) |
| **Esc** | close (a draw in progress takes Esc first) |

Digits belong to the Mov Guide only while its card is open, so the Ground Guide's Extended View 1-3 work otherwise.
`movementGuide.keys` switches the keys off.

Each card opens its band with a picture: the cordon as a **ring of platoon sectors** coloured by company with road
blocks on the outer ring and a manpower bar; the route as a **profile** (height along it, danger bands, each picket's
reach, bounds, mine diamonds, sites); the convoy as a **time-distance chart** of the packets through the bounds; the
patrol as a **height profile** with numbered leg ends, skylines and exposed stretches, and a **rose** of leg bearings;
ambush and road block as **sketches from above**; infiltration as a **band diagram** with lanes and posts and
before / after gauges (`MovementGuideViz.ts`).

The **cursor card** (`movementGuide.cursor`) follows the mouse while the Mov Detail is open and says what is under the
pointer for the open card: the route's km, the dangers there and what the card plans for it (the picket that sees it,
the bound and when the first and last packets pass, the site); the cordon sector or road block; the patrol leg
(bearing, distance, paces, time, landmark); the lane or post; off any plan, the ground, the people a km² and the
nearest place; while drawing, the route so far with its risk. A coloured edge carries the worst danger there and a
mini strip shows where along the route the pointer is. `movementGuide.hoverAt(lng, lat)` gives the same for hosts.

## Switching it on

`features.movementGuide` (off by default) or the **🛣 Mov Guide** button in the top bar; Ctrl+K → Movement Guide.
Off means off: no bundle request, no layer, no window, no listener. Without a bundle: one Engine Log line and the
cards say "No terrain data" with Try Again; drawing symbols works as usual (`claude_rules.md`).

| Setting | Default | |
| --- | --- | --- |
| `movementGuide.threat` | `groundGuide` | The Ground Guide's threat marker (Extended View, F); enemy symbols are never read. |
| `movementGuide.map` | `true` | Draw the open card's plan. |
| `movementGuide.bundleUrl` | `/terrain-bundle` | |
| `movementGuide.useWorker`, `cacheTiles` | `true`, 384 | |

Each card's own settings (men per 100 m, picket range, packet size, bound length, SP time, what a patrol avoids, killing
zone, band depth ...) are on the card.

## API (`symbolEngine.movementGuide`)

```ts
const mg = symbolEngine.movementGuide;              // null until features.movementGuide is on
mg.showCards(true, 'cordon');
mg.setCordon([73.3005, 33.256]);                    // or a [lng, lat] ring
mg.setRoute([[73.30, 33.90], [73.33, 33.93], [73.37, 33.95]]);
mg.setPatrol([73.30, 33.90], [73.33, 33.925]);
mg.setInfilLine([[73.20, 33.95], [73.27, 34.04]]);
mg.setParam('picket', 'mode', 'fewest');
await mg.settle('picket');                          // waits for the terrain it needs
mg.result('picket');  mg.reportText('picket');  mg.createOnMap('picket');
mg.useGraphic(graphic, 'convoy');                   // a placed line / area as the input
mg.setWater([73.30, 33.90]);                        // Water card: the obstacle nearest, home on this side
mg.setWaterAxis([[73.30, 33.88], [73.30, 33.95]]);  // every obstacle the axis crosses, home at its start
mg.setWaterReach([73.30, 33.90], [73.33, 33.90]);   // stations along the obstacle
mg.swapHome();
```

Right-click a placed line → **Mov Guide: Use as Route…**; an area or point → **Mov Guide: Cordon…**; a point or line → **Mov Guide: Water Obs…**.

## Basis

Everything is an estimate from 30 m ground data and the bundle's points and lines; the briefs say "check on the
ground". The bundle holds no enemy data and no record of past incidents.

## The Water card (water obstacle classifier)

Code: `MovementGuideWater.ts` (pure engine), `MovementGuideWaterViz.ts` (cross-section, axis strip, reach strip);
figures: `MovementDoctrine.json` → `water` (the ten Annex P types read from `Material/IBB.pdf` p463-466, with the
pamphlet's own widths, depths and bank heights; the tank figures from the roadmap; the wading depths are a proposal, E).

**How it finds the obstacle.** The nearest canal or river line of the bundle's features within 500 m (name, type,
width, depth and bank heights from the sheet), else the nearest water of the class layer (canal, distributary, drain,
water, stream) when it is much nearer and not the same water as a line (a wide river's bed and flood zone count as its
water). A placed AT Ditch / DCB / Obstacle Line is the obstacle itself. Then a cross-section square to it every 10 m:
the water's edges, each bank's crest within 150 m, the land 200-400 m behind, raised (in-filled) or sunk (in-cut), the
marsh strip and the bunds. Type: the sheet's canal type and name (Link, Feeder, Drain, Disty / Minor), a second canal
within 400 m and parallel (twin), the river in the list of dammed rivers or a dam / barrage / headworks on it within
25 km, else the class. Anti-tank ditches, defence drains and double ditches are not in the bundle: they come from the
symbol, or the Type setting on the card.

**Home and far.** Away from the Ground Guide's threat marker when one is set, else the side clicked (the axis's start);
⇄ Swap Home turns it. A click on the water leaves it to be set (it says so, and it is on the recce list).

**Sources and safety.** Every figure says where it comes from: Sheet, Sheet reach, Map class, Est. 30 m (with +2 m on
its top end for a bank 30 m ground can miss), Symbol, IBB typical, Unknown. **We: Cross it** takes each unknown at its
bigger end; **Hold it** at its smaller end (the obstacle is never overstated). The sheet's left / right bank heights
(`bl`, `br`, kept by the pipeline from 2026-11-11) go on a side only when the 30 m heights along the line show which
way it flows (the bundle's lines are drawn downstream only about 2 times in 3); otherwise "side not recorded".
Bundles built before 2026-11-11 carry only the higher bank (`b`): rebuild the features (`grotbc.py --only features`,
then the steps that merge into them) for both.

**Crossings** on the obstacle within the set km (on its line within 80 m; for class-only water within 2 km of its run):
bridges with the class of the route layer under them (39 class 60+, 40 50-59, 41 below 50, 42 not recorded), fords and
ferries with the months the sheet gives (in use this month or not) and their boats; culverts only on channels under
15 m.

**Season.** The month (default this month; monsoon July-September): a dammed river in the dry season is crossable at
most places (SLOW-GO), a drain is dry outside the rains but still a 1.8-4.6 m step.

### Water: the cursor card and the lenses

**Cursor card** (`MovementGuideWaterCard.ts`, pictures in `MovementGuideWaterPics.ts`). While the Mov Detail is open
on Water, a 350 px card follows the mouse over water: a quick read as it moves (type, name, width), the full reading
once it rests 350 ms, home being the side the mouse is on (or away from the threat marker). The bar carries the tank
verdict's colour and the Annex P number; then the name, your bank, cross / hold, the month; the hero in one of three
styles, cycled with **Q**: **Section** (a fisheye cross-section: the water and banks get most of the width, the land is
squeezed to the edges; the bed at the recorded depth or dashed with "?"; home / far crests flagged; a soldier 1.8 m and
a tank 2.4 m on the home bank to the picture's height scale, never more than 12 px a metre), **Plan** (the obstacle from
above at its true bearing, turning with the map, home half green and far half red, the crossings to scale out to 1 km
and on a log band beyond, the mouse; beside it width, depth, home and far bank, each with its source letter), **Gauges**
(depth against the wading depths, the step out against the tank's 0.9 m climb with a man for scale, the width on a log
scale against the tank's gap, a full ditch and the division's bridge spans from IBB Annex Q). Under it the tank /
wheels / foot chips, the tank's reason, and the obstacle straightened with its crossings either way.

**Lenses** (`MovementGuideWaterDetail.ts`): a row under the card tabs, each lens with its answer under its name, the
answer strip for the lens, the band with its pictures first. **Type** (the ten Annex P types as silhouettes from the
pamphlet's sketches, this one lit; the month wheel with the monsoon shaded; why; the input and settings), **Section**
(the fisheye section, every figure with a source badge, the sources donut), **Banks** (home and far bank towers against
the tank's climb and a man; bunds, marsh, crest distance), **Going** (mover chips, the gauges, the figures behind them),
**Crossings** (the plan radar, the obstacle straightened, the list, the months fords and ferries run), **Recce** (what
to confirm, how much is measured), **Reach** after Along the Reach. Source letters: S sheet, R sheet reach, M map class,
Y symbol, E 30 m estimate, I IBB typical, ? unknown. A crossing recorded twice within 40 m is listed once.
