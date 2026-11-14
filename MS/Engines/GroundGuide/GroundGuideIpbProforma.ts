/**
 * GroundGuideIpbProforma.ts
 *
 * The proforma for the relative merits of avenues of approach (C&SC IPB book p 21; IPB_Plan.md §6.5; Phase 4). Pure:
 * no DOM, no view (`node tools/ipb-test/fire.mjs` checks it).
 *
 * Two groups of up to four avenues (A to D), their headings named by the user (decision 2: the book leaves them blank;
 * defaults "En" and "Own"), each with the side whose avenues they are, because a sign depends on who uses the avenue.
 * Rows a to l as the book has them; h is split into Rds & LOC and Sigs (decision 3). Each row carries the measure taken
 * from the reading and, where the data can say, a suggested sign: within the group, at or better than the median: +,
 * worse: − (basis E). Rows the data cannot judge (d important tactical ground, g NBC, k unconventional warfare, l others,
 * and any row without data) are left "?" for the user. The user flips any sign; totals are + less −, with the book's note
 * 2: the weights cannot be quantified, so the totals are only a rough guide.
 */

export type PfSign = '+' | '−' | '?';

/** What the reading measured on one avenue (null: not measured here). */
export interface PfMeasures {
  /** a: share of its length under the other side's direct fire, %. */
  coveredPct: number | null;
  /** b: share of a band one avenue wide with trees, orchards or built-up ground, %. */
  coverPct: number;
  /** c: narrows plus water lines crossed. */
  obstacles: number;
  /** d: ITG candidates within 1 km of it. */
  itg: number | null;
  /** e: corridors side by side (2, 3 when open; 1 lone) and the median free width, m. */
  rooms: number;
  medianWidthM: number;
  /** f: GO share in its band, %, and its length, m. */
  goPct: number;
  lengthM: number;
  /** h: share of its length with a metalled road within 300 m, %; share of 3 km legs a 3 m mast sees along, %. */
  roadPct: number;
  sigsPct: number | null;
  /** j: share of its length the other side may watch, %. */
  seenPct: number | null;
  /** k: built-up share of its band, %. */
  buaPct: number;
}

export interface PfGroupIn {
  head: string;
  side: 'enemy' | 'own';
  aas: Array<{ id: string; m: PfMeasures }>;
}

