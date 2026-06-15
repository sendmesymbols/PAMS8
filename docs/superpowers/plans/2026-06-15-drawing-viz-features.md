# Drawing / Visualization Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independent UI features to the PAMS8 MS library — a subtract (Alt+L) lasso, a polygon close-cue, and an interactive threat/engagement sector.

**Architecture:** Each feature extends one or two existing engines with no new dependencies. Sector geometry is isolated in a pure (ArcGIS-free) helper so it can be checked without a browser; the interactive sector controller is a small dedicated class; the lasso and close-cue are surgical additions to SelectionEngine/KeyboardShortcutManager and DrawingCueEngine respectively.

**Tech Stack:** TypeScript 5, `@arcgis/core` 5.0.19 (ESM), Vite. **No test runner exists** in this repo — per-task verification is `tsc -p tsconfig.build.json` filtered to changed files (no *new* errors vs. the pre-existing baseline) plus manual checks in `npm run dev` (the user runs the dev server). The pure sector-geometry helper additionally gets a one-off `node` sanity check.

**Spec:** `docs/superpowers/specs/2026-06-15-drawing-viz-features-design.md`

---

## File Structure

- `MS/Engines/SelectionEngine.ts` *(modify)* — add a red subtract lasso symbol + `subtract` mode to `lassoSelect`. (`deselectGraphic` already exists at line 729.)
- `MS/Engines/KeyboardShortcutManager.ts` *(modify)* — `Alt+L` branch in the `l/L` case.
- `MS/Engines/DrawingCueEngine.ts` *(modify)* — arm a close-cue from `updateFromProgress`, render it in the pointer-move handler, clear it in `deactivate`.
- `MS/Data/Settings.json` *(modify)* — add `drawingCues.closeCue: true`.
- `MS/Engines/Visualization/sectorGeometry.ts` *(create)* — pure wedge-ring math, no ArcGIS imports.
- `MS/Engines/Visualization/VisualizationEngine.ts` *(modify)* — `showSector` / `clearSectors` using the pure helper.
- `MS/Engines/Visualization/SectorDrawTool.ts` *(create)* — interactive center→range→sweep controller.
- `MS/Engines/SymbolEngine.ts` *(modify)* — instantiate `SectorDrawTool`, route `onViewChanged`, register the context-menu item, expose API passthroughs.

Smallest-risk first: subtract lasso → close-cue → sector.

---

## Task 0: Feature branch

- [ ] **Step 1: Create and switch to a feature branch** (we are on `master`; isolate the work)

Run:
```bash
git checkout -b feat/drawing-viz-features
```
Expected: `Switched to a new branch 'feat/drawing-viz-features'`

---

## Task 1: Subtract lasso (Alt+L)

**Files:**
- Modify: `MS/Engines/SelectionEngine.ts` (lasso symbol const near line 29; `lassoSelect` at 501–571)
- Modify: `MS/Engines/KeyboardShortcutManager.ts` (`case 'l'/'L'` at 194–201; doc comment at line 50)

- [ ] **Step 1: Add a red subtract-lasso symbol**

In `SelectionEngine.ts`, immediately after the existing `LASSO_SYM` definition (around line 29–40), add:

```ts
// ── Subtract (deselect) lasso polygon symbol ─────────────────────────────────
const LASSO_SUBTRACT_SYM = new SimpleFillSymbol({
    color: new Color([220, 50, 50, 0.12]),
    outline: new SimpleLineSymbol({
        color: new Color([220, 50, 50, 0.9]),
        width: 1.5,
        style: "dash",
    }),
});
```

If `Color` is not already imported in this file, add `import Color from "@arcgis/core/Color";` with the other imports. (`SimpleFillSymbol` and `SimpleLineSymbol` are already imported — they build `LASSO_SYM`.)

- [ ] **Step 2: Add a `subtract` option to `lassoSelect`**

Change the signature and the symbol/complete logic in `lassoSelect` (501–571).

Signature (line 501–504) becomes:
```ts
    lassoSelect(
        opts?: { freehand?: boolean; addToSelection?: boolean; subtract?: boolean },
        onComplete?: (selected: Graphic[]) => void
    ): void {
```

Use the red symbol when subtracting — change the `SketchViewModel` construction (510–514) to:
```ts
        this._lassoVM = new SketchViewModel({
            view: this.view,
            layer: lassoLayer,
            polygonSymbol: opts?.subtract ? LASSO_SUBTRACT_SYM : LASSO_SYM,
        });
```

