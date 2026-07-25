/**
 * PptxExporter.ts
 *
 * PowerPoint (.pptx) briefing export via pptxgenjs — Mode A: a flat
 * screenshot deck. One slide per captured Briefing slide (or the current
 * view when no briefing exists), each a full-bleed map screenshot with the
 * slide title re-drawn as native pptx text (titles/legends are HTML overlays
 * and are NOT part of the ArcGIS screenshot) and speaker notes attached.
 *
 * Explode-builds: optionally one slide per staged-reveal BuildStep, reusing
 * the Briefing engine's build model (base state + cumulative reveals).
 *
 * Mode B — editable overlay (`mode: 'editable'`): graphics rendered with
 * simple symbols (simple-line polylines, simple-fill polygons, text) are
 * HIDDEN from the screenshot and re-emitted as native PowerPoint objects on
 * top of it — freeform CUSTOM_GEOMETRY shapes and text boxes projected via
 * view.toScreen() and mapped into slide inches. Everything else (MIL-STD
 * picture markers, CIM/decorated tactical graphics, off-screen vertices)
 * stays in the background raster.
 *
 * 2D is EXACT (orthographic projection — raster and shapes align to the
 * pixel). 3D is APPROXIMATE: vertices are lifted to sampled ground elevation
 * and segments are densified so shape edges follow the terrain-draped
 * rendering, but steep relief, tilt and per-symbol elevation offsets can
 * still leave small offsets; graphics behind the camera or beyond the
 * horizon stay in the raster.
 *
 * Gated behind `features.exportTools` (checked at call time against the live
 * settings tree). PptxGenJS ships as the offline browser bundle in
 * `MS/ThirdParty/PptxGenJS/pptxgen.bundle.js` (not the npm ES module — this
 * app must also run offline) and is injected as a `<script>` tag on first
 * use, so the ~450KB bundle never loads unless export is actually used.
 */

import Point from '@arcgis/core/geometry/Point';
import GraphicsLayerManager, {
  LAYER_NAMES,
  SYMBOL_LAYER_IDS,
} from '../../Managers/GraphicsLayerManager';
import {
  ElevationUtils,
  type ElevationSamplerLike,
} from '../../Support/Elevation/ElevationUtils';
import EngineLogger from '../../Support/EngineLogger';
import settingsData from '../../Data/Settings.json';
import type { Slide as BriefingSlide, SlideOverlay } from '../Briefing/BriefingTypes';

const ENGINE_NAME = 'PptxExporter';

/**
 * takeScreenshot can hang in a 3D SceneView under headless preview (frozen
 * rAF) — every screenshot is raced against this timeout so a stuck call can
 * never freeze the export. 3D export is verified in a real browser only.
 */
const SCREENSHOT_TIMEOUT_MS = 15000;

/** 16:9 pptx layout is 10 × 5.625 inches. */
const SLIDE_W_IN = 10;
const SLIDE_H_IN = 5.625;

/** Offline browser bundle — see the file banner above. */
const PPTXGENJS_SCRIPT_SRC = 'MS/ThirdParty/PptxGenJS/pptxgen.bundle.js';

/** Box-persisted overlay kinds → native pptx preset shapes. */
const OVERLAY_SHAPE_TYPES: Partial<Record<SlideOverlay['kind'], string>> = {
  rect: 'rect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  star: 'star5',
  callout: 'wedgeRoundRectCallout',
};

let pptxGenJSLoadPromise: Promise<any> | null = null;

/**
 * Injects the PptxGenJS `<script>` tag on first use and resolves
 * `window.PptxGenJS`. Exported: the bundle's first UMD segment also assigns
 * `window.JSZip`, which PptxImporter reuses to unzip .pptx files.
 */
export function loadPptxGenJS(): Promise<any> {
  const existing = (window as any).PptxGenJS;
  if (existing) return Promise.resolve(existing);
  if (pptxGenJSLoadPromise) return pptxGenJSLoadPromise;
  pptxGenJSLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PPTXGENJS_SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const ctor = (window as any).PptxGenJS;
      if (ctor) resolve(ctor);
      else reject(new Error(`${PPTXGENJS_SCRIPT_SRC} loaded but window.PptxGenJS is undefined`));
    };
    script.onerror = () => {
      pptxGenJSLoadPromise = null;
      reject(new Error(`Failed to load ${PPTXGENJS_SCRIPT_SRC}`));
    };
    document.head.appendChild(script);
  });
  return pptxGenJSLoadPromise;
}

