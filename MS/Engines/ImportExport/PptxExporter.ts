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
 * Deck-level: slide size is a preset or a custom `defineLayout()` size, the
 * package carries document properties (title/author/company/subject/revision),
 * and slide numbers, zip compression and a classification/footer slide master
 * are all opt-in from `exportTools` settings.
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
import type {
  ArrowHead,
  Slide as BriefingSlide,
  SlideOverlay,
} from '../Briefing/BriefingTypes';
import {
  coveredCells,
  DEFAULT_TABLE_HEADER_FILL,
  DEFAULT_TABLE_STROKE_WIDTH,
  mergeAt,
  normalizeMerges,
  normalizeTable,
} from '../Briefing/OverlayTable';
import {
  DEFAULT_BLOCK_HEAD_RATIO,
  DEFAULT_TAC_WIDTH,
  DEFAULT_TEXT_COLOR,
  blockArrowPoints,
  listIndentLevel,
  parseColor,
} from '../Briefing/OverlayFabric';
import { renderMilSym } from '../Briefing/MilSymFactory';
import { chartSpecToPptx } from '../Briefing/ChartFactory';
import {
  isSafeLinkUrl,
  isUsableLink,
  resolveJumpForExport,
  UNEXPORTABLE_JUMPS,
} from '../Briefing/SlideLinks';
import {
  chromeBands,
  chromeForSlide,
  hasChrome,
  resolveChrome,
  type ChromeTokenContext,
  type DeckChrome,
} from '../Briefing/SlideChrome';
import { buildTacArrowOutline, outlineBounds } from '../Briefing/TacArrowGeometry';
import {
  commentAnchorEighths,
  injectPptxComments,
  PPTX_MIME,
  type PptxCommentRecord,
} from './PptxComments';

const ENGINE_NAME = 'PptxExporter';

/**
 * takeScreenshot can hang in a 3D SceneView under headless preview (frozen
 * rAF) — every screenshot is raced against this timeout so a stuck call can
 * never freeze the export. 3D export is verified in a real browser only.
 */
const SCREENSHOT_TIMEOUT_MS = 15000;

/**
 * Default slide size — pptxgenjs' LAYOUT_16x9 is 10 × 5.625 inches. The live
 * size is `_slideW`/`_slideH` on the instance (see `_applyLayout`), because a
 * deck can also be 16:10, 4:3, WIDE or a custom `defineLayout()` size; these
 * two are only the fallback before any export has run.
 */
const DEFAULT_SLIDE_W_IN = 10;
const DEFAULT_SLIDE_H_IN = 5.625;

/**
 * The preset layouts pptxgenjs ships, in inches. 'custom' is not here — it
 * comes from `exportTools.deckWidth`/`deckHeight` through `defineLayout()`.
 */
const LAYOUT_PRESETS: Record<string, { name: string; w: number; h: number }> = {
  '16x9': { name: 'LAYOUT_16x9', w: 10, h: 5.625 },
  '16x10': { name: 'LAYOUT_16x10', w: 10, h: 6.25 },
  '4x3': { name: 'LAYOUT_4x3', w: 10, h: 7.5 },
  wide: { name: 'LAYOUT_WIDE', w: 13.3, h: 7.5 },
};

/** Offline browser bundle — see the file banner above. */
const PPTXGENJS_SCRIPT_SRC = 'MS/ThirdParty/PptxGenJS/pptxgen.bundle.js';

/**
 * Nominal pixels per slide inch. Only ever used to give the geometry helpers
 * (which think in pixels) a working scale, and to size raster re-renders.
 */
const PPTX_EXPORT_DPI = 96;
/** Military symbols re-render at this multiple of their on-slide size. */
const MILSYM_EXPORT_SCALE = 4;
/** Block-arrow kinds — head size decides preset vs exact geometry on export. */
const BLOCK_ARROW_KINDS: ReadonlySet<string> = new Set([
  'blockArrow',
  'blockArrowDouble',
  'chevron',
]);

/** Name of the generated slide master. Referenced by `addSlide({ masterName })`. */
const MASTER_NAME = 'PAMS8_MASTER';

/** Box-persisted overlay kinds → native pptx preset shapes. */
const OVERLAY_SHAPE_TYPES: Partial<Record<SlideOverlay['kind'], string>> = {
  rect: 'rect',
  ellipse: 'ellipse',
  diamond: 'diamond',
  triangle: 'triangle',
  star: 'star5',
  callout: 'wedgeRoundRectCallout',
  // The block arrows exist natively in OOXML, so they land in PowerPoint as
  // real, editable arrow shapes rather than as flattened freeforms.
  blockArrow: 'rightArrow',
  blockArrowDouble: 'leftRightArrow',
  chevron: 'chevron',
};

/**
 * Arrow terminators → OOXML line-end types. Approximations, all of them
 * lossless in position but not in detail: OOXML arrowheads always paint filled
 * in the line colour, so the outline variants collapse onto their solid twins,
 * and there is no perpendicular-bar terminator at all (it drops to none).
 */
const PPTX_ARROW_TYPES: Record<ArrowHead, string> = {
  none: 'none',
  arrow: 'arrow',
  triangle: 'triangle',
  triangleOutline: 'triangle',
  bar: 'none',
  circle: 'oval',
  circleOutline: 'oval',
  diamond: 'diamond',
  diamondOutline: 'diamond',
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
  /**
   * Slide size. A preset key ('16x9' | '16x10' | '4x3' | 'wide') or 'custom',
   * which takes its size from `exportTools.deckWidth`/`deckHeight` (pixels at
   * 96 DPI) via `defineLayout()`. Default '16x9' — unchanged from before this
   * option existed.
   */
  layout?: '16x9' | '16x10' | '4x3' | 'wide' | 'custom';
  /**
   * Zip-deflate the package. Images are already compressed so a flat
   * screenshot deck barely shrinks, but Mode B's shape XML compresses several
   * times over. Costs CPU on the way out.
   */
  compress?: boolean;
  /** Stamp a slide number on every slide. */
  slideNumbers?: boolean;
  /**
   * Build the deck on a generated slide master — classification banners,
   * footer strip, and a real `title` placeholder (which is what puts titles in
   * PowerPoint's outline view). Banner text comes from
   * `exportTools.classification`, footer from `exportTools.footerText`.
   */
  useMaster?: boolean;
  /** Document properties written into the pptx core part. */
  meta?: PptxDeckMeta;
  /**
   * What to do with the finished package. Default 'download' triggers the
   * browser save and returns nothing, which is every existing caller.
   *
   * The others RETURN the deck instead — for storing it into a plan, POSTing
   * it to a service, or handing it to another tool — without a save dialog.
   */
  output?: 'download' | 'blob' | 'base64' | 'arraybuffer';
}

/** What a non-'download' export hands back. */
export interface PptxExportResult {
  fileName: string;
  /** Slides actually written (build frames counted individually). */
  slides: number;
  /** Bytes of the finished package. */
  bytes: number;
  blob?: Blob;
  /** Base64 WITHOUT a data: prefix — ready for an API body. */
  base64?: string;
  arrayBuffer?: ArrayBuffer;
}

/**
 * PowerPoint document properties. Nothing in the app owns these today (a Plan
 * has no author/title), so they come from `exportTools` settings or the
 * caller — but an exported operational plan carrying no provenance at all is
 * worse than one carrying configured defaults.
 */
