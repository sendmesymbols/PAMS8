import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';

import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import AnnotationEngine from './AnnotationEngine.ts';
import SelectionEngine from './SelectionEngine.ts';
import GeoTools from '../Support/GeoTools.ts';
import DrawEssentials from '../Support/DrawEssentials.ts';
import EngineLogger from '../Support/EngineLogger';
import settingsData from '../Data/Settings.json';

interface UndoEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface ClonedSymbol {
  graphic: Graphic;
  layer: GraphicsLayer;
  id: string;
  undo: () => void;
  redo: () => void;
}

interface ClipItem {
  graphic: Graphic;
  layerId: string;
}

export interface CloneSource {
  graphic: Graphic;
  layerId: string;
}

export interface ClipboardEngineDeps {
  getView: () => MapView | SceneView;
  layerManager: GraphicsLayerManager;
  getSelectionEngine: () => SelectionEngine;
  pushUndo: (entry: UndoEntry) => void;
  closeActiveWorkflow: () => void;
  emitEvent: (eventName: string, data: any) => void;
  getLabelOptions: () => any;
}

/**
 * Owns the copy/paste clipboard and all related geometry transforms.
 * Extracted from SymbolEngine to keep that class focused on coordination.
 * SymbolEngine retains the public copySymbol / pasteSymbol / hasClipboard /
 * paste-mode methods as thin delegates so existing call sites are unchanged.
 */
export default class ClipboardEngine {
  private _clipboard: ClipItem[] | null = null;

  constructor(private readonly deps: ClipboardEngineDeps) {}

  private get view(): MapView | SceneView {
    return this.deps.getView();
  }

  public get hasClipboard(): boolean {
    return this._clipboard !== null;
  }

  public get clipboardLength(): number {
    return this._clipboard?.length ?? 0;
  }

  public rewireLayerManager(layerManager: GraphicsLayerManager): void {
    (this.deps as any).layerManager = layerManager;
  }

  /** Drop any held items — used when the clipboard feature is disabled. */
  public clear(): void {
    this.cancelPasteMode();
    this._clipboard = null;
  }

  public copy(graphic: Graphic): void {
    if ((settingsData as any).features?.clipboard === false) return;
    const sel = this.deps.getSelectionEngine();
    const toCopy =
      sel.isSelected(graphic) && sel.count > 1
        ? sel.selectedGraphics
        : [graphic];
    const fallbackLayerId = this.deps.layerManager.getSymbolLayer().id;
    const clipboard: ClipItem[] = toCopy.map((g) => {
      // resolveLive verifies layer membership and survives collab swapping the
      // Graphic instance; `origin.layer` is unset/stale for plain graphics, which
      // used to drop pasted tactical lines/areas onto the default symbol layer.
      const live = sel.resolveLive(g);
      return {
        graphic: (live?.graphic ?? g).clone(),
        layerId: String(live?.layer?.id ?? fallbackLayerId),
      };
    });
    this._clipboard = clipboard;
    EngineLogger.nextStep(
      'Symbol Engine',
      `${clipboard.length} symbol${clipboard.length !== 1 ? 's' : ''} copied — click the map to paste`,
    );
    this.deps.emitEvent('symbolCopied', { graphic, count: clipboard.length });
    // Attach the paste hint to the cursor straight away.
    this._armPasteMode(0, 'meters', true);
  }