export interface PptxExportOptions {
  /**
   * 'flat' (Mode A, default): one full screenshot per slide.
   * 'editable' (Mode B): simple lines / areas / text become native,
   * selectable PowerPoint shapes over a basemap raster. 2D is exact;
   * 3D is approximate (camera projection over sampled terrain).
   */
  mode?: 'flat' | 'editable';
  /** 'png' (default) or 'jpeg'. */
  format?: 'png' | 'jpeg';
  /** One extra slide per staged-reveal build step. */
  explodeBuilds?: boolean;
  /** Attach slide.notes as pptx speaker notes (default true). */
  includeNotes?: boolean;
  fileName?: string;
}

/** A graphic that can be re-emitted as a native pptx object. */
interface ConvertibleGraphic {
  graphic: any;
  kind: 'text' | 'line' | 'fill';
  /** Projected screen-pixel vertices — paths for lines, rings for fills, a single anchor for text. */
  screenPaths: Array<Array<{ x: number; y: number }>>;
}

interface ContainFit {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounds for the editable overlay so a pathological plan can't bloat the deck. */
const MAX_SHAPES_PER_SLIDE = 250;
const MAX_POINTS_PER_PATH = 250;

/**
 * 3D projection tuning: segments are subdivided until edge pieces are at most
 * this many screen pixels, so straight PowerPoint edges follow the
 * terrain-draped curve of the rendered line. Densified paths are then capped
 * (endpoints preserved) so PowerPoint stays responsive.
 */
const DENSIFY_TARGET_PX = 25;
const DENSIFY_MAX_STEPS_PER_SEGMENT = 32;
const MAX_POINTS_PER_PATH_3D = 600;

class PptxExporter {
  private static _instance: PptxExporter | null = null;

  private _getView: (() => any) | null = null;

  private constructor() {}

  public static getInstance(): PptxExporter {
    if (!PptxExporter._instance) {
      PptxExporter._instance = new PptxExporter();
    }
    return PptxExporter._instance;
  }

  /** Optional — when not started, the view is resolved from window.symbolEngine. */
  public start(getView: () => any): void {
    this._getView = getView;
  }

  private get _view(): any {
    return this._getView?.() ?? (window as any).symbolEngine?.view ?? null;
  }

  private get _cfg(): any {
    return (settingsData as any).exportTools ?? {};
  }

  /**
   * Export the deck: every Briefing slide when the Briefing engine has
   * slides, otherwise a single slide of the current view.
   */
  public async exportDeck(options: PptxExportOptions = {}): Promise<void> {
    if ((settingsData as any).features?.exportTools !== true) {
      const msg = 'Export Tools disabled — enable features.exportTools in Settings';
      EngineLogger.error(ENGINE_NAME, msg);
      throw new Error(msg);
    }
    let view = this._view;
    if (!view) {
      const msg = 'No active view to export';
      EngineLogger.error(ENGINE_NAME, msg);
      throw new Error(msg);
    }

    const cfg = this._cfg;
    const mode: 'flat' | 'editable' =
      options.mode ?? (cfg.mode === 'editable' ? 'editable' : 'flat');
    const format: 'png' | 'jpeg' = options.format ?? (cfg.format === 'jpeg' ? 'jpeg' : 'png');
    const explodeBuilds = options.explodeBuilds ?? cfg.explodeBuilds === true;
    const includeNotes = options.includeNotes ?? cfg.includeNotes !== false;
    const fileName = options.fileName ?? `pams8_briefing_${Date.now()}.pptx`;

    // Editable export from the 3D scene: offer the exact 2D path first
    // (terrain elevation makes 3D shape placement approximate). In 2D there
    // is nothing to ask — export straight away.
    if (mode === 'editable' && view.type === '3d') {
      const choice = await this._confirm3DExport();
      if (choice === 'cancel') {
        EngineLogger.nextStep(ENGINE_NAME, 'Export cancelled');
        return;
      }
      if (choice === 'switch') {
        const v2 = await this._switchTo2D();
        if (v2) {
          view = v2;
        } else {
          EngineLogger.error(ENGINE_NAME, 'Could not switch to 2D — exporting from 3D instead');
        }
      }
    }

    EngineLogger.nextStep(
      ENGINE_NAME,
      mode === 'editable'
        ? 'Exporting PowerPoint deck (Mode B — editable shapes over raster)'
        : 'Exporting PowerPoint deck (Mode A — flat screenshots)',
    );

    // Script-injected on first use — keeps the bundle out of the main app until needed.
    const PptxGenJS = await loadPptxGenJS();
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_16x9';

    const briefing: any = (window as any).briefingEngine;
    const slides: readonly BriefingSlide[] = briefing?.getSlides?.() ?? [];

    // Run diagnostics — so an all-raster editable export can explain itself.
    const stats = { shapes: 0 };
    let emitted = 0;
    if (slides.length && briefing) {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        // Screen-only slide (imported PPTX — no extent/camera): its stored
        // background IS the slide. Nothing to apply to the map, no screenshot,
        // no Mode-B projection.
        if (!slide.view?.extent && !slide.view?.camera && slide.backgroundDataUrl) {
          await this._addSlide(pptx, view, format, 'flat', {
            title: slide.title,
            notes: includeNotes ? slide.notes : undefined,
            overlays: slide.overlays,
            background: slide.backgroundDataUrl,
          }, stats);
          emitted++;
          continue;
        }
        const builds = slide.builds ?? [];
        if (explodeBuilds && builds.length) {
          // Base state (builds hidden), then one cumulative reveal per step.
          for (let reveal = 0; reveal <= builds.length; reveal++) {
            await briefing.applySlideForExport(i, reveal);
            await this._settle(view);
            const suffix = reveal === 0 ? ' (base)' : ` (build ${reveal}/${builds.length})`;
            await this._addSlide(pptx, view, format, mode, {
              title: slide.title + suffix,
              notes: includeNotes ? slide.notes : undefined,
              overlays: slide.overlays,
            }, stats);
            emitted++;
          }
        } else {
          await briefing.applySlideForExport(i);
          await this._settle(view);
          await this._addSlide(pptx, view, format, mode, {
            title: slide.title,
            notes: includeNotes ? slide.notes : undefined,
            overlays: slide.overlays,
          }, stats);
          emitted++;
        }
      }
    } else {
      // No briefing — export the current view as a one-slide deck.
      await this._addSlide(pptx, view, format, mode, { title: 'Current view' }, stats);
      emitted++;
    }

