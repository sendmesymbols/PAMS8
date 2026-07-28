/**
 * PptxImporter.ts
 *
 * Parse a PowerPoint (.pptx) file into Briefing slides. pptxgenjs is
 * WRITE-ONLY (no parser through v4.x), so this is our own focused OOXML
 * reader: a .pptx is a ZIP of XML, the offline pptxgen.bundle.js already
 * assigns `window.JSZip` (its first UMD segment), and slide XML parses with
 * the browser's native DOMParser — zero new dependencies, fully offline.
 *
 * Mapping (mirrors PptxExporter's output, so export → import round-trips):
 *   - title placeholder             → slide.title       (never an overlay)
 *   - text boxes                    → 'text' overlays
 *   - preset rect/roundRect/ellipse → 'rect'/'ellipse' overlays
 *   - connectors (line/arrow)       → 'line'/'arrow' overlays
 *   - custGeom freeforms            → 'freehand' overlays (one per subpath;
 *                                      2-point subpaths become line/arrow)
 *   - tables                        → 'table' overlays, merges included
 *   - charts                        → 'chart' overlays (series read from the
 *                                      chart part's cached values)
 *   - pictures                      → composited in document order into ONE
 *                                      background raster (backgroundDataUrl)
 *   - notes slides                  → slide.notes
 *   - p:sectionLst                  → Slide.section
 *   - theme part                    → real scheme colours and +mj-lt/+mn-lt
 *                                      font references
 *   - a:hlinkClick on a shape/pic   → SlideOverlay.link — slide jumps,
 *                                      relative jumps and external URLs (the
 *                                      last scheme-checked by normalizeLink).
 *                                      A linked picture gets an invisible rect
 *                                      hotspot, since the picture itself is
 *                                      flattened away.
 *
 * Imported slides are "screen-only": `view` has neither extent nor camera,
 * so playback leaves the map untouched and the editor / present mode / PPTX
 * re-export all use the stored backgroundDataUrl instead of a screenshot.
 *
 * Dynamically imported by BriefingEngine.importPptxFromFile() so none of
 * this loads until the first import.
 */

import { composeOverlayThumbnail, overlayUuid } from '../Briefing/OverlayFabric';
import type {
  ArrowHead,
  LinkJump,
  Slide,
  SlideOverlay,
  TableMerge,
  ViewKind,
} from '../Briefing/BriefingTypes';
import type { ChartKind, ChartSpec } from '../Briefing/ChartFactory';
import { normalizeMerges } from '../Briefing/OverlayTable';
import { jumpFromPptAction, normalizeLink } from '../Briefing/SlideLinks';
import { loadPptxGenJS } from './PptxExporter';

export interface PptxImportOptions {
  /** Stored as slide.view.capturedIn (imported slides carry no extent/camera). */
  capturedIn: ViewKind;
  /** goTo duration for imported slides (they don't move the map, but the field is required). */
  defaultTransitionMs?: number;
}

export interface PptxImportResult {
  slides: Slide[];
  /** Human-readable notes about content that was flattened or skipped. */
  warnings: string[];
}

/** The overlay kinds a preset (`prstGeom`) shape can import as. */
type PrstBoxKind =
  | 'rect'
  | 'ellipse'
  | 'diamond'
  | 'triangle'
  | 'star'
  | 'callout'
  | 'blockArrow'
  | 'blockArrowDouble'
  | 'chevron';

/** Of those, the ones whose silhouette has a direction — see shapeOverlay. */
const BLOCK_ARROW_PRST_KINDS: ReadonlySet<PrstBoxKind> = new Set<PrstBoxKind>([
  'blockArrow',
  'blockArrowDouble',
  'chevron',
]);

/** 914400 EMU per inch; 12700 EMU per point. */
const EMU_PER_PT = 12700;
/** Rendered background raster width (slide aspect preserved). */
const BG_WIDTH_PX = 1280;
const THUMB_WIDTH_PX = 240;
/** Parity with PptxExporter's MAX_SHAPES_PER_SLIDE — a pathological deck can't flood a slide. */
const MAX_OVERLAYS_PER_SLIDE = 250;
/** Every slide holds a ~1280px jpeg raster — cap so a giant deck can't exhaust memory. */
const MAX_SLIDES = 150;

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PIC_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * The deck's resolved theme, or null when it has none / could not be read.
 *
 * Module-scoped rather than threaded because `parseSolidFill` and
 * `extractText` are leaf helpers called from a dozen places, and the importer
 * is a single-shot function. `parsePptx` clears it BEFORE loading the theme
 * and again on the way out, so a parse that throws part-way cannot carry a
 * stale palette into the next import.
 */
interface DeckTheme {
  /** Scheme slot ('accent1', 'tx1', 'lt2', …) → '#RRGGBB'. */
  colors: Record<string, string>;
  /** '+mj-lt' / '+mn-lt' → real typeface name. */
  majorFont?: string;
  minorFont?: string;
}
let THEME: DeckTheme | null = null;

/**
 * Standard Office defaults (dark text on light background), used for any slot
 * the deck's own theme does not define — and for the whole map when the theme
 * part is missing or unreadable.
 */
const SCHEME_COLOR_FALLBACKS: Record<string, string> = {
  tx1: '#000000',
  tx2: '#44546A',
  dk1: '#000000',
  dk2: '#44546A',
  lt1: '#FFFFFF',
  lt2: '#E7E6E6',
  bg1: '#FFFFFF',
  bg2: '#E7E6E6',
  accent1: '#4472C4',
  accent2: '#ED7D31',
  accent3: '#A5A5A5',
  accent4: '#FFC000',
  accent5: '#5B9BD5',
  accent6: '#70AD47',
};

// ── XML helpers (namespace-tolerant: OOXML prefixes vary, localName doesn't) ──

function firstByLocal(root: Document | Element | null, name: string): Element | null {
  return root ? (root.getElementsByTagNameNS('*', name)[0] as Element | undefined) ?? null : null;
}

function allByLocal(root: Document | Element | null, name: string): Element[] {
  return root ? Array.from(root.getElementsByTagNameNS('*', name)) : [];
}

function childByLocal(el: Element | null, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) {
    if (c.localName === name) return c;
  }
  return null;
}

function childrenByLocal(el: Element | null, name: string): Element[] {
  return el ? Array.from(el.children).filter((c) => c.localName === name) : [];
}

/** Relationship attributes (r:id / r:embed) are namespaced — try NS first, literal prefix second. */
function ridOf(el: Element, local: string): string | null {
  return el.getAttributeNS(R_NS, local) || el.getAttribute(`r:${local}`);
}

