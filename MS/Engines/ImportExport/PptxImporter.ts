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
 *   - tables                        → flattened 'text' overlays (rows as
 *                                      lines, cells " | "-separated)
 *   - pictures                      → composited in document order into ONE
 *                                      background raster (backgroundDataUrl)
 *   - notes slides                  → slide.notes
 *
 * Imported slides are "screen-only": `view` has neither extent nor camera,
 * so playback leaves the map untouched and the editor / present mode / PPTX
 * re-export all use the stored backgroundDataUrl instead of a screenshot.
 *
 * Dynamically imported by BriefingEngine.importPptxFromFile() so none of
 * this loads until the first import.
 */

import { overlayUuid } from '../Briefing/OverlayFabric';
import type { Slide, SlideOverlay, ViewKind } from '../Briefing/BriefingTypes';
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
 * Theme colors can't be resolved without walking the theme part — map the
 * scheme slots to the standard Office defaults instead (dark text on light
 * background), which is right for the vast majority of decks.
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
): Map<string, { target: string; type: string }> {
  const map = new Map<string, { target: string; type: string }>();
  for (const rel of allByLocal(relsDoc, 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) {
      map.set(id, { target: resolveTarget(baseDir, target), type: rel.getAttribute('Type') ?? '' });
    }
  }
  return map;
}

/** First a:solidFill under `parent` → hex + alpha (a:alpha is thousandths of a percent). */
function parseSolidFill(parent: Element | null): { hex: string; alpha: number } | null {
  const fill = childByLocal(parent, 'solidFill');
  if (!fill) return null;
  let hex: string | null = null;
  const srgb = childByLocal(fill, 'srgbClr');
  const scheme = childByLocal(fill, 'schemeClr');
  if (srgb?.getAttribute('val')) hex = `#${srgb.getAttribute('val')!.slice(0, 6).toUpperCase()}`;
  else if (scheme?.getAttribute('val')) hex = SCHEME_COLOR_FALLBACKS[scheme.getAttribute('val')!] ?? null;
  if (!hex) return null;
  const alphaEl = firstByLocal(srgb ?? scheme, 'alpha');
  const alphaVal = Number(alphaEl?.getAttribute('val'));
  const alpha = Number.isFinite(alphaVal) ? Math.max(0, Math.min(1, alphaVal / 100000)) : 1;
  return { hex, alpha };
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
  align?: 'left' | 'center' | 'right';
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

  for (const p of childrenByLocal(txBody, 'p')) {
    if (align === undefined) {
      const algn = childByLocal(p, 'pPr')?.getAttribute('algn');
      if (algn === 'ctr') align = 'center';
      else if (algn === 'r') align = 'right';
      else if (algn) align = 'left';
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
            // '+mj-lt' / '+mn-lt' are theme font references — unresolvable here.
            fontFamily: latin && !latin.startsWith('+') ? latin : undefined,
          };
        }
      }
    }
    lines.push(line);
  }

  const text = lines.join('\n').trim();
  if (!text) return null;
  return { text, align, ...style };
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
  headArrow: boolean;
  tailArrow: boolean;
  dash?: 'dashed' | 'dotted';
}

function dashKind(ln: Element): 'dashed' | 'dotted' | undefined {
  const val = childByLocal(ln, 'prstDash')?.getAttribute('val');
  if (!val || val === 'solid') return undefined;
  return /dot/i.test(val) && !/dashDot/i.test(val) ? 'dotted' : 'dashed';
}

