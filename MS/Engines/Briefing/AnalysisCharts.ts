/**
 * AnalysisCharts.ts
 *
 * Adapters from analysis-engine results to ChartSpec.
 *
 * The app has always produced quantitative analysis — defensibility factor
 * scores, OP rankings, terrain profiles — and has never been able to put any
 * of it into a briefing except as a screenshot of a canvas. These functions
 * close that gap: the numbers become a chart overlay the author can place and
 * restyle, and PptxExporter emits it as a REAL PowerPoint chart (see
 * ChartFactory), so a recipient can retype a value or recolour a series.
 *
 * Every adapter takes a STRUCTURAL parameter rather than importing the engine
 * that produced it. That is deliberate: the briefing bundle must not pull an
 * analysis engine in behind it, and each engine's summary type is already a
 * plain data object. The trade is that a rename in an engine's summary will
 * not be caught by the compiler here — hence the narrow, documented shapes.
 */

import type { ChartSpec } from './ChartFactory';

const INK = '#D6DEE8';

/**
 * Position-defensibility factor scores → radar.
 *
 * Radar is the right form here and not a stylistic choice: the six factors are
 * commensurate sub-scores of one composite, so the enclosed AREA reads as
 * overall quality and a dented spoke reads as the specific weakness. A bar
 * chart of the same numbers hides both.
 */
export interface PosDefLike {
  scores: Record<string, number>;
  composite?: number;
  grade?: string;
  label?: string;
}

/** Factor id → briefing label. Mirrors FACTORS in PosDefScorerEngine. */
const POSDEF_LABELS: Record<string, string> = {
  obs: 'Observation',
  fof: 'Fields of fire',
  cff: 'Cover (fire)',
  cfv: 'Concealment',
  egr: 'Egress',
  dg: 'Dead ground',
};

export function posDefRadarSpec(summary: PosDefLike, title?: string): ChartSpec | null {
  const ids = Object.keys(summary?.scores ?? {});
  if (!ids.length) return null;
  return {
    type: 'radar',
    labels: ids.map((id) => POSDEF_LABELS[id] ?? id.toUpperCase()),
    series: [
      {
        name: summary.grade ? `Defensibility (${summary.grade})` : 'Defensibility',
        values: ids.map((id) => Number(summary.scores[id]) || 0),
      },
    ],
    title:
      title ??
      (summary.composite != null
        ? `Position defensibility — ${Math.round(summary.composite)}${
            summary.grade ? ` (${summary.grade})` : ''
          }`
        : 'Position defensibility'),
    showLegend: false,
    textColor: INK,
    colors: ['#59A14F'],
  };
}

/**
 * OP-ranker candidates → bar chart of composite score, ranked.
 *
 * `breakdown` splits it into the two coverage terms instead, which is what a
 * briefer wants when the question is "why is OP 3 ahead of OP 1".
 */
export interface OpRankLike {
  candidates: Array<{
    rank: number;
    compositeScore: number;
    uniquePct: number;
    totalPct: number;
    elevAdvM: number;
    optimal: boolean;
  }>;
  combinedCoveragePct?: number;
}

export function opRankerBarSpec(
  summary: OpRankLike,
  opts: { breakdown?: boolean; title?: string } = {},
): ChartSpec | null {
  const cands = [...(summary?.candidates ?? [])].sort((a, b) => a.rank - b.rank);
  if (!cands.length) return null;
  const labels = cands.map((c) => `OP ${c.rank}${c.optimal ? '*' : ''}`);
  if (opts.breakdown) {
    return {
      type: 'bar',
      labels,
      series: [
        { name: 'Unique coverage %', values: cands.map((c) => Math.round(c.uniquePct)) },
        { name: 'Total viewshed %', values: cands.map((c) => Math.round(c.totalPct)) },
      ],
      title: opts.title ?? 'OP coverage breakdown',
      valAxisTitle: '% of AO',
      showLegend: true,
      legendPos: 'b',
      textColor: INK,
    };
  }
  return {
    type: 'bar',
    labels,
    series: [
      { name: 'Composite score', values: cands.map((c) => Math.round(c.compositeScore)) },
    ],
    title:
      opts.title ??
      (summary.combinedCoveragePct != null
        ? `OP ranking — ${Math.round(summary.combinedCoveragePct)}% combined AO coverage`
        : 'OP ranking'),
    valAxisTitle: 'Composite score',
    showLegend: false,
    showValue: true,
    textColor: INK,
    colors: ['#4E79A7'],
  };
}

/**
 * A terrain profile → area (ground) plus an optional line (the sight line).
 *
 * This is the LOS/dead-ground shape: `ground` is elevation sampled along the
 * ray and `sight` the observer-to-target straight line, so where the area
 * crosses above the line is exactly the masked stretch.
 */