export interface PptxDeckMeta {
  title?: string;
  author?: string;
  company?: string;
  subject?: string;
  revision?: string;
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

/**
 * A hyperlink in pptxgenjs' option shape — either an internal slide jump or an
 * external URL. pptxgenjs takes exactly one of `slide` / `url`.
 */
interface PptxHyperlink {
  /** 1-based pptx slide number — pptxgenjs names parts in add order. */
  slide?: number;
  /** Absolute external URL (already scheme-checked by SlideLinks). */
  url?: string;
  tooltip?: string;
}

/**
 * Everything the overlay emit needs to turn an OverlayLink into a pptx slide
 * number. Built once per export (see the pre-pass in `exportBriefing`) because
 * a link on the first slide can target the last one, so the mapping must be
 * complete before any shape is written.
 */
interface LinkExportCtx {
  /** Briefing Slide.id → the pptx slide number of the FIRST part it emits. */
  numberById: ReadonlyMap<string, number>;
  /** Slide.id in briefing order — resolves relative jumps to a fixed slide. */
  order: readonly string[];
  /**
   * Parallel to `order`: is that slide hidden? A relative jump baked into the
   * deck must land where PLAYBACK would land, so 'next' steps over hidden
   * slides here exactly as it does in present mode.
   */
  hidden: readonly boolean[];
  /** Index into `order` of the slide currently being emitted. */
  index: number;
  /**
   * Overlay ids whose link could not be written, by reason — see
   * `_warnDroppedLinks`. Sets rather than counters because `explodeBuilds` emits
   * the same overlays once per build frame, and the log should report how many
   * LINKS were lost, not how many times each was skipped.
   */
  dropped: { unexportable: Set<string>; missing: Set<string>; table: Set<string> };
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
   * Deck-level choices resolved once per export, then read by the per-slide
   * emitters. Instance state rather than threaded parameters because every one
   * of them is constant for the whole deck and `_addSlide` already carries a
   * long per-slide meta object.
   */
  private _slideW = DEFAULT_SLIDE_W_IN;
  private _slideH = DEFAULT_SLIDE_H_IN;
  private _slideNumbers = false;
  /** Master name to pass to `addSlide`, or null when the deck uses no master. */
  private _masterName: string | null = null;
  /**
   * The live PptxGenJS instance for the export in flight. Chart emit needs it
   * because `ChartType` is an instance property on the presentation object,
   * not a module export.
   */
  private _pptx: any = null;
  /**
   * Whether a table marked `autoPage` may actually flow onto extra slides.
   *
   * Auto-paging INSERTS slides mid-deck, and the link pre-pass in
   * `exportDeck` has to number every slide before the first shape is emitted —
   * so a deck that contains overlay links cannot also let tables page without
   * some links silently pointing at the wrong slide. Comments are corrected
   * exactly (see `_pagedExtra`); links cannot be, so paging stands down
   * instead, and says so.
   */
  private _allowAutoPage = true;
  /** Extra slides the last `_addSlide` created by auto-paging a table. */
  private _pagedExtra = 0;
  /**
   * Vertical space reserved for master furniture (banners, footer). A master
   * paints BEHIND slide content in PowerPoint, so a full-bleed screenshot would
   * simply cover a classification banner — the map has to be fitted into what
   * is left instead. `_containFitAspect` reads these.
   */
  private _insetTop = 0;
  private _insetBottom = 0;
  /**
   * The deck's resolved chrome (see SlideChrome), or null when the deck has
   * none. Read per slide by `_addSlide` so a slide that opts out can suppress
   * both the furniture and the insets it would otherwise reserve.
   */
  private _chrome: DeckChrome | null = null;
  /** Deck length for a `{PAGES}` / "of N" stamp; 0 when it cannot be trusted. */
  private _chromeTotal = 0;
  /**
   * The insets in force for the slide being emitted — `_insetTop`/`_insetBottom`
   * for a normal slide, both 0 for one that opts out of the chrome. Set fresh at
   * the top of every `_addSlide`, which is why the deck-level pair above can
   * stay immutable for the whole export instead of being saved and restored
   * around each slide. `_containFitAspect` reads THESE.
   */
  private _slideInsetTop = 0;
  private _slideInsetBottom = 0;

  /**
   * Resolve the deck's slide size and tell pptxgenjs about it. A preset maps
   * straight onto pptxgenjs' own layout names; 'custom' reads
   * `exportTools.deckWidth`/`deckHeight`, which are PIXELS (the settings have
   * always been named and defaulted that way — 1280×720), converted at
   * PPTX_EXPORT_DPI. 1280×720 therefore lands on 13.33×7.5in, i.e. exactly
   * LAYOUT_WIDE, which is what those defaults always meant.
   */
  private _applyLayout(pptx: any, choice: string): void {
    if (choice === 'custom') {
      const cfg = this._cfg;
      const wPx = Number(cfg.deckWidth) || 1280;
      const hPx = Number(cfg.deckHeight) || 720;
      // PowerPoint rejects degenerate slide sizes; clamp to something sane
      // rather than emitting a deck that will not open.
      const w = Math.min(56, Math.max(1, wPx / PPTX_EXPORT_DPI));
      const h = Math.min(56, Math.max(1, hPx / PPTX_EXPORT_DPI));
      pptx.defineLayout({ name: 'PAMS8_CUSTOM', width: w, height: h });
      pptx.layout = 'PAMS8_CUSTOM';
      this._slideW = w;
      this._slideH = h;
      EngineLogger.nextStep(
        ENGINE_NAME,
        `Custom slide size ${wPx}×${hPx}px → ${w.toFixed(2)}×${h.toFixed(2)}in`,
      );
      return;
    }
    const preset = LAYOUT_PRESETS[choice] ?? LAYOUT_PRESETS['16x9'];
    pptx.layout = preset.name;
    this._slideW = preset.w;
    this._slideH = preset.h;
  }

  /**
   * Deck-level half of a header/footer token context — the document properties
   * every slide shares. Per-slide fields (`{SLIDE}`, `{SECTION}`, `{PAGE}`) are
   * merged on top of this by `_slideTokens`.
   */
  private _deckTokens(): ChromeTokenContext {
    const cfg = this._cfg;
    return {
      deckTitle: String(cfg.deckTitle ?? ''),
      author: String(cfg.author ?? ''),
      company: String(cfg.company ?? ''),
      subject: String(cfg.subject ?? ''),
    };
  }

  /**
   * Define the deck's slide master from the resolved `DeckChrome` — the
   * classification banners, the header and footer strips, the slide-number
   * stamp, and a real `title` placeholder so slide titles land in PowerPoint's
   * outline view and inherit master styling instead of being orphan text boxes.
   *
   * Geometry comes from `SlideChrome.chromeBands`, which the slide editor and
   * present mode draw from too — so what an author sees on the canvas and what
   * the recipient opens in PowerPoint cannot drift apart.
   *
   * The master paints the STRIPS but not their text: a master is deck-wide, so
   * a header of `{SECTION} · {PAGE}` could never resolve there. Strip text is
   * emitted per slide instead by `_emitChromeText`, over the rect the master
   * already laid down.
   *
   * Sets `_insetTop` / `_insetBottom` so the map is fitted between the
   * furniture rather than over it (see the field comment).
   *
   * Returns the master name, or null when the deck is being built without one.
   */
  private _defineMaster(pptx: any, chrome: DeckChrome | null, total: number): string | null {
    this._insetTop = 0;
    this._insetBottom = 0;
    if (!hasChrome(chrome)) return null;

    const bands = chromeBands(chrome, this._deckTokens());
    const objects: any[] = [];
    // Band heights are fractions of slide height (see SlideChrome's header), so
    // they scale with a custom slide size instead of staying a fixed number of
    // inches. On both standard layouts (7.5in tall) they land on the 0.26 /
    // 0.22in strips this exporter has always drawn.
    const inches = (frac: number): number => frac * this._slideH;

    for (const band of bands) {
      const h = inches(band.h);
      const y = band.edge === 'top' ? this._insetTop : this._slideH - this._insetBottom - h;
      objects.push({ rect: { x: 0, y, w: '100%', h, fill: { color: band.fill } } });
      // Only the classification banner's text is deck-wide, so only it can live
      // on the master. It also must NOT follow the recipient's theme — a marking
      // that recolours is a marking you cannot trust.
      if (band.role === 'classification') {
        objects.push({
          text: {
            text: band.text,
            options: {
              x: 0,
              y,
              w: '100%',
              h,
              fontSize: Math.round(inches(band.fontSize) * 72),
              bold: !!band.bold,
              color: band.color,
              align: band.align,
              valign: 'middle',
              margin: 0,
            },
          },
        });
      }
      if (band.edge === 'top') this._insetTop += h;
      else this._insetBottom += h;
    }

    // The title sits over the map (a map briefing wants the imagery full
    // height), so the placeholder overlaps the content rect by design — it is
    // the outline-view hook and the style carrier, not a layout reservation.
    objects.push({
      placeholder: {
        options: {
          name: 'title',
          type: 'title',
          x: 0.3,
          y: this._insetTop + 0.1,
          w: this._slideW - 0.6,
          h: 0.6,
          fontSize: 24,
          bold: true,
          color: 'FFFFFF',
          align: 'left',
          valign: 'top',
          margin: 0,
        },
        text: '',
      },
    });

    // Built before the master literal, because the "of N" label it may add goes
    // into `objects` and reading that as a mutation-after-assignment is exactly
    // the kind of thing that breaks on a later edit.
    let slideNumber: any = null;
    const footerBand = bands.find((b) => b.role === 'footer');
    if (footerBand && chrome!.slideNumbers) {
      const h = inches(footerBand.h);
      const fontSize = Math.round(inches(footerBand.fontSize) * 72);
      // The strip's y — `_insetBottom` has finished accumulating, so this is the
      // top of the bottom-most band that is not a banner.
      const y = this._slideH - this._insetBottom;
      const total_ = this._numberTotal(chrome!, total);
      const stampW = 0.7;
      const totalW = total_ ? 0.5 : 0;
      // PowerPoint's own slide-number FIELD, not static text, so the stamp
      // renumbers itself if the recipient reorders the deck. It lives on the
      // master so one definition covers every slide.
      slideNumber = {
        x: this._slideW - 0.2 - stampW - totalW,
        y,
        w: stampW,
        h,
        align: 'right',
        valign: 'middle',
        fontSize,
        color: this._chromeColor('dim'),
      };
      // "of N" has no PowerPoint field — OOXML has no total-slides placeholder
      // at all — so the total is static text beside the live number.
      if (total_) {
        objects.push({
          text: {
            text: `/ ${total_}`,
            options: {
              x: this._slideW - 0.2 - totalW,
              y,
              w: totalW,
              h,
              fontSize,
              color: this._chromeColor('dim'),
              align: 'left',
              valign: 'middle',
              margin: 0,
            },
          },
        });
      }
    }

    const master: any = {
      title: MASTER_NAME,
      background: { color: '101418' },
      objects,
    };
    if (slideNumber) master.slideNumber = slideNumber;
    pptx.defineSlideMaster(master);
    const summary = bands
      .filter((b) => b.edge === 'top' || b.role !== 'classification')
      .map((b) => (b.role === 'classification' ? `"${b.text}"` : b.role))
      .join(', ');
    EngineLogger.nextStep(ENGINE_NAME, `Slide master applied — ${summary}`);
    return MASTER_NAME;
  }

