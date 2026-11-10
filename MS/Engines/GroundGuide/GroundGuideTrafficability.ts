/**
 * GroundGuideTrafficability.ts
 *
 * T in GROTBC, the parts that sit on top of the going engine (GroundGuideGoing.ts, `v.going`):
 *  - the road line: the nearest road the mode can use (tankable class 60+ for tracks, all-weather for wheels,
 *    the MSR first when it is as near), from the bundle's road lines, or the landing-site line for a helicopter;
 *  - the soil-bearing rain rule, an alternative to the cone-index rule (rules.json grotbc.soilBearing);
 *  - the `groundGuide.traffic.*` options: legend caption / season switch / month stepper, the overlay that follows
 *    the season, the header that follows it (opt-in), and the two compact card styles (pill, second scale).
 * Pure logic: no DOM, no ArcGIS. The card draws it with GroundGuideTrafficView.
 */

import { fmtDistance, titleCase } from './GroundGuideEvaluator';
import type { FeatureRoadHit } from './GroundGuideFeatures';
import type { GoingStep, GroundGuideProfile, TerrainRules } from './GroundGuideTypes';

/** What the legend adds for T: nothing, a caption, a Dry / After Rain switch, or a month stepper. */
export type TrafficLegendStyle = 'none' | 'label' | 'season' | 'month';
/**
 * How rain changes the going. `cone`: the cone index against the vehicle's (the going engine's own rule).
 * `bearing`: the soil texture's bearing after rain (Poor lowers vehicles one step, Very Poor two and foot one).
 * `words`: the soil is described but GO / SLOW-GO / NO-GO never change with it.
 */
export type TrafficRainRule = 'cone' | 'bearing' | 'words';

export interface GroundGuideTrafficOptions {
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
  /**
   * T as ONE block in place of the separate pieces (the Cross-Country and Movement sections, the Road band and the
   * pill stay as set when `off`): `band` going now + why / road / movement rows, `gauge` a GO to NO-GO bar with dry
   * and after-rain markers, `calendar` twelve months coloured by going, `tiles` foot / wheels / tracks (/ air) with dry
   * and after-rain bars, `wayout` a line to the road coloured by the going crossed, `rose` the movement rose with the
   * road's shield on its rim, `ticker` one slim strip under the header, `tabs` Now / Rain / Road / Months (T cycles).
   */
  block: TrafficBlockStyle;
  /** Where the block sits: right after Why, in GROTBC order (after G, before B), or folded to one line until T. */
  where: TrafficWhere;
  /**
   * Where the road line's roads come from. `network`: the routing network in the bundle (the roads GeoCore routes on
   * and the map's roads layer draws: one source, one answer); the NCGDB lines when the bundle has no network.
   * `ncgdb`: the NCGDB road lines of the feature tiles.
   */
  roadSource: 'network' | 'ncgdb';
  /**
   * After a symbol is placed, ask the road server (GeoCore) for the way out by road to the nearest MSR, for the
   * symbol's vehicle (Tracked Vehicle for tracks, Wheeled Vehicle for wheels); one request per placement, never while
   * moving. Needs a road server with military travel modes; says nothing without one.
   */
  access: boolean;
  /** How far the way out looks for an MSR, km (the road line's road is used when none is in reach). */
  accessRadiusKm: number;
}

export type TrafficBlockStyle = 'off' | 'band' | 'gauge' | 'calendar' | 'tiles' | 'wayout' | 'rose' | 'ticker' | 'tabs';
export type TrafficWhere = 'afterWhy' | 'grotbc' | 'folded';
export const TRAFFIC_BLOCK_STYLES: readonly TrafficBlockStyle[] = ['off', 'band', 'gauge', 'calendar', 'tiles', 'wayout', 'rose', 'ticker', 'tabs'];
export const TRAFFIC_WHERE: readonly TrafficWhere[] = ['afterWhy', 'grotbc', 'folded'];

export const TRAFFIC_LEGEND_STYLES: readonly TrafficLegendStyle[] = ['none', 'label', 'season', 'month'];
export const TRAFFIC_RAIN_RULES: readonly TrafficRainRule[] = ['cone', 'bearing', 'words'];