/** Resolve a relationship Target ("../media/image1.png") against its part's directory. */
function resolveTarget(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '');
  const out: string[] = [];
  for (const part of `${baseDir}/${target}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function relTargets(
  relsDoc: Document | null,
  baseDir: string,
): Map<string, RelTarget> {
  const map = new Map<string, RelTarget>();
  for (const rel of allByLocal(relsDoc, 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) {
      // An external target is a URL, not a part path — resolving it against the
      // part directory would mangle it ("https://x" → "https:/x"), so it is
      // kept verbatim and flagged instead.
      const external = rel.getAttribute('TargetMode') === 'External';
      map.set(id, {
        target: external ? target : resolveTarget(baseDir, target),
        type: rel.getAttribute('Type') ?? '',
        external,
      });
    }
  }
  return map;
}

interface RelTarget {
  target: string;
  type: string;
  external: boolean;
}

/**
 * A hyperlink as it exists mid-parse: a slide TARGET PATH rather than a
 * Slide.id, because the ids of slides not yet parsed do not exist yet. Resolved
 * to a real OverlayLink in a second pass once every slide has been read — see
 * the end of parsePptx.
 */
interface RawLink {
  /** Zip path of the target slide part, e.g. 'ppt/slides/slide3.xml'. */
  targetPath?: string;
  jump?: LinkJump;
  /** External hyperlink target — the rel's Target with TargetMode="External". */
  url?: string;
  tooltip?: string;
}

/**
 * `a:hlinkClick` on a shape's or picture's `p:cNvPr` → a RawLink, or null when
 * there is nothing usable there. Three shapes of link exist in the wild:
 *
 * - `action="ppaction://hlinksldjump"` + `r:id` → a specific slide (the rel's
 *   Target is that slide's part).
 * - `action="ppaction://hlinkshowjump?jump=…"` → a relative jump; `r:id` is
 *   empty because no relationship is needed.
 * - an external `r:id` with no action → a URL. Kept as-is; `normalizeLink`
 *   later refuses any scheme outside the http/https/mailto allowlist, so a
 *   hostile `javascript:` target in a third-party deck is dropped rather than
 *   imported into something present mode would open.
 *
 * `noaction`, `hlinkfile`, `program`, media and OLE actions are all "not a
 * navigation" and return null.
 */
function readHlink(
  cNvPr: Element | null,
  rels: Map<string, RelTarget>,
  onExternal: () => void,
): RawLink | null {
  const hl = cNvPr ? childByLocal(cNvPr, 'hlinkClick') : null;
  if (!hl) return null;
  const action = hl.getAttribute('action');
  const tooltip = (hl.getAttribute('tooltip') || '').trim() || undefined;

  const jump = jumpFromPptAction(action);
  if (jump) return { jump, tooltip };

  const rid = ridOf(hl, 'id');
  const rel = rid ? rels.get(rid) : undefined;
  if (!rel) return null;
  if (rel.external) {
    onExternal();
    return { url: rel.target, tooltip };
  }
  // Only a slide relationship is navigation; a hlinkfile/program action
  // pointing at some other part is not.
  if (!rel.type.endsWith('/slide')) return null;
  return { targetPath: rel.target, tooltip };
}

/** A scheme slot name → hex, preferring the deck's own theme over the defaults. */
function schemeHex(slot: string): string | null {
  return THEME?.colors[slot] ?? SCHEME_COLOR_FALLBACKS[slot] ?? null;
}

/** First a:solidFill under `parent` → hex + alpha (a:alpha is thousandths of a percent). */
function parseSolidFill(parent: Element | null): { hex: string; alpha: number } | null {
  const fill = childByLocal(parent, 'solidFill');
  if (!fill) return null;
  let hex: string | null = null;
  const srgb = childByLocal(fill, 'srgbClr');
  const scheme = childByLocal(fill, 'schemeClr');
  if (srgb?.getAttribute('val')) hex = `#${srgb.getAttribute('val')!.slice(0, 6).toUpperCase()}`;
  else if (scheme?.getAttribute('val')) hex = schemeHex(scheme.getAttribute('val')!);
  if (!hex) return null;
  const alphaEl = firstByLocal(srgb ?? scheme, 'alpha');
  const alphaVal = Number(alphaEl?.getAttribute('val'));
  const alpha = Number.isFinite(alphaVal) ? Math.max(0, Math.min(1, alphaVal / 100000)) : 1;
  return { hex, alpha };
}

/**
 * An `a:latin/@typeface` → a real font name. '+mj-lt' and '+mn-lt' are
 * references into the theme's major/minor font; anything else is already a
 * literal. Undefined when the reference cannot be resolved, so the caller
 * falls back rather than writing '+mn-lt' into the model as a font name.
 */
function resolveTypeface(latin: string | null | undefined): string | undefined {
  if (!latin) return undefined;
  if (!latin.startsWith('+')) return latin;
  if (latin.startsWith('+mj')) return THEME?.majorFont;
  if (latin.startsWith('+mn')) return THEME?.minorFont;
  return undefined;
}

/**
 * Read a theme part into the colour and font maps the leaf helpers consult.
 *
 * `a:clrScheme` names its slots dk1/lt1/dk2/lt2; the *slide* refers to them as
 * tx1/bg1/tx2/bg2 through the master's `p:clrMap`. Both spellings are stored
 * so a lookup never has to know which side it came from — the default mapping
 * (tx1→dk1, bg1→lt1, …) is applied unless the master overrides it.
 *
 * `a:sysClr` carries the resolved value in `lastClr`, which is the only value
 * available offline.
 */
function readTheme(themeDoc: Document | null, clrMap: Element | null): DeckTheme | null {
  if (!themeDoc) return null;
  const scheme = firstByLocal(themeDoc, 'clrScheme');
  const colors: Record<string, string> = {};
  if (scheme) {
    for (const slot of Array.from(scheme.children)) {
      const srgb = childByLocal(slot, 'srgbClr')?.getAttribute('val');
      const sys = childByLocal(slot, 'sysClr')?.getAttribute('lastClr');
      const hex = srgb || sys;
      if (hex) colors[slot.localName] = `#${hex.slice(0, 6).toUpperCase()}`;
    }
  }
  // tx/bg aliases, honouring the master's clrMap when there is one.
  const alias: Record<string, string> = {
    tx1: clrMap?.getAttribute('tx1') || 'dk1',
    tx2: clrMap?.getAttribute('tx2') || 'dk2',
    bg1: clrMap?.getAttribute('bg1') || 'lt1',
    bg2: clrMap?.getAttribute('bg2') || 'lt2',
  };
  for (const [from, to] of Object.entries(alias)) {
    if (colors[to]) colors[from] = colors[to];
  }

  const fontScheme = firstByLocal(themeDoc, 'fontScheme');
  const major = childByLocal(childByLocal(fontScheme, 'majorFont'), 'latin')?.getAttribute(
    'typeface',
  );
  const minor = childByLocal(childByLocal(fontScheme, 'minorFont'), 'latin')?.getAttribute(
    'typeface',
  );
  if (!Object.keys(colors).length && !major && !minor) return null;
  return {
    colors,
    majorFont: major || undefined,
    minorFont: minor || undefined,
  };
}

// ── Charts ─────────────────────────────────────────────────────────────────────

/** OOXML chart-group element name → our ChartKind. */
const CHART_KINDS: Record<string, ChartKind> = {
  barChart: 'bar',
  bar3DChart: 'bar',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter',
  radarChart: 'radar',
};

/**
 * A chart part → ChartSpec, read entirely from the CACHED values
 * (`c:numCache` / `c:strCache`) that every writer embeds alongside the
 * spreadsheet formula. That cache is what PowerPoint itself renders when the
 * embedded workbook is unavailable, so it is both the correct source and the
 * only one obtainable offline.
 *
 * Returns null when the part has no plottable series.
 */
function chartSpecFromPart(doc: Document | null): ChartSpec | null {
  if (!doc) return null;
  const plotArea = firstByLocal(doc, 'plotArea');
  if (!plotArea) return null;

  let kind: ChartKind | null = null;
  let group: Element | null = null;
  for (const child of Array.from(plotArea.children)) {
    const k = CHART_KINDS[child.localName];
    if (k) {
      kind = k;
      group = child;
      break;
    }
  }
  if (!kind || !group) return null;

  // Stacked and horizontal bars are the same element with different children.
  if (kind === 'bar') {
    const grouping = childByLocal(group, 'grouping')?.getAttribute('val');
    const dir = childByLocal(group, 'barDir')?.getAttribute('val');
    if (grouping === 'stacked' || grouping === 'percentStacked') kind = 'barStacked';
    else if (dir === 'bar') kind = 'barHorizontal';
  }

  /** Cached point values of a c:cat / c:val / c:xVal wrapper, in c:idx order. */
  const cachedPoints = (wrapper: Element | null): string[] => {
    if (!wrapper) return [];
    const out: string[] = [];
    for (const pt of allByLocal(wrapper, 'pt')) {
      const idx = Number(pt.getAttribute('idx'));
      const v = firstByLocal(pt, 'v')?.textContent ?? '';
      if (Number.isFinite(idx)) out[idx] = v;
    }
    // A sparse cache leaves holes; '' plots as 0 rather than shifting the rest.
    for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
    return out;
  };

  let labels: string[] = [];
  const series: ChartSpec['series'] = [];
  for (const ser of childrenByLocal(group, 'ser')) {
    const name =
      firstByLocal(childByLocal(ser, 'tx'), 'v')?.textContent?.trim() ||
      `Series ${series.length + 1}`;
    const values = cachedPoints(childByLocal(ser, 'val') ?? childByLocal(ser, 'yVal')).map((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });
    if (!values.length) continue;
    if (!labels.length) {
      labels = cachedPoints(childByLocal(ser, 'cat') ?? childByLocal(ser, 'xVal'));
    }
    const entry: ChartSpec['series'][number] = { name, values };
    if (kind === 'scatter') {
      const xs = cachedPoints(childByLocal(ser, 'xVal')).map((v) => Number(v) || 0);
      if (xs.length) entry.xValues = xs;
    }
    series.push(entry);
  }
  if (!series.length) return null;

  // A cache can be shorter than the series it labels; pad so every point has a
  // category and neither renderer indexes past the end.
  const maxLen = Math.max(...series.map((s) => s.values.length));
  while (labels.length < maxLen) labels.push(String(labels.length + 1));

  const title = firstByLocal(firstByLocal(doc, 'title'), 't')?.textContent?.trim();
  const legendPos = firstByLocal(doc, 'legendPos')?.getAttribute('val');
  return {
    type: kind,
    labels,
    series,
    title: title || undefined,
    showLegend: !!firstByLocal(doc, 'legend'),
    legendPos:
      legendPos === 't' || legendPos === 'l' || legendPos === 'r' || legendPos === 'b'
        ? legendPos
        : 'b',
    textColor: '#20262E',
  };
}