  /**
   * The static total to print beside the live slide-number field, or 0 for none.
   * `total` reaches here as 0 whenever the emitted slide count cannot be known
   * up front (see `exportDeck`), so an untrustworthy "of N" is simply omitted
   * rather than printed wrong.
   */
  private _numberTotal(chrome: DeckChrome, total: number): number {
    return chrome.numberFormat === 'n-of-m' && total > 0 ? total : 0;
  }

  /**
   * Emit this slide's header / footer strip TEXT over the rects the master
   * painted. Per slide rather than on the master because the templates may use
   * per-slide tokens (`{SLIDE}`, `{SECTION}`, `{PAGE}`) — see `_defineMaster`.
   *
   * Does nothing when the deck has no chrome, or when this slide opts out
   * (`Slide.noChrome`, or the deck's `skipFirst` on slide 1) — in which case the
   * caller has already zeroed the insets so the content fills the page.
   */
  private _emitChromeText(slide: any, chrome: DeckChrome | null, ctx: ChromeTokenContext): void {
    if (!hasChrome(chrome)) return;
    const inches = (frac: number): number => frac * this._slideH;
    let top = 0;
    let bottom = 0;
    for (const band of chromeBands(chrome, ctx)) {
      const h = inches(band.h);
      const y = band.edge === 'top' ? top : this._slideH - bottom - h;
      if (band.edge === 'top') top += h;
      else bottom += h;
      // Banner text is already on the master (it is deck-wide), and a band with
      // nothing to say needs no text box at all.
      if (band.role === 'classification') continue;
      const fontSize = Math.round(inches(band.fontSize) * 72);
      // The stamp's own width is reserved at the right end so a long footer
      // cannot run underneath it.
      const stampGap = band.rightText ? 1.2 : 0.4;
      if (band.text) {
        slide.addText(band.text, {
          x: 0.2,
          y,
          w: Math.max(0.5, this._slideW - 0.2 - stampGap),
          h,
          fontSize,
          color: this._chromeColor('dim'),
          align: band.align,
          valign: 'middle',
          margin: 0,
        });
      }
    }
  }

  /**
   * Document properties. pptxgenjs writes these into docProps/core.xml, so a
   * recipient can see where the deck came from in PowerPoint's File → Info.
   */
  private _applyMeta(pptx: any, override?: PptxDeckMeta): void {
    const cfg = this._cfg;
    const meta: PptxDeckMeta = {
      title: override?.title ?? cfg.deckTitle ?? 'PAMS8 Briefing',
      author: override?.author ?? cfg.author ?? '',
      company: override?.company ?? cfg.company ?? '',
      subject: override?.subject ?? cfg.subject ?? '',
      revision: override?.revision ?? cfg.revision ?? '',
    };
    // Assigned only when non-empty — pptxgenjs has its own defaults and an
    // empty string would overwrite them with blanks.
    if (meta.title) pptx.title = meta.title;
    if (meta.author) pptx.author = meta.author;
    if (meta.company) pptx.company = meta.company;
    if (meta.subject) pptx.subject = meta.subject;
    if (meta.revision) pptx.revision = String(meta.revision);

    // Deck default fonts. Set on the theme rather than per-object so a
    // recipient can restyle the whole deck from PowerPoint's font pane.
    const head = String(cfg.headFont ?? '').trim();
    const body = String(cfg.bodyFont ?? '').trim();
    if (head || body) {
      pptx.theme = {
        ...(head ? { headFontFace: head } : {}),
        ...(body ? { bodyFontFace: body } : {}),
      };
    }
    // Right-to-left decks (Arabic, Hebrew, Farsi briefings).
    if (cfg.rtl === true) pptx.rtlMode = true;
  }

  /**
   * Ink for generated chrome — the title, footer and slide-number text the
   * exporter draws itself.
   *
   * With `useSchemeColors` these become theme references (`pptx.SchemeColor.*`)
   * instead of literal hexes, so the deck re-skins when the recipient picks a
   * different PowerPoint theme. Author-chosen overlay colours are NEVER routed
   * through here: those are decisions the briefer made, and a classification
   * banner in particular has to keep the colour its marking demands.
   */
  private _chromeColor(role: 'text' | 'dim' | 'background'): string {
    const pptx = this._pptx;
    if (this._cfg.useSchemeColors === true && pptx?.SchemeColor) {
      if (role === 'text') return pptx.SchemeColor.text1;
      if (role === 'dim') return pptx.SchemeColor.text2;
      return pptx.SchemeColor.background1;
    }
    return role === 'text' ? 'FFFFFF' : role === 'dim' ? 'A9B4C0' : '101418';
  }

  /**
   * Export the deck: every Briefing slide when the Briefing engine has
   * slides, otherwise a single slide of the current view.
   */
  public async exportDeck(
    options: PptxExportOptions = {},
  ): Promise<PptxExportResult | undefined> {
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
    const layoutChoice = options.layout ?? cfg.layout ?? '16x9';
    const compress = options.compress ?? cfg.compress === true;
    const slideNumbers = options.slideNumbers ?? cfg.slideNumbers === true;
    const useMaster = options.useMaster ?? cfg.useMaster === true;
    const output = options.output ?? 'download';

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
    this._pptx = pptx;
    // Layout FIRST — every inch-space computation below (contain-fit, overlay
    // placement, the master) reads _slideW/_slideH.
    this._applyLayout(pptx, layoutChoice);
    this._applyMeta(pptx, options.meta);
    this._slideNumbers = slideNumbers;

    const briefing: any = (window as any).briefingEngine;
    const slides: readonly BriefingSlide[] = briefing?.getSlides?.() ?? [];

    // Read BEFORE the master is defined — the master is built from this. The
    // deck's own chrome wins over the `exportTools.*` defaults field by field;
    // a briefing saved before chrome was part of the document has none, and so
    // exports exactly the chrome its settings always gave it.
    const resolvedChrome = resolveChrome(briefing?.getChrome?.(), { ...cfg, useMaster });
    this._chrome = hasChrome(resolvedChrome) ? resolvedChrome : null;
    // An "of N" total is only honest when the emitted slide count matches the
    // briefing's: exploding builds inserts slides, so the stamp drops to a bare
    // number rather than printing a total that is wrong on every slide.
    this._chromeTotal = explodeBuilds ? 0 : slides.length;
    if (explodeBuilds && this._chrome?.numberFormat === 'n-of-m') {
      EngineLogger.nextStep(
        ENGINE_NAME,
        'Slide numbers: "n of m" needs a fixed deck length — exploding builds adds slides, so the total is omitted',
      );
    }
    // After the layout: the master is sized in slide inches.
    this._masterName = this._defineMaster(pptx, this._chrome, this._chromeTotal);

    // Sections must all exist before the first addSlide that names one —
    // pptxgenjs matches by title and silently ignores an unknown one.
    const sections: string[] = [];
    for (const s of slides) {
      const t = String(s.section ?? '').trim();
      if (t && !sections.includes(t)) sections.push(t);
    }
    // See `_allowAutoPage`. Decided once, over the whole briefing, because a
    // link on any slide can target any other.
    const anyLinks = slides.some((s) => (s.overlays ?? []).some((o) => isUsableLink(o.link)));
    const anyAutoPage = slides.some((s) => (s.overlays ?? []).some((o) => o.autoPage));
    this._allowAutoPage = !anyLinks;
    if (anyAutoPage && anyLinks) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        'Table auto-paging is off for this deck: it inserts slides, which would repoint the slide links this briefing uses. Remove the links or the auto-page flag to use it.',
      );
    }

