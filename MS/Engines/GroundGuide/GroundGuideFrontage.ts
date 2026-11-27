/**
 * GroundGuideFrontage.ts
 *
 * The frontage of the objective the Extended View's approaches end on, and the assault frontage onto it, by side
 * (own / En), echelon and ground (user, 24 Nov 2026: "make sure desert, day night, mountainous, and other frontages are
 * correct ... cite the rule, book and page"). Pure: no DOM, no view, no I/O (Node: `node tools/ipb-test/frontage.mjs`).
 *
 * Every figure is a row of OcokaDoctrine `frontage.rows` (the same rows the Plan Builder holds plans to), each with its
 * book and page; `frontage.objective` says which row stands for which side, echelon and ground:
 *   - own: a Coy, Pl or Sec is never extended on any ground (IBB S59 para 6 b p 326); a Bn holds the normal 3000-5000 m
 *     in the plains (IBB S53 para 4 c p 277), IBB's extended two-up row in the desert and the mountains (DW pp 24, 56;
 *     MW pp 148, 150: extended ground, no figure printed), IBB Annex V on a canal or ditch; a Bde 10-12 km (OOW1), 8-10 km
 *     on a ditch cum bund (GSP p 119);
 *   - En: his own figures (IDD p 3 on the bund; IC s113 / s114 Foxland elsewhere: the Sec, Pl, Coy and Bde normal
 *     frontages of s114 para 7 p 670; the Bn and Div of s113 (para 20 a (4) p 663, para 4 c p 658), denser than s114's
 *     7-10 km / 80-120 km and held against a deliberate attack: within IC the two differ, the denser taken, safety first),
 *     the own row standing in (and saying so) where none is printed for him;
 *   - the assault: the books' figures are night figures (IBB S47 para 17 a p 248; GSP p 86; IC s114 p 684); by day wider
 *     with no figure (OOW2 s9 para 2 c p 36), twice in the desert (DW s12 para 18 a p 47), narrower in mountains (MW p 79).
 * The ground at the objective is read in the order mountains, an obstacle in front, desert, plains (IpbTemplates
 * mountainTest / desertTest and `frontage.objective.ground.obstacleTest`, the same figures as PlanDoctrine terrain.detect).
 */

export type GroundKind = 'plains' | 'obstacle' | 'desert' | 'mountain';
export type FrontageSize = 'min' | 'mid' | 'max';
export type FrontageSide = 'own' | 'en';

/** The ground under the objective: grid pixels (y down), metres per pixel, class and elevation per pixel. */
export interface FrontageGround {
  w: number;
  h: number;
  res: number;
  cls: Uint8Array;
  elev: Float32Array;
}

export interface GroundTests {
  mountain: { riseM: number; withinM: number };
  desert: { classes: number[]; withinM: number; share: number };
  obstacle: { classes: number[]; withinM: number; share: number };
}

export interface ObjFrontage {
  frontageM: number;
  depthM: number;
  /** The row of OcokaDoctrine frontage.rows it comes from, and that row's book and page. */
  row: string;
  src: string;
  whose: FrontageSide;
  ech: string;
  kind: GroundKind;
  /** No row is printed for this side, echelon and ground: another side's (or ground's) row stands in. */
  standIn: boolean;
  /** One line: why this row on this ground (the rule, book and page). */
  why: string;
}

export interface AssaultFrontage {
  /** The night figure, metres: [low, high] (the same when the book prints one figure). */
  nightM: [number, number];
  row: string;
  src: string;
  whose: FrontageSide;
  ech: string;
  kind: GroundKind;
  /** By day on this ground, in words with the book and page. */
  day: string;
  /** No figure is printed for the attacker's echelon: the row of the largest echelon below it stands in (`row`). */
  standIn: string | null;
}

const ECH_WORD: Record<string, string> = { '13': 'Sec', '14': 'Pl', '15': 'Coy', '16': 'Bn', '18': 'Bde', '21': 'Div' };
const UP: Record<string, string> = { '13': '14', '14': '15', '15': '16', '16': '18', '18': '21' };

