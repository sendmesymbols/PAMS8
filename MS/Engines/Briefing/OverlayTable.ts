/**
 * OverlayTable.ts
 *
 * The `table` overlay kind: geometry, fabric construction, read-back, cell
 * hit-testing, and pure row/column model edits.
 *
 * Lives apart from OverlayFabric (which delegates to it) because a table is
 * the only overlay with internal structure — everything else is one fabric
 * primitive, while a table is a Group of N×M cell rects plus N×M textboxes.
 *
 * fabric.js 4.5 is a CDN global (`window.fabric`) — never import it.
 *
 * Two invariants make this module simple:
 *
 *  1. **Tables never rotate or flip.** pptxgenjs `addTable` takes no `rotate`,
 *     so the editor withholds the control rather than let the export silently
 *     drop it. Cell hit-testing is therefore plain axis-aligned arithmetic —
 *     no inverse transform matrix.
 *  2. **Row/column edits are pure.** They take and return a model, never
 *     mutating a live fabric Group. fabric 4.5 group surgery
 *     (`addWithUpdate` / `_calcBounds`) is fragile; the editor instead rebuilds
 *     the object from the returned model and swaps it on the canvas, preserving
 *     id, z-order and selection.
 */

import { dashProps, overlayUuid, withAlpha } from './OverlayStyle';
import { coveredCells, mergeAt, normalizeMerges } from './TableMerges';
import type { SlideOverlay } from './BriefingTypes';

// Re-exported so table consumers keep one import site — the functions live in
// their own dependency-free module (see TableMerges) because the exporter and
// importer need them without pulling fabric-facing code in behind them.
export { coveredCells, mergeAt, normalizeMerges };

export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLS = 3;
/** Below this a table can't be edited meaningfully; above it, cells are unreadable. */
export const MIN_TABLE_ROWS = 1;
export const MIN_TABLE_COLS = 1;
export const MAX_TABLE_ROWS = 30;
export const MAX_TABLE_COLS = 15;

/** Default body fill — dark and translucent, so a table stays legible over map imagery. */
export const DEFAULT_TABLE_FILL = '#101418';
export const DEFAULT_TABLE_FILL_OPACITY = 0.72;
export const DEFAULT_TABLE_HEADER_FILL = '#2D6CDF';
export const DEFAULT_TABLE_STROKE = '#FFFFFF';
/**
 * Cell ink. Unlike a free-text overlay — which sits on an unknown slide
 * background and therefore defaults to the mid-tone `DEFAULT_TEXT_COLOR` — a
 * table paints its own dark body and header fills, so its text is only ever
 * read against those and stays light.
 */
export const DEFAULT_TABLE_TEXT_COLOR = '#FFFFFF';
/** Fraction of view height, matching SlideOverlay.strokeWidth. */
export const DEFAULT_TABLE_STROKE_WIDTH = 0.0015;

/** Cell text inset, as a fraction of the cell's smaller dimension. */
const CELL_PAD_RATIO = 0.12;
const CELL_PAD_MAX_PX = 6;

export interface NormalizedTable {
  rows: string[][];
  colWidths: number[];
  rowHeights: number[];
}

/** Even fractions summing to exactly 1 (last entry absorbs the rounding drift). */
function evenFractions(n: number): number[] {
  const out = new Array<number>(n).fill(1 / n);
  return normalizeFractions(out, n);
}

/**
 * Coerce a width/height list to `n` positive fractions summing to 1. Handles
 * every degenerate case an imported or hand-edited document can present:
 * wrong length, zeros, negatives, NaN, all-zero.
 */
function normalizeFractions(src: readonly number[] | undefined, n: number): number[] {
  if (n <= 0) return [];
  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = Number(src?.[i]);
    raw[i] = Number.isFinite(v) && v > 0 ? v : 0;
  }
  let sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    raw.fill(1);
    sum = n;
  }
  // A partially-zero list (e.g. a short colWidths) gets the shortfall spread
  // over its empty slots rather than collapsing those columns to nothing.
  const zeros = raw.filter((v) => v === 0).length;
  if (zeros) {
    const share = sum / (n - zeros) || 1;
    for (let i = 0; i < n; i++) if (raw[i] === 0) raw[i] = share;
    sum = raw.reduce((a, b) => a + b, 0);
  }
  const out = raw.map((v) => v / sum);
  // Force an exact sum of 1 so cumulative offsets can't drift past the bbox.
  const drift = 1 - out.reduce((a, b) => a + b, 0);
  out[out.length - 1] = Math.max(0.0001, out[out.length - 1] + drift);
  return out;
}

