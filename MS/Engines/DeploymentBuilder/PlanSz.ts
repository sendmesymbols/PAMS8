/**
 * PlanSz.ts — PURE. The Security Zone of a defence by its ground, from the C&SC handout "Concept and Conduct of SZ
 * Battle" (SZB, 2010; SZB_Review.md I1 / E4):
 *
 * - The SZ is the area between the IB and the main def posn (p 3 para 7). Its depth is the sector's (p 3 para 5): in
 *   Kashmir and the north an exaggerated forward posture, so no SZ battle; in the Punjab plains none or 2-5 km, too
 *   little to fight the C Tps battle on several DLs (para 6); in the desert and semi-desert 20-50 km, the classical
 *   SZ battle (PlanDoctrine `securityZone.byGround`).
 * - Where the Ground Guide's borders are loaded, the SZ runs from its near edge to the IB; else it is drawn at
 *   `securityZone.drawnDepthM` (plains the band's top, desert its foot) and the row stays grey.
 * - In the desert the C Tps achieve their mission on a series of DLs (p 10 para 20 b): three DLs across the SZ (Fig 2
 *   p 15; `securityZone.dls`, E), DL 1 near the IB, the last ahead of the BHOL, the C Tps' rear boundary, forward
 *   enough to get into column and close enough for the holding unit to help (p 5 para 9 h; `bholAheadM`, E).
 * - Elsewhere the C Tps stand `securityZone.divCtpsAheadM` ahead of the forward posns (Demo2, GSP p 105), inside the SZ.
 *
 * Plan metres: y toward the enemy; every distance here is measured ahead of the forward posns' front edge (the FDL).
 */
import type { DoctrineSet } from './PlanRecipes';
import { doctrineAt, resolveRange } from './PlanRecipes';

export type SzGround = 'plains' | 'obstacle' | 'desert' | 'mountain';

export interface SzPlan {
  ground: SzGround;
  /** No SZ on this ground (mountains): the SZ and the C Tps are not laid. */
  none: boolean;
  /** The book's band for this ground (m), null in the mountains. */
  band: [number, number] | null;
  /** The FDL to the IB along the plan's facing (m), when the borders were read; else null. */
  borderM: number | null;
  /** The SZ's near edge and far edge ahead of the FDL (m). */
  nearM: number;
  farM: number;
  /** The C Tps ahead of the FDL (m): on DL 1 in the desert. */
  ctpsAheadM: number;
  /** The DLs ahead of the FDL (m), DL 1 first (the farthest); [] off the desert or when there is no room. */
  dls: number[];
  /** The BHOL ahead of the FDL (m), desert only. */
  bholM: number | null;
}

const num = (doc: DoctrineSet, path: string, fb: number): number => {
  const r = resolveRange(doc, doctrineAt(doc, path));
  return r ? (r[0] + r[1]) / 2 : fb;
};
const band = (doc: DoctrineSet, g: SzGround): [number, number] | null => resolveRange(doc, doctrineAt(doc, `securityZone.byGround.${g}`));
const km = (m: number): string => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
const SZB = 'SZ Battle (C&SC)';

/**
 * The SZ for a plan on this ground. `nearM`: the SZ's near edge ahead of the FDL as the recipe draws it. `borderM`:
 * the FDL to the IB, when read (null: not read).
 */
export function szPlan(doc: DoctrineSet, ground: SzGround, nearM: number, borderM: number | null): SzPlan {
  const g: SzGround = ground;
  const b = band(doc, g);
  const ctpsDefault = num(doc, 'securityZone.divCtpsAheadM', 4000);
  if (g === 'mountain' || (b && b[1] <= 0)) return { ground: g, none: true, band: null, borderM, nearM, farM: nearM, ctpsAheadM: 0, dls: [], bholM: null };
  const drawn = num(doc, `securityZone.drawnDepthM.${g === 'desert' ? 'desert' : 'plains'}`, g === 'desert' ? 20000 : 5000);
  // the SZ runs to the IB when it is read and lies ahead of the near edge; else the drawn depth
  const farM = borderM != null && borderM > nearM + 500 ? borderM : nearM + drawn;
  if (g !== 'desert') {
    return { ground: g, none: false, band: b, borderM, nearM, farM, ctpsAheadM: Math.max(nearM + 250, Math.min(ctpsDefault, farM - 500)), dls: [], bholM: null };
  }
  const bholM = num(doc, 'securityZone.bholAheadM', 2500);
  const margin = num(doc, 'securityZone.dlMarginM', 1500);
  const n = Math.max(1, Math.round(num(doc, 'securityZone.dls', 3)));
  const first = farM - margin, last = bholM + margin;
  const dls: number[] = [];
  if (first > last) {
    // as many DLs as the room gives, at least 2 km apart (a drawing step, not a rule), up to the doctrine's number
    const fit = Math.max(1, Math.min(n, Math.floor((first - last) / 2000) + 1));
    for (let i = 0; i < fit; i++) dls.push(fit === 1 ? first : first - ((first - last) * i) / (fit - 1));
  }
  return { ground: g, none: false, band: b, borderM, nearM, farM, ctpsAheadM: dls[0] ?? Math.min(ctpsDefault, farM - 500), dls, bholM: dls.length ? bholM : null };
}

export interface SzRow {
  name: string;
  st: 'pass' | 'warn' | 'fail' | 'unchecked';
  reason: string;
  m?: number;
  detail?: { head: string; why: string; fix: string[] };
}