  /**
   * Paste the clipboard around `targetPoint`. Every item moves as a rigid
   * translation: a single item lands centred on the target, a group keeps its
   * relative layout with the collective centroid on the target. `expandDistance`
   * (groups only) pushes each item's centre away from / toward the target.
   */
  public paste(
    targetPoint: Point,
    expandDistance: number = 0,
    expandUnit: string = 'meters',
  ): Graphic | null {
    const clip = this._clipboard;
    if (!clip || clip.length === 0) return null;

    const anchor =
      clip.length === 1
        ? this._geometryCenter(clip[0].graphic.geometry)
        : this._clipboardCentroid();
    const spread = clip.length > 1 && expandDistance !== 0;

    const jobs = clip.map((item) => {
      const c = this._geometryCenter(item.graphic.geometry);
      let dx = targetPoint.x + (c.x - anchor.x) - c.x;
      let dy = targetPoint.y + (c.y - anchor.y) - c.y;
      if (spread) {
        // Move the item's centre as a whole — moving each vertex on its own
        // bearing would distort lines and polygons.
        const bx = c.x + dx;
        const by = c.y + dy;
        if (
          Math.abs(bx - targetPoint.x) > 1e-10 ||
          Math.abs(by - targetPoint.y) > 1e-10
        ) {
          const bearing = this._computeBearing(targetPoint.x, targetPoint.y, bx, by);
          const moved = GeoTools.destination(
            new Point({ x: bx, y: by, spatialReference: targetPoint.spatialReference }),
            Math.abs(expandDistance),
            expandDistance >= 0 ? bearing : (bearing + 180) % 360,
            expandUnit,
          );
          dx = moved.x - c.x;
          dy = moved.y - c.y;
        }
      }
      return {
        item,
        dx,
        dy,
        geometry: this._translateGeometry(
          item.graphic.geometry,
          dx,
          dy,
          targetPoint.z,
        ),
      };
    });

    const pasted = this._commit(jobs, (n) =>
      n === 1 ? 'Paste Symbol' : `Paste ${n} Symbols`,
    );
    return pasted[0] ?? null;
  }

  public buildClone(source: Graphic, layerId: string): ClonedSymbol | null {
    const newGeom = source.geometry?.clone?.();
    if (!newGeom) return null;

    const annotationLayer = this.deps.layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    const built = this._buildPastedGraphic(
      { graphic: source, layerId },
      newGeom,
      annotationLayer,
      0,
      0,
    );
    return {
      ...built,
      layer: this._layerFor(layerId),
      id: String(built.graphic.attributes?.id ?? ''),
    };
  }

  public buildClones(sources: CloneSource[]): ClonedSymbol[] | null {
    const clones: ClonedSymbol[] = [];

    for (const source of sources) {
      const clone = this.buildClone(source.graphic, source.layerId);
      if (!clone) {
        clones.forEach((item) => item.undo());
        return null;
      }
      clones.push(clone);
    }

    return clones;
  }

  /**
   * Duplicate the given graphics in place at a small offset — the one-step
   * "make another one" (Ctrl+D). Shares the paste builder/commit path, but
   * sources from the passed graphics and does NOT touch the clipboard.
   */
  public duplicate(sources: CloneSource[], offsetPx: number = 18): Graphic[] | null {
    if (!sources || sources.length === 0) return null;

    // A small, zoom-independent nudge (right + down). Prefer a screen-pixel offset
    // from the map resolution; fall back to a fraction of the symbol's size.
    let d = 0;
    const res = (this.deps.getView() as any).resolution;
    if (typeof res === 'number' && res > 0) {
      d = res * offsetPx;
    } else {
      const ext = sources[0].graphic.geometry?.extent;
      const size = ext ? Math.max(ext.width, ext.height) : 0;
      d = size > 0 ? size * 0.12 : 1000;
    }

    const pasted = this._commit(
      sources.map((src) => ({
        item: { graphic: src.graphic, layerId: src.layerId },
        dx: d,
        dy: -d, // +x right, -y down
        geometry: this._translateGeometry(src.graphic.geometry, d, -d),
      })),
      (n) => `Duplicate ${n} Symbol${n !== 1 ? 's' : ''}`,
    );
    return pasted.length ? pasted : null;
  }

  /**
   * Build, add (batched per layer), announce and register one undo step for a
   * set of pasted/duplicated graphics. Shared by paste() and duplicate().
   */
  private _commit(
    jobs: Array<{ item: ClipItem; geometry: any; dx: number; dy: number }>,
    label: (n: number) => string,
  ): Graphic[] {
    const annotationLayer = this.deps.layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    const pasted: Graphic[] = [];
    const undos: Array<() => void> = [];
    const redos: Array<() => void> = [];
    const byLayer = new Map<GraphicsLayer, Graphic[]>();

    for (const job of jobs) {
      if (!job.geometry) continue;
      const built = this._buildPastedGraphic(
        job.item,
        job.geometry,
        annotationLayer,
        job.dx,
        job.dy,
      );
      const layer = this._layerFor(job.item.layerId);
      const bucket = byLayer.get(layer);
      if (bucket) bucket.push(built.graphic);
      else byLayer.set(layer, [built.graphic]);
      pasted.push(built.graphic);
      undos.push(built.undo);
      redos.push(built.redo);
    }
    if (pasted.length === 0) return pasted;

    byLayer.forEach((graphics, layer) => layer.addMany(graphics));

    this.deps.pushUndo({
      label: label(pasted.length),
      undo: () => undos.forEach((fn) => fn()),
      redo: () => redos.forEach((fn) => fn()),
    });
    this.deps.emitEvent('symbolPasted', {
      graphic: pasted[0],
      graphics: pasted,
      count: pasted.length,
    });
    return pasted;
  }

