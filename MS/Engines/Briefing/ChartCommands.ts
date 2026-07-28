/**
 * ChartCommands.ts
 *
 * Ctrl+K actions that put a chart on the current briefing slide — a blank one
 * to fill in, or one built from the last result of an analysis engine.
 *
 * Analysis engines are reached through `window.symbolEngine` at RUN time and
 * never imported, so adding a chart action costs the briefing bundle nothing
 * and a missing/disabled engine degrades to a log line instead of a crash.
 * The adapters themselves live in AnalysisCharts.ts.
 */

import { CommandPalette } from '../../Support/CommandPalette';
import EngineLogger from '../../Support/EngineLogger';
import { defaultChartSpec, type ChartSpec } from './ChartFactory';
import { opRankerBarSpec, posDefRadarSpec } from './AnalysisCharts';

const ENGINE_NAME = 'ChartCommands';

function briefing(): any {
  return (window as any).briefingEngine ?? null;
}

/** Add a spec to the current slide, reporting the two ways it can fail. */
async function insert(spec: ChartSpec | null, what: string): Promise<void> {
  if (!spec) {
    EngineLogger.error(ENGINE_NAME, `No data available for ${what} — run the analysis first`);
    return;
  }
  const be = briefing();
  if (!be?.addChartOverlay) {
    EngineLogger.error(
      ENGINE_NAME,
      'Briefing engine not ready — enable features.briefing in Settings',
    );
    return;
  }
  await be.addChartOverlay(spec);
}

/**
 * Last summary an engine produced, if it kept one. Engines expose their own
 * result under varying names, so the candidates are tried in order and the
 * first object wins.
 */
function lastResult(engine: any, keys: readonly string[]): any {
  if (!engine) return null;
  for (const k of keys) {
    const v = engine[k];
    if (v && typeof v === 'object') return v;
  }
  return null;
}

CommandPalette.registerActions([
  {
    id: 'briefing.chart.blank',
    label: 'Insert chart on slide',
    hint: 'A bar chart with placeholder data — edit the numbers in the slide editor',
    keywords: ['chart', 'graph', 'bar', 'plot', 'insert', 'slide', 'briefing', 'data'],
    run: () => {
      void insert(defaultChartSpec(), 'a blank chart').catch((err) =>
        EngineLogger.error(ENGINE_NAME, String(err)),
      );
    },
  },
  {
    id: 'briefing.chart.posdef',
    label: 'Insert chart — Position Defensibility factors',
    hint: 'Radar chart of the six defensibility sub-scores from the last scored position',
    keywords: ['chart', 'radar', 'defensibility', 'posdef', 'position', 'score', 'factors'],
    run: () => {
      const eng = (window as any).symbolEngine?.posDefScorerEngine;
      const summary = lastResult(eng, ['lastSummary', 'summary', 'lastResult']);
      void insert(
        summary ? posDefRadarSpec(summary) : null,
        'the defensibility chart',
      ).catch((err) => EngineLogger.error(ENGINE_NAME, String(err)));
    },
  },
  {
    id: 'briefing.chart.oprank',
    label: 'Insert chart — OP Ranker composite scores',
    hint: 'Bar chart of ranked observation posts from the last OP Ranker run',
    keywords: ['chart', 'bar', 'op', 'ranker', 'observation', 'post', 'score', 'ranking'],
    run: () => {
      const eng = (window as any).symbolEngine?.opRankerEngine;
      const summary = lastResult(eng, ['lastSummary', 'summary', 'lastResult']);
      void insert(summary ? opRankerBarSpec(summary) : null, 'the OP ranking chart').catch((err) =>
        EngineLogger.error(ENGINE_NAME, String(err)),
      );
    },
  },
  {
    id: 'briefing.chart.oprank.breakdown',
    label: 'Insert chart — OP Ranker coverage breakdown',
    hint: 'Grouped bars: unique coverage vs total viewshed per OP',
    keywords: ['chart', 'bar', 'op', 'ranker', 'coverage', 'viewshed', 'breakdown', 'unique'],
    run: () => {
      const eng = (window as any).symbolEngine?.opRankerEngine;
      const summary = lastResult(eng, ['lastSummary', 'summary', 'lastResult']);
      void insert(
        summary ? opRankerBarSpec(summary, { breakdown: true }) : null,
        'the OP coverage chart',
      ).catch((err) => EngineLogger.error(ENGINE_NAME, String(err)));
    },
  },
]);