export function terrainProfileSpec(
  distancesM: readonly number[],
  groundM: readonly number[],
  sightM?: readonly number[],
  title = 'Terrain profile',
): ChartSpec | null {
  if (!distancesM.length || distancesM.length !== groundM.length) return null;
  // Axis labels are thinned by the renderer, but a profile can carry thousands
  // of samples — decimate first so neither renderer is handed a series that
  // long. 240 points is well past what a slide-sized chart can resolve.
  const MAX = 240;
  const stride = Math.max(1, Math.ceil(distancesM.length / MAX));
  const pick = <T>(arr: readonly T[]): T[] => arr.filter((_, i) => i % stride === 0);
  const km = (m: number) => Math.round((m / 1000) * 100) / 100;

  const series: ChartSpec['series'] = [
    { name: 'Ground', values: pick(groundM).map((v) => Math.round(v)) },
  ];
  if (sightM?.length === groundM.length) {
    series.push({ name: 'Line of sight', values: pick(sightM).map((v) => Math.round(v)) });
  }
  return {
    type: 'area',
    labels: pick(distancesM).map((d) => String(km(d))),
    series,
    title,
    catAxisTitle: 'Distance (km)',
    valAxisTitle: 'Elevation (m)',
    showLegend: series.length > 1,
    legendPos: 'b',
    textColor: INK,
    colors: ['#8C7B6B', '#E15759'],
  };
}

/**
 * A chart the author can build right now, from a result an engine is already
 * holding. Offered as the chart dialog's "Data source" list.
 *
 * `available` is resolved at the moment the list is built, so a source the
 * author has not run yet appears greyed with a reason rather than silently
 * missing — "run the analysis first" is far more useful than an empty menu.
 */
export interface ChartSource {
  id: string;
  label: string;
  /** Null when there is no result to build from; the string says what to do. */
  unavailable: string | null;
  build(): ChartSpec | null;
}

/**
 * Analysis engines are reached through `window.symbolEngine` at CALL time and
 * never imported, so this list costs the briefing bundle nothing and a
 * disabled or absent engine degrades to an "unavailable" row.
 */
function engineResult(prop: string): any {
  const eng = (window as any).symbolEngine?.[prop];
  if (!eng) return null;
  for (const key of ['lastSummary', 'summary', 'lastResult']) {
    const v = eng[key];
    if (v && typeof v === 'object') return v;
  }
  return null;
}

export function chartSources(): ChartSource[] {
  const posDef = engineResult('posDefScorerEngine');
  const opRank = engineResult('opRankerEngine');
  const noRun = (what: string) => `No result yet — run ${what} first`;
  return [
    {
      id: 'posdef',
      label: 'Position Defensibility — factor scores',
      unavailable: posDef ? null : noRun('Position Defensibility Scorer'),
      build: () => (posDef ? posDefRadarSpec(posDef) : null),
    },
    {
      id: 'oprank',
      label: 'OP Ranker — composite scores',
      unavailable: opRank ? null : noRun('OP Ranker'),
      build: () => (opRank ? opRankerBarSpec(opRank) : null),
    },
    {
      id: 'oprank-breakdown',
      label: 'OP Ranker — coverage breakdown',
      unavailable: opRank ? null : noRun('OP Ranker'),
      build: () => (opRank ? opRankerBarSpec(opRank, { breakdown: true }) : null),
    },
  ];
}

/**
 * Any label→value map as a chart. The catch-all for engines with no dedicated
 * adapter, and what the "chart from table" editor action uses.
 */
export function simpleSpec(
  type: ChartSpec['type'],
  labels: readonly string[],
  values: readonly number[],
  opts: { title?: string; seriesName?: string; valAxisTitle?: string } = {},
): ChartSpec | null {
  if (!labels.length || labels.length !== values.length) return null;
  return {
    type,
    labels: [...labels],
    series: [{ name: opts.seriesName ?? 'Value', values: [...values] }],
    title: opts.title,
    valAxisTitle: opts.valAxisTitle,
    showLegend: false,
    textColor: INK,
  };
}

/**
 * A table overlay's cells → a chart, reading column 0 as labels and the
 * remaining numeric columns as series. Header row (when the table has one)
 * names the series.
 *
 * Returns null when nothing numeric can be found, so the caller can say so
 * rather than inserting an empty chart.
 */
export function specFromTableCells(
  rows: readonly (readonly string[])[],
  headerRow: boolean,
  type: ChartSpec['type'] = 'bar',
): ChartSpec | null {
  if (rows.length < (headerRow ? 2 : 1)) return null;
  const header = headerRow ? rows[0] : null;
  const body = headerRow ? rows.slice(1) : rows;
  const nCols = Math.max(...body.map((r) => r.length));
  if (nCols < 2) return null;

  const labels = body.map((r, i) => String(r[0] ?? `Row ${i + 1}`));
  const series: ChartSpec['series'] = [];
  for (let c = 1; c < nCols; c++) {
    const values = body.map((r) => {
      // Tolerates the thousands separators, units and % signs a hand-typed
      // briefing table is full of.
      const raw = String(r[c] ?? '').replace(/[,\s%]/g, '');
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    });
    if (values.every((v) => v === 0)) continue;
    series.push({ name: String(header?.[c] ?? `Series ${c}`), values });
  }
  if (!series.length) return null;
  return {
    type,
    labels,
    series,
    showLegend: series.length > 1,
    legendPos: 'b',
    textColor: INK,
  };
}
