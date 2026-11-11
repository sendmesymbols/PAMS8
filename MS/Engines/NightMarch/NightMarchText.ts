/**
 * NightMarchText.ts
 *
 * Words and numbers for the Night March chart: bearings in degrees and / or mils (grid, and magnetic once the GMA is
 * set), distances, durations, the brief the cards show, and the chart as plain text (Copy as Text, `chartText()`).
 */

import { clock, hRel, toMils, type NightMarchChart, type NmEchelon, type NmTerrain } from './NightMarchRead';

export type NmUnits = 'deg' | 'mils' | 'both';

export const ECHELON_WORD: Record<NmEchelon, string> = { platoon: 'Pl', company: 'Coy', battalion: 'Bn' };
export const TERRAIN_WORD: Record<NmTerrain, string> = { plains: 'plains', desert: 'desert', mountain: 'mountain' };

export function num(n: number): string {
  return Math.round(n).toLocaleString('en-GB');
}
export function dist(m: number): string {
  if (!Number.isFinite(m)) return '?';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function dur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}
export const deg3 = (d: number): string => `${String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
export const mils4 = (d: number): string => String(toMils(d)).padStart(4, '0');

/**
 * A bearing as the compass man reads it: magnetic when the GMA is set ("069° M"), else grid ("072° G"). `units` adds or
 * swaps in mils. `short` drops the second unit for map labels.
 */
export function brgText(grid: number, mag: number | null, units: NmUnits, short = false): string {
  const b = mag ?? grid;
  const ref = mag === null ? 'G' : 'M';
  if (units === 'mils') return `${mils4(b)} mils ${ref}`;
  if (units === 'both' && !short) return `${deg3(b)} · ${mils4(b)} mils ${ref}`;
  return `${deg3(b)} ${ref}`;
}

export interface NmLightNow {
  /** Tonight: the share of the dark hours with moonlight, the moon's lit share. */
  moonlitShare: number;
  moonIllum: number;
  level: 'moonlight' | 'starlight';
  words: string;
}

/** What the views show: the chart and the context it was read in. */
export interface NightMarchBrief {
  chart: NightMarchChart;
  units: NmUnits;
  terrainKind: NmTerrain;
  gmaDeg: number | null;
  grids: { sp: string; fup: string; obj: string | null };
  tonight: NmLightNow | null;
  /** Elevation along the route (terrain only): metres from the SP and height. */
  profile: Array<{ chainM: number; elev: number }> | null;
  /** The light from leaving the SP to H every 10 min (when H is set): minutes after leaving and the level. */
  lightBand: Array<{ min: number; level: 'day' | 'twilight' | 'moonlight' | 'starlight' }> | null;
  dataLine: string | null;
  what: string;
}

/** The chart as plain text, the way it is written on a march card. */
export function chartLines(b: NightMarchBrief): string[] {
  const C = b.chart;
  const T = C.timing;
  const L: string[] = [];
  L.push(`NIGHT MARCH CHART — ${ECHELON_WORD[C.echelon]} · ${dist(C.lengthM)} · ${num(C.paces)} paces · ${dur(T.marchMin)} by night`);
  L.push(`SP ${b.grids.sp}   FUP ${b.grids.fup}${b.grids.obj ? `   Obj ${b.grids.obj}` : ''}`);
  L.push(C.gmaSet ? `Bearings magnetic (GMA ${b.gmaDeg! >= 0 ? `${b.gmaDeg}° E` : `${-b.gmaDeg!}° W`}); grid in brackets.` : 'Bearings GRID: the GMA is not set. Add it before the march.');
  L.push('');
  L.push('Leg  Bearing          Dist     Paces   Total   Time    Ends on');
  for (const lg of C.legs) {
    const brg = lg.magDeg === null ? `${deg3(lg.bearingDeg)} G` : `${deg3(lg.magDeg)} M (${deg3(lg.bearingDeg)} G)`;
    const when = T.hHourMin !== null ? clock(T.hHourMin - T.leaveBeforeH + lg.startMin) : hRel(-T.leaveBeforeH + lg.startMin);
    const ends = lg.toFup ? 'FUP' : lg.landmark ? `${lg.landmark.label}${lg.landmark.name ? ` ${lg.landmark.name}` : ''}` : '(no landmark: guide + light)';
    L.push(`${String(lg.i).padEnd(4)} ${brg.padEnd(16)} ${dist(lg.distM).padEnd(8)} ${num(lg.paces).padEnd(7)} ${num(lg.cumPaces).padEnd(7)} ${when.padEnd(7)} ${ends}`);
    for (const n of lg.notes) L.push(`       - ${n}`);
  }
  L.push('');
  L.push('TIMINGS');
  if (T.hHourMin !== null) L.push(`  Leave SP ${T.leaveSp} · arrive FUP ${T.arriveFup} · H ${T.h}`);
  else L.push(`  Leave SP at ${hRel(-T.leaveBeforeH)} · in the FUP by ${hRel(-T.fupMin)}`);
  L.push(`  March ${dur(T.moveMin)} moving (+${Math.round(T.spareFactor * 100)}% spare)${T.halts.length ? `, ${T.halts.length} halt${T.halts.length > 1 ? 's' : ''} of ${T.halts[0].min} min` : ''}; FUP ${T.fupMin} min${T.flatKmh ? `; ${T.flatKmh} km/h by night on ${b.terrainKind} (terrain not read)` : ''}`);
  L.push('');
  const F = C.fup;
  L.push('FUP AND START LINE');
  L.push(`  FUP ${dist(F.frontM)} x ${dist(F.depthM)}, axis ${F.axisMagDeg !== null ? `${deg3(F.axisMagDeg)} M` : `${deg3(F.axisDeg)} G`}${F.distToObjM !== null ? `, ${dist(F.distToObjM)} from the Obj` : ''}`);
  L.push(`  SL ${dist(F.frontM)} square to the axis${F.slFeature ? ` on ${F.slFeature}` : ', taped end to end'}; axis tape ${C.stores.axisTapeM} m beyond it`);
  L.push(`  Places: ${F.slots.map((s) => s.label).join(', ')}`);
  L.push(`  Marking stores: ${num(C.stores.tapeM)} m of tape (${C.stores.rolls} rolls; ${C.stores.rollsWithRoute} to tape the route too), ${C.stores.lights} lights, ${C.stores.guides} guides`);
  L.push('');
  L.push('CHECKS');
  for (const c of C.checks) L.push(`  ${c.tone === 'bad' ? '!!' : c.tone === 'warn' ? ' !' : 'ok'} ${c.text}`);
  if (b.tonight) L.push(`  Tonight: ${b.tonight.words}`);
  L.push('');
  L.push('120 paces = 100 m: check your own pace on the night ground. Times are estimates: adjust for load and the men.');
  return L;
}
