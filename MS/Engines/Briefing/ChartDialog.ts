/**
 * ChartDialog.ts
 *
 * Edit a chart overlay's model: type, title, axis titles, and the data itself
 * as CSV. A modal flyout built the same way SlideLinkDialog is (own DOM, own
 * injected stylesheet, no framework), because it is the same kind of thing.
 *
 * The data itself is edited as CSV; that format and its parser live in
 * ChartFactory (`specToCsv` / `csvToSeries`) rather than here, because they are
 * pure ChartSpec transforms with no DOM in them and are unit-tested as such.
 */

import {
  csvToSeries,
  isRadialChart,
  specToCsv,
  type ChartKind,
  type ChartSpec,
} from './ChartFactory';
import { chartSources, type ChartSource } from './AnalysisCharts';

export interface ChartDialogOptions {
  /** The spec being edited. Never mutated — `onApply` receives a new one. */
  spec: ChartSpec;
  onApply(spec: ChartSpec): void;
}

const TYPE_LABELS: Array<[ChartKind, string]> = [
  ['bar', 'Bar (columns)'],
  ['barStacked', 'Bar — stacked'],
  ['barHorizontal', 'Bar — horizontal'],
  ['line', 'Line'],
  ['area', 'Area'],
  ['pie', 'Pie'],
  ['doughnut', 'Doughnut'],
  ['scatter', 'Scatter'],
  ['radar', 'Radar'],
];