/**
 * Rectangularize an overlay's table data. Short rows are padded with '' and
 * long rows truncated to the width of `rows[0]`, so every downstream consumer
 * (fabric build, PPTX emit) can index cells without bounds checks.
 */
export function normalizeTable(o: Partial<SlideOverlay>): NormalizedTable {
  const src = Array.isArray(o.rows) ? o.rows : [];
  const nRows = Math.min(MAX_TABLE_ROWS, Math.max(MIN_TABLE_ROWS, src.length || DEFAULT_TABLE_ROWS));
  const firstLen = Array.isArray(src[0]) ? src[0].length : 0;
  const nCols = Math.min(
    MAX_TABLE_COLS,
    Math.max(MIN_TABLE_COLS, firstLen || DEFAULT_TABLE_COLS),
  );
  const rows: string[][] = [];
  for (let r = 0; r < nRows; r++) {
    const row = Array.isArray(src[r]) ? src[r] : [];
    const out = new Array<string>(nCols);
    for (let c = 0; c < nCols; c++) out[c] = typeof row[c] === 'string' ? row[c] : '';
    rows.push(out);
  }
  return {
    rows,
    colWidths: o.colWidths ? normalizeFractions(o.colWidths, nCols) : evenFractions(nCols),
    rowHeights: o.rowHeights ? normalizeFractions(o.rowHeights, nRows) : evenFractions(nRows),
  };
}

/** Blank table model at the given size — the `table` tool's starting point. */
export function emptyTable(nRows: number, nCols: number): NormalizedTable {
  const r = Math.min(MAX_TABLE_ROWS, Math.max(MIN_TABLE_ROWS, nRows));
  const c = Math.min(MAX_TABLE_COLS, Math.max(MIN_TABLE_COLS, nCols));
  return {
    rows: Array.from({ length: r }, () => new Array<string>(c).fill('')),
    colWidths: evenFractions(c),
    rowHeights: evenFractions(r),
  };
}

// ── Pure model edits ────────────────────────────────────────────────────────
// Each returns a fresh NormalizedTable; none touches fabric. Row/column
// heights and widths are re-spread so the table keeps its overall bbox.

export function withCellText(
  t: NormalizedTable,
  r: number,
  c: number,
  text: string,
): NormalizedTable {
  if (!t.rows[r] || t.rows[r][c] == null) return t;
  const rows = t.rows.map((row, i) =>
    i === r ? row.map((cell, j) => (j === c ? text : cell)) : row.slice(),
  );
  return { rows, colWidths: t.colWidths.slice(), rowHeights: t.rowHeights.slice() };
}

/** Insert a blank row at `at` (defaults to the end). */
export function withRowInserted(t: NormalizedTable, at?: number): NormalizedTable {
  if (t.rows.length >= MAX_TABLE_ROWS) return t;
  const nCols = t.rows[0]?.length ?? DEFAULT_TABLE_COLS;
  const idx = at == null ? t.rows.length : Math.max(0, Math.min(t.rows.length, at));
  const rows = t.rows.map((r) => r.slice());
  rows.splice(idx, 0, new Array<string>(nCols).fill(''));
  return { rows, colWidths: t.colWidths.slice(), rowHeights: evenFractions(rows.length) };
}

/** Delete row `at` (defaults to the last). Refuses to empty the table. */
export function withRowDeleted(t: NormalizedTable, at?: number): NormalizedTable {
  if (t.rows.length <= MIN_TABLE_ROWS) return t;
  const idx = at == null ? t.rows.length - 1 : Math.max(0, Math.min(t.rows.length - 1, at));
  const rows = t.rows.filter((_, i) => i !== idx).map((r) => r.slice());
  return { rows, colWidths: t.colWidths.slice(), rowHeights: evenFractions(rows.length) };
}