export interface TrafficRoad {
  /** `Road`, or `Landing` for a helicopter landing site. */
  caption: string;
  text: string;
  distanceM: number | null;
  compass: string | null;
  /** The road named first, for the drawn styles (shield, way out, rose); null for "not needed" and landing lines. */
  main: TrafficRoadRef | null;
  /** An all-weather road further off, when the nearest is fair-weather (wheels). */
  alt: TrafficRoadRef | null;
  /**
   * Foot on GO ground: cross-country is an option beside the road, not a replacement for it. The card lists both
   * and leaves the choice to the user (the road may still be quicker or easier to follow).
   */
  crossCountry?: GoingStep | null;
}

export interface TrafficRoadRef {
  /** Road number ("N-5"), else "Road" / "Track". */
  shield: string;
  name: string | null;
  /** "Class 70 · Tankable", "Class 40 · All-Weather", "Fair-Weather". */
  tag: string | null;
  msr: boolean;
  allWeather: boolean;
  distanceM: number;
  compass: string;
  bearingDeg: number;
}

/** What T adds to a verdict while drawing (the going itself is `v.going`). */
export interface GroundGuideTraffic {
  road: TrafficRoad | null;
  /** A road tile was still loading. */
  pending: boolean;
  pill: boolean;
  dual: boolean;
  /** The one-block style (`traffic.block`, `off` = the separate pieces) and where it sits. */
  block: TrafficBlockStyle;
  where: TrafficWhere;
  /** `folded`: the T key has opened the block. */
  open: boolean;
  /** `tabs`: the tab shown (0 Now, 1 Rain, 2 Road, 3 Months). */
  tab: number;
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
  return typeof a.t === 'string' ? titleCase(a.t.replace(/_/g, ' ')) : 'Rd';
}

function roadClass(a: Record<string, unknown>): number | null {
  const c = typeof a.c === 'string' ? parseInt(a.c, 10) : NaN;
  return Number.isFinite(c) ? c : null;
}

/**
 * All-weather unless the load code says F, or the road is unmetalled, shingled or a track. A road from the routing
 * network (GroundGuideRoads) says so itself (`aw`), from the same flag GeoCore's All-Weather restriction reads.
 */
