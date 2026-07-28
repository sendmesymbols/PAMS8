/**
 * ChartFactory.ts
 *
 * Charts for the slide editor — the quantitative half of a briefing that the
 * app could previously only ship as a screenshot of a canvas.
 *
 * A chart overlay persists a ChartSpec (type + series + a few display flags),
 * never a bitmap, for exactly the reason a milsym overlay persists a SIDC (see
 * MilSymFactory): every render regenerates from the model, so briefings stay
 * small, the editor can re-render at any size, and — the point of the whole
 * exercise — PptxExporter can hand the SAME model to pptxgenjs' `addChart()`
 * and emit a real, editable PowerPoint chart instead of a picture of one.
 *
 * That dual target is why the spec's vocabulary deliberately mirrors
 * pptxgenjs' own (`labels`/`values` series, `legendPos`, `catAxisTitle`, …):
 * the export path is then a rename, not a translation, and there is no second
 * model to keep in sync.
 *
 * The canvas renderer here is intentionally small — it exists so the author
 * can see and place the chart, not to compete with a charting library. Where
 * the two renderers differ, PowerPoint's is the one that ships.
 */

/** Chart types the editor offers. All map onto a pptxgenjs ChartType. */
export type ChartKind =
  | 'bar'
  | 'barStacked'
  | 'barHorizontal'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'radar';

export interface ChartSeries {
  name: string;
  values: number[];
  /**
   * Scatter only — X values paired with `values`. Every other type takes its
   * category positions from the spec-level `labels`.
   */
  xValues?: number[];
}

export interface ChartSpec {
  type: ChartKind;
  /** Category labels, shared by every series. Pie/doughnut slice names too. */
  labels: string[];
  series: ChartSeries[];
  title?: string;
  showLegend?: boolean;
  /** 'b' | 't' | 'l' | 'r' — pptxgenjs' own vocabulary. */
  legendPos?: 'b' | 't' | 'l' | 'r';
  /** Print each data point's value on the chart. */
  showValue?: boolean;
  catAxisTitle?: string;
  valAxisTitle?: string;
  /** Series colours as '#RRGGBB'. Falls back to CHART_PALETTE. */
  colors?: string[];
  /** Plot-area background '#RRGGBB'. Absent = transparent. */
  fill?: string;
  /** Axis / label ink. */
  textColor?: string;
  /** Draw value-axis gridlines. Default true (ignored by pie/doughnut). */
  gridlines?: boolean;
}

/**
 * Default series colours — a colourblind-safe categorical ramp. Chosen to stay
 * legible against both the editor's dark canvas and a printed white slide,
 * because the same hexes are handed to PowerPoint.
 */
export const CHART_PALETTE: readonly string[] = [
  '#4E79A7',
  '#F28E2B',
  '#59A14F',
  '#E15759',
  '#B07AA1',
  '#76B7B2',
  '#EDC948',
  '#FF9DA7',
];

const DEFAULT_INK = '#D6DEE8';