    await pptx.writeFile({ fileName });

    if (mode === 'editable' && stats.shapes === 0) {
      EngineLogger.error(
        ENGINE_NAME,
        'No graphics could become editable shapes on this export — only simple lines/areas (freehand, AutoShape) and text labels convert; unit icons and decorated tactical graphics always stay in the image. In 3D, graphics behind the camera or beyond the horizon also stay in the image.',
      );
    }
    EngineLogger.success(
      ENGINE_NAME,
      `PPTX exported — ${emitted} slides${
        mode === 'editable' ? `, ${stats.shapes} editable shapes` : ''
      } → ${fileName}`,
    );
  }

  // ── Slide assembly ─────────────────────────────────────────────────────────

  private async _addSlide(
    pptx: any,
    view: any,
    format: 'png' | 'jpeg',
    mode: 'flat' | 'editable',
    meta: {
      title?: string;
      notes?: string;
      overlays?: readonly SlideOverlay[];
      /** Screen-only slide raster — used instead of a live map screenshot. */
      background?: string;
    },
    stats?: { shapes: number },
  ): Promise<void> {
    const slide = pptx.addSlide();
    slide.background = { color: '101418' };

    // Mode B: find graphics that can become native shapes and hide them so
    // the raster underneath holds everything else. 2D is exact; 3D projects
    // through the current camera (elevation-sampled + densified — approximate).
    let convertibles: ConvertibleGraphic[] = [];
    if (mode === 'editable' && !meta.background) {
      if (view.type === '3d') {
        EngineLogger.nextStep(
          ENGINE_NAME,
          '3D editable export is APPROXIMATE — shapes are projected from the current camera over terrain; expect small offsets on steep relief. 2D export is exact.',
        );
      }
      convertibles = await this._collectConvertibles(view);
      const byKind = { line: 0, fill: 0, text: 0 };
      for (const c of convertibles) byKind[c.kind]++;
      EngineLogger.nextStep(
        ENGINE_NAME,
        `Slide "${meta.title ?? ''}" — ${convertibles.length} convertible graphics ` +
          `(${byKind.line} lines, ${byKind.fill} areas, ${byKind.text} text)`,
      );
    }

    const hidden: any[] = [];
    for (const c of convertibles) {
      if (c.graphic.visible !== false) {
        c.graphic.visible = false;
        hidden.push(c.graphic);
      }
    }

    let dataUrl: string | null = meta.background ?? null;
    try {
      if (!dataUrl) {
        if (hidden.length) await this._settle(view);
        dataUrl = await this._takeScreenshot(view, format);
      }
    } finally {
      for (const g of hidden) g.visible = true;
    }

    // Screen-only backgrounds carry the SOURCE deck's aspect — contain-fit by
    // the image itself, not the live view.
    let fit = this._containFit(view);
    if (meta.background) {
      const size = await this._imageSize(meta.background);
      if (size) fit = this._containFitAspect(size.w / Math.max(1, size.h));
    }
    if (dataUrl) {
      // Screenshot keeps the view's native aspect; contain-fit it on the
      // 16:9 slide so nothing distorts (letterbox bars only when the view
      // itself is not 16:9).
      slide.addImage({ data: dataUrl, x: fit.x, y: fit.y, w: fit.w, h: fit.h });
    } else {
      slide.addText('Screenshot unavailable (3D view requires a real browser)', {
        x: 0.5,
        y: 2.5,
        w: 9,
        h: 0.6,
        fontSize: 16,
        color: 'CCCCCC',
        align: 'center',
      });
      EngineLogger.error(ENGINE_NAME, `Screenshot failed for slide "${meta.title ?? ''}"`);
    }

    if (convertibles.length) {
      const emitted = this._emitShapes(slide, view, fit, convertibles);
      if (stats) stats.shapes += emitted;
    }

    // Slide-editor annotations sit above map content (raster + Mode B
    // shapes) and below the title — the same z-order the editor showed.
    // They are screen-space, so they emit natively in BOTH modes and need
    // no projection.
    if (meta.overlays?.length) {
      this._emitOverlays(slide, meta.overlays, fit);
    }

    if (meta.title) {
      // Titles are HTML overlays in the app — re-draw as native pptx text.
      slide.addText(meta.title, {
        x: 0.3,
        y: 0.2,
        w: 9.4,
        h: 0.6,
        fontSize: 24,
        bold: true,
        color: 'FFFFFF',
        shadow: { type: 'outer', color: '000000', blur: 3, offset: 1, angle: 45, opacity: 0.8 },
      });
    }
    if (meta.notes) slide.addNotes(meta.notes);
  }

