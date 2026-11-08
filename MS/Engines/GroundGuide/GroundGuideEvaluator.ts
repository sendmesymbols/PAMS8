/**
 * GroundGuideEvaluator.ts
 *
 * Pure verdict logic: terrain samples + compiled profile rules → verdict.
 * No DOM, no view, no I/O — so it is unit-testable and behaves the same in
 * every host application.
 */

import type {
  GroundGuideProfile,
  GroundGuideUnits,
  GroundGuideVerdict,
  GroundGuideVerdictKind,
  TerrainRules,
  TerrainSample,
} from './GroundGuideTypes';
import { NODATA_CLASS } from './GroundGuideTypes';

export interface CompiledProfile {
  name: GroundGuideProfile;
  exempt: boolean;
  /** 256 flags: 1 = no-go for this profile. */
  nogo: Uint8Array;
  /** 256 flags: 1 = deployable with warning. */
  caution: Uint8Array;
  /**
   * 256 flags: 1 = no-go ground the distance layer measures to (makes the ground beside it Marginal).
   * Thin lines in the bundle's `marginalIgnore` are no-go but not targets; a `marginal: false` mode has none.
   */
  target: Uint8Array;
}

export function compileProfile(rules: TerrainRules | null, name: GroundGuideProfile): CompiledProfile {
  const nogo = new Uint8Array(256);
  const caution = new Uint8Array(256);
  if (name === 'exempt') return { name, exempt: true, nogo, caution, target: nogo };

  const rule = rules?.profiles?.[name];
  if (!rule) {
    // No rule for this profile in the bundle — nothing is no-go rather than
    // everything, so a half-configured bundle never blocks placement.
    return { name, exempt: false, nogo, caution, target: nogo };
  }
  if (rule.requires && rule.requires.length > 0) {
    nogo.fill(1);
    for (const c of rule.requires) if (c >= 0 && c < 256) nogo[c] = 0;
  } else {
    for (const c of rule.nogo ?? []) if (c >= 0 && c < 256) nogo[c] = 1;
  }
  for (const c of rule.caution ?? []) if (c >= 0 && c < 256) caution[c] = 1;
  // Nodata is never a verdict on its own; the sample is treated as unknown.
  nogo[NODATA_CLASS] = 0;
  caution[NODATA_CLASS] = 0;
  const target = rule.marginal === false ? new Uint8Array(256) : nogo.slice();
  if (!rule.requires?.length) for (const c of rules?.marginalIgnore ?? []) if (c >= 0 && c < 256) target[c] = 0;
  return { name, exempt: false, nogo, caution, target };
}

export interface EvaluateOptions {
  nearThresholdM: number;
  partialFraction: number;
  /** Distance-layer cap in metres: a reading at or above it means "no no-go within this far". */
  farM?: number;
}

export function classLabel(rules: TerrainRules | null, code: number | null): string | null {
  if (code === null) return null;
  const def = rules?.classes?.[String(code)];
  return def?.label ?? def?.name ?? `class ${code}`;
}

