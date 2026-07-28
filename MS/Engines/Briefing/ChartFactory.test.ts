/**
 * ChartFactory.test.ts — run with: node MS/Engines/Briefing/ChartFactory.test.ts
 *
 * Covers the pure halves of the chart feature: the ChartSpec → pptxgenjs
 * mapping (the export path, which nothing else exercises without a browser),
 * the CSV round-trip the chart dialog is built on, and the table merge
 * normalizer. `renderChart` needs a canvas and is verified in the app.
 *
 * House style follows SlideLinks.test.ts: plain console assertions, non-zero
 * exit on failure. No test framework in this repo.
 */
import {
  chartSpecToPptx,
  csvToSeries,
  defaultChartSpec,
  isRadialChart,
  specToCsv,
} from './ChartFactory.ts';
import type { ChartSpec } from './ChartFactory.ts';
import { coveredCells, mergeAt, normalizeMerges } from './TableMerges.ts';
import { opRankerBarSpec, posDefRadarSpec, specFromTableCells } from './AnalysisCharts.ts';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}

/** Stands in for the PptxGenJS instance — only ChartType is ever read. */
const pptx = {
  ChartType: {
    bar: 'bar',
    line: 'line',
    area: 'area',
    pie: 'pie',
    doughnut: 'doughnut',
    scatter: 'scatter',
    radar: 'radar',
  },
};
const BOX = { x: 1, y: 1, w: 4, h: 3 };

const barSpec: ChartSpec = {
  type: 'bar',
  labels: ['A', 'B'],
  series: [
    { name: 'S1', values: [1, 2] },
    { name: 'S2', values: [3, 4] },
  ],
};

console.log('chartSpecToPptx — shape');
{
  const out = chartSpecToPptx(pptx, barSpec, BOX)!;
  check('maps to the ChartType', out.type, 'bar');
  check('one data entry per series', out.data.length, 2);
  // Every series repeats the shared category labels — pptxgenjs' own format.
  check('series carries labels', out.data[0].labels, ['A', 'B']);
  check('series carries values', out.data[1].values, [3, 4]);
  check('box becomes x/y/w/h', [out.options.x, out.options.y, out.options.w, out.options.h], [1, 1, 4, 3]);
  check('one colour per series', out.options.chartColors.length, 2);
  // pptxgenjs wants bare hex, never '#'-prefixed.
  check('colours are bare hex', /^[0-9A-F]{6}$/.test(out.options.chartColors[0]), true);
  check('columns by default', out.options.barDir, 'col');
}

console.log('chartSpecToPptx — variants');
check(
  'stacked sets barGrouping',
  chartSpecToPptx(pptx, { ...barSpec, type: 'barStacked' }, BOX)!.options.barGrouping,
  'stacked',
);
check(
  'horizontal sets barDir',
  chartSpecToPptx(pptx, { ...barSpec, type: 'barHorizontal' }, BOX)!.options.barDir,
  'bar',
);
check(
  'doughnut sets holeSize',
  chartSpecToPptx(pptx, { ...barSpec, type: 'doughnut' }, BOX)!.options.holeSize,
  55,
);
{
  // A pie colours by SLICE, so the array length follows the labels, not the series.
  const pie = chartSpecToPptx(pptx, { ...barSpec, type: 'pie' }, BOX)!;
  check('pie colours by slice', pie.options.chartColors.length, barSpec.labels.length);
}
{
  // Scatter's format is the odd one out: element 0 is the shared X axis.
  const sc = chartSpecToPptx(
    pptx,
    { type: 'scatter', labels: ['a', 'b'], series: [{ name: 'S', values: [5, 6], xValues: [1, 2] }] },
    BOX,
  )!;
  check('scatter leads with the X axis', sc.data[0].name, 'X-Axis');
  check('scatter X values', sc.data[0].values, [1, 2]);
  check('scatter Y series follows', sc.data[1].values, [5, 6]);
}
check('empty series → null', chartSpecToPptx(pptx, { type: 'bar', labels: [], series: [] }, BOX), null);

console.log('chartSpecToPptx — options');
{
  const out = chartSpecToPptx(
    pptx,
    { ...barSpec, title: 'Ranking', catAxisTitle: 'OP', valAxisTitle: 'Score', gridlines: false },
    BOX,
  )!;
  check('title turns showTitle on', [out.options.showTitle, out.options.title], [true, 'Ranking']);
  check('cat axis title', out.options.catAxisTitle, 'OP');
  check('val axis title', out.options.valAxisTitle, 'Score');
  check('gridlines off', out.options.valGridLine, { style: 'none' });
}

console.log('isRadialChart');
check('pie', isRadialChart('pie'), true);
check('doughnut', isRadialChart('doughnut'), true);
check('bar', isRadialChart('bar'), false);
check('radar is NOT radial (it has axes)', isRadialChart('radar'), false);

