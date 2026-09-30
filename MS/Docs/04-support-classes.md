# 04 - Support Classes and Managers

Reference for the helper classes in `MS/Support`, `MS/SIDC`, `MS/Managers` and `MS/Cache` that a host application constructs, reads or listens to. Everything here is verified against the source; where the source is ambiguous this is stated.

Related documents: [README](README.md) | [01 Getting started](01-getting-started.md) | [02 SymbolEngine API](02-symbol-engine-api.md) | [03 Drawing and events](03-drawing-and-events.md) | [05 Editing and Morphix](05-editing-morphix.md) | [07 Import/Export](07-import-export.md) | [08 Settings](08-settings.md) | [13 Symbol catalog](13-symbol-catalog.md)

| Class / module | Import path (source) | Purpose |
| --- | --- | --- |
| [Amplifier](#amplifier) | `Support/Amplifier` | Text and identification fields attached to a symbol |
| [DrawEssentials](#drawessentials) | `Support/DrawEssentials` | Geometry, size and style parameters for a draw |
| [SIDC (Support)](#sidc-supportsidcts) | `Support/SIDC` | Legacy 20-character SIDC helper with colours and ArcGIS symbol generation |
| [SIDC (parser)](#sidc-parser-sidcsidcts) | `SIDC/SIDC` | 30-digit SIDC parser (`parseSIDC`, `enrichSymbolOptions`) |
| [GeoTools](#geotools) | `Support/GeoTools` | Geometry, bearing, distance and geodesic helpers |
| [Utils](#utils) | `Support/utils` | HTML escaping, SVG data URLs, small geometry helpers |
| [Echelons](#echelons) | `Support/Echelons` | Echelon marker geometry generators |
| [EngineLogger](#enginelogger) | `Support/EngineLogger` | `engine-log` event emitter |
| [SettingsBus](#settingsbus) | `Support/SettingsBus` | Settings get/set/subscribe (details in 08) |
| [GraphicsLayerManager](#graphicslayermanager) | `Managers/GraphicsLayerManager` | Per-view layer owner; `LAYER_NAMES`, `SYMBOL_LAYER_IDS` |
| [ThemeManager](#thememanager) | `Managers/ThemeManager` | UI theme (CSS variables) |
| [ContextMenuManager](#contextmenumanager) | `Managers/ContextMenuManager` | Right-click menu and its extension points |
| [LRUCache](#lrucache) | `Cache/LRUCache` | Small generic LRU map |

In the shipped build each import path above maps to `dist/MS/<path>.min.js` with a matching `.d.ts`.

---

## Amplifier

`Support/Amplifier.ts`. Default and named export. A plain data holder for the text fields drawn around a symbol and for identification metadata. Every string field defaults to `""`. All field names are upper case with underscores except where noted.

### new Amplifier(sidc?, options?): Amplifier

| name | type | default | meaning |
| --- | --- | --- | --- |
| `sidc` | `string` | `undefined` | Accepted but ignored by the constructor body. Set `amplifier.SIDC` instead |
| `options` | `Partial<Amplifier>` | `undefined` | Copied onto the instance with `Object.assign` |

```ts
const amp = new Amplifier(undefined, { SIDC: '130310001812110000000000000000', UNIQUE_DESIG: 'B/1-7' });
```

### Fields

| Field | Type | Default | Meaning | Used by |
| --- | --- | --- | --- | --- |
| `SIDC` | `string` | `""` | Symbol identification code of the symbol. The 30-digit format is the one the parser and catalog use (see [SIDC](#sidc-parser-sidcsidcts)) | All symbol types. `SymbolEngine.initialize` builds `new SIDC(amplifier.SIDC)` from it; Morphix and templates copy it |
| `UNIQUE_DESIG` | `string` | `""` | Unique designation text (for example unit name) | Label drawn by `AnnotationEngine` for Point, Line and Area symbols |
| `HIGHER_FORM` | `string` | `""` | Higher formation | In `AnnotationEngine` it is drawn only when `drawEssentials.SYM_NAME === "Boundary"` |
| `STAFF_COM` | `string` | `""` | Staff comments | Listed by Morphix among the fields "AnnotationEngine actually draws"; not found in the `AnnotationEngine` lines inspected, so the draw behaviour is unconfirmed |
| `ADDL_INFO` | `string` | `""` | Additional information | Same status as `STAFF_COM` |
| `TARGET_DESIGNATOR` | `string` | `""` | Target designator | Same status as `STAFF_COM`; also copied by `SerializationEngine` |
| `DTG` | `string` | `""` | Date-time group, `DDHHMMSSZMONYYYY`, or `O/O` for on order | Drawn above the symbol by `AnnotationEngine` |
| `EDTG` | `string` | `""` | End (extended) date-time group | Drawn below the symbol by `AnnotationEngine` |
| `TYPE` | `string` | `""` | Free-text type | Stored and exported; Morphix marks it "never drawn on the map" |
| `QUANTITY` | `string` | `""` | Quantity | Stored; for UEI symbols mapped to the milsymbol option `quantity` (Morphix `FLAT_TO_OPT`) |
| `COUNTRY` | `string` | `""` | Country code | Stored; not drawn |
| `LOC` | `string` | `""` | Location text | Stored; not drawn |
| `ALTITUDE_DEPTH` | `string` | `""` | Altitude or depth text | Stored; not drawn |
| `DISTANCE` | `string` | `""` | Distance text | Stored; not drawn |
| `AZIMUTH` | `string` | `""` | Azimuth text. Morphix edits it as a number 0 to 360 | Stored; not drawn |
| `ECHELON` | `string` | `""` | Echelon code. The two-digit echelon is `sidc.substring(8, 10)` (see `getEchelon`) | Not traced; the harness sets `DrawEssentials.ECHELON` from the SIDC instead |
| `SYMBOL_ICON` | `string` | `""` | Icon identifier | No consumer found in the reviewed engines. Purpose unconfirmed |
| `HOSTILE` | `string` | `""` | Hostile indicator | No consumer found. Purpose unconfirmed |
| `DIR_OF_MOV_INDICATOR` | `string` | `""` | Direction-of-movement indicator. Source comment: "ONLY FOR PTS" | Point symbols (per comment) |
| `OFFSET_LOC_INDICATOR` | `string` | `""` | Offset location indicator. Source comment: "ONLY FOR PTS" | Point symbols (per comment) |
| `SIZE` | `number \| undefined` | `undefined` | Size override. The reset value is `undefined` | No consumer confirmed; `DrawEssentials.SIZE` is the drawing size |

Two fields are read in the code but are not declared on the class: `DTGTO` is copied in `SerializationEngine` (`amplifier.DTGTO`). It is set only if present. Treat it as an undeclared extension.

Force (UEI) symbols use camelCase milsymbol option names instead of these flat keys (`uniqueDesignation`, `higherFormation`, `staffComments`, `additionalInformation`, `quantity`, `type`, `dtg`, `location`, `altitudeDepth`). Morphix maps between the two forms. See [05 Editing and Morphix](05-editing-morphix.md).

### Methods

| Method | Description |
| --- | --- |
| `reset(): void` | Sets every string field to `""`, `SIZE` to `undefined` |
| `clone(): Amplifier` | New instance with all declared fields copied. `DTGTO` is not copied |
| `hasData(): boolean` | True if any field is non-empty (or `SIZE` is truthy) |
| `getNonEmptyProperties(): Record<string, string>` | Own string properties whose trimmed value is non-empty |
| `setProperties(properties: Partial<Amplifier>): void` | `Object.assign(this, properties)` |
| `getEchelon(sidc: string): string` | Returns `sidc.substring(8, 10)`. Throws the string `"SIDC not found"` when `sidc` is `undefined` |
| `toString(): string` | `"KEY: value, KEY: value"` over the non-empty properties. This string is what the tactical symbol base stores in `DrawEssentials.AMPLIFIER` |

---

## DrawEssentials

`Support/DrawEssentials.ts`. Default and named export. Carries the geometry and style parameters for one draw. Each symbol class reads the parameters it needs and ignores the rest.

### new DrawEssentials(options?): DrawEssentials

`options: Partial<DrawEssentials>` is applied with `Object.assign`.

```ts
const de = new DrawEssentials({ SIZE: 60, DRAW_TYPE: 1 });
```

### Fields

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `BK_LN_DIST_RATIO` | `number?` | `5` | Base-line distance ratio (line/area symbols with a base line) |
| `BK_LN_ANGL_RATIO` | `number?` | `5` | Base-line angle ratio |
| `FRNT_LN_ANGL_RATIO` | `number?` | `0.8` | Front-line angle ratio |
| `FRNT_LN_DIST_RATIO` | `number?` | `1.5` | Front-line distance ratio |
| `FLAP_DIST_RATIO` | `number?` | `3` | Flap distance ratio |
| `FLAP_ANGLE` | `number?` | `undefined` | Flap angle |
| `SCOPE` | `string` | `""` | Typed as string. `____TacticalSymbolBase` assigns the symbol instance itself through a cast (`(de as any).SCOPE = this`) |
| `SID` | `string` | `""` | Symbol id key from `Symbols.json` |
| `SYM_NAME` | `string` | `""` | Symbol display name (for example `"Boundary"`) |
| `SYM_GEO_TYPE` | `string` | `""` | One of `"Point"`, `"FPoint"`, `"Polyline"`, `"Polygon"` per `Symbols.json` |
| `DRAW_TYPE` | `number?` | `undefined` | Variant of the symbol's placement/shape. The harness uses `1` when the symbol offers no choice |
| `AMPLIFIER` | `string` | `""` | Amplifier text as produced by `Amplifier.toString()` |
| `IS_LINE` | `boolean` | `false` | Line versus area flag |
| `GEOM` | `Point \| Polyline \| Polygon \| null` | `null` | Geometry for passive (programmatic) placement |
| `IS_OBS` | `number` | `0` | Obstacle flag (`1` selects the obstacle colour in `SIDC.getMarker`, passed as a string there) |
| `SIZE` | `number` | `0` | Symbol size |
| `ARROWHEAD_RATIO` | `number` | `0` | Arrowhead ratio |
| `ECHELON` | `string` | `""` | Echelon code. Harness: `drawEssentials.ECHELON = amplifier.getEchelon(sidc)` |
| `OFFSET` | `string` | `"0"` | Offset |
| `ISFHAND` | `number?` | `undefined` | Freehand flag |
| `opacity` | `number?` | `undefined` | Opacity |
| `SIDC` | `string?` | `undefined` | SIDC (also carried in the amplifier) |
| `LINE_COLOR` | `number[]?` | `undefined` | Freehand override: line colour as an RGB(A) array |
| `FILL` | `boolean?` | `undefined` | Freehand override: fill on/off |
| `FILL_COLOR` | `number[]?` | `undefined` | Freehand override: fill colour |
| `FILL_OPACITY` | `number?` | `undefined` | Freehand override: fill opacity |
| `labelOptions` | object | see below | Label styling |
| `extraSettings` | object | see below | Line width, size, text size and opacity |
| `uniqueDesignation` | `string?` | `undefined` | Designation (used by the harness dock: `drawEssentials.uniqueDesignation = ...`) |
| `infoFields` | `boolean?` | `undefined` | Show info fields (harness sets `true`) |
| `cim` | object? | `undefined` | Carto Information Model fill options: `style?`, `size?`, `color?`, `gridType?: "Fixed" \| "Random"`, `randomness?`, `stepX?`, `stepY?`, `shiftOddRows?` |

`labelOptions` default:

```ts
{ haloColor: [255, 0, 0], haloColorSize: 5, color: [0, 255, 0], textSize: 20,
  bold: 1, italic: 0, uLine: 0, oLine: 0, tLine: 0 }
```

`extraSettings` default: `{ lineWidth: 3, size: 20, textSize: 12, opacity: 1 }`.

### Undeclared fields (source is ambiguous)

`CTRL_PTS` (`Point[]`) and `BASE_LN_PTS` (`{ startPt?, midPt?, endPt? }`) are commented out of the class body, yet `reset()`, `clone()`, `hasControlPoints()` and `hasBaseLinePoints()` still reference them, and the tactical symbol base assigns `CTRL_PTS` and `DRAW_TYPE` through `as any` casts. At runtime they are ordinary properties on the instance; they are not typed in the class. Treat them as: `CTRL_PTS` = the clicked control points, `BASE_LN_PTS` = base-line reference points. Because the methods dereference `this.CTRL_PTS.length` and `this.BASE_LN_PTS.startPt`, calling `hasControlPoints()` or `hasBaseLinePoints()` before those are assigned throws. Assign them first or avoid these two methods.

Other names used only in commented-out harness code (`HEAD_RATIO`, `TAIL_FACTOR`, `TEETH_SIZE`, `TEETH_GAP`, `FACE_GAP`, `WIDTH`, `HEIGHT`) are set by the harness via `readSymbolParamsInto()` from each symbol's `Parameters` in `Symbols.json`, not declared on this class. The set differs per symbol; see [13 Symbol catalog](13-symbol-catalog.md).

### Methods

| Method | Description |
| --- | --- |
| `reset(): void` | Restores defaults. Caveat: `reset()` sets `FRNT_LN_DIST_RATIO` and `FLAP_DIST_RATIO` to `undefined` (the constructor defaults are `1.5` and `3`), and resets `uniqueDesignation` to `""` and `infoFields` to `false` |
| `clone(): DrawEssentials` | Copies fields. `labelOptions` and `extraSettings` are copied by reference, not deep-cloned. `LINE_COLOR`, `FILL_COLOR`, `cim` are copied. `OFFSET` is not copied, so the clone gets `"0"` |
| `hasGeometry(): boolean` | `GEOM` is neither `null` nor `undefined` |
| `hasControlPoints(): boolean` | `CTRL_PTS.length > 0` (see caveat above) |
| `hasBaseLinePoints(): boolean` | Any of `BASE_LN_PTS.startPt/midPt/endPt` defined (see caveat above) |

---

## SIDC (Support/SIDC.ts)

`Support/SIDC.ts`. Default and named export. Wraps a SIDC string and produces ArcGIS symbols coloured by standard identity.

The class is written for a 20-character SIDC: `validateSIDC` checks `length === 20`, `getIdentity()` reads characters 2 to 3, `getStatus()` reads index 6, and `getSID()` reads 10 to 15. The rest of the library and the catalog use 30-digit codes (see the parser below). The two layouts differ, so use this class only where existing code does, and check the results for your codes. The offsets have not been reconciled with the 30-digit layout in the source.

### new SIDC(sidc: string): SIDC

### Members

| Member | Signature | Description |
| --- | --- | --- |
| `symbolThickness` | `number = 0` | Public field |
| `standardIdentities` | `{ Style: string; Color: Color }[][]` | 26 entries indexed by identity number (00 Pending to 25 Dark Violet). Each inner array has one element with `Style` (`"solid"` or `"dash"`) and an ArcGIS `Color` |
| `validateSIDC(sidc)` | `(string): boolean` | True when `sidc.length === 20` |
| `getSID()` | `(): string` | `substring(10, 16)` |
| `getIdentity()` | `(): string` | `substring(2, 4)` |
| `getIdentityIndex()` | `(): number` | `Number(getIdentity())` |
| `getStatus()` | `(): string` | Character at index 6 |
| `isPending()` | `(): boolean` | `getStatus() === '1'` |
| `getSIDC()` | `(): string` | The stored string |
| `setSIDC(sidc)` | `(string): void` | Replace the stored string |
| `getIdentityColor()` | `(): Color` | `standardIdentities[identityIndex][0].Color`. Throws if the index is out of range |
| `getHeight()` / `getWidth()` | `(): number` | `Settings.size` or `25` |
| `getMarker(symGeometricType, isObs?, fill?)` | see below | Builds an ArcGIS symbol |

### getMarker(symGeometricType, isObs?, fill?): SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol

| name | type | default | meaning |
| --- | --- | --- | --- |
| `symGeometricType` | `string` | required | `"Area"` or `"Line"` returns a `SimpleLineSymbol`; `"Point"` returns a `SimpleMarkerSymbol`; anything else returns a default `SimpleMarkerSymbol` |
| `isObs` | `string` | `undefined` | `"1"` uses the neutral obstacle colour (Area/Line only) |
| `fill` | `string` | `undefined` | `"1"` fills the marker with the identity colour (Point only) |

The line style is `dash` when `getStatus() === '1'`, otherwise the style of the identity entry. Widths and colours come from `Settings.json` (`lineWidth`, `PtlineWidth`, `size`, `standardIdentities`). Note the geometry type strings here (`Area`, `Line`, `Point`) differ from `Symbols.json` `SymGeoType` (`Polyline`, `Polygon`, ...).

---

## SIDC parser (SIDC/SIDC.ts)

`SIDC/SIDC.ts`. Named exports only (`parseSIDC`, `enrichSymbolOptions` and the interfaces). Parses a 30-digit MIL-STD-2525D SIDC into labelled sets. It imports label dictionaries from `ThirdParty/MilSymbols/UEITypes`.

### Format used by the parser

30 numeric digits. Set A is the first 20 digits, Set B and Set C follow. The parser has two layouts, selected by the symbol set (digits 2 to 3):

| Field | Symbol set `03` or `10` (offsets) | All other symbol sets (offsets) |
| --- | --- | --- |
| `version` | 0-1 | 0-1 |
| `standardIdentity` | 1-2 | 1-2 |
| `symbolSet` | 2-4 | 2-4 |
| `status` | 4-5 | 4-5 |
| `hqTaskForceDummy` | 5-6 | 5-6 |
| `echelonMobility` | 10-12 | 6-8 |
| `setB.entityType` | 12-14 | 8-10 |
| `setB.entitySubType` | 14-16 | 12-14 |
| `setB.modifier1` | 16-18 | 14-16 |
| `setB.modifier2` | 18-20 | 16-18 |
| `setB.countryCode` | 20-22 | 18-20 |
| `setC.symbologyOriginatorId` | 22-24 | 20-22 |
| `setC.originatorSymbolSet` | 24-26 | 22-24 |
| `setC.originatorExtension` | 26-30 | 24-30 |

Offsets are half-open string slices as coded (`slice(start, end)`). The two layouts, and in particular the non-`03/10` one, do not follow the standard field positions and should be treated as implementation-specific. Verify any value you rely on against the returned fields.

`setC` is present only when digits 20 to 29 are not all zero.

### parseSIDC(sidc: string): ParsedSIDC

Throws `Error("Invalid SIDC: must be exactly 30 numeric digits.")` when `sidc` does not match `/^\d{30}$/`. May also throw `SIDC too short ...` from an internal slice check.

```ts
interface ParsedSIDC {
  raw: string;
  setA: SIDCSetA;   // version, standardIdentity, symbolSet, status, hqTaskForceDummy,
                    // echelonMobility, entity, plus *Label strings
  setB: SIDCSetB;   // entityType, entitySubType, modifier1, modifier2, countryCode
  setC?: SIDCSetC;  // symbologyOriginatorId, originatorSymbolSet, originatorExtension
}
```

Label fields (`standardIdentityLabel`, `symbolSetLabel`, `statusLabel`, `hqTaskForceDummyLabel`, `echelonMobilityLabel`) fall back to `"Unknown"`. The function logs through `console.log`, which the production build strips.

### enrichSymbolOptions(options: SymbolOptions): SymbolOptions & { parsedSIDC?, label?, text? }

Parses `options.sidc` and returns a copy of `options` plus `parsedSIDC`, `label` (`"<identity label> <symbol set label>"`) and `text` (echelon label). On any error it logs a warning and returns `options` unchanged. It never throws.

```ts
import { parseSIDC } from './MS/SIDC/SIDC.min.js';
const parsed = parseSIDC('130310001812110000000000000000');
parsed.setA.standardIdentityLabel;
```

---

## GeoTools

`Support/GeoTools.ts`. Default and named export `GeoTools`, a class of static members. Also exports the type `PtLike = { x: number; y: number; spatialReference?: SpatialReference }`.

Only the members that are useful to a host are listed. The class also contains a large group of legacy geometry builders used by the symbol classes (`_2PtLen`, `_vertexAngle`, `_ptCollectionLen`, `_fracture*`, `CreateArrowHeadPathEx`, `ArrowFlanksLen`, `circleFromThreeScreenPoints`, `twoPtsAngle`, `getCenteroid`, `createHalfCircle`, `dashedLine`, `dashes`, `getDashPts`, `translateGeometry`, `translatePts`, `movePt`, and the one-letter aliases `B`, `k`, `R`, `P`, `S`, `D`, `A`, `v`, `_`). Those are internal building blocks with unstable semantics. Do not depend on them from host code. The one-letter aliases exist because minified bundles call them; property mangling is disabled so they are stable but undocumented.

### Geodesic correctness and the wkid 102100 caveat

Live ArcGIS views usually report Web Mercator as `wkid: 102100` with `latestWkid: 3857`. Testing `wkid === 3857` alone is wrong and silently falls back to planar math. Use `GeoTools.supportsGeodesic()` and `GeoTools.isWebMercatorSR()`, which accept 3857, 102100, 102113 and 3785. Web Mercator map units are stretched by `1/cos(latitude)`, so treating map units as ground meters is wrong by about 15 to 18 percent at 30 to 35 degrees north. Convert with `metersToMapUnits` and build metric shapes with `geodesicCircle` and `geodesicSector`, so they agree with the geodesic measurement engine.

### supportsGeodesic(sr): boolean

True when geodesic operators support the spatial reference: WGS84 (4326) or any Web Mercator wkid (3857, 102100, 102113, 3785), or when the object has `isWGS84 === true` or `isWebMercator === true`. Uses `wkid ?? latestWkid`. Returns `false` for `null` or `undefined`.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `sr` | `SpatialReference \| { wkid?, latestWkid?, isWGS84?, isWebMercator? } \| null \| undefined` | required | Spatial reference to test |

### isWebMercatorSR(sr): boolean

True for any Web Mercator variant (3857, 102100, 102113, 3785) or `isWebMercator === true`. Accepts the same shapes as above (without `isWGS84`).

### latitudeOf(at: Point): number

Latitude in degrees for a WGS84 or Web Mercator point. For any other spatial reference it returns `at.y` unchanged.

### metersToMapUnits(meters: number, at: Point): number

Ground meters to map units at `at`.

- Web Mercator: `meters / cos(latitude)`.
- WGS84: `meters / 111320` (an approximation; the north-south true value is about 110574).
- Any other spatial reference: returned unchanged (assumed metre based).

### mapUnitsToMeters(mapUnits: number, at: Point): number

Inverse of `metersToMapUnits` with the same branches.

### geodesicCircle(center: Point, radiusM: number): Polygon | null

Ground-true circle on the ellipsoid using `geometryEngine.geodesicBuffer(center, radiusM, "meters")`. Requires a geodesic-capable spatial reference (see `supportsGeodesic`). Returns the first buffer polygon, or `null` if none is produced.

### geodesicSector(center, radiusM, startAzDeg, endAzDeg, stepDeg?): Polygon

Ground-true pie slice.

| name | type | default | meaning |
| --- | --- | --- | --- |
| `center` | `Point` | required | WGS84 or Web Mercator |
| `radiusM` | `number` | required | Radius in meters |
| `startAzDeg` | `number` | required | Start azimuth, degrees clockwise from true north |
| `endAzDeg` | `number` | required | End azimuth. The sweep is clockwise from start to end. Equal azimuths give a full circle |
| `stepDeg` | `number` | `2` | Angular step (clamped to at least 0.1); at least 2 steps are generated |

Returns a polygon in the spatial reference of `center` (WGS84 or Web Mercator). A full circle has no centre vertex; a partial sector starts at the centre. Implemented with `geodesicUtils.pointFromDistance`, which is synchronous but marked deprecated by the SDK in favour of `geodeticUtilsOperator`.

```ts
const fan = GeoTools.geodesicSector(view.center, 5000, 30, 90);
const ring = GeoTools.geodesicCircle(view.center, 2500);
const mapUnits = GeoTools.metersToMapUnits(100, view.center);
```

### Distance, bearing and angle helpers

| Method | Signature | Description |
| --- | --- | --- |
| `distance` | `(from: Point, to: Point, unit: string): number` | Great-circle (haversine) distance. Projected inputs are converted to geographic first. `unit` must be a key of `GeoTools.factors`, otherwise it throws `"<unit> units is invalid"` |
| `bearing` | `(start: Point, end: Point, final?: boolean): number` | Initial bearing in degrees, normalised to 0 to 360 (compass azimuth, clockwise from north). `final === true` returns the final bearing |
| `calculateFinalBearing` | `(start: Point, end: Point): number` | Final bearing at `end` |
| `destination` | `(origin: Point, distance: number, bearing: number, units: string): Point` | Point at `distance` along `bearing` degrees. Projected origins are converted to WGS84 and the result is converted back to Web Mercator. For an unknown `units` string the factor falls back to kilometres |
| `distanceToRadians` | `(distance: number, units: string): number` | Throws `Error('Distance is Required')` for `undefined`/`null`. Unknown units fall back to kilometres |
| `radiansToLength` | `(radians: number, units: string): number` | Throws for unknown units |
| `angleInRadians` / `angleInDegrees` | `(pt1: Point, pt2: Point): number` | Planar `atan2` angle in map coordinates (0 = east, counter-clockwise). Not a compass bearing |
| `calculateAngle` | `(fromPt, toPt): number` | Planar `atan2`, radians, accepts `{x, y}` |
| `toDegrees` | `(rad: number): string` | Radians to degrees, normalised to 0-360, returned as a string with one decimal (`"0"` on NaN) |
| `toRad` | `(deg: number): number` | Degrees to radians |
| `degreesToRadians` | `(degrees: number): number` | Degrees (reduced modulo 360) to radians |
| `radiansToDegrees` | `(radians: number): number` | Radians (reduced modulo 2 pi) to degrees |
| `getMidPoint` | `(p1: Point, p2: Point): Point` | Extent centre of the segment (planar midpoint in map units) |
| `twoPtsRelationShip` | `(pt1: Point, pt2: Point): string` | Quadrant of `pt2` relative to `pt1`: `"ne"`, `"nw"`, `"sw"`, `"se"` |
| `getArea` | `(extent?: Extent): number` | `width * height`, or `0` |
| `generateRandomPoints` | `(center: Point, radius: number, count: number): Point[]` | Random points around `center`; `radius` in metres, converted with a fixed degrees-per-metre factor, so it assumes a geographic centre |
| `generateRandomPoint` | `(center: Point, radius: number): Point` | Single point version |
| `setDefault` | `(object: any, property: string, defaults: any): any` | Returns `object[property]` if own and defined, else `defaults` |

`GeoTools.factors` (public readonly): earth-radius based factors keyed by unit name: `centimeters`, `centimetres`, `degrees`, `feet`, `inches`, `kilometers`, `kilometres`, `meters`, `metres`, `miles`, `millimeters`, `millimetres`, `nauticalmiles`, `radians`, `yards`.

Debug helpers `displayPoint(view, pt)`, `displayPolyline(view, polyline)` and `displayPointText(view, pt, text)` add graphics directly to `view.graphics`. They are intended for debugging only.

```ts
const km = GeoTools.distance(a, b, 'kilometers');
const az = GeoTools.bearing(a, b);
const p = GeoTools.destination(a, 10, az, 'kilometers');
```

---

## Utils

`Support/utils.ts`. Default export `Utils`; a class of static methods (the class itself is not a named export).

| Method | Signature | Description |
| --- | --- | --- |
| `escapeHtml` | `(value: unknown): string` | Escapes `& < > " '`; `null`/`undefined` become `""`. Route every user-supplied string (designations, plan titles, slide text) through this before interpolating into `innerHTML` |
| `svgToDataUrl` | `(svg: string): string` | Returns `data:image/svg+xml;charset=utf-8,` plus `encodeURIComponent(svg)`. Use instead of `btoa(svg)`, which throws on non-Latin-1 text such as Urdu |
| `getMidPoint` | `(pt1: Point, pt2: Point, spatialReference: SpatialReference): Point` | Arithmetic midpoint |
| `calculateDistance` | `(pt1, pt2): number` | Planar distance in map units; accepts `Point` or `{x, y}` |
| `calculateAngle` | `(fromPt, toPt): number` | `atan2(dy, dx)` in radians |
| `getTwoPointsRelationship` | `(pt1, pt2): string` | `"ne"`, `"nw"`, `"sw"` or `"se"` (tie handling on the axes differs from `GeoTools.twoPtsRelationShip`) |
| `createBezierPath` | `(pointCollection: {x, y}[], numberOfPts: number, spatialReference: SpatialReference, isPloyLine: Boolean): Polygon \| Polyline` | Catmull-Rom smoothed path. Parameter name is spelled `isPloyLine` in the source. `true` returns a `Polyline`, otherwise a `Polygon` (closed rings are smoothed periodically) |

```ts
img.src = Utils.svgToDataUrl(svgMarkup);
el.innerHTML = `<b>${Utils.escapeHtml(name)}</b>`;
```

---

## Echelons

`Support/Echelons.ts`. Default and named export. Static generators that return echelon marker geometry as arrays of paths (each path is an array of ArcGIS `Point`). Inputs: `dx`, `dy` = anchor in map units, `dr` = base size in map units, `sp` = `SpatialReference` applied to every generated point. Each `createXxx` returns `Point[][]` (one entry per polyline path) except `createPlus`, which returns a single `Point[]`.

| Method | Result |
| --- | --- |
| `createSQUAD(dx, dy, dr, sp)` | One filled dot (outline circle plus spiral fill) |
| `createSECTION(dx, dy, dr, sp)` | Two dots |
| `createPLATOON(dx, dy, dr, sp)` | Three dots |
| `createHollowOval(dx, dy, dr, sp)` | Hollow oval (`0.5*dr` wide, `dr` tall) |
| `createCoy(dx, dy, dr, sp)` | One vertical line (company) |
| `createBn(dx, dy, dr, sp)` | Two vertical lines (battalion) |
| `createREGIMENT(dx, dy, dr, sp)` | Three vertical lines |
| `createBRIGADE(dx, dy, dr, sp)` | One X |
| `createDIV(dx, dy, dr, sp)` | Two X |
| `createCORPS(dx, dy, dr, sp)` | Three X |
| `createComd(dx, dy, dr, sp)` | Two plus signs (command) |
| `createX(dx, dy, dr, sp)` | Single X as two separate diagonal paths |
| `createPlus(dx, dy, dr, sp): Point[]` | Plus sign as one point sequence |

The names follow the source. No other echelon levels (army, group, and so on) are generated here. For force symbols the echelon is rendered by milsymbol.js from the SIDC.

---

## EngineLogger

`Support/EngineLogger.ts`. Default export `EngineLogger`. Named type exports `LogType` and `EngineLogEntry`. Engines write to it; the host decides how to display the output.

```ts
type LogType = 'success' | 'error' | 'next-step';

interface EngineLogEntry {
  engine: string;      // for example "Proximity Engine"
  type: LogType;
  message: string;     // raw text
  formatted: string;   // "[<engine>: <message>]"
  timestamp: Date;
}
```

### Event: `engine-log`

A `CustomEvent<EngineLogEntry>` dispatched on `document` with `bubbles: true`. No event is dispatched while logging is disabled.

```ts
document.addEventListener('engine-log', (e) => {
  const { type, formatted } = (e as CustomEvent<EngineLogEntry>).detail;
  if (type === 'error') console.warn(formatted);
  else console.info(formatted);
});
```

This is the pattern used in `src/main.ts`.

### Static members

| Member | Signature | Description |
| --- | --- | --- |
| `setEnabled` | `(enabled: boolean): void` | Turn emission on or off. Default is enabled. `SymbolEngine` sets it from `Settings.json` `logging.enabled` at startup and when that setting changes |
| `isEnabled` | `static get: boolean` | Current state |
| `log` | `(engine: string, type: LogType, message: string): void` | Emit an entry |
| `success` | `(engine: string, message: string): void` | `log(engine, 'success', message)` |
| `error` | `(engine: string, message: string): void` | `log(engine, 'error', message)` |
| `nextStep` | `(engine: string, message: string): void` | `log(engine, 'next-step', message)` |

Host code can call these too to write into the same log panel.

---

## SettingsBus

`Support/SettingsBus.ts`. Named function exports over the `settingsChanged` window event and `window.symbolEngine.settings`. Full behaviour, the settings tree and the widget system are covered in [08 Settings](08-settings.md). Summary of the public surface:

| Export | Signature |
| --- | --- |
| `getSetting` | `<T = unknown>(path: readonly string[]): T \| undefined` - reads `window.symbolEngine.settings` along `path`; `undefined` if `window.symbolEngine` is not set |
| `setSetting` | `(path: readonly string[], value: unknown): void` - dispatches `settingsChanged` on `window` with detail `{ path, value, fullPath }` |
| `onSettingsChanged` | `(cb: (detail: SettingsChangedDetail) => void): () => void` - subscribes; returns an unsubscribe function |
| `hexToRgb` | `(hex: string): [number, number, number]` - `[0,0,0]` on bad input |
| `rgbToHex` | `(r, g, b): string` - clamps and pads |
| `toHexColor` | `(value: unknown): string` - RGB array or hex string to `#rrggbb`, `#000000` on bad input |

Types: `SettingPath = readonly string[]`; `SettingsChangedDetail = { path: string[]; value: unknown; fullPath: string }`. `getSetting` requires the host to assign `window.symbolEngine` (see [01 Getting started](01-getting-started.md)).

---

## GraphicsLayerManager

`Managers/GraphicsLayerManager.ts`. Default export `GraphicsLayerManager`; named exports `LAYER_NAMES`, `LEGACY_MIL_SYMBOLS_LAYER_ID`, `SYMBOL_LAYER_IDS`. The manager creates and owns the `GraphicsLayer`s for one view. Instances are per view, obtained through `getInstance`; the constructor is private. `SymbolEngine` exposes the current one as `engine.layerManager`.

### LAYER_NAMES

| Key | Layer id (string) | Contents |
| --- | --- | --- |
| `FORCE` | `ForceSymbolsLayer` | Unit and equipment (UEI, force) symbols |
| `TACT_PT` | `TacticalPointSymbolsLayer` | Tactical point symbols |
| `TACT` | `TacticalSymbolsLayer` | Tactical line and area graphics |
| `SKETCH` | `SketchLayer` | Temporary sketch graphics |
| `ANNOTATION_LAYER` | `AnnotationLayer` | Labels and text |
| `CLUSTER` | `ClusterBadgeLayer` | Declutter cluster badges |
| `LEADER_LINE` | `LeaderLineLayer` | Declutter leader lines |
| `LADDER` | `LadderLineLayer` | Declutter ladder lines |

### LEGACY_MIL_SYMBOLS_LAYER_ID

`"milSymbols"`. Layer used by the legacy milsymbol.js 3D pipeline (`addMilSymbolFor3D`). It is not part of `LAYER_NAMES`.

### SYMBOL_LAYER_IDS: readonly string[]

`[LAYER_NAMES.FORCE, LAYER_NAMES.TACT_PT, LAYER_NAMES.TACT, LEGACY_MIL_SYMBOLS_LAYER_ID]`. The canonical list of layers holding drawable symbols. Order is significant: lookups iterate in this order, so force symbols win over tactical graphics. Use it for any operation over "every symbol layer" (selection, hit-testing, custom export).

```ts
import { SYMBOL_LAYER_IDS } from './MS/Managers/GraphicsLayerManager.min.js';
const graphics = SYMBOL_LAYER_IDS
  .map((id) => (view.map.findLayerById(id) as GraphicsLayer | null)?.graphics.toArray() ?? [])
  .flat();
```

### GraphicsLayerManager.getInstance(view: MapView | SceneView): GraphicsLayerManager

Returns the manager for the view. The cache key is view type plus container id (a stable generated id is used if the view has no container). If the cached manager is for a different view object (for example the view was destroyed and recreated in the same container), a new manager is created.

### initializeLayers(): void

Creates (or adopts) the `TACT`, `TACT_PT`, `FORCE` and `ANNOTATION_LAYER` layers. `SymbolEngine`'s constructor and `onViewChanged` call it. `SKETCH`, `CLUSTER`, `LEADER_LINE` and `LADDER` are created on demand.

### getOrCreateLayer(layerName: string): GraphicsLayer

Returns the layer from the manager's cache; otherwise re-uses a layer with that id already on `view.map` (so graphics survive a 2D/3D switch); otherwise creates `new GraphicsLayer({ id: layerName, elevationInfo: { mode: "on-the-ground" } })` and adds it to the map.

### getLayer(layerName: string): GraphicsLayer | undefined

Cache lookup, then `view.map.findLayerById`. Never creates a layer.

### getSymbolLayer(): GraphicsLayer

Shorthand for `getOrCreateLayer(LAYER_NAMES.FORCE)`.

### listLayers(): string[]

Ids of the layers this manager has cached.

---

## ThemeManager

`Managers/ThemeManager.ts`. Default export `ThemeManager` (singleton); named exports `THEMES` and the type `ThemeName`. It applies the `--ms-*` CSS custom properties that `Styles/Widgets.css` and the engine panels use.

```ts
type ThemeName = 'ops-dark' | 'night-vision' | 'sandstorm' | 'arctic' | 'sipr';
```

Themes and labels: `ops-dark` "Ops Dark", `night-vision` "Night Vision", `sandstorm` "Sandstorm", `arctic` "Arctic", `sipr` "SIPR Red". Each defines the same variables (`--ms-bg`, `--ms-accent`, `--ms-text`, `--ms-border`, `--ms-font`, and others, see `THEMES`).

`SymbolEngine` calls `ThemeManager.getInstance().init(settings.ui.theme ?? 'ops-dark')` during construction (`Settings.json` default `ui.theme: "ops-dark"`).

| Member | Signature | Description |
| --- | --- | --- |
| `getInstance` | `static (): ThemeManager` | Singleton |
| `currentTheme` | `get: ThemeName` | Current theme; initial value `'ops-dark'` |
| `themeNames` | `get: { name: ThemeName; label: string }[]` | List for building a picker |
| `setTheme(name)` | `(ThemeName): void` | Writes a `<style id="ms-theme-vars">` with `:root { ... }` overrides, sets `data-ms-theme` on `<html>`, and dispatches a `ms-theme-changed` `CustomEvent` on `document` with `detail: { theme: name }`. An unknown name logs a warning and changes nothing |
| `init(name?)` | `(ThemeName = 'ops-dark'): void` | `setTheme(name)` plus a one-time global scrollbar stylesheet (`<style id="ms-global-scrollbar-styles">`) |

```ts
document.addEventListener('ms-theme-changed', (e) => {
  console.log((e as CustomEvent<{ theme: string }>).detail.theme);
});
ThemeManager.getInstance().setTheme('night-vision');
```

The theme variables are `:root`-level, so they also affect any host CSS that uses the same `--ms-*` names.

---

## ContextMenuManager

`Managers/ContextMenuManager.ts`. Default export; named types `ContextMenuItem`, `ContextMenuOptions`, `MenuItemEvent`. Singleton that extends the ArcGIS `Evented` class. `SymbolEngine` creates and wires it and exposes it as `engine.contextMenuManager`, so a host normally customises the existing instance instead of constructing another one. It registers items per graphic type. `SymbolEngine` registers `milSymbol`, `symbol` and `force` item sets; a graphic's type is read from `attributes.graphicType`, falling back to `attributes.type`.

### Types

```ts
interface ContextMenuItem {
  id: string;
  label: string | ((graphic?: Graphic) => string);
  shortcut?: string;
  icon?: string;
  enabled?: boolean | ((graphic: Graphic) => boolean);
  visible?: boolean | ((graphic: Graphic) => boolean);
  action?: (graphic: Graphic) => void;
  group?: string;
  order?: number;
  children?: ContextMenuItem[];   // submenu
}

interface ContextMenuOptions {
  menuClass?: string; menuItemClass?: string; menuItemHoverClass?: string;
  menuGroupClass?: string; menuSeparatorClass?: string;
  targetGraphicTypes?: string[];
  targetLayerIds?: string[];
  offsetX?: number; offsetY?: number;
}

interface MenuItemEvent {
  actionId: string; graphic: Graphic; layerId: string; graphicType?: string;
  view: MapView | SceneView; point: Point; originalEvent: any;
}
```

### Methods

| Method | Signature | Description |
| --- | --- | --- |
| `getInstance` | `static (): ContextMenuManager` | Returns the singleton, creating it if needed |
| `initialize` | `(view: MapView \| SceneView, options?: ContextMenuOptions): void` | Binds listeners to the view and merges options. `SymbolEngine` calls it with `targetLayerIds: [...SYMBOL_LAYER_IDS]` and again on every view switch |
| `configure` | `(options: ContextMenuOptions): void` | Merge options |
| `enable` / `disable` | `(): void` | Toggle the menu. `disable()` also hides an open menu. `SymbolEngine.onSettingChanged` calls them when the `features.contextMenu` setting changes |
| `registerMenuItems` | `(graphicType: string, items: ContextMenuItem[]): void` | Replace the item list for a type |
| `addMenuItem` | `(graphicType: string, item: ContextMenuItem): void` | Append and re-sort by group and order |
| `removeMenuItem` | `(graphicType: string, itemId: string): boolean` | True if an item was removed |
| `clearMenuItems` | `(graphicType: string): void` | Remove the list for one type |
| `clearAllMenuItems` | `(): void` | Remove every registered list (this also removes the built-in items) |
| `addDynamicItemProvider` | `(provider: (graphic: Graphic) => ContextMenuItem[]): void` | Extra items computed each time the menu opens. There is no removal method |
| `getLastClickedGraphic` | `(): Graphic \| null` | The most recently right-clicked graphic |
| `menuItems` | `readonly Map<string, ContextMenuItem[]>` | Registered items by type |
| `destroy` | `(): void` | Removes the menu and palette DOM, document listeners, clears items, and resets the singleton |

The `link*` methods (`linkMeasurementEngine`, `linkSymbolEngine`, `linkLOSEngine`, `linkWeaponEffectEngine`, `linkTrajectoryEngine`, `linkBufferEngine`, `linkCorridorEngine`, `linkFlightEngine`, `linkEffectEngine`, `linkDeadGroundMapper`, `linkKeyTerrainIdentificationEngine`, `linkPosDefScorerEngine`, `linkOpRankerEngine`, `linkLocalPeaksEngine`, `linkOcokaEngine`, `linkMissionPlannerEngine`, `linkLandingZoneEngine`, `linkAirspaceEngine`, `linkTrafficabilityEngine`, `linkSectorPanel`, `unlinkAnalysisEngines`) are called by `SymbolEngine` to add analysis sections to the menu. Host code does not normally call them.

### Event: `menu-item-click`

Emitted through `Evented.emit` with a `MenuItemEvent`. `SymbolEngine` subscribes to it itself. Because `ContextMenuManager` extends the ArcGIS `Evented` class, a host can subscribe with `on`:

```ts
const cm = engine.contextMenuManager;
cm.on('menu-item-click', (e: MenuItemEvent) => console.log(e.actionId, e.graphicType));

cm.addMenuItem('force', {
  id: 'host.inspect',
  label: 'Inspect',
  group: 'host',
  order: 10,
  action: (graphic) => showInspector(graphic.attributes.id),
});
```

Source ambiguity: whether items with an `action` also emit `menu-item-click` (lines 845, 1311 and 1412 of the source emit it from different paths) was not traced fully. Prefer `action` for custom items.

---

## LRUCache

`Cache/LRUCache.ts`. Default export `LRUCache<K, V>`. An internal cache used by the engines; it is documented because it is exported and small, but it is not a host-facing extension point.

| Member | Signature | Description |
| --- | --- | --- |
| `constructor` | `(maxSize = 100)` | Capacity |
| `get` | `(key: K): V \| undefined` | Returns the value and marks it most recent; counts a hit or a miss |
| `set` | `(key: K, value: V): void` | Inserts; evicts the least recently used entry when full |
| `setMaxSize` | `(newSize: number): void` | Resize, evicting oldest entries if needed |
| `getStats` | `(): { hits: number; misses: number }` | Counters |

There is no `delete`, `clear` or `size` member.
