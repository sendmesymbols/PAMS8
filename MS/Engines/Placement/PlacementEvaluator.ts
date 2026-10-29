/**
 * PlacementEvaluator.ts
 *
 * Pure verdict logic: terrain samples + compiled profile rules → verdict.
 * No DOM, no view, no I/O — so it is unit-testable and behaves the same in
 * every host application.
 */

import type {
  PlacementProfile,
  PlacementVerdict,
  PlacementVerdictKind,
  TerrainRules,
  TerrainSample,
} from './PlacementTypes';
import { NODATA_CLASS } from './PlacementTypes';

export interface CompiledProfile {
  name: PlacementProfile;
  exempt: boolean;
  /** 256 flags: 1 = no-go for this profile. */
  nogo: Uint8Array;
  /** 256 flags: 1 = deployable with warning. */
  caution: Uint8Array;
}

export function compileProfile(rules: TerrainRules | null, name: PlacementProfile): CompiledProfile {
  const nogo = new Uint8Array(256);
  const caution = new Uint8Array(256);
  if (name === 'exempt') return { name, exempt: true, nogo, caution };

  const rule = rules?.profiles?.[name];
  if (!rule) {
    // No rule for this profile in the bundle — nothing is no-go rather than
    // everything, so a half-configured bundle never blocks placement.
    return { name, exempt: false, nogo, caution };
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
  return { name, exempt: false, nogo, caution };
}

export interface EvaluateOptions {
  nearThresholdM: number;
  partialFraction: number;
}

export function classLabel(rules: TerrainRules | null, code: number | null): string | null {
  if (code === null) return null;
  const def = rules?.classes?.[String(code)];
  return def?.label ?? def?.name ?? `class ${code}`;
}

function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km` : `${Math.round(m)} m`;
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
): PlacementVerdict {
  const base = {
    profile: profile.name,
    classCode: null as number | null,
    className: null as string | null,
    distanceM: null as number | null,
    fraction: 0,
    samples: samples.length,
    unknown: 0,
  };

  if (profile.exempt) {
    return { ...base, verdict: 'exempt', message: 'Not terrain-bound' };
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
    return { ...base, verdict: 'unknown', message: 'No terrain data here yet' };
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

  let verdict: PlacementVerdictKind;
  let message: string;

  if (inCount > 0 && (samples.length === 1 || fraction >= 0.5)) {
    verdict = 'in';
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message =
      samples.length === 1
        ? `No-go terrain: ${base.className}`
        : `Mostly in no-go terrain (${Math.round(fraction * 100)}%): ${base.className}`;
  } else if (inCount > 0 && fraction >= opts.partialFraction) {
    verdict = 'partial';
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message = `Partly in no-go terrain (${Math.round(fraction * 100)}%): ${base.className}`;
  } else if (inCount > 0) {
    // A sliver of the shape (below the partial threshold) touches no-go terrain.
    verdict = 'near';
    base.distanceM = 0;
    base.classCode = dominant(inHistogram);
    base.className = classLabel(rules, base.classCode);
    message = `Touches no-go terrain (${Math.max(1, Math.round(fraction * 100))}%): ${base.className}`;
  } else if (cautionCount > 0) {
    verdict = 'caution';
    base.classCode = dominant(cautionHistogram);
    base.className = classLabel(rules, base.classCode);
    message =
      samples.length === 1
        ? `Caution: ${base.className}`
        : `Caution: ${base.className} on ${Math.round((cautionCount / known) * 100)}% of the shape`;
  } else if (minDist !== null && minDist < opts.nearThresholdM) {
    verdict = 'near';
    base.classCode = samples.length === 1 ? singleClass : null;
    base.className = classLabel(rules, base.classCode);
    message = minDist < 1 ? 'At the edge of no-go terrain' : `${fmtDistance(minDist)} from no-go terrain`;
  } else {
    verdict = 'ok';
    base.classCode = samples.length === 1 ? singleClass : null;
    base.className = classLabel(rules, base.classCode);
    message = base.className ? `Deployable: ${base.className}` : 'Deployable';
  }
  return { ...base, verdict, message };
}
