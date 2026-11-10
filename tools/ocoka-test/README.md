# OCOKA lens test program

A small program to find out whether the OCOKA lens works well enough, and how fast, before any lens UI is built. It is not
part of the library build and does not touch `MS/Engines/`. It reads the terrain bundle (`MS/Data/terrain-bundle`), the doctrine
file (`MS/Data/OcokaDoctrine.json`) and the `Rng` ranges in `MS/Data/Symbols.json`.

| File | What |
|---|---|
| `ocoka-core.ts` | The engine, pure functions, no imports: tile mosaic, ray analysis (sight, dead ground, reach, obstacles, overlook), go-reach flood, cover, visibility grid, sun and moon. Runs in Node 24 and in the browser. |
| `run.mjs` | Command line: 37 checks (synthetic geometry with known answers, light, real sites, cost, independent cross-check). Writes `last-run.txt` / `last-run.json`. |
| `crosscheck.py` | Independent line-of-sight check run by `run.mjs` (probes every sixth of a pixel, own tile reader). |
| `index.html` + `page.ts` | Interactive page: click to move the observer, drag the yellow handle to turn the threat direction, pick weapon, mover, blockers, month and time. |

```bash
node tools/ocoka-test/run.mjs            # add --quick for fewer timing repeats
node node_modules/vite/bin/vite.js --port 6547    # then open http://localhost:6547/tools/ocoka-test/index.html
```

(On this machine put Node on the PATH first, see the memory note; the page needs the Vite dev server because it reads
`/terrain-bundle`.)

## What it found (2026-11-10)

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

Important Tactical Ground candidates and chokepoints (features tiles), corridor width against the echelon's frontage, a worker
that holds its own elevation tiles, the real tile cache, 3D, and everything about the UI.
