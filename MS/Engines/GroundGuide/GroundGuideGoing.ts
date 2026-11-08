/**
 * GroundGuideGoing.ts
 *
 * Cross-country going, soil and movement freedom for the Ground Guide (GROTBC T, bundle v2 soil layers).
 * Pure logic plus a small climate-grid reader: no DOM, no view.
 *
 *   soil     value = texture | confidence << 4 | mapped << 6 (texture 1-12 USDA, 13 rocky, 14 salt pan); 255 nodata
 *   rci_*    value = cone index & 127 (127 = 127 or more), bit 7 = sand (coarse thresholds); 255 nodata
 *   wet      0 normal, 1 flood-prone, 2 seasonal water, 3 riverbed / floodplain, 4 waterlogged / marsh, 5 water
 *
 * Going at a pixel for a mode = the worst of: the class (rules.json profiles: no-go / caution), the soil (cone index
 * against the mode's vehicle cone index, rules.json grotbc.soilStrength) and, after rain, the wet layer.
 * See tools/terrain-pipeline/rules.yaml soilStrength and MS/Docs/16-ground-guide-grotbc-card.md.
 */

import type { CompiledProfile } from './GroundGuideEvaluator';
import type {
  GoingSeason,
  GoingStep,
  GroundGuideGoingInfo,
  GroundGuideMovement,
  GroundGuideMovementSector,
  SoilStrengthRules,
  TerrainRules,
} from './GroundGuideTypes';

export const GOING_ORDER: Record<GoingStep, number> = { go: 0, slow: 1, nogo: 2 };
export const GOING_WORD: Record<GoingStep, string> = { go: 'GO', slow: 'SLOW-GO', nogo: 'NO-GO' };
/** Dots, wedges and segments on the dark card; the ladder's three going colours (GroundGuideTokens STEP_COLOR). */
export const GOING_COLOR: Record<GoingStep, string> = { go: '#2fa862', slow: '#ee8a1f', nogo: '#e5484d' };
export const GOING_CODE: Record<GoingStep, number> = { go: 0, slow: 1, nogo: 2 };
export const CODE_STEP: GoingStep[] = ['go', 'slow', 'nogo'];
export const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const NODATA = 255;

export function worstStep(a: GoingStep, b: GoingStep): GoingStep {
  return GOING_ORDER[b] > GOING_ORDER[a] ? b : a;
}

/** Soil layer value -> parts; null for nodata. */
export function decodeSoil(v: number | null | undefined): { texture: number; confidence: number; mapped: boolean } | null {
  if (v === null || v === undefined || v === NODATA) return null;
  return { texture: v & 15, confidence: (v >> 4) & 3, mapped: ((v >> 6) & 1) === 1 };
}

/** rci layer value -> cone index and sand flag; null for nodata. */
export function decodeRci(v: number | null | undefined): { ci: number; coarse: boolean } | null {
  if (v === null || v === undefined || v === NODATA) return null;
  return { ci: v & 127, coarse: (v & 128) !== 0 };
}

/** The mode's soil thresholds, or null when the mode is not judged on soil (roads, rail, water, air). */
export interface VehicleRule {
  key: string;
  label: string;
  fine: [number, number];
  coarse: [number, number];
  /** Foot and pack animals: waterlogged ground slows them rather than stopping them. */
  onFoot: boolean;
}

export function vehicleFor(rules: TerrainRules | null, profile: string): VehicleRule | null {
  const ss: SoilStrengthRules | undefined = rules?.grotbc?.soilStrength;
  const key = ss?.byProfile?.[profile];
  const v = key ? ss?.vehicles?.[key] : undefined;
  if (!key || !v || !Array.isArray(v.fine) || !Array.isArray(v.coarse)) return null;
  return { key, label: v.label ?? key, fine: v.fine, coarse: v.coarse, onFoot: key === 'foot' || key === 'animal' };
}

/** Going on soil of cone index `ci` for a vehicle: >= vci50 GO, >= vci1 SLOW-GO, else NO-GO. */
export function soilStep(ci: number, coarse: boolean, veh: VehicleRule): GoingStep {
  const [v1, v50] = coarse ? veh.coarse : veh.fine;
  return ci >= v50 ? 'go' : ci >= v1 ? 'slow' : 'nogo';
}