Update the hint (516–519) to reflect mode:
```ts
        EngineLogger.nextStep(
            'Selection Engine',
            `${opts?.subtract ? 'Subtract' : 'Lasso'} active — draw a polygon to ${opts?.subtract ? 'deselect' : 'select'} symbols. ${opts?.freehand ? 'Release mouse' : 'Double-click'} to finish`,
        );
```

Replace the apply block (550–560) with subtract-aware logic:
```ts
                if (opts?.subtract) {
                    hit.forEach(g => this.deselectGraphic(g));
                    if (hit.length > 0) {
                        EngineLogger.success(
                            'Selection Engine',
                            `${hit.length} symbol${hit.length !== 1 ? 's' : ''} removed from selection`,
                        );
                    } else {
                        EngineLogger.nextStep('Selection Engine', 'No selected symbols inside the subtract area');
                    }
                } else {
                    if (!opts?.addToSelection) this.clearSelection();
                    hit.forEach(g => this.selectGraphic(g));
                    if (hit.length > 0) {
                        EngineLogger.success(
                            'Selection Engine',
                            `${hit.length} symbol${hit.length !== 1 ? 's' : ''} selected via lasso`,
                        );
                    } else {
                        EngineLogger.nextStep('Selection Engine', 'No symbols found in lasso area — try a wider selection');
                    }
                }
```

(`deselectGraphic` already exists at line 729 and removes the highlight + emits `selectionChange`.)

- [ ] **Step 3: Add the `Alt+L` branch in KeyboardShortcutManager**

Replace the body of `case 'l'/'L'` (195–201) with:
```ts
      case 'l':
      case 'L':
        if (e.altKey) {
          if (this.deps.selectionEngine.isLassoActive) {
            this.deps.selectionEngine.cancelLasso();
          } else {
            this.deps.selectionEngine.lassoSelect({ subtract: true });
          }
        } else if (this.deps.selectionEngine.isLassoActive) {
          this.deps.selectionEngine.cancelLasso();
        } else {
          this.deps.selectionEngine.lassoSelect();
        }
        break;
```

Update the shortcut-table comment (line 50) to:
```
 *   L           Lasso select (or cancel active lasso)
 *   Alt+L       Subtract lasso — remove enclosed symbols from selection
```

- [ ] **Step 4: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SelectionEngine|KeyboardShortcutManager" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.`

- [ ] **Step 5: Manual check (user runs `npm run dev`)**

Select several symbols (lasso `L` or click). Press `Alt+L`, draw a polygon around a few selected symbols, finish (double-click). Expected: enclosed symbols drop from the selection; lasso renders red/dashed; plain `L` still adds. Note for the user to confirm.

- [ ] **Step 6: Commit**

```bash
git add MS/Engines/SelectionEngine.ts MS/Engines/KeyboardShortcutManager.ts
git commit -m "feat(selection): Alt+L subtract lasso to deselect enclosed symbols"
```

---

## Task 2: Polygon close-cue (DrawingCueEngine)

**Files:**
- Modify: `MS/Engines/DrawingCueEngine.ts` (fields near 118; `updateFromProgress` 346–363; pointer-move handler at 314; `deactivate` 365–389)
- Modify: `MS/Data/Settings.json` (`drawingCues` subtree)

- [ ] **Step 1: Add the settings flag**

In `MS/Data/Settings.json`, inside the `drawingCues` object, add (keep existing keys; add this one):
```json
"closeCue": true
```

- [ ] **Step 2: Add fields for the close-cue**

In `DrawingCueEngine.ts`, near the other private fields (around line 118), add:
```ts
  private _closeCueEnabled: boolean = true;
  private _closeFirstVertex: Point | null = null;
  private _closeRingG: Graphic | null = null;
  private static readonly CLOSE_PX = 16;
```
Ensure `Graphic` and `Point` are imported (they are used throughout this file already). Read the flag from settings where the other `drawingCues` flags are initialized (search this file for how `_ringsEnabled` / `_guidesShowArc` get their initial value from `settingsData` and mirror it):
```ts
    this._closeCueEnabled = (settingsData as any)?.drawingCues?.closeCue !== false;
```
If the engine has an `onSettingChanged`/settings handler that updates `_ringsEnabled`, add a sibling case so `drawingCues.closeCue` toggles `_closeCueEnabled` live. (Follow the existing pattern exactly; if there is no live-update handler for the other flags, the constructor read is sufficient.)

