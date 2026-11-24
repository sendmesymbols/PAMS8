/**
 * GroundGuideIpbAirspace.ts
 *
 * Airspace control measures and gun-target lines over the IPB air avenues (tab 4 Air; built 2026-11-24). Pure: no DOM,
 * no view, no I/O (`node tools/ipb-test/airspace.mjs`).
 *
 * The air avenues (GroundGuideIpbAir) are least-cost flights over the ground. This reads what the planner has drawn over
 * that ground and says what each flight runs into:
 *   - ZONES: the 2525D airspace control symbols on the map (ROZ, UA ROZ, A2A ROZ, HIDACZ, ACA, and the AD engagement zones
 *     WEZ / FEZ / JEZ / MEZ / LOMEZ / HIMEZ / SHORADEZ; the table is IpbDoctrine `airspace.symbols`), the share of each
 *     avenue inside each, and what that means for the side that flies it. A ROZ is airspace reserved for specific
 *     activities (artillery launch and target areas, UAS launch and recovery, "weapon free" zones) in which other users
 *     are restricted (FM 3-09 2024 B-92, p B-27); an ACA is a block of airspace in a target area in which friendly aircraft
 *     are reasonably safe from friendly surface fires (FM 3-09 B-27 / B-84, pp B-9, B-26); a HIDACZ holds a concentration
 *     of weapons and airspace users (JP 3-52, not on disk: wording to confirm); the engagement zones are where own AD
 *     engages (JP 3-01, not on disk). The other side's measures do not bind this flight: his AD zones are a threat like
 *     his AD sites, his ROZ / HIDACZ show where his guns and UAS work.
 *   - GUN-TARGET LINES: from own gun areas (PAA symbols; artillery, mortar and rocket unit symbols with a catalogue range)
 *     to the targets own fire will fall on (own attack: the objective and his Posns in range; his attack: the TAIs on his
 *     avenues and the Threat marker). The PAA is the base for gun-target lines for lateral deconfliction and areas for
 *     aircraft to avoid (FM 3-09 B-60, p B-20); separation is lateral, in altitude or in time, set with the ALO (B-28, p B-9;
 *     no figure in the book). An avenue that crosses a GTL is flagged with the crossing point and its distance from the
 *     guns; one that passes within `gtl.nearM` of a GTL is named near it (E: a margin to look at, not a separation figure).
 */

import type { MercXY } from './GroundGuideTypes';

export type AspZoneKind = 'roz' | 'rozUa' | 'rozA2a' | 'hidacz' | 'aca' | 'wez' | 'fez' | 'jez' | 'mez' | 'lomez' | 'himez' | 'shoradez';
export type AspEffect = 'restricted' | 'coordinate' | 'safe' | 'ownAd' | 'threat' | 'his';

export interface AspRules {
  symbols: Record<string, { kind: AspZoneKind; label: string }>;
  gtl: { nearM: number; maxLines: number; paaRangeM: number; paaMinM: number; sampleM: number };
}
export interface AspZoneIn {
  id: string;
  key: string;
  label: string;
  /** Who drew it (the symbol's standard identity). */
  side: 'own' | 'enemy';
  ring: MercXY[];
}
export interface AspGunIn {
  id: string;
  label: string;
  at: MercXY;
  /** Minimum and maximum range of its fire, m. */
  minM: number;
  maxM: number;
  kind: 'paa' | 'unit';
}
export interface AspTargetIn {
  id: string;
  label: string;
  at: MercXY;
  kind: 'objective' | 'posn' | 'tai' | 'threat';
}
export interface AspRouteIn {
  id: string;
  rank: number;
  to: string;
  line: MercXY[];
  lengthM: number;
}
export interface AspArgs {
  /** Whose flight: own aircraft to the objective, or his into own depth. */
  side: 'own' | 'enemy';
  /** Web Mercator metres per ground metre here (cosh of the latitude's Mercator y / R). */
  k: number;
  routes: AspRouteIn[];
  zones: AspZoneIn[];
  /** Own guns: the only ones whose lines are known. */
  guns: AspGunIn[];
  targets: AspTargetIn[];
  rules: AspRules;
}