console.log('CSV round-trip');
{
  const csv = specToCsv(barSpec);
  check('header names the series', csv.split('\n')[0], ',S1,S2');
  check('first data row', csv.split('\n')[1], 'A,1,3');
  const back = csvToSeries(csv)!;
  check('labels survive', back.labels, ['A', 'B']);
  check('series survive', back.series, barSpec.series);
}
check('needs a data row', csvToSeries(',S1'), null);
check('empty → null', csvToSeries(''), null);
{
  // Tolerant parsing: units, separators and percent signs are stripped rather
  // than losing the whole paste. The quoted "1,200" also proves the line
  // splitter does not break fields on a comma inside quotes — a spreadsheet
  // paste produces exactly that, and splitting it would silently read 1.
  const messy = csvToSeries(',Count\nAlpha,"1,200"\nBravo,45%')!;
  check('thousands separator', messy.series[0].values[0], 1200);
  check('percent sign', messy.series[0].values[1], 45);
}
check('non-numeric becomes 0', csvToSeries(',N\nA,n/a')!.series[0].values, [0]);
{
  // Quoted label containing a comma stays ONE label, and one column.
  const q = csvToSeries(',N\n"Bde, 1st",5')!;
  check('quoted label survives', q.labels, ['Bde, 1st']);
  check('quoted label does not add a series', q.series.length, 1);
  // …and a round-trip re-quotes it rather than corrupting the next read.
  const round = csvToSeries(
    specToCsv({ type: 'bar', labels: ['Bde, 1st'], series: [{ name: 'N', values: [5] }] }),
  )!;
  check('round-trips a comma in a label', round.labels, ['Bde, 1st']);
  check('escaped quote round-trips', csvToSeries(
    specToCsv({ type: 'bar', labels: ['A "B"'], series: [{ name: 'N', values: [1] }] }),
  )!.labels, ['A "B"']);
}

console.log('defaultChartSpec');
{
  const d = defaultChartSpec();
  check('is renderable', d.series.length > 0 && d.labels.length === d.series[0].values.length, true);
  check('maps to pptx', chartSpecToPptx(pptx, d, BOX) !== null, true);
}

console.log('normalizeMerges');
check('1x1 is a no-op', normalizeMerges([{ r: 0, c: 0, rowspan: 1, colspan: 1 }], 3, 3), []);
check('spans are clamped to the grid', normalizeMerges([{ r: 1, c: 1, colspan: 99 }], 3, 3), [
  { r: 1, c: 1, rowspan: 1, colspan: 2 },
]);
check('out of range is dropped', normalizeMerges([{ r: 9, c: 0, colspan: 2 }], 3, 3), []);
// A clashing merge is dropped WHOLE, not trimmed — a half-applied merge is a
// grid the renderer and the exporter would disagree about.
check(
  'overlap drops the later entry',
  normalizeMerges(
    [
      { r: 0, c: 0, colspan: 2 },
      { r: 0, c: 1, colspan: 2 },
    ],
    3,
    3,
  ),
  [{ r: 0, c: 0, rowspan: 1, colspan: 2 }],
);
check(
  'non-overlapping both survive',
  normalizeMerges(
    [
      { r: 0, c: 0, colspan: 2 },
      { r: 1, c: 0, colspan: 2 },
    ],
    3,
    3,
  ).length,
  2,
);
check('undefined → empty', normalizeMerges(undefined, 3, 3), []);

console.log('coveredCells / mergeAt');
{
  const merges = normalizeMerges([{ r: 0, c: 0, rowspan: 2, colspan: 2 }], 3, 3);
  const covered = coveredCells(merges);
  // The anchor is NOT covered — it is the cell that gets drawn.
  check('anchor is not covered', covered.has('0,0'), false);
  check('covers the rest of the block', [...covered].sort(), ['0,1', '1,0', '1,1']);
  check('outside the block is free', covered.has('2,2'), false);
  check('mergeAt finds the anchor', mergeAt(merges, 0, 0)?.colspan, 2);
  check('mergeAt on a covered cell', mergeAt(merges, 1, 1), undefined);
}

console.log('AnalysisCharts');
{
  const radar = posDefRadarSpec({
    scores: { obs: 15, fof: 12, cff: 8, cfv: 10, egr: 14, dg: 9 },
    composite: 68,
    grade: 'B',
  })!;
  check('radar type', radar.type, 'radar');
  check('one spoke per factor', radar.labels.length, 6);
  check('factor ids become labels', radar.labels[0], 'Observation');
  check('single series', radar.series.length, 1);
  check('grade reaches the title', radar.title, 'Position defensibility — 68 (B)');
}
check('posDef with no scores → null', posDefRadarSpec({ scores: {} }), null);
{
  const cand = (rank: number, composite: number) => ({
    rank,
    compositeScore: composite,
    uniquePct: 40,
    totalPct: 60,
    elevAdvM: 30,
    optimal: rank === 1,
  });
  // Deliberately out of order — the adapter sorts by rank.
  const bars = opRankerBarSpec({ candidates: [cand(2, 55), cand(1, 74)], combinedCoveragePct: 81 })!;
  check('bar type', bars.type, 'bar');
  check('sorted by rank', bars.labels, ['OP 1*', 'OP 2']);
  check('composite values', bars.series[0].values, [74, 55]);
  check('coverage reaches the title', bars.title, 'OP ranking — 81% combined AO coverage');

  const bd = opRankerBarSpec({ candidates: [cand(1, 74)] }, { breakdown: true })!;
  check('breakdown has two series', bd.series.length, 2);
}
check('opRanker with no candidates → null', opRankerBarSpec({ candidates: [] }), null);

console.log('specFromTableCells');
{
  const spec = specFromTableCells(
    [
      ['Unit', 'Strength'],
      ['A Coy', '120'],
      ['B Coy', '95'],
    ],
    true,
  )!;
  check('labels from column 0', spec.labels, ['A Coy', 'B Coy']);
  check('header names the series', spec.series[0].name, 'Strength');
  check('values parsed', spec.series[0].values, [120, 95]);
}
// An all-zero column carries no information, so it is not made into a series.
check('non-numeric column dropped', specFromTableCells([['a', 'b'], ['x', 'y']], true), null);
check('single column → null', specFromTableCells([['a'], ['x']], true), null);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