/** The echelon one up (he attacks a position at 3 : 1, one level up). */
export const echelonUp = (ech: string): string | null => UP[ech] ?? null;

const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const range = (v: unknown): [number, number] | null => {
  if (Array.isArray(v) && v.length >= 2 && v.every((x) => Number.isFinite(Number(x)))) return [Number(v[0]), Number(v[1])];
  if (Number.isFinite(Number(v)) && v !== null && v !== '') return [Number(v), Number(v)];
  return null;
};
const pick = (r: [number, number], size: FrontageSize): number => (size === 'min' ? r[0] : size === 'max' ? r[1] : (r[0] + r[1]) / 2);

/** The ground tests from the doctrine (IpbTemplates mountainTest / desertTest; OcokaDoctrine frontage.objective.ground). */
export function groundTestsFrom(ocoka: any, templates: any): GroundTests {
  const M = templates?.mountainTest ?? {}, D = templates?.desertTest ?? {}, O = ocoka?.frontage?.objective?.ground?.obstacleTest ?? {};
  return {
    mountain: { riseM: num(M.riseM, 400), withinM: num(M.withinM, 5000) },
    desert: { classes: Array.isArray(D.classes) ? D.classes.map(Number) : [12, 13, 14, 16], withinM: num(D.withinM, 5000), share: num(D.share, 0.5) },
    obstacle: { classes: Array.isArray(O.classes) ? O.classes.map(Number) : [20, 21, 22, 24, 25], withinM: num(O.withinM, 1500), share: num(O.share, 0.5) },
  };
}

/**
 * The ground at an objective: grid pixel (x, y), the direction its front faces (a unit vector in grid pixels, toward the
 * mover) and its frontage (for the obstacle test across the front).
 */
export function groundKindAt(g: FrontageGround, x: number, y: number, front: [number, number], frontageM: number, t: GroundTests): { kind: GroundKind; why: string } {
  const inG = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < g.w && py < g.h;
  // Mountains: the rise within the radius.
  {
    const r = t.mountain.withinM / g.res;
    const st = Math.max(1, Math.floor(r / 25));
    let lo = Infinity, hi = -Infinity;
    for (let yy = Math.floor(y - r); yy <= y + r; yy += st)
      for (let xx = Math.floor(x - r); xx <= x + r; xx += st) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r || !inG(xx, yy)) continue;
        const e = g.elev[yy * g.w + xx];
        if (e === e) ((lo = Math.min(lo, e)), (hi = Math.max(hi, e)));
      }
    if (hi - lo >= t.mountain.riseM) return { kind: 'mountain', why: `the ground within ${(t.mountain.withinM / 1000).toFixed(0)} km rises ${Math.round(hi - lo)} m (mountains: ${t.mountain.riseM} m or more, E)` };
  }
  // An obstacle across its front: rays every 1/14 of the front, out to the reach, each hitting a canal, drain or bund.
  {
    const L = Math.hypot(front[0], front[1]) || 1;
    const fx = front[0] / L, fy = front[1] / L, px = -fy, py = fx;
    const cls = new Set(t.obstacle.classes);
    const n = 15, reach = t.obstacle.withinM / g.res, half = frontageM / 2 / g.res;
    let hits = 0, rays = 0;
    for (let k = 0; k < n; k++) {
      const off = -half + (2 * half * k) / (n - 1);
      const ox = x + px * off, oy = y + py * off;
      if (!inG(Math.floor(ox), Math.floor(oy))) continue;
      rays++;
      for (let s = 0; s <= reach; s += 1) {
        const xx = Math.floor(ox + fx * s), yy = Math.floor(oy + fy * s);
        if (!inG(xx, yy)) break;
        if (cls.has(g.cls[yy * g.w + xx])) {
          hits++;
          break;
        }
      }
    }
    if (rays && hits / rays >= t.obstacle.share) return { kind: 'obstacle', why: `a canal, drain or bund across ${Math.round((100 * hits) / rays)} % of its front within ${(t.obstacle.withinM / 1000).toFixed(1)} km (${Math.round(100 * t.obstacle.share)} % or more, E)` };
  }
  // The desert: the share of sand, dunes and desert scrub within the radius.
  {
    const r = t.desert.withinM / g.res;
    const st = Math.max(1, Math.floor(r / 25));
    const cls = new Set(t.desert.classes);
    let all = 0, des = 0;
    for (let yy = Math.floor(y - r); yy <= y + r; yy += st)
      for (let xx = Math.floor(x - r); xx <= x + r; xx += st) {
        if ((xx - x) ** 2 + (yy - y) ** 2 > r * r || !inG(xx, yy)) continue;
        const k = g.cls[yy * g.w + xx];
        if (k === 255 || k === 0) continue;
        all++;
        if (cls.has(k)) des++;
      }
    if (all && des / all >= t.desert.share) return { kind: 'desert', why: `${Math.round((100 * des) / all)} % of the ground within ${(t.desert.withinM / 1000).toFixed(0)} km is sand, dunes or desert scrub (${Math.round(100 * t.desert.share)} % or more, E)` };
  }
  return { kind: 'plains', why: 'no mountains, obstacle in front or desert round it' };
}

