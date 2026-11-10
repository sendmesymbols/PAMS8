# OCOKA lens test program

Tests the engine of the Ground Guide's OCOKA lens on the real terrain bundle: whether its answers are right, and how fast
it is. The program itself is not part of the library build; the engine it runs is the library's own file. It reads the
terrain bundle (`MS/Data/terrain-bundle`), the doctrine file (`MS/Data/OcokaDoctrine.json`) and the `Rng` ranges in
`MS/Data/Symbols.json`.

| File | What |
|---|---|
| `../../MS/Engines/GroundGuide/GroundGuideOcoka.ts` | **The engine, in the library** (pure, no imports): tile grid, sight as a chance, fields of fire, obstacle in front, ways out, going flood, highest ground, visibility grid, sun and moon. The Ground Guide's OCOKA lens runs this file; so does this program. |
| `ocoka-core.ts` | The test program's door to it: re-exports the engine and adds an async tile loader and the going table from rules.json. |
| `run.mjs` | Command line: 44 checks (synthetic cases with a known answer, the map products, light, nine real sites, cost, independent cross-check). Writes `last-run.txt` / `last-run.json`. |
| `crosscheck.py` | Independent line-of-sight check run by `run.mjs` (probes every sixth of a pixel, own tile reader). |
| `index.html` + `page.ts` | Interactive page: click to move the observer, drag the yellow handle to turn the threat direction, pick weapon, mover, month and time. |

```bash
node tools/ocoka-test/run.mjs            # add --quick for fewer timing repeats
node node_modules/vite/bin/vite.js --port 6547    # then open http://localhost:6547/tools/ocoka-test/index.html
```

(On this machine put Node on the PATH first, see the memory note; the page needs the Vite dev server because it reads
`/terrain-bundle`.)

## Revision of 2026-11-10 (the quality of the result)

The first version judged a point seen or hidden and scattered "blockers" over the ground by a hash. That gave a salt and
pepper picture and three numbers (bare DEM / middle / tallest) that were hard to act on. It now works like this:

- **Sight is a chance.** The share of the target that clears the terrain horizon (soft over the elevation's 1 m tolerance),
  times the chance that nothing mapped stands in the line. Nothing is random: the same point gives the same answer.
- **Real data for what stands on the ground.** Buildings come from the bundle's building layer: a line through buildings
  at density n, each w wide, meets one with chance 1 - exp(-n w L); their height class sets how high they block. Tall crops
  come from the month's crop mix (a field is about 130 m across). Trees, bunds, walls and orchards come from their class.
- **Three figures:** on the ground alone (upper bound), expected, sure (80 % or more).
- **Fields of fire on two tests**, the lower stands: the clear distance to the first dead or screened ground (two samples
  running, so one noisy cell does not end it) and the share of the weapon's range that is seen. Dead ground (terrain) is
  told apart from screened ground (crops, buildings, trees). Shares are weighted by area, not by sample count.
- **The target follows the weapon:** a standing man for direct fire, a vehicle (2.4 m) for anti-armour. Mortars, guns and
  air defence "need an observer" and get no fields-of-fire grade.
- **Ways out** are GO, SLOW-GO or stopped, with what stops them; a canal one pixel wide running diagonally no longer lets
  a ray slip between its cells.
- **Overlooked** also says from what share of the directions higher ground looks down on the point.

Readings after the revision (November, standing man, 5 km): open Punjab farmland sees about 790 m (about 260 m in August,
when 16 % of the crops stand tall); Lahore, Karachi and Quetta are very close country (the view ends within a block) though
the ground alone would show 18 to 35 %; the Margalla crest is open country with poor fields of fire (the slope below a
summit is dead ground); Cholistan is open, good for a rifle and marginal for a tank (dunes leave 77 % dead ground in 2 km).

## Map products (2026-11-11)

The engine also makes what the lens draws on the map, and section A2 of `run.mjs` checks each on a made-up grid with a
known answer:

- `sightRuns`: a fan's rays cut into runs of seen, dead (terrain) and screened (blockers) ground, for the red and amber
  patches. A ridge across the fan gives dead ground from the ridge outward and nothing before it.
- `sightTo` now says where a line of sight is lost (`blockAtM`).
- `findAvenue`: the cheapest way for the mode from the threat to the position (A* on the going grid; SLOW-GO costs three
  times GO; width = twice the distance to NO-GO ground, from a distance transform; ground narrower than the frontage
  costs more and is reported as a chokepoint). A canal with one gap sends the avenue through the gap and names it a
  chokepoint for a 300 m frontage, while a 60 m column fits; a canal with no gap gives no avenue; a canal one pixel wide
  running diagonally is not cut at the corner; a small block of SLOW-GO ground is gone round.
- `avenueMask` / `avenueOverlap`: for a second avenue that is really a different way (with two gaps it takes the other).
- `betterPosition`: behind a rise the engine proposes the rise in front (poor becomes good); on a flat plain it proposes
  nothing.

Cost in Node: fan runs 0.3 ms, an avenue 2 to 3 ms, a better position 1 to 3 ms.

## What the first run found (2026-11-10, before the revision)

- **Cost.** A 90 degree wedge to 2 km (the mouse-move case) takes 0.16-0.21 ms in Node and 0.3-0.5 ms in the browser; the
  all-round view to 5 km 5-6 ms (6-8 ms in the browser with the picture trace); to 10 km 16-20 ms; the going flood 6-7 ms.
  Cover, month visibility and light together cost nothing measurable. A half-pixel step doubles every figure.
- **Accuracy.** The engine matches closed-form cases (earth curvature within 7 m, a 20 m ridge ends the view at the ridge, A sees
  B exactly when B sees A on 600 of 600 random pairs) and agrees with an independent implementation on 99.3 % of 2,640 real
  samples. Every disagreement is the same kind: the engine calls a sample seen that sits just behind a crest narrower than one
  pixel (0.7 %); a half-pixel step only brings it to 0.4 %. So the card says "may be seen".
- **The bare elevation is not enough.** A 30 m DSM smooths towns and cannot show crops, bunds or walls. Lahore centre: 37 % of the
  ground seen on the bare DEM, 1 % with middle blocker heights, 0 % with the tallest; Quetta 50 % / 2 % / 1 %. The lens therefore
  reports a range (bare DEM = upper bound, middle = central case, tallest = lower bound). Blockers must be patchy: towns by
  building density, crops by the month's crop mix in patches about 130 m across; applying a height to every cell blanks the world.
- **Use the right metric for each question.** Country class (open / close / very close) comes from how far the view REACHES;
  fields of fire from the distance to the first dead ground and the share of dead ground inside the weapon's range. On a summit
  the first dead ground is a few tens of metres down the slope (the military crest is below the top) while the view reaches
  kilometres: the summit is open country with poor fields of fire.
- **Light and weather.** The sun is within 0.2 degrees of the closed-form noon altitude at both solstices and the equinox; the
  November 2026 moon phases come out at 0.2 % (new, 9 Nov), 51 % (first quarter, 17 Nov) and 99.8 % (full, 24 Nov).

## Not covered yet

The lens itself is now in the Ground Guide (see `15-ground-guide.md`, OCOKA lens): the real tile cache, ITG candidates in
view, the cards and tabs, and the map products. Still not covered: a check against known ground (positions whose fields of
fire someone has walked), and a worker that holds its own elevation tiles. Every surface now follows the lens (cards,
Detail, brief text, Gr Scope rail, H chip, map overlay).
