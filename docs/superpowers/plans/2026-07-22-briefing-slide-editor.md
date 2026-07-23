# Briefing Slide Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-screen PowerPoint-like slide editor for Briefing slides (text, fonts, shapes, arrows, colors) whose annotations persist in the deck JSON and export as native PowerPoint objects.

**Architecture:** Each `Slide` gains `overlays: SlideOverlay[]` — slide-anchored annotation objects in normalized [0..1] view-rect coordinates. A new fabric.js full-screen editor edits them over a frozen full-res screenshot; a shared pure-function module maps model↔fabric both for the editor and for present-mode display; `PptxExporter` emits them as native pptx objects through the same contain-fit mapping Mode B already uses.

**Tech Stack:** TypeScript, fabric.js 4.5 (`window.fabric`, CDN — NOT an ES module), pptxgenjs 4 (dynamic import), ArcGIS JS SDK views.

**Spec:** `docs/superpowers/specs/2026-07-22-briefing-slide-editor-design.md`

## Global Constraints

- **No commits** — user commits themselves. **No branches/worktrees** — edit in place on master.
- **No unit-test framework exists.** Per-task verification = `node node_modules/vite/bin/vite.js build` green + `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` output filtered to touched files (baseline has ~3000 pre-existing TS2307 @arcgis errors — only NEW errors in touched files count). Final GUI verification is manual (user runs `npm run dev` themselves — never start a dev server for them).
- fabric.js is `(window as any).fabric` — never `import` it.
- Everything stays behind the existing `features.briefing` flag; export additionally behind `features.exportTools`. No new settings.
- All new UI follows BriefingEngine's existing injected-style pattern (`_injectStyles`, `ms-briefing-*` class prefix).
- Additive only: single-click on a tile still flies the map; only tile double-click behavior changes (prompt-rename → editor).

---

### Task 1: Data model — `SlideOverlay`

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts`

**Interfaces (Produces — every later task consumes these):**

```ts
export type OverlayKind = 'text' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'freehand';

