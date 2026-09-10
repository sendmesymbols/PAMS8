/**
 * CombatPowerEngine.ts
 *
 * Sums the relative combat power of placed unit symbols by affiliation and
 * reports the force ratio (FRIENDLY : HOSTILE) with a doctrinal posture verdict.
 *
 * Design notes
 * ────────────
 * • Self-contained singleton — it is NOT part of AnalysisEngineRegistry. It owns
 *   no map graphics, needs no context-menu links, and never mutates the view.
 *   It only READS the symbol layers of whatever view it is opened on.
 * • No external data file. Combat-power weighting is a relative, in-code table
 *   keyed by MIL-STD-2525 echelon (positions 9-10 of the SIDC). These are
 *   deliberate ESTIMATES — relative unit values, not WEI/WUV — and are surfaced
 *   honestly in the panel. Promote ECHELON_WEIGHT into Settings.json only if
 *   runtime tuning is ever required.
 * • Output is data-first: compute() returns a CombatPowerResult; open() renders a
 *   compact readout panel. There is no map visualization and no dependency on
 *   VisualizationEngine.
 *
 * Public surface mirrors the lightweight engines:
 *   getInstance() / open(view) / close() / compute(view) / generateReport(view) / destroy()
 */

import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayerManager, {
  LAYER_NAMES,
  LEGACY_MIL_SYMBOLS_LAYER_ID,
} from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import { bindDisclosures } from '../../Support/Disclosure';

const ENGINE_NAME = 'Combat Power';
const PANEL_ID = 'combatPowerPanel';

type Affiliation = 'friendly' | 'hostile' | 'neutral' | 'unknown';

// ── Relative combat-power weights by 2525 echelon (SIDC positions 9-10) ───────
// Rough doctrinal scaling (each tier ≈ 3× the one below). Estimates only — they
// give a meaningful RELATIVE ratio, not an absolute combat-power score.
const ECHELON_WEIGHT: Record<string, number> = {
  '11': 1,      // Team / Crew
  '12': 2,      // Squad
  '13': 3,      // Section
  '14': 4,      // Platoon / Detachment
  '15': 13,     // Company / Battery / Troop
  '16': 45,     // Battalion / Squadron
  '17': 130,    // Regiment / Group
  '18': 150,    // Brigade
  '21': 450,    // Division
  '22': 1400,   // Corps / MEF
  '23': 4500,   // Army
  '24': 14000,  // Army Group / Front
  '25': 40000,  // Region / Theater
};

/** Display names for the echelon codes, for the Force detail breakdown. */
const ECHELON_LABEL: Record<string, string> = {
  '11': 'Team / Crew',
  '12': 'Squad',
  '13': 'Section',
  '14': 'Platoon',
  '15': 'Company',
  '16': 'Battalion',
  '17': 'Regiment',
  '18': 'Brigade',
  '21': 'Division',
  '22': 'Corps',
  '23': 'Army',
  '24': 'Army Group',
  '25': 'Theater',
  none: 'No echelon',
};

/** Verdict tone per posture, driving the header dot and the posture line. */
const POSTURE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  'Deliberate attack': 'success',
  'Hasty attack': 'success',
  'Near parity': 'warning',
  Outnumbered: 'danger',
  Uncontested: 'info',
  'No forces': 'info',
};

// Single icon with no echelon field (equipment, lone marker) counts as one.
const BASE_WEIGHT = 1;
const NO_ECHELON = 'none';

export interface SideTally {
  totalValue: number;
  unitCount: number;
  /** echelon code → { count, value } */
  byEchelon: Record<string, { count: number; value: number }>;
}

export interface CombatPowerResult {
  friendly: SideTally;
  hostile: SideTally;
  neutral: SideTally;
  unknown: SideTally;
  /** FRIENDLY : HOSTILE value ratio. null when there is no hostile force. */
  ratio: number | null;
  posture: string;
  verdict: string;
}

const emptyTally = (): SideTally => ({ totalValue: 0, unitCount: 0, byEchelon: {} });

export default class CombatPowerEngine {
  private static _instance: CombatPowerEngine | null = null;
  private _panel: HTMLElement | null = null;
  private _view: MapView | SceneView | null = null;
  private _layerHandles: any[] = [];
  private _refreshTimer: number | null = null;

  static getInstance(): CombatPowerEngine {
    if (!CombatPowerEngine._instance) {
      CombatPowerEngine._instance = new CombatPowerEngine();
    }
    return CombatPowerEngine._instance;
  }

