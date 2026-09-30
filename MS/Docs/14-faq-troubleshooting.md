# FAQ and Troubleshooting

Answers here were collected while verifying the other chapters against the source. Follow the links for detail.

## Setup

**Symbols do not draw and nothing is logged.**
The shipped build strips `console.log`/`debug`/`info` but keeps `console.warn` and `console.error`. Check the browser console for those. Also confirm `window.MS` exists (milsymbol script tag) and that `MS/Data`, `MS/ThirdParty` and `MS/Styles` are served next to the `.min.js` files. See [01](01-getting-started.md).

**`window.MS is undefined`.**
`milsymbol.js` is a script-tag library, not an ES module. Load it before creating `SymbolEngine`. Do not replace it with the npm `milsymbol` package: the bundled file is a customised fork with a different API.

**Where do I get `window.symbolEngine`?**
The engine does not set it itself. Several library modules read `window.symbolEngine`, so set it right after construction. Sub-engines such as the road-network adapter rely on it. See [02](02-symbol-engine-api.md).

**Import errors or instance-check failures from `@arcgis/core`.**
`@arcgis/core` is external. The host must supply one copy at the version the library was built against (5.0.19). A second copy breaks instance checks.

## Events and lifecycle

**There is no public `on()` on `SymbolEngine`.**
The public `on()` is commented out, so `emit()` and the `symDraw*` events have no external subscribers. Listen for the `CustomEvent`s the library dispatches instead. See [03](03-drawing-and-events.md).

**My listeners stop firing after switching 2D/3D.**
`symbolEngine.editEngine` is replaced on every view switch. Re-register listeners after `onViewChanged`. See [05](05-editing-morphix.md).

**`destroy()` leaves things running.**
`SymbolEngine.destroy()` does not tear down the analysis, declutter, briefing, collab, road-network, trafficability and deployment engines. Destroy those yourself when you remove the engine. See [02](02-symbol-engine-api.md) and [11](11-analysis-engines.md).

**Draw events from another map on the same page.**
Draw events are scoped to the emitting view's container. Filter by container when several views share a page. See [03](03-drawing-and-events.md).

## Editing and clipboard

**How do I change a symbol from code?**
`getSymbolState(graphic)`, then `updateSymbol(graphic, patch)`. Point/Line/Area symbols patch `amplifier` and `drawEssentials`; FPoint symbols patch `options`. See [05](05-editing-morphix.md).

**Can I rebind shortcuts, cut, or group?**
No. Shortcuts are only enabled or disabled through `features.shortcuts`, read once at construction. Ctrl+X cut and group/ungroup do not exist. See [06](06-selection-clipboard-undo-templates.md).

**`copySymbol` pastes on the next click.**
It arms paste mode immediately. The clipboard flag is `features.clipboard`; the clone-drag path checks `features.copyPaste`, which is not in `Settings.json`.

**`scalePointSymbol` does not resize the marker.**
It only sets `SIZE` and emits an event nothing listens to. Use `updateSymbol` to change size visibly.

**`TemplateEngine` is not available on the engine.**
It is not constructed by `SymbolEngine`. `MS/Data/Templates.json` is a form-field catalog, not saved templates.

## Import and export

**Save and load.**
`savePlanToFile()` always downloads a file; there is no data-only export. `loadPlanFromFile()` does not restore Pin-to-Screen, whereas `loadPlanSymbolsFromData()` does. `saveSymbolToJSON` exists only on `serializationEngine`. See [07](07-import-export.md).

**PowerPoint export fails.**
The pptxgen bundle loads from the relative URL `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js`. That path is not configurable, so the host must serve it there.

**Collaboration does not connect.**
The relay server is build-time tooling in `tools/collabRelay.js` and is not shipped in `dist`. Run it separately and set `collab.relayUrl`. See [12](12-briefing-collab-stylus.md).

## Geography and analysis

**Distances are off in Web Mercator.**
Live views report wkid 102100. Test with `GeoTools.supportsGeodesic()` / `GeoTools.isWebMercatorSR()` and convert meters with `GeoTools.metersToMapUnits()`. See [04](04-support-classes.md).

**Road network or trafficability results look like estimates.**
Both need an external service and fall back to straight-line estimates offline. Deployment plans load from the hard-coded `/MS/Data/Deployments/Deployemets.json` (spelling as in source). See [11](11-analysis-engines.md).

**`DeploymentBuilder` is not on `SymbolEngine`.**
Reach it through `window.deploymentBuilderEngine` or its ready event.

## Known source quirks

These are documented, not fixed:

- `DrawEssentials.CTRL_PTS` and `BASE_LN_PTS` are commented out of the class yet used, so `hasControlPoints()` and `hasBaseLinePoints()` throw until assigned.
- `Support/SIDC.ts` assumes 20-character codes while the rest of the library uses 30-digit codes.
- `registerSymbol()` re-dispatches `onDrawEnd` without geometry, producing a warning.
- `IOEngine.ts` is an empty file.
- The analysis registry has 16 keys although source comments say 14.

## Reporting a problem

Include the library build date, the `@arcgis/core` version, 2D or 3D, the symbol key (see [13](13-symbol-catalog.md)), the browser console output including warnings, and the steps to reproduce.
