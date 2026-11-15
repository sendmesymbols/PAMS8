// whatif.mjs -- checks the Build tab's what-if and trigger table (MS/Engines/DeploymentBuilder/PlanWhatIf.ts).
//   node tools/planbuilder-test/whatif.mjs          (add --quiet to print only failures and the summary)
// Synthetic ground round 0,0 (a metre is a metre), the plan facing north, the enemy 8 km out: moves to the alternates,
// to a supplementary posn facing a secondary approach and to the C Pen posn astride the main one, with times on foot
// at the IPB rates against the enemy's lead tanks; a canal across a route forces a detour; a lake under an alternate
// fails it; Copy as Text carries the trigger table.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');
const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let fails = 0, n = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const r2 = json('MS/Data/Deployments/Recipes/bn-def-two-up.json');

function ground({ canalY = null, lakes = [], avenues = [0, 3600], from = 8000 } = {}) {
  const inRect = (r, x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  const cls = (x, y) => (lakes.some((r) => inRect(r, x, y)) ? 4 : canalY !== null && Math.abs(y - canalY) < 30 ? 20 : 2);
  return {
    cls, elev: () => 200, going: goingOf, label: (c) => rules.classes[String(c)].label, sight: () => 0.2,
    avenues: () => avenues.map((ax, i) => {
      const path = []; for (let y = from; y >= -500; y -= 100) path.push({ x: i === 0 ? ax : ax - (ax * Math.max(0, 2000 - y)) / 2500, y });
      return { path, lengthM: from, goPct: 100, minWidthM: 900, chokes: [] };
    }),
    pending: () => false, dataLine: () => 'synthetic',
  };
}
const inp = (g, opts = { alternates: 'visible' }) => ({ recipe: r2, ctx, opts, ground: g, anchor: { x: 0, y: 0 }, bearing: 0, threat: { x: 0, y: 8000 } });
const run = (g, opts) => { const i = inp(g, opts); const fl = F.fitLayout(i); return W.withMoves(fl, i); };

// open ground
const a = run(ground());
const t = (id) => a.whatIf.triggers.find((x) => x.id === id);
check('a trigger for each shelled forward posn', !!t('shell-fwdL') && !!t('shell-fwdR'));
const sh = t('shell-fwdL');
const want = Math.round(((sh.route.lengthM / 1000) / 4) * 60 * 1.5 + 5);
check('shelled move: on foot at 4 km/h (IPB p 18), half as long again under fire, + 5 min', Math.abs(sh.min - want) <= 1, `${sh.min} min for ${Math.round(sh.route.lengthM)} m`);
check('the enemy\'s lead tanks to the FDL: about 6 km at 24 km/h (IPB p 18)', a.whatIf.enemyToFdlMin >= 12 && a.whatIf.enemyToFdlMin <= 18, `${a.whatIf.enemyToFdlMin} min`);
check('a supplementary posn faces the secondary approach', a.whatIf.sups.length === 1 && a.whatIf.sups[0].apch === 'A2', JSON.stringify(a.whatIf.sups.map((s) => s.label + ' ' + s.apch)));
check('the reserve moves to it', t('sup-A2')?.who === 'D Coy' && t('sup-A2')?.to === 'Sup 1');
check('a C Pen posn astride the main approach behind the FDL', !!a.whatIf.cpen && t('cpen-main')?.who === 'D Coy', JSON.stringify(a.whatIf.cpen));
check('Sup and C Pen posns are in the plan, planned (dashed)', a.raw.items.some((i) => i.role === 'sup' && i.planned) && a.raw.items.some((i) => i.role === 'cpenPosn' && i.planned && i.key === '25151201'));
check('a "Moves in time" row joins the checks', a.res.rows.some((r) => r.name === 'Moves in time'));
check('hidden routes: low sight gives a high covered share', sh.route.coveredPct >= 70, String(sh.route.coveredPct));
const none = run(ground(), { alternates: 'none' });
check('alternates none: no Sup or C Pen posn created (the trigger table still says who would move)', !none.raw.items.some((i) => i.planned) && none.whatIf.triggers.length > 0);

// a canal across the reserve's route to the Sup posn: the route goes round it, or reports no route
const dY = a.raw.slots.find((s) => s.role === 'res').centre.y;
const supY = a.whatIf.sups[0].centre.y;
const midY = (dY + supY) / 2;
const c = run(ground({ canalY: midY, lakes: [] }));
const cs = c.whatIf.triggers.find((x) => x.id === 'sup-A2');
check('a canal across the route: no way round within 1.5 km is reported, not drawn through', cs.route.blocked === true && cs.st === 'fail', cs.reason);
// a canal with a gap (a bridge) 600 m off the line: the route detours through it
const gapX = (a.raw.slots.find((s) => s.role === 'res').centre.x + a.whatIf.sups[0].centre.x) / 2 + 600;
const gB = ground({ canalY: midY });
const gBr = { ...gB, cls: (x, y) => (Math.abs(x - gapX) < 200 && Math.abs(y - midY) < 40 ? 39 : gB.cls(x, y)) };
const cb = W.withMoves(F.fitLayout(inp(gBr)), inp(gBr)).whatIf.triggers.find((x) => x.id === 'sup-A2');
check('a bridge 600 m off the line: the route goes round through it', cb.route.detour === true && !cb.route.blocked, `${Math.round(cb.route.lengthM)} m, ${cb.min} min`);
check('the detour takes longer than the straight move would', cb.route.lengthM > Math.hypot(a.whatIf.sups[0].centre.x - a.raw.slots.find((s) => s.role === 'res').centre.x, supY - dY));

// a lake under Alt A
const altA = a.raw.alternates.find((x) => x.of === 'fwdL');
const lk = run(ground({ lakes: [[altA.centre.x - 200 - a.frame.pivot.x * 0, altA.centre.y - 200, altA.centre.x + 200, altA.centre.y + 200].map((v, i) => v + (i % 2 ? -a.frame.pivot.y : -a.frame.pivot.x))] }));
const lkT = lk.whatIf.triggers.find((x) => x.id === 'shell-fwdL');
check('an alternate on a lake fails its trigger', lkT.st === 'fail' && /NO-GO/.test(lkT.reason), lkT.reason);

// the enemy far away: moves pass; close: they fail (the enemy there first)
const far = run(ground({ from: 30000 }));
check('the enemy 30 km out: the shelled move is in time', far.whatIf.triggers.find((x) => x.id === 'shell-fwdL').st === 'pass', far.whatIf.triggers.find((x) => x.id === 'shell-fwdL').reason);
const near = run(ground({ from: 2500 }));
check('the enemy 2.5 km out: the move is too late', ['fail', 'warn'].includes(near.whatIf.triggers.find((x) => x.id === 'shell-fwdL').st), near.whatIf.triggers.find((x) => x.id === 'shell-fwdL').reason);

// Copy as Text
const txt = S.planText(a.res, '', W.triggerLines(a.whatIf));
check('Copy as Text carries the trigger table with own and enemy times', /TRIGGERS \(who moves/.test(txt) && /Heavy shelling on A Coy/.test(txt) && /enemy \d+ min/.test(txt));

// attack: no what-if
const ra = json('MS/Data/Deployments/Recipes/bn-attk-frontal.json');
const ai = { ...inp(ground()), recipe: ra };
const at = W.withMoves(F.fitLayout(ai), ai);
check('attack: no trigger table (defence only)', at.whatIf.triggers.length === 0);

// ── where the enemy's times start, and his climb in the mountains (the user, 15 Nov 2026: "why it says fail?") ──────
{
  const base = F.fitLayout(inp(ground()));
  const fy = Math.max(...base.raw.slots.filter((s) => r2.slots.find((x) => x.role === s.role)?.kind === 'fwd').map((s) => s.centre.y + s.hM / 2));
  // the synthetic ground is in world metres: the FDL's world y (the plan's pivot is not its origin)
  const yFdl = F.toWorld(base.frame, { x: 0, y: fy }).y;
  // a threat marker 400 m in front of the FDL: inside his FUP distance, so his times start from his FUP
  const near = (enemy) => { const g = ground({ from: Math.round(yFdl + 400), avenues: [0] }); const i = { ...inp(g), threat: { x: 0, y: yFdl + 400 }, enemy }; return W.withMoves(F.fitLayout(i), i); };
  const mech = near(null);
  check('Threat marker inside his FUP distance: his times start from his FUP (tanks 2.5 km, IBB p214), not the marker', mech.whatIf.enemyFromFup && Math.abs(mech.whatIf.enemyFromFup.markerM - 400) <= 100 && mech.whatIf.enemyFromFup.fupM === 2500 && Math.abs(mech.whatIf.enemyToFdlMin - Math.round((2500 / 1000 / 24) * 60)) <= 1, `${JSON.stringify(mech.whatIf.enemyFromFup)}, ${mech.whatIf.enemyToFdlMin} min to the FDL`);
  const inf = near({ echelon: '15', type: 'inf', source: 'user' });
  check('...infantry from theirs, 1 km out (IBB p201): 1 km at 4 km/h', inf.whatIf.enemyFromFup?.fupM === 1000 && Math.abs(inf.whatIf.enemyToFdlMin - 15) <= 1, `${inf.whatIf.enemyToFdlMin} min`);
  const mr = mech.res.rows.find((r) => r.name === 'Moves in time');
  check('...the Moves row and the trigger table say so', /his FUP 2\.5 km out \(the threat marker lies [3-5]\d0 m in front of the FDL/.test(mr?.reason ?? '') && W.triggerLines(mech.whatIf).some((l) => /his FUP 2\.5 km out/.test(l)), mr?.reason);
  check('...a fail names each move\'s times', mr?.st !== 'fail' || /\d+ min against his \d+ min|no route on foot/.test(mr.reason));
  // the row laid out for the reader (the user, 15 Nov 2026: "keep it honest, format it well, suggest why and how to fix")
  const d = mr?.detail;
  check('Moves in time laid out: a headline, one line per move with both times', d && /^\d+ of \d+ in time$/.test(d.head) && d.items.length === mech.whatIf.triggers.length && d.items.every((x) => /: (\d+ min (on foot|mounted)|no route on foot|not timed), his lead vehicles [\d-]+ min \((in time|little to spare|too late|not timed)\)$/.test(x)), d?.items.join(' | '));
  check('...why: his speed and start against yours on foot, half as long again under shelling', /^His lead vehicles come at 24 km\/h on GO \(IPB p 18\) from his FUP 2\.5 km out/.test(d?.why ?? '') && /your Coys move on foot at 4 km\/h, half as long again under shelling/.test(d?.why ?? ''), d?.why);
  check('...fixes tied to the cause: start on the first shelling, mount the Bn, set the enemy if he is infantry', d?.fix[0]?.startsWith('Start the move on the first shelling') && d.fix.some((x) => /MIB or ABIB/.test(x)) && d.fix.some((x) => /En type: Inf/.test(x)), d?.fix.join(' | '));
  check('...the card\'s short forms: a move a line with both times, a one-line why', d?.short?.length === d?.items?.length && d.short.every((x) => /^[A-D] Coy → (alt \(shelled\)|C Pen|Sup \d): (\d+ vs [\d-]+ min|no route|not timed)$/.test(x)) && /^His lead vehicles at 24 km\/h beat Coys on foot at 4 km\/h under shelling$/.test(d.whyShort ?? ''), `${d?.short?.join(' | ')} / ${d?.whyShort}`);
  const infRow = inf.res.rows.find((r) => r.name === 'Moves in time');
  check('...against infantry set by the user: no "set En type" or "mount" fix offered', !infRow?.detail?.fix?.some((x) => /En type|MIB or ABIB/.test(x)), infRow?.detail?.fix?.join(' | '));
  const passRow = W.movesRow({ ...a.whatIf, triggers: a.whatIf.triggers.map((x) => ({ ...x, st: 'pass' })) });
  check('...all in time: the headline and the moves, no why or fix', passRow.st === 'pass' && passRow.detail.items.length && !passRow.detail.why && !passRow.detail.fix);
  const txt = S.planText(mech.res, null, null);
  check('...Copy as Text carries the moves, Why and Fix under the row', /Moves in time[^\n]*\n {6}- [^\n]+too late\)[\s\S]*\n {6}Why: His lead vehicles[\s\S]*\n {6}Fix:\n {8}- Start the move on the first shelling/.test(txt), txt.split('\n').filter((l) => /Moves in time|^ {6}/.test(l)).slice(0, 6).join(' / '));
  const resChk = mech.res.slots.flatMap((s) => s.checks).find((c) => c.name === 'Moves in time');
  check('...the reserve\'s own check is laid out the same way', !resChk || (resChk.detail && /^D Coy: \d+ of \d+ in time$/.test(resChk.detail.head)), resChk?.detail?.head);
  check('A marker beyond his FUP is his start, as before', a.whatIf.enemyFromFup === null && /the threat marker/.test(a.res.rows.find((r) => r.name === 'Moves in time')?.reason ?? ''));
  // the mountains: his infantry pay the climb on the way, as the own moves do; read on a fixed path rising 300 m
  const f0 = base.frame, path = [0, 1, 2, 3].map((k) => F.toWorld(f0, { x: 0, y: 3000 - k * 1000 }));
  const rising = { elev: (x, y) => 200 + (F.toLocal(f0, { x, y }).y < 3000 ? (3000 - F.toLocal(f0, { x, y }).y) * 0.1 : 0) };
  const infE = { echelon: '15', type: 'inf', source: 'user' }, mechE = { echelon: '15', type: 'mech', source: 'user' };
  const T0 = { x: 0, y: 0 };
  const mFlat = W.enemyMinutesTo(f0, doc, path, 100, T0, infE, 'mountain'), mUp = W.enemyMinutesTo(f0, doc, path, 100, T0, infE, 'mountain', { g: rising });
  check('Mountains: his infantry pay 30-60 min per 300 m of climb (MW p 81): 3 km at 3 km/h and 300 m up = 60 + 45 min', mFlat === 60 && mUp === 105, `${mFlat} without the climb, ${mUp} with it`);
  check('...his vehicles do not (they keep to their rates, as the own mounted moves do)', W.enemyMinutesTo(f0, doc, path, 100, T0, mechE, 'mountain', { g: rising }) === W.enemyMinutesTo(f0, doc, path, 100, T0, mechE, 'mountain'));
  check('...nor his infantry on plains ground (the climb figure is the mountains\')', W.enemyMinutesTo(f0, doc, path, 100, T0, infE, 'plains', { g: rising }) === 45);
  const hill = (g) => ({ ...g, elev: (x, y) => 200 + Math.max(0, 3000 - y) * 0.1 });
  const up = (() => { const i = { ...inp(hill(ground())), terrain: 'mountain', enemy: infE }; return W.withMoves(F.fitLayout(i), i); })();
  check('...and the plan says so: the Moves row names it', up.whatIf.enemyClimbs && /his infantry pay the climb as yours do \(MW p 81\)/.test(up.res.rows.find((r) => r.name === 'Moves in time')?.reason ?? ''), up.res.rows.find((r) => r.name === 'Moves in time')?.reason);
  // broken ground: a NO-GO wall between A Coy and its alternate, its only gap 4 km aside (beyond the 1.5 km detour)
  const sh0 = a.whatIf.triggers.find((x) => x.id === 'shell-fwdL');
  const mid = { x: (sh0.route.pts[0].x + sh0.route.pts[sh0.route.pts.length - 1].x) / 2, y: (sh0.route.pts[0].y + sh0.route.pts[sh0.route.pts.length - 1].y) / 2 };
  const mW = F.toWorld(a.frame, mid), gx = mW.x + 4000, yW = mW.y;
  const walled = (wayRound) => {
    const g0 = ground();
    return { ...g0, cls: (x, y) => (Math.abs(y - yW) < 40 && Math.abs(x - gx) > 150 ? 4 : 2),
      avenues: (from, to, wd, prof) => (from.y > 5000 ? g0.avenues(from, to, wd, prof)
        : wayRound ? [{ path: [from, { x: gx, y: from.y > to.y ? yW + 200 : yW - 200 }, { x: gx, y: from.y > to.y ? yW - 200 : yW + 200 }, to], lengthM: 0, goPct: 100, minWidthM: 200, chokes: [] }] : null) };
  };
  const shOf = (g) => W.withMoves(F.fitLayout(inp(g)), inp(g)).whatIf.triggers.find((x) => x.id === 'shell-fwdL');
  const noWay = shOf(walled(false)), round = shOf(walled(true));
  check('Broken ground: no short detour gets round and no way is found: still "no route"', noWay.route.blocked && noWay.st === 'fail' && /no route on foot/.test(noWay.reason), noWay.reason);
  check('...a way round on the ground (as his approach is found) is taken: the move has a route, through the gap, timed by its length', !round.route.blocked && round.route.detour && round.route.pts.some((p) => Math.abs(F.toWorld(a.frame, p).x - gx) < 1) && round.min > sh0.min && round.route.lengthM > 7000, `${round.min} min for ${Math.round(round.route.lengthM)} m (open ground ${sh0.min} min)`);
  // a way that does not start and end at the move is not taken (a stray path)
  const stray = shOf({ ...walled(false), avenues: (from, to, wd, prof) => (from.y > 5000 ? ground().avenues(from, to, wd, prof) : [{ path: [{ x: gx, y: yW + 3000 }, { x: gx, y: yW - 3000 }], lengthM: 0, goPct: 100, minWidthM: 200, chokes: [] }]) });
  check('...a way that does not start and end where the move does is not taken', stray.route.blocked);
  // the found way's straight stretch between two of its points clips the wall at a bend (seen at Kotli: a river bank)
  const viaPts = (ys) => (from, to, wd, prof) => (from.y > 5000 ? ground().avenues(from, to, wd, prof) : [{ path: [from, ...ys.map((y) => ({ x: gx + 160, y: from.y > to.y ? yW + y : yW - y })), to], lengthM: 0, goPct: 100, minWidthM: 200, chokes: [] }]);
  const clip = shOf({ ...walled(false), avenues: viaPts([200, -200]) });
  check('...a found way that clips NO-GO between two of its points is still a way (counted SLOW-GO)', !clip.route.blocked && clip.route.slowPct > 0, `${clip.min} min, ${clip.route.slowPct} % SLOW-GO`);
  const onIt = shOf({ ...walled(false), avenues: viaPts([200, 0, -200]) });
  check('...one with a point of its own in NO-GO is not', onIt.route.blocked);
  // enemyMinutesTo itself: the pad adds his way back to the FUP at his rates
  const m0 = W.enemyMinutesTo(f0, doc, path, 100, T0, infE, 'plains'), m1 = W.enemyMinutesTo(f0, doc, path, 100, T0, infE, 'plains', { padM: 1000 });
  check('enemyMinutesTo: 3 km at 4 km/h = 45 min; 1 km of pad adds 15', m0 === 45 && m1 === 60, `${m0}, ${m1}`);
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
