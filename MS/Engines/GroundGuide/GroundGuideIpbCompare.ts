/**
 * GroundGuideIpbCompare.ts
 *
 * Own attack: the left approach against the right, factor by factor (IC s15.12 b, IpbDoctrine.json `ownAttack.factors`;
 * user, 2026-11-14: "Flanking attack with choking enemy MSR is encouraged, can go right/left approach by weighing
 * different factors"; built 2026-11-23). Pure: no DOM, no view, no I/O (Node: `node tools/ipb-test/compare.mjs`).
 *
 * Each factor is read off the approaches onto the objective (GroundGuideIpbCorridors `onto`) and the fire on them
 * (GroundGuideIpbFire: the en's Posns over own avenues), scored 0-1 with its reason, and weighed 0-3 (the doctrine's
 * weights, the user's over them). The frontal approach is scored too, for reference only (IC s15.12 b: it may be safely
 * discarded, the ground is divided into left and right approaches). A factor the Extended View cannot read (the fire
 * base: no BOF is sited here) scores 0.5 both sides and says so, so it never decides.
 */

export interface CmpFactor {
  id: string;
  label: string;
  /** The doctrine's weight 0-3 and where it comes from. */
  weight: number;
  basis: string;
  src?: string;
}
export interface CmpApch {
  id: string;
  onto: 'left' | 'right' | 'frontal' | 'turn';
  lengthM: number;
  goPct: number;
  narrows: number;
  /** The assault from the FUP: its length and how much of it is NO-GO, %. */
  assaultM: number;
  assaultNogoPct: number;
  /** Where the approach swings across the axis, metres (negative: left of the movement). */
  sideM: number;
  /** His fire on it (null when the fire is not read): under fire %, may be watched %, and the state at the FUP. */
  fire: { coveredPct: number; seenPct: number; atFup: 'c' | 's' | 'd' | 'o' | null } | null;
}
export interface CmpArgs {
  apchs: CmpApch[];
  factors: CmpFactor[];
  /** The user's weights 0-3 by factor id, over the doctrine's. */
  weights?: Record<string, number>;
  /** The MSR choke behind the objective: which side of the axis it lies, metres (negative left); null when none. */
  chokeSideM: number | null;
  /** The FUP distance short of the objective, m. */
  fupM: number;
}
export interface CmpCell {
  v: number;
  reason: string;
  /** The factor could not be read here: a neutral 0.5 that never decides. */
  unread?: boolean;
}
export interface CmpSide {
  side: 'left' | 'right' | 'frontal';
  apch: string | null;
  /** The weighted score 0-100, and each factor's cell. */
  score: number | null;
  cells: Record<string, CmpCell>;
}
export interface CmpResult {
  factors: Array<CmpFactor & { w: number }>;
  sides: CmpSide[];
  /** The side preferred (left or right), null when neither approach was found or they tie within 3 points. */
  best: 'left' | 'right' | null;
  /** The margin, points. */
  marginPts: number;
  notes: string[];
}

