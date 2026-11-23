/**
 * GroundGuideIpbForms.ts
 *
 * Own attack: the forms of manoeuvre the ground offers against the objective (OoW Vol II s6 pp 19-21: envelopment,
 * double envelopment, vertical envelopment, turning movement, penetration; MW p 79: envelopment with frontal fixation
 * preferred in the mountains, frontal only if unavoidable; user, 2026-11-14: frontal attack is dangerous, flanking that
 * chokes the en MSR is encouraged; built 2026-11-23). Pure: no DOM, no view, no I/O (`node tools/ipb-test/forms.mjs`).
 *
 * The test the book turns on is the ASSAILABLE FLANK: a flank of his position that is not tied to NO-GO, an obstacle or
 * another of his localities, with open ground beside it and a way onto it that stays off his front. Each flank is read
 * off the IPB coding beside the objective and the approaches onto it (GroundGuideIpbCorridors `onto`). Then:
 *   - turning movement: the turning approach reaches a choke on his MSR behind the objective (the book: a threat to a
 *     significant objective deep in his rear; needs relative mobility on an assailable flank);
 *   - envelopment: one assailable flank, the main strength onto it, an auxiliary manoeuvre (the frontal approach) to
 *     fix his front; double envelopment: both flanks assailable and the force adequate (own echelon not below his);
 *   - vertical envelopment: LZs behind him read by the air tab;
 *   - infiltration: a way onto him he may not watch (OoW Vol II s11: through facilitating terrain), on foot;
 *   - penetration: no assailable flank: a wedge through the front at its weakest point (the book: the most commonly
 *     applied form; needs preponderance, must lead to break-out and the inner flanks);
 *   - frontal attack: for reference, last (user: dangerous, a small chance of success; MW p 79: only if unavoidable).
 * Ranking is a decision (E): turning first when it reaches the choke (user), then double / single envelopment,
 * vertical, infiltration, penetration, frontal.
 */

export type FormId = 'turning' | 'double' | 'envelopment' | 'vertical' | 'infiltration' | 'penetration' | 'frontal';

export interface FormApch {
  id: string;
  onto: 'left' | 'right' | 'frontal' | 'turn';
  goPct: number;
  assaultNogoPct: number;
  lengthM: number;
  /** His fire on it, null when not read. */
  fire: { coveredPct: number; seenPct: number } | null;
}
export interface FormFlank {
  /** NO-GO share of the ground beside the flank, %, and whether a man-made obstacle lies there. */
  nogoPct: number;
  obstacle: boolean;
  /** The nearest other locality of his beside that flank, m (null: none within the band read). */
  enemyWithinM: number | null;
}
export interface FormArgs {
  apchs: FormApch[];
  flanks: { left: FormFlank; right: FormFlank };
  /** Own echelon code (SIDC digits 9-10) and the objective's; null when unknown. */
  ownEch: string | null;
  objEch: string | null;
  mover: 'armour' | 'mech' | 'dismounted';
  /** LZs the air tab found behind the objective. */
  lzBehind: number;
  /** The MSR choke the turning approach reaches, its label; null when none. */
  turnLabel: string | null;
  mountain: boolean;
  /** Thresholds (IpbDoctrine formsOfManoeuvre.reading, E). */
  rules?: { flankNogoMaxPct?: number; flankEnemyMinM?: number; unwatchedMaxPct?: number };
}
export interface FormOption {
  id: FormId;
  label: string;
  rank: number;
  feasible: boolean;
  /** The approach the main strength takes, and the auxiliary (fixing) one; null when none. */
  main: string | null;
  aux: string | null;
  why: string[];
  src: string;
}
export interface FormsResult {
  flanks: { left: { assailable: boolean; why: string }; right: { assailable: boolean; why: string } };
  options: FormOption[];
  /** The form the ground favours (the first feasible). */
  lead: FormId | null;
  notes: string[];
}