  private _layerFor(layerId: string): GraphicsLayer {
    return (
      this.deps.layerManager.getOrCreateLayer(layerId) ??
      this.deps.layerManager.getSymbolLayer()
    );
  }

  /** Translate a geometry by (dx, dy) map units, keeping z/m. `z` (if given)
   *  overrides a point's elevation. Handles typed ArcGIS geometries and plain
   *  {x,y} objects. */
  private _translateGeometry(geom: any, dx: number, dy: number, z?: number): any {
    if (!geom) return null;
    try {
      const g = geom.clone?.() ?? { ...geom };
      if (g.type === 'point' || ('x' in g && 'y' in g && !g.paths && !g.rings)) {
        g.x += dx;
        g.y += dy;
        if (z !== undefined) g.z = z;
        return g;
      }
      const shift = (coords: number[][]) =>
        coords.map((c) => [c[0] + dx, c[1] + dy, ...c.slice(2)]);
      if (g.type === 'polyline' && Array.isArray(g.paths)) g.paths = g.paths.map(shift);
      else if (g.type === 'polygon' && Array.isArray(g.rings)) g.rings = g.rings.map(shift);
      return g;
    } catch {
      return geom.clone?.() ?? geom;
    }
  }

  private _geometryCenter(geom: any): { x: number; y: number } {
    if (!geom) return { x: 0, y: 0 };
    if (geom.type === 'point') return { x: geom.x, y: geom.y };
    const ext = geom.extent;
    return ext
      ? { x: (ext.xmin + ext.xmax) / 2, y: (ext.ymin + ext.ymax) / 2 }
      : { x: 0, y: 0 };
  }

