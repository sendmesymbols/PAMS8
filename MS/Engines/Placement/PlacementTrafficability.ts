/**
 * PlacementTrafficability.ts
 *
 * T in GROTBC, the parts that sit on top of the going engine (PlacementGoing.ts, `v.going`):
 *  - the road line: the nearest road the mode can use (tankable class 60+ for tracks, all-weather for wheels,
 *    the MSR first when it is as near), from the bundle's road lines, or the landing-site line for a helicopter;
 *  - the soil-bearing rain rule, an alternative to the cone-index rule (rules.json grotbc.soilBearing);
 *  - the `placement.traffic.*` options: legend caption / season switch / month stepper, the overlay that follows
 *    the season, the header that follows it (opt-in), and the two compact card styles (pill, second scale).
 * Pure logic: no DOM, no ArcGIS. The card draws it with PlacementTrafficView.
 */

import { fmtDistance, titleCase } from './PlacementEvaluator';
import type { FeatureRoadHit } from './PlacementFeatures';
import type { GoingStep, PlacementProfile, TerrainRules } from './PlacementTypes';

/** What the legend adds for T: nothing, a caption, a Dry / After Rain switch, or a month stepper. */
export type TrafficLegendStyle = 'none' | 'label' | 'season' | 'month';
/**
 * How rain changes the going. `cone`: the cone index against the vehicle's (the going engine's own rule).
 * `bearing`: the soil texture's bearing after rain (Poor lowers vehicles one step, Very Poor two and foot one).
 * `words`: the soil is described but GO / SLOW-GO / NO-GO never change with it.
 */
export type TrafficRainRule = 'cone' | 'bearing' | 'words';

export interface PlacementTrafficOptions {
  /** Name the nearest road (or MSR) the mode can use; a landing-site line for helicopters. */
  road: boolean;
  /** How far round the point to look for a road, km. */
  roadRadiusKm: number;
  legend: TrafficLegendStyle;
  /** The overlay paints the going for the season (soil and wet ground included), not just the ground classes. */
  overlay: boolean;
  /** `season`: the header verdict, Why scale and Enforce Mode use the going for the season. `dry`: they stay as today. */
  header: 'dry' | 'season';
  /** A header pill when rain makes the going worse ("Rain: NO-GO"). */
  pill: boolean;
  /** A second going scale under Why, for the other season. */
  dual: boolean;
  rain: TrafficRainRule;
}

export const TRAFFIC_LEGEND_STYLES: readonly TrafficLegendStyle[] = ['none', 'label', 'season', 'month'];
export const TRAFFIC_RAIN_RULES: readonly TrafficRainRule[] = ['cone', 'bearing', 'words'];

export interface TrafficRoad {
  /** `Road`, or `Landing` for a helicopter landing site. */
  caption: string;
  text: string;
  distanceM: number | null;
  compass: string | null;
}