  // ── SIDC parsing helpers ────────────────────────────────────────────────────

  /** Pull a SIDC string off a graphic regardless of how it was stored. */
  private _sidcOf(graphic: any): string | null {
    const a = graphic?.attributes;
    if (!a) return null;
    const sidc =
      a.sidc ??
      a.SIDC ??
      a.drawEssentials?.SIDC ??
      a.amplifier?.SIDC ??
      null;
    return typeof sidc === 'string' && sidc.length >= 4 ? sidc : null;
  }

  /**
   * Affiliation from the 2525 standard-identity field (the 2-digit value at
   * positions 3-4 = substring(2,4)). The full two-digit code must be matched:
   * reading only charAt(3) mis-maps presentation/colour identities 07-19
   * (e.g. 12->'2'->friendly, 15->'5'->hostile). Mirrors classifyAffiliation.
   */
  private _affiliationOf(sidc: string): Affiliation {
    const id = sidc.length >= 4 ? sidc.substring(2, 4) : '';
    switch (id) {
      case '02': // assumed friend
      case '03': // friend
        return 'friendly';
      case '05': // suspect / joker
      case '06': // hostile / faker
        return 'hostile';
      case '04': // neutral
        return 'neutral';
      default:   // 00 pending, 01 unknown, 07-25 presentation colours
        return 'unknown';
    }
  }

  /** Echelon code = SIDC positions 9-10. '00' (none) maps to NO_ECHELON. */
  private _echelonOf(sidc: string): string {
    const code = sidc.length >= 10 ? sidc.substring(8, 10) : '';
    return ECHELON_WEIGHT[code] !== undefined ? code : NO_ECHELON;
  }

  // ── Computation ─────────────────────────────────────────────────────────────

  /**
   * Walk the unit-symbol layers (FORCE + legacy milSymbols) of the given view,
   * bucket by affiliation, and sum relative combat power. Pure read — never
   * mutates the view.
   */
  compute(view: MapView | SceneView): CombatPowerResult {
    const tallies: Record<Affiliation, SideTally> = {
      friendly: emptyTally(),
      hostile: emptyTally(),
      neutral: emptyTally(),
      unknown: emptyTally(),
    };

    if (view) {
      const glm = GraphicsLayerManager.getInstance(view);
      // Only unit / equipment symbols carry combat power — FORCE layer and the
      // legacy milsymbol 3D layer. Tactical graphics (control measures) are
      // intentionally excluded.
      const layerIds = [LAYER_NAMES.FORCE, LEGACY_MIL_SYMBOLS_LAYER_ID];
      for (const id of layerIds) {
        const layer = glm.getLayer(id);
        if (!layer) continue;
        for (const graphic of layer.graphics.toArray()) {
          const sidc = this._sidcOf(graphic);
          if (!sidc) continue;
          const aff = this._affiliationOf(sidc);
          const ech = this._echelonOf(sidc);
          const weight = ech === NO_ECHELON ? BASE_WEIGHT : ECHELON_WEIGHT[ech];

          const t = tallies[aff];
          t.totalValue += weight;
          t.unitCount += 1;
          const bucket = (t.byEchelon[ech] ??= { count: 0, value: 0 });
          bucket.count += 1;
          bucket.value += weight;
        }
      }
    }

    const ratio =
      tallies.hostile.totalValue > 0
        ? tallies.friendly.totalValue / tallies.hostile.totalValue
        : null;

    const { posture, verdict } = this._verdict(ratio, tallies);

    return {
      friendly: tallies.friendly,
      hostile: tallies.hostile,
      neutral: tallies.neutral,
      unknown: tallies.unknown,
      ratio,
      posture,
      verdict,
    };
  }

