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
  private _clipboard: Array<{ graphic: Graphic; layerId: string }> | null = null;

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
    this._clipboard = null;
  }

  public copy(graphic: Graphic): void {
    if ((settingsData as any).features?.clipboard === false) return;
    const sel = this.deps.getSelectionEngine();
    const toCopy =
      sel.isSelected(graphic) && sel.count > 1
        ? sel.selectedGraphics
        : [graphic];
    const clipboard = toCopy.map((g) => ({
      graphic: g.clone(),
      layerId: String((g.origin as any)?.layer?.id ?? this.deps.layerManager.getSymbolLayer().id),
    }));
    this._clipboard = clipboard;
    EngineLogger.nextStep(
      'Symbol Engine',
      `${clipboard.length} symbol${clipboard.length !== 1 ? 's' : ''} copied — click the map to paste`,
    );
    console.info(`[CopyPaste] Copied ${clipboard.length} graphic(s)`);
    this.deps.emitEvent('symbolCopied', { graphic, count: clipboard.length });
  }

  public paste(
    targetPoint: Point,
    expandDistance: number = 0,
    expandUnit: string = 'meters',
  ): Graphic | null {
    if (!this._clipboard || this._clipboard.length === 0) return null;

    const annotationLayer = this.deps.layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );

    if (this._clipboard.length === 1 && expandDistance === 0) {
      const item = this._clipboard[0];
      return this._pasteOneItem(
        item,
        this._offsetGeometryTo(item.graphic.geometry, targetPoint),
        annotationLayer,
      );
    }

    const centroid = this._clipboardCentroid();

    const transformPt = (x: number, y: number): { x: number; y: number } => {
      const baseX = targetPoint.x + (x - centroid.x);
      const baseY = targetPoint.y + (y - centroid.y);

      if (expandDistance === 0) return { x: baseX, y: baseY };

      const dX = baseX - targetPoint.x;
      const dY = baseY - targetPoint.y;
      if (Math.abs(dX) < 1e-10 && Math.abs(dY) < 1e-10)
        return { x: baseX, y: baseY };

      const bearing = this._computeBearing(
        targetPoint.x,
        targetPoint.y,
        baseX,
        baseY,
      );
      const outwardBearing =
        expandDistance >= 0 ? bearing : (bearing + 180) % 360;
      const basePoint = new Point({
        x: baseX,
        y: baseY,
        spatialReference: targetPoint.spatialReference,
      });
      const expanded = GeoTools.destination(
        basePoint,
        Math.abs(expandDistance),
        outwardBearing,
        expandUnit,
      );
      return { x: expanded.x, y: expanded.y };
    };

    const pasted: Graphic[] = [];
    const undos: (() => void)[] = [];
    const redos: (() => void)[] = [];

    for (const item of this._clipboard) {
      let newGeom = item.graphic.geometry?.clone();
      if (newGeom) {
        if (newGeom.type === 'point') {
          const pt = transformPt((newGeom as any).x, (newGeom as any).y);
          (newGeom as any).x = pt.x;
          (newGeom as any).y = pt.y;
          if (targetPoint.z !== undefined) (newGeom as any).z = targetPoint.z;
        } else if (newGeom.type === 'polyline' && (newGeom as any).paths) {
          (newGeom as any).paths = (newGeom as any).paths.map(
            (path: number[][]) =>
              path.map(([x, y, ...rest]) => {
                const pt = transformPt(x, y);
                return [pt.x, pt.y, ...rest];
              }),
          );
        } else if (newGeom.type === 'polygon' && (newGeom as any).rings) {
          (newGeom as any).rings = (newGeom as any).rings.map(
            (ring: number[][]) =>
              ring.map(([x, y, ...rest]) => {
                const pt = transformPt(x, y);
                return [pt.x, pt.y, ...rest];
              }),
          );
        }
      }

      if (!newGeom) continue;
      const {
        graphic: g,
        undo,
        redo,
      } = this._buildPastedGraphic(
        item,
        newGeom,
        annotationLayer,
        transformPt as any,
      );
      const layer =
        this.deps.layerManager.getOrCreateLayer(item.layerId) ??
        this.deps.layerManager.getSymbolLayer();
      layer.add(g);
      pasted.push(g);
      undos.push(undo);
      redos.push(redo);
    }

    if (pasted.length > 0) {
      this.deps.pushUndo({
        label: `Paste ${pasted.length} Symbols`,
        undo: () => undos.forEach((fn) => fn()),
        redo: () => redos.forEach((fn) => fn()),
      });
      console.info(
        `[CopyPaste] Pasted ${pasted.length} graphics at`,
        targetPoint,
      );
      this.deps.emitEvent('symbolPasted', {
        graphics: pasted,
        count: pasted.length,
      });
    }
    return pasted[0] ?? null;
  }

  public buildClone(
    source: Graphic,
    layerId: string,
  ): ClonedSymbol | null {
    const newGeom = source.geometry?.clone?.();
    if (!newGeom) return null;

    const annotationLayer = this.deps.layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    const built = this._buildPastedGraphic(
      { graphic: source, layerId },
      newGeom,
      annotationLayer,
    );
    const layer =
      this.deps.layerManager.getOrCreateLayer(layerId) ??
      this.deps.layerManager.getSymbolLayer();

    return {
      ...built,
      layer,
      id: String(built.graphic.attributes?.id ?? ''),
    };
  }

  public showPasteOffsetDialog(): void {
    if (!this._clipboard || this._clipboard.length === 0) {
      console.warn('[CopyPaste] Clipboard is empty.');
      return;
    }

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

  public activatePasteModeWithOffset(
    expandDistance: number,
    expandUnit: string,
  ): void {
    if (!this._clipboard) return;

    this.deps.closeActiveWorkflow();
    this.deps.emitEvent('pasteMode', { active: true });
    console.info('[CopyPaste] Paste offset mode active — click map to paste');

    const clickHandle = this.view.on('click', (evt) => {
      clickHandle.remove();
      keyHandle();
      const pt = this.view.toMap({ x: evt.x, y: evt.y });
      if (pt) this.paste(pt, expandDistance, expandUnit);
      this.deps.emitEvent('pasteMode', { active: false });
    });

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clickHandle.remove();
        keyHandle();
        this.deps.emitEvent('pasteMode', { active: false });
        console.info('[CopyPaste] Paste offset mode cancelled');
      }
    };
    document.addEventListener('keydown', keyHandler, { once: false });
    const keyHandle = () =>
      document.removeEventListener('keydown', keyHandler);
  }

  public activatePasteMode(): void {
    if (!this._clipboard) return;

    this.deps.closeActiveWorkflow();
    this.deps.emitEvent('pasteMode', { active: true });
    EngineLogger.nextStep(
      'Symbol Engine',
      'Paste mode active — click the map to place the copied symbol(s). Press Esc to cancel',
    );
    console.info('[CopyPaste] Paste mode active — click map to paste');

    const clickHandle = this.view.on('click', (evt) => {
      clickHandle.remove();
      keyHandle();
      const pt = this.view.toMap({ x: evt.x, y: evt.y });
      if (pt) this.paste(pt);
      this.deps.emitEvent('pasteMode', { active: false });
    });

    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clickHandle.remove();
        keyHandle();
        this.deps.emitEvent('pasteMode', { active: false });
        console.info('[CopyPaste] Paste mode cancelled');
      }
    };
    document.addEventListener('keydown', keyHandler, { once: false });
    const keyHandle = () =>
      document.removeEventListener('keydown', keyHandler);
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private _pasteOneItem(
    item: { graphic: Graphic; layerId: string },
    newGeom: any,
    annotationLayer: GraphicsLayer,
    transformFn?: (pt: { x: number; y: number }) => { x: number; y: number },
  ): Graphic | null {
    if (!newGeom) return null;
    const {
      graphic: newGraphic,
      undo,
      redo,
    } = this._buildPastedGraphic(item, newGeom, annotationLayer, transformFn);
    const layer =
      this.deps.layerManager.getOrCreateLayer(item.layerId) ??
      this.deps.layerManager.getSymbolLayer();
    layer.add(newGraphic);
    this.deps.pushUndo({ label: 'Paste Symbol', undo, redo });
    console.info('[CopyPaste] Pasted at', newGeom);
    this.deps.emitEvent('symbolPasted', { graphic: newGraphic });
    return newGraphic;
  }

  private _transformDrawEssentials(
    de: any,
    transformFn: (pt: any) => { x: number; y: number },
  ): any {
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
    const tGeom = (geom: any) => {
      if (!geom) return geom;
      const clone = geom.clone?.() ?? { ...geom };

      if (clone.type === 'point' || ('x' in clone && 'y' in clone)) {
        const { x, y } = transformFn(clone);
        clone.x = x;
        clone.y = y;
        return clone;
      }

      if (clone.type === 'polyline' && clone.paths) {
        clone.paths = clone.paths.map((path: number[][]) =>
          path.map(([x, y, ...rest]) => {
            const pt = transformFn({ x, y });
            return [pt.x, pt.y, ...rest];
          }),
        );
        return clone;
      }

      if (clone.type === 'polygon' && clone.rings) {
        clone.rings = clone.rings.map((ring: number[][]) =>
          ring.map(([x, y, ...rest]) => {
            const pt = transformFn({ x, y });
            return [pt.x, pt.y, ...rest];
          }),
        );
        return clone;
      }

      return clone;
    };
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
      result.OPTIONS = {
        ...de.OPTIONS,
        GEOM: tGeom(de.OPTIONS.GEOM),
      };
    }
    return result;
  }

  private _shiftDrawEssentials(de: any, dx: number, dy: number): any {
    return this._transformDrawEssentials(de, (pt) => ({
      x: pt.x + dx,
      y: pt.y + dy,
    }));
  }

  private _buildPastedGraphic(
    item: { graphic: Graphic; layerId: string },
    newGeom: any,
    annotationLayer: GraphicsLayer,
    transformFn?: (pt: { x: number; y: number }) => { x: number; y: number },
  ): { graphic: Graphic; undo: () => void; redo: () => void } {
    const source = item.graphic;
    const origGeom = source.geometry;

    let shiftedDe;
    const sourceDe = source.attributes?.drawEssentials;

    if (transformFn) {
      shiftedDe = this._transformDrawEssentials(sourceDe, transformFn);
    } else {
      let dx = 0,
        dy = 0;
      if (origGeom && newGeom) {
        if (origGeom.type === 'point') {
          dx = (newGeom as any).x - (origGeom as any).x;
          dy = (newGeom as any).y - (origGeom as any).y;
        } else {
          const oe = origGeom.extent,
            ne = newGeom.extent;
          if (oe && ne) {
            dx = (ne.xmin + ne.xmax) / 2 - (oe.xmin + oe.xmax) / 2;
            dy = (ne.ymin + ne.ymax) / 2 - (oe.ymin + oe.ymax) / 2;
          }
        }
      }
      shiftedDe = this._shiftDrawEssentials(sourceDe, dx, dy);
    }
    const newId = ClipboardEngine.generateUUID();
    const newGraphic = source.clone();
    newGraphic.geometry = newGeom;
    newGraphic.attributes = {
      ...source.attributes,
      id: newId,
      drawEssentials: shiftedDe,
    };
    newGraphic.set('id', newId);

    const layer =
      this.deps.layerManager.getOrCreateLayer(item.layerId) ??
      this.deps.layerManager.getSymbolLayer();
    const labelOpts = this.deps.getLabelOptions() ?? {};
    if (shiftedDe?.AMPLIFIER) {
      AnnotationEngine.annotate(
        annotationLayer,
        newGraphic.geometry,
        shiftedDe.AMPLIFIER,
        shiftedDe,
        newId,
        settingsData.textSize,
        shiftedDe.ISFHAND || 0,
        labelOpts,
        {},
      );
    }
    return {
      graphic: newGraphic,
      undo: () => {
        layer.remove(newGraphic);
        AnnotationEngine.deAnnotate(annotationLayer, newId);
      },
      redo: () => {
        layer.add(newGraphic);
        if (shiftedDe?.AMPLIFIER)
          AnnotationEngine.annotate(
            annotationLayer,
            newGraphic.geometry,
            shiftedDe.AMPLIFIER,
            shiftedDe,
            newId,
            settingsData.textSize,
            shiftedDe.ISFHAND || 0,
            labelOpts,
            {},
          );
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

  private _offsetGeometryTo(sourceGeom: any, targetPoint: Point): any {
    if (!sourceGeom) return null;
    try {
      const clone = sourceGeom.clone();
      if (clone.type === 'point') {
        clone.x = targetPoint.x;
        clone.y = targetPoint.y;
        if (targetPoint.z !== undefined) clone.z = targetPoint.z;
      } else {
        const ext = clone.extent;
        if (!ext) return clone;
        const dx = targetPoint.x - (ext.xmin + ext.xmax) / 2;
        const dy = targetPoint.y - (ext.ymin + ext.ymax) / 2;
        if (clone.type === 'polyline') {
          clone.paths = clone.paths.map((path: number[][]) =>
            path.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]),
          );
        } else if (clone.type === 'polygon') {
          clone.rings = clone.rings.map((ring: number[][]) =>
            ring.map(([x, y, ...rest]) => [x + dx, y + dy, ...rest]),
          );
        }
      }
      return clone;
    } catch {
      return sourceGeom.clone();
    }
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