export function classStep(cp: CompiledProfile, c: number | null | undefined): GoingStep | null {
  if (c === null || c === undefined || c === NODATA) return null;
  return cp.nogo[c] ? 'nogo' : cp.caution[c] ? 'slow' : 'go';
}

/** After rain: flood-prone and riverbed ground slows everyone; waterlogged ground stops vehicles. */
export function wetStep(w: number | null | undefined, veh: VehicleRule | null): GoingStep {
  if (w === 1 || w === 3) return 'slow';
  if (w === 4) return veh && !veh.onFoot ? 'nogo' : 'slow';
  return 'go';
}

/** Raw layer values at one pixel. `rci` is the season's layer. */
export interface GoingPixel {
  cls: number | null | undefined;
  rci: number | null | undefined;
  wet: number | null | undefined;
  /** Soil layer value, read only for the `bearing` rule. */
  soil?: number | null | undefined;
}

/**
 * How the soil changes the going (T, `groundGuide.traffic.rain`): the cone index against the vehicle's (`cone`, the
 * default), the texture's bearing for the season (`bearing`, GroundGuideTrafficability.bearingStep), or not at all
 * (`words`: the soil is described but GO / SLOW-GO / NO-GO come from the class and wet ground only).
 */
export type GoingRule =
  | { kind: 'cone' }
  | { kind: 'words' }
  | { kind: 'bearing'; step: (soil: number | null | undefined, season: GoingSeason, onFoot: boolean) => GoingStep | null };

const CONE_RULE: GoingRule = { kind: 'cone' };

export type GoingCause = 'class' | 'soil' | 'wet' | null;

/** Going at one pixel for a mode and season, and which part decided it; null when the class has no data. */
export function pixelGoing(
  px: GoingPixel,
  cp: CompiledProfile,
  veh: VehicleRule | null,
  season: GoingSeason,
  rule: GoingRule = CONE_RULE,
): { step: GoingStep; cause: GoingCause } | null {
  const cs = classStep(cp, px.cls);
  if (cs === null) return null;
  let step = cs;
  let cause: GoingCause = cs === 'go' ? null : 'class';
  if (veh && rule.kind !== 'words') {
    const r = rule.kind === 'cone' ? decodeRci(px.rci) : null;
    const ss = rule.kind === 'bearing' ? rule.step(px.soil, season, veh.onFoot) : r ? soilStep(r.ci, r.coarse, veh) : null;
    if (ss) {
      if (GOING_ORDER[ss] > GOING_ORDER[step]) {
        step = ss;
        cause = 'soil';
      }
    }
  }
  if (season === 'wet') {
    const ws = wetStep(px.wet, veh);
    if (GOING_ORDER[ws] > GOING_ORDER[step]) {
      step = ws;
      cause = 'wet';
    }
  }
  return { step, cause };
}

/** Rating of the eight directions: weight GO 1 / SLOW-GO 0.5 / NO-GO 0, times the share of the range reached. */
export function rateMovement(sectors: GroundGuideMovementSector[], rangeM: number): GroundGuideMovement {
  let score = 0;
  let open = 0;
  for (const s of sectors) {
    const w = s.step === 'go' ? 1 : s.step === 'slow' ? 0.5 : 0;
    score += w * Math.min(1, s.reachM / rangeM);
    if (s.step !== 'nogo' && s.reachM >= rangeM / 2) open++;
  }
  score = sectors.length ? score / sectors.length : 0;
  const rating = score >= 0.7 ? 'unrestricted' : score >= 0.4 ? 'restricted' : 'severe';
  return { rangeM, sectors, open, score, rating };
}

export const RATING_LABEL: Record<GroundGuideMovement['rating'], string> = {
  unrestricted: 'Unrestricted',
  restricted: 'Restricted',
  severe: 'Severely Restricted',
};
export const RATING_COLOR: Record<GroundGuideMovement['rating'], string> = {
  unrestricted: '#74dca3',
  restricted: '#ffb46b',
  severe: '#ff8a8d',
};

