# 18 — Night March chart

`MS/Engines/NightMarch/` · switch `features.nightMarch` (off by default) · options `nightMarch.*` · Ctrl+K → Night March

OCOKA_Roadmap.md ch. 2 (Attack): *Night march chart — bearings and paced legs (120 paces = 100 m), FUP marking layout.*

## Use

- **🌙 Nt March** (info bar) turns it on and starts a route; **✎** draws a new one; **⚙** opens the settings.
- Click the **SP**, then each **turn** (on a feature you can see at night), **double-click the FUP**, then click the
  **Obj** (Esc for none). Backspace takes the last point back; in the Obj step it returns to the route.
- Right-click a placed line → **Night March: Chart…** (the line is the route, its last point the FUP).
- **W** opens the chart docked at the foot of the map and walks it: next page, then the next style; **Shift+W** back;
  **Esc** closes it (first Esc closes the chart only, as in the Ground Detail).

## Cursor card (mouse move)

While drawing, a card follows the pointer for the leg in hand:

- compass dial: the needle and a **3° drift cone**, the legs already laid as faint numbered spokes, magnetic north
  (when the GMA is set) and the Obj on the rim; turns with the map;
- bearing magnetic / grid / mils, **paces** with the **pace cord** (a bead per 100 m, a knot every 500 m), time by night
  and the march so far;
- the landmark the leg would end on, hazard chips (crosses a canal, skyline, inside the enemy's night sights, long
  leg with its drift), the legs ribbon, and a ruler of the distance to the Obj against the night-sight and thermal rings
  (the Obj step reads "FUP here: OK / at the edge / too close").

On a finished route (`nightMarch.hover`) the card shows the leg under the pointer: paces in and to go (the cord lit to
here), when the column passes, the landmark at its end.

## Chart styles (W)

| Style | What it shows |
| --- | --- |
| Chart | The march card as a table (leg, bearing, distance, paces, running total, time, clock, landmark) beside the checks |
| Strip | The route unrolled: bearing needles, lamps, check points, halts, obstacles, skylines, hidden / seen stretches, enemy sight zones, profile, FUP and Obj |
| Cards | A pocket card per leg: dial, bearing, paces and cord, the landmark it ends on, the leg's time window |
| Trace | The route's real shape, north up and turning with the map, with the FUP, the rings and a scale bar |
| FUP | The marking layout axis-up: FUP tape, places, SL (on a linear feature if one lies square to the axis), lamps shaded to the rear, guides, axis tape, the column coming in, a gauge of the distance to the Obj; the marking stores and the FUP checks |
| Clock | The march against the clock (legs as slopes, halts and the FUP wait flat) over the night's light, with the programme from leaving the SP to H |

`nightMarch.style` sets the style it opens on. Copy as Text gives the whole chart (`nightMarch.chartText()`).

## Rules and figures

`MS/Data/NightMarchDoctrine.json`; every block carries **R** (rule from the roadmap) or **E** (proposal to correct):

- R: 120 paces = 100 m; march table by night (plains 3, desert 2.5, mountain ascent 1 km/h), halts 15 min after each
  2 h; FUP at least 1000–1200 m from the Obj in plains (tank FUP 2500–3000 m); enemy night sights 1000–1200 m,
  thermal 3000–4000 m; SL square to the axis, never behind an obstacle, no change of direction in the FUP.
- E: legs over 1000 m get check points every 650 m; 3° drift; 15 % spare on the march time; FUP sizes and places
  (Pl 100 × 60, Coy 200 × 120, Bn 450 × 300 m; two up, one or two back) and shake-out times (10 / 20 / 30 min);
  lights every 200 m in the open, at turns, the FUP entry, SL ends, rear corners and the axis tape end; 100 m axis
  tape; 100 m rolls of tape.

Bearings are grid until `nightMarch.gmaDeg` is set (east positive; magnetic = grid − GMA). H hour (`nightMarch.hHour`,
"HH:MM") turns the times into clock times and adds the night's light (sun and moon) to the Clock style.

## Terrain (optional)

With `nightMarch.useTerrain` on and the bundle there, the legs are the Platoon Guide's patrol route card (time by
ground and slope, the landmark each leg ends on, skylines, obstacles crossed) and the Movement Guide's route scan with
the Obj as the threat (villages passed, stretches hidden from / seen by the Obj); the SL looks for a road, track, rail,
bund, wall or power line square to the axis and the axis is checked for an obstacle within 300 m beyond the SL.
Off or missing: nothing is loaded, the chart is worked out from the geometry on open ground at the march table's
speed for `nightMarch.terrain`, and it says so.

## API

```ts
const nm = symbolEngine.nightMarch;            // null until features.nightMarch is on
nm.startDraw();
await nm.chartFor([[73.02, 33.53], [73.03, 33.542], [73.052, 33.56]], [73.06, 33.572]);
nm.openChart(true, 'fup');
nm.useGraphic(placedLine);
nm.chartText();
```

Pure engine: `NightMarchRead.ts` (`nightMarchChart`, `liveLeg`, `legAt`), checked by `node tools/nightmarch-test/run.mjs`
(52 checks). Map layer `ms-night-march`, draw layer `ms-night-march-draw`.