function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export default class ChartDialog {
  private _el: HTMLElement | null = null;
  private _opts: ChartDialogOptions | null = null;
  private _onKey: ((e: KeyboardEvent) => void) | null = null;
  private _sources: ChartSource[] = [];
  /**
   * Spec produced by the last data-source pick. Only its non-form fields
   * (colours, ink) are taken on Apply — everything the form shows is read back
   * from the form, so the author's edits after the pick always win.
   */
  private _pending: ChartSpec | null = null;

  public get isOpen(): boolean {
    return !!this._el;
  }

  public show(stage: HTMLElement, opts: ChartDialogOptions): void {
    this.hide();
    this._injectStyles();
    this._opts = opts;
    const s = opts.spec;
    // Resolved once per open, so the availability text reflects what the
    // analysis engines are holding at the moment the author looks.
    this._sources = chartSources();

    const el = document.createElement('div');
    el.className = 'ms-chart-wrap';
    el.innerHTML = `
      <div class="ms-chart" role="dialog" aria-label="Chart data">
        <div class="ms-chart-head">
          <span class="ms-chart-title">Chart</span>
          <button class="ms-chart-x" title="Close (Esc)">✕</button>
        </div>
        <div class="ms-chart-body">
          <label class="ms-chart-row">
            <span>Type</span>
            <select class="ms-chart-type">
              ${TYPE_LABELS.map(
                ([v, l]) =>
                  `<option value="${v}"${v === s.type ? ' selected' : ''}>${esc(l)}</option>`,
              ).join('')}
            </select>
          </label>
          <label class="ms-chart-row">
            <span>Title</span>
            <input type="text" class="ms-chart-ttl" maxlength="120" value="${esc(s.title ?? '')}">
          </label>
          <div class="ms-chart-two">
            <label class="ms-chart-row">
              <span>Category axis</span>
              <input type="text" class="ms-chart-cat" maxlength="60" value="${esc(
                s.catAxisTitle ?? '',
              )}">
            </label>
            <label class="ms-chart-row">
              <span>Value axis</span>
              <input type="text" class="ms-chart-val" maxlength="60" value="${esc(
                s.valAxisTitle ?? '',
              )}">
            </label>
          </div>
          <div class="ms-chart-flags">
            <label><input type="checkbox" class="ms-chart-leg"${
              s.showLegend !== false ? ' checked' : ''
            }> Legend</label>
            <label><input type="checkbox" class="ms-chart-vals"${
              s.showValue ? ' checked' : ''
            }> Data labels</label>
            <label><input type="checkbox" class="ms-chart-grid"${
              s.gridlines !== false ? ' checked' : ''
            }> Gridlines</label>
          </div>
          <label class="ms-chart-row">
            <span>Data source</span>
            <select class="ms-chart-src">
              <option value="">Type it in below</option>
              ${this._sources
                .map(
                  (s, i) =>
                    `<option value="${i}"${s.unavailable ? ' disabled' : ''}>${esc(
                      s.unavailable ? `${s.label} — ${s.unavailable}` : s.label,
                    )}</option>`,
                )
                .join('')}
            </select>
          </label>
          <div class="ms-chart-sect">Data — first column is labels, header row names each series</div>
          <textarea class="ms-chart-csv" spellcheck="false" rows="9">${esc(
            specToCsv(s),
          )}</textarea>
          <div class="ms-chart-err"></div>
        </div>
        <div class="ms-chart-foot">
          <span class="ms-chart-note">Exports as a native, editable PowerPoint chart</span>
          <button class="ms-chart-cancel">Cancel</button>
          <button class="ms-chart-apply">Apply</button>
        </div>
      </div>`;
    stage.appendChild(el);
    this._el = el;

    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    q('.ms-chart-x').onclick = () => this.hide();
    q('.ms-chart-cancel').onclick = () => this.hide();
    q('.ms-chart-apply').onclick = () => this._apply();

    // Axis titles mean nothing on a pie — grey them out rather than silently
    // accepting values the chart will never show.
    const syncAxisEnabled = () => {
      const radial = isRadialChart(q<HTMLSelectElement>('.ms-chart-type').value as ChartKind);
      q<HTMLInputElement>('.ms-chart-cat').disabled = radial;
      q<HTMLInputElement>('.ms-chart-val').disabled = radial;
      q<HTMLInputElement>('.ms-chart-grid').disabled = radial;
    };
    q<HTMLSelectElement>('.ms-chart-type').onchange = syncAxisEnabled;
    syncAxisEnabled();

    // Choosing an analysis source fills the whole form — type, title, axes and
    // the CSV — so the author can then tweak it like any other chart. It does
    // NOT apply on its own: the dialog still commits on Apply, so a mis-click
    // is one Cancel away.
    q<HTMLSelectElement>('.ms-chart-src').onchange = (e) => {
      const sel = e.target as HTMLSelectElement;
      const src = this._sources[Number(sel.value)];
      if (!src) return;
      const spec = src.build();
      if (!spec) {
        q('.ms-chart-err').textContent = src.unavailable ?? 'That source returned no data.';
        sel.value = '';
        return;
      }
      q('.ms-chart-err').textContent = '';
      q<HTMLSelectElement>('.ms-chart-type').value = spec.type;
      q<HTMLInputElement>('.ms-chart-ttl').value = spec.title ?? '';
      q<HTMLInputElement>('.ms-chart-cat').value = spec.catAxisTitle ?? '';
      q<HTMLInputElement>('.ms-chart-val').value = spec.valAxisTitle ?? '';
      q<HTMLInputElement>('.ms-chart-leg').checked = spec.showLegend !== false;
      q<HTMLInputElement>('.ms-chart-vals').checked = !!spec.showValue;
      q<HTMLTextAreaElement>('.ms-chart-csv').value = specToCsv(spec);
      // Carried onto Apply so the source's own palette and ink survive.
      this._pending = spec;
      syncAxisEnabled();
    };

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._apply();
      }
    };
    el.addEventListener('keydown', this._onKey, true);
    q<HTMLTextAreaElement>('.ms-chart-csv').focus();
  }

  public hide(): void {
    if (this._el && this._onKey) this._el.removeEventListener('keydown', this._onKey, true);
    this._el?.remove();
    this._el = null;
    this._opts = null;
    this._onKey = null;
    this._sources = [];
    this._pending = null;
  }

  private _apply(): void {
    const el = this._el;
    const opts = this._opts;
    if (!el || !opts) return;
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;

    const parsed = csvToSeries(q<HTMLTextAreaElement>('.ms-chart-csv').value);
    if (!parsed) {
      q('.ms-chart-err').textContent =
        'Need a header row and at least one data row — see the format above.';
      return;
    }
    const type = q<HTMLSelectElement>('.ms-chart-type').value as ChartKind;
    const next: ChartSpec = {
      ...opts.spec,
      // A data-source pick contributes its palette and ink; the form supplies
      // everything else, so post-pick edits are never overwritten.
      ...(this._pending ? { colors: this._pending.colors, textColor: this._pending.textColor } : {}),
      type,
      labels: parsed.labels,
      series: parsed.series,
      title: q<HTMLInputElement>('.ms-chart-ttl').value.trim() || undefined,
      catAxisTitle: q<HTMLInputElement>('.ms-chart-cat').value.trim() || undefined,
      valAxisTitle: q<HTMLInputElement>('.ms-chart-val').value.trim() || undefined,
      showLegend: q<HTMLInputElement>('.ms-chart-leg').checked,
      showValue: q<HTMLInputElement>('.ms-chart-vals').checked,
      gridlines: q<HTMLInputElement>('.ms-chart-grid').checked,
    };
    opts.onApply(next);
    this.hide();
  }

  private _injectStyles(): void {
    if (document.getElementById('ms-chart-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-chart-style';
    style.textContent = `
      .ms-chart-wrap {
        position: absolute; inset: 0; z-index: 60;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,11,14,0.55);
      }
      .ms-chart {
        width: 460px; max-width: calc(100% - 32px); max-height: calc(100% - 40px);
        display: flex; flex-direction: column;
        background: rgba(24,29,35,0.99); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px; box-shadow: 0 16px 44px rgba(0,0,0,0.55);
        font: 12px/1.4 system-ui, sans-serif; color: #dde3e8;
      }
      .ms-chart-head {
        display: flex; align-items: center; gap: 8px; padding: 9px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-chart-title { font-weight: 600; font-size: 13px; flex: 1; }
      .ms-chart-x {
        background: none; border: none; color: #9aa6b2; cursor: pointer;
        font-size: 13px; padding: 2px 4px;
      }
      .ms-chart-x:hover { color: #fff; }
      .ms-chart-body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
      .ms-chart-row { display: flex; align-items: center; gap: 8px; }
      .ms-chart-row > span { width: 92px; color: #9aa6b2; flex: none; }
      .ms-chart-row input, .ms-chart-row select {
        flex: 1; min-width: 0; background: rgba(0,0,0,0.3); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px; padding: 4px 6px;
        font: inherit;
      }
      .ms-chart-row input:disabled { opacity: 0.4; }
      .ms-chart-two { display: flex; gap: 10px; }
      .ms-chart-two .ms-chart-row { flex: 1; }
      .ms-chart-two .ms-chart-row > span { width: auto; }
      .ms-chart-flags { display: flex; gap: 14px; color: #9aa6b2; }
      .ms-chart-flags label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
      .ms-chart-sect {
        color: #7d8894; font-size: 11px; text-transform: uppercase;
        letter-spacing: 0.4px; margin-top: 2px;
      }
      .ms-chart-csv {
        background: rgba(0,0,0,0.35); color: #dde3e8; resize: vertical;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px; padding: 6px;
        font: 11px/1.45 ui-monospace, Consolas, monospace; white-space: pre;
      }
      .ms-chart-err { color: #ff8b80; min-height: 14px; font-size: 11px; }
      .ms-chart-foot {
        display: flex; align-items: center; gap: 8px; padding: 9px 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .ms-chart-note { flex: 1; color: #7d8894; font-size: 11px; }
      .ms-chart-foot button {
        background: rgba(255,255,255,0.08); color: #dde3e8; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px; padding: 4px 12px;
        font: inherit;
      }
      .ms-chart-foot button:hover { background: rgba(255,255,255,0.14); }
      .ms-chart-apply { background: #2D6CDF !important; border-color: #2D6CDF !important; color: #fff !important; }
      .ms-chart-apply:hover { background: #3d7cef !important; }
    `;
    document.head.appendChild(style);
  }
}