export function withColInserted(t: NormalizedTable, at?: number): NormalizedTable {
  const nCols = t.rows[0]?.length ?? 0;
  if (nCols >= MAX_TABLE_COLS) return t;
  const idx = at == null ? nCols : Math.max(0, Math.min(nCols, at));
  const rows = t.rows.map((r) => {
    const copy = r.slice();
    copy.splice(idx, 0, '');
    return copy;
  });
  return {
    rows,
    colWidths: evenFractions(rows[0]?.length ?? 1),
    rowHeights: t.rowHeights.slice(),
  };
}

export function withColDeleted(t: NormalizedTable, at?: number): NormalizedTable {
  const nCols = t.rows[0]?.length ?? 0;
  if (nCols <= MIN_TABLE_COLS) return t;
  const idx = at == null ? nCols - 1 : Math.max(0, Math.min(nCols - 1, at));
  const rows = t.rows.map((r) => r.filter((_, j) => j !== idx));
  return {
    rows,
    colWidths: evenFractions(rows[0]?.length ?? 1),
    rowHeights: t.rowHeights.slice(),
  };
}

// ── Fabric construction ────────────────────────────────────────────────────

/** Cumulative fraction offsets, e.g. [0.25,0.5,0.25] → [0,0.25,0.75]. */
function offsets(fractions: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const f of fractions) {
    out.push(acc);
    acc += f;
  }
  return out;
}

function cellPadPx(cellW: number, cellH: number): number {
  return Math.min(CELL_PAD_MAX_PX, Math.max(1, Math.min(cellW, cellH) * CELL_PAD_RATIO));
}

/**
 * Build the fabric Group for a table overlay.
 *
 * Children are created at absolute canvas coordinates and the Group is then
 * constructed WITHOUT explicit left/top, letting fabric derive its own bbox —
 * the same pattern `OverlayFabric.makeArrowGroup` uses, which avoids fabric
 * 4.5's group-relative coordinate pitfalls.
 */
