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

// Single icon with no echelon field (equipment, lone marker) counts as one.
const BASE_WEIGHT = 1;
const NO_ECHELON = '—';

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
    const result = this.compute(view);
    this._render(view, result);
    EngineLogger.success(
      ENGINE_NAME,
      `Force ratio ${result.ratio === null ? 'N/A' : result.ratio.toFixed(2) + ':1'} — ${result.posture}.`,
    );
  }

  close(): void {
    this._panel?.remove();
    this._panel = null;
  }

  destroy(): void {
    this.close();
  }

  private _ensurePanel(): HTMLElement {
    if (this._panel) return this._panel;
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.style.cssText = [
      'position:fixed', 'top:70px', 'right:20px', 'z-index:9999',
      'width:300px', 'padding:14px 16px',
      'background:rgba(13,17,23,0.96)', 'border:1px solid rgba(100,160,230,0.35)',
      'border-radius:10px', 'box-shadow:0 8px 30px rgba(0,0,0,0.5)',
      'font-family:system-ui,Segoe UI,sans-serif', 'color:#e8f4ff',
      'font-size:13px', 'backdrop-filter:blur(6px)',
    ].join(';');
    document.body.appendChild(el);
    this._panel = el;
    return el;
  }

  private _render(view: MapView | SceneView, r: CombatPowerResult): void {
    const el = this._ensurePanel();
    const ratioStr = r.ratio === null ? '—' : `${r.ratio.toFixed(2)} : 1`;
    const postureColor =
      r.posture === 'Deliberate attack' ? '#4caf50' :
      r.posture === 'Hasty attack' ? '#8bc34a' :
      r.posture === 'Near parity' ? '#ffb74d' :
      r.posture === 'Outnumbered' ? '#ef5350' : '#7eb4e8';

    const sideRow = (label: string, t: SideTally, color: string) =>
      `<tr>
         <td style="color:${color};padding:2px 8px 2px 0;font-weight:600">${label}</td>
         <td style="text-align:right;color:#e8f4ff;font-variant-numeric:tabular-nums">${t.totalValue}</td>
         <td style="text-align:right;color:#8aa;padding-left:8px">${t.unitCount}</td>
       </tr>`;

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  border-bottom:1px solid rgba(100,160,230,0.3);padding-bottom:6px;margin-bottom:8px">
        <span style="color:#64b4ff;font-weight:700">⚔ Combat Power</span>
        <span>
          <button id="cp-refresh" title="Recompute" style="background:none;border:none;color:#7eb4e8;cursor:pointer;font-size:14px">⟳</button>
          <button id="cp-close" title="Close" style="background:none;border:none;color:#7eb4e8;cursor:pointer;font-size:14px">✕</button>
        </span>
      </div>

      <table style="width:100%;border-spacing:0">
        <tr style="color:#6b8;font-size:11px;text-transform:uppercase">
          <td></td><td style="text-align:right">Power</td><td style="text-align:right;padding-left:8px">Units</td>
        </tr>
        ${sideRow('Friendly', r.friendly, '#5b9bd5')}
        ${sideRow('Hostile', r.hostile, '#ef5350')}
        ${r.neutral.unitCount ? sideRow('Neutral', r.neutral, '#4caf50') : ''}
        ${r.unknown.unitCount ? sideRow('Unknown', r.unknown, '#ffd54f') : ''}
      </table>

      <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(100,160,230,0.2);
                  display:flex;align-items:baseline;justify-content:space-between">
        <span style="color:#8aa">Ratio (F : H)</span>
        <span style="font-size:20px;font-weight:700;color:#e8f4ff;font-variant-numeric:tabular-nums">${ratioStr}</span>
      </div>
      <div style="margin-top:6px;color:${postureColor};font-weight:600">${r.posture}</div>
      <div style="margin-top:2px;color:#9bb;font-size:12px;line-height:1.35">${r.verdict}</div>
      <div style="margin-top:8px;color:#667;font-size:10px;font-style:italic">
        Relative estimate by echelon — not WEI/WUV. Counts FORCE-layer unit symbols only.
      </div>
    `;

    el.querySelector<HTMLButtonElement>('#cp-close')?.addEventListener('click', () => this.close());
    el.querySelector<HTMLButtonElement>('#cp-refresh')?.addEventListener('click', () =>
      this._render(view, this.compute(view)),
    );
  }
}