export interface AspZoneOut {
  id: string;
  key: string;
  kind: AspZoneKind;
  label: string;
  side: 'own' | 'enemy';
  ring: MercXY[];
  effect: AspEffect;
  /** What the effect means for this flight, and the book. */
  why: string;
  src: string;
  /** Each avenue's share inside, %, with the first entry point along it, m (0 when the avenue starts inside). */
  routes: Array<{ id: string; pct: number; alongM: number }>;
}
export interface AspGtl {
  id: string;
  n: number;
  gun: string;
  target: string;
  from: MercXY;
  to: MercXY;
  lengthM: number;
  crossings: Array<{ route: string; at: MercXY; alongRouteM: number; fromGunM: number }>;
  /** Avenues passing within `gtl.nearM` without crossing: the nearest distance, m. */
  near: Array<{ route: string; at: MercXY; distM: number }>;
}
export interface AspRouteOut {
  id: string;
  /** Shares of its length inside zones of each effect, %. */
  pct: Record<AspEffect, number>;
  /** The zones it runs through, worst first. */
  zones: string[];
  gtlCrossings: string[];
  gtlNear: string[];
  /** One line: "ROZ 1 38 % restricted; crosses GTL 2 at 3.8 km from the guns". */
  text: string;
}
export interface AspResult {
  side: 'own' | 'enemy';
  zones: AspZoneOut[];
  gtls: AspGtl[];
  routes: AspRouteOut[];
  /** How many own guns and targets the lines were drawn from. */
  guns: number;
  targets: number;
  notes: string[];
}

const EFFECT_ORDER: AspEffect[] = ['restricted', 'threat', 'coordinate', 'ownAd', 'his', 'safe'];
const AD_KINDS = new Set<AspZoneKind>(['wez', 'fez', 'jez', 'mez', 'lomez', 'himez', 'shoradez']);
const RESTRICTED_KINDS = new Set<AspZoneKind>(['roz', 'rozUa', 'rozA2a']);

export function airspaceRulesFrom(doc: any): AspRules {
  const A = doc?.airspace ?? {};
  const symbols: AspRules['symbols'] = {};
  for (const [key, v] of Object.entries<any>(A.symbols?.table ?? {})) if (v?.kind) symbols[key] = { kind: v.kind, label: String(v.label ?? v.kind) };
  const g = A.gtl ?? {};
  return {
    symbols,
    gtl: {
      nearM: Number(g.nearM) || 500,
      maxLines: Number(g.maxLines) || 16,
      paaRangeM: Number(g.paaRangeM) || 14596,
      paaMinM: Number(g.paaMinM) || 1500,
      sampleM: Number(g.sampleM) || 50,
    },
  };
}