// ── Text extraction ────────────────────────────────────────────────────────────

interface TextInfo {
  text: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  /**
   * Set when a paragraph carries an EXPLICIT a:buChar / a:buAutoNum. Bullets
   * inherited from a layout placeholder are deliberately not inferred — the
   * layout isn't resolved here, and guessing would put markers on plain text.
   */
  listStyle?: 'bullet' | 'number';
}

/**
 * Flatten a txBody: paragraphs joined with \n, runs concatenated. Style comes
 * from the FIRST styled run — one SlideOverlay text box has one style, so
 * mixed-style paragraphs import with their leading style.
 */
function extractText(txBody: Element | null): TextInfo | null {
  if (!txBody) return null;
  const lines: string[] = [];
  let style: Partial<TextInfo> | null = null;
  let align: TextInfo['align'];

  let listStyle: TextInfo['listStyle'];

  for (const p of childrenByLocal(txBody, 'p')) {
    const pPr = childByLocal(p, 'pPr');
    if (align === undefined) {
      const algn = pPr?.getAttribute('algn');
      if (algn === 'ctr') align = 'center';
      else if (algn === 'r') align = 'right';
      // just / justLow / dist / thaiDist all read as justified — we only model one.
      else if (algn === 'just' || algn === 'justLow' || algn === 'dist' || algn === 'thaiDist') {
        align = 'justify';
      } else if (algn) align = 'left';
    }
    // First paragraph that declares a bullet wins — one overlay text box has a
    // single listStyle. buNone anywhere is respected as "not a list".
    if (listStyle === undefined && pPr && !childByLocal(pPr, 'buNone')) {
      if (childByLocal(pPr, 'buAutoNum')) listStyle = 'number';
      else if (childByLocal(pPr, 'buChar')) listStyle = 'bullet';
    }
    let line = '';
    for (const node of Array.from(p.children)) {
      if (node.localName === 'br') {
        line += '\n';
        continue;
      }
      if (node.localName !== 'r' && node.localName !== 'fld') continue;
      line += childByLocal(node, 't')?.textContent ?? '';
      if (!style) {
        const rPr = childByLocal(node, 'rPr');
        if (rPr) {
          const sz = Number(rPr.getAttribute('sz'));
          const u = rPr.getAttribute('u');
          const latin = childByLocal(rPr, 'latin')?.getAttribute('typeface');
          style = {
            sizePt: Number.isFinite(sz) && sz > 0 ? sz / 100 : undefined,
            bold: rPr.getAttribute('b') === '1' || undefined,
            italic: rPr.getAttribute('i') === '1' || undefined,
            underline: u && u !== 'none' ? true : undefined,
            color: parseSolidFill(rPr)?.hex,
            // '+mj-lt' / '+mn-lt' are theme font references; resolved against
            // the deck's own fontScheme, and dropped only if it had none.
            fontFamily: resolveTypeface(latin),
          };
        }
      }
    }
    lines.push(line);
  }

  const text = lines.join('\n').trim();
  if (!text) return null;
  return { text, align, listStyle, ...style };
}

// ── Geometry ───────────────────────────────────────────────────────────────────