export interface SlideOverlay {
  id: string;
  kind: OverlayKind;
  /** Normalized [0..1] bounding box relative to the slide's view rect (top-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the box center — text/rect/ellipse only. */
  rotation?: number;
  /** line/arrow: [start, end]; freehand: sampled polyline. Normalized to the view rect. */
  points?: Array<{ x: number; y: number }>;
  /** '#RRGGBB'; absent = no fill. */
  fill?: string;
  /** 0..1, default 1. */
  fillOpacity?: number;
  /** '#RRGGBB'. */
  stroke?: string;
  /** Fraction of view HEIGHT (px = f × canvasH; pptx pt = f × fit.h × 72). */
  strokeWidth?: number;
  /** Whole-object opacity 0..1, default 1. */
  opacity?: number;
  // text only:
  text?: string;
  fontFamily?: string;
  /** Fraction of view HEIGHT. */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  textColor?: string;
}
```

- [ ] **Step 1:** Add `OverlayKind` + `SlideOverlay` above `Slide`; add to `Slide`:
  ```ts
  /** PowerPoint-like annotations added in the slide editor (normalized coords). */
  overlays?: SlideOverlay[];
  ```
  Change `BriefingDocument.version: 1` → `version: 1 | 2` with comment `/** 2 = slides may carry overlays; 1 accepted on import. */`
- [ ] **Step 2:** In `BriefingEngine.exportBriefing()` change `{ version: 1, ... }` → `{ version: 2, ... }` (import already accepts any — it only checks `Array.isArray(doc.slides)`).
- [ ] **Step 3:** Verify: filtered tsc shows no new errors in `Briefing/`.

---

### Task 2: `OverlayFabric.ts` — shared model ↔ fabric mapping

**Files:**
- Create: `MS/Engines/Briefing/OverlayFabric.ts`

**Interfaces:**
- Consumes: `SlideOverlay`, `OverlayKind` from `./BriefingTypes`.
- Produces (used by Tasks 3 & 4):
  ```ts
  export function overlayToFabric(o: SlideOverlay, W: number, H: number): any | null;
  export function fabricToOverlay(obj: any, W: number, H: number): SlideOverlay | null;
  export function makeArrowGroup(p0: {x:number;y:number}, p1: {x:number;y:number},
      stroke: string, strokeWidthPx: number, extra?: any): any; // fabric.Group, data.kind='arrow'
  export function overlayUuid(): string;
  export function withAlpha(hex: string, alpha: number): string;          // '#RRGGBB' → 'rgba(...)'
  export function parseColor(c: any): { hex: string; alpha: number } | null; // fabric fill/stroke → hex+alpha
  ```

Pure functions; fabric via `(window as any).fabric`; every fabric object created here carries `data: { id, kind }`.

- [ ] **Step 1:** Implement helpers (`overlayUuid` = same xxxx-4xxx pattern as `BriefingEngine._uuid`; `withAlpha`/`parseColor` handle `#RGB`, `#RRGGBB`, `rgb()/rgba()` strings).
- [ ] **Step 2:** Implement `overlayToFabric` — denormalization per kind (strokePx = `Math.max(1, (o.strokeWidth ?? 0.004) * H)`):
  - `text` → `fabric.Textbox(o.text, { left: o.x*W, top: o.y*H, width: max(20, o.w*W), fontSize: max(6,(o.fontSize ?? 0.03)*H), fontFamily, fontWeight: bold?'bold':'normal', fontStyle: italic?'italic':'normal', underline, textAlign: align??'left', fill: textColor??'#FFFFFF', angle: rotation??0, opacity, data })`
  - `rect` → `fabric.Rect({ left,top,width: o.w*W, height: o.h*H, fill: o.fill ? withAlpha(o.fill, o.fillOpacity??1) : '', stroke: o.stroke ?? '', strokeWidth: o.stroke ? strokePx : 0, angle, opacity, data })`
  - `ellipse` → `fabric.Ellipse({ left,top, rx: o.w*W/2, ry: o.h*H/2, ...same style })`
  - `line` → `fabric.Line([p0.x*W,p0.y*H,p1.x*W,p1.y*H], { stroke: o.stroke??'#FF3B30', strokeWidth: strokePx, opacity, data })` (null if <2 points)
  - `arrow` → `makeArrowGroup(denorm(p0), denorm(p1), stroke, strokePx, {opacity})`
  - `freehand` → `fabric.Polyline(points.map(denorm), { fill:'', stroke, strokeWidth: strokePx, opacity, data })`
- [ ] **Step 3:** Implement `makeArrowGroup`: `fabric.Line` + `fabric.Triangle` head (`width/height = strokeWidthPx*4 + 6`, `originX/Y:'center'`, positioned at p1, `angle = atan2(dy,dx)*180/π + 90`, fill = stroke), grouped; after grouping store center-relative endpoints for save:
  ```ts
  const c = grp.getCenterPoint();
  grp.data.localPoints = [{ x: p0.x - c.x, y: p0.y - c.y }, { x: p1.x - c.x, y: p1.y - c.y }];
  ```
- [ ] **Step 4:** Implement `fabricToOverlay` — normalization per kind, keyed off `obj.data.kind` (return null when absent):
  - Box kinds (`text`/`rect`/`ellipse`): `x=left/W, y=top/H, w=getScaledWidth()/W, h=getScaledHeight()/H, rotation=obj.angle||undefined, opacity`.
    - text: skip when `!String(obj.text).trim()`; `fontSize = obj.fontSize*(obj.scaleY??1)/H`; map fontWeight/fontStyle/underline/textAlign back; `textColor = parseColor(obj.fill)?.hex`.
    - rect/ellipse: `fill/fillOpacity` from `parseColor(obj.fill)`; `strokeWidth = obj.strokeWidth*((scaleX+scaleY)/2)/H` when stroked.
  - Point kinds (`line`/`arrow`/`freehand`) — rotation/scale baked into points via the transform matrix:
    ```ts
    const m = obj.calcTransformMatrix();
    const toAbs = (lx: number, ly: number) => {
      const p = fabric.util.transformPoint(new fabric.Point(lx, ly), m);
      return { x: p.x / W, y: p.y / H };
    };
    // line:  center-relative endpoints: cx=(x1+x2)/2, cy=(y1+y2)/2 → toAbs(x1-cx, y1-cy), toAbs(x2-cx, y2-cy)
    // arrow: obj.data.localPoints.map(p => toAbs(p.x, p.y))
    // freehand (Polyline): obj.points.map(p => toAbs(p.x - obj.pathOffset.x, p.y - obj.pathOffset.y))
    ```
    Then recompute `x/y/w/h` as the bbox of the normalized points, set `points`, `stroke`, `strokeWidth` as above.