const ECH_RANK: Record<string, number> = { '11': 1, '12': 2, '13': 3, '14': 4, '15': 5, '16': 6, '17': 7, '18': 8, '21': 9, '22': 10, '23': 11 };

export function formsOfManoeuvre(a: FormArgs): FormsResult {
  const R = { flankNogoMaxPct: 30, flankEnemyMinM: 1000, unwatchedMaxPct: 30, ...(a.rules ?? {}) };
  const by = (k: FormApch['onto']): FormApch | undefined => a.apchs.find((x) => x.onto === k);
  const left = by('left'), right = by('right'), frontal = by('frontal'), turn = by('turn');
  const flank = (side: 'left' | 'right', f: FormFlank, ap: FormApch | undefined): { assailable: boolean; why: string } => {
    const reasons: string[] = [];
    if (!ap) reasons.push('no approach onto it');
    if (f.nogoPct > R.flankNogoMaxPct) reasons.push(`${Math.round(f.nogoPct)} % NO-GO beside it`);
    if (f.obstacle) reasons.push('an obstacle beside it');
    if (f.enemyWithinM !== null && f.enemyWithinM < R.flankEnemyMinM) reasons.push(`another of his localities ${Math.round(f.enemyWithinM)} m off it`);
    if (reasons.length) return { assailable: false, why: `${side} flank tied: ${reasons.join(', ')}` };
    return { assailable: true, why: `${side} flank open: ${Math.round(100 - f.nogoPct)} % usable ground beside it, no obstacle, no other locality within ${R.flankEnemyMinM} m, approach ${ap!.id} onto it` };
  };
  const L = flank('left', a.flanks.left, left), Rt = flank('right', a.flanks.right, right);
  const open = (L.assailable ? 1 : 0) + (Rt.assailable ? 1 : 0);
  const adequate = a.ownEch && a.objEch ? (ECH_RANK[a.ownEch] ?? 0) >= (ECH_RANK[a.objEch] ?? 0) : null;
  const best = (xs: Array<FormApch | undefined>): FormApch | undefined => xs.filter((x): x is FormApch => !!x).sort((p, q) => q.goPct - (q.fire?.coveredPct ?? 50) / 2 - (p.goPct - (p.fire?.coveredPct ?? 50) / 2))[0];
  const unwatched = a.apchs.filter((x) => x.onto !== 'frontal' && x.fire && x.fire.seenPct <= R.unwatchedMaxPct);
  const notes: string[] = [];
  const opts: FormOption[] = [];
  const fix = frontal ? `${frontal.id} (frontal) fixes his front` : 'a fixing attack on his front (no frontal approach read)';

  opts.push({
    id: 'turning', label: 'Turning movement', rank: 0, feasible: !!turn && !!a.turnLabel, main: turn?.id ?? null, aux: frontal?.id ?? null,
    why: turn && a.turnLabel ? [`${turn.id} goes round him to ${a.turnLabel}: a threat deep in his rear forces him to divert (OoW Vol II s6)`, `needs relative mobility on the flank it rounds${open ? '' : ' (no flank read as open: harder)'}`, fix, 'user: a flanking attack that chokes the en MSR is encouraged'] : ['no MSR choke reached behind the objective'],
    src: 'OoW Vol II s6; user',
  });
  opts.push({
    id: 'double', label: 'Double envelopment', rank: 0, feasible: open === 2 && adequate !== false, main: open === 2 ? `${left!.id} + ${right!.id}` : null, aux: frontal?.id ?? null,
    why: open === 2 ? [adequate === null ? 'both flanks open; the force must be adequate (his echelon unknown)' : adequate ? 'both flanks open and the force adequate' : 'both flanks open but the force is below his echelon', 'needs precise co-ordination; enables total destruction (OoW Vol II s6)', fix] : [`${open === 1 ? 'one flank open only' : 'no flank open'}`],
    src: 'OoW Vol II s6',
  });
  const envFlank = L.assailable && Rt.assailable ? best([left, right]) : L.assailable ? left : Rt.assailable ? right : undefined;
  opts.push({
    id: 'envelopment', label: 'Envelopment', rank: 0, feasible: open >= 1 && !!envFlank, main: envFlank?.id ?? null, aux: frontal?.id ?? null,
    why: envFlank ? [`main strength onto the ${envFlank.onto} flank by ${envFlank.id} (${Math.round(envFlank.goPct)} % GO${envFlank.fire ? `, ${Math.round(envFlank.fire.coveredPct)} % under his fire` : ''})`, `an auxiliary manoeuvre draws him first: ${fix}`, ...(a.mountain ? ['mountains: envelopment with frontal fixation preferred (MW p 79)'] : [])] : ['no assailable flank: create inner flanks after a penetration (OoW Vol II s6)'],
    src: 'OoW Vol II s6; MW p 79',
  });
  opts.push({
    id: 'vertical', label: 'Vertical envelopment', rank: 0, feasible: a.lzBehind > 0, main: null, aux: frontal?.id ?? null,
    why: a.lzBehind > 0 ? [`${a.lzBehind} LZ${a.lzBehind > 1 ? 's' : ''} behind him (tab 4): by air into his rear and flanks (OoW Vol II s6)`, 'needs the lift and air cover'] : ['no LZ behind him read (tab 4)'],
    src: 'OoW Vol II s6',
  });
  const inf = a.mover === 'dismounted' ? best(unwatched) : undefined;
  opts.push({
    id: 'infiltration', label: 'Infiltration', rank: 0, feasible: !!inf, main: inf?.id ?? null, aux: null,
    why: inf ? [`${inf.id} he may watch only ${Math.round(inf.fire!.seenPct)} % of the way: through facilitating terrain (OoW Vol II s11)`, 'by night, on foot; needs detailed terrain and routes'] : a.mover !== 'dismounted' ? ['on foot only'] : ['no way onto him he may not watch'],
    src: 'OoW Vol II s11',
  });
  opts.push({
    id: 'penetration', label: 'Penetration', rank: 0, feasible: true, main: frontal?.id ?? null, aux: null,
    why: [open ? 'a flank is open: envelopment first' : 'no assailable flank: a wedge through his front at its weakest point (OoW Vol II s6: the most commonly applied form)', 'needs preponderance, above all in firepower; must lead to break-out and the inner flanks', 'enabled by an auxiliary manoeuvre, surprise and deception'],
    src: 'OoW Vol II s6',
  });
  opts.push({
    id: 'frontal', label: 'Frontal attack', rank: 0, feasible: !!frontal, main: frontal?.id ?? null, aux: null,
    why: ['for reference: dangerous, a small chance of success (user); only if unavoidable, at night or in poor visibility (MW p 79)', 'the most fire from him (tab 1)'],
    src: 'user; MW p 79',
  });
  // Rank: turning (when it reaches the choke), double, envelopment, vertical, infiltration, penetration, frontal;
  // a form not feasible sinks below the feasible ones in that order.
  const order: FormId[] = ['turning', 'double', 'envelopment', 'vertical', 'infiltration', 'penetration', 'frontal'];
  opts.sort((p, q) => (p.feasible === q.feasible ? order.indexOf(p.id) - order.indexOf(q.id) : p.feasible ? -1 : 1));
  opts.forEach((o, i) => (o.rank = i + 1));
  const lead = opts.find((o) => o.feasible)?.id ?? null;
  if (!open) notes.push('No assailable flank read: the book says most of our operational environment is so; penetration then envelopment of the inner flanks.');
  if (a.mountain) notes.push('Mountains: frontal only if unavoidable, then at night or in poor visibility (MW p 79).');
  return { flanks: { left: L, right: Rt }, options: opts, lead, notes };
}