function lnInfo(spPr: Element | null): LnInfo {
  const ln = childByLocal(spPr, 'ln');
  const isArrow = (el: Element | null) => {
    const t = el?.getAttribute('type');
    return !!t && t !== 'none';
  };
  if (!ln || childByLocal(ln, 'noFill')) {
    return { widthEmu: Number(ln?.getAttribute('w')) || 9525, headArrow: false, tailArrow: false };
  }
  const fill = parseSolidFill(ln);
  // Our own exporter's "invisible shape" sentinel is a fully-transparent
  // solidFill (not noFill — see PptxExporter._emitOverlayBox), which the
  // noFill guard above misses; treat alpha≈0 as no stroke too so fill-only
  // shapes don't reimport with a spurious ~1px outline.
  if (fill && fill.alpha <= 0.004) {
    return { widthEmu: Number(ln.getAttribute('w')) || 9525, headArrow: false, tailArrow: false };
  }
  return {
    stroke: fill?.hex,
    strokeAlpha: fill && fill.alpha < 1 ? fill.alpha : undefined,
    widthEmu: Number(ln.getAttribute('w')) || 9525, // 0.75pt PowerPoint default
    headArrow: isArrow(childByLocal(ln, 'headEnd')),
    tailArrow: isArrow(childByLocal(ln, 'tailEnd')),
    dash: dashKind(ln),
  };
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

  const parseSlide = async (slidePath: string, index: number): Promise<Slide | null> => {
    const slideDoc = await readXml(slidePath);
    if (!slideDoc) {
      warnings.push(`Slide ${index + 1}: unreadable XML — skipped`);
      return null;
    }
    const slideDir = slidePath.slice(0, slidePath.lastIndexOf('/'));
    const slideName = slidePath.slice(slidePath.lastIndexOf('/') + 1);
    const rels = relTargets(await readXml(`${slideDir}/_rels/${slideName}.rels`), slideDir);
    const layoutPh = await getLayoutPlaceholders(
      [...rels.values()].find((r) => r.type.endsWith('/slideLayout'))?.target,
    );

    const overlays: SlideOverlay[] = [];
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
      });
    };

    const shapeOverlay = (
      kind: 'rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'callout',
      box: BoxEMU,
      fill: { hex: string; alpha: number } | null,
      ln: LnInfo,
    ): SlideOverlay | null => {
      const hasFill = !!fill && fill.alpha > 0;
      if (!hasFill && !ln.stroke) return null; // invisible shape (e.g. a plain text box)

      let rotation = box.rot ? Math.round(box.rot * 10) / 10 : 0;
      // rect/ellipse/diamond are symmetric on both axes — any flip is a
      // visual no-op. triangle/star are only symmetric on the vertical axis
      // (our renderers draw both point-up — see OverlayFabric.ts), so a
      // vertical flip (PowerPoint's "Flip Vertical", far more common than
      // the rotate handle) needs +180° or it silently imports point-up.
      if (box.flipV && (kind === 'triangle' || kind === 'star')) {
        rotation = ((rotation + 180) % 360 + 360) % 360;
      } else if ((box.flipH || box.flipV) && kind === 'callout') {
        // The tail is hard-coded bottom-left (OverlayFabric.ts) — no
        // rotation reproduces a flipped callout, so just flag the loss.
        bump('callout flip ignored — tail position may not match the source');
      }

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
      let p0 = { x: nx(x0), y: ny(y0) };
      let p1 = { x: nx(x1), y: ny(y1) };
      // Our arrow overlay draws its head at points[1].
      if (ln.headArrow && !ln.tailArrow) [p0, p1] = [p1, p0];
      return {
        id: overlayUuid(),
        kind: ln.headArrow || ln.tailArrow ? 'arrow' : 'line',
        x: Math.min(p0.x, p1.x),
        y: Math.min(p0.y, p1.y),
        w: Math.max(0.001, Math.abs(p1.x - p0.x)),
        h: Math.max(0.001, Math.abs(p1.y - p0.y)),
        points: [p0, p1],
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
          out.push({
            id: overlayUuid(),
            kind: twoPoint ? (ln.headArrow || ln.tailArrow ? 'arrow' : 'line') : 'freehand',
            x: minX,
            y: minY,
            w: Math.max(0.001, maxX - minX),
            h: Math.max(0.001, maxY - minY),
            points: twoPoint && ln.headArrow && !ln.tailArrow ? [pts[1], pts[0]] : pts,
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

    const handleSp = (sp: Element): void => {
      const spPr = childByLocal(sp, 'spPr');
      const phEl = firstByLocal(sp, 'ph');
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

      const PRST_BOX_KINDS: Record<
        string,
        'rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'callout'
      > = {
        rect: 'rect',
        roundRect: 'rect',
        ellipse: 'ellipse',
        diamond: 'diamond',
        triangle: 'triangle',
        star5: 'star',
        wedgeRoundRectCallout: 'callout',
        wedgeRectCallout: 'callout',
      };

      if (box) {
        if (cust) {
          custGeomOverlays(cust, box, ln).forEach(pushOverlay);
        } else if (prst && Object.prototype.hasOwnProperty.call(PRST_BOX_KINDS, prst)) {
          pushOverlay(shapeOverlay(PRST_BOX_KINDS[prst], box, fill, ln));
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
    };

    const handleCxn = (cxn: Element): void => {
      const spPr = childByLocal(cxn, 'spPr');
      const box = readXfrm(childByLocal(spPr, 'xfrm'), currentCtx);
      if (!box) {
        bump('unpositioned connector skipped');
        return;
      }
      pushOverlay(connectorOverlay(box, lnInfo(spPr)));
    };

    const handlePic = async (pic: Element): Promise<void> => {
      const box = readXfrm(childByLocal(childByLocal(pic, 'spPr'), 'xfrm'), currentCtx);
      if (!box) {
        bump('unpositioned picture skipped');
        return;
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
    };

    /** Tables flatten to text (rows as lines, cells " | "-separated) — confirmed design choice. */
    const handleFrame = (frame: Element): void => {
      const box = readXfrm(childByLocal(frame, 'xfrm'), currentCtx);
      const tbl = firstByLocal(frame, 'tbl');
      if (tbl && box) {
        const rows: string[] = [];
        let cellStyle: TextInfo | null = null;
        for (const tr of childrenByLocal(tbl, 'tr')) {
          const cells: string[] = [];
          for (const tc of childrenByLocal(tr, 'tc')) {
            const info = extractText(firstByLocal(tc, 'txBody'));
            if (info && !cellStyle) cellStyle = info;
            cells.push(info?.text.replace(/\n+/g, ' ') ?? '');
          }
          rows.push(cells.join(' | '));
        }
        const text = rows.join('\n').trim();
        if (text) {
          emitText(box, {
            text,
            sizePt: cellStyle?.sizePt ?? 14,
            bold: cellStyle?.bold,
            color: cellStyle?.color,
            fontFamily: cellStyle?.fontFamily,
          });
          bump('table flattened to text');
        }
        return;
      }
      const uri = firstByLocal(frame, 'graphicData')?.getAttribute('uri') ?? '';
      bump(`unsupported content (${uri.split('/').pop() || 'graphicFrame'}) skipped`);
    };

    // Depth-first walk in document order; currentCtx tracks the group transform.
    let currentCtx: Ctx = IDENTITY;
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
                handleFrame(child);
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
    }

    return {
      id: overlayUuid(),
      title: title || `Imported slide ${index + 1}`,
      notes,
      // Screen-only: no extent/camera — playback leaves the map untouched.
      view: { capturedIn: opts.capturedIn },
      visibleLayers: {},
      transitionMs: opts.defaultTransitionMs ?? 1000,
      overlays: overlays.length ? overlays : undefined,
      backgroundDataUrl,
      thumbnailDataUrl,
    };
  };

  const slides: Slide[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slide = await parseSlide(slidePaths[i], i);
    if (slide) slides.push(slide);
  }

  for (const [what, n] of skipped) {
    warnings.push(`Import note — ${what}${n > 1 ? ` (×${n})` : ''}`);
  }
  return { slides, warnings };
}

export default parsePptx;