- [ ] **Step 3: Arm the cue in `updateFromProgress`**

Inside `updateFromProgress` (346), after the existing `if (newCount !== this._prevCtrlPtCount) { ... }` block updates state, add arming logic at the end of the method (before the closing brace at 363):
```ts
    // Close-cue: armed only while drawing a polygon with >= 3 committed anchors.
    // ctrlPts[last] is the live cursor, so committed anchors = newCount - 1.
    const committed = newCount - 1;
    if (this._closeCueEnabled && _geom?.type === "polygon" && committed >= 3) {
      this._closeFirstVertex = ctrlPts[0] ?? null;
    } else {
      this._closeFirstVertex = null;
      this._clearCloseRing();
    }
```

- [ ] **Step 4: Render the ring from the pointer-move handler**

Add a private method (place it near the other drawing helpers):
```ts
  /** Show a "close ring" over the first vertex when the cursor is within CLOSE_PX. */
  private _updateCloseCue(e: PointerEvent): void {
    if (!this._closeCueEnabled || !this._closeFirstVertex || !this._view || !this._layer) {
      this._clearCloseRing();
      return;
    }
    const screen = this._view.toScreen(this._closeFirstVertex);
    if (!screen) { this._clearCloseRing(); return; }
    const rect = (this._view.container as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dist = Math.hypot(px - screen.x, py - screen.y);
    if (dist > DrawingCueEngine.CLOSE_PX) { this._clearCloseRing(); return; }
    if (!this._closeRingG) {
      this._closeRingG = new Graphic({
        geometry: this._closeFirstVertex,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: [0, 0, 0, 0],
          size: DrawingCueEngine.CLOSE_PX * 2,
          outline: { color: [80, 220, 120, 0.95], width: 2 },
        }),
      });
      this._layer.add(this._closeRingG);
    } else {
      this._closeRingG.geometry = this._closeFirstVertex;
    }
  }

  private _clearCloseRing(): void {
    if (this._closeRingG && this._layer) this._layer.remove(this._closeRingG);
    this._closeRingG = null;
  }
```
Add `import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";` if not already imported.

Then call it from inside the existing `_boundPointerMove` arrow (defined at 314) — after its existing guard `if (!this._isActive || !this._view) return;`, add:
```ts
        this._updateCloseCue(e);
```

- [ ] **Step 5: Clear the ring on deactivate**

In `deactivate` (365), alongside the other cleanup (e.g., after `this._clearDrawingGraphics();` at 384), add:
```ts
    this._closeFirstVertex = null;
    this._clearCloseRing();
```

- [ ] **Step 6: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "DrawingCueEngine" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.` (The pre-existing `DeadGroundMapper.ts:446` baseline error is unrelated.)

- [ ] **Step 7: Manual check (user runs `npm run dev`)**

Start drawing a polygon area symbol (e.g., Assembly Area / Freehand Area). After ≥3 vertices, move the cursor near the first vertex → a green close-ring appears within ~16px and clears when moving away. Draw a line symbol → no ring. Set `drawingCues.closeCue` off in Settings → no ring.

- [ ] **Step 8: Commit**

```bash
git add MS/Engines/DrawingCueEngine.ts MS/Data/Settings.json
git commit -m "feat(drawing-cues): close-ring cue over first vertex when drawing polygons"
```

---

## Task 3: Pure sector geometry helper

**Files:**
- Create: `MS/Engines/Visualization/sectorGeometry.ts`

- [ ] **Step 1: Write the pure helper**

Create `MS/Engines/Visualization/sectorGeometry.ts`:
```ts
// Pure wedge-ring geometry — NO @arcgis imports so it can run/verify under bare Node.
// All angles in degrees, distances in km, coordinates [lon, lat].