/** A side's entry for an echelon on a ground: { row, field?, standIn? } or null. */
function entryOf(block: any, ech: string, kind: GroundKind): { row: string; field: string; standIn: boolean } | null {
  const by = block?.[ech];
  if (!by) return null;
  const v = by[kind] ?? by.any;
  if (!v) return null;
  if (typeof v === 'string') return { row: v, field: 'frontageM', standIn: false };
  return { row: String(v.row), field: String(v.field ?? 'frontageM'), standIn: !!v.standIn };
}

const rowOf = (ocoka: any, unit: string): any => (ocoka?.frontage?.rows ?? []).find((r: any) => r.unit === unit) ?? null;

/** Why this row on this ground, in a line with the rule, book and page. */
function whyOf(whose: FrontageSide, ech: string, kind: GroundKind, standIn: boolean): string {
  if (whose === 'en') {
    if (standIn) return `no En ${ECH_WORD[ech] ?? ech} frontage is printed${kind === 'obstacle' ? '' : ' off the bund'}: the own row stands in`;
    if (kind === 'obstacle') return ech === '21' ? 'his Div on an anti-tank obstacle, 60-80 km (IC s113 para 4 c (2) p 658, Foxland)' : ech === '16' ? 'his Bn on the bund (IDD p 3; IC s113 para 20 a (5) p 663: up to 6000 m; IC s114 para 22 b pp 676-677: 5, 5.5 or 7-10 km by pattern)' : 'his defence on the bund (IDD p 3)';
    if (ech === '16') return kind === 'mountain' ? 'his mountain Bn (IC s113 para 21 a (1) p 665, Foxland)' : 'his Bn against a deliberate attack (IC s113 para 20 a (4) p 663, Foxland); IC s114 para 7 p 670 prints his normal Bn frontage 7-10 km: within IC the two differ, the denser taken (safety first)';
    if (ech === '21') return 'his compact Div sector (IC s113 para 4 c (1) p 658, Foxland); IC s114 para 7 p 670 prints 80-120 km: within IC the two differ, the denser taken (safety first)';
    return `his normal ${ECH_WORD[ech] ?? ech} frontage (IC s114 para 7 p 670, Foxland)`;
  }
  if (ech === '13' || ech === '14' || ech === '15') return `a ${ECH_WORD[ech]} frontage is never extended, on any ground (IBB S59 para 6 b p 326)`;
  if (ech === '16') {
    if (kind === 'desert') return 'the desert is extended ground (DW p 24, p 56): IBB\'s extended two-up row, no desert figure printed';
    if (kind === 'mountain') return 'frontages in mountains are generally large (MW p 148, p 150): IBB\'s extended two-up row, no mountain figure printed';
    if (kind === 'obstacle') return 'on a canal or ditch (IBB Annex V pp 483-485)';
    return 'a Bn in the plains normally holds 3000-5000 m (IBB S53 para 4 c p 277)';
  }
  if (ech === '18') return kind === 'obstacle' ? 'a Bde on a ditch cum bund (GSP s26 p 119)' : kind === 'desert' || kind === 'mountain' ? `a Bde 10-12 km (OOW1 Annexes B-D), a yardstick; on ${kind === 'desert' ? 'the desert' : 'mountains'} extended, no figure printed (${kind === 'desert' ? 'DW p 56' : 'MW p 148'})` : 'a Bde 10-12 km (OOW1 Annexes B-D pp 103-105), a yardstick';
  return 'an Inf Div on two or three axes (OOW1 Annexes C-D pp 104-105), a guideline';
}