/** What T adds to a verdict while drawing (the going itself is `v.going`). */
export interface PlacementTraffic {
  road: TrafficRoad | null;
  /** A road tile was still loading. */
  pending: boolean;
  pill: boolean;
  dual: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthName(m: number): string {
  return MONTHS[(((Math.round(m) - 1) % 12) + 12) % 12];
}

function roadName(a: Record<string, unknown>): string {
  const n = typeof a.n === 'string' ? a.n.trim() : '';
  const r = typeof a.r === 'string' ? a.r.trim() : '';
  if (r && n && n !== r) return `${r} (${n})`;
  if (r || n) return r || n;
  return typeof a.t === 'string' ? titleCase(a.t.replace(/_/g, ' ')) : 'Road';
}

function roadClass(a: Record<string, unknown>): number | null {
  const c = typeof a.c === 'string' ? parseInt(a.c, 10) : NaN;
  return Number.isFinite(c) ? c : null;
}

/** All-weather unless the load code says F, or the road is unmetalled, shingled or a track. */
function allWeather(a: Record<string, unknown>): boolean {
  const c = typeof a.c === 'string' ? a.c : '';
  if (/^\d+F/i.test(c)) return false;
  if (/^\d+A/i.test(c)) return true;
  return !/unmetal|shingl|track|cart|path|earth/.test(String(a.t ?? '').toLowerCase());
}

function where(h: FeatureRoadHit): string {
  return `${fmtDistance(h.distanceM)} ${h.compass}`;
}

/** Prefer the MSR when it is no more than half as far again as the nearest road that qualifies. */
function preferMsr(list: FeatureRoadHit[]): FeatureRoadHit | undefined {
  const first = list[0];
  const msr = list.find((h) => h.attrs.m);
  return msr && first && msr.distanceM <= first.distanceM * 1.5 ? msr : first;
}

/**
 * The road line for a mode: the road it can use, nearest first. `step` is the mode's going at the point for the
 * season (foot on GO ground needs no road); `wet` the season. Null when roads do not matter for the mode.
 */
export function pickRoad(profile: PlacementProfile, step: GoingStep | null, wet: boolean, roads: FeatureRoadHit[], radiusM: number): TrafficRoad | null {
  const none = (what: string): TrafficRoad => ({ caption: 'Road', text: `No ${what} within ${fmtDistance(radiusM)}`, distanceM: null, compass: null });
  const line = (h: FeatureRoadHit, extra: string): TrafficRoad => ({
    caption: 'Road',
    text: `${h.attrs.m ? 'MSR ' : ''}${roadName(h.attrs)}${extra} · ${where(h)}`,
    distanceM: h.distanceM,
    compass: h.compass,
  });
  switch (profile) {
    case 'tracked':
    case 'amphibious': {
      const tank = preferMsr(roads.filter((h) => h.attrs.k === 3));
      if (!tank) return none('Tankable Road');
      const c = roadClass(tank.attrs);
      return line(tank, `${c !== null ? ` · Class ${c}` : ''}, Tankable`);
    }
    case 'dismounted':
    case 'pack': {
      if (step === 'go') return { caption: 'Road', text: 'Not Needed: GO Cross-Country', distanceM: null, compass: null };
      return roads[0] ? line(roads[0], '') : none('Road or Track');
    }
    case 'vessel':
    case 'rail':
    case 'oversnow':
    case 'exempt':
      return null;
    default: {
      const good = preferMsr(roads.filter((h) => allWeather(h.attrs)));
      const near = roads[0];
      if (!good && !near) return none('Road');
      if (near && !allWeather(near.attrs) && (!good || near.distanceM < good.distanceM * 0.6)) {
        const fair = `Fair-Weather Road ${where(near)}`;
        if (!good) return { caption: 'Road', text: wet ? `${fair}: SLOW-GO After Rain` : fair, distanceM: near.distanceM, compass: near.compass };
        const all = `${good.attrs.m ? 'MSR ' : ''}${roadName(good.attrs)} ${where(good)}`;
        return {
          caption: 'Road',
          text: wet ? `Use ${all} (All-Weather); ${fair} Is SLOW-GO` : `${fair} · ${all}`,
          distanceM: near.distanceM,
          compass: near.compass,
        };
      }
      const c = roadClass(good!.attrs);
      return line(good!, c !== null ? ` · Class ${c}` : '');
    }
  }
}

/** The landing-site line for a helicopter: slope band and wires from the class at the point, and soft ground after rain. */
export function landingLine(classCode: number | null | undefined, softAfterRain: boolean): TrafficRoad {
  const slope =
    classCode === 18 ? 'Slope 3 to 7°'
    : classCode === 19 ? 'Slope 7 to 15°: Too Steep'
    : classCode === 9 || classCode === 10 ? 'Too Steep'
    : 'Level';
  const wires = classCode === 33 || classCode === 48 ? 'Power Lines within 100 m' : 'No Wires Mapped';
  return { caption: 'Landing', text: `${slope} · ${wires}${softAfterRain ? ' · Soft After Rain' : ''}`, distanceM: null, compass: null };
}

const STEPS: GoingStep[] = ['go', 'slow', 'nogo'];

/**
 * Going from the soil under the `bearing` rule: the texture's bearing for the season (rules.json grotbc.soilBearing)
 * lowers vehicles one step when Poor and two when Very Poor; foot (`onFoot`) one step when Very Poor. Null when the
 * soil has no data.
 */
export function bearingStep(rules: TerrainRules | null, soil: number | null | undefined, season: 'dry' | 'wet', onFoot: boolean): GoingStep | null {
  if (soil === null || soil === undefined || soil === 255) return null;
  const b = (rules?.grotbc as any)?.soilBearing?.[String(soil & 15)]?.[season] as string | undefined;
  if (!b) return null;
  const steps = b === 'very_poor' ? (onFoot ? 1 : 2) : b === 'poor' ? (onFoot ? 0 : 1) : 0;
  return STEPS[steps];
}

/** For the badge's refresh key. */
export function trafficKey(t: PlacementTraffic | null | undefined): string {
  if (!t) return '';
  return `${t.road?.text ?? ''}/${t.pending ? 1 : 0}/${t.pill ? 1 : 0}/${t.dual ? 1 : 0}`;
}
