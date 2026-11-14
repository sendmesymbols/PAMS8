/**
 * MovePlannerText.ts
 *
 * The plan as text (Copy as Text): the mov table in the order's layout (SO's Handbook 903-905: a data paragraph, then a
 * row per serial with its critical points due and clear), the rail mov table, the enemy timings and the induction
 * matrix. Plain text, aligned with spaces, for an order's annex.
 */

import { MIN, dtg, durText, durHHMM, mDayLabel } from './MoveTime';
import { KIND_LONG, type MvPlanDoc, type MvResult, type MvRules } from './MovePlannerModel';
import { MEET_WORD } from './MoveRoad';

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));

export function windowWord(plan: MvPlanDoc): string {
  const w = plan.window === 'both' ? 'Day & Ni' : plan.window === 'day' ? 'Day' : 'Ni';
  return plan.windowFrom && plan.windowTo && plan.window !== 'both' ? `${w} ${plan.windowFrom}-${plan.windowTo}` : plan.window === 'both' ? w : `${w} (by first / last light)`;
}

export function haltWord(plan: MvPlanDoc): string {
  if (plan.haltMode === 'none') return 'Nil';
  if (plan.haltMode === 'clock') return '10 min at 10 min to each odd hr (all colms together)';
  return `${plan.shMin} min after each ${plan.shRunMin} min running${plan.lhEvery > 0 && plan.lhMin > 0 ? `; every ${plan.lhEvery}${plan.lhEvery === 2 ? 'nd' : plan.lhEvery === 3 ? 'rd' : 'th'} a ${plan.lhMin} min long halt` : ''}`;
}