const R_EARTH_KM = 6371.0088;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Great-circle destination point from (lon,lat) at rangeKm along bearingDeg. */
export function geodesicDestination(
  lon: number, lat: number, rangeKm: number, bearingDeg: number,
): [number, number] {
  const ang = rangeKm / R_EARTH_KM;
  const brg = bearingDeg * D2R;
  const phi1 = lat * D2R;
  const lam1 = lon * D2R;
  const sinPhi2 = Math.sin(phi1) * Math.cos(ang) + Math.cos(phi1) * Math.sin(ang) * Math.cos(brg);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(brg) * Math.sin(ang) * Math.cos(phi1);
  const x = Math.cos(ang) - Math.sin(phi1) * sinPhi2;
  const lam2 = lam1 + Math.atan2(y, x);
  const lonOut = ((lam2 * R2D + 540) % 360) - 180; // normalize to [-180,180)
  return [lonOut, phi2 * R2D];
}

/**
 * Closed wedge ring [center, arc(azStart..azEnd clockwise), center].
 * Sweep is ALWAYS clockwise (increasing azimuth) from azStartDeg to azEndDeg.
 * Returns an array of [lon,lat]; first === last (closed).
 */
export function buildSectorRing(
  centerLon: number, centerLat: number, rangeKm: number,
  azStartDeg: number, azEndDeg: number, stepDeg = 2,
): [number, number][] {
  let span = (((azEndDeg - azStartDeg) % 360) + 360) % 360;
  if (span === 0) span = 360; // caller guards azStart===azEnd; full ring is the safe fallback
  const steps = Math.max(1, Math.ceil(span / stepDeg));
  const ring: [number, number][] = [[centerLon, centerLat]];
  for (let i = 0; i <= steps; i++) {
    const az = azStartDeg + (span * i) / steps;
    ring.push(geodesicDestination(centerLon, centerLat, rangeKm, az));
  }
  ring.push([centerLon, centerLat]);
  return ring;
}
```

- [ ] **Step 2: One-off sanity check under Node**

Run (uses the same formula inline; verifies closure + endpoint bearings for a 0°→90° quarter wedge of 10 km):
```bash
node -e '
const R=6371.0088,D=Math.PI/180,Rd=180/Math.PI;
function dest(lon,lat,km,b){const a=km/R,br=b*D,p1=lat*D,l1=lon*D;
 const s=Math.sin(p1)*Math.cos(a)+Math.cos(p1)*Math.sin(a)*Math.cos(br);
 const p2=Math.asin(s),y=Math.sin(br)*Math.sin(a)*Math.cos(p1),x=Math.cos(a)-Math.sin(p1)*s;
 const l2=l1+Math.atan2(y,x);return [((l2*Rd+540)%360)-180,p2*Rd];}
function brg(lon1,lat1,lon2,lat2){const p1=lat1*D,p2=lat2*D,dl=(lon2-lon1)*D;
 const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
 return ((Math.atan2(y,x)*Rd)+360)%360;}
const c=[10,50];let span=90,steps=Math.ceil(span/2);
const ring=[[...c]];for(let i=0;i<=steps;i++){ring.push(dest(c[0],c[1],10,0+span*i/steps));}ring.push([...c]);
const first=ring[1],last=ring[ring.length-2];
const b0=brg(c[0],c[1],first[0],first[1]),b1=brg(c[0],c[1],last[0],last[1]);
console.log("closed:",JSON.stringify(ring[0])===JSON.stringify(ring[ring.length-1]));
console.log("startBearing≈0:",b0.toFixed(2),"endBearing≈90:",b1.toFixed(2));
'
```
Expected: `closed: true` and start bearing ≈ `0.00`, end bearing ≈ `90.00` (within ~0.5°).

- [ ] **Step 3: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "sectorGeometry" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.`

- [ ] **Step 4: Commit**

```bash
git add MS/Engines/Visualization/sectorGeometry.ts
git commit -m "feat(viz): pure geodesic wedge-ring geometry helper for threat sectors"
```

---

## Task 4: `showSector` / `clearSectors` in VisualizationEngine

**Files:**
- Modify: `MS/Engines/Visualization/VisualizationEngine.ts` (add methods near `showThreatFan`/`clearThreatFan` at 914–967; imports at top)

- [ ] **Step 1: Import the helper**

At the top of `VisualizationEngine.ts`, with the other imports, add:
```ts
import { buildSectorRing } from "./sectorGeometry";
```
(`Polygon`, `SimpleFillSymbol`, `SimpleLineSymbol`, `Color`, `Point`, `Graphic` are already imported.)

- [ ] **Step 2: Add `showSector` and `clearSectors`**