function allWeather(a: Record<string, unknown>): boolean {
  if (typeof a.aw === 'boolean') return a.aw;
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
export function pickRoad(profile: GroundGuideProfile, step: GoingStep | null, wet: boolean, roads: FeatureRoadHit[], radiusM: number): TrafficRoad | null {
  const none = (what: string): TrafficRoad => ({ caption: 'Rd', text: `No ${what} within ${fmtDistance(radiusM)}`, distanceM: null, compass: null, main: null, alt: null });
  // HeiGIT satellite (2024) cautions for vehicles only: never a raise, only "unpaved" / "narrow" beside the map's class.
  const onFoot = profile === 'dismounted' || profile === 'pack';
  const sat = (a: Record<string, unknown>): string => {
    if (onFoot) return '';
    const p = [a.sf === 'unpaved' ? 'Unpaved by Sat 2024' : null, a.wc === 1 ? 'Under 3.5 m by Sat' : null].filter(Boolean);
    return p.length ? ` · ${p.join(', ')}` : '';
  };
  const line = (h: FeatureRoadHit, extra: string, tag: string | null): TrafficRoad => ({
    caption: 'Rd',
    text: `${h.attrs.m ? 'MSR ' : ''}${roadName(h.attrs)}${extra}${sat(h.attrs)} · ${where(h)}`,
    distanceM: h.distanceM,
    compass: h.compass,
    main: roadRef(h, tag),
    alt: null,
  });
  switch (profile) {
    case 'tracked':
    case 'amphibious': {
      const tank = preferMsr(roads.filter((h) => h.attrs.k === 3));
      if (!tank) return none('Tankable Rd');
      const c = roadClass(tank.attrs);
      return line(tank, `${c !== null ? ` · Class ${c}` : ''}, Tankable`, `${c !== null ? `Class ${c} · ` : ''}Tankable`);
    }
    case 'dismounted':
    case 'pack': {
      // GO ground: name the road anyway and offer cross-country beside it; the user picks which to take.
      const r = roads[0] ? line(roads[0], '', weatherTag(roads[0].attrs)) : none('Rd or Tr');
      if (step !== 'go') return r;
      return { ...r, text: `${r.text} · Or GO Cross-Country`, crossCountry: 'go' };
    }
    case 'vessel':
    case 'rail':
    case 'oversnow':
    case 'exempt':
      return null;
    default: {
      const good = preferMsr(roads.filter((h) => allWeather(h.attrs)));
      const near = roads[0];
      if (!good && !near) return none('Rd');
      if (near && !allWeather(near.attrs) && (!good || near.distanceM < good.distanceM * 0.6)) {
        const fair = `Fair-Weather Rd ${where(near)}`;
        const main = roadRef(near, wet ? 'Fair-Weather · SLOW-GO After Rain' : 'Fair-Weather');
        if (!good) return { caption: 'Rd', text: wet ? `${fair}: SLOW-GO After Rain` : fair, distanceM: near.distanceM, compass: near.compass, main, alt: null };
        const all = `${good.attrs.m ? 'MSR ' : ''}${roadName(good.attrs)} ${where(good)}`;
        return {
          caption: 'Rd',
          text: wet ? `Use ${all} (All-Weather); ${fair} Is SLOW-GO` : `${fair} · ${all}`,
          distanceM: near.distanceM,
          compass: near.compass,
          main,
          alt: roadRef(good, weatherTag(good.attrs)),
        };
      }
      return line(good!, roadClass(good!.attrs) !== null ? ` · Class ${roadClass(good!.attrs)}` : '', weatherTag(good!.attrs));
    }
  }
}

/** "Class 70 · All-Weather", or just the weather when the class is not recorded. */
function weatherTag(a: Record<string, unknown>): string {
  const c = roadClass(a);
  return `${c !== null ? `Class ${c} · ` : ''}${allWeather(a) ? 'All-Weather' : 'Fair-Weather'}`;
}

/** A road as the card draws it: a shield (road number, else Road / Track), its name, a tag, and where it is. */
function roadRef(h: FeatureRoadHit, tag: string | null): TrafficRoadRef {
  const a = h.attrs;
  const n = typeof a.n === 'string' ? a.n.trim() : '';
  const r = typeof a.r === 'string' ? a.r.trim() : '';
  const aw = allWeather(a);
  return {
    shield: r || (aw ? 'Rd' : 'Tr'),
    name: n && n !== r ? n : r ? null : typeof a.t === 'string' ? titleCase(a.t.replace(/_/g, ' ')) : null,
    tag,
    msr: !!a.m,
    allWeather: aw,
    distanceM: h.distanceM,
    compass: h.compass,
    bearingDeg: h.bearingDeg,
  };
}

/** The landing-site line for a helicopter: slope band and wires from the class at the point, and soft ground after rain. */
export function landingLine(classCode: number | null | undefined, softAfterRain: boolean): TrafficRoad {
  const slope =
    classCode === 18 ? 'Slope 3 to 7°'
    : classCode === 19 ? 'Slope 7 to 15°: Too Steep'
    : classCode === 9 || classCode === 10 ? 'Too Steep'
    : 'Level';
  const wires = classCode === 33 || classCode === 48 ? 'Power Lines within 100 m' : 'No Wires Mapped';
  return { caption: 'Landing', text: `${slope} · ${wires}${softAfterRain ? ' · Soft After Rain' : ''}`, distanceM: null, compass: null, main: null, alt: null };
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
export function trafficKey(t: GroundGuideTraffic | null | undefined): string {
  if (!t) return '';
  return `${t.road?.text ?? ''}/${t.pending ? 1 : 0}/${t.pill ? 1 : 0}/${t.dual ? 1 : 0}/${t.block}/${t.where}/${t.open ? 1 : 0}/${t.tab}`;
}