const pc = (v: number): string => `${Math.round(v)} %`;
const km = (m: number): string => (m >= 950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The left against the right (frontal for reference). */
export function compareLeftRight(a: CmpArgs): CmpResult {
  const notes: string[] = [];
  const factors = a.factors.map((f) => ({ ...f, w: Math.max(0, Math.min(3, a.weights?.[f.id] ?? f.weight)) }));
  const by = (k: CmpApch['onto']): CmpApch | undefined => a.apchs.find((x) => x.onto === k);
  const turn = by('turn');
  const fireWord = (s: 'c' | 's' | 'd' | 'o' | null): string => (s === 'c' ? 'under his fire' : s === 's' ? 'screened from him' : s === 'd' ? 'in dead ground to him' : s === 'o' ? 'out of his range' : 'his fire not read');
  const cellsFor = (p: CmpApch | undefined, side: 'left' | 'right' | 'frontal'): Record<string, CmpCell> => {
    const c: Record<string, CmpCell> = {};
    if (!p) return c;
    for (const f of factors) {
      switch (f.id) {
        case 'msr': {
          // The turning approach reaches the MSR choke: the side it swings round credits it; frontal never.
          if (side === 'frontal') c[f.id] = { v: 0, reason: 'a frontal attack does not reach his MSR (user: flanking that chokes the en MSR is encouraged)' };
          else if (!turn || a.chokeSideM === null) c[f.id] = { v: 0.5, reason: turn ? 'the choke is on the axis: either side may reach it' : 'no MSR choke reached behind the Obj', unread: !turn };
          else {
            const same = (turn.sideM < 0) === (side === 'left');
            c[f.id] = { v: same ? 1 : 0.25, reason: same ? `the turning approach goes round this side to the choke (${km(turn.lengthM)})` : 'the turning approach goes round the other side' };
          }
          break;
        }
        case 'fupCover':
          c[f.id] = p.fire ? { v: p.fire.atFup === 'c' ? 0 : p.fire.atFup === 'o' ? 0.6 : p.fire.atFup ? 1 : 0.5, reason: `the FUP ${km(a.fupM)} short is ${fireWord(p.fire.atFup)}`, unread: !p.fire.atFup } : { v: 0.5, reason: 'his fire not read', unread: true };
          break;
        case 'fupObstacles':
          c[f.id] = { v: 1 - clamp01(p.assaultNogoPct / 100) * 0.8 - Math.min(0.2, p.narrows * 0.1), reason: `${p.assaultNogoPct ? `${pc(p.assaultNogoPct)} of the assault is NO-GO` : 'the assault is clear'}${p.narrows ? `; ${p.narrows} narrows on the way` : ''}` };
          break;
        case 'fupDistance':
          c[f.id] = { v: clamp01(1 - (p.assaultM - a.fupM) / Math.max(500, a.fupM)), reason: `assault ${km(p.assaultM)} from the FUP${Math.abs(p.assaultM - a.fupM) < 50 ? ' (the FUP distance set)' : ''}` };
          break;
        case 'route':
          c[f.id] = p.fire ? { v: clamp01(1 - p.fire.coveredPct / 100), reason: `${pc(p.fire.coveredPct)} of the way to the FUP under his fire${p.narrows ? `, ${p.narrows} narrows` : ''}` } : { v: 0.5, reason: 'his fire not read', unread: true };
          break;
        case 'fireBase':
          c[f.id] = { v: 0.5, reason: 'no fire base sited in the Ext View (the Intelligent Deployment tab sites the BOF)', unread: true };
          break;
        case 'going':
          c[f.id] = { v: clamp01(p.goPct / 100), reason: `${pc(p.goPct)} GO along it, ${km(p.lengthM)}` };
          break;
        case 'surprise':
          c[f.id] = p.fire ? { v: clamp01(1 - p.fire.seenPct / 100), reason: `${pc(100 - p.fire.seenPct)} of the way may be unwatched by him` } : { v: 0.5, reason: 'his watch not read', unread: true };
          break;
        default:
          c[f.id] = { v: 0.5, reason: 'you judge', unread: true };
      }
    }
    return c;
  };
  const score = (cells: Record<string, CmpCell>): number | null => {
    const wsum = factors.reduce((t, f) => t + f.w, 0);
    if (!wsum || !Object.keys(cells).length) return null;
    return Math.round((factors.reduce((t, f) => t + f.w * (cells[f.id]?.v ?? 0.5), 0) / wsum) * 100);
  };
  const sides: CmpSide[] = (['left', 'right', 'frontal'] as const).map((side) => {
    const p = by(side);
    const cells = cellsFor(p, side);
    return { side, apch: p?.id ?? null, score: p ? score(cells) : null, cells };
  });
  const L = sides[0], R = sides[1];
  let best: 'left' | 'right' | null = null;
  let marginPts = 0;
  if (L.score !== null && R.score !== null) {
    marginPts = Math.abs(L.score - R.score);
    best = marginPts >= 3 ? (L.score > R.score ? 'left' : 'right') : null;
    if (!best) notes.push('Left and right within 3 points: the factors do not decide; weigh what the Ext View cannot read (fire base, surprise on the ground).');
  } else notes.push(`${L.score === null ? 'No left' : 'No right'} approach onto the Obj here${L.score === null && R.score === null ? ' (neither side)' : ''}.`);
  if (sides[2].score !== null) notes.push('Frontal shown for reference only: it may be safely discarded (IC s15.12 b); dangerous, a small chance of success.');
  if (sides.some((s) => Object.values(s.cells).some((c) => c.unread))) notes.push('A factor the Ext View cannot read scores 0.5 both sides and never decides.');
  return { factors, sides, best, marginPts, notes };
}