interface RowDef {
  key: string;
  /** For the narrow table ("a Obsn"); `label` in full on hover and in Copy as Text. */
  short: string;
  label: string;
  /** +1 more is better for the user of the avenue, -1 less is better, 0 the user judges. */
  dir: 1 | -1 | 0;
  val: (m: PfMeasures) => number | null;
  fmt: (m: PfMeasures) => string;
  basis: string;
}
const r0 = (v: number): number => Math.round(v);
const km = (m: number): string => `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
export const PF_ROWS: readonly RowDef[] = [
  { key: 'a', short: 'a Obsn', label: 'a Obsn & fire', dir: -1, val: (m) => m.coveredPct, fmt: (m) => (m.coveredPct === null ? 'no Posns read' : `${r0(m.coveredPct)}% under fire`), basis: 'Share of its length under the other side\'s direct fire, from the Posns on the map' },
  { key: 'b', short: 'b Cover', label: 'b Cover & concealment', dir: 1, val: (m) => m.coverPct, fmt: (m) => `${r0(m.coverPct)}% trees, BUA`, basis: 'Trees, orchards and built-up ground in a band one avenue wide' },
  { key: 'c', short: 'c Obs', label: 'c Obstacles / vertical', dir: -1, val: (m) => m.obstacles, fmt: (m) => `${m.obstacles} narrows, lines`, basis: 'Narrows and water lines crossed' },
  { key: 'd', short: 'd ITG', label: 'd Important tactical Gr', dir: 0, val: (m) => m.itg, fmt: (m) => (m.itg === null ? 'not read' : `${m.itg} ITG within 1 km`), basis: 'ITG candidates on or near it: who holds them is your call' },
  { key: 'e', short: 'e Space', label: 'e Manoeuvre space', dir: 1, val: (m) => m.rooms * 1e6 + m.medianWidthM, fmt: (m) => `${m.rooms >= 3 ? '3+' : m.rooms} corridors, ${km(m.medianWidthM)}`, basis: 'Corridors side by side and the median free width' },
  { key: 'f', short: 'f Going', label: 'f Ease of movement', dir: 1, val: (m) => m.goPct * 1e3 - m.lengthM / 1e3, fmt: (m) => `${r0(m.goPct)}% GO, ${km(m.lengthM)}`, basis: 'GO share (the shorter wins a tie)' },
  { key: 'g', short: 'g NBC', label: 'g NBC effects', dir: 0, val: () => null, fmt: () => 'you judge', basis: 'Low ground where agents linger, the wind: not in the reading' },
  { key: 'h1', short: 'h Rds', label: 'h Rds & LOC', dir: 1, val: (m) => m.roadPct, fmt: (m) => `metalled Rd along ${r0(m.roadPct)}%`, basis: 'Share of its length with a metalled road within 300 m' },
  { key: 'h2', short: 'h Sigs', label: 'h Sigs', dir: 1, val: (m) => m.sigsPct, fmt: (m) => (m.sigsPct === null ? 'not read' : `${r0(m.sigsPct)}% of 3 km legs in sight`), basis: 'Radio line of sight along it: 3 m masts 3 km apart' },
  { key: 'j', short: 'j Surv', label: 'j Surveillance', dir: -1, val: (m) => m.seenPct, fmt: (m) => (m.seenPct === null ? 'no Posns read' : `${r0(m.seenPct)}% may be watched`), basis: 'Share the other side may watch from its Posns (observation reach)' },
  { key: 'k', short: 'k UW', label: 'k Unconventional warfare', dir: 0, val: (m) => m.buaPct, fmt: (m) => `${r0(m.buaPct)}% BUA`, basis: 'People and settlements along it: you sign it' },
  { key: 'l', short: 'l Others', label: 'l Others', dir: 0, val: () => null, fmt: () => '', basis: 'Yours' },
];

export interface PfCell {
  id: string;
  sign: PfSign;
  suggested: PfSign;
  /** The user set this sign. */
  user: boolean;
  value: string;
}
export interface PfRow {
  key: string;
  short: string;
  label: string;
  basis: string;
  /** Per group, per avenue. */
  cells: PfCell[][];
  /** "A 64% vs B 48% under fire": what decided the suggestion. */
  why: string;
}
export interface PfResult {
  groups: Array<{ head: string; side: 'enemy' | 'own'; ids: string[] }>;
  rows: PfRow[];
  /** Per group, per avenue: + less −. */
  totals: number[][];
  /** Per group: the avenue the totals favour (null on a tie or with one avenue). */
  lead: Array<{ id: string; total: number } | null>;
  note: string;
}

/** The key of a user's sign: group, avenue, row. */
export const pfKey = (g: number, id: string, row: string): string => `${g}|${id}|${row}`;

export function proforma(groups: PfGroupIn[], user: Record<string, PfSign> = {}): PfResult {
  const gs = groups.map((g) => ({ ...g, aas: g.aas.slice(0, 4) }));
  const rows: PfRow[] = PF_ROWS.map((def) => {
    const cells = gs.map((g, gi) => {
      const vals = g.aas.map((a) => def.val(a.m));
      const known = vals.filter((v): v is number => v !== null && Number.isFinite(v));
      let med: number | null = null;
      if (def.dir !== 0 && known.length >= 2) {
        const s = [...known].sort((p, q) => p - q);
        med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
      }
      return g.aas.map((a, k) => {
        const v = vals[k];
        let suggested: PfSign = '?';
        if (med !== null && v !== null) {
          // All equal: no reading tells them apart.
          const allSame = known.every((x) => x === known[0]);
          suggested = allSame ? '?' : (def.dir > 0 ? v >= med : v <= med) ? '+' : '−';
        }
        const u = user[pfKey(gi, a.id, def.key)];
        return { id: a.id, sign: u ?? suggested, suggested, user: u !== undefined, value: def.fmt(a.m) };
      });
    });
    const why = gs.map((g) => (g.aas.length >= 2 ? `${g.head}: ${g.aas.map((a) => `${a.id} ${def.fmt(a.m)}`).join(', ')}` : '')).filter(Boolean).join(' · ');
    return { key: def.key, short: def.short, label: def.label, basis: def.basis, cells, why };
  });
  const totals = gs.map((g, gi) => g.aas.map((_, k) => rows.reduce((t, r) => t + (r.cells[gi][k].sign === '+' ? 1 : r.cells[gi][k].sign === '−' ? -1 : 0), 0)));
  const lead = gs.map((g, gi) => {
    if (g.aas.length < 2) return null;
    const t = totals[gi];
    const max = Math.max(...t);
    if (t.filter((x) => x === max).length > 1) return null;
    const k = t.indexOf(max);
    return { id: g.aas[k].id, total: max };
  });
  return {
    groups: gs.map((g) => ({ head: g.head, side: g.side, ids: g.aas.map((a) => a.id) })),
    rows,
    totals,
    lead,
    note: 'Plus for advantage, minus for disadvantage to the side using the avenue. The weights cannot be quantified: the totals are only a rough guide (book p 21, note 2).',
  };
}