  private _verdict(
    ratio: number | null,
    tallies: Record<Affiliation, SideTally>,
  ): { posture: string; verdict: string } {
    if (tallies.friendly.totalValue === 0 && tallies.hostile.totalValue === 0) {
      return { posture: 'No forces', verdict: 'No unit symbols placed.' };
    }
    if (ratio === null) {
      return {
        posture: 'Uncontested',
        verdict: 'No hostile force present — ratio not applicable.',
      };
    }
    if (ratio >= 3) {
      return { posture: 'Deliberate attack', verdict: 'Meets the 3:1 doctrinal minimum for a deliberate attack.' };
    }
    if (ratio >= 2) {
      return { posture: 'Hasty attack', verdict: 'Favourable — supports a hasty attack; short of 3:1.' };
    }
    if (ratio >= 1) {
      return { posture: 'Near parity', verdict: 'Roughly even — attack not recommended without a force advantage.' };
    }
    return { posture: 'Outnumbered', verdict: 'Friendly force is outnumbered — favour a defensive posture.' };
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  generateReport(view: MapView | SceneView): string {
    const r = this.compute(view);
    const ratioStr = r.ratio === null ? 'N/A' : `${r.ratio.toFixed(2)} : 1`;
    return [
      'COMBAT POWER — FORCE RATIO (relative estimate)',
      `  Friendly : ${r.friendly.totalValue}  (${r.friendly.unitCount} symbols)`,
      `  Hostile  : ${r.hostile.totalValue}  (${r.hostile.unitCount} symbols)`,
      `  Neutral  : ${r.neutral.totalValue}  (${r.neutral.unitCount} symbols)`,
      `  Unknown  : ${r.unknown.totalValue}  (${r.unknown.unitCount} symbols)`,
      `  Ratio (F:H): ${ratioStr}`,
      `  Posture  : ${r.posture} — ${r.verdict}`,
    ].join('\n');
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  open(view: MapView | SceneView): void {
    if (!view) {
      EngineLogger.error(ENGINE_NAME, 'No active view — cannot compute combat power.');
      return;
    }
    this._view = view;
    this._ensurePanel();
    this._panel?.classList.add('ms-visible');
    this._watchLayers(view);
    const result = this.compute(view);
    this._update(result);
    EngineLogger.success(
      ENGINE_NAME,
      `Force ratio ${result.ratio === null ? 'N/A' : result.ratio.toFixed(2) + ':1'} — ${result.posture}.`,
    );
  }

  close(): void {
    this._unwatchLayers();
    this._panel?.classList.remove('ms-visible');
  }

  destroy(): void {
    this._unwatchLayers();
    this._panel?.remove();
    this._panel = null;
    this._view = null;
  }

  /**
   * Recompute whenever a unit symbol is added, removed or re-affiliated. The
   * panel used to read the map once at open and then sit there: place another
   * battalion and the ratio silently stayed wrong until you found the ⟳.
   */
  private _watchLayers(view: MapView | SceneView): void {
    this._unwatchLayers();
    const glm = GraphicsLayerManager.getInstance(view);
    [LAYER_NAMES.FORCE, LEGACY_MIL_SYMBOLS_LAYER_ID].forEach((id) => {
      const layer = glm.getLayer(id);
      const handle = (layer as any)?.graphics?.on?.('change', () => this._scheduleRefresh());
      if (handle) this._layerHandles.push(handle);
    });
  }

  private _unwatchLayers(): void {
    this._layerHandles.forEach((h) => { try { h.remove(); } catch { /* already gone */ } });
    this._layerHandles = [];
    if (this._refreshTimer !== null) {
      window.clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  /** Coalesce a burst of layer changes (a paste, a plan load) into one pass. */
  private _scheduleRefresh(): void {
    if (this._refreshTimer !== null) window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = null;
      if (!this._view || !this._panel?.classList.contains('ms-visible')) return;
      this._update(this.compute(this._view));
    }, 180);
  }

  private _ensurePanel(): HTMLElement {
    if (this._panel) return this._panel;
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'ms-panel ms-theme-ops-dark';
    el.setAttribute('data-engine', 'combat-power');
    // z-index 9999 put this panel above every menu in the app, including the
    // command palette. Widgets live at 1098.
    el.style.cssText = 'top: 70px; right: 20px; width: 300px; z-index: 1098;';
    el.innerHTML = this._panelHtml();
    document.body.appendChild(el);
    this._panel = el;

    el.querySelector('#cp-close')?.addEventListener('click', () => this.close());
    el.querySelector('#cp-refresh')?.addEventListener('click', () => {
      if (this._view) this._update(this.compute(this._view));
    });
    el.querySelector('#cp-help-btn')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const help = el.querySelector<HTMLElement>('#cp-help-popover');
      if (help) help.hidden = !help.hidden;
    });
    el.querySelector('#cp-help-close')?.addEventListener('click', () => {
      const help = el.querySelector<HTMLElement>('#cp-help-popover');
      if (help) help.hidden = true;
    });
    el.querySelector('#cp-min-btn')?.addEventListener('click', () => {
      const body = el.querySelector<HTMLElement>('.ms-body');
      const btn = el.querySelector<HTMLElement>('#cp-min-btn');
      if (!body || !btn) return;
      const minimized = body.classList.toggle('ms-minimized');
      btn.textContent = minimized ? '▶' : '▼';
      btn.title = minimized ? 'Restore' : 'Minimize';
    });

    bindDisclosures(el);
    this._makeDraggable(el);
    return el;
  }