export interface ChartRender {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Kinds with no category/value axes — the pie family. */
export function isRadialChart(type: ChartKind): boolean {
  return type === 'pie' || type === 'doughnut';
}

/** A minimal, valid spec — what the editor inserts before the user edits it. */
export function defaultChartSpec(): ChartSpec {
  return {
    type: 'bar',
    labels: ['A', 'B', 'C', 'D'],
    series: [{ name: 'Series 1', values: [4, 7, 3, 6] }],
    showLegend: true,
    legendPos: 'b',
    gridlines: true,
    textColor: DEFAULT_INK,
  };
}

function seriesColor(spec: ChartSpec, i: number): string {
  const custom = spec.colors?.[i];
  if (custom) return custom.startsWith('#') ? custom : `#${custom}`;
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

/** Rounded to something a chart axis would actually print. */
function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  else nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

/** Value-axis bounds and tick step covering every series. */
function valueScale(spec: ChartSpec): { min: number; max: number; step: number } {
  const flat: number[] = [];
  for (const s of spec.series) for (const v of s.values) if (Number.isFinite(v)) flat.push(v);
  if (!flat.length) return { min: 0, max: 1, step: 0.5 };

  if (spec.type === 'barStacked') {
    // A stacked bar's axis has to reach the tallest COLUMN, not the tallest
    // single value, or the top segment falls off the plot.
    const n = Math.max(...spec.series.map((s) => s.values.length));
    for (let i = 0; i < n; i++) {
      let pos = 0;
      let neg = 0;
      for (const s of spec.series) {
        const v = s.values[i];
        if (!Number.isFinite(v)) continue;
        if (v >= 0) pos += v;
        else neg += v;
      }
      flat.push(pos, neg);
    }
  }

  let lo = Math.min(...flat, 0);
  let hi = Math.max(...flat, 0);
  if (lo === hi) hi = lo + 1;
  const step = niceNum((hi - lo) / 5, true);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  return { min: lo, max: hi, step };
}

/** Trim a printed tick so an axis does not read as floating-point noise. */
function fmtTick(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

/**
 * Render a chart to an offscreen canvas at `wPx` × `hPx` CSS pixels.
 *
 * Returns null when the spec has nothing to draw, so callers can fall back the
 * same way `renderMilSym` lets them (see OverlayFabric's placeholder path).
 */
export function renderChart(
  spec: ChartSpec | undefined,
  wPx: number,
  hPx: number,
  scale = 2,
): ChartRender | null {
  if (!spec || !spec.series?.length) return null;
  const W = Math.max(40, Math.round(wPx));
  const H = Math.max(30, Math.round(hPx));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  const ink = spec.textColor || DEFAULT_INK;
  // Type scale is derived from the box so a small chart stays legible and a
  // large one does not end up with postage-stamp labels.
  const base = Math.max(7, Math.min(16, Math.round(Math.min(W, H) / 22)));
  ctx.textBaseline = 'middle';

  if (spec.fill) {
    ctx.fillStyle = spec.fill;
    ctx.fillRect(0, 0, W, H);
  }

  let top = 6;
  if (spec.title) {
    ctx.fillStyle = ink;
    ctx.font = `bold ${base + 2}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(spec.title, W / 2, top + base);
    top += base * 2.2;
  }

  // Legend is measured before the plot so the plot can be inset around it.
  const legendH = spec.showLegend !== false && spec.series.length ? base * 1.8 : 0;
  const bottomLegend = legendH && (spec.legendPos ?? 'b') === 'b';
  const topLegend = legendH && spec.legendPos === 't';
  if (topLegend) top += legendH;

  const plot = {
    x: 8,
    y: top,
    w: W - 16,
    h: H - top - 8 - (bottomLegend ? legendH : 0),
  };

  if (plot.h > 10 && plot.w > 10) {
    if (isRadialChart(spec.type)) drawRadial(ctx, spec, plot, base, ink);
    else if (spec.type === 'radar') drawRadar(ctx, spec, plot, base, ink);
    else drawCartesian(ctx, spec, plot, base, ink);
  }

  if (legendH) {
    const ly = topLegend ? top - legendH / 2 - 2 : H - legendH / 2 - 4;
    drawLegend(ctx, spec, W, ly, base, ink);
  }

  return { canvas, width: W, height: H };
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  W: number,
  cy: number,
  base: number,
  ink: string,
): void {
  // Pie/doughnut legends name the SLICES; everything else names the series.
  const names = isRadialChart(spec.type)
    ? spec.labels
    : spec.series.map((s, i) => s.name || `Series ${i + 1}`);
  ctx.font = `${base}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  const sw = base * 0.8;
  const gap = base * 0.9;
  const widths = names.map((n) => sw + 4 + ctx.measureText(String(n)).width);
  let total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, names.length - 1);
  // One row only — a legend that wrapped would eat the plot it labels.
  let x = Math.max(4, (W - total) / 2);
  for (let i = 0; i < names.length; i++) {
    if (x + widths[i] > W - 4) break;
    ctx.fillStyle = seriesColor(spec, i);
    ctx.fillRect(x, cy - sw / 2, sw, sw);
    ctx.fillStyle = ink;
    ctx.fillText(String(names[i]), x + sw + 4, cy);
    x += widths[i] + gap;
  }
}

function drawCartesian(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  plot: { x: number; y: number; w: number; h: number },
  base: number,
  ink: string,
): void {
  const horiz = spec.type === 'barHorizontal';
  const { min, max, step } = valueScale(spec);
  ctx.font = `${base}px Arial, sans-serif`;

  // Gutters sized to the widest printed tick, so labels never clip.
  let maxTickW = 0;
  for (let v = min; v <= max + step / 2; v += step) {
    maxTickW = Math.max(maxTickW, ctx.measureText(fmtTick(v, step)).width);
  }
  const gutterL = horiz
    ? Math.min(plot.w * 0.4, Math.max(...spec.labels.map((l) => ctx.measureText(String(l)).width)) + 8)
    : maxTickW + 8;
  const gutterB = base * 1.8;
  const area = {
    x: plot.x + gutterL,
    y: plot.y + 2,
    w: Math.max(10, plot.w - gutterL - 4),
    h: Math.max(10, plot.h - gutterB - 2),
  };

  const vPos = (v: number): number =>
    horiz
      ? area.x + ((v - min) / (max - min)) * area.w
      : area.y + area.h - ((v - min) / (max - min)) * area.h;

  // Gridlines + value ticks
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.fillStyle = ink;
  for (let v = min; v <= max + step / 2; v += step) {
    const p = vPos(v);
    if (spec.gridlines !== false) {
      ctx.beginPath();
      if (horiz) {
        ctx.moveTo(p, area.y);
        ctx.lineTo(p, area.y + area.h);
      } else {
        ctx.moveTo(area.x, p);
        ctx.lineTo(area.x + area.w, p);
      }
      ctx.stroke();
    }
    const label = fmtTick(v, step);
    if (horiz) {
      ctx.textAlign = 'center';
      ctx.fillText(label, p, area.y + area.h + base);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(label, area.x - 4, p);
    }
  }

  // Zero line, when the data straddles it.
  if (min < 0 && max > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    const z = vPos(0);
    if (horiz) {
      ctx.moveTo(z, area.y);
      ctx.lineTo(z, area.y + area.h);
    } else {
      ctx.moveTo(area.x, z);
      ctx.lineTo(area.x + area.w, z);
    }
    ctx.stroke();
  }

  const nCat = Math.max(1, spec.labels.length || Math.max(...spec.series.map((s) => s.values.length)));
  const bandSize = (horiz ? area.h : area.w) / nCat;
  const bandStart = (i: number): number => (horiz ? area.y : area.x) + i * bandSize;

  // Category labels — thinned rather than overlapped when they will not fit.
  ctx.fillStyle = ink;
  const catEvery = horiz
    ? 1
    : Math.max(1, Math.ceil((base * 3.2) / Math.max(1, bandSize)));
  for (let i = 0; i < nCat; i++) {
    const label = String(spec.labels[i] ?? '');
    if (!label) continue;
    if (horiz) {
      ctx.textAlign = 'right';
      ctx.fillText(label, area.x - 4, bandStart(i) + bandSize / 2);
    } else if (i % catEvery === 0) {
      ctx.textAlign = 'center';
      ctx.fillText(label, bandStart(i) + bandSize / 2, area.y + area.h + base);
    }
  }

  const isBar = spec.type === 'bar' || spec.type === 'barStacked' || horiz;
  if (isBar) {
    const stacked = spec.type === 'barStacked';
    const groups = stacked ? 1 : spec.series.length;
    const slot = (bandSize * 0.78) / groups;
    // Running totals per category, so a stacked segment starts where the last ended.
    const posAcc = new Array(nCat).fill(0);
    const negAcc = new Array(nCat).fill(0);
    for (let s = 0; s < spec.series.length; s++) {
      ctx.fillStyle = seriesColor(spec, s);
      for (let i = 0; i < nCat; i++) {
        const v = spec.series[s].values[i];
        if (!Number.isFinite(v)) continue;
        const from = stacked ? (v >= 0 ? posAcc[i] : negAcc[i]) : 0;
        const to = from + v;
        if (stacked) {
          if (v >= 0) posAcc[i] = to;
          else negAcc[i] = to;
        }
        const a = vPos(from);
        const b = vPos(to);
        const off = bandStart(i) + bandSize * 0.11 + (stacked ? 0 : s * slot);
        if (horiz) ctx.fillRect(Math.min(a, b), off, Math.abs(b - a), slot);
        else ctx.fillRect(off, Math.min(a, b), slot, Math.abs(b - a));

        if (spec.showValue) {
          ctx.fillStyle = ink;
          ctx.textAlign = 'center';
          const tx = horiz ? Math.max(a, b) + base : off + slot / 2;
          const ty = horiz ? off + slot / 2 : Math.min(a, b) - base * 0.6;
          ctx.fillText(String(v), tx, ty);
          ctx.fillStyle = seriesColor(spec, s);
        }
      }
    }
    return;
  }

  // Scatter shares ONE x scale across every series, so its bounds are taken
  // over all of them before any series is plotted.
  let xMin = 0;
  let xMax = 1;
  if (spec.type === 'scatter') {
    const xs: number[] = [];
    for (const s of spec.series) for (const x of s.xValues ?? []) if (Number.isFinite(x)) xs.push(x);
    if (xs.length) {
      xMin = Math.min(...xs);
      xMax = Math.max(...xs);
      if (xMin === xMax) xMax = xMin + 1;
    }
  }

  // line / area / scatter
  for (let s = 0; s < spec.series.length; s++) {
    const color = seriesColor(spec, s);
    const ser = spec.series[s];
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < ser.values.length; i++) {
      const v = ser.values[i];
      if (!Number.isFinite(v)) continue;
      // Scatter positions on its own X values; the rest sit at band centres.
      const xv = ser.xValues?.[i];
      const x =
        spec.type === 'scatter' && Number.isFinite(xv)
          ? area.x + (((xv as number) - xMin) / (xMax - xMin)) * area.w
          : area.x + bandSize * (i + 0.5);
      pts.push({ x, y: vPos(v) });
    }
    if (!pts.length) continue;

    if (spec.type === 'area') {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, vPos(Math.max(min, 0)));
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(pts[pts.length - 1].x, vPos(Math.max(min, 0)));
      ctx.closePath();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (spec.type !== 'scatter') {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, base / 7);
      ctx.stroke();
    }

    const r = Math.max(1.6, base / 5);
    ctx.fillStyle = color;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRadial(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  plot: { x: number; y: number; w: number; h: number },
  base: number,
  ink: string,
): void {
  const values = spec.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + (Number.isFinite(b) ? Math.abs(b) : 0), 0);
  if (total <= 0) return;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const R = Math.max(6, Math.min(plot.w, plot.h) / 2 - 4);
  const inner = spec.type === 'doughnut' ? R * 0.55 : 0;
  let a0 = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const frac = Math.abs(values[i]) / total;
    const a1 = a0 + frac * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
    ctx.arc(cx, cy, R, a0, a1);
    if (inner) ctx.arc(cx, cy, inner, a1, a0, true);
    else ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = seriesColor(spec, i);
    ctx.fill();
    if (spec.showValue && frac > 0.04) {
      const am = (a0 + a1) / 2;
      const rr = inner + (R - inner) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = `${base}px Arial, sans-serif`;
      ctx.fillText(`${Math.round(frac * 100)}%`, cx + Math.cos(am) * rr, cy + Math.sin(am) * rr);
    }
    a0 = a1;
  }
  void ink;
}

function drawRadar(
  ctx: CanvasRenderingContext2D,
  spec: ChartSpec,
  plot: { x: number; y: number; w: number; h: number },
  base: number,
  ink: string,
): void {
  const n = Math.max(3, spec.labels.length);
  const { max } = valueScale(spec);
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const R = Math.max(8, Math.min(plot.w, plot.h) / 2 - base * 1.6);
  const ang = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const r = (R * ring) / 4;
      const x = cx + Math.cos(ang(i % n)) * r;
      const y = cy + Math.sin(ang(i % n)) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  ctx.fillStyle = ink;
  ctx.font = `${base}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const label = String(spec.labels[i] ?? '');
    if (!label) continue;
    ctx.fillText(label, cx + Math.cos(ang(i)) * (R + base), cy + Math.sin(ang(i)) * (R + base));
  }

  for (let s = 0; s < spec.series.length; s++) {
    const color = seriesColor(spec, s);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const v = spec.series[s].values[i] ?? 0;
      const r = max > 0 ? (Math.max(0, v) / max) * R : 0;
      const x = cx + Math.cos(ang(i)) * r;
      const y = cy + Math.sin(ang(i)) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, base / 7);
    ctx.stroke();
  }
}

// ── CSV bridge ───────────────────────────────────────────────────────────────

/**
 * ChartSpec ↔ CSV, the form the chart dialog edits data in.
 *
 * CSV rather than a grid widget on purpose: briefing chart data is small and
 * arrives by paste from a spreadsheet or an analysis panel far more often than
 * it is typed cell by cell, and a textarea round-trips that in one gesture.
 *
 * Layout — first column is the category labels, header row names the series:
 *
 *     ,Coverage,Score
 *     OP 1,62,74
 *     OP 2,55,71
 */
/** Quote a field only when it would otherwise break the row. */
function csvField(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Split one CSV line, honouring quoted fields.
 *
 * A plain `split(',')` is wrong here and not merely imprecise: a spreadsheet
 * copies a thousands-separated number as the quoted field `"1,200"`, and
 * splitting inside it silently turns 1200 into 1 — a wrong chart rather than a
 * rejected paste.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function specToCsv(spec: ChartSpec): string {
  const head = ['', ...spec.series.map((s) => csvField(s.name ?? ''))].join(',');
  const rows = spec.labels.map((label, i) =>
    [csvField(label), ...spec.series.map((s) => csvField(s.values[i] ?? ''))].join(','),
  );
  return [head, ...rows].join('\n');
}

/**
 * CSV → labels + series. Null when there is nothing usable, so the caller can
 * refuse to apply rather than blank the chart.
 *
 * Number parsing is deliberately tolerant — a stray unit, thousands separator
 * or percent sign should not cost the user their whole paste.
 */
export function csvToSeries(csv: string): Pick<ChartSpec, 'labels' | 'series'> | null {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const cells = lines.map(splitCsvLine);
  const header = cells[0];
  const body = cells.slice(1);
  const nSeries = Math.max(1, Math.max(...body.map((r) => r.length)) - 1);

  const labels = body.map((r, i) => r[0] || `Item ${i + 1}`);
  const series: ChartSeries[] = [];
  for (let c = 1; c <= nSeries; c++) {
    series.push({
      name: header[c] || `Series ${c}`,
      values: body.map((r) => {
        const n = Number(String(r[c] ?? '').replace(/[,\s%$"']/g, ''));
        return Number.isFinite(n) ? n : 0;
      }),
    });
  }
  return labels.length ? { labels, series } : null;
}

// ── PPTX bridge ──────────────────────────────────────────────────────────────

/**
 * ChartSpec → the `(chartType, data, options)` triple `slide.addChart()` takes.
 *
 * `pptx` is the live PptxGenJS instance because `ChartType` is an instance
 * property on it, not a module export — the same reason the exporter passes the
 * instance around rather than importing anything from the bundle.
 */
export function chartSpecToPptx(
  pptx: any,
  spec: ChartSpec,
  box: { x: number; y: number; w: number; h: number },
): { type: any; data: any[]; options: any } | null {
  if (!spec?.series?.length) return null;
  const CT = pptx.ChartType ?? {};
  const TYPE_MAP: Record<ChartKind, string> = {
    bar: 'bar',
    barStacked: 'bar',
    barHorizontal: 'bar',
    line: 'line',
    area: 'area',
    pie: 'pie',
    doughnut: 'doughnut',
    scatter: 'scatter',
    radar: 'radar',
  };
  const type = CT[TYPE_MAP[spec.type]] ?? TYPE_MAP[spec.type];

  let data: any[];
  if (spec.type === 'scatter') {
    // pptxgenjs' scatter format is unlike the others: element 0 is the shared
    // X axis, and each following element is one Y series.
    const xs = spec.series[0]?.xValues ?? spec.labels.map((_, i) => i);
    data = [
      { name: 'X-Axis', values: xs },
      ...spec.series.map((s, i) => ({ name: s.name || `Series ${i + 1}`, values: s.values })),
    ];
  } else {
    data = spec.series.map((s, i) => ({
      name: s.name || `Series ${i + 1}`,
      labels: spec.labels,
      values: s.values,
    }));
  }

  const options: any = {
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    showLegend: spec.showLegend !== false,
    legendPos: spec.legendPos ?? 'b',
    legendColor: hexNoHash(spec.textColor ?? DEFAULT_INK),
    showValue: !!spec.showValue,
    // Hex without '#' is what pptxgenjs wants throughout.
    chartColors: spec.series.map((_, i) =>
      hexNoHash(
        isRadialChart(spec.type)
          ? seriesColor(spec, 0)
          : seriesColor(spec, i),
      ),
    ),
  };
  // A pie's colours vary by SLICE, so the array has to be as long as the data.
  if (isRadialChart(spec.type)) {
    options.chartColors = spec.labels.map((_, i) => hexNoHash(seriesColor(spec, i)));
    options.showPercent = !!spec.showValue;
  }
  if (spec.title) {
    options.showTitle = true;
    options.title = spec.title;
    options.titleColor = hexNoHash(spec.textColor ?? DEFAULT_INK);
    options.titleFontSize = 14;
  }
  if (spec.type === 'barStacked') options.barGrouping = 'stacked';
  if (spec.type === 'barHorizontal') options.barDir = 'bar';
  else if (spec.type === 'bar' || spec.type === 'barStacked') options.barDir = 'col';
  if (spec.type === 'doughnut') options.holeSize = 55;
  if (spec.catAxisTitle) {
    options.showCatAxisTitle = true;
    options.catAxisTitle = spec.catAxisTitle;
  }
  if (spec.valAxisTitle) {
    options.showValAxisTitle = true;
    options.valAxisTitle = spec.valAxisTitle;
  }
  if (!isRadialChart(spec.type)) {
    const ink = hexNoHash(spec.textColor ?? DEFAULT_INK);
    options.catAxisLabelColor = ink;
    options.valAxisLabelColor = ink;
    if (spec.gridlines === false) options.valGridLine = { style: 'none' };
  }
  if (spec.fill) options.fill = hexNoHash(spec.fill);
  return { type, data, options };
}

function hexNoHash(c: string): string {
  return (c || '').replace('#', '').toUpperCase() || 'FFFFFF';
}