  // ── Mode B — editable native-shape overlay ────────────────────────────────

  /** Contain-fit of the view's native aspect on the 16:9 slide, in inches. */
  private _containFit(view: any): ContainFit {
    const vw = Number(view.width) || 16;
    const vh = Number(view.height) || 9;
    return this._containFitAspect(vw / vh);
  }

  private _containFitAspect(imgAspect: number): ContainFit {
    const slideAspect = SLIDE_W_IN / SLIDE_H_IN;
    let w = SLIDE_W_IN;
    let h = SLIDE_H_IN;
    if (imgAspect > slideAspect) {
      h = SLIDE_W_IN / imgAspect;
    } else if (imgAspect < slideAspect) {
      w = SLIDE_H_IN * imgAspect;
    }
    return { x: (SLIDE_W_IN - w) / 2, y: (SLIDE_H_IN - h) / 2, w, h };
  }

  /** Natural pixel size of a data-URL image (null on decode failure). */
  private _imageSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /**
   * Every visible graphic (symbol layers + annotation labels) rendered with a
   * symbol PowerPoint can represent — simple-line polylines, simple-fill
   * polygons, text — with all vertices projectable to screen. Everything else
   * (picture markers, CIM/decorated graphics, failed projections) is left in
   * the raster. In 3D an elevation sampler lifts vertices to ground height
   * before projecting so shapes land where the draped rendering drew them.
   */
  private async _collectConvertibles(view: any): Promise<ConvertibleGraphic[]> {
    const lm = GraphicsLayerManager.getInstance(view);
    const out: ConvertibleGraphic[] = [];
    let dropped = 0;

    const is3D = view.type === '3d';
    let sampler: ElevationSamplerLike | null = null;
    if (is3D) {
      try {
        // view.extent can be null in a scene showing the horizon — sampler
        // then stays null and projection degrades to z = 0.
        if (view.extent) {
          sampler = await ElevationUtils.createSampler(view, view.extent, { noDataValue: 0 });
        }
      } catch {
        sampler = null;
      }
      if (!sampler) {
        EngineLogger.nextStep(
          ENGINE_NAME,
          '3D elevation sampler unavailable — projecting at height 0 (expect offsets over terrain)',
        );
      }
    }

    for (const layerId of [...SYMBOL_LAYER_IDS, LAYER_NAMES.ANNOTATION_LAYER]) {
      const layer = lm.getLayer(layerId);
      (layer?.graphics as any)?.forEach((g: any) => {
        if (g.visible === false) return;
        const kind = this._classify(g);
        if (!kind) return;
        if (out.length >= MAX_SHAPES_PER_SLIDE) {
          dropped++;
          return;
        }
        const screenPaths = is3D
          ? this._projectGeometry3D(view, g.geometry, sampler)
          : this._projectGeometry(view, g.geometry);
        if (!screenPaths) return; // off-screen / unprojectable → stays raster
        out.push({ graphic: g, kind, screenPaths });
      });
    }
    if (dropped) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `Editable overlay capped at ${MAX_SHAPES_PER_SLIDE} shapes — ${dropped} left in the raster`,
      );
    }
    return out;
  }

  private _classify(g: any): ConvertibleGraphic['kind'] | null {
    const sym = g?.symbol;
    const geom = g?.geometry;
    if (!sym || !geom) return null;
    if (sym.type === 'text' && geom.type === 'point' && String(sym.text ?? '').trim()) {
      return 'text';
    }
    if (sym.type === 'simple-line' && geom.type === 'polyline') return 'line';
    if (sym.type === 'simple-fill' && geom.type === 'polygon') return 'fill';
    return null;
  }

  /**
   * Project every vertex to screen pixels via view.toScreen(). Any vertex
   * that fails to project disqualifies the graphic (it stays in the raster).
   * Dense freehand paths are downsampled (endpoints always kept).
   */
  private _projectGeometry(
    view: any,
    geom: any,
  ): Array<Array<{ x: number; y: number }>> | null {
    const sr = geom.spatialReference;
    const project = (x: number, y: number): { x: number; y: number } | null => {
      const s = view.toScreen(new Point({ x, y, spatialReference: sr }));
      return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
    };

    if (geom.type === 'point') {
      const p = project(geom.x, geom.y);
      return p ? [[p]] : null;
    }

    const sourcePaths: number[][][] =
      geom.type === 'polyline' ? geom.paths : geom.type === 'polygon' ? geom.rings : null;
    if (!sourcePaths?.length) return null;

    const out: Array<Array<{ x: number; y: number }>> = [];
    for (const path of sourcePaths) {
      if (path.length < 2) continue;
      const stride = Math.max(1, Math.ceil(path.length / MAX_POINTS_PER_PATH));
      const pts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < path.length; i += stride) {
        const p = project(path[i][0], path[i][1]);
        if (!p) return null;
        pts.push(p);
      }
      // Keep the true endpoint when the stride skipped it.
      if ((path.length - 1) % stride !== 0) {
        const last = project(path[path.length - 1][0], path[path.length - 1][1]);
        if (!last) return null;
        pts.push(last);
      }
      if (pts.length >= 2) out.push(pts);
    }
    return out.length ? out : null;
  }

  /**
   * 3D projection: lift each vertex to sampled ground elevation, project
   * through the scene camera, and adaptively densify segments so straight
   * PowerPoint edges follow the terrain-draped curve of the rendered line.
   * Any vertex that fails to project (behind camera / beyond horizon)
   * disqualifies the graphic — it stays in the raster.
   */
  private _projectGeometry3D(
    view: any,
    geom: any,
    sampler: ElevationSamplerLike | null,
  ): Array<Array<{ x: number; y: number }>> | null {
    const sr = geom.spatialReference;

    const groundZ = (x: number, y: number): number => {
      if (!sampler) return 0;
      try {
        const q: any = sampler.queryElevation(new Point({ x, y, spatialReference: sr }));
        return Number.isFinite(q?.z) ? q.z : 0;
      } catch {
        return 0;
      }
    };

    const project = (x: number, y: number): { x: number; y: number } | null => {
      const s = view.toScreen(new Point({ x, y, z: groundZ(x, y), spatialReference: sr }));
      return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
    };

    if (geom.type === 'point') {
      const p = project(geom.x, geom.y);
      return p ? [[p]] : null;
    }

    const sourcePaths: number[][][] =
      geom.type === 'polyline' ? geom.paths : geom.type === 'polygon' ? geom.rings : null;
    if (!sourcePaths?.length) return null;

    const out: Array<Array<{ x: number; y: number }>> = [];
    for (const path of sourcePaths) {
      if (path.length < 2) continue;
      const first = project(path[0][0], path[0][1]);
      if (!first) return null;
      const pts: Array<{ x: number; y: number }> = [first];

      for (let i = 1; i < path.length; i++) {
        const [ax, ay] = path[i - 1];
        const [bx, by] = path[i];
        const end = project(bx, by);
        if (!end) return null;
        const prev = pts[pts.length - 1];
        const screenLen = Math.hypot(end.x - prev.x, end.y - prev.y);
        const steps = Math.min(
          DENSIFY_MAX_STEPS_PER_SEGMENT,
          Math.max(1, Math.ceil(screenLen / DENSIFY_TARGET_PX)),
        );
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const mid = project(ax + (bx - ax) * t, ay + (by - ay) * t);
          if (!mid) return null;
          pts.push(mid);
        }
        pts.push(end);
      }

      // Cap densified paths, always keeping the true endpoint.
      let capped = pts;
      if (pts.length > MAX_POINTS_PER_PATH_3D) {
        const stride = Math.ceil(pts.length / MAX_POINTS_PER_PATH_3D);
        capped = pts.filter((_, i) => i % stride === 0);
        if (capped[capped.length - 1] !== pts[pts.length - 1]) {
          capped.push(pts[pts.length - 1]);
        }
      }
      if (capped.length >= 2) out.push(capped);
    }
    return out.length ? out : null;
  }

  /** Re-emit collected graphics as native pptx objects over the raster. Returns the emit count. */
  private _emitShapes(
    slide: any,
    view: any,
    fit: ContainFit,
    convertibles: ConvertibleGraphic[],
  ): number {
    const pxToInX = fit.w / (Number(view.width) || 1);
    const pxToInY = fit.h / (Number(view.height) || 1);
    const toIn = (p: { x: number; y: number }) => ({
      x: fit.x + p.x * pxToInX,
      y: fit.y + p.y * pxToInY,
    });

    let emitted = 0;
    for (const c of convertibles) {
      try {
        if (c.kind === 'text') {
          this._emitTextShape(slide, c, toIn, pxToInY);
        } else {
          for (const path of c.screenPaths) {
            this._emitPathShape(slide, c, path.map(toIn));
          }
        }
        emitted++;
      } catch (err) {
        EngineLogger.error(ENGINE_NAME, `Shape emit failed: ${err}`);
      }
    }
    EngineLogger.success(ENGINE_NAME, `Editable overlay — ${emitted} graphics as native shapes`);
    return emitted;
  }

  private _emitTextShape(
    slide: any,
    c: ConvertibleGraphic,
    toIn: (p: { x: number; y: number }) => { x: number; y: number },
    pxToInY: number,
  ): void {
    const sym = c.graphic.symbol;
    const anchorPx = {
      x: c.screenPaths[0][0].x + (Number(sym.xoffset) || 0),
      y: c.screenPaths[0][0].y - (Number(sym.yoffset) || 0),
    };
    const a = toIn(anchorPx);
    const text = String(sym.text);
    // Scale the on-screen pixel size into slide points so the label keeps its
    // proportion to the map image (72pt per inch).
    const fontPx = Number(sym.font?.size) || 12;
    const fontPt = Math.min(96, Math.max(6, Math.round(fontPx * pxToInY * 72)));
    const longestLine = text
      .split(/\r?\n/)
      .reduce((n, line) => Math.max(n, line.length), 1);
    const lineCount = text.split(/\r?\n/).length;
    const w = Math.max(0.3, (longestLine * fontPt * 0.62) / 72 + 0.1);
    const h = Math.max(0.25, (lineCount * fontPt * 1.4) / 72);
    const color = this._colorParts(sym.color);

    slide.addText(text, {
      x: a.x - w / 2,
      y: a.y - h / 2,
      w,
      h,
      fontSize: fontPt,
      fontFace: sym.font?.family || 'Arial',
      bold: sym.font?.weight === 'bold' || sym.font?.weight === 'bolder',
      italic: sym.font?.style === 'italic',
      color: color?.hex ?? '000000',
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
  }

  /** One CUSTOM_GEOMETRY freeform per path (line) / ring (fill). */
  private _emitPathShape(
    slide: any,
    c: ConvertibleGraphic,
    pts: Array<{ x: number; y: number }>,
  ): void {
    const sym = c.graphic.symbol;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const w = Math.max(0.02, maxX - minX);
    const h = Math.max(0.02, maxY - minY);

    const points: any[] = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    if (c.kind === 'fill') points.push({ close: true });

    const outlineSym = c.kind === 'fill' ? sym.outline : sym;
    const fillColor = c.kind === 'fill' ? this._colorParts(sym.color) : null;

    slide.addShape('custGeom', {
      x: minX,
      y: minY,
      w,
      h,
      points,
      line: this._lineProps(outlineSym),
      fill: fillColor
        ? { color: fillColor.hex, transparency: fillColor.transparency }
        : { color: 'FFFFFF', transparency: 100 }, // open path — no fill
    });
  }

  // ── Slide-editor annotation overlays ───────────────────────────────────────

  /**
   * Emit SlideOverlay annotations as native pptx objects. Overlays are stored
   * normalized [0..1] to the slide's view rect, so they map straight into the
   * contain-fit rectangle — no projection, works in flat + editable, 2D + 3D.
   */
  private _emitOverlays(
    slide: any,
    overlays: readonly SlideOverlay[],
    fit: ContainFit,
  ): void {
    let emitted = 0;
    for (const o of overlays) {
      try {
        if (o.kind === 'text') this._emitOverlayText(slide, o, fit);
        else if (OVERLAY_SHAPE_TYPES[o.kind]) this._emitOverlayBox(slide, o, fit);
        else this._emitOverlayPath(slide, o, fit); // line | arrow | freehand | highlight
        emitted++;
      } catch (err) {
        EngineLogger.error(ENGINE_NAME, `Annotation emit failed (${o?.kind}): ${err}`);
      }
    }
    if (emitted) {
      EngineLogger.success(ENGINE_NAME, `Slide annotations — ${emitted} native objects`);
    }
  }

  /** Overlay strokeWidth is a fraction of view height → slide points. */
  private _ovStrokePt(o: SlideOverlay, fit: ContainFit): number {
    return Math.max(0.25, Math.round((o.strokeWidth ?? 0.004) * fit.h * 72 * 4) / 4);
  }

  /** Overlay strokeDash → pptx dashType (absent = solid). */
  private _ovDashType(o: SlideOverlay): string | undefined {
    if (o.strokeDash === 'dashed') return 'dash';
    if (o.strokeDash === 'dotted') return 'sysDot';
    return undefined;
  }

  private _ovHex(c: string | undefined, fallback: string): string {
    return (c ?? fallback).replace('#', '').toUpperCase();
  }

  private _ovRotate(o: SlideOverlay): number | undefined {
    if (!o.rotation) return undefined;
    return ((Math.round(o.rotation) % 360) + 360) % 360 || undefined;
  }

  private _emitOverlayText(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const fontPt = Math.min(96, Math.max(6, Math.round((o.fontSize ?? 0.03) * fit.h * 72)));
    slide.addText(o.text ?? '', {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: Math.max(0.2, o.w * fit.w),
      h: Math.max(0.2, o.h * fit.h),
      fontSize: fontPt,
      fontFace: o.fontFamily || 'Arial',
      bold: !!o.bold,
      italic: !!o.italic,
      underline: o.underline ? { style: 'sng' } : undefined,
      color: this._ovHex(o.textColor, 'FFFFFF'),
      align: o.align ?? 'left',
      valign: 'top',
      margin: 0,
      rotate: this._ovRotate(o),
      transparency:
        o.opacity != null && o.opacity < 1 ? Math.round((1 - o.opacity) * 100) : undefined,
    });
  }

  private _emitOverlayBox(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const alpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    slide.addShape(OVERLAY_SHAPE_TYPES[o.kind] ?? 'rect', {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: Math.max(0.02, o.w * fit.w),
      h: Math.max(0.02, o.h * fit.h),
      fill: o.fill
        ? { color: this._ovHex(o.fill, 'FFD166'), transparency: Math.round((1 - alpha) * 100) }
        : { color: 'FFFFFF', transparency: 100 },
      line: o.stroke
        ? {
            color: this._ovHex(o.stroke, 'FF3B30'),
            width: this._ovStrokePt(o, fit),
            transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
            dashType: this._ovDashType(o),
          }
        : { color: 'FFFFFF', width: 0.5, transparency: 100 },
      rotate: this._ovRotate(o),
    });
  }

  /** line / arrow / freehand — custGeom path; arrows get a triangle head. */
  private _emitOverlayPath(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const pts = (o.points ?? []).map((p) => ({
      x: fit.x + p.x * fit.w,
      y: fit.y + p.y * fit.h,
    }));
    if (pts.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    slide.addShape('custGeom', {
      x: minX,
      y: minY,
      w: Math.max(0.02, maxX - minX),
      h: Math.max(0.02, maxY - minY),
      points: pts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
      fill: { color: 'FFFFFF', transparency: 100 },
      line: {
        color: this._ovHex(o.stroke, 'FF3B30'),
        width: this._ovStrokePt(o, fit),
        transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
        endArrowType: o.kind === 'arrow' ? 'triangle' : undefined,
        dashType: this._ovDashType(o),
      },
    });
  }

  /** SimpleLineSymbol → pptx ShapeLineProps (px → pt, dash style, alpha). */
  private _lineProps(lineSym: any): any {
    const color = this._colorParts(lineSym?.color);
    if (!lineSym || lineSym.style === 'none' || !color) {
      return { color: color?.hex ?? '000000', width: 0.5, transparency: 100 };
    }
    return {
      color: color.hex,
      width: Math.max(0.5, Math.round((Number(lineSym.width) || 1) * 0.75 * 4) / 4),
      transparency: color.transparency,
      dashType: this._dashType(lineSym.style),
    };
  }

  private _dashType(style: string | undefined): string {
    switch (style) {
      case 'dash':
        return 'dash';
      case 'dot':
      case 'short-dot':
        return 'sysDot';
      case 'dash-dot':
      case 'short-dash-dot':
        return 'dashDot';
      case 'long-dash':
        return 'lgDash';
      case 'long-dash-dot':
      case 'long-dash-dot-dot':
      case 'short-dash-dot-dot':
        return 'lgDashDotDot';
      case 'short-dash':
        return 'sysDash';
      default:
        return 'solid';
    }
  }

  /** ArcGIS Color / [r,g,b,a] → pptx hex + transparency %. Null when absent/fully transparent. */
  private _colorParts(color: any): { hex: string; transparency: number } | null {
    if (!color) return null;
    const r = Number(Array.isArray(color) ? color[0] : color.r);
    const g = Number(Array.isArray(color) ? color[1] : color.g);
    const b = Number(Array.isArray(color) ? color[2] : color.b);
    const a = Array.isArray(color) ? (color.length > 3 ? Number(color[3]) : 1) : Number(color.a ?? 1);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    if (a <= 0) return null;
    const to2 = (n: number) =>
      Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
    return { hex: `${to2(r)}${to2(g)}${to2(b)}`, transparency: Math.round((1 - Math.min(1, a)) * 100) };
  }

  /**
   * Full-view screenshot at native aspect, raced against a timeout so a
   * frozen 3D-headless takeScreenshot can never hang the export.
   */
  private async _takeScreenshot(view: any, format: 'png' | 'jpeg'): Promise<string | null> {
    if (!view?.takeScreenshot) return null;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const opts: any = {
      width: Math.round((Number(view.width) || 1280) * pixelRatio),
      height: Math.round((Number(view.height) || 720) * pixelRatio),
      format,
    };
    if (format === 'jpeg') opts.quality = 90;
    try {
      const shot: any = await Promise.race([
        view.takeScreenshot(opts),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SCREENSHOT_TIMEOUT_MS)),
      ]);
      return shot?.dataUrl ?? null;
    } catch {
      return null;
    }
  }

  // ── 3D → 2D export prompt ──────────────────────────────────────────────────

  /**
   * Friendly choice dialog shown before an editable export from the 3D scene.
   * Resolves 'switch' (go 2D first), 'stay' (export from 3D), or 'cancel'
   * (Esc / backdrop click — no export).
   */
  private _confirm3DExport(): Promise<'switch' | 'stay' | 'cancel'> {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.cssText =
        'position:fixed;inset:0;z-index:10500;background:rgba(0,0,0,0.45);' +
        'display:flex;align-items:center;justify-content:center;';
      const card = document.createElement('div');
      card.style.cssText =
        'max-width:420px;margin:16px;padding:18px 20px;border-radius:10px;' +
        'background:rgba(24,29,34,0.97);border:1px solid rgba(255,255,255,0.15);' +
        'color:#dde3e8;font:13px/1.5 system-ui,sans-serif;' +
        'box-shadow:0 10px 34px rgba(0,0,0,0.5);';
      const btnBase =
        'padding:7px 14px;border-radius:6px;cursor:pointer;font:inherit;white-space:nowrap;';
      card.innerHTML = `
        <div style="font-size:15px;font-weight:600;margin-bottom:8px;">Export from 3D?</div>
        <div style="margin-bottom:16px;color:#b9c2cb;">
          In 3D, terrain elevation can nudge the editable shapes slightly off
          their map positions. The 2D map gives exact, pixel-aligned results.
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button data-choice="stay" style="${btnBase}background:rgba(255,255,255,0.08);color:#dde3e8;border:1px solid rgba(255,255,255,0.18);">Export in 3D anyway</button>
          <button data-choice="switch" style="${btnBase}background:#2d6cdf;color:#fff;border:1px solid #2d6cdf;">Switch to 2D &amp; export</button>
        </div>`;

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          done('cancel');
        }
      };
      const done = (choice: 'switch' | 'stay' | 'cancel') => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(choice);
      };
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) done('cancel');
      });
      card.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('[data-choice]') as HTMLElement | null;
        if (btn) done(btn.dataset.choice as 'switch' | 'stay');
      });
      document.addEventListener('keydown', onKey, true);

      backdrop.appendChild(card);
      document.body.appendChild(backdrop);
      (card.querySelector('[data-choice="switch"]') as HTMLElement | null)?.focus();
    });
  }

  /**
   * Toggle the host app to the 2D map (same as the top-bar 2D/3D button) and
   * wait — bounded — for the MapView to become ready. Returns the 2D view, or
   * null when no switch hook is available / it never settles.
   */
  private async _switchTo2D(): Promise<any | null> {
    if (this._view?.type === '2d') return this._view;
    try {
      const toggle = (window as any).pams8SwitchView;
      if (typeof toggle === 'function') {
        toggle();
      } else {
        (document.getElementById('switch-btn') as HTMLElement | null)?.click();
      }
    } catch {
      return null;
    }
    for (let i = 0; i < 60; i++) {
      const v = this._view;
      if (v?.type === '2d' && v.ready) {
        await this._settle(v);
        return v;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return this._view?.type === '2d' ? this._view : null;
  }

  /** Give the renderer a beat to draw newly-revealed graphics before shooting. */
  private _settle(view: any): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      try {
        // whenOnce on updating=false when available; always bounded by timer.
        const handle = (view as any)?.watch?.('updating', (updating: boolean) => {
          if (!updating) {
            handle?.remove?.();
            finish();
          }
        });
        if ((view as any)?.updating === false) {
          handle?.remove?.();
          finish();
        }
      } catch {
        /* fall through to timer */
      }
      setTimeout(finish, 1500);
    });
  }
}

export default PptxExporter;
