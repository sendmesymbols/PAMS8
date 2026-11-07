# Product

## Register

product

## Users

Military planners placing MIL-STD-2525D symbols on a map (2D and 3D) to build tactical plans: unit positions,
graphics, routes. They read the Ground Guide while drawing: a cursor card that follows the mouse and a wide
Ground Detail (D) docked under the map with one tab per GROTBC letter. They use it in a dim command post on a
desktop monitor and on a field laptop in mixed or bright light, so text has to be a little larger than a desktop
default and hold its contrast in both.

## Product Purpose

PAMS8 is a library that several host applications embed. The Ground Guide tells the planner, while the symbol is
still under the cursor, whether the ground suits that unit (GO / SLOW-GO / NO-GO), why, and where better ground
lies. The Ground Detail lays out everything read about the ground (Ground, Roads and Rail, Obstacles,
Trafficability, Built-Up, Cover) so a planner can brief from it. Success: the verdict is read in under a second
without stopping the mouse, and each Detail tab answers its letter at the top before the pictures and rows.

## Brand Personality

Precise, calm, trustworthy. Military vocabulary set by the user (Suitable Position, SLOW-GO, NO-GO, Inter Gap
Rule, Route Classification); never the data source name "NCGDB" in UI text. Advice never overstates safety:
when the data cannot tell, it says so and points to better ground with "check on the ground".

## Anti-references

- Consumer-app decoration: glass, gradients, glow, playful motion.
- Walls of equal-weight tiles with no entry point.
- Tiny tracked uppercase captions as the main way to label things.
- Colour as the only carrier of a verdict.

## Design Principles

1. The answer first: verdict, then reason, then evidence.
2. Same data, clearer order: restructure before adding.
3. Readable at arm's length in bright light and quiet in a dark room.
4. Keep the pictures (dials, roses, maps, gauges); they turn with the map.
5. Never overstate: uncertainty is shown, not hidden.

## Accessibility & Inclusion

Keyboard keys for every tab and action (D, G R O T B C, K, Esc, S, P); a short screen-reader sentence for the
cursor card; reduced motion respected. Verdicts carry a word and an icon besides colour. No further needs set
(user, 7 Nov 2026).