/** The objective's frontage x depth by side, echelon and ground; null when no row is set for the echelon. */
export function objectiveFrontage(ocoka: any, whose: FrontageSide, ech: string | null, kind: GroundKind, size: FrontageSize = 'mid'): ObjFrontage | null {
  if (!ech) return null;
  const e = entryOf(ocoka?.frontage?.objective?.[whose], ech, kind);
  if (!e) return null;
  const r = rowOf(ocoka, e.row);
  const fr = r ? range(r[e.field] ?? r.frontageM) : null;
  if (!r || !fr) return null;
  const dr = range(r.depthM) ?? [0, 0];
  return { frontageM: pick(fr, size), depthM: pick(dr, size), row: r.unit, src: String(r.src ?? ''), whose, ech, kind, standIn: e.standIn, why: whyOf(whose, ech, kind, e.standIn) };
}

/**
 * The attacker's assault frontage by night and what the books say by day, on this ground. Where no figure is printed for
 * the attacker's echelon (his Bde: IC s114 prints Bn, Coy and Pl; an own Div), the largest echelon below it with a row
 * stands in and says so. Null when none has a row.
 */
export function assaultFrontage(ocoka: any, whose: FrontageSide, ech: string | null, kind: GroundKind): AssaultFrontage | null {
  if (!ech) return null;
  const A = ocoka?.frontage?.objective?.assault;
  const order = ['13', '14', '15', '16', '18', '21'];
  let use = ech, e = entryOf(A?.[whose], ech, kind);
  for (let i = order.indexOf(ech) - 1; !e && i >= 0; i--) ((use = order[i]), (e = entryOf(A?.[whose], use, kind)));
  if (!e) return null;
  const r = rowOf(ocoka, e.row);
  const fr = r ? range(r.frontageM) : null;
  if (!r || !fr) return null;
  const day = whose === 'en' ? String(A?.day?.en ?? '') : String(A?.day?.[kind] ?? A?.day?.plains ?? '');
  const standIn = use !== ech ? `no ${whose === 'en' ? 'En ' : ''}${ECH_WORD[ech] ?? ech} assault frontage is printed: the ${ECH_WORD[use] ?? use}'s stands in` : null;
  return { nightM: fr, row: r.unit, src: String(r.src ?? ''), whose, ech: use, kind, day, standIn };
}

const fmt = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${Math.round(m)} m`);
const fmtR = (r: [number, number]): string => {
  if (r[0] === r[1]) return fmt(r[0]);
  // one unit for the pair: 60-200 m, 1.1-1.5 km
  return r[1] >= 1000 ? `${(r[0] / 1000).toFixed(r[0] % 1000 ? 1 : 0)}-${fmt(r[1])}` : `${Math.round(r[0])}-${fmt(r[1])}`;
};

/** The objective's frontage in a line for the Detail and Copy as Text (never for a map label). */
export function objectiveLine(o: ObjFrontage): string {
  return `${fmt(o.frontageM)}${o.depthM >= 1 ? ` x ${fmt(o.depthM)}` : ''}, ${o.kind}: ${o.whose === 'en' ? 'En ' : ''}${ECH_WORD[o.ech] ?? o.ech} row '${o.row}' (${o.src}); ${o.why}`;
}

/** The assault frontage in a line for the Detail and Copy as Text (never for a map label). */
export function assaultLine(a: AssaultFrontage): string {
  return `${a.standIn ? `${a.standIn[0].toUpperCase()}${a.standIn.slice(1)}. ` : ''}${a.whose === 'en' ? 'His' : 'Your'} ${ECH_WORD[a.ech] ?? a.ech} by night ${fmtR(a.nightM)} ('${a.row}': ${a.src}). ${a.day}`;
}