  /**
   * Built once. Recomputing only writes values into these nodes — re-running
   * innerHTML would collapse the Force detail disclosure on every refresh.
   */
  private _panelHtml(): string {
    return `
      <div class="ms-header" id="cp-drag-handle">
        <span class="ms-header-icon">CBT</span>
        <span class="ms-header-title">Combat Power</span>
        <span class="ms-status-dot" id="cp-status-dot"></span>
        <span class="ms-status-lbl" id="cp-status-lbl">Reading map</span>
        <button class="ms-header-btn ms-btn-round" id="cp-help-btn" title="How the force ratio is derived">?</button>
        <button class="ms-header-btn ms-btn-round" id="cp-min-btn" title="Minimize">&#9660;</button>
        <button class="ms-header-btn ms-btn-round" id="cp-close" title="Close">&#10005;</button>
      </div>
      <div class="ms-help-popover" id="cp-help-popover" hidden>
        <div class="ms-help-head">
          <div>
            <div class="ms-help-kicker">Field Guide</div>
            <div class="ms-help-title">Combat Power &amp; Force Ratio</div>
          </div>
          <button class="ms-help-close" id="cp-help-close" title="Close">&#10005;</button>
        </div>
        <div class="ms-help-body">
          <p><strong style="color:#EF9F27">What it does.</strong> Sums the relative combat power of every unit symbol on the map by affiliation and reports the FRIENDLY : HOSTILE ratio against the 3:1 rule. It reads the map and recomputes itself as you place symbols — there is nothing to set.</p>
          <p><strong style="color:#EF9F27">The verdict scale.</strong></p>
          <ul style="margin:0 0 9px;padding-left:16px;list-style:none">
            <li><span style="color:#1D9E75">3:1 or better</span> — meets the doctrinal minimum for a deliberate attack.</li>
            <li><span style="color:#78C840">2:1 to 3:1</span> — supports a hasty attack, short of the deliberate minimum.</li>
            <li><span style="color:#EF9F27">1:1 to 2:1</span> — near parity; attacking without an advantage is not recommended.</li>
            <li><span style="color:#DC3C30">below 1:1</span> — outnumbered; favour a defensive posture.</li>
          </ul>
          <p><strong style="color:#EF9F27">Weighting.</strong> Power comes from the echelon field of each symbol's SIDC (positions 9-10), on a relative scale where each tier is roughly three times the one below: team 1, squad 2, platoon 4, company 13, battalion 45, brigade 150, division 450. A symbol with no echelon (equipment, a lone marker) counts as 1. Open <strong>Force detail</strong> to see the per-echelon breakdown behind each side's total.</p>
          <p><strong style="color:#EF9F27">Limitations — read before briefing.</strong> These are deliberate ESTIMATES, not WEI/WUV scores: they give a meaningful relative ratio and nothing more. Nothing here accounts for posture, terrain, fires, logistics or morale. Only unit and equipment symbols on the force layer are counted — tactical control measures are ignored, and so is anything drawn on another layer.</p>
        </div>
      </div>
      <div class="ms-body">
        <div class="ms-info-grid">
          <div class="ms-info-item">
            <div class="ms-info-label">Friendly power</div>
            <div class="ms-info-value cp-friendly" id="cp-friendly-val">-</div>
          </div>
          <div class="ms-info-item">
            <div class="ms-info-label">Hostile power</div>
            <div class="ms-info-value cp-hostile" id="cp-hostile-val">-</div>
          </div>
        </div>
        <div class="cp-ratio">
          <span class="cp-ratio-lbl">Ratio (F : H)</span>
          <span class="cp-ratio-val" id="cp-ratio">-</span>
        </div>
        <div class="cp-posture" id="cp-posture">-</div>
        <div class="ms-status" id="cp-verdict">Place unit symbols to compute a force ratio.</div>
        <div class="ms-btn-row">
          <button class="ms-btn primary" id="cp-refresh" title="Recompute from the map now">Recompute &#10227;</button>
        </div>
        <div class="ms-disclosure" data-open="false">
          <button class="ms-disclosure-head" type="button" id="cp-detail-toggle" aria-expanded="false" aria-controls="cp-detail-body">
            <span class="ms-disclosure-chevron" aria-hidden="true">&#9654;</span>
            <span class="ms-disclosure-title">Force detail</span>
            <span class="ms-disclosure-meta">Per-side totals and echelon breakdown</span>
          </button>
          <div class="ms-disclosure-body" id="cp-detail-body" hidden>
            <div class="ms-section-title">By affiliation</div>
            <table class="cp-table" id="cp-side-table"></table>
            <div class="ms-section-title">By echelon</div>
            <table class="cp-table" id="cp-echelon-table"></table>
            <div class="ms-hint">Relative estimate by echelon — not WEI/WUV. Counts force-layer unit symbols only.</div>
          </div>
        </div>
      </div>
    `;
  }