    for (const title of sections) pptx.addSection({ title });
    if (sections.length) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `${sections.length} slide section(s): ${sections.join(', ')}`,
      );
    }

    // Run diagnostics — so an all-raster editable export can explain itself.
    const stats = { shapes: 0 };
    let emitted = 0;
    const commentRecords: PptxCommentRecord[] = [];
    let skippedResolved = 0;
    // pptxgenjs names slide parts in add order, so the pptx slide number is
    // just the running emit count.
    let pptxSlideNo = 0;
    // Overlay links point at a briefing slide, but pptxgenjs wants the pptx
    // slide NUMBER — and with explodeBuilds one briefing slide becomes several
    // pptx slides. A link on slide 1 can target slide 9, so the whole mapping
    // has to exist before the first shape is emitted; the per-slide emit counts
    // are deterministic, so a cheap pre-pass gets it.
    const numberById = new Map<string, number>();
    let firstPartNo = 0;
    for (const s of slides) {
      numberById.set(s.id, firstPartNo + 1);
      // Mirrors the emit loop below exactly — a screen-only slide is one part;
      // an exploded build sequence is base + one frame per step.
      const screenOnly = !s.view?.extent && !s.view?.camera && !!s.backgroundDataUrl;
      const builds = s.builds ?? [];
      firstPartNo += !screenOnly && explodeBuilds && builds.length ? builds.length + 1 : 1;
    }
    const linkCtx: LinkExportCtx = {
      numberById,
      order: slides.map((s) => s.id),
      hidden: slides.map((s) => !!s.hidden),
      index: 0,
      dropped: { unexportable: new Set(), missing: new Set(), table: new Set() },
    };
    if (slides.length && briefing) {
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        // Which slide's relative jumps ('next', 'prev') are being resolved.
        linkCtx.index = i;
        // Screen-only slide (imported PPTX — no extent/camera): its stored
        // background IS the slide. Nothing to apply to the map, no screenshot,
        // no Mode-B projection.
        if (!slide.view?.extent && !slide.view?.camera && slide.backgroundDataUrl) {
          await this._addSlide(pptx, view, format, 'flat', {
            title: slide.title,
            notes: includeNotes ? slide.notes : undefined,
            overlays: slide.overlays,
            links: linkCtx,
            background: slide.backgroundDataUrl,
            hidden: slide.hidden,
            section: slide.section,
            slideIndex: i,
            noChrome: slide.noChrome,
            pageNumber: pptxSlideNo + 1,
          }, stats);
          emitted++;
          pptxSlideNo++;
          this._collectComments(commentRecords, slide, pptxSlideNo, view, (n) => {
            skippedResolved += n;
          });
          // An auto-paged table appended slides AFTER this one; the running
          // number must clear them or the next slide's comments land on a
          // continuation page.
          pptxSlideNo += this._pagedExtra;
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
              links: linkCtx,
              // Every frame of an exploded build inherits the flag — a hidden
              // slide must not leak back in as a run of visible build frames.
              hidden: slide.hidden,
              section: slide.section,
              slideIndex: i,
              noChrome: slide.noChrome,
              pageNumber: pptxSlideNo + 1,
            }, stats);
            emitted++;
            pptxSlideNo++;
            // Only the first pptx slide of a build sequence carries the
            // comments — otherwise every build frame would repeat them.
            if (reveal === 0) {
              this._collectComments(commentRecords, slide, pptxSlideNo, view, (n) => {
                skippedResolved += n;
              });
            }
            pptxSlideNo += this._pagedExtra;
          }
        } else {
          await briefing.applySlideForExport(i);
          await this._settle(view);
          await this._addSlide(pptx, view, format, mode, {
            title: slide.title,
            notes: includeNotes ? slide.notes : undefined,
            overlays: slide.overlays,
            links: linkCtx,
            hidden: slide.hidden,
            section: slide.section,
            slideIndex: i,
            noChrome: slide.noChrome,
            pageNumber: pptxSlideNo + 1,
          }, stats);
          emitted++;
          pptxSlideNo++;
          this._collectComments(commentRecords, slide, pptxSlideNo, view, (n) => {
            skippedResolved += n;
          });
          pptxSlideNo += this._pagedExtra;
        }
      }
    } else {
      // No briefing — export the current view as a one-slide deck.
      await this._addSlide(
        pptx,
        view,
        format,
        mode,
        { title: 'Current view', slideIndex: 0, pageNumber: 1 },
        stats,
      );
      emitted++;
      pptxSlideNo++;
    }

    // pptxgenjs cannot write comments, so the package is built in memory and
    // reopened to inject them — which also means the download becomes ours.
    const pkg: ArrayBuffer = await pptx.write({ outputType: 'arraybuffer', compression: compress });
    let blob: Blob;
    if (commentRecords.length) {
      try {
        blob = await injectPptxComments(pkg, commentRecords, compress);
      } catch (err) {
        // Comments are a best-effort addition on top of a deck that already
        // succeeded (e.g. a slide with a failed screenshot can plausibly be
        // missing the slide rels part injection needs) — losing the whole
        // export over them would be far worse than losing just the comments.
        EngineLogger.error(
          ENGINE_NAME,
          `Comment injection failed — deck exported WITHOUT comments: ${err}`,
        );
        blob = new Blob([pkg], { type: PPTX_MIME });
      }
    } else {
      blob = new Blob([pkg], { type: PPTX_MIME });
    }
    // 'download' is the default and every pre-existing caller; the other modes
    // deliberately do NOT save, so a programmatic export cannot surprise the
    // user with a file dialog.
    if (output === 'download') this._downloadBlob(blob, fileName);

    if (mode === 'editable' && stats.shapes === 0) {
      EngineLogger.error(
        ENGINE_NAME,
        'No graphics could become editable shapes on this export — only simple lines/areas (freehand, AutoShape) and text labels convert; unit icons and decorated tactical graphics always stay in the image. In 3D, graphics behind the camera or beyond the horizon also stay in the image.',
      );
    }
    const hiddenOut = slides.reduce((n, s) => n + (s.hidden ? 1 : 0), 0);
    EngineLogger.success(
      ENGINE_NAME,
      `PPTX exported — ${emitted} slides${
        mode === 'editable' ? `, ${stats.shapes} editable shapes` : ''
      }${commentRecords.length ? `, ${commentRecords.length} comment entries` : ''}${
        hiddenOut ? `, ${hiddenOut} hidden (PowerPoint skips them too)` : ''
      }, ${this._slideW.toFixed(2)}×${this._slideH.toFixed(2)}in${
        compress ? ', compressed' : ''
      } → ${fileName} (${Math.round(blob.size / 1024)} KB)`,
    );
    if (skippedResolved) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `${skippedResolved} resolved comment thread(s) were not exported`,
      );
    }
    this._warnDroppedLinks(linkCtx);

    if (output === 'download') return;
    const result: PptxExportResult = { fileName, slides: emitted, bytes: blob.size };
    if (output === 'blob') result.blob = blob;
    else if (output === 'arraybuffer') result.arrayBuffer = await blob.arrayBuffer();
    else if (output === 'base64') result.base64 = await this._blobToBase64(blob);
    return result;
  }

  /** Blob → bare base64 (no `data:` prefix), via FileReader's data URL. */
  private _blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
      fr.onload = () => {
        const s = String(fr.result ?? '');
        const comma = s.indexOf(',');
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      fr.readAsDataURL(blob);
    });
  }

  /**
   * What the link emit could not carry into PowerPoint. Each case is a real
   * limitation rather than a bug, so it is reported instead of approximated:
   *
   * - `unexportable` — 'last slide viewed' / 'end show'. pptxgenjs can only
   *   write a fixed slide link, and pointing either of these at a concrete
   *   slide would be silently WRONG, not merely lossy. Inside PAMS they still
   *   work; only the exported deck loses them.
   * - `missing`      — a relative jump with nowhere to go ('next' on the last
   *   slide), so there is no slide number to write.
   * - `table`        — PowerPoint puts a table in a graphicFrame, which has no
   *   `a:hlinkClick`; only shapes, text boxes and pictures can carry one.
   */
  private _warnDroppedLinks(ctx: LinkExportCtx): void {
    const parts: string[] = [];
    const { unexportable, missing, table } = ctx.dropped;
    if (unexportable.size) parts.push(`${unexportable.size} × 'last viewed' / 'end show'`);
    if (missing.size) parts.push(`${missing.size} jump(s) with no target slide`);
    if (table.size) parts.push(`${table.size} link(s) on tables / charts`);
    if (!parts.length) return;
    EngineLogger.nextStep(
      ENGINE_NAME,
      `Links PowerPoint cannot represent — dropped: ${parts.join(', ')}`,
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
      /** Absent when there is no briefing (the single-view export path). */
      links?: LinkExportCtx;
      /** Screen-only slide raster — used instead of a live map screenshot. */
      background?: string;
      /**
       * Briefing slide marked hidden. Emitted as a real hidden PowerPoint slide
       * (`<p:sld show="0">`) rather than dropped, so the deck round-trips: the
       * content survives, and PowerPoint skips it in its own slideshow exactly
       * as present mode does.
       */
      hidden?: boolean;
      /** PowerPoint section title — must already have been declared. */
      section?: string;
      /**
       * 0-based briefing slide index. Decides whether the deck's `skipFirst`
       * applies; absent (the single-view path) reads as slide 0.
       */
      slideIndex?: number;
      /** This slide opts out of the deck's chrome — see Slide.noChrome. */
      noChrome?: boolean;
      /** 1-based number this slide will carry in the .pptx, for `{PAGE}`. */
      pageNumber?: number;
    },
    stats?: { shapes: number },
  ): Promise<void> {
    // Per-slide, so the caller can read off what THIS slide paged into.
    this._pagedExtra = 0;
    // Resolve the chrome for THIS slide before anything is measured: a slide
    // that opts out reserves nothing, so its map fills the whole page.
    const slideChrome = chromeForSlide(this._chrome, meta.slideIndex ?? 0, {
      noChrome: meta.noChrome,
    });
    this._slideInsetTop = slideChrome ? this._insetTop : 0;
    this._slideInsetBottom = slideChrome ? this._insetBottom : 0;
    const addOpts: any = {};
    // No master on a slide that opts out — the master IS the furniture, so
    // naming it would paint the banners the slide just declined.
    if (this._masterName && (slideChrome || !hasChrome(this._chrome))) {
      addOpts.masterName = this._masterName;
    }
    if (meta.section) addOpts.sectionTitle = meta.section;
    const slide = Object.keys(addOpts).length ? pptx.addSlide(addOpts) : pptx.addSlide();
    slide.background = { color: '101418' };
    if (meta.hidden) slide.hidden = true;
    // Without a master there is nowhere else to put the stamp; with one, the
    // master already carries it and a second would double up.
    if (this._slideNumbers && !this._masterName) {
      // Bottom-right, inset from the edge. Percentages rather than inches so
      // the stamp lands in the same visual spot on any layout.
      slide.slideNumber = {
        x: '92%',
        y: '92%',
        w: '6%',
        h: '6%',
        align: 'right',
        fontSize: 10,
        color: 'FFFFFF',
      };
    }

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
      slide.addImage({
        data: dataUrl,
        x: fit.x,
        y: fit.y,
        w: fit.w,
        h: fit.h,
        // The raster IS the slide's content in flat mode, so describing it is
        // the difference between an accessible deck and an empty one.
        altText: meta.title
          ? `Map view — ${meta.title}`
          : 'Map view captured from the operational picture',
      });
    } else {
      slide.addText('Screenshot unavailable (3D view requires a real browser)', {
        x: 0.5,
        y: this._slideH / 2 - 0.3,
        w: this._slideW - 1,
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
      this._emitOverlays(slide, meta.overlays, fit, meta.links);
    }

    if (meta.title) {
      // Titles are HTML overlays in the app — re-draw as native pptx text.
      // The slide beneath can be anything from dark imagery to a solid-white
      // blank, so the glyphs carry their own contrast: white fill, thin dark
      // outline, soft shadow. That reads on both, which a flat fill cannot.
      //
      // With a master, this goes into its `title` placeholder — which is what
      // puts the text in PowerPoint's outline view and lets a recipient
      // restyle every title from the master. Position/size then come from the
      // placeholder, so they are omitted here.
      const titleStyle = {
        fontSize: 24,
        bold: true,
        color: this._chromeColor('text'),
        outline: { size: 0.75, color: '11161C' },
        shadow: { type: 'outer', color: '000000', blur: 3, offset: 1, angle: 45, opacity: 0.8 },
        // Generated chrome in a box the exporter chose, not the author — a long
        // title must shrink to fit rather than run off the slide. Author text
        // boxes deliberately do NOT get this: they should look in PowerPoint
        // exactly as they looked in the editor, overflow included.
        fit: 'shrink' as const,
      };
      slide.addText(
        meta.title,
        this._masterName
          ? { placeholder: 'title', ...titleStyle }
          : { x: 0.3, y: 0.2, w: this._slideW - 0.6, h: 0.6, ...titleStyle },
      );
    }
    // Last, so the strip text sits over the master's rects and over any content
    // that happens to reach the slide's edges.
    this._emitChromeText(slide, slideChrome, {
      ...this._deckTokens(),
      slideTitle: meta.title ?? '',
      section: meta.section ?? '',
      page: meta.pageNumber,
      pages: this._chromeTotal || undefined,
    });
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
    // The content rect, not the whole slide — master furniture (classification
    // banners, footer) is painted BEHIND slide content, so anything laid over
    // the full slide would hide it.
    const slideW = this._slideW;
    const slideH = this._slideH - this._slideInsetTop - this._slideInsetBottom;
    const slideAspect = slideW / slideH;
    let w = slideW;
    let h = slideH;
    if (imgAspect > slideAspect) {
      h = slideW / imgAspect;
    } else if (imgAspect < slideAspect) {
      w = slideH * imgAspect;
    }
    return { x: (slideW - w) / 2, y: this._slideInsetTop + (slideH - h) / 2, w, h };
  }

  /**
   * Turn a briefing slide's threads into comment records positioned in
   * eighth-points (1/8 pt = 1/576 in — the unit PowerPoint reads p:pos in; see
   * PptxComments.ts). Resolved threads are skipped: a resolved comment is
   * closed business. Replies become their own records at the SAME position,
   * which is how PowerPoint threads co-located legacy comments.
   */
  private _collectComments(
    into: PptxCommentRecord[],
    slide: BriefingSlide,
    pptxSlide: number,
    view: any,
    onSkipped: (n: number) => void,
  ): void {
    const threads = slide.comments ?? [];
    if (!threads.length) return;
    const fit = this._containFit(view);
    let skipped = 0;
    let stack = 0;
    for (const c of threads) {
      if (c.resolved) {
        skipped++;
        continue;
      }
      const ov = c.overlayId ? slide.overlays?.find((o) => o.id === c.overlayId) : undefined;
      const hasPoint = typeof c.x === 'number' && typeof c.y === 'number';
      const { x, y } = commentAnchorEighths(
        fit,
        ov,
        hasPoint ? { x: c.x as number, y: c.y as number } : undefined,
        stack,
      );
      // stack only advances for threads that actually fall through to the
      // slide-corner fallback (no overlay, no point) — matches the arithmetic
      // in commentAnchorEighths, which only consults stackIndex on that branch.
      if (!ov && !hasPoint) stack++;
      into.push({ slide: pptxSlide, author: c.author, at: c.at, text: c.text, x, y });
      for (const r of c.replies ?? []) {
        into.push({ slide: pptxSlide, author: r.author, at: r.at, text: r.text, x, y });
      }
    }
    if (skipped) onSkipped(skipped);
  }

  /** Anchor-click download of an in-memory package. */
  private _downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
    links?: LinkExportCtx,
  ): void {
    let emitted = 0;
    let linked = 0;
    for (const o of overlays) {
      try {
        const link = this._overlayHyperlink(o, links);
        if (link) linked++;
        if (o.kind === 'text') this._emitOverlayText(slide, o, fit, link);
        else if (o.kind === 'image') this._emitOverlayImage(slide, o, fit, link);
        else if (o.kind === 'milsym') this._emitOverlayMilSym(slide, o, fit, link);
        else if (o.kind === 'table') this._emitOverlayTable(slide, o, fit);
        else if (o.kind === 'chart') this._emitOverlayChart(slide, o, fit);
        else if (o.kind === 'tacArrow') this._emitOverlayTacArrow(slide, o, fit, link);
        else if (OVERLAY_SHAPE_TYPES[o.kind]) this._emitOverlayBox(slide, o, fit, link);
        else this._emitOverlayPath(slide, o, fit, link); // line | arrow | freehand | highlight
        emitted++;
      } catch (err) {
        EngineLogger.error(ENGINE_NAME, `Annotation emit failed (${o?.kind}): ${err}`);
      }
    }
    if (emitted) {
      EngineLogger.success(
        ENGINE_NAME,
        `Slide annotations — ${emitted} native objects${linked ? `, ${linked} linked` : ''}`,
      );
    }
    this._warnDroppedEffects(overlays);
  }

  /**
   * An overlay's link as a pptxgenjs hyperlink option, or undefined.
   *
   * Relative jumps are resolved to a fixed slide here — the choice made when
   * this feature was designed: pptxgenjs writes only `hlinksldjump`, so 'next'
   * exports as a hard link to whatever followed at export time. The link stays
   * relative inside PAMS; only the deck degrades. Anything that cannot be
   * expressed at all is tallied for `_warnDroppedLinks` rather than guessed at.
   */
  private _overlayHyperlink(
    o: SlideOverlay,
    ctx: LinkExportCtx | undefined,
  ): PptxHyperlink | undefined {
    if (!ctx || !isUsableLink(o.link)) return undefined;
    // Tables and charts are both graphicFrames in OOXML, and a graphicFrame
    // has no a:hlinkClick to hang this on.
    if (o.kind === 'table' || o.kind === 'chart') {
      ctx.dropped.table.add(o.id);
      return undefined;
    }
    const tooltip = String(o.link.tooltip ?? '').trim() || undefined;

    // External URL — the one link kind that needs no slide arithmetic at all.
    // Re-checked here rather than trusted: an imported briefing's links went
    // through normalizeLink, but a hand-edited document's may not have.
    if (o.link.url) {
      if (!isSafeLinkUrl(o.link.url)) {
        ctx.dropped.unexportable.add(o.id);
        return undefined;
      }
      return tooltip ? { url: o.link.url, tooltip } : { url: o.link.url };
    }

    if (o.link.slideId) {
      const slide = ctx.numberById.get(o.link.slideId);
      // pruneLinks already dropped dangling ids on load, so this is the
      // belt-and-braces case of a link written by something else.
      if (!slide) {
        ctx.dropped.missing.add(o.id);
        return undefined;
      }
      return tooltip ? { slide, tooltip } : { slide };
    }

    if ((UNEXPORTABLE_JUMPS as readonly string[]).includes(o.link.jump!)) {
      ctx.dropped.unexportable.add(o.id);
      return undefined;
    }
    const index = resolveJumpForExport(
      o.link,
      ctx.order.length,
      ctx.index,
      (i) => ctx.hidden[i] === true,
    );
    const slide = index == null ? undefined : ctx.numberById.get(ctx.order[index]);
    if (!slide) {
      ctx.dropped.missing.add(o.id);
      return undefined;
    }
    return tooltip ? { slide, tooltip } : { slide };
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

  /**
   * An overlay's drop shadow as pptx options, or undefined. PowerPoint states a
   * shadow in polar terms — one distance plus an angle — so the model's x/y
   * offsets are converted here; lengths are fractions of view height, hence the
   * `* fit.h * 72` into points. Angle is degrees clockwise from east, which
   * matches a y-down offset directly.
   */
  private _ovShadow(o: SlideOverlay, fit: ContainFit): any | undefined {
    const sh = o.shadow;
    if (!sh) return undefined;
    // Offset-free blur is a glow, not a shadow — `_ovGlow` takes it, and the
    // two must never both be set on one object.
    if (sh.x === 0 && sh.y === 0 && sh.blur) return undefined;
    const parsed = parseColor(sh.color);
    const dx = sh.x ?? 0;
    const dy = sh.y ?? 0;
    const angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360);
    return {
      type: 'outer',
      color: (parsed?.hex ?? '#000000').replace('#', '').toUpperCase(),
      opacity: parsed?.alpha ?? 0.35,
      blur: Math.round(Math.max(0, sh.blur ?? 0) * fit.h * 72 * 10) / 10,
      offset: Math.round(Math.hypot(dx, dy) * fit.h * 72 * 10) / 10,
      angle,
    };
  }

  /**
   * Effects a native pptx emit cannot represent. Blend modes and image blur are
   * canvas compositing — there is no shape property for either, so they are
   * dropped rather than approximated, and the log says so instead of letting the
   * deck quietly come out different. (A table has no per-object shadow in
   * `addTable`, so its shadow goes the same way.)
   */
  private _warnDroppedEffects(overlays: readonly SlideOverlay[]): void {
    const dropped: string[] = [];
    const n = (pred: (o: SlideOverlay) => boolean) => overlays.filter(pred).length;
    const blends = n((o) => !!o.blend);
    const blurs = n((o) => !!o.blur);
    const tableShadows = n((o) => o.kind === 'table' && !!o.shadow);
    // addChart, like addTable, takes neither `rotate` nor object transparency.
    const chartRots = n((o) => o.kind === 'chart' && !!o.rotation);
    if (blends) dropped.push(`${blends} blend mode${blends > 1 ? 's' : ''}`);
    if (blurs) dropped.push(`${blurs} image blur${blurs > 1 ? 's' : ''}`);
    if (tableShadows) dropped.push(`${tableShadows} table shadow${tableShadows > 1 ? 's' : ''}`);
    if (chartRots) dropped.push(`${chartRots} chart rotation${chartRots > 1 ? 's' : ''}`);
    if (dropped.length) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `PowerPoint has no equivalent for ${dropped.join(', ')} — dropped from the native shapes`,
      );
    }
  }

  /**
   * A zero-offset shadow is a GLOW, and PowerPoint has a first-class effect
   * for it. Emitting one as `shadow` with offset 0 renders as a dull smear;
   * `glow` renders the halo the author drew on canvas. `_ovShadow` skips the
   * same case, so exactly one of the two is ever set.
   */
  private _ovGlow(o: SlideOverlay, fit: ContainFit): any | undefined {
    const sh = o.shadow;
    if (!sh || sh.x !== 0 || sh.y !== 0 || !sh.blur) return undefined;
    const parsed = parseColor(sh.color);
    return {
      size: Math.round(Math.max(0, sh.blur) * fit.h * 72 * 10) / 10,
      color: this._ovHex(parsed ? parsed.hex : undefined, 'FFFFFF'),
      opacity: parsed?.alpha ?? 0.6,
    };
  }

  private _ovRotate(o: SlideOverlay): number | undefined {
    if (!o.rotation) return undefined;
    return ((Math.round(o.rotation) % 360) + 360) % 360 || undefined;
  }

  private _emitOverlayText(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    const fontPt = Math.min(96, Math.max(6, Math.round((o.fontSize ?? 0.03) * fit.h * 72)));
    // A list becomes real PowerPoint list paragraphs — one run per line with a
    // bullet — rather than literal '•' characters, so PowerPoint keeps
    // renumbering it after the deck is edited. `text` is stored clean (markers
    // are display-only, see OverlayFabric.applyListMarkers), so nothing needs
    // stripping here.
    // Leading whitespace is the nesting: it becomes a real PowerPoint
    // `indentLevel`, so an OPORD's sub-paragraphs indent, renumber and
    // re-bullet natively instead of being flat lines with typed-in markers.
    // Numbered levels use PowerPoint's own styles — 1. / a. / i. down the
    // ladder — which is the convention a five-paragraph order is written in.
    const NUMBER_STYLES = ['arabicPeriod', 'alphaLcPeriod', 'romanLcPeriod'];
    const body = o.listStyle
      ? String(o.text ?? '')
          .split('\n')
          .map((line) => {
            const level = listIndentLevel(line);
            const bullet: any =
              o.listStyle === 'bullet'
                ? true
                : {
                    type: 'number',
                    style:
                      o.listStyle === 'alpha'
                        ? 'alphaLcPeriod'
                        : NUMBER_STYLES[level % NUMBER_STYLES.length],
                  };
            return {
              text: line.trimStart(),
              options: {
                bullet,
                ...(level > 0 ? { indentLevel: Math.min(8, level) } : {}),
                breakLine: true,
              },
            };
          })
      : (o.text ?? '');
    slide.addText(body, {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: Math.max(0.2, o.w * fit.w),
      h: Math.max(0.2, o.h * fit.h),
      fontSize: fontPt,
      fontFace: o.fontFamily || 'Arial',
      bold: !!o.bold,
      italic: !!o.italic,
      underline: o.underline ? { style: 'sng' } : undefined,
      // Same background-agnostic ink the editor draws an untyped colour with,
      // so a deck's text doesn't change shade on the way into PowerPoint.
      color: this._ovHex(o.textColor, DEFAULT_TEXT_COLOR),
      align: o.align ?? 'left',
      valign: 'top',
      // A bulleted paragraph needs room for its marker; 0 would clip it.
      margin: o.listStyle ? 2 : 0,
      // Multiples rather than absolute points, so the spacing keeps its
      // proportion when the font size changes — the same reasoning the model
      // uses for strokeWidth and fontSize.
      lineSpacingMultiple: o.lineSpacing && o.lineSpacing !== 1 ? o.lineSpacing : undefined,
      charSpacing: o.charSpacing || undefined,
      rotate: this._ovRotate(o),
      shadow: this._ovShadow(o, fit),
      glow: this._ovGlow(o, fit),
      transparency:
        o.opacity != null && o.opacity < 1 ? Math.round((1 - o.opacity) * 100) : undefined,
      // Shape-level, so the whole text box is the click target — the object
      // link the model stores, not a per-run one.
      hyperlink,
    });
  }

  /**
   * Tables go out as a native `a:tbl` — clickable and editable in PowerPoint,
   * with real column widths and row heights.
   *
   * Two documented lossy points, both forced by `addTable`'s option set:
   * it takes no `rotate` (which is why the editor withholds table rotation
   * entirely), and it has no object-level transparency, so `opacity` is folded
   * into the per-cell fill and the border instead.
   */
  private _emitOverlayTable(slide: any, o: SlideOverlay, fit: ContainFit): void {
    const { rows, colWidths, rowHeights } = normalizeTable(o);
    const tableW = Math.max(0.4, o.w * fit.w);
    const tableH = Math.max(0.2, o.h * fit.h);
    const objAlpha = o.opacity ?? 1;
    const bodyAlpha = (o.fillOpacity ?? 1) * objAlpha;
    const fontPt = Math.min(96, Math.max(6, Math.round((o.fontSize ?? 0.025) * fit.h * 72)));

    const bodyFill = o.fill
      ? { color: this._ovHex(o.fill, '101418'), transparency: Math.round((1 - bodyAlpha) * 100) }
      : undefined;
    const headerFill = o.headerRow
      ? {
          color: this._ovHex(o.headerFill ?? DEFAULT_TABLE_HEADER_FILL, '2D6CDF'),
          transparency: Math.round((1 - bodyAlpha) * 100),
        }
      : undefined;

    // Merges: the anchor cell carries colspan/rowspan and the cells it covers
    // are OMITTED from the row — that is how pptxgenjs expects a span, and
    // leaving them in would push the rest of the row sideways.
    const merges = normalizeMerges(o.merges, rows.length, colWidths.length);
    const covered = coveredCells(merges);

    const cells = rows.map((row, r) => {
      const isHeader = r === 0 && !!o.headerRow;
      const out: any[] = [];
      for (let c = 0; c < row.length; c++) {
        if (covered.has(`${r},${c}`)) continue;
        const m = mergeAt(merges, r, c);
        out.push({
          text: row[c] ?? '',
          options: {
            fill: isHeader ? headerFill : bodyFill,
            bold: isHeader || !!o.bold,
            italic: !!o.italic,
            underline: o.underline ? { style: 'sng' } : undefined,
            color: this._ovHex(o.textColor, 'FFFFFF'),
            align: o.align ?? 'left',
            valign: 'middle',
            ...(m?.colspan && m.colspan > 1 ? { colspan: m.colspan } : {}),
            ...(m?.rowspan && m.rowspan > 1 ? { rowspan: m.rowspan } : {}),
          },
        });
      }
      return out;
    });

    slide.addTable(cells, {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: tableW,
      h: tableH,
      colW: colWidths.map((f) => f * tableW),
      rowH: rowHeights.map((f) => f * tableH),
      fontSize: fontPt,
      fontFace: o.fontFamily || 'Arial',
      border: {
        type: o.strokeDash ? 'dash' : 'solid',
        pt: Math.max(
          0.25,
          Math.round((o.strokeWidth ?? DEFAULT_TABLE_STROKE_WIDTH) * fit.h * 72 * 4) / 4,
        ),
        color: this._ovHex(o.stroke, 'FFFFFF'),
      },
      margin: 2,
      valign: 'middle',
      ...(o.autoPage && this._allowAutoPage
        ? {
            autoPage: true,
            // A continuation table with no header is unreadable, so the header
            // row repeats whenever the table declares one.
            autoPageRepeatHeader: !!o.headerRow,
            autoPageHeaderRows: o.headerRow ? 1 : 0,
            // Continuations start below the title band rather than at the very
            // top of the slide, where the title would sit on top of them.
            autoPageSlideStartY: Math.max(0.9, this._slideInsetTop + 0.9),
          }
        : {}),
    });
    // pptxgenjs records what it created; the caller needs the count to keep
    // comment slide numbers aligned.
    this._pagedExtra += slide.newAutoPagedSlides?.length ?? 0;
  }

  /**
   * A chart overlay goes out as a NATIVE PowerPoint chart — the recipient can
   * restyle it, retype the numbers, or repoint the series, none of which is
   * possible with a picture of a chart. This is the whole reason a chart
   * overlay persists a ChartSpec rather than a bitmap (see ChartFactory).
   *
   * `addChart` takes no `rotate` and no object-level transparency, so both are
   * dropped — the same two limits `addTable` has, and reported the same way.
   */
  private _emitOverlayChart(slide: any, o: SlideOverlay, fit: ContainFit): void {
    if (!o.chart) return;
    const spec = chartSpecToPptx(this._pptx, o.chart, {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: Math.max(0.5, o.w * fit.w),
      h: Math.max(0.4, o.h * fit.h),
    });
    if (!spec) return;
    slide.addChart(spec.type, spec.data, spec.options);
  }

  /** Picture overlays go out as real pptx pictures — the src is already a data URL. */
  private _emitOverlayImage(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    if (!o.src) return;
    slide.addImage({
      data: o.src,
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w: Math.max(0.02, o.w * fit.w),
      h: Math.max(0.02, o.h * fit.h),
      rotate: this._ovRotate(o),
      flipH: o.flipX || undefined,
      flipV: o.flipY || undefined,
      shadow: this._ovShadow(o, fit),
      transparency:
        o.opacity != null && o.opacity < 1 ? Math.round((1 - o.opacity) * 100) : undefined,
      hyperlink,
      altText: o.altText || 'Briefing image',
    });
  }

  /**
   * A military symbol is re-rendered from its SIDC at ~4× its on-slide size and
   * emitted as a picture. PowerPoint has no notion of 2525D, so raster is the
   * only faithful option; rendering fresh here (rather than reusing the editor's
   * ~1000px canvas) is what keeps it sharp when the deck is projected or
   * printed. This is the whole reason a milsym overlay stores a SIDC and not a
   * bitmap — export resolution is decided at export time.
   */
  private _emitOverlayMilSym(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    if (!o.sidc) return;
    const hIn = Math.max(0.02, o.h * fit.h);
    const render = renderMilSym(o.sidc, o.symOptions, hIn * PPTX_EXPORT_DPI * MILSYM_EXPORT_SCALE);
    if (!render) {
      EngineLogger.error(ENGINE_NAME, `Symbol could not be rendered for export (${o.sidc})`);
      return;
    }
    slide.addImage({
      data: render.canvas.toDataURL('image/png'),
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      // Height is authoritative; width follows the marker's own aspect, which
      // amplifier text widens asymmetrically.
      w: Math.max(0.02, hIn * (render.width / (render.height || 1))),
      h: hIn,
      rotate: this._ovRotate(o),
      flipH: o.flipX || undefined,
      flipV: o.flipY || undefined,
      shadow: this._ovShadow(o, fit),
      transparency:
        o.opacity != null && o.opacity < 1 ? Math.round((1 - o.opacity) * 100) : undefined,
      hyperlink,
      // A screen reader gets the symbol's designation and SIDC rather than
      // "image". Nothing else in the deck can say what a 2525D marker means.
      altText: this._milSymAltText(o),
    });
  }

  /** Accessible description of a military symbol — designation first, then SIDC. */
  private _milSymAltText(o: SlideOverlay): string {
    const desig = String(o.symOptions?.uniqueDesignation ?? '').trim();
    const higher = String(o.symOptions?.higherFormation ?? '').trim();
    const name = [desig, higher && `/${higher}`].filter(Boolean).join('');
    return name
      ? `Military symbol ${name} (SIDC ${o.sidc})`
      : `Military symbol, SIDC ${o.sidc}`;
  }

  /**
   * A filled tactical arrow — custGeom over the same outline the editor draws,
   * regenerated at export scale so curves stay smooth. It lands as an editable
   * PowerPoint freeform.
   */
  private _emitOverlayTacArrow(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    const pts = (o.points ?? []).map((p) => ({
      x: (fit.x + p.x * fit.w) * PPTX_EXPORT_DPI,
      y: (fit.y + p.y * fit.h) * PPTX_EXPORT_DPI,
    }));
    if (pts.length < 2) return;
    const outline = buildTacArrowOutline({
      points: pts,
      widthPx: (o.width ?? DEFAULT_TAC_WIDTH) * fit.h * PPTX_EXPORT_DPI,
      headRatio: o.headRatio,
      taper: o.taper,
      headAtEnd: (o.arrowEnd ?? 'triangle') !== 'none',
      headAtStart: (o.arrowStart ?? 'none') !== 'none',
      arrowType: o.arrowType ?? 'sharp',
    });
    if (!outline) return;
    const b = outlineBounds(outline.ring);
    const fillAlpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    slide.addShape('custGeom', {
      x: b.x / PPTX_EXPORT_DPI,
      y: b.y / PPTX_EXPORT_DPI,
      w: Math.max(0.02, b.w / PPTX_EXPORT_DPI),
      h: Math.max(0.02, b.h / PPTX_EXPORT_DPI),
      points: [
        ...outline.ring.map((p) => ({
          x: (p.x - b.x) / PPTX_EXPORT_DPI,
          y: (p.y - b.y) / PPTX_EXPORT_DPI,
        })),
        { close: true },
      ],
      fill: o.fill
        ? { color: this._ovHex(o.fill, 'FFD166'), transparency: Math.round((1 - fillAlpha) * 100) }
        : { color: 'FFFFFF', transparency: 100 },
      line: o.stroke
        ? {
            color: this._ovHex(o.stroke, 'FF3B30'),
            width: this._ovStrokePt(o, fit),
            transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
            dashType: this._ovDashType(o),
          }
        : { color: 'FFFFFF', width: 0.5, transparency: 100 },
      shadow: this._ovShadow(o, fit),
      hyperlink,
    });
  }

  private _emitOverlayBox(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    // Block arrows are native presets, but pptxgenjs can't write a shape's
    // adjustment values — so a head size other than OOXML's own default would
    // silently change on export. Those go out as exact custGeom instead: still
    // an editable vector shape, just not a preset with adjustment handles.
    if (
      BLOCK_ARROW_KINDS.has(o.kind) &&
      Math.abs((o.headRatio ?? DEFAULT_BLOCK_HEAD_RATIO) - DEFAULT_BLOCK_HEAD_RATIO) > 0.01
    ) {
      this._emitOverlayBlockArrowGeom(slide, o, fit, hyperlink);
      return;
    }
    const alpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    // A rect with a corner radius is a different OOXML preset, not a property
    // of `rect` — so the shape type itself changes.
    const rounded = o.kind === 'rect' && !!o.cornerRadius;
    slide.addShape(rounded ? 'roundRect' : (OVERLAY_SHAPE_TYPES[o.kind] ?? 'rect'), {
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
      shadow: this._ovShadow(o, fit),
      glow: this._ovGlow(o, fit),
      // 0..1 of the shorter side, which is exactly how the model stores it.
      rectRadius: rounded ? Math.min(0.5, Math.max(0, o.cornerRadius as number)) : undefined,
      // Mirrored box overlays — pptxgenjs writes these straight into the xfrm.
      flipH: o.flipX || undefined,
      flipV: o.flipY || undefined,
      hyperlink,
      altText: o.altText || undefined,
    });
  }

  /**
   * A block arrow whose head size the preset can't carry, emitted as its exact
   * vertices. Rotation and mirroring still ride on the xfrm, so only the
   * "preset with handles" affordance is lost — see _emitOverlayBox.
   */
  private _emitOverlayBlockArrowGeom(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    const w = Math.max(0.02, o.w * fit.w);
    const h = Math.max(0.02, o.h * fit.h);
    const alpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    const pts = blockArrowPoints(
      o.kind as 'blockArrow' | 'blockArrowDouble' | 'chevron',
      w,
      h,
      o.headRatio ?? DEFAULT_BLOCK_HEAD_RATIO,
    );
    slide.addShape('custGeom', {
      x: fit.x + o.x * fit.w,
      y: fit.y + o.y * fit.h,
      w,
      h,
      points: [...pts, { close: true }],
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
      shadow: this._ovShadow(o, fit),
      flipH: o.flipX || undefined,
      flipV: o.flipY || undefined,
      hyperlink,
    });
  }

  /** line / arrow / freehand — custGeom path; arrows get a triangle head. */
  private _emitOverlayPath(
    slide: any,
    o: SlideOverlay,
    fit: ContainFit,
    hyperlink?: PptxHyperlink,
  ): void {
    const rawPts = o.points ?? [];
    // Elbow linework renders as a dogleg — export the orthogonal waypoints it
    // actually draws, for arrows and lines alike.
    const isElbow =
      (o.kind === 'arrow' && o.arrowType === 'elbow') ||
      (o.kind === 'line' && o.lineType === 'elbow');
    const normPts = isElbow ? this._elbowWaypoints(rawPts) : rawPts;
    const pts = normPts.map((p) => ({
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
    // A closed line is a polygon: close the geometry and let it take its fill.
    const closed = o.kind === 'line' && !!o.closed;
    const geom: any[] = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    if (closed) geom.push({ close: true });
    const fillAlpha = (o.fillOpacity ?? 1) * (o.opacity ?? 1);
    slide.addShape('custGeom', {
      x: minX,
      y: minY,
      w: Math.max(0.02, maxX - minX),
      h: Math.max(0.02, maxY - minY),
      points: geom,
      fill:
        closed && o.fill
          ? { color: this._ovHex(o.fill, 'FFD166'), transparency: Math.round((1 - fillAlpha) * 100) }
          : { color: 'FFFFFF', transparency: 100 },
      line: {
        color: this._ovHex(o.stroke, 'FF3B30'),
        width: this._ovStrokePt(o, fit),
        transparency: Math.round((1 - (o.opacity ?? 1)) * 100),
        // Absent head fields mean the pre-per-end-terminator defaults.
        beginArrowType:
          o.kind === 'arrow' ? PPTX_ARROW_TYPES[o.arrowStart ?? 'none'] : undefined,
        endArrowType:
          o.kind === 'arrow' ? PPTX_ARROW_TYPES[o.arrowEnd ?? 'triangle'] : undefined,
        dashType: this._ovDashType(o),
      },
      shadow: this._ovShadow(o, fit),
      hyperlink,
    });
  }

  /**
   * Expand an elbow arrow's clicked points into the orthogonal
   * (horizontal-then-vertical) waypoint sequence it actually renders as —
   * pptx custGeom has no fillet/curve concept, so this needs the straight
   * dogleg vertices only (unlike OverlayFabric's buildElbowArrowPath, which
   * also adds a rounded-corner fillet for on-screen rendering).
   */
  private _elbowWaypoints(
    points: Array<{ x: number; y: number }>,
  ): Array<{ x: number; y: number }> {
    if (points.length < 2) return points;
    const ortho: Array<{ x: number; y: number }> = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (Math.abs(b.x - a.x) > 1e-4 && Math.abs(b.y - a.y) > 1e-4) {
        ortho.push({ x: b.x, y: a.y });
      }
      ortho.push(b);
    }
    return ortho;
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
