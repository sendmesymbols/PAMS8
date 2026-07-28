/**
 * TableMerges.ts
 *
 * Merged-cell arithmetic for table overlays: validate a merge list against a
 * grid, and say which cells a merge covers.
 *
 * Its own module, and deliberately dependency-free, because three separate
 * consumers need exactly this and nothing else around it — the canvas renderer
 * (OverlayTable.buildTableGroup), the PPTX exporter (which omits covered cells
 * and puts colspan/rowspan on the anchor) and the PPTX importer (which builds
 * the list from gridSpan/rowSpan). All three must agree on what a given merge
 * list means, or a table renders one way and exports another.
 */

import type { TableMerge } from './BriefingTypes';

/**
 * Validated, non-overlapping merges for a table of `nRows` × `nCols`.
 *
 * Applied greedily in the order given: an entry whose block would touch a cell
 * an earlier entry already claimed is DROPPED whole rather than trimmed,
 * because a half-applied merge is a grid the renderer and the exporter would
 * disagree about. Spans are clamped to the grid, and 1×1 entries are discarded
 * as no-ops.
 */
export function normalizeMerges(
  merges: readonly TableMerge[] | undefined,
  nRows: number,
  nCols: number,
): TableMerge[] {
  if (!merges?.length) return [];
  const claimed = new Set<string>();
  const out: TableMerge[] = [];
  for (const m of merges) {
    const r = Math.floor(Number(m?.r));
    const c = Math.floor(Number(m?.c));
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    if (r < 0 || c < 0 || r >= nRows || c >= nCols) continue;
    const rowspan = Math.min(nRows - r, Math.max(1, Math.floor(Number(m.rowspan) || 1)));
    const colspan = Math.min(nCols - c, Math.max(1, Math.floor(Number(m.colspan) || 1)));
    if (rowspan === 1 && colspan === 1) continue;

    let clash = false;
    for (let rr = r; rr < r + rowspan && !clash; rr++) {
      for (let cc = c; cc < c + colspan; cc++) {
        if (claimed.has(`${rr},${cc}`)) {
          clash = true;
          break;
        }
      }
    }
    if (clash) continue;
    for (let rr = r; rr < r + rowspan; rr++) {
      for (let cc = c; cc < c + colspan; cc++) claimed.add(`${rr},${cc}`);
    }
    out.push({ r, c, rowspan, colspan });
  }
  return out;
}

/**
 * `"r,c"` for every cell a merge COVERS but does not anchor — the cells that
 * must not be drawn, and that OOXML marks with hMerge / vMerge.
 */
export function coveredCells(merges: readonly TableMerge[]): Set<string> {
  const covered = new Set<string>();
  for (const m of merges) {
    for (let r = m.r; r < m.r + (m.rowspan ?? 1); r++) {
      for (let c = m.c; c < m.c + (m.colspan ?? 1); c++) {
        if (r === m.r && c === m.c) continue;
        covered.add(`${r},${c}`);
      }
    }
  }
  return covered;
}

/** The merge anchored at (r, c), if any. */
export function mergeAt(
  merges: readonly TableMerge[],
  r: number,
  c: number,
): TableMerge | undefined {
  return merges.find((m) => m.r === r && m.c === c);
}
