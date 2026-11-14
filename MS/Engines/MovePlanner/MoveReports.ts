/**
 * MoveReports.ts
 *
 * The Move Planner's reports, pure: what the old DI Mov and Mov & Assy showed after the table.
 *
 *   arm         a unit's arm from its 2525D entity code (MoveDoctrine.json `road.di.arms`, E) and its HMT default.
 *   progress    DI: units concentrated by day, by corps, cumulative with the share (O, the old Progress graph), per group
 *               priority.
 *   armWise     DI: units by arm and giving corps, coloured by the op corps (O).
 *   priWise     DI: formations by group priority I / II / III and giving corps (O).
 *   hmt         DI: buses and trucks (hired mechanical transport) by op corps and formation (O).
 *   blocks      Mov & Assy: block timings per formation, earliest SP due to latest RP clear (O), and the matrix rows.
 *   assySpace   Mov & Assy: the assembly area against the map squares the formation needs (R for armd, E otherwise).
 */

import { MIN, DAY_MIN, mDayOf, type MvClock } from './MoveTime';

// ── arm ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ArmRules {
  arms: Record<string, { label: string; entity: string[] }>;
  hmt: { own: number; bus: number; trk: number };
}

export function armRulesFrom(doc: any): ArmRules {
  const d = doc?.road?.di ?? {};
  return { arms: d.arms ?? {}, hmt: d.hmtDefault ?? { own: 10, bus: 7, trk: 10 } };
}

/** The arm of a unit from a 20-digit 2525D SIDC (entity = digits 11-16); 'misc' when not known. */
export function armOf(sidc: string | null | undefined, A: ArmRules): string {
  const s = String(sidc ?? '').replace(/[^0-9]/g, '');
  if (s.length < 14) return 'misc';
  const ent = s.substring(10, 16);
  let best = 'misc', bestLen = 0;
  for (const [k, a] of Object.entries(A.arms))
    for (const p of a.entity ?? [])
      if (ent.startsWith(p) && p.length > bestLen) {
        best = k;
        bestLen = p.length;
      }
  return best;
}

// ── DI progress ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface DiUnit {
  id: string;
  name: string;
  corps: string;
  opCorps: string;
  fmn: string;
  gpPri: number;
  arm: string;
  bus: number;
  trk: number;
  /** When the unit has closed in (its tail past the RP), UTC ms; NaN when not worked out. */
  closedMs: number;
}

export interface ProgressDay {
  day: number;
  /** Units closed on this day by corps, and the running total. */
  today: Record<string, string[]>;
  cum: Record<string, number>;
  pct: Record<string, number>;
}

/** Units concentrated by day for each corps (filtered by group priority when given), cumulative with the share. */
export function progressByDay(units: DiUnit[], clock: MvClock, pri?: number): { corps: string[]; total: Record<string, number>; days: ProgressDay[] } {
  const us = units.filter((u) => pri === undefined || (u.gpPri || 3) === pri);
  const corps = [...new Set(us.map((u) => u.corps || '-'))];
  const total: Record<string, number> = {};
  for (const c of corps) total[c] = us.filter((u) => (u.corps || '-') === c).length;
  const done = us.filter((u) => Number.isFinite(u.closedMs));
  if (!done.length) return { corps, total, days: [] };
  const d1 = Math.max(...done.map((u) => mDayOf(clock, u.closedMs)));
  const days: ProgressDay[] = [];
  const cum: Record<string, number> = {};
  for (let d = Math.min(0, ...done.map((u) => mDayOf(clock, u.closedMs))); d <= d1; d++) {
    const today: Record<string, string[]> = {};
    for (const u of done) {
      if (mDayOf(clock, u.closedMs) !== d) continue;
      const c = u.corps || '-';
      (today[c] ??= []).push(u.name);
      cum[c] = (cum[c] ?? 0) + 1;
    }
    const pct: Record<string, number> = {};
    for (const c of corps) pct[c] = total[c] ? Math.round(((cum[c] ?? 0) / total[c]) * 100) : 0;
    days.push({ day: d, today, cum: { ...cum }, pct });
  }
  return { corps, total, days };
}