/** A soil swatch colour per texture code, light sand to dark clay. */
export const SOIL_COLOR: Record<number, string> = {
  1: '#dcbf82', 2: '#cdae74', 3: '#b9976a', 4: '#9f805c', 5: '#a08664', 6: '#b0997a',
  7: '#93704f', 8: '#80603f', 9: '#7a5d44', 10: '#8a5a3a', 11: '#6f513c', 12: '#5e4030',
  13: '#8d8d8a', 14: '#d9d6cc',
};

/**
 * USDA texture classes as polygons in (sand %, clay %) — silt is the rest — for the Ground Brief's texture triangle.
 * 13 and 14 (rocky, salt pan) are map classes with no place on the triangle.
 */
export const TEXTURE_POLYGONS: Record<number, Array<[number, number]>> = {
  1: [[85, 0], [90, 10], [100, 0]],
  2: [[70, 0], [85, 15], [90, 10], [85, 0]],
  3: [[52, 20], [80, 20], [85, 15], [70, 0], [50, 0], [43, 7], [52, 7]],
  4: [[23, 27], [45, 27], [52, 20], [52, 7], [43, 7]],
  5: [[0, 27], [23, 27], [43, 7], [50, 0], [20, 0], [8, 12], [0, 12]],
  6: [[0, 12], [8, 12], [20, 0], [0, 0]],
  7: [[45, 35], [65, 35], [80, 20], [52, 20], [45, 27]],
  8: [[20, 40], [45, 40], [45, 27], [20, 27]],
  9: [[0, 40], [20, 40], [20, 27], [0, 27]],
  10: [[45, 55], [65, 35], [45, 35]],
  11: [[0, 60], [20, 40], [0, 40]],
  12: [[0, 100], [45, 55], [45, 40], [20, 40], [0, 60]],
};

/** A short signature of what the card shows from `info`, so the card is rebuilt only when it changes. */
export function goingKey(info: GroundGuideGoingInfo | null | undefined): string {
  if (!info) return '';
  let mapSig = 0;
  if (info.map) for (let i = 0; i < info.map.cells.length; i++) mapSig = (mapSig * 31 + info.map.cells[i] + i) >>> 0;
  const s = info.soil;
  return [
    info.season, info.month ?? '', info.point?.dry ?? '', info.point?.wet ?? '', info.point?.limitDry ?? '', info.point?.limitWet ?? '',
    s ? `${s.texture}.${s.confidence}.${s.mapped ? 1 : 0}.${s.ciDry}.${s.ciWet}` : '',
    info.modes.map((m) => `${m.dry[0]}${m.wet[0]}`).join(''),
    info.movement?.sectors.map((x) => `${x.step[0]}${Math.round(x.reachM / 50)}${x.blockedBy ?? ''}`).join(',') ?? '',
    mapSig, info.climate ? 1 : 0, info.pending ? 1 : 0,
  ].join(';');
}

/** Month 1-12 for `month` (0 = now). */
export function resolveMonth(month: number): number {
  return month >= 1 && month <= 12 ? Math.floor(month) : new Date().getMonth() + 1;
}

/**
 * The ground state to judge (`groundGuide.going`): by hand, or with `auto` from the month's rain at the point
 * (`precMm`, 12 monthly normals) against `wetMonthMm`; without climate data Jul-Sep count as wet.
 * `month` is the month used, or null when the season was set by hand.
 */
export function resolveSeason(
  o: { season: 'auto' | 'dry' | 'wet'; month: number; wetMonthMm: number },
  precMm: number[] | null,
): { season: GoingSeason; month: number | null } {
  if (o.season !== 'auto') return { season: o.season, month: null };
  const month = resolveMonth(o.month);
  const wet = precMm ? precMm[month - 1] >= o.wetMonthMm : month >= 7 && month <= 9;
  return { season: wet ? 'wet' : 'dry', month };
}

/**
 * Monthly rain at a point from the bundle's climate grid (climate.json + climate.bin, int16 layers x rows x cols,
 * row 0 north). Loaded on first use; `precAt` returns null until it has arrived (and asks `onReady` to refresh).
 */