  public showPasteOffsetDialog(): void {
    if (!this._clipboard || this._clipboard.length === 0) {
      console.warn('[CopyPaste] Clipboard is empty.');
      return;
    }
    this.cancelPasteMode(); // drop the armed hint while the dialog is open

    let dialog = document.getElementById('pasteOffsetDialog');
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = 'pasteOffsetDialog';
      dialog.style.cssText = `
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(30, 35, 45, 0.95); border: 1px solid rgba(100, 160, 230, 0.4);
        padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        z-index: 1000; color: #dce8f5; font-family: 'Courier New', monospace; min-width: 320px;
      `;

      dialog.innerHTML = `
        <h3 style="margin: 0 0 15px 0; color: #64b4ff; font-size: 16px; border-bottom: 1px solid rgba(100, 160, 230, 0.25); padding-bottom: 8px;">Paste Offset</h3>

        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px;">Location Mode:</label>
          <select id="poMode" style="width: 100%; padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px;">
            <option value="exact">Exact Location</option>
            <option value="offset">Direction & Offset</option>
            <option value="center">Pick Center Point</option>
          </select>
        </div>

        <div id="poOffsetGroup" style="display: none; margin-bottom: 15px;">
          <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 5px;">Distance:</label>
              <input type="number" id="poDistance" value="0" style="width: 100%; padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px; box-sizing: border-box;" />
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 5px;">Unit:</label>
              <select id="poUnit" style="width: 100%; padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px;">
                <option value="meters">Meters</option>
                <option value="kilometers">Kilometers</option>
                <option value="miles">Miles</option>
              </select>
            </div>
          </div>
          <div>
            <label style="display: block; margin-bottom: 5px;">Direction:</label>
            <select id="poDirection" style="width: 100%; padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px;">
              <option value="0">North (0°)</option>
              <option value="45">North East (45°)</option>
              <option value="90">East (90°)</option>
              <option value="135">South East (135°)</option>
              <option value="180">South (180°)</option>
              <option value="225">South West (225°)</option>
              <option value="270">West (270°)</option>
              <option value="315">North West (315°)</option>
            </select>
          </div>
        </div>

        <div style="margin-bottom: 15px;">
          <label style="display: block; margin-bottom: 5px;">Expand / Contract Distance:</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="number" id="poExpandDist" step="0.1" value="0" style="flex: 1; padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px; box-sizing: border-box;" />
            <select id="poExpandUnit" style="padding: 5px; background: rgba(18, 22, 32, 0.9); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px;">
              <option value="meters">m</option>
              <option value="kilometers">km</option>
              <option value="miles">mi</option>
              <option value="nautical-miles">nm</option>
            </select>
          </div>
          <small style="color: #a0b8d8; font-size: 10px; display: block; margin-top: 4px;">&gt; 0 spreads symbols out · &lt; 0 contracts them · only affects multi-symbol paste</small>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
          <button id="poCancel" style="padding: 6px 15px; background: rgba(100, 160, 230, 0.2); color: #dce8f5; border: 1px solid rgba(100, 160, 230, 0.4); border-radius: 4px; cursor: pointer;">Cancel</button>
          <button id="poApply" style="padding: 6px 15px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer;">Paste</button>
        </div>
      `;
      document.body.appendChild(dialog);

      const modeSelect = document.getElementById('poMode') as HTMLSelectElement;
      const offsetGroup = document.getElementById(
        'poOffsetGroup',
      ) as HTMLDivElement;
      const applyBtn = document.getElementById('poApply') as HTMLButtonElement;

      modeSelect.addEventListener('change', () => {
        if (modeSelect.value === 'offset') {
          offsetGroup.style.display = 'block';
        } else {
          offsetGroup.style.display = 'none';
        }
        applyBtn.innerText =
          modeSelect.value === 'center' ? 'Pick & Paste' : 'Paste';
      });

      document.getElementById('poCancel')!.addEventListener('click', () => {
        dialog!.style.display = 'none';
      });

      applyBtn.addEventListener('click', () => {
        dialog!.style.display = 'none';
        const mode = modeSelect.value;
        const expandDist =
          parseFloat(
            (document.getElementById('poExpandDist') as HTMLInputElement).value,
          ) || 0;
        const expandUnit = (
          document.getElementById('poExpandUnit') as HTMLSelectElement
        ).value;

        if (mode === 'exact') {
          const centroid = this._clipboardCentroid();
          this.paste(
            new Point({
              x: centroid.x,
              y: centroid.y,
              spatialReference: this.view.spatialReference,
            }),
            expandDist,
            expandUnit,
          );
        } else if (mode === 'offset') {
          const distance =
            parseFloat(
              (document.getElementById('poDistance') as HTMLInputElement).value,
            ) || 0;
          const unit = (
            document.getElementById('poUnit') as HTMLSelectElement
          ).value;
          const bearing =
            parseFloat(
              (document.getElementById('poDirection') as HTMLSelectElement)
                .value,
            ) || 0;

          const centroid = this._clipboardCentroid();
          const p = new Point({
            x: centroid.x,
            y: centroid.y,
            spatialReference: this.view.spatialReference,
          });
          const targetPoint = GeoTools.destination(p, distance, bearing, unit);
          this.paste(targetPoint, expandDist, expandUnit);
        } else if (mode === 'center') {
          this.activatePasteModeWithOffset(expandDist, expandUnit);
        }
      });
    }