  /** Write the current result into the panel that _ensurePanel already built. */
  private _update(r: CombatPowerResult): void {
    const el = this._panel;
    if (!el) return;

    const text = (id: string, value: string) => {
      const node = el.querySelector<HTMLElement>(`#${id}`);
      if (node) node.textContent = value;
    };

    text('cp-friendly-val', String(r.friendly.totalValue));
    text('cp-hostile-val', String(r.hostile.totalValue));
    text('cp-ratio', r.ratio === null ? '-' : `${r.ratio.toFixed(2)} : 1`);
    text('cp-posture', r.posture);
    text('cp-verdict', r.verdict);
    text('cp-status-lbl', r.posture);

    const tone = POSTURE_TONE[r.posture] ?? 'info';
    const posture = el.querySelector<HTMLElement>('#cp-posture');
    if (posture) posture.className = `cp-posture cp-${tone}`;
    const verdict = el.querySelector<HTMLElement>('#cp-verdict');
    if (verdict) {
      verdict.className = `ms-status ${tone === 'success' ? 'success' : tone === 'danger' ? 'warning' : ''}`.trim();
    }
    const dot = el.querySelector<HTMLElement>('#cp-status-dot');
    if (dot) {
      dot.className = `ms-status-dot ${tone === 'success' ? 'ready' : tone === 'danger' ? 'warning' : 'running'}`;
    }

    const sides: Array<[string, SideTally]> = [
      ['Friendly', r.friendly],
      ['Hostile', r.hostile],
      ['Neutral', r.neutral],
      ['Unknown', r.unknown],
    ];
    const sideTable = el.querySelector<HTMLElement>('#cp-side-table');
    if (sideTable) {
      sideTable.innerHTML =
        '<tr><th></th><th>Power</th><th>Symbols</th></tr>' +
        sides.map(([label, t]) =>
          `<tr><td class="cp-${label.toLowerCase()}">${label}</td><td>${t.totalValue}</td><td>${t.unitCount}</td></tr>`,
        ).join('');
    }

    // byEchelon has always been computed and never shown. It is the only real
    // explanation of where a side's total came from, so it goes here.
    const echTable = el.querySelector<HTMLElement>('#cp-echelon-table');
    if (echTable) {
      const codes = Array.from(new Set([
        ...Object.keys(r.friendly.byEchelon),
        ...Object.keys(r.hostile.byEchelon),
      ])).sort((a, b) => (ECHELON_WEIGHT[b] ?? 0) - (ECHELON_WEIGHT[a] ?? 0));
      echTable.innerHTML = codes.length
        ? '<tr><th>Echelon</th><th class="cp-friendly">F</th><th class="cp-hostile">H</th><th>Each</th></tr>' +
          codes.map((code) => {
            const f = r.friendly.byEchelon[code];
            const h = r.hostile.byEchelon[code];
            const each = code === NO_ECHELON ? BASE_WEIGHT : ECHELON_WEIGHT[code];
            return `<tr><td>${ECHELON_LABEL[code] ?? code}</td>`
              + `<td>${f ? f.count : '-'}</td>`
              + `<td>${h ? h.count : '-'}</td>`
              + `<td>${each}</td></tr>`;
          }).join('')
        : '<tr><td colspan="4" class="cp-empty">No unit symbols on the force layer.</td></tr>';
    }
  }

  private _makeDraggable(panel: HTMLElement): void {
    const handle = panel.querySelector<HTMLElement>('.ms-header');
    if (!handle) return;
    let ox = 0;
    let oy = 0;

    const onMove = (e: MouseEvent) => {
      const maxLeft = window.innerWidth - panel.offsetWidth - 4;
      const maxTop = window.innerHeight - panel.offsetHeight - 4;
      panel.style.left = `${Math.max(0, Math.min(e.clientX - ox, maxLeft))}px`;
      panel.style.top = `${Math.max(0, Math.min(e.clientY - oy, maxTop))}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('button, input, select')) return;
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = 'auto';
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }
}