const TITLE_MINOR = new Set(['a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);

/** Title Case for a headline: "Built-up area" becomes "Built-Up Area". Words already in capitals ("NO-GO") are left alone. */
export function titleCase(text: string): string {
  return text
    .split(' ')
    .map((w, i) => (i > 0 && TITLE_MINOR.has(w) ? w : w.replace(/(^|[-(])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())))
    .join(' ');
}

let distanceUnits: GroundGuideUnits = 'metric';

/** Units `fmtDistance` writes in. A display preference for the page, set from `groundGuide.units`. */
export function setDistanceUnits(units: GroundGuideUnits): void {
  distanceUnits = units;
}

export function getDistanceUnits(): GroundGuideUnits {
  return distanceUnits;
}

const YARDS_PER_METRE = 1.0936133;
const YARDS_PER_MILE = 1760;
const METRES_PER_NM = 1852;

/**
 * A distance in metres written in the chosen units: m then km (from 1 km); yd then mi (from 1 mile);
 * m then nm (from half a nautical mile, below which nobody quotes a naval distance in nm). One decimal
 * under 10 of the big unit, none above.
 */
export function fmtDistance(m: number): string {
  // Choose the unit from the rounded figure, so 1,609 m reads "1.0 mi", not "1760 yd", and 9,999 m "10 km", not "10.0 km".
  const big = (v: number) => (v >= 9.95 ? v.toFixed(0) : v.toFixed(1));
  switch (distanceUnits) {
    case 'imperial': {
      const yd = m * YARDS_PER_METRE;
      return Math.round(yd) >= YARDS_PER_MILE ? `${big(yd / YARDS_PER_MILE)} mi` : `${Math.round(yd)} yd`;
    }
    case 'nautical': {
      const nm = m / METRES_PER_NM;
      return nm >= 0.5 ? `${big(nm)} nm` : `${Math.round(m)} m`;
    }
    default:
      return Math.round(m) >= 1000 ? `${big(m / 1000)} km` : `${Math.round(m)} m`;
  }
}

export function profileLabel(rules: TerrainRules | null, name: GroundGuideProfile): string {
  return rules?.profiles?.[name]?.label ?? name;
}

/**
 * Aggregate samples into one verdict. Point symbols pass a single sample;
 * lines/areas pass many — then `fraction` drives `partial` vs `in`.
 */
export function evaluateSamples(
  samples: TerrainSample[],
  profile: CompiledProfile,
  opts: EvaluateOptions,
  rules: TerrainRules | null,
): GroundGuideVerdict {
  const label = profileLabel(rules, profile.name);
  const base = {
    profile: profile.name,
    profileLabel: label,
    detail: null as string | null,
    nearest: null as GroundGuideVerdict['nearest'],
    indicators: [] as GroundGuideVerdict['indicators'],
    classCode: null as number | null,
    className: null as string | null,
    distanceM: null as number | null,
    fraction: 0,
    samples: samples.length,
    unknown: 0,
  };

  if (profile.exempt) {
    return { ...base, verdict: 'exempt', message: 'Not Terrain-Bound' };
  }

  let known = 0;
  let inCount = 0;
  let cautionCount = 0;
  let minDist: number | null = null;
  const inHistogram = new Map<number, number>();
  const cautionHistogram = new Map<number, number>();
  let singleClass: number | null = null;

  for (const s of samples) {
    if (s.classCode === null || s.classCode === NODATA_CLASS) {
      base.unknown++;
      continue;
    }
    known++;
    singleClass = s.classCode;
    if (profile.nogo[s.classCode]) {
      inCount++;
      inHistogram.set(s.classCode, (inHistogram.get(s.classCode) ?? 0) + 1);
      continue;
    }
    if (profile.caution[s.classCode]) {
      cautionCount++;
      cautionHistogram.set(s.classCode, (cautionHistogram.get(s.classCode) ?? 0) + 1);
    }
    if (s.distanceM !== null && (minDist === null || s.distanceM < minDist)) {
      minDist = s.distanceM;
    }
  }

  if (known === 0) {
    return { ...base, verdict: 'unknown', message: 'No Terrain Data Yet' };
  }

  const fraction = inCount / known;
  base.fraction = fraction;
  base.distanceM = minDist;

  const dominant = (h: Map<number, number>): number | null => {
    let best: number | null = null;
    let bestN = -1;
    for (const [c, n] of h) if (n > bestN) ((best = c), (bestN = n));
    return best;
  };

  // Headline says what is wrong and why; `detail` says what it means for this
  // unit type and what is nearby. The guide refines both with a local search
  // for the nearest class of the opposite kind (GroundGuide._enrich).
  let verdict: GroundGuideVerdictKind;
  let message: string;
  let detail: string | null = null;
  let noneWithinM: number | undefined;
  const pct = (f: number) => Math.max(1, Math.round(f * 100));
  const unitName = titleCase(label);

  if (inCount > 0 && (samples.length === 1 || fraction >= 0.5)) {
    verdict = 'in';
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message =
      samples.length === 1
        ? `${titleCase(base.className ?? '')}: NO-GO for ${unitName}`
        : `Mostly in ${titleCase(base.className ?? '')} (${pct(fraction)}%): NO-GO for ${unitName}`;
  } else if (inCount > 0 && fraction >= opts.partialFraction) {
    verdict = 'partial';
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message = `Partially in ${titleCase(base.className ?? '')} (${pct(fraction)}%): NO-GO for ${unitName}`;
  } else if (inCount > 0) {
    // A sliver of the shape (below the partial threshold) touches no-go terrain.
    verdict = 'near';
    base.distanceM = 0;
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message = `Encroaching on ${titleCase(base.className ?? '')} (${pct(fraction)}%): NO-GO for ${unitName}`;
  } else if (cautionCount > 0) {
    verdict = 'caution';
    base.classCode = dominant(cautionHistogram);
    base.className = classLabel(rules, base.classCode);
    message =
      samples.length === 1
        ? `SLOW-GO: ${titleCase(base.className ?? '')}`
        : `SLOW-GO: ${titleCase(base.className ?? '')} (${pct(cautionCount / known)}% of Frontage)`;
    detail = `SLOW-GO terrain for ${label}`;
  } else if (minDist !== null && minDist < opts.nearThresholdM) {
    verdict = 'near';
    base.classCode = samples.length === 1 ? singleClass : null;
    base.className = classLabel(rules, base.classCode);
    message = minDist < 1 ? 'At Edge of NO-GO Terrain' : `${fmtDistance(minDist)} from NO-GO Terrain`;
    detail = `NO-GO for ${label}`;
  } else {
    verdict = 'ok';
    base.classCode = samples.length === 1 ? singleClass : null;
    base.className = classLabel(rules, base.classCode);
    message = base.className ? `Suitable: ${titleCase(base.className)}` : 'Suitable Posn';
    if (minDist !== null) {
      if (opts.farM !== undefined && minDist >= opts.farM) {
        noneWithinM = opts.farM;
        detail = `Clear of NO-GO terrain within ${fmtDistance(opts.farM)}`;
      } else {
        detail = `Nearest NO-GO terrain ${fmtDistance(minDist)} away`;
      }
    }
  }
  return { ...base, verdict, message, detail, ...(noneWithinM !== undefined && { noneWithinM }) };
}