/** Units by arm (rows) and giving corps (columns); each cell split by op corps. */
export function armWise(units: DiUnit[], A: ArmRules): { arms: string[]; corps: string[]; cell: (arm: string, corps: string) => Record<string, number> } {
  const corps = [...new Set(units.map((u) => u.corps || '-'))];
  const arms = [...Object.keys(A.arms).filter((k) => k !== 'misc'), 'misc'];
  return {
    arms,
    corps,
    cell: (arm, c) => {
      const out: Record<string, number> = {};
      for (const u of units) if ((u.corps || '-') === c && (A.arms[u.arm] ? u.arm : 'misc') === arm) out[u.opCorps || '-'] = (out[u.opCorps || '-'] ?? 0) + 1;
      return out;
    },
  };
}

/** Formations by group priority (I, II, III) and giving corps, each with its moving units. */
export function priWise(units: DiUnit[]): { corps: string[]; rows: { pri: number; cells: Record<string, { fmn: string; units: { name: string; opCorps: string }[] }[]> }[] } {
  const corps = [...new Set(units.map((u) => u.corps || '-'))];
  const rows = [1, 2, 3].map((pri) => {
    const cells: Record<string, { fmn: string; units: { name: string; opCorps: string }[] }[]> = {};
    for (const c of corps) {
      const us = units.filter((u) => (u.corps || '-') === c && Math.min(3, Math.max(1, u.gpPri || 3)) === pri);
      const byF = new Map<string, { name: string; opCorps: string }[]>();
      for (const u of us) {
        const k = u.fmn || u.name;
        const l = byF.get(k) ?? [];
        l.push({ name: u.name, opCorps: u.opCorps });
        byF.set(k, l);
      }
      cells[c] = [...byF].map(([fmn, l]) => ({ fmn, units: l }));
    }
    return { pri, cells };
  });
  return { corps, rows };
}

/** Buses and trucks to be provided, by op corps and formation. */
export function hmtByFmn(units: DiUnit[]): { opCorps: string; fmn: string; bus: number; trk: number }[] {
  const m = new Map<string, { opCorps: string; fmn: string; bus: number; trk: number }>();
  for (const u of units) {
    const k = `${u.opCorps}|${u.fmn}`;
    const r = m.get(k) ?? { opCorps: u.opCorps || '-', fmn: u.fmn || '-', bus: 0, trk: 0 };
    r.bus += u.bus;
    r.trk += u.trk;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.opCorps.localeCompare(b.opCorps) || a.fmn.localeCompare(b.fmn));
}

// ── Mov & Assy ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BlockRow {
  fmn: string;
  start: number;
  finish: number;
  serials: { id: string; name: string; start: number; finish: number }[];
}

/** Block timings per formation: earliest SP due to latest RP clear (O), with each serial's bar for the matrix. */
export function blockTimings(items: { id: string; name: string; fmn: string; spDue: number; rpClear: number }[]): BlockRow[] {
  const m = new Map<string, BlockRow>();
  for (const x of items) {
    if (!Number.isFinite(x.spDue) || !Number.isFinite(x.rpClear)) continue;
    const k = x.fmn || x.name;
    const r = m.get(k) ?? { fmn: k, start: Infinity, finish: -Infinity, serials: [] };
    r.start = Math.min(r.start, x.spDue);
    r.finish = Math.max(r.finish, x.rpClear);
    r.serials.push({ id: x.id, name: x.name, start: x.spDue, finish: x.rpClear });
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.start - b.start);
}

export interface SpaceRules {
  assyKm2: Record<string, [number, number]>;
}

export function spaceRulesFrom(doc: any): SpaceRules {
  return { assyKm2: doc?.road?.space?.assyKm2 ?? {} };
}

/** An assembly area of `areaKm2` for a formation size: tone and words (a 1:50,000 map square is 1 km2). */
export function assySpace(size: string, areaKm2: number, S: SpaceRules): { need: [number, number] | null; tone: 'ok' | 'warn' | 'bad'; text: string } {
  const need = S.assyKm2[size] ?? null;
  if (!need || !(areaKm2 > 0)) return { need, tone: 'warn', text: need ? 'Draw the assembly area to check its size' : 'No space figure for this formation' };
  const a = Math.round(areaKm2);
  if (areaKm2 < need[0]) return { need, tone: 'bad', text: `${a} map squares: too small (needs ${need[0]}-${need[1]})` };
  if (areaKm2 > need[1] * 1.5) return { need, tone: 'warn', text: `${a} map squares: much larger than needed (${need[0]}-${need[1]}); hard to control` };
  return { need, tone: 'ok', text: `${a} map squares: enough (needs ${need[0]}-${need[1]})` };
}

export { MIN, DAY_MIN };