export function buildTableGroup(o: SlideOverlay, W: number, H: number): any | null {
  const fabric = (window as any).fabric;
  if (!fabric || !W || !H) return null;

  const t = normalizeTable(o);
  const x0 = o.x * W;
  const y0 = o.y * H;
  const tw = Math.max(8, o.w * W);
  const th = Math.max(8, o.h * H);

  const strokePx = Math.max(0.5, (o.strokeWidth ?? DEFAULT_TABLE_STROKE_WIDTH) * H);
  const strokeHex = o.stroke ?? DEFAULT_TABLE_STROKE;
  const dash = dashProps(o.strokeDash, strokePx);
  const bodyFill = o.fill
    ? withAlpha(o.fill, o.fillOpacity ?? 1)
    : withAlpha(DEFAULT_TABLE_FILL, DEFAULT_TABLE_FILL_OPACITY);
  const headerFill = o.headerRow
    ? withAlpha(o.headerFill ?? DEFAULT_TABLE_HEADER_FILL, o.fillOpacity ?? 1)
    : null;

  const fontPx = Math.max(6, (o.fontSize ?? 0.025) * H);
  const fontFamily = o.fontFamily || 'Arial';
  const textColor = o.textColor ?? DEFAULT_TABLE_TEXT_COLOR;
  const align = o.align ?? 'left';

  const colOff = offsets(t.colWidths);
  const rowOff = offsets(t.rowHeights);
  const children: any[] = [];

  const merges = normalizeMerges(o.merges, t.rows.length, t.colWidths.length);
  const covered = coveredCells(merges);
  /** Width/height of the cell at (r, c), grown across whatever it spans. */
  const spanSize = (r: number, c: number): { cw: number; ch: number } => {
    const m = mergeAt(merges, r, c);
    if (!m) return { cw: t.colWidths[c] * tw, ch: t.rowHeights[r] * th };
    let wf = 0;
    for (let i = c; i < c + (m.colspan ?? 1); i++) wf += t.colWidths[i] ?? 0;
    let hf = 0;
    for (let i = r; i < r + (m.rowspan ?? 1); i++) hf += t.rowHeights[i] ?? 0;
    return { cw: wf * tw, ch: hf * th };
  };

  // Every cell rect first, then every label, so text always paints above the
  // fills regardless of row order.
  for (let r = 0; r < t.rows.length; r++) {
    for (let c = 0; c < t.rows[r].length; c++) {
      // A covered cell draws nothing at all — no fill and, crucially, no
      // border, which is what makes a merge look merged.
      if (covered.has(`${r},${c}`)) continue;
      const { cw, ch } = spanSize(r, c);
      children.push(
        new fabric.Rect({
          left: x0 + colOff[c] * tw,
          top: y0 + rowOff[r] * th,
          width: cw,
          height: ch,
          fill: r === 0 && headerFill ? headerFill : bodyFill,
          stroke: strokeHex,
          strokeWidth: strokePx,
          ...dash,
          objectCaching: false,
        }),
      );
    }
  }

  for (let r = 0; r < t.rows.length; r++) {
    const isHeader = r === 0 && !!o.headerRow;
    for (let c = 0; c < t.rows[r].length; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const text = t.rows[r][c];
      if (!text) continue; // nothing to draw, and fewer objects to hit-test
      const { cw, ch } = spanSize(r, c);
      const pad = cellPadPx(cw, ch);
      const tb = new fabric.Textbox(text, {
        left: x0 + colOff[c] * tw + pad,
        top: y0 + rowOff[r] * th + pad,
        width: Math.max(4, cw - pad * 2),
        fontSize: fontPx,
        fontFamily,
        fontWeight: isHeader || o.bold ? 'bold' : 'normal',
        fontStyle: o.italic ? 'italic' : 'normal',
        underline: !!o.underline,
        textAlign: align,
        fill: textColor,
        splitByGrapheme: false,
        objectCaching: false,
      });
      // Vertically centre within the cell, but never above its top inset —
      // text taller than its row overflows downward rather than escaping up.
      const free = ch - (tb.height ?? fontPx);
      tb.set('top', y0 + rowOff[r] * th + Math.max(pad, free / 2));
      children.push(tb);
    }
  }

  const grp = new fabric.Group(children, {
    opacity: o.opacity ?? 1,
    // Tables scale as a unit; internal geometry is regenerated from the model
    // on read-back, so non-uniform scaling stays lossless.
    lockRotation: true,
    data: {
      id: o.id || overlayUuid(),
      kind: 'table',
      strokeDash: o.strokeDash,
      table: t,
      // Regenerated geometry reads merges back off the group, the same way it
      // reads the cell model — see tableFromFabric.
      merges,
      autoPage: !!o.autoPage,
      headerRow: !!o.headerRow,
      headerFill: o.headerFill ?? DEFAULT_TABLE_HEADER_FILL,
      // Style is mirrored onto data because the Group's own fill/stroke mean
      // nothing — the values live on the children, which get regenerated.
      style: {
        fill: o.fill ?? DEFAULT_TABLE_FILL,
        fillOpacity: o.fillOpacity ?? DEFAULT_TABLE_FILL_OPACITY,
        stroke: strokeHex,
        strokeWidth: o.strokeWidth ?? DEFAULT_TABLE_STROKE_WIDTH,
        fontFamily,
        fontSize: o.fontSize ?? 0.025,
        bold: !!o.bold,
        italic: !!o.italic,
        underline: !!o.underline,
        align,
        textColor,
      },
    },
  });
  // fabric hides rotation via the control, but a table can still be nudged into
  // a rotated ActiveSelection; pinning the angle keeps read-back axis-aligned.
  grp.setControlVisible?.('mtr', false);
  return grp;
}

/**
 * Read a table Group back into model fields. The caller (OverlayFabric's
 * `fabricToOverlay`) has already filled in id/bbox/opacity/group/lock, so this
 * returns only what's table-specific.
 */