/** Accumulated group transform: child-EMU → slide-EMU. */
interface Ctx {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

const IDENTITY: Ctx = { ox: 0, oy: 0, sx: 1, sy: 1 };

interface BoxEMU {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise (a:xfrm @rot is 60000ths of a degree). */
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

function readXfrm(xfrm: Element | null, ctx: Ctx): BoxEMU | null {
  const off = childByLocal(xfrm, 'off');
  const ext = childByLocal(xfrm, 'ext');
  if (!xfrm || !off || !ext) return null;
  return {
    x: ctx.ox + Number(off.getAttribute('x') || 0) * ctx.sx,
    y: ctx.oy + Number(off.getAttribute('y') || 0) * ctx.sy,
    w: Number(ext.getAttribute('cx') || 0) * ctx.sx,
    h: Number(ext.getAttribute('cy') || 0) * ctx.sy,
    rot: Number(xfrm.getAttribute('rot') || 0) / 60000,
    flipH: xfrm.getAttribute('flipH') === '1',
    flipV: xfrm.getAttribute('flipV') === '1',
  };
}

/** Child-space mapping for a p:grpSp (a:off/a:ext vs a:chOff/a:chExt). Group rotation is ignored. */
function groupCtx(grpXfrm: Element, parent: Ctx): Ctx {
  const box = readXfrm(grpXfrm, parent);
  if (!box) return parent;
  const ext = childByLocal(grpXfrm, 'ext');
  const chOff = childByLocal(grpXfrm, 'chOff');
  const chExt = childByLocal(grpXfrm, 'chExt');
  const chW = Number(chExt?.getAttribute('cx') ?? ext?.getAttribute('cx') ?? 0) || 1;
  const chH = Number(chExt?.getAttribute('cy') ?? ext?.getAttribute('cy') ?? 0) || 1;
  const sx = box.w / chW;
  const sy = box.h / chH;
  return {
    ox: box.x - Number(chOff?.getAttribute('x') ?? 0) * sx,
    oy: box.y - Number(chOff?.getAttribute('y') ?? 0) * sy,
    sx,
    sy,
  };
}

/** a:ln summary — stroke color, width, arrowheads. */
interface LnInfo {
  stroke?: string;
  /** Stroke alpha 0..1 (only meaningful alongside `stroke`); undefined = opaque. */
  strokeAlpha?: number;
  widthEmu: number;
  /** OOXML headEnd = the line's FIRST point; tailEnd = its last. */
  headEnd: ArrowHead;
  tailEnd: ArrowHead;
  /** True when the respective end carries anything other than 'none'. */
  headArrow: boolean;
  tailArrow: boolean;
  dash?: 'dashed' | 'dotted';
}

/** OOXML line-end type → our terminator. Nothing maps back to the outline or bar variants. */
const OOXML_ARROW_HEADS: Record<string, ArrowHead> = {
  none: 'none',
  arrow: 'arrow',
  triangle: 'triangle',
  stealth: 'triangle',
  diamond: 'diamond',
  oval: 'circle',
};

function arrowHeadOf(el: Element | null): ArrowHead {
  const t = el?.getAttribute('type');
  if (!t) return 'none';
  return Object.prototype.hasOwnProperty.call(OOXML_ARROW_HEADS, t)
    ? OOXML_ARROW_HEADS[t]
    : 'triangle'; // unknown but present — something is drawn there
}

function dashKind(ln: Element): 'dashed' | 'dotted' | undefined {
  const val = childByLocal(ln, 'prstDash')?.getAttribute('val');
  if (!val || val === 'solid') return undefined;
  return /dot/i.test(val) && !/dashDot/i.test(val) ? 'dotted' : 'dashed';
}

function lnInfo(spPr: Element | null): LnInfo {
  const ln = childByLocal(spPr, 'ln');
  const noHeads = { headEnd: 'none' as ArrowHead, tailEnd: 'none' as ArrowHead, headArrow: false, tailArrow: false };
  if (!ln || childByLocal(ln, 'noFill')) {
    return { widthEmu: Number(ln?.getAttribute('w')) || 9525, ...noHeads };
  }
  const fill = parseSolidFill(ln);
  // Our own exporter's "invisible shape" sentinel is a fully-transparent
  // solidFill (not noFill — see PptxExporter._emitOverlayBox), which the
  // noFill guard above misses; treat alpha≈0 as no stroke too so fill-only
  // shapes don't reimport with a spurious ~1px outline.
  if (fill && fill.alpha <= 0.004) {
    return { widthEmu: Number(ln.getAttribute('w')) || 9525, ...noHeads };
  }
  const headEnd = arrowHeadOf(childByLocal(ln, 'headEnd'));
  const tailEnd = arrowHeadOf(childByLocal(ln, 'tailEnd'));
  return {
    stroke: fill?.hex,
    strokeAlpha: fill && fill.alpha < 1 ? fill.alpha : undefined,
    widthEmu: Number(ln.getAttribute('w')) || 9525, // 0.75pt PowerPoint default
    headEnd,
    tailEnd,
    headArrow: headEnd !== 'none',
    tailArrow: tailEnd !== 'none',
    dash: dashKind(ln),
  };
}

/** Slide titles longer than this are elided — they're a strip label, not prose. */
const MAX_DERIVED_TITLE = 60;

/**
 * Name a slide that has no real title placeholder.
 *
 * Only a `p:ph` of type title/ctrTitle sets `slide.title` during the walk, and
 * plenty of decks never use one — a large plain text box is just as common. Those
 * decks used to import as "Imported slide 1…57", which is useless in the slide
 * strip and the jump grid. Fall back to whichever text most looks like a heading:
 * biggest type wins, ties broken by whatever sits highest on the slide.
 */
function titleFromOverlays(overlays: readonly SlideOverlay[]): string | undefined {
  let best: SlideOverlay | undefined;
  for (const o of overlays) {
    if (o.kind !== 'text' || !o.text?.trim()) continue;
    if (
      !best ||
      (o.fontSize ?? 0) > (best.fontSize ?? 0) ||
      ((o.fontSize ?? 0) === (best.fontSize ?? 0) && o.y < best.y)
    ) {
      best = o;
    }
  }
  // A heading is its first non-empty line — bullet bodies would otherwise drag
  // their whole content into the title.
  const line = best?.text
    ?.split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > MAX_DERIVED_TITLE ? `${line.slice(0, MAX_DERIVED_TITLE - 1)}…` : line;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

// ── Parser ─────────────────────────────────────────────────────────────────────

export async function parsePptx(
  data: ArrayBuffer,
  opts: PptxImportOptions,
): Promise<PptxImportResult> {
  // The exporter's script-tag bundle carries JSZip as its first UMD segment.
  await loadPptxGenJS();
  const JSZip = (window as any).JSZip;
  if (!JSZip) throw new Error('window.JSZip unavailable after loading the pptxgen bundle');

  const zip = await JSZip.loadAsync(data).catch(() => null);
  if (!zip) throw new Error('Not a valid PowerPoint file (not a zip archive)');

  const readXml = async (path: string): Promise<Document | null> => {
    const file = zip.file(path);
    if (!file) return null;
    const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
    return firstByLocal(doc, 'parsererror') ? null : doc;
  };

  const presDoc = await readXml('ppt/presentation.xml');
  if (!presDoc) throw new Error('Not a valid PowerPoint file (ppt/presentation.xml missing)');

  const sldSz = firstByLocal(presDoc, 'sldSz');
  const sldCx = Number(sldSz?.getAttribute('cx')) || 12192000; // 16:9 default
  const sldCy = Number(sldSz?.getAttribute('cy')) || 6858000;
  const nx = (emu: number) => emu / sldCx;
  const ny = (emu: number) => emu / sldCy;
  const ptToFrac = (pt: number) => (pt * EMU_PER_PT) / sldCy;

  const warnings: string[] = [];
  const skipped = new Map<string, number>();
  const bump = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1);

  // Slide order: p:sldIdLst r:ids → presentation rels → part paths.
  const presRels = relTargets(await readXml('ppt/_rels/presentation.xml.rels'), 'ppt');

  // Theme, via the FIRST slide master (which also owns the clrMap that says
  // what tx1/bg1 point at). Decks with several masters can theme differently
  // per master; the first one is what the overwhelming majority use throughout,
  // and getting its palette right beats getting none of them right.
  THEME = null;
  try {
    const masterPath = [...presRels.values()].find((r) => r.type.endsWith('/slideMaster'))?.target;
    if (masterPath) {
      const masterDoc = await readXml(masterPath);
      const masterDir = masterPath.slice(0, masterPath.lastIndexOf('/'));
      const masterName = masterPath.slice(masterPath.lastIndexOf('/') + 1);
      const masterRels = relTargets(
        await readXml(`${masterDir}/_rels/${masterName}.rels`),
        masterDir,
      );
      const themePath = [...masterRels.values()].find((r) => r.type.endsWith('/theme'))?.target;
      if (themePath) {
        THEME = readTheme(await readXml(themePath), firstByLocal(masterDoc, 'clrMap'));
      }
    }
  } catch {
    // A malformed theme must not fail the import — the defaults still work.
    THEME = null;
  }
  let slidePaths = allByLocal(presDoc, 'sldId')
    .map((el) => ridOf(el, 'id'))
    .map((id) => (id ? presRels.get(id)?.target : undefined))
    .filter((p): p is string => !!p);
  if (!slidePaths.length) {
    // Defensive fallback: enumerate ppt/slides/slideN.xml numerically.
    slidePaths = Object.keys(zip.files)
      .filter((p: string) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a: string, b: string) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  }
  if (slidePaths.length > MAX_SLIDES) {
    warnings.push(
      `Deck has ${slidePaths.length} slides — only the first ${MAX_SLIDES} were imported`,
    );
    slidePaths = slidePaths.slice(0, MAX_SLIDES);
  }

  // Placeholders (title/body) usually inherit their position from the slide
  // layout — cache each layout's ph geometry so slide-level text lands where
  // PowerPoint drew it.
  const layoutCache = new Map<string, Map<string, BoxEMU>>();
  const getLayoutPlaceholders = async (path?: string): Promise<Map<string, BoxEMU>> => {
    if (!path) return new Map();
    let cached = layoutCache.get(path);
    if (cached) return cached;
    cached = new Map();
    const doc = await readXml(path);
    for (const sp of allByLocal(doc, 'sp')) {
      const ph = firstByLocal(sp, 'ph');
      if (!ph) continue;
      const box = readXfrm(childByLocal(childByLocal(sp, 'spPr'), 'xfrm'), IDENTITY);
      if (!box) continue;
      const idx = ph.getAttribute('idx');
      const type = ph.getAttribute('type');
      if (idx != null && !cached.has(`idx:${idx}`)) cached.set(`idx:${idx}`, box);
      if (type && !cached.has(`type:${type}`)) cached.set(`type:${type}`, box);
    }
    layoutCache.set(path, cached);
    return cached;
  };

  /**
   * The parts a slide inherits static furniture from, in PAINT order:
   * [master, layout]. Cached — a 60-slide deck usually has two or three
   * layouts between them, and re-reading each layout's rels 60 times is pure
   * waste.
   */
  const inheritedCache = new Map<string, string[]>();
  const inheritedParts = async (layoutPath?: string): Promise<string[]> => {
    if (!layoutPath) return [];
    const cached = inheritedCache.get(layoutPath);
    if (cached) return cached;
    const dir = layoutPath.slice(0, layoutPath.lastIndexOf('/'));
    const name = layoutPath.slice(layoutPath.lastIndexOf('/') + 1);
    const layoutRels = relTargets(await readXml(`${dir}/_rels/${name}.rels`), dir);
    const masterPath = [...layoutRels.values()].find((r) =>
      r.type.endsWith('/slideMaster'),
    )?.target;
    const parts = masterPath ? [masterPath, layoutPath] : [layoutPath];
    inheritedCache.set(layoutPath, parts);
    return parts;
  };

  const parseSlide = async (
    slidePath: string,
    index: number,
  ): Promise<{ slide: Slide; rawLinks: Map<string, RawLink> } | null> => {
    const slideDoc = await readXml(slidePath);
    if (!slideDoc) {
      warnings.push(`Slide ${index + 1}: unreadable XML — skipped`);
      return null;
    }
    const slideDir = slidePath.slice(0, slidePath.lastIndexOf('/'));
    const slideName = slidePath.slice(slidePath.lastIndexOf('/') + 1);
    // `let`, not `const`: the inherited (layout/master) pass below re-points it
    // at that part's own rels, because a logo on the layout resolves its r:id
    // against the LAYOUT's relationships, not the slide's.
    const slideRels = relTargets(await readXml(`${slideDir}/_rels/${slideName}.rels`), slideDir);
    let rels = slideRels;
    const layoutPh = await getLayoutPlaceholders(
      [...slideRels.values()].find((r) => r.type.endsWith('/slideLayout'))?.target,
    );

    const overlays: SlideOverlay[] = [];
    /** overlay id → its unresolved link. Keyed so the second pass is a lookup. */
    const rawLinks = new Map<string, RawLink>();
    const pics: Array<{ x: number; y: number; w: number; h: number; dataUrl: string }> = [];
    let title: string | undefined;

    const layoutBox = (phEl: Element): BoxEMU | null => {
      const idx = phEl.getAttribute('idx');
      const type = phEl.getAttribute('type');
      return (
        (idx != null ? layoutPh.get(`idx:${idx}`) : undefined) ??
        (type ? layoutPh.get(`type:${type}`) : undefined) ??
        (type === 'title' || type === 'ctrTitle'
          ? layoutPh.get('type:title') ?? layoutPh.get('type:ctrTitle')
          : undefined) ??
        null
      );
    };

    const pushOverlay = (o: SlideOverlay | null): void => {
      if (o && overlays.length < MAX_OVERLAYS_PER_SLIDE) overlays.push(o);
      else if (o) bump('overlay cap reached — element skipped');
    };

    const emitText = (box: BoxEMU, info: TextInfo): void => {
      pushOverlay({
        id: overlayUuid(),
        kind: 'text',
        x: nx(box.x),
        y: ny(box.y),
        w: Math.max(0.01, nx(box.w)),
        h: Math.max(0.01, ny(box.h)),
        rotation: box.rot ? Math.round(box.rot * 10) / 10 : undefined,
        text: info.text,
        fontFamily: info.fontFamily ?? 'Arial',
        fontSize: ptToFrac(info.sizePt ?? 18),
        bold: info.bold,
        italic: info.italic,
        underline: info.underline,
        align: info.align,
        textColor: info.color ?? '#000000',
        // PowerPoint stores list text clean with the bullet as a paragraph
        // property, which is exactly how SlideOverlay stores it too.
        listStyle: info.listStyle,
      });
    };

    const shapeOverlay = (
      kind: PrstBoxKind,
      box: BoxEMU,
      fill: { hex: string; alpha: number } | null,
      ln: LnInfo,
      /** Extra degrees the preset itself implies — a leftArrow is a rotated rightArrow. */
      presetRotation = 0,
    ): SlideOverlay | null => {
      const hasFill = !!fill && fill.alpha > 0;
      if (!hasFill && !ln.stroke) return null; // invisible shape (e.g. a plain text box)

      let rotation = box.rot ? Math.round(box.rot * 10) / 10 : 0;
      // rect/ellipse/diamond are symmetric on both axes — any flip is a
      // visual no-op. triangle/star are only symmetric on the vertical axis
      // (our renderers draw both point-up — see OverlayFabric.ts), so a
      // vertical flip (PowerPoint's "Flip Vertical", far more common than
      // the rotate handle) needs +180° or it silently imports point-up.
      if (presetRotation) rotation += presetRotation;
      if (box.flipV && (kind === 'triangle' || kind === 'star')) {
        rotation = ((rotation + 180) % 360 + 360) % 360;
      } else if (BLOCK_ARROW_PRST_KINDS.has(kind)) {
        // Block arrows are symmetric about their horizontal midline, so a
        // horizontal flip is exactly a half turn and a vertical one is a no-op.
        if (box.flipH) rotation += 180;
      } else if ((box.flipH || box.flipV) && kind === 'callout') {
        // The tail is hard-coded bottom-left (OverlayFabric.ts) — no
        // rotation reproduces a flipped callout, so just flag the loss.
        bump('callout flip ignored — tail position may not match the source');
      }

      rotation = (((rotation % 360) + 360) % 360) || 0;

      return {
        id: overlayUuid(),
        kind,
        x: nx(box.x),
        y: ny(box.y),
        w: Math.max(0.001, nx(box.w)),
        h: Math.max(0.001, ny(box.h)),
        rotation: rotation || undefined,
        fill: hasFill ? fill!.hex : undefined,
        fillOpacity: hasFill && fill!.alpha < 1 ? Number(fill!.alpha.toFixed(3)) : undefined,
        stroke: ln.stroke,
        strokeWidth: ln.stroke ? ln.widthEmu / sldCy : undefined,
        strokeDash: ln.stroke ? ln.dash : undefined,
      };
    };

    const connectorOverlay = (box: BoxEMU, ln: LnInfo): SlideOverlay => {
      let x0 = box.x;
      let y0 = box.y;
      let x1 = box.x + box.w;
      let y1 = box.y + box.h;
      if (box.flipH) [x0, x1] = [x1, x0];
      if (box.flipV) [y0, y1] = [y1, y0];
      if (box.rot) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const rad = (box.rot * Math.PI) / 180;
        const rot = (px: number, py: number) => ({
          x: cx + (px - cx) * Math.cos(rad) - (py - cy) * Math.sin(rad),
          y: cy + (px - cx) * Math.sin(rad) + (py - cy) * Math.cos(rad),
        });
        ({ x: x0, y: y0 } = rot(x0, y0));
        ({ x: x1, y: y1 } = rot(x1, y1));
      }
      const p0 = { x: nx(x0), y: ny(y0) };
      const p1 = { x: nx(x1), y: ny(y1) };
      // OOXML head/tail map straight onto our per-end terminators — point order
      // is preserved (this used to swap the endpoints instead, back when an
      // arrow overlay could only draw one head, always at points[1]).
      return {
        id: overlayUuid(),
        kind: ln.headArrow || ln.tailArrow ? 'arrow' : 'line',
        x: Math.min(p0.x, p1.x),
        y: Math.min(p0.y, p1.y),
        w: Math.max(0.001, Math.abs(p1.x - p0.x)),
        h: Math.max(0.001, Math.abs(p1.y - p0.y)),
        points: [p0, p1],
        arrowStart: ln.headEnd,
        arrowEnd: ln.tailEnd,
        stroke: ln.stroke ?? '#000000',
        strokeWidth: ln.widthEmu / sldCy,
        strokeDash: ln.dash,
        opacity: ln.strokeAlpha != null ? Number(ln.strokeAlpha.toFixed(3)) : undefined,
      };
    };

    /** custGeom → freehand (curves flatten to their endpoints — fine for imported ink). */
    const custGeomOverlays = (cust: Element, box: BoxEMU, ln: LnInfo): SlideOverlay[] => {
      const out: SlideOverlay[] = [];
      for (const path of allByLocal(cust, 'path')) {
        const pw = Number(path.getAttribute('w')) || box.w || 1;
        const ph = Number(path.getAttribute('h')) || box.h || 1;
        const toSlide = (ptEl: Element | null): { x: number; y: number } | null => {
          if (!ptEl) return null;
          let rx = Number(ptEl.getAttribute('x') || 0) / pw;
          let ry = Number(ptEl.getAttribute('y') || 0) / ph;
          if (box.flipH) rx = 1 - rx;
          if (box.flipV) ry = 1 - ry;
          return { x: nx(box.x + rx * box.w), y: ny(box.y + ry * box.h) };
        };
        const subpaths: Array<Array<{ x: number; y: number }>> = [];
        let cur: Array<{ x: number; y: number }> = [];
        const flush = () => {
          if (cur.length >= 2) subpaths.push(cur);
          cur = [];
        };
        for (const cmd of Array.from(path.children)) {
          switch (cmd.localName) {
            case 'moveTo':
            case 'lnTo': {
              if (cmd.localName === 'moveTo') flush();
              const p = toSlide(childByLocal(cmd, 'pt'));
              if (p) cur.push(p);
              break;
            }
            case 'cubicBezTo':
            case 'quadBezTo': {
              const pts = childrenByLocal(cmd, 'pt');
              const p = toSlide(pts[pts.length - 1] ?? null);
              if (p) cur.push(p);
              bump('curved path flattened');
              break;
            }
            case 'close':
              if (cur.length >= 2) cur.push({ ...cur[0] });
              break;
            case 'arcTo':
              bump('arc segment skipped');
              break;
          }
        }
        flush();

        for (const pts of subpaths) {
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
          const twoPoint = pts.length === 2;
          const isArrow = twoPoint && (ln.headArrow || ln.tailArrow);
          out.push({
            id: overlayUuid(),
            kind: twoPoint ? (isArrow ? 'arrow' : 'line') : 'freehand',
            x: minX,
            y: minY,
            w: Math.max(0.001, maxX - minX),
            h: Math.max(0.001, maxY - minY),
            // Point order preserved — the terminators carry which end is which.
            points: pts,
            ...(isArrow ? { arrowStart: ln.headEnd, arrowEnd: ln.tailEnd } : {}),
            stroke: ln.stroke ?? '#FF3B30',
            strokeWidth: ln.widthEmu / sldCy,
            strokeDash: ln.dash,
            // A highlighter overlay exports through this same custGeom path
            // (translucent line) — without this, it would reimport fully
            // opaque and obscure the map it was meant to highlight.
            opacity: ln.strokeAlpha != null ? Number(ln.strokeAlpha.toFixed(3)) : undefined,
          });
        }
      }
      return out;
    };

    /**
     * Attach one element's hyperlink to every overlay it produced. A single
     * `p:sp` can yield several (a custGeom's subpaths, or a shape plus its text
     * box) and PowerPoint's link belongs to the shape as a whole, so each piece
     * becomes clickable — which is also what makes the shape+label pair behave
     * like one button.
     */
    const linkOverlaysFrom = (el: Element, ownerTag: string, firstIndex: number): void => {
      if (overlays.length <= firstIndex) return;
      const cNvPr = childByLocal(childByLocal(el, ownerTag), 'cNvPr');
      const raw = readHlink(cNvPr, rels, () =>
        bump('external URL link imported'),
      );
      if (!raw) return;
      for (let i = firstIndex; i < overlays.length; i++) rawLinks.set(overlays[i].id, raw);
    };

    const handleSp = (sp: Element): void => {
      const firstOverlay = overlays.length;
      const spPr = childByLocal(sp, 'spPr');
      const phEl = firstByLocal(sp, 'ph');
      // Walking the layout/master brings in their STATIC furniture only — a
      // placeholder there is a slot the slide fills, and importing it would
      // duplicate the slide's own content (or paste in prompt text like
      // "Click to edit Master title style").
      if (inheritedPass && phEl) return;
      const phType = phEl?.getAttribute('type') ?? (phEl ? 'body' : null);
      let box = readXfrm(childByLocal(spPr, 'xfrm'), currentCtx);
      if (!box && phEl) box = layoutBox(phEl);
      const textInfo = extractText(childByLocal(sp, 'txBody'));

      if (phType === 'title' || phType === 'ctrTitle') {
        // Titles map to slide.title — the exporter re-draws them natively.
        if (textInfo && !title) title = textInfo.text.replace(/\n+/g, ' ');
        return;
      }

      const ln = lnInfo(spPr);
      const fill = spPr && !childByLocal(spPr, 'noFill') ? parseSolidFill(spPr) : null;
      const prst = firstByLocal(spPr, 'prstGeom')?.getAttribute('prst') ?? null;
      const cust = spPr ? firstByLocal(spPr, 'custGeom') : null;

      const PRST_BOX_KINDS: Record<string, PrstBoxKind> = {
        rect: 'rect',
        roundRect: 'rect',
        ellipse: 'ellipse',
        diamond: 'diamond',
        triangle: 'triangle',
        star5: 'star',
        wedgeRoundRectCallout: 'callout',
        wedgeRectCallout: 'callout',
        // The block arrows we export as presets come back as themselves. Their
        // adjustment values are not read: the head size reverts to our default,
        // which is the same OOXML default the preset was written with.
        rightArrow: 'blockArrow',
        leftArrow: 'blockArrow',
        leftRightArrow: 'blockArrowDouble',
        chevron: 'chevron',
        homePlate: 'chevron',
      };

      if (box) {
        if (cust) {
          custGeomOverlays(cust, box, ln).forEach(pushOverlay);
        } else if (prst && Object.prototype.hasOwnProperty.call(PRST_BOX_KINDS, prst)) {
          // A leftArrow is our blockArrow turned around; nothing else in the
          // table carries a direction the preset name alone implies.
          pushOverlay(shapeOverlay(PRST_BOX_KINDS[prst], box, fill, ln, prst === 'leftArrow' ? 180 : 0));
        } else if (prst === 'line' || /Connector/.test(prst ?? '')) {
          pushOverlay(connectorOverlay(box, ln));
        } else if (prst && !textInfo) {
          bump(`unsupported shape "${prst}"`);
        }
      }
      if (textInfo) {
        if (box) emitText(box, textInfo);
        else bump('text without position skipped (no slide/layout geometry)');
      }
      linkOverlaysFrom(sp, 'nvSpPr', firstOverlay);
    };

    const handleCxn = (cxn: Element): void => {
      const firstOverlay = overlays.length;
      const spPr = childByLocal(cxn, 'spPr');
      const box = readXfrm(childByLocal(spPr, 'xfrm'), currentCtx);
      if (!box) {
        bump('unpositioned connector skipped');
        return;
      }
      pushOverlay(connectorOverlay(box, lnInfo(spPr)));
      linkOverlaysFrom(cxn, 'nvCxnSpPr', firstOverlay);
    };

    const handlePic = async (pic: Element): Promise<void> => {
      const box = readXfrm(childByLocal(childByLocal(pic, 'spPr'), 'xfrm'), currentCtx);
      if (!box) {
        bump('unpositioned picture skipped');
        return;
      }
      // A p:pic is also how PowerPoint carries audio and video: the media is a
      // separate part and the blip is only its poster frame. The briefing model
      // has no media object, so the poster imports as an ordinary picture and
      // the playback is reported as lost rather than dropped in silence.
      const nvPr = childByLocal(childByLocal(pic, 'nvPicPr'), 'nvPr');
      if (nvPr && (childByLocal(nvPr, 'videoFile') || childByLocal(nvPr, 'audioFile'))) {
        bump('embedded audio/video kept as its poster image only — playback is not imported');
      }
      const blip = firstByLocal(pic, 'blip');
      const rid = blip ? ridOf(blip, 'embed') : null;
      const target = rid ? rels.get(rid)?.target : undefined;
      if (!target) {
        bump('picture with no media skipped');
        return;
      }
      const ext = target.slice(target.lastIndexOf('.') + 1).toLowerCase();
      const mime = PIC_MIME[ext];
      const file = mime ? zip.file(target) : null;
      if (!file) {
        bump(`unsupported picture format .${ext}`);
        return;
      }
      if (box.rot) bump('picture rotation ignored');
      pics.push({
        x: nx(box.x),
        y: ny(box.y),
        w: nx(box.w),
        h: ny(box.h),
        dataUrl: `data:${mime};base64,${await file.async('base64')}`,
      });
      // Pictures are composited into the flat background, so a linked one has
      // no overlay of its own to carry the link. Give it an invisible hotspot
      // over the same box instead: a fill-less, stroke-less rect that draws
      // nothing, exports as a real linked shape, and is selectable (and
      // restylable into a visible button) in the slide editor.
      const raw = readHlink(
        childByLocal(childByLocal(pic, 'nvPicPr'), 'cNvPr'),
        rels,
        () => bump('external URL link imported'),
      );
      if (raw) {
        const hotspot: SlideOverlay = {
          id: overlayUuid(),
          kind: 'rect',
          x: nx(box.x),
          y: ny(box.y),
          w: Math.max(0.001, nx(box.w)),
          h: Math.max(0.001, ny(box.h)),
        };
        const before = overlays.length;
        pushOverlay(hotspot);
        // Skipped when the overlay cap was already reached — then there is no
        // object to link and the link goes with it.
        if (overlays.length > before) rawLinks.set(hotspot.id, raw);
        else bump('picture link dropped (overlay cap reached)');
      }
    };

    /**
     * a:tbl → a real `table` overlay, so a table survives the round-trip as an
     * editable table rather than as prose. (It used to flatten to one text box
     * with " | "-joined cells.)
     *
     * Merges round-trip: `gridSpan` / `rowSpan` on an anchor cell become a
     * TableMerge, and the `hMerge` / `vMerge` continuation cells it covers
     * import empty. The underlying grid keeps its full row and column count
     * either way, so every other cell stays in its correct position even if a
     * merge is later dropped by `normalizeMerges`.
     */
    const tableOverlay = (tbl: Element, box: BoxEMU): SlideOverlay | null => {
      const gridCols = childrenByLocal(firstByLocal(tbl, 'tblGrid'), 'gridCol');
      const trs = childrenByLocal(tbl, 'tr');
      if (!trs.length) return null;

      // The grid is authoritative for the column count; a row with a gridSpan
      // has fewer <tc> elements than there are columns.
      const nCols = Math.max(
        1,
        gridCols.length || Math.max(...trs.map((tr) => childrenByLocal(tr, 'tc').length), 1),
      );

      let cellStyle: TextInfo | null = null;
      const rows: string[][] = [];
      const merges: TableMerge[] = [];

      for (let r = 0; r < trs.length; r++) {
        const out = new Array<string>(nCols).fill('');
        let col = 0;
        for (const tc of childrenByLocal(trs[r], 'tc')) {
          if (col >= nCols) break;
          const span = Math.max(1, Number(tc.getAttribute('gridSpan')) || 1);
          const rowSpan = Math.max(1, Number(tc.getAttribute('rowSpan')) || 1);
          const isContinuation =
            tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1';
          if (!isContinuation) {
            // Only the ANCHOR carries the spans; continuations are the cells it
            // covers, which normalizeMerges will hide.
            if (span > 1 || rowSpan > 1) merges.push({ r, c: col, rowspan: rowSpan, colspan: span });
            const info = extractText(firstByLocal(tc, 'txBody'));
            if (info) {
              out[col] = info.text;
              if (!cellStyle) cellStyle = info;
            }
          }
          col += span;
        }
        rows.push(out);
      }

      const totalGrid = gridCols.reduce((a, g) => a + (Number(g.getAttribute('w')) || 0), 0);
      const colWidths =
        gridCols.length === nCols && totalGrid > 0
          ? gridCols.map((g) => (Number(g.getAttribute('w')) || 0) / totalGrid)
          : undefined;
      const rowH = trs.map((tr) => Number(tr.getAttribute('h')) || 0);
      const totalRowH = rowH.reduce((a, b) => a + b, 0);
      const rowHeights = totalRowH > 0 ? rowH.map((h) => h / totalRowH) : undefined;

      // firstRow only means "the header is styled differently"; the actual
      // header fill lives on the table style part, which isn't resolved here,
      // so the overlay default stands in.
      const headerRow = firstByLocal(tbl, 'tblPr')?.getAttribute('firstRow') === '1';
      const firstCell = firstByLocal(trs[0], 'tc');
      const cellFill = parseSolidFill(childByLocal(firstCell, 'tcPr'));
      const border = lnInfo(childByLocal(firstCell, 'tcPr'));

      return {
        id: overlayUuid(),
        kind: 'table',
        x: nx(box.x),
        y: ny(box.y),
        w: Math.max(0.01, nx(box.w)),
        h: Math.max(0.01, ny(box.h)),
        rows,
        colWidths,
        rowHeights,
        // Re-validated against the grid the rows actually produced, so a
        // malformed span can never make the table unrenderable.
        merges: merges.length ? normalizeMerges(merges, rows.length, nCols) : undefined,
        headerRow: headerRow || undefined,
        fill: cellFill?.hex,
        fillOpacity:
          cellFill && cellFill.alpha < 1 ? Number(cellFill.alpha.toFixed(3)) : undefined,
        stroke: border.stroke,
        strokeWidth: border.stroke ? border.widthEmu / sldCy : undefined,
        strokeDash: border.stroke ? border.dash : undefined,
        fontFamily: cellStyle?.fontFamily ?? 'Arial',
        fontSize: ptToFrac(cellStyle?.sizePt ?? 14),
        italic: cellStyle?.italic,
        underline: cellStyle?.underline,
        align: cellStyle?.align,
        textColor: cellStyle?.color ?? '#000000',
      };
    };

    const handleFrame = async (frame: Element): Promise<void> => {
      const box = readXfrm(childByLocal(frame, 'xfrm'), currentCtx);
      const tbl = firstByLocal(frame, 'tbl');
      if (tbl && box) {
        if (box.rot) bump('table rotation ignored');
        pushOverlay(tableOverlay(tbl, box));
        return;
      }
      // A chart lives in its OWN part; the frame only holds an r:id to it.
      const chartRef = firstByLocal(frame, 'chart');
      if (chartRef && box) {
        const rid = ridOf(chartRef, 'id');
        const rel = rid ? rels.get(rid) : undefined;
        const spec = rel ? chartSpecFromPart(await readXml(rel.target)) : null;
        if (spec) {
          pushOverlay({
            id: overlayUuid(),
            kind: 'chart',
            x: nx(box.x),
            y: ny(box.y),
            w: Math.max(0.02, nx(box.w)),
            h: Math.max(0.02, ny(box.h)),
            chart: spec,
          });
          return;
        }
        bump('chart had no cached data — skipped');
        return;
      }
      const uri = firstByLocal(frame, 'graphicData')?.getAttribute('uri') ?? '';
      bump(`unsupported content (${uri.split('/').pop() || 'graphicFrame'}) skipped`);
    };

    // Depth-first walk in document order; currentCtx tracks the group transform.
    let currentCtx: Ctx = IDENTITY;
    /** True while walking a slideLayout / slideMaster rather than the slide. */
    let inheritedPass = false;
    const walk = async (container: Element, ctx: Ctx): Promise<void> => {
      const saved = currentCtx;
      currentCtx = ctx;
      try {
        for (const child of Array.from(container.children)) {
          try {
            switch (child.localName) {
              case 'sp':
                handleSp(child);
                break;
              case 'cxnSp':
                handleCxn(child);
                break;
              case 'pic':
                await handlePic(child);
                break;
              case 'graphicFrame':
                await handleFrame(child);
                break;
              case 'grpSp': {
                const xfrm = childByLocal(childByLocal(child, 'grpSpPr'), 'xfrm');
                await walk(child, xfrm ? groupCtx(xfrm, ctx) : ctx);
                break;
              }
              case 'contentPart':
              case 'AlternateContent':
                bump(`unsupported content (${child.localName}) skipped`);
                break;
              // nvGrpSpPr / grpSpPr and friends are metadata — silently fine.
            }
          } catch {
            bump(`element failed to parse (${child.localName})`);
          }
        }
      } finally {
        currentCtx = saved;
      }
    };

    // Master first, then layout, then the slide — PowerPoint's own paint order,
    // so inherited furniture (classification banners, unit crests, footers)
    // ends up BENEATH the slide's own content instead of on top of it. Without
    // this pass that furniture was simply lost on import.
    const layoutPath = [...slideRels.values()].find((r) =>
      r.type.endsWith('/slideLayout'),
    )?.target;
    inheritedPass = true;
    try {
      for (const path of await inheritedParts(layoutPath)) {
        const doc = await readXml(path);
        const tree = firstByLocal(doc, 'spTree');
        if (!tree) continue;
        const dir = path.slice(0, path.lastIndexOf('/'));
        const name = path.slice(path.lastIndexOf('/') + 1);
        rels = relTargets(await readXml(`${dir}/_rels/${name}.rels`), dir);
        await walk(tree, IDENTITY);
      }
    } catch {
      bump('slide layout/master furniture could not be read');
    } finally {
      inheritedPass = false;
      rels = slideRels;
    }

    const spTree = firstByLocal(slideDoc, 'spTree');
    if (spTree) await walk(spTree, IDENTITY);

    // Speaker notes: the notesSlide's body placeholder.
    let notes: string | undefined;
    const notesRel = [...rels.values()].find((r) => r.type.endsWith('/notesSlide'));
    if (notesRel) {
      const notesDoc = await readXml(notesRel.target);
      for (const sp of allByLocal(notesDoc, 'sp')) {
        if (firstByLocal(sp, 'ph')?.getAttribute('type') !== 'body') continue;
        const info = extractText(childByLocal(sp, 'txBody'));
        if (info) {
          notes = info.text;
          break;
        }
      }
    }

    // Background raster: slide bg color (white = PowerPoint default) + all
    // pictures composited in document order. Always produced so the slide
    // editor has a real backdrop even for text-only slides.
    const bgColor =
      parseSolidFill(firstByLocal(slideDoc, 'bgPr'))?.hex ?? '#FFFFFF';
    const W = BG_WIDTH_PX;
    const H = Math.max(2, Math.round((W * sldCy) / sldCx));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    let backgroundDataUrl: string | undefined;
    let thumbnailDataUrl: string | undefined;
    if (g) {
      g.fillStyle = bgColor;
      g.fillRect(0, 0, W, H);
      for (const p of pics) {
        const img = await loadImage(p.dataUrl);
        if (!img) {
          bump('picture failed to decode');
          continue;
        }
        try {
          g.drawImage(img, p.x * W, p.y * H, Math.max(1, p.w * W), Math.max(1, p.h * H));
        } catch {
          bump('picture failed to draw');
        }
      }
      backgroundDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const tW = THUMB_WIDTH_PX;
      const tH = Math.max(2, Math.round((tW * sldCy) / sldCx));
      const thumb = document.createElement('canvas');
      thumb.width = tW;
      thumb.height = tH;
      thumb.getContext('2d')?.drawImage(canvas, 0, 0, tW, tH);
      thumbnailDataUrl = thumb.toDataURL('image/jpeg', 0.72);
      // The raster above is background colour + pictures ONLY, so a text-heavy
      // slide would thumbnail blank. Flatten the overlays on top for the strip,
      // sorter, jump grid and presenter preview. `backgroundDataUrl` stays
      // overlay-free on purpose — present mode draws the overlays over it, and
      // baking them in would render everything twice.
      if (overlays.length) {
        thumbnailDataUrl =
          (await composeOverlayThumbnail(thumbnailDataUrl, overlays)) ?? thumbnailDataUrl;
      }
    }

    return {
      slide: {
        id: overlayUuid(),
        title: title || titleFromOverlays(overlays) || `Imported slide ${index + 1}`,
        notes,
        // Screen-only: no extent/camera — playback leaves the map untouched.
        view: { capturedIn: opts.capturedIn },
        visibleLayers: {},
        transitionMs: opts.defaultTransitionMs ?? 1000,
        // PowerPoint's "Hide Slide" is `<p:sld show="0">` on the slide part's
        // own root. Absent (the overwhelmingly common case) = shown.
        hidden: slideDoc.documentElement.getAttribute('show') === '0' || undefined,
        overlays: overlays.length ? overlays : undefined,
        backgroundDataUrl,
        thumbnailDataUrl,
      },
      rawLinks,
    };
  };

