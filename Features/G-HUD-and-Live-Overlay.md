# G · HUD & Live Overlay — Implementation Guide

## Overview

The HUD (Heads-Up Display) features are floating HTML overlay components positioned over the ArcGIS map container. They subscribe to engine events (`measurement-update`, `drawing-cue-state-change`, `proximity-hint`, `collision-warning`, etc.) and render live data without any map layer involvement. All HUD components are implemented as vanilla HTML/CSS/JS modules, not as ArcGIS widgets.

---

## Architecture

- **New directory**: `MS/HUD/`
  - `StatPanel.ts` — live measurement stats (G1)
  - `WarningToast.ts` — contextual warning badges (G2)
  - `UnitToggle.ts` — live unit/mode toggle bar (G3)
  - `MinimapInset.ts` — mini north-up overview map (G4)
- **Registration**: `SymbolEngine` calls `_initHUD()` after all engines initialise. HUD components mount themselves to `document.body` or to the map container element.
- **Feature flag**: `Settings.json → features.hud: true`

---

## G1 — Live Stat Panel

**What it does**: Subscribes to `measurement-update` and `drawing-cue-state-change`. Shows segment length, total length, bearing, elevation delta, march time in one compact panel. Appears only while drawing.

**Constraints**:
- **Visibility**: listen to `document.addEventListener("drawing-cue-state-change", ...)`. Show panel when `event.detail.isActive === true`, hide when `false`. Also hide if `MeasurementEngine.isEnabled === false`.
- **Position**: fixed to bottom-right of the map container. Use `position: fixed` with `bottom: 16px; right: 16px`. Z-index: 1000.
- **Data binding**: listen to `document.addEventListener("measurement-update", e => updatePanel(e.detail))`.
- **Displayed rows** (each row hidden if its value is empty string):
  - Segment: `e.detail.segmentLength`
  - Total: `e.detail.totalLength`
  - Bearing: `e.detail.gridAzimuth` (or `bearing` for backward-compat)
  - Area (for polygons): `e.detail.area`
  - March Time: `e.detail.marchTime` (if available)
  - Fuel: `e.detail.fuelEstimateL` formatted as `"28.4 L"`
- **Collapse toggle**: click the panel header to collapse it (show only header row). State stored in `localStorage["statPanelCollapsed"]`.
- **Style**: dark semi-transparent background `rgba(0,0,0,0.75)`, white text, monospace font for values, 12px font size. Rounded corners. Min-width 180px.
- **Animation**: fade in/out on show/hide (CSS transition `opacity 0.2s`).

---

## G2 — Contextual Warning Toasts

**What it does**: Badge-style alerts for terrain steepness, no-go zone crossings, collision, LOS occlusion, and friendly-fire proximity. Each badge auto-dismisses when the condition clears.

**Constraints**:
- Toast container: a `<div id="hud-warnings">` fixed to top-right of the map container. Stacks toasts vertically.
- Toast lifecycle: each toast has an ID matching the event type (e.g., `"toast-friendly-fire"`, `"toast-no-go-zone"`). When a warning event fires, **replace** the existing toast with that ID if it exists (no duplicate stacking).
- **Auto-dismiss**: each toast auto-dismisses when its clearing event fires. Map:

  | Warning Event | Clearing Event |
  |--------------|----------------|
  | `collision-warning` (type: friendly-fire) | Next `collision-warning` without friendly-fire, or `onDrawEnd` |
  | `no-go-zone-violation` | `proximity-clear` or `onDrawEnd` |
  | `collision-warning` (type: overlap) | Next `onDrawProgress` without overlap |
  | `proximity-hint` (phase: snapped) | `proximity-clear` |
  | `measurement-hint` (phase: drawing) | `onDrawEnd` |

- **Manual dismiss**: all toasts have a `×` close button.
- **Toast style**: coloured badge. Severity colours:
  - Error (no-go zone, hard collision): `#cc2200` red
  - Warning (safe-distance, slope): `#ff8c00` amber
  - Info (snap, hint): `#0066cc` blue
- **Animation**: slide in from right (`translateX(120%) → translateX(0)` CSS transition). Slide out on dismiss.
- **Max toasts**: 4 simultaneously. If a 5th fires, remove the oldest.

---

## G3 — Live Unit / Mode Toggle

**What it does**: Switch between m/km/nm, geodesic/planar, and 2D/3D measurement mode without stopping the draw session.