/** Climate normals at a point (ClimateGrid.normalsAt). */
export interface ClimateNormals {
  tmin: Array<number | null>;
  tmax: Array<number | null>;
  prec: number[];
  wind: Array<number | null>;
  precYear: number | null;
  monsoonPct: number | null;
  tmean: number | null;
  thresholds: { frostBelowC: number; hotFromC: number; wetFromMm: number };
  source: string;
  dataDate: string;
}

export class ClimateGrid {
  private _meta: any = null;
  private _data: Int16Array | null = null;
  private _prec: number[] = [];
  private _state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';

  constructor(
    private readonly _indexUrl: string,
    private readonly _dataUrl: string,
    private readonly _onReady: () => void,
  ) {}

  get state(): string {
    return this._state;
  }

  /** Twelve monthly rain normals (mm) at lon / lat; null while loading, on failure or outside the grid. */
  precAt(lon: number, lat: number): number[] | null {
    if (this._state === 'idle') void this._load();
    if (this._state !== 'ready' || !this._data || this._prec.length !== 12) return null;
    const m = this._meta;
    const [w, , , n] = m.bounds as [number, number, number, number];
    const col = Math.floor((lon - w) / m.cell);
    const row = Math.floor((n - lat) / m.cell);
    if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return null;
    const plane = m.rows * m.cols;
    const out: number[] = [];
    for (const li of this._prec) {
      const raw = this._data[li * plane + row * m.cols + col];
      if (raw === m.nodata) return null;
      out.push(raw / (m.layers[li].scale ?? 1));
    }
    return out;
  }

  /**
   * Every normal at lon / lat (W, the weather line): monthly tmin / tmax (degC), prec (mm), wind (m/s) and the yearly
   * layers (prec_year, monsoon_pct, frost_months, hot_months, wet_months, tmean). Null while loading, on failure or
   * outside the grid.
   */
  normalsAt(lon: number, lat: number): ClimateNormals | null {
    if (this._state === 'idle') void this._load();
    if (this._state !== 'ready' || !this._data) return null;
    const m = this._meta;
    const [w, , , n] = m.bounds as [number, number, number, number];
    const col = Math.floor((lon - w) / m.cell);
    const row = Math.floor((n - lat) / m.cell);
    if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return null;
    const plane = m.rows * m.cols;
    const at = (id: string): number | null => {
      const i = (m.layers ?? []).findIndex((l: any) => l.id === id);
      if (i < 0) return null;
      const raw = this._data![i * plane + row * m.cols + col];
      return raw === m.nodata ? null : raw / (m.layers[i].scale ?? 1);
    };
    const months = (p: string) => Array.from({ length: 12 }, (_, k) => at(`${p}_${String(k + 1).padStart(2, '0')}`));
    const prec = months('prec');
    if (prec.some((v) => v === null)) return null;
    return {
      tmin: months('tmin'),
      tmax: months('tmax'),
      prec: prec as number[],
      wind: months('wind'),
      precYear: at('prec_year'),
      monsoonPct: at('monsoon_pct'),
      tmean: at('tmean'),
      thresholds: { frostBelowC: m.thresholds?.frostBelowC ?? 0, hotFromC: m.thresholds?.hotFromC ?? 40, wetFromMm: m.thresholds?.wetFromMm ?? 100 },
      source: String(m.source ?? m.sourceRef?.name ?? 'WorldClim'),
      dataDate: String(m.sourceRef?.dataDate ?? ''),
    };
  }

  private async _load(): Promise<void> {
    this._state = 'loading';
    try {
      const meta = await (await fetch(this._indexUrl)).json();
      const prec: number[] = [];
      for (let mo = 1; mo <= 12; mo++) {
        const i = (meta.layers ?? []).findIndex((l: any) => l.id === `prec_${String(mo).padStart(2, '0')}`);
        if (i < 0) throw new Error(`climate grid has no prec_${mo}`);
        prec.push(i);
      }
      const res = await fetch(this._dataUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      this._meta = meta;
      this._prec = prec;
      this._data = new Int16Array(buf);
      this._state = 'ready';
      this._onReady();
    } catch {
      this._state = 'failed';
    }
  }
}