After `clearThreatFan` (ends at 967), add:
```ts
  /**
   * Draw a geodesic engagement/threat sector (wedge) centered on a point.
   * Sweeps CLOCKWISE from azStartDeg to azEndDeg. Multiple sectors may coexist;
   * use clearSectors() to remove them all.
   */
  public showSector(
    center: Point | Graphic,
    opts: {
      rangeKm: number;
      azStartDeg: number;
      azEndDeg: number;
      color?: [number, number, number];
      opacity?: number;
    },
  ): void {
    if (!this._vizLayer) return;
    const pt = ("geometry" in center ? center.geometry : center) as Point | null;
    if (!pt || pt.type !== "point") return;
    if (!(opts.rangeKm > 0)) return;
    if (((opts.azEndDeg - opts.azStartDeg) % 360 + 360) % 360 === 0) return; // degenerate

    const ring = buildSectorRing(
      pt.longitude as number, pt.latitude as number,
      opts.rangeKm, opts.azStartDeg, opts.azEndDeg,
    );
    const polygon = new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } });
    const [r, g, b] = opts.color ?? [220, 50, 50];
    const a = opts.opacity ?? 0.30;
    this._vizLayer.add(new Graphic({
      geometry: polygon,
      symbol: new SimpleFillSymbol({
        color: new Color([r, g, b, a]),
        outline: new SimpleLineSymbol({ color: new Color([r, g, b, 0.85]), width: 1.5, style: "solid" }),
      }),
      attributes: { [VIZ_TAG]: "sector" },
    }));
  }

  /** Remove all sector overlays (committed and preview). */
  public clearSectors(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector" || g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }

  /** Internal: draw/replace the live preview wedge while the SectorDrawTool is active. */
  public _renderSectorPreview(
    pt: Point, rangeKm: number, azStartDeg: number, azEndDeg: number,
  ): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
    if (!(rangeKm > 0)) return;
    const ring = buildSectorRing(
      pt.longitude as number, pt.latitude as number, rangeKm, azStartDeg, azEndDeg,
    );
    this._vizLayer.add(new Graphic({
      geometry: new Polygon({ rings: [ring], spatialReference: { wkid: 4326 } }),
      symbol: new SimpleFillSymbol({
        color: new Color([220, 50, 50, 0.15]),
        outline: new SimpleLineSymbol({ color: new Color([220, 50, 50, 0.9]), width: 1.5, style: "dash" }),
      }),
      attributes: { [VIZ_TAG]: "sector-preview" },
    }));
  }

  public clearSectorPreview(): void {
    if (!this._vizLayer) return;
    this._vizLayer.graphics
      .filter((g: Graphic) => g.attributes?.[VIZ_TAG] === "sector-preview")
      .toArray()
      .forEach((g: Graphic) => this._vizLayer!.remove(g));
  }
```

- [ ] **Step 3: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "VisualizationEngine" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.`

- [ ] **Step 4: Manual check (user runs `npm run dev`, in devtools console)**

```js
const g = symbolEngine.selectionEngine.selectedGraphics[0]; // a point symbol selected on the map
symbolEngine.visualizationEngine.showSector(g, { rangeKm: 5, azStartDeg: 30, azEndDeg: 120 });
```
Expected: a translucent red 30°→120° wedge, 5 km radius, centered on the symbol. `symbolEngine.visualizationEngine.clearSectors()` removes it. (Property names `selectionEngine`/`visualizationEngine` per SymbolEngine's public getters — confirm during wiring in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add MS/Engines/Visualization/VisualizationEngine.ts
git commit -m "feat(viz): showSector/clearSectors geodesic engagement wedges"
```

---

## Task 5: SectorDrawTool (interactive controller)

**Files:**
- Create: `MS/Engines/Visualization/SectorDrawTool.ts`

- [ ] **Step 1: Write the controller**

