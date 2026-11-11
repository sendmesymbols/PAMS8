# Rules for Claude in PAMS8

## Terrain bundle is optional

The terrain bundle (`MS/Data/terrain-bundle/`, served at `/terrain-bundle`) is extra data, not a requirement.
Some installs will not have it, and sometimes the user will not want to use it.

- Anything that reads the bundle, especially on mouse move or while drawing, must be switched by
  `MS/Data/Settings.json` (`features.groundGuide`, the `groundGuide.*` options, `roadNetwork.bundleUrl` / `roadsSource`,
  and any new feature's own switch). Add a switch for every new feature that reads the bundle.
- When a switch is off, the feature must not load anything or look for the bundle: no fetch, no worker, no
  manifest request, no tile request, no retries.
- When the switch is on but the bundle is missing or a file fails to load, degrade quietly: one log line
  in the Engine Log at most, no dialogs, no console noise on every mouse move, no exceptions thrown into the draw path.
- Drawing a symbol must work exactly as it does without the bundle. Features that need the data hide or grey
  out their controls and say why ("needs terrain data") instead of failing.
- Turning a switch off at run time must tear the feature down (layers, workers, listeners, caches).
- Products that run on demand (right-click, task planner) follow the same rule: if the bundle is off or missing,
  they are left out of the menu or marked unavailable.