- [ ] **Step 5:** Verify: filtered tsc — no new errors.

---

### Task 3: `SlideEditor.ts` — full-screen editor

**Files:**
- Create: `MS/Engines/Briefing/SlideEditor.ts`

**Interfaces:**
- Consumes: `overlayToFabric`, `fabricToOverlay`, `makeArrowGroup`, `overlayUuid`, `withAlpha` from `./OverlayFabric`; `Slide`, `SlideOverlay` from `./BriefingTypes`.
- Produces (Task 4 consumes):
  ```ts
  export interface SlideEditorHost {
    getSlide(index: number): Slide | null;
    /** Apply slide state headlessly and return a full-res screenshot dataUrl (null on failure). */
    prepareBackground(index: number): Promise<string | null>;
    onSaved(index: number, patch: {
      title: string;
      notes?: string;
      overlays?: SlideOverlay[];
      thumbnailDataUrl?: string;
    }): void;
  }
  export default class SlideEditor {
    static getInstance(): SlideEditor;
    isOpen(): boolean;
    open(host: SlideEditorHost, index: number): Promise<boolean>; // false: fabric missing / already open
    close(save: boolean): void;
  }
  ```

Singleton. Structure (single class, ~600 lines, injected styles `ms-sledit-*`):

- [ ] **Step 1: Stage + lifecycle.** `open()`: bail (return false, `EngineLogger.error`) when `!window.fabric` or already open. `await host.prepareBackground(index)`; build full-screen stage `div#msSlideEditor` (`position:fixed; inset:0; z-index:9700; background:#0d1117; display:flex; flex-direction:column`), toolbar on top, centered canvas area below. Canvas CSS/pixel size: load the screenshot in an `Image` to get natural size (fallback 1280×720 when null → also show a `ms-sledit-warn` banner "Screenshot unavailable — annotations still editable"), then scale to fit `(innerWidth-32) × (innerHeight-toolbar-32)` preserving aspect → `W×H`. Create `fabric.Canvas` (`preserveObjectStacking: true, selection: true`), `setBackgroundImage` scaled `W/img.width, H/img.height`. Load `slide.overlays ?? []` through `overlayToFabric(o, W, H)`, skipping nulls.
- [ ] **Step 2: Toolbar DOM.** One row, grouped (tools | text style | colors | arrange | title/notes | actions):
  ```html
  <div class="ms-sledit-bar">
    <span class="ms-sledit-tools">
      <button data-tool="select" class="active" title="Select / move / resize / rotate">⬚</button>
      <button data-tool="text" title="Add text box (click on slide)">T</button>
      <button data-tool="rect" title="Draw rectangle (drag)">▭</button>
      <button data-tool="ellipse" title="Draw ellipse (drag)">◯</button>
      <button data-tool="line" title="Draw line (drag)">╱</button>
      <button data-tool="arrow" title="Draw arrow (drag)">➔</button>
      <button data-tool="freehand" title="Freehand ink">✎</button>
    </span>
    <select class="ms-sledit-font"><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Courier New</option><option>Impact</option><option>Tahoma</option><option>Times New Roman</option><option>Verdana</option></select>
    <input type="number" class="ms-sledit-fontsize" min="8" max="120" step="1" value="28" title="Font size (px)">
    <button data-style="bold" title="Bold"><b>B</b></button>
    <button data-style="italic" title="Italic"><i>I</i></button>
    <button data-style="underline" title="Underline"><u>U</u></button>
    <select class="ms-sledit-align"><option value="left">⇤</option><option value="center">⇹</option><option value="right">⇥</option></select>
    <label>Fill <input type="color" class="ms-sledit-fill" value="#ffd166"></label>
    <input type="range" class="ms-sledit-fillop" min="0" max="100" value="35" title="Fill opacity %">
    <label>Line <input type="color" class="ms-sledit-stroke" value="#ff3b30"></label>
    <input type="number" class="ms-sledit-strokew" min="1" max="24" value="3" title="Line width (px)">
    <button data-act="front" title="Bring forward">⬆</button>
    <button data-act="back" title="Send backward">⬇</button>
    <button data-act="dup" title="Duplicate selection">⧉</button>
    <button data-act="del" title="Delete selection">🗑</button>
    <input type="text" class="ms-sledit-title" placeholder="Slide title">
    <button data-act="notes" title="Toggle speaker notes">📝</button>
    <button data-act="save" class="primary">Save &amp; Close</button>
    <button data-act="cancel">Cancel</button>
  </div>
  <textarea class="ms-sledit-notes" placeholder="Speaker notes…" style="display:none"></textarea>
  ```
  Title input seeded from `slide.title`, notes from `slide.notes`.