export function tableFromFabric(obj: any): Partial<SlideOverlay> {
  const t: NormalizedTable = normalizeTable({
    rows: obj?.data?.table?.rows,
    colWidths: obj?.data?.table?.colWidths,
    rowHeights: obj?.data?.table?.rowHeights,
  });
  const st = obj?.data?.style ?? {};
  const out: Partial<SlideOverlay> = {
    rows: t.rows.map((r) => r.slice()),
    colWidths: t.colWidths.map((v) => Number(v.toFixed(5))),
    rowHeights: t.rowHeights.map((v) => Number(v.toFixed(5))),
  };
  if (st.fill) {
    out.fill = st.fill;
    if ((st.fillOpacity ?? 1) < 1) out.fillOpacity = Number(Number(st.fillOpacity).toFixed(3));
  }
  if (st.stroke) {
    out.stroke = st.stroke;
    out.strokeWidth = st.strokeWidth ?? DEFAULT_TABLE_STROKE_WIDTH;
  }
  if (obj?.data?.strokeDash) out.strokeDash = obj.data.strokeDash;
  // Re-validated against the CURRENT grid: a row or column deleted since the
  // merge was made would otherwise leave a span pointing off the table.
  const merges = normalizeMerges(obj?.data?.merges, t.rows.length, t.colWidths.length);
  if (merges.length) out.merges = merges;
  if (obj?.data?.autoPage) out.autoPage = true;
  if (obj?.data?.headerRow) {
    out.headerRow = true;
    out.headerFill = obj.data.headerFill ?? DEFAULT_TABLE_HEADER_FILL;
  }
  out.fontFamily = st.fontFamily || 'Arial';
  out.fontSize = st.fontSize ?? 0.025;
  if (st.bold) out.bold = true;
  if (st.italic) out.italic = true;
  if (st.underline) out.underline = true;
  if (st.align && st.align !== 'left') out.align = st.align;
  out.textColor = st.textColor ?? DEFAULT_TABLE_TEXT_COLOR;
  return out;
}

export interface CellHit {
  r: number;
  c: number;
  /** Canvas-space rect of the cell, ready to position an editing Textbox over. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Which cell of `obj` contains the canvas point (px, py)? Null when outside.
 *
 * Axis-aligned arithmetic is sufficient because tables never rotate (see the
 * module header). Scaling IS honoured — a resized table hit-tests correctly.
 */
export function cellRectAt(obj: any, px: number, py: number): CellHit | null {
  const t: NormalizedTable | undefined = obj?.data?.table;
  if (!t?.rows?.length) return null;
  const left = obj.left ?? 0;
  const top = obj.top ?? 0;
  const w = obj.getScaledWidth?.() ?? 0;
  const h = obj.getScaledHeight?.() ?? 0;
  if (w <= 0 || h <= 0) return null;
  const fx = (px - left) / w;
  const fy = (py - top) / h;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;

  const colOff = offsets(t.colWidths);
  const rowOff = offsets(t.rowHeights);
  let c = t.colWidths.length - 1;
  for (let i = 0; i < t.colWidths.length; i++) {
    if (fx < colOff[i] + t.colWidths[i]) {
      c = i;
      break;
    }
  }
  let r = t.rowHeights.length - 1;
  for (let i = 0; i < t.rowHeights.length; i++) {
    if (fy < rowOff[i] + t.rowHeights[i]) {
      r = i;
      break;
    }
  }
  return {
    r,
    c,
    left: left + colOff[c] * w,
    top: top + rowOff[r] * h,
    width: t.colWidths[c] * w,
    height: t.rowHeights[r] * h,
  };
}

/**
 * Next cell in reading order, wrapping row to row. `dir` is +1 for Tab and -1
 * for Shift+Tab. Returns null at either end so the caller can just commit.
 */
export function nextCell(
  t: NormalizedTable,
  r: number,
  c: number,
  dir: 1 | -1,
): { r: number; c: number } | null {
  const nCols = t.rows[0]?.length ?? 0;
  const nRows = t.rows.length;
  if (!nCols || !nRows) return null;
  const flat = r * nCols + c + dir;
  if (flat < 0 || flat >= nRows * nCols) return null;
  return { r: Math.floor(flat / nCols), c: flat % nCols };
}