Create `MS/Engines/Visualization/SectorDrawTool.ts`:
```ts
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import GeoTools from "../../Support/GeoTools";
import type VisualizationEngine from "./VisualizationEngine";

type Phase = "idle" | "range" | "sweep";

/**
 * Interactive threat-sector draw: center → drag to set range + start edge (click)
 * → sweep to set end edge (click). Escape / right-click cancels. The sweep is
 * accumulated from pointer motion so the user can draw a narrow or reflex wedge
 * and cross North cleanly; the result is mapped onto VisualizationEngine.showSector's
 * clockwise (azStart→azEnd) convention.
 */
export default class SectorDrawTool {
  private _phase: Phase = "idle";
  private _center: Point | null = null;
  private _rangeKm = 0;
  private _azStart = 0;
  private _sweep = 0;          // signed accumulated degrees; + = clockwise
  private _lastAz = 0;
  private _handles: Array<{ remove(): void }> = [];
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private _getView: () => MapView | SceneView | null,
    private _viz: VisualizationEngine,
  ) {}

  begin(center?: Point | Graphic): void {
    const view = this._getView();
    if (!view) return;
    this.cancel();
    if (center) {
      const pt = ("geometry" in center ? center.geometry : center) as Point | null;
      if (pt && pt.type === "point") { this._center = pt; this._phase = "range"; }
    }
    if (!this._center) this._phase = "range"; // center set on first click

    this._handles.push(view.on("pointer-move", (e: any) => this._onMove(e)));
    this._handles.push(view.on("click", (e: any) => this._onClick(e)));
    // right-click cancels
    this._handles.push(view.on("pointer-down", (e: any) => { if (e.button === 2) { e.stopPropagation(); this.cancel(); } }));
    this._keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") this.cancel(); };
    document.addEventListener("keydown", this._keyHandler);
  }

  cancel(): void {
    this._phase = "idle";
    this._center = null;
    this._rangeKm = 0;
    this._sweep = 0;
    this._handles.forEach(h => h.remove());
    this._handles = [];
    if (this._keyHandler) { document.removeEventListener("keydown", this._keyHandler); this._keyHandler = null; }
    this._viz.clearSectorPreview();
  }

  onViewChanged(_view: MapView | SceneView): void { this.cancel(); }

  private _mapPt(e: any): Point | null {
    const view = this._getView();
    if (!view) return null;
    const p = view.toMap({ x: e.x, y: e.y });
    return p && p.type === "point" ? (p as Point) : null;
  }

  private _rangeKmTo(pt: Point): number {
    if (!this._center) return 0;
    const line = new Polyline({
      paths: [[[this._center.longitude as number, this._center.latitude as number],
               [pt.longitude as number, pt.latitude as number]]],
      spatialReference: { wkid: 4326 },
    });
    return geometryEngine.geodesicLength(line, "kilometers");
  }

  private _onMove(e: any): void {
    const pt = this._mapPt(e);
    if (!pt || !this._center) return;
    if (this._phase === "range") {
      this._rangeKm = this._rangeKmTo(pt);
      const az = GeoTools.bearing(this._center, pt);
      this._viz._renderSectorPreview(this._center, this._rangeKm, az, az + 1);
    } else if (this._phase === "sweep") {
      const az = GeoTools.bearing(this._center, pt);
      let d = ((az - this._lastAz + 540) % 360) - 180; // shortest signed step
      this._sweep += d;
      this._lastAz = az;
      const { start, end } = this._clockwise(this._azStart, this._sweep);
      this._viz._renderSectorPreview(this._center, this._rangeKm, start, end);
    }
  }

  private _onClick(e: any): void {
    const pt = this._mapPt(e);
    if (!pt) return;
    if (this._phase === "range") {
      if (!this._center) { this._center = pt; return; } // first click sets center if not seeded
      this._rangeKm = this._rangeKmTo(pt);
      this._azStart = GeoTools.bearing(this._center, pt);
      this._lastAz = this._azStart;
      this._sweep = 0;
      this._phase = "sweep";
    } else if (this._phase === "sweep") {
      if (!this._center) return;
      const { start, end } = this._clockwise(this._azStart, this._sweep);
      this._viz.clearSectorPreview();
      this._viz.showSector(this._center, { rangeKm: this._rangeKm, azStartDeg: start, azEndDeg: end });
      this.cancel();
    }
  }

  /** Map a signed sweep about azStart onto a clockwise (start→end) pair. */
  private _clockwise(azStart: number, sweep: number): { start: number; end: number } {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    if (sweep >= 0) return { start: norm(azStart), end: norm(azStart + sweep) };
    return { start: norm(azStart + sweep), end: norm(azStart) };
  }
}
```