    (document.getElementById('poMode') as HTMLSelectElement).value = 'exact';
    (document.getElementById('poOffsetGroup') as HTMLDivElement).style.display =
      'none';
    (document.getElementById('poDistance') as HTMLInputElement).value = '0';
    (document.getElementById('poExpandDist') as HTMLInputElement).value = '0';
    (document.getElementById('poExpandUnit') as HTMLSelectElement).value =
      'meters';
    (document.getElementById('poApply') as HTMLButtonElement).innerText =
      'Paste';
    dialog.style.display = 'block';
  }

  /** Cleanup for an armed paste mode (its click + keydown listeners), so it can be
   *  cancelled on view switch / workflow close instead of leaking when the user
   *  never clicks or presses Esc. */
  private _pasteCleanup: (() => void) | null = null;

  public activatePasteModeWithOffset(
    expandDistance: number,
    expandUnit: string,
  ): void {
    this._armPasteMode(expandDistance, expandUnit);
  }

  public activatePasteMode(): void {
    this._armPasteMode(0, 'meters');
  }

  /** One-shot paste mode: the next map click pastes there, Esc cancels. A hint
   *  tooltip follows the cursor until the paste (or cancel). */
  private _armPasteMode(
    expandDistance: number,
    expandUnit: string,
    quiet = false,
  ): void {
    if (!this._clipboard) return;

    this.cancelPasteMode(); // tear down any prior arming first
    this.deps.closeActiveWorkflow();
    this.deps.emitEvent('pasteMode', { active: true });
    if (!quiet) {
      EngineLogger.nextStep(
        'Symbol Engine',
        'Paste mode active — click the map to place the copied symbol(s). Press Esc to cancel',
      );
    }

    const container = this.view.container as HTMLElement | null;
    const tip = document.createElement('div');
    tip.textContent = 'Click to Paste, or CTRL+SHIFT+V for more options';
    tip.style.cssText = `
      position: absolute; display: none; pointer-events: none; z-index: 1000;
      padding: 4px 8px; border-radius: 4px; white-space: nowrap;
      background: rgba(30, 35, 45, 0.92); color: #dce8f5;
      border: 1px solid rgba(100, 160, 230, 0.4); font: 12px 'Courier New', monospace;
    `;
    container?.appendChild(tip);
    const moveHandle = this.view.on('pointer-move', (evt) => {
      tip.style.left = `${evt.x + 16}px`;
      tip.style.top = `${evt.y + 16}px`;
      tip.style.display = 'block';
    });
    const leaveHandle = this.view.on('pointer-leave', () => {
      tip.style.display = 'none';
    });

    const cleanup = () => {
      clickHandle.remove();
      moveHandle.remove();
      leaveHandle.remove();
      tip.remove();
      document.removeEventListener('keydown', keyHandler);
      this._pasteCleanup = null;
    };
    const clickHandle = this.view.on('click', (evt) => {
      cleanup();
      const pt = this.view.toMap({ x: evt.x, y: evt.y });
      if (pt) this.paste(pt, expandDistance, expandUnit);
      this.deps.emitEvent('pasteMode', { active: false });
    });
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        this.deps.emitEvent('pasteMode', { active: false });
      }
    };
    document.addEventListener('keydown', keyHandler);
    this._pasteCleanup = cleanup;
  }

  /** Cancel an armed paste mode so its click + keydown listeners don't leak when
   *  the user switches view or closes the workflow without clicking / pressing Esc. */
  public cancelPasteMode(): void {
    if (!this._pasteCleanup) return;
    this._pasteCleanup();
    this.deps.emitEvent('pasteMode', { active: false });
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private _shiftDrawEssentials(de: any, dx: number, dy: number): any {
    if (!de) return de;
    // Build a real DrawEssentials INSTANCE (not a plain `{ ...de }` object).
    // Symbol classes stash a live back-reference to themselves in `de.SCOPE`
    // (e.g. `MainAttack`). A DrawEssentials instance has a clone() method, so
    // ArcGIS's structural clone (Graphic.clone → tryClone) calls clone() and
    // copies SCOPE by reference. A *plain* object has no clone(), so tryClone
    // recurses into SCOPE and reconstructs the symbol via `new SymbolClass()`
    // with no view — crashing in GraphicsLayerManager.getInstance when a pasted
    // symbol is later copied. Keeping the prototype preserves edit-on-paste,
    // which reads `de.SCOPE.createSymbol()`.
    const result: any = new DrawEssentials(de);
    const tGeom = (geom: any) => this._translateGeometry(geom, dx, dy);
    if (de.CTRL_PTS) result.CTRL_PTS = de.CTRL_PTS.map(tGeom);
    if (de.BASE_LN_PTS) {
      result.BASE_LN_PTS = {
        startPt: tGeom(de.BASE_LN_PTS.startPt),
        midPt: tGeom(de.BASE_LN_PTS.midPt),
        endPt: tGeom(de.BASE_LN_PTS.endPt),
      };
    }
    if (de.GEOM) result.GEOM = tGeom(de.GEOM);
    if (de.OPTIONS?.GEOM) {
      result.OPTIONS = { ...de.OPTIONS, GEOM: tGeom(de.OPTIONS.GEOM) };
    }
    return result;
  }

  private _buildPastedGraphic(
    item: ClipItem,
    newGeom: any,
    annotationLayer: GraphicsLayer,
    dx: number,
    dy: number,
  ): { graphic: Graphic; undo: () => void; redo: () => void } {
    const source = item.graphic;
    const shiftedDe = this._shiftDrawEssentials(
      source.attributes?.drawEssentials,
      dx,
      dy,
    );
    const newId = ClipboardEngine.generateUUID();

    // Clone the source's data attributes WITHOUT `drawEssentials`: that key holds a
    // DrawEssentials instance whose SCOPE back-references the live symbol/view
    // (circular via ArcGIS handles/observers), so JSON.stringify throws on it. We
    // replace drawEssentials with the freshly-shifted `shiftedDe` below anyway.
    const { drawEssentials: _omitDe, ...restAttrs } = (source.attributes ??
      {}) as Record<string, any>;
    let clonedAttrs: Record<string, any>;
    try {
      clonedAttrs = JSON.parse(JSON.stringify(restAttrs));
    } catch {
      clonedAttrs = { ...restAttrs };
    }

    // Built directly rather than via source.clone(): that would structurally
    // clone the geometry and every attribute (incl. drawEssentials) only for us
    // to overwrite them.
    const newGraphic = new Graphic({
      geometry: newGeom,
      symbol: (source.symbol as any)?.clone?.() ?? source.symbol,
      attributes: { ...clonedAttrs, id: newId, drawEssentials: shiftedDe },
      popupTemplate: source.popupTemplate ?? undefined,
      visible: source.visible,
    });
    newGraphic.set('id', newId);

    const layer = this._layerFor(item.layerId);
    const labelOpts = this.deps.getLabelOptions() ?? {};
    const annotate = () => {
      if (!shiftedDe?.AMPLIFIER) return;
      AnnotationEngine.annotate(
        annotationLayer,
        newGeom,
        shiftedDe.AMPLIFIER,
        shiftedDe,
        newId,
        settingsData.textSize,
        shiftedDe.ISFHAND || 0,
        labelOpts,
        {},
      );
    };
    const findLive = () =>
      (layer.graphics.find((g: any) => g?.attributes?.id === newId) as
        | Graphic
        | undefined) ?? null;

    annotate();
    return {
      graphic: newGraphic,
      // Resolve by id: with collab on, MapSync swaps Graphic instances that share
      // an attributes.id, so removing the captured object would silently no-op.
      undo: () => {
        const live = findLive();
        if (live) layer.remove(live);
        AnnotationEngine.deAnnotate(annotationLayer, newId);
      },
      redo: () => {
        if (!findLive()) layer.add(newGraphic);
        annotate();
      },
    };
  }

  private _computeBearing(
    lon1: number,
    lat1: number,
    lon2: number,
    lat2: number,
  ): number {
    let gLon1 = lon1,
      gLat1 = lat1,
      gLon2 = lon2,
      gLat2 = lat2;
    if (Math.abs(lat1) > 90 || Math.abs(lon1) > 180) {
      const p1 = webMercatorUtils.webMercatorToGeographic(
        new Point({ x: lon1, y: lat1, spatialReference: { wkid: 3857 } }),
      ) as Point;
      const p2 = webMercatorUtils.webMercatorToGeographic(
        new Point({ x: lon2, y: lat2, spatialReference: { wkid: 3857 } }),
      ) as Point;
      gLon1 = p1.x;
      gLat1 = p1.y;
      gLon2 = p2.x;
      gLat2 = p2.y;
    }
    const toRad = Math.PI / 180;
    const phi1 = gLat1 * toRad;
    const phi2 = gLat2 * toRad;
    const dLambda = (gLon2 - gLon1) * toRad;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  private _clipboardCentroid(): { x: number; y: number } {
    if (!this._clipboard || this._clipboard.length === 0)
      return { x: 0, y: 0 };
    let tx = 0,
      ty = 0;
    for (const { graphic: g } of this._clipboard) {
      const geom = g.geometry;
      if (!geom) continue;
      if (geom.type === 'point') {
        tx += (geom as any).x;
        ty += (geom as any).y;
      } else {
        const ext = geom.extent;
        if (ext) {
          tx += (ext.xmin + ext.xmax) / 2;
          ty += (ext.ymin + ext.ymax) / 2;
        }
      }
    }
    return {
      x: tx / this._clipboard.length,
      y: ty / this._clipboard.length,
    };
  }


  private static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (
      c,
    ) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