**Constraints**:
- **Component**: a compact horizontal toggle bar fixed to the top of the stat panel (G1). Always visible while drawing is active.
- **Unit toggle**: three buttons: `m`, `km`, `nm`. Clicking calls `MeasurementEngine.setOptions({ dist_unit: unit })` immediately. The active button has a highlight style.
- **Area unit toggle** (secondary row): `sqm`, `sqkm`, `ha`, `ac`. Calls `MeasurementEngine.setOptions({ area_unit: unit })`.
- **Angular unit toggle**: `°`, `mils`. Calls `MeasurementEngine.setOptions({ angular_unit: value })`.
- **Geodesic/Planar toggle**: a switch labelled `"Geodesic / Planar"`. Calls `MeasurementEngine.setOptions({ geodesic: bool })`. Note: `MeasurementEngine` currently auto-detects geodesic from the view's spatial reference. Add an `override_geodesic` option to allow manual override.
- **2D/3D distance toggle**: `"2D / 3D"` switch. Calls `MeasurementEngine.setOptions({ use3DDistance: bool })`. Only shown when view is a SceneView (C7).
- **March speed dropdown**: `"Walk (5 km/h)"`, `"Wheeled (40)"`, `"Tracked (25)"` — calls `MeasurementEngine.setMarchSpeed(preset)` (F3). Only shown if `marchTime` is in the last `measurement-update` event.
- All selections persist in `localStorage` under `"measurementOptions"` key.

---

## G4 — Minimap Inset

**What it does**: Small north-up overview map inset showing the full extent of the current plan with the symbol-in-progress highlighted. Maintains situational awareness when zoomed in.

**Constraints**:
- Implementation: create a second ArcGIS `MapView` in a small `<div id="minimap-container">` (180×180 px) fixed to the top-left of the main map container.
- The minimap `MapView` shares the same `Map` object as the main view (`new MapView({ map: mainMap, ... })`). This means all graphics layers are visible in both views automatically.
- Minimap is always north-up: set `minimap.rotation = 0` and lock rotation by intercepting and rejecting rotation events.
- **Extent sync**: the minimap shows the full plan extent (bounding box of all graphics in the current plan layer). Update on `onDrawEnd` by computing the union extent of all plan graphics and calling `minimap.goTo(unionExtent.expand(1.5))`.
- **Main view extent indicator**: add a `Graphic` to the minimap showing the main view's current extent as a semi-transparent blue rectangle. Update this graphic on `view.watch("extent")` (debounced 100ms).
- **Symbol-in-progress highlight**: on `onDrawProgress`, add/update a yellow Graphic at the cursor position in the minimap. Remove on `onDrawEnd`.
- **Collapsed state**: click the minimap to toggle between full size (180×180) and collapsed (icon only). State in `localStorage["minimapCollapsed"]`.
- **Constraints**: do not enable the minimap on mobile viewports (screen width < 768px).

---

## HUD Module Pattern

Each HUD component follows this pattern:

```typescript
class StatPanel {
  private _container: HTMLElement;
  private _isVisible: boolean = false;

  constructor(mapContainer: HTMLElement) {
    this._container = this._createDOM(mapContainer);
    this._bindEvents();
  }

  private _createDOM(parent: HTMLElement): HTMLElement {
    const el = document.createElement("div");
    el.id = "measurement-stat-panel";
    el.className = "hud-panel";
    parent.appendChild(el);
    return el;
  }

  private _bindEvents(): void {
    document.addEventListener("measurement-update", (e: any) => this._update(e.detail));
    document.addEventListener("drawing-cue-state-change", (e: any) => this._setVisible(e.detail.isActive));
  }

  private _update(data: MeasurementSnapshot): void { /* update DOM */ }
  private _setVisible(v: boolean): void { this._container.style.display = v ? "block" : "none"; }

  destroy(): void {
    this._container.remove();
    // remove event listeners
  }
}
```

---

## CSS Classes

All HUD components use shared CSS classes defined in `MS/HUD/hud.css`:

```css
.hud-panel {
  position: fixed;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  border-radius: 6px;
  padding: 8px 12px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  z-index: 1000;
  pointer-events: all;
  user-select: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}

.hud-warning-toast {
  position: relative;
  background: #cc2200;
  color: #fff;
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 6px;
  animation: slideIn 0.2s ease-out;
  max-width: 260px;
  font-size: 11px;
}

.hud-toggle-btn {
  background: rgba(255,255,255,0.1);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 3px;
  padding: 3px 8px;
  cursor: pointer;
  font-size: 11px;
}

.hud-toggle-btn.active {
  background: #0066cc;
  border-color: #0088ff;
}
```

---

## Settings.json Additions

```json
"features": { "hud": true },
"hud": {
  "statPanel": { "enabled": true },
  "warningToasts": { "enabled": true, "maxToasts": 4 },
  "unitToggle": { "enabled": true },
  "minimap": { "enabled": true, "sizeX": 180, "sizeY": 180 }
}
```

---

## Implementation Order

1. Create `MS/HUD/hud.css` with shared styles.
2. Implement `StatPanel.ts` with `measurement-update` binding (G1).
3. Implement `WarningToast.ts` with all event bindings (G2).
4. Implement `UnitToggle.ts` with all toggle buttons (G3).
5. Implement `MinimapInset.ts` with shared-map second MapView (G4).
6. Wire all HUD components in `SymbolEngine._initHUD()`.
7. Add `hud.css` import to the main entry point.