  const slides: Slide[] = [];
  /** Slide part path → the Slide it became. Only parsed slides are in here. */
  const slideByPath = new Map<string, Slide>();
  const pendingLinks: Array<{ slide: Slide; rawLinks: Map<string, RawLink> }> = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const parsed = await parseSlide(slidePaths[i], i);
    if (!parsed) continue;
    slides.push(parsed.slide);
    slideByPath.set(slidePaths[i], parsed.slide);
    if (parsed.rawLinks.size) pendingLinks.push({ slide: parsed.slide, rawLinks: parsed.rawLinks });
  }

  // Second pass: a link's target slide may not have been parsed when the link
  // was read, so only now can a target PATH become a Slide.id.
  let linked = 0;
  let unresolved = 0;
  for (const { slide, rawLinks } of pendingLinks) {
    for (const o of slide.overlays ?? []) {
      const raw = rawLinks.get(o.id);
      if (!raw) continue;
      const link = raw.url
        ? { url: raw.url, tooltip: raw.tooltip }
        : raw.jump
          ? { jump: raw.jump, tooltip: raw.tooltip }
          : (() => {
              const target = raw.targetPath ? slideByPath.get(raw.targetPath) : undefined;
              // Points at a slide the import dropped, or one past MAX_SLIDES.
              return target ? { slideId: target.id, tooltip: raw.tooltip } : null;
            })();
      const normalized = normalizeLink(link);
      if (normalized) {
        o.link = normalized;
        linked++;
      } else {
        unresolved++;
      }
    }
  }
  // Sections live in a PowerPoint 2010 extension on p:sldIdLst's parent:
  // p14:sectionLst → p14:section[@name] → p14:sldIdLst → p14:sldId[@id], where
  // the id is the same numeric p:sldId/@id the slide order uses. Matched by
  // that id rather than by position, because a deck can list them in any order.
  const pathByNumericId = new Map<string, string>();
  for (const el of allByLocal(presDoc, 'sldId')) {
    const numId = el.getAttribute('id');
    const rid = ridOf(el, 'id');
    const target = rid ? presRels.get(rid)?.target : undefined;
    if (numId && target) pathByNumericId.set(numId, target);
  }
  let sectioned = 0;
  for (const sect of allByLocal(presDoc, 'section')) {
    const name = (sect.getAttribute('name') || '').trim();
    if (!name) continue;
    for (const sid of allByLocal(sect, 'sldId')) {
      const path = pathByNumericId.get(sid.getAttribute('id') ?? '');
      const slide = path ? slideByPath.get(path) : undefined;
      if (slide && !slide.section) {
        slide.section = name;
        sectioned++;
      }
    }
  }
  if (sectioned) {
    warnings.push(`Imported ${sectioned} slide${sectioned > 1 ? 's' : ''} into named sections`);
  }

  if (linked) warnings.push(`Imported ${linked} slide link${linked > 1 ? 's' : ''}`);
  if (unresolved) {
    warnings.push(
      `${unresolved} link${unresolved > 1 ? 's' : ''} pointed at a slide that was not imported — dropped`,
    );
  }

  for (const [what, n] of skipped) {
    warnings.push(`Import note — ${what}${n > 1 ? ` (×${n})` : ''}`);
  }
  // Scoped to this parse — see DeckTheme.
  THEME = null;
  return { slides, warnings };
}

export default parsePptx;