- [ ] **Step 3: Tools.** `_setTool(name)` toggles `.active`, sets `canvas.isDrawingMode = (name==='freehand')` (PencilBrush `color = stroke, width = strokeWidthPx`), `canvas.selection = (name==='select')`. Handlers:
  - `text`: on `mouse:down` (when tool=text, no target) add `fabric.Textbox('Text', { left, top, width: 200, fontSize, fontFamily, fill: textColor(default '#ffffff'), ...styles, data:{id: overlayUuid(), kind:'text'} })`, `setActiveObject`, `enterEditing()+selectAll()`, revert to select tool.
  - `rect`/`ellipse`/`line`/`arrow`: drag-to-draw on `mouse:down/move/up` — create at down with zero size (`fill: withAlpha(fillHex, fillOp)` for rect/ellipse; `''` for line), update dims/endpoints on move, on up: discard if degenerate (<4px), arrow: replace the preview `fabric.Line` with `makeArrowGroup(p0, p1, stroke, strokeWidthPx)`; revert to select tool. Each object gets `data:{id: overlayUuid(), kind}`.
  - `freehand`: on `path:created` replace the `fabric.Path` with a `fabric.Polyline` (sample each command's trailing x,y pair: `for cmd of path.path: if (cmd.length>=3) pts.push({x:cmd[cmd.length-2], y:cmd[cmd.length-1]})`), `fill:''`, current stroke style, `data:{id, kind:'freehand'}`; remove the Path.
- [ ] **Step 4: Style controls ↔ selection.** On `selection:created/updated` populate controls from the active object (font fields only meaningful for text; fill for rect/ellipse; stroke for all shape kinds). On control `input/change`: if there's an active object apply to it (`set(...)` + `requestRenderAll`), else update `_defaults`. Bold/italic/underline buttons toggle. For arrow groups apply stroke/opacity to child objects (`grp.getObjects().forEach(child => child.set(...))` — triangle gets `fill: stroke`).
- [ ] **Step 5: Keys + arrange.** Capture-phase `keydown` on document while open (mirror present-mode pattern — `stopPropagation` + `preventDefault` on handled keys): `Escape` → if a Textbox is in editing mode exit editing, else `close(false)`; `Delete`/`Backspace` (not while text-editing / focus in toolbar inputs) → remove active objects. Arrange buttons: `bringForward` / `sendBackwards` / duplicate via `obj.clone(c => { c.set({left: left+16, top: top+16}); c.data = {id: overlayUuid(), kind: obj.data.kind}; if (kind==='arrow') c.data.localPoints = obj.data.localPoints; canvas.add(c); })` / delete.
- [ ] **Step 6: Save/close.** `close(save)`:
  - save=true: `overlays = canvas.getObjects().map(o => fabricToOverlay(o, W, H)).filter(Boolean)`; thumbnail = `canvas.toDataURL({ format:'jpeg', quality:0.72, multiplier: 240/W })` (composites background + annotations); `host.onSaved(index, { title: titleInput.value.trim() || slide.title, notes: notesArea.value.trim() || undefined, overlays: overlays.length ? overlays : undefined, thumbnailDataUrl })`.
  - always: dispose fabric canvas, remove stage + key handler, null refs.
- [ ] **Step 7:** Verify: filtered tsc — no new errors; `node node_modules/vite/bin/vite.js build` green.

---

### Task 4: BriefingEngine wiring (✎ / dbl-click, host, present-mode overlays)

**Files:**
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: `SlideEditor`, `SlideEditorHost` (dynamic import `'./SlideEditor'`); `overlayToFabric` (static import `'./OverlayFabric'`).
- Produces: `public openSlideEditor(ref: number | string): Promise<void>` (Task 6 consumes via `window.briefingEngine`).

- [ ] **Step 1: `openSlideEditor` + host.**
  ```ts
  public async openSlideEditor(ref: number | string): Promise<void> {
    const idx = this._slideIndex(ref);
    if (idx < 0 || !this._enabled) return;
    this.exitPresent(); // editor and present mode are mutually exclusive
    const { default: SlideEditor } = await import('./SlideEditor');
    const editor = SlideEditor.getInstance();
    if (editor.isOpen()) return;
    this._slideEditor = editor;
    await editor.open(
      {
        getSlide: (i) => this._slides[i] ?? null,
        prepareBackground: async (i) => {
          await this.applySlideForExport(i);
          await this._settleView();
          return (await this._tryFullScreenshot()) ?? null;
        },
        onSaved: (i, patch) => {
          const s = this._slides[i];
          if (!s) return;
          s.title = patch.title;
          s.notes = patch.notes;
          s.overlays = patch.overlays;
          if (patch.thumbnailDataUrl) s.thumbnailDataUrl = patch.thumbnailDataUrl;
          this._refreshStrip();
          EngineLogger.success(ENGINE_NAME, `Slide "${s.title}" saved (${patch.overlays?.length ?? 0} annotations)`);
        },
      },
      idx,
    );
  }
  ```
  `_slideEditor: any = null` field; `onViewChanged` and `disable()` additionally call `this._slideEditor?.close(false)`.
- [ ] **Step 2: helpers.** `_tryFullScreenshot()` — clone of `_tryThumbnail` with `width: min(view.width*dpr, 1920)` (keep aspect), `8000`ms race timeout. `_settleView()` — bounded settle identical in shape to `PptxExporter._settle` (watch `updating===false`, 1500ms timer fallback).
- [ ] **Step 3: strip tile.** In `_refreshStrip()` add before the delete button:
  ```html
  <button class="ms-briefing-tile-edit" title="Edit slide — text, shapes, arrows, colors.">✎</button>
  ```
  Click handler gains `if (closest('.ms-briefing-tile-edit')) { void this.openSlideEditor(i); return; }`. Replace the dblclick prompt-rename body with `void this.openSlideEditor(i)`. Tile tooltip line becomes `(click: go to · dblclick/✎: edit)`. CSS: copy `.ms-briefing-tile-del` block as `.ms-briefing-tile-edit` with `right: 22px; color: #9ecbff;`.
- [ ] **Step 4: present-mode overlays.** Field `_presentOverlay: { el: HTMLCanvasElement; canvas: any } | null`. After `_runBuilds(slide)` in `goToSlide`: `this._presentMode ? this._renderPresentOverlays(slide) : this._clearPresentOverlays()`. Also clear at the TOP of `goToSlide` (before the transition), in `exitPresent`, `onViewChanged`, `disable`, and `applySlideForExport`.
  ```ts
  private _renderPresentOverlays(slide: Slide): void {
    this._clearPresentOverlays();
    const fabric = (window as any).fabric;
    const v: any = this._view;
    if (!fabric || !v?.container || !slide.overlays?.length) return;
    const el = document.createElement('canvas');
    el.className = 'ms-briefing-overlay-canvas';
    v.container.appendChild(el);
    const sc = new fabric.StaticCanvas(el, { width: v.width, height: v.height });
    for (const o of slide.overlays) {
      const obj = overlayToFabric(o, v.width, v.height);
      if (obj) sc.add(obj);
    }
    sc.renderAll();
    this._presentOverlay = { el, canvas: sc };
  }
  private _clearPresentOverlays(): void {
    if (!this._presentOverlay) return;
    try { this._presentOverlay.canvas.dispose(); } catch {}
    this._presentOverlay.el.remove();
    this._presentOverlay = null;
  }
  ```
  CSS added to `_injectStyles`: `.ms-briefing-overlay-canvas, .ms-briefing-overlay-canvas + .canvas-container { position:absolute; inset:0; pointer-events:none; z-index:40; }` (StaticCanvas doesn't wrap, but keep the sibling rule harmlessly in case of fabric version drift).
- [ ] **Step 5:** Verify: filtered tsc + vite build green.

---

### Task 5: PPTX — emit overlays as native objects

**Files:**
- Modify: `MS/Engines/ImportExport/PptxExporter.ts`

**Interfaces:**
- Consumes: `SlideOverlay` type from `../Briefing/BriefingTypes`; existing `ContainFit`, `EngineLogger`.
- Produces: overlays render in every export mode; no API change.

- [ ] **Step 1:** `_addSlide` meta gains `overlays?: readonly SlideOverlay[]`. In `exportDeck`, pass `overlays: slide.overlays` in BOTH the explode-builds and the plain branch (the no-briefing fallback passes none). After the `_emitShapes` call (and before the title block) add:
  ```ts
  if (meta.overlays?.length) this._emitOverlays(slide, meta.overlays, fit);
  ```
- [ ] **Step 2:** Emission — z-order stays raster → Mode B shapes → overlays → title:
  ```ts
  private _emitOverlays(slide: any, overlays: readonly SlideOverlay[], fit: ContainFit): void {
    let emitted = 0;
    for (const o of overlays) {
      try {
        if (o.kind === 'text') this._emitOverlayText(slide, o, fit);
        else if (o.kind === 'rect' || o.kind === 'ellipse') this._emitOverlayBox(slide, o, fit);
        else this._emitOverlayPath(slide, o, fit); // line | arrow | freehand
        emitted++;
      } catch (err) {
        EngineLogger.error(ENGINE_NAME, `Annotation emit failed: ${err}`);
      }
    }
    if (emitted) EngineLogger.success(ENGINE_NAME, `Slide annotations — ${emitted} native objects`);
  }
  ```
  Shared helpers inside the class:
  ```ts
  private _ovStrokePt(o: SlideOverlay, fit: ContainFit): number {
    return Math.max(0.25, Math.round((o.strokeWidth ?? 0.004) * fit.h * 72 * 4) / 4);
  }
  private _ovHex(c: string | undefined, fallback: string): string {
    return (c ?? fallback).replace('#', '').toUpperCase();
  }
  private _ovRotate(o: SlideOverlay): number | undefined {
    if (!o.rotation) return undefined;
    return ((Math.round(o.rotation) % 360) + 360) % 360;
  }
  ```
  Text:
  ```ts
  private _emitOverlayText(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const fontPt = Math.min(96, Math.max(6, Math.round((o.fontSize ?? 0.03) * fit.h * 72)));
    slide.addText(o.text ?? '', {
      x: fit.x + o.x * fit.w, y: fit.y + o.y * fit.h,
      w: Math.max(0.2, o.w * fit.w), h: Math.max(0.2, o.h * fit.h),
      fontSize: fontPt, fontFace: o.fontFamily || 'Arial',
      bold: !!o.bold, italic: !!o.italic,
      underline: o.underline ? { style: 'sng' } : undefined,
      color: this._ovHex(o.textColor, 'FFFFFF'),
      align: o.align ?? 'left', valign: 'top', margin: 0,
      rotate: this._ovRotate(o),
      transparency: o.opacity != null && o.opacity < 1 ? Math.round((1 - o.opacity) * 100) : undefined,
    });
  }
  ```
  Rect/ellipse (opacity folds into both fills):
  ```ts
  private _emitOverlayBox(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const alpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    slide.addShape(o.kind === 'rect' ? 'rect' : 'ellipse', {
      x: fit.x + o.x * fit.w, y: fit.y + o.y * fit.h,
      w: Math.max(0.02, o.w * fit.w), h: Math.max(0.02, o.h * fit.h),
      fill: o.fill
        ? { color: this._ovHex(o.fill, 'FFD166'), transparency: Math.round((1 - alpha) * 100) }
        : { color: 'FFFFFF', transparency: 100 },
      line: o.stroke
        ? { color: this._ovHex(o.stroke, 'FF3B30'), width: this._ovStrokePt(o, fit),
            transparency: Math.round((1 - (o.opacity ?? 1)) * 100) }
        : { color: 'FFFFFF', width: 0.5, transparency: 100 },
      rotate: this._ovRotate(o),
    });
  }
  ```
  Line/arrow/freehand — same custGeom pattern as `_emitPathShape`, plus arrowhead:
  ```ts
  private _emitOverlayPath(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const pts = (o.points ?? []).map((p) => ({ x: fit.x + p.x * fit.w, y: fit.y + p.y * fit.h }));
    if (pts.length < 2) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                           maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    slide.addShape('custGeom', {
      x: minX, y: minY, w: Math.max(0.02, maxX - minX), h: Math.max(0.02, maxY - minY),
      points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      fill: { color: 'FFFFFF', transparency: 100 },
      line: {
        color: this._ovHex(o.stroke, 'FF3B30'), width: this._ovStrokePt(o, fit),
        transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
        endArrowType: o.kind === 'arrow' ? 'triangle' : undefined,
      },
    });
  }
  ```
- [ ] **Step 3:** Verify: filtered tsc + vite build green.

---

### Task 6: Palette action + API-panel button (harness sync)

**Files:**
- Modify: `MS/Engines/BriefingSettingsWidget.ts`
- Modify: `index.html`

- [ ] **Step 1:** Append to the `CommandPalette.registerActions([...])` array in `BriefingSettingsWidget.ts`:
  ```ts
  {
    id: 'briefing.editSlide',
    label: 'Briefing: edit current slide',
    hint: 'Full-screen slide editor — text, shapes, arrows, colors',
    keywords: ['edit', 'annotate', 'slide', 'text', 'shapes', 'arrow', 'briefing', 'editor'],
    run: () => {
      const be = (window as any).briefingEngine;
      if (!be) return;
      const idx = typeof be.currentIndex === 'number' && be.currentIndex >= 0 ? be.currentIndex : 0;
      void be.openSlideEditor?.(idx);
    },
  },
  ```
- [ ] **Step 2:** `index.html` — next to `<button ... id="api-export-pptx">` (line ~3382) add:
  ```html
  <button class="ms-btn" id="api-briefing-edit" title="Open the full-screen slide editor for the current briefing slide (requires Briefing in Settings and at least one captured slide).">Edit Slide</button>
  ```
  Next to the `api-export-pptx` handler (line ~4994) add:
  ```js
  document
    .getElementById('api-briefing-edit')
    ?.addEventListener('click', () => {
      const be = window.briefingEngine;
      if (!be || !be.getSlides?.().length) {
        console.warn('Briefing: no slides captured yet (enable features.briefing and press ＋ Capture)');
        return;
      }
      be.openSlideEditor(Math.max(0, be.currentIndex));
    });
  ```
- [ ] **Step 3:** Verify: `node node_modules/vite/bin/vite.js build` green; filtered tsc clean for all touched files.

---

### Task 7: Final verification

- [ ] **Step 1:** `node node_modules/vite/bin/vite.js build` — Expected: `✓ built`.
- [ ] **Step 2:** `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "Briefing|OverlayFabric|SlideEditor|PptxExporter"` — Expected: nothing beyond the pre-existing baseline (TS2307 @arcgis lines excluded).
- [ ] **Step 3: Manual GUI checklist (user-run `npm run dev`):**
  1. Enable Briefing + Export Tools → capture 2 slides (2D).
  2. ✎ / double-click tile → editor opens over frozen screenshot; add every kind (text w/ font+color+B/I/U, rect w/ fill opacity, ellipse, line, arrow, freehand); move/resize/rotate; Delete key removes; Esc cancels without saving.
  3. Save & Close → tile thumbnail shows annotations; reopen → objects round-trip in place.
  4. Present mode → annotations render over the live map on that slide, clear on next slide, gone after Esc.
  5. Save deck JSON → reload deck → overlays intact (version 2; also load a pre-change v1 deck → no errors).
  6. Export PPTX flat + editable + explode-builds → open in PowerPoint: annotations are selectable native objects ABOVE map content, positioned as in the editor; arrows have heads; text fonts/colors correct.
  7. 3D scene: capture → edit (screenshot may fall back to placeholder in headless; in a real browser it renders) → export flat → annotations present.