/** The Security Zone row (and in the desert the DLs row) for a plan with an SZ slot. `source`: how its ground is known. */
export function szRows(p: SzPlan, source: 'user' | 'bundle' | 'assumed' | string): SzRow[] {
  const known = source === 'user' ? 'the ground set' : source === 'assumed' ? 'plains assumed (the ground is not read)' : 'the ground read here';
  if (p.none) {
    return [{ name: 'Security zone', st: 'pass', reason: `none laid (${known}): in Kashmir and the north an exaggerated forward posture is a compulsion, so no SZ battle is contemplated (${SZB} p 3 para 5); along the LoC no Security Zone exists and the En softens up selected posts first (MW s12 p 164); OPs, screens and link patrols only` }];
  }
  const depth = p.farM - p.nearM;
  const ib = p.borderM != null ? `the IB read ${km(p.borderM)} ahead of the FDL` : 'the IB not read (the Ground Guide\'s borders: turn the guide on): drawn';
  const bandTxt = p.band ? `${km(p.band[0])}-${km(p.band[1])}` : '';
  const rows: SzRow[] = [];
  if (p.ground !== 'desert') {
    const deep = p.band && depth > p.band[1] + 1;
    rows.push({
      name: 'Security zone',
      st: p.borderM == null ? 'unchecked' : 'pass',
      m: depth,
      reason: `${km(depth)} deep, ${ib} (${known}); in the Punjab plains none or very little room, ${bandTxt}, is available for the SZ battle, and it is difficult to fight the C Tps battle on a number of DLs and organise numerous KGs there (${SZB} p 3 paras 5-6): the C Tps ${km(p.ctpsAheadM)} ahead as a screen and adv posn, no DLs laid${deep ? `; this SZ is deeper than the book's band: room for more than the screen, the C Tps may fight on DLs as in the desert (pp 14-16)` : ''}; the En clears it with the holding formation here (p 3 para 6)`,
    });
    return rows;
  }
  const n = p.dls.length;
  rows.push({
    name: 'Security zone',
    st: p.borderM == null ? 'unchecked' : n >= 2 ? 'pass' : 'warn',
    m: depth,
    reason: `${km(depth)} deep, ${ib} (${known}); the desert and semi-desert give ${bandTxt} for the classical SZ battle (${SZB} p 3 para 5): the SZ is between the IB and the main def posn (para 7); the C Tps delay the En, attrit him, gain info and deny it (p 10 para 20 a), found by Div or Corps (para 20 d); the En clears it by daylight with a Flight Path Bde on the BOPs, then an Armd / Mech Bde ex RAPID(D) on 20-25 km (pp 7-8; DW pp 10-12: an Armd Div in 24-48 h, the books differ)${p.band && depth > p.band[1] + 1 ? `; deeper than the ${bandTxt} the book gives: room for more DLs than the ${n} laid (add them on the map)` : ''}`,
    detail: n >= 2 ? undefined : {
      head: `Room for ${n ? 'one DL only' : 'no DL'} in a ${km(depth)} desert SZ`,
      why: 'The C Tps achieve their mission on a series of DLs (SZ Battle p 10 para 20 b); with one line the same troops fight from it to the BHOL with no depth (successive technique, its disadvantages p 15).',
      fix: ['Push the FDL back where the ground allows, to give the C Tps the 20-50 km the desert normally gives (p 3)', 'Hold one DL with the bulk and a mask posn ahead of it (p 17 para 28 c (4)); deflect the En into KGs and minefields (p 11 para 22)', 'Ask the higher formation for the C Tps battle to be fought by its own covering force (p 11 para 20 d)'],
    },
  });
  if (n) {
    rows.push({
      name: 'Delaying lines',
      st: 'pass',
      m: n,
      reason: `${n} DL${n === 1 ? '' : 's'} ${p.dls.map((d) => km(d)).join(', ')} ahead of the FDL, the BHOL ${km(p.bholM ?? 0)} ahead (laid evenly, E: the number follows the mission, ground, En and own situation, ${SZB} pp 10-11 para 20 b); the same C Tps fight back on each to the BHOL on a wide sector (successive, Fig 2 p 15), or two groups leap-frog when the sector is narrow or the force reinforced (alternate, Fig 3 p 16); a KG in each sector along each DL, round the dhars in the desert, battle posns ahead and astride it (p 13 para 25); the En's shallow mnvr round a DL 10-15 km deep in 3 h, a deep one 20-25 km in 6 h (p 19 para 31); confirm the lines on the ground`,
    });
  }
  return rows;
}

/** Where the plan's facing ray from the FDL first meets a border (plan metres ahead of `fromY`), else null. */
export function borderAheadM(lines: { x: number; y: number }[][], xs: number[], fromY: number, maxM = 80000): number | null {
  const hits: number[] = [];
  for (const x of xs) {
    let best = Infinity;
    for (const ln of lines) {
      for (let i = 1; i < ln.length; i++) {
        const a = ln[i - 1], b = ln[i];
        if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) continue;
        const t = (x - a.x) / (b.x - a.x);
        const y = a.y + t * (b.y - a.y);
        if (y > fromY && y - fromY < best) best = y - fromY;
      }
    }
    if (best <= maxM) hits.push(best);
  }
  if (!hits.length) return null;
  hits.sort((p, q) => p - q);
  return hits[Math.floor(hits.length / 2)];
}