const km = (m: number): string => (m >= 950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** What a zone of this kind, drawn by `zoneSide`, means for a flight of `flier`. */
export function zoneEffect(kind: AspZoneKind, zoneSide: 'own' | 'enemy', flier: 'own' | 'enemy'): { effect: AspEffect; why: string; src: string } {
  const theirs = zoneSide !== flier;
  const who = flier === 'own' ? 'own' : 'En';
  if (theirs) {
    if (AD_KINDS.has(kind)) return { effect: 'threat', why: `${zoneSide === 'own' ? 'own' : 'En'} AD engagement zone: ${who} aircraft are engaged here (as ${zoneSide === 'own' ? 'own' : 'En'} AD sites)`, src: 'JP 3-01 (engagement zones; not on disk)' };
    if (kind === 'aca') return { effect: 'his', why: `${zoneSide === 'own' ? 'own' : 'En'} ACA: where ${zoneSide === 'own' ? 'own' : 'En'} aircraft are kept safe from ${zoneSide === 'own' ? 'own' : 'En'} surface fires; it does not bind ${who} flight`, src: 'FM 3-09 B-27, p B-9' };
    if (kind === 'hidacz') return { effect: 'his', why: `${zoneSide === 'own' ? 'own' : 'En'} HIDACZ: a concentration of ${zoneSide === 'own' ? 'own' : 'En'} weapons and airspace users; ${who} flight is not bound, but fires are dense there`, src: 'JP 3-52 (not on disk)' };
    return { effect: 'his', why: `${zoneSide === 'own' ? 'own' : 'En'} ${kind === 'rozUa' ? 'UA ROZ: UAS launch / recovery' : kind === 'rozA2a' ? 'A2A ROZ' : 'ROZ: artillery launch / target areas, UAS, weapon-free zone'}; it does not bind ${who} flight`, src: 'FM 3-09 B-92, p B-27' };
  }
  if (RESTRICTED_KINDS.has(kind)) return { effect: 'restricted', why: `${who} ${kind === 'rozUa' ? 'UA ROZ' : kind === 'rozA2a' ? 'A2A ROZ' : 'ROZ'}: airspace reserved for specific activities (artillery launch and target areas, UAS launch and recovery, weapon-free zones); other users restricted: route round it or have it opened`, src: 'FM 3-09 B-92, p B-27' };
  if (kind === 'hidacz') return { effect: 'coordinate', why: `${who} HIDACZ: a concentration of weapons and airspace users; entry needs the controlling HQ's clearance`, src: 'JP 3-52 (not on disk)' };
  if (kind === 'aca') return { effect: 'safe', why: `${who} ACA: a block of airspace in a target area in which ${who} aircraft are reasonably safe from ${who} surface fires`, src: 'FM 3-09 B-27, p B-9' };
  return { effect: 'ownAd', why: `${who} ${kind.toUpperCase()}: ${who} AD engages here; fly the routes and times its weapons-control status allows`, src: 'JP 3-01 (engagement zones; not on disk)' };
}

function inRing(x: number, y: number, r: MercXY[]): boolean {
  let inside = false;
  const n = r.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = r[i][1], yj = r[j][1];
    if (yi > y !== yj > y) {
      const xi = r[i][0];
      if (x < ((r[j][0] - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Points every `stepM` along a line (Mercator units, k-corrected), each with its distance along, m. */
function sample(line: MercXY[], k: number, stepM: number): Array<{ p: MercXY; alongM: number }> {
  const out: Array<{ p: MercXY; alongM: number }> = [];
  let along = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) / k;
    const n = Math.max(1, Math.ceil(L / stepM));
    for (let t = 0; t < n; t++) out.push({ p: [a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n], alongM: along + (L * t) / n });
    along += L;
  }
  const e = line[line.length - 1];
  if (e) out.push({ p: e, alongM: along });
  return out;
}

/** Where segment a-b crosses c-d, as the fraction along a-b, or null. */
function segX(a: MercXY, b: MercXY, c: MercXY, d: MercXY): number | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

function pointSegDist(p: MercXY, a: MercXY, b: MercXY): { d: number; at: MercXY } {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const L2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2));
  const at: MercXY = [a[0] + vx * t, a[1] + vy * t];
  return { d: Math.hypot(p[0] - at[0], p[1] - at[1]), at };
}

export function airspaceRead(a: AspArgs): AspResult {
  const R = a.rules;
  const k = a.k || 1;
  const notes: string[] = [];
  const empty = (): Record<AspEffect, number> => ({ restricted: 0, coordinate: 0, safe: 0, ownAd: 0, threat: 0, his: 0 });
  const samples = new Map<string, Array<{ p: MercXY; alongM: number }>>();
  for (const r of a.routes) samples.set(r.id, sample(r.line, k, R.gtl.sampleM));

  // Zones: the share of each avenue inside.
  const zones: AspZoneOut[] = [];
  for (const z of a.zones) {
    const sym = R.symbols[z.key];
    if (!sym || z.ring.length < 3) continue;
    const e = zoneEffect(sym.kind, z.side, a.side);
    const routes: AspZoneOut['routes'] = [];
    for (const r of a.routes) {
      const S = samples.get(r.id) ?? [];
      let n = 0, first = -1;
      for (const s of S) {
        if (inRing(s.p[0], s.p[1], z.ring)) {
          n++;
          if (first < 0) first = s.alongM;
        }
      }
      if (n) routes.push({ id: r.id, pct: Math.max(1, Math.round((100 * n) / Math.max(1, S.length))), alongM: Math.round(first) });
    }
    zones.push({ id: z.id, key: z.key, kind: sym.kind, label: z.label || sym.label, side: z.side, ring: z.ring, effect: e.effect, why: e.why, src: e.src, routes });
  }
  zones.sort((p, q) => EFFECT_ORDER.indexOf(p.effect) - EFFECT_ORDER.indexOf(q.effect) || q.routes.length - p.routes.length);

  // Gun-target lines: own guns to the targets in range, nearest pairs first.
  const pairs: Array<{ g: AspGunIn; t: AspTargetIn; L: number }> = [];
  for (const g of a.guns) for (const t of a.targets) {
    const L = Math.hypot(t.at[0] - g.at[0], t.at[1] - g.at[1]) / k;
    if (L >= g.minM && L <= g.maxM) pairs.push({ g, t, L });
  }
  pairs.sort((p, q) => p.L - q.L);
  const gtls: AspGtl[] = [];
  for (const { g, t, L } of pairs.slice(0, R.gtl.maxLines)) {
    const n = gtls.length + 1;
    const line: AspGtl = { id: `GTL ${n}`, n, gun: g.label, target: t.label, from: g.at, to: t.at, lengthM: Math.round(L), crossings: [], near: [] };
    for (const r of a.routes) {
      let crossed = false;
      let along = 0;
      for (let i = 0; i + 1 < r.line.length; i++) {
        const p = r.line[i], q = r.line[i + 1];
        const segL = Math.hypot(q[0] - p[0], q[1] - p[1]) / k;
        const f = segX(p, q, g.at, t.at);
        if (f !== null) {
          const at: MercXY = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
          line.crossings.push({ route: r.id, at, alongRouteM: Math.round(along + segL * f), fromGunM: Math.round(Math.hypot(at[0] - g.at[0], at[1] - g.at[1]) / k) });
          crossed = true;
          break;
        }
        along += segL;
      }
      if (crossed) continue;
      let best: { d: number; at: MercXY } | null = null;
      for (const s of samples.get(r.id) ?? []) {
        const c = pointSegDist(s.p, g.at, t.at);
        if (!best || c.d < best.d) best = c;
      }
      if (best && best.d / k <= R.gtl.nearM) line.near.push({ route: r.id, at: best.at, distM: Math.round(best.d / k) });
    }
    gtls.push(line);
  }

  // Per avenue.
  const routes: AspRouteOut[] = a.routes.map((r) => {
    const pct = empty();
    const S = samples.get(r.id) ?? [];
    const zs: Array<{ z: AspZoneOut; pct: number }> = [];
    for (const e of EFFECT_ORDER) {
      let n = 0;
      for (const s of S) if (zones.some((z) => z.effect === e && inRing(s.p[0], s.p[1], z.ring))) n++;
      pct[e] = n ? Math.max(1, Math.round((100 * n) / Math.max(1, S.length))) : 0; // a touch is 1 %, never 0
    }
    for (const z of zones) {
      const q = z.routes.find((x) => x.id === r.id);
      if (q) zs.push({ z, pct: q.pct });
    }
    const crossings = gtls.filter((g) => g.crossings.some((c) => c.route === r.id));
    const near = gtls.filter((g) => g.near.some((c) => c.route === r.id));
    const parts: string[] = [];
    for (const { z, pct: p } of zs) parts.push(`${z.label} ${p} % ${z.effect === 'ownAd' ? 'own AD zone' : z.effect === 'his' ? 'other side\'s measure' : z.effect}`);
    for (const g of crossings) {
      const c = g.crossings.find((x) => x.route === r.id)!;
      parts.push(`crosses ${g.id} (${g.gun} → ${g.target}) ${km(c.alongRouteM)} out, ${km(c.fromGunM)} from the guns`);
    }
    for (const g of near) {
      const c = g.near.find((x) => x.route === r.id)!;
      parts.push(`within ${km(c.distM)} of ${g.id}`);
    }
    return { id: r.id, pct, zones: zs.map((x) => x.z.id), gtlCrossings: crossings.map((g) => g.id), gtlNear: near.map((g) => g.id), text: parts.length ? parts.join('; ') : 'clear of the measures and lines drawn' };
  });

  if (!a.zones.length) notes.push('No airspace control symbol on the map over the area (ROZ, HIDACZ, ACA, engagement zones): draw them to read them.');
  else if (!zones.length) notes.push('The airspace symbols on the map lie outside the area read.');
  if (!a.guns.length) notes.push('No own gun area (PAA) or artillery / mortar / rocket symbol with a range on the map: no gun-target line.');
  else if (!a.targets.length) notes.push(`${a.guns.length} own gun${a.guns.length > 1 ? 's' : ''} read, but no target for the lines (${a.side === 'own' ? 'the objective or the En Posns' : 'TAIs on the En avenues, the Threat marker'}).`);
  else if (!gtls.length) notes.push(`${a.guns.length} own gun${a.guns.length > 1 ? 's' : ''} and ${a.targets.length} target${a.targets.length > 1 ? 's' : ''}, none within range of another: no gun-target line.`);
  if (gtls.some((g) => g.crossings.length)) notes.push(a.side === 'own' ? 'An avenue crossing a gun-target line needs separation from the guns: lateral, in altitude or in time, set with the ALO (an informal ACA, FM 3-09 B-28); the book gives no figure.' : 'Own guns firing on those targets shoot across the En avenue: own aircraft engaging the En there keep off the line while the guns fire (FM 3-09 B-60).');
  if (gtls.length) notes.push(`Lines are straight gun to target on the map; a round's path is higher and wider than the line (max ordinate: FM 3-09 3-102). The PAA's range is ${a.guns.some((g) => g.kind === 'paa') ? `taken as ${km(R.gtl.paaRangeM)} (155 mm how, IBB p 120)` : 'its unit\'s catalogue range'}.`);
  return { side: a.side, zones, gtls, routes, guns: a.guns.length, targets: a.targets.length, notes };
}