export function planLines(plan: MvPlanDoc, res: MvResult, R: MvRules, kindLabel: (k: string) => string): string[] {
  const c = res.clock;
  const L: string[] = [];
  L.push(`${plan.title.toUpperCase()} - ${KIND_LONG[plan.kind].toUpperCase()}`);
  L.push(`M Day ${plan.mDate} (UTC${plan.offsetMin >= 0 ? '+' : '-'}${Math.abs(plan.offsetMin / 60)}); first / last light: ${plan.light === 'sun' ? 'sunrise / sunset' : plan.light === 'civil' ? 'civil twilight' : 'nautical twilight'}`);
  if (plan.kind === 'road' || plan.kind === 'assy' || plan.kind === 'di') {
    L.push('');
    L.push('MOV TABLE');
    L.push(`1. Mov. ${windowWord(plan)}.`);
    const sp = res.serials[0];
    if (sp) L.push(`2. Average Speed. Day ${sp.speedDay} kmph, Ni ${sp.speedNi} kmph. Density. Day ${sp.densDay} vpkm, Ni ${sp.densNi} vpkm.`);
    L.push(`3. Halts. ${haltWord(plan)}.`);
    L.push('4. Routes.');
    for (const r of plan.routes) L.push(`   ${r.name}: ${r.sp} - ${r.cps.map((x) => x.name).join(' - ')}${r.cps.length ? ' - ' : ''}${r.rp}${r.note ? ` (${r.note})` : ''}`);
    L.push('');
    L.push(`${pad('Ser', 4)}${pad('Unit / Fmn', 18)}${pad('Vehs', 6)}${pad('Route', 10)}${pad('Critical Pt', 22)}${pad('Due', 11)}${pad('Clear', 11)}Remarks`);
    res.serials.forEach((s, i) => {
      const first = s.legs[0];
      const rows: [string, number, number][] = [];
      if (s.conc) rows.push([`DL (conc ${durText(s.conc.minutes)})`, s.conc.from, NaN]);
      for (const g of s.legs) rows.push([g.from, g.fromDue, g.fromClear]);
      const last = s.legs[s.legs.length - 1];
      if (last) rows.push([last.to, last.toDue, last.toClear]);
      const waits = s.run.stops.filter((x) => x.kind === 'X');
      const rem = [
        waits.length ? `${waits.length} wait${waits.length > 1 ? 's' : ''} at crossings (${waits.reduce((m, x) => m + Math.round((x.t1 - x.t0) / MIN), 0)} min)` : '',
        s.run.stops.some((x) => x.kind === 'DLH') ? `${s.run.stops.filter((x) => x.kind === 'DLH').length} harbour(s)` : '',
        s.run.stops.some((x) => x.kind === 'DC') ? 'closes up at last light' : '',
        ...s.run.warnings,
      ].filter(Boolean);
      rows.forEach(([name, due, clear], j) => {
        L.push(
          `${pad(j === 0 ? String(i + 1) : '', 4)}${pad(j === 0 ? s.doc.name : j === 1 && s.doc.fmn ? s.doc.fmn : '', 18)}${pad(j === 0 ? String(s.run.vehicles) : '', 6)}${pad(j === 0 ? s.route.name : '', 10)}${pad(name, 22)}${pad(dtg(c, due), 11)}${pad(Number.isFinite(clear) ? dtg(c, clear) : '', 11)}${j === 0 ? rem.join('; ') : ''}`,
        );
      });
      void first;
    });
    if (res.sched?.conflicts.length) {
      L.push('');
      L.push('CROSSINGS');
      const name = (id: string) => plan.serials.find((s) => s.id === id)?.name ?? id;
      for (const x of res.sched.conflicts) L.push(`   ${MEET_WORD[x.kind]} ${name(x.winner)}: ${name(x.loser)} waits ${x.waitMin} min, ${name(x.winner)} clear ${dtg(c, x.winnerClear)}`);
    }
  }
  if (plan.kind === 'rail' && res.rail) {
    const r = res.rail;
    L.push('');
    L.push('RAIL MOV TABLE');
    L.push(`1. Avg Speed. ${r.kmh} kmph. 2. Dist. ${r.distKm.toFixed(0)} km (${r.distSource}). 3. Entraining Sta. ${plan.rail.eSta || '-'}. 4. Detraining Sta. ${plan.rail.dSta || '-'}.`);
    L.push(`5. Gap b/w trains ${Math.max(plan.rail.intervalMin, R.rail.stationMin)} min; ${plan.rail.moveType === 'night' ? `stock placed ${R.rail.placingMin} min after last light, loaded by night` : 'by day and night'}; about ${r.perNight} trains a night from one siding.`);
    L.push('');
    L.push(`${pad('Train', 9)}${pad('Units', 22)}${pad('Stock', 34)}${pad('C', 4)}${pad('Tons', 6)}${pad('Placed', 11)}${pad('Dep', 11)}${pad('Arr', 11)}Detrained`);
    for (const t of r.trains) {
      const st = (['MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'] as const).filter((k) => t.stock[k]).map((k) => `${t.stock[k]} ${k}`).join(', ');
      const names = t.units.map((u) => plan.serials.find((s) => s.id === u)?.name ?? u).join(', ');
      L.push(`${pad(t.name, 9)}${pad(names, 22)}${pad(st, 34)}${pad(String(t.c), 4)}${pad(String(t.tons), 6)}${pad(dtg(c, t.placed), 11)}${pad(dtg(c, t.dep), 11)}${pad(dtg(c, t.arr), 11)}${dtg(c, t.detrained)}${t.notes.length ? `  (${t.notes.join('; ')})` : ''}`);
    }
    L.push('');
    L.push('ROLLING STOCK REQUIRED');
    const days = [...r.demand.byDay.keys()].sort((a, b) => a - b);
    L.push(`${pad('Stock', 8)}${days.map((d) => pad(plan.rail.moveType === 'night' ? `Ni ${mDayLabel(d)}/${mDayLabel(d + 1)}` : mDayLabel(d), 13)).join('')}Total`);
    for (const k of ['Engine', 'Brake', 'MBFR', 'MBFU', 'BKF', 'KF', 'C', 'TLR'] as const) {
      if (!r.demand.total[k]) continue;
      L.push(`${pad(k, 8)}${days.map((d) => pad(String(r.demand.byDay.get(d)![k]), 13)).join('')}${r.demand.total[k]}`);
    }
    if (r.unknown.length) L.push(`Not loaded (kind not in the table): ${r.unknown.map((u) => `${u.count} x ${kindLabel(u.kind)}`).join(', ')}`);
  }
  if (plan.kind === 'enemy' && res.enemy) {
    L.push('');
    L.push('EN MOV');
    L.push(`${pad('Fmn', 18)}${pad('Mode', 6)}${pad('Trains', 7)}${pad('From - To', 26)}${pad('1st Dep', 11)}${pad('1st Arr', 11)}${pad('Last Arr', 11)}Inducted`);
    for (const e of res.enemy.rail) L.push(`${pad(e.name, 18)}${pad('Rail', 6)}${pad(String(e.trains), 7)}${pad(`${e.eSta} - ${e.dSta}`, 26)}${pad(dtg(c, e.first.dep), 11)}${pad(dtg(c, e.first.arr), 11)}${pad(dtg(c, e.last.arr), 11)}${dtg(c, e.inducted)}${e.notes.length ? `  (${e.notes.join('; ')})` : ''}`);
    for (const e of res.enemy.road) L.push(`${pad(e.doc.name, 18)}${pad('Rd', 6)}${pad('-', 7)}${pad(`${e.run.vehicles} vehs, ${(e.run.lengthM / 1000).toFixed(0)} km`, 26)}${pad(dtg(c, e.run.spDue), 11)}${pad(dtg(c, e.run.rpDue), 11)}${pad(dtg(c, e.run.rpClear), 11)}${dtg(c, e.inducted)}`);
    L.push('');
    L.push('INDUCTION MATRIX (end of each day)');
    for (const m of res.enemy.matrix) {
      const nm = (id: string) => plan.enemy.find((e) => e.id === id)?.name ?? id;
      L.push(`${pad(mDayLabel(m.day), 6)}in: ${m.inducted.map(nm).join(', ') || '-'}   moving: ${m.moving.map(nm).join(', ') || '-'}`);
    }
  }
  if (res.errors.length) {
    L.push('');
    L.push(`NOT WORKED OUT: ${res.errors.join('; ')}`);
  }
  if (res.span) L.push(`\nWhole move: ${dtg(c, res.span[0])} to ${dtg(c, res.span[1])} (${durHHMM((res.span[1] - res.span[0]) / MIN)} h).`);
  return L;
}