- [ ] **Step 2: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SectorDrawTool" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.` If `GeoTools.bearing`'s signature differs (it is declared `bearing(start: Point, end: Point, final?: boolean)` at GeoTools.ts:323), no change needed. If the default export of `GeoTools` is not available, switch to the named import style used elsewhere in the repo (check `MS/Support/GeoTools.ts`'s export and match it).

- [ ] **Step 3: Commit**

```bash
git add MS/Engines/Visualization/SectorDrawTool.ts
git commit -m "feat(viz): interactive SectorDrawTool (center -> range -> sweep)"
```

---

## Task 6: Wire the sector into SymbolEngine (instantiate, view-switch, context menu, API)

**Files:**
- Modify: `MS/Engines/SymbolEngine.ts` (`_initVisualizationEngine` at 758; `onViewChanged` near 606; `registerContextMenuItems` at 869, `milSymbolMenuItems` array at 871; add public passthrough methods; field declaration near 169)

- [ ] **Step 1: Import + field**

At the top imports of `SymbolEngine.ts`, add:
```ts
import SectorDrawTool from './Visualization/SectorDrawTool.ts';
```
Near the `_visualizationEngine` field (line 169), add:
```ts
  private _sectorDrawTool: SectorDrawTool | null = null;
```

- [ ] **Step 2: Instantiate when the viz engine initializes**

Inside `_initVisualizationEngine` (758), after `_visualizationEngine` is assigned, add:
```ts
    if (this._visualizationEngine) {
      this._sectorDrawTool = new SectorDrawTool(() => this.view, this._visualizationEngine);
    }
```

- [ ] **Step 3: Route view changes**

In `onViewChanged` (574), next to `this._visualizationEngine?.onViewChanged(newView);` (line 606), add:
```ts
    this._sectorDrawTool?.onViewChanged(newView);
```

- [ ] **Step 4: Public passthroughs (for context menu + API panel)**

Add public methods on `SymbolEngine` (near the other public viz helpers):
```ts
  /** Start the interactive threat-sector draw, optionally seeded on a point graphic. */
  public beginSectorDraw(center?: Graphic): void {
    this._sectorDrawTool?.begin(center);
  }
  /** Clear all drawn threat sectors. */
  public clearSectors(): void {
    this._visualizationEngine?.clearSectors();
  }
```

- [ ] **Step 5: Register the context-menu item**

In `registerContextMenuItems` (869), add an entry to the `milSymbolMenuItems` array (871) — place it with the other per-graphic actions:
```ts
      {
        id: 'add-threat-sector',
        label: 'Add Threat Sector',
        action: (graphic: Graphic) => this.beginSectorDraw(graphic),
      },
```
Match the exact shape of the surrounding `ContextMenuItem` entries (some use `icon`/`group`); copy those fields from a neighboring item if they are required. This array is registered for both `'milSymbol'` and `'symbol'` categories (1000–1001), so tactical point symbols get the action.

- [ ] **Step 6: Compile-gate**

Run:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SymbolEngine\.ts" || echo "No new errors in changed files."
```
Expected: `No new errors in changed files.`

- [ ] **Step 7: Manual check (user runs `npm run dev`)**

Right-click a point/tactical-point symbol → **Add Threat Sector**. Move to set range + first edge → click; sweep to set the arc → click. Expected: a red wedge is committed. `Escape` or right-click mid-draw cancels with no leftover preview. Switching 2D↔3D mid-draw cancels cleanly. `symbolEngine.clearSectors()` removes all sectors.

- [ ] **Step 8: Commit**

```bash
git add MS/Engines/SymbolEngine.ts
git commit -m "feat(viz): wire SectorDrawTool into SymbolEngine + context menu + API"
```

---

## Final verification

- [ ] **Full filtered compile** — confirm no *new* errors across all touched files:
```bash
npx tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SelectionEngine|KeyboardShortcutManager|DrawingCueEngine|sectorGeometry|VisualizationEngine|SectorDrawTool|SymbolEngine\.ts"
```
Expected: empty output, or only the known pre-existing `DeadGroundMapper.ts:446` baseline (which is not in this list).

- [ ] **User manual pass** — user runs `npm run dev` and confirms all three features per the per-task manual checks.

- [ ] **(Optional) index.html / src/main.ts** — if the API Test panel should surface `beginSectorDraw`/`clearSectors` buttons, add them following the existing panel pattern (CLAUDE.md note #5). Skip if API access via console is sufficient.
