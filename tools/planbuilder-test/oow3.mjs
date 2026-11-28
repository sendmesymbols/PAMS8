// oow3.mjs -- checks what the re-read of Operations of War Vol III Withdrawal (GSP 6-100-0, 2006) added on 28 Nov 2026
// (OOW3_Review.md): passage lanes and a contact point at every posn passed through (s10 pp 47-51, Annex P); Int Posn 2 and
// the new posn read on the ground (s6 para 16 p 33; the primary demolition belt on a natural obstacle, s12 pp 54-56); the
// ridge in the view rows (para 16 a); defiles and bridges on the routes back (pp 12, 28, 46, 55, 63); a night withdrawal
// finished before daylight (s9 para 1 p 44); the by-day sequence (p 41); the covering troops in plain country (pp 10-11, 32).
//   node tools/planbuilder-test/oow3.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const Wd = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawal.ts');
const Wf = await import('../../MS/Engines/DeploymentBuilder/PlanWithdrawalFmn.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');
const F = await import('../../MS/Engines/DeploymentBuilder/PlanFit.ts');

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const quiet = process.argv.includes('--quiet');
const json = (p) => JSON.parse(readFileSync(resolve(repo, p), 'utf8'));
let n = 0, fails = 0;
function check(name, ok, info = '') {
  n++;
  if (!ok) fails++;
  if (!ok || !quiet) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const doc = { plan: json('MS/Data/PlanDoctrine.json'), ocoka: json('MS/Data/OcokaDoctrine.json') };
const ctx = { doc, symbols: json('MS/Data/Symbols.json') };
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const row = (rows, name) => rows.find((r) => r.name === name);
const item = (res, role) => res.items.find((i) => i.role === role);
const top = (pts) => Math.min(...pts.map((p) => p.y));
const frameFor = (res, anchor = { x: 0, y: 0 }) => ({ anchor, bearing: 0, k: 1, pivot: item(res, 'hq').pts[0] });

/**
 * Open ground in world metres (anchor 0,0): water bands across the way at `waterY` (class 20, 40 m wide) with bridges
 * (class 39) where |x - b| < 30 for each b in `bridgesX`; `via`: every route routed through that point; `elev` a function.
 */
const ground = ({ waterY = [], bridgesX = [], roadsX = [], via = null, elev = () => 200, known = true, ox = 0, oy = 0 } = {}) => {
  const cls = (x0, y0) => {
    if (!known) return null;
    const x = x0 - ox, y = y0 - oy;
    if (waterY.some((w) => Math.abs(y - w) < 20)) return bridgesX.some((b) => Math.abs(x - b) < 30) ? 39 : roadsX.some((b) => Math.abs(x - b) < 30) ? 36 : 20;
    return 2;
  };
  return {
    cls, elev: (x, y) => (known ? elev(x - ox, y - oy) : NaN), going: goingOf, label: (c) => `C${c}`,
    sight: () => (known ? 0.9 : null),
    avenues(from, to) { if (!known) return null; return [{ path: via ? [from, { x: via.x + ox, y: via.y + oy }, to] : [from, to], lengthM: 0, goPct: 90, minWidthM: 500, chokes: [] }]; },
    pending: () => false, dataLine: () => 'synthetic ground',
  };
};

// ── passage at every posn passed through (s10 paras 1-3 pp 47-50; Annex P p 75) ────────────────────────────────────
for (const id of ['bde-wdr-night', 'div-wdr-night']) {
  const r = rec(id);
  const iss = V.validateRecipe(r, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');
  check(`${id} validates with the new passage slots`, !iss.length, iss.map((i) => i.msg).join('; '));
  const roles = r.slots.map((s) => s.role);
  check(`${id}: two passage points and a contact point at Int Posn 1, Int Posn 2 and the new posn`, ['ppI1', 'ppI2', 'ctI', 'ppII1', 'ppII2', 'ctII', 'ppN1', 'ppN2', 'ctN'].every((x) => roles.includes(x)));
  const g = Wd.withdrawalGeom(r, doc, 60000);
  const onFront = (pp, posn) => Math.abs(g[pp].pts[0].y - top(g[posn].pts)) < 1;
  check(`${id}: aimed 60 km: the passage points follow each posn, on its front edge`, onFront('ppII1', 'intPosn2') && onFront('ctII', 'intPosn2') && onFront('ppN1', 'newMain') && onFront('ctN', 'newMain') && g.ppN1.pts[0].x < g.ppN2.pts[0].x);
  const res = S.solveRecipe(r, ctx);
  const pas = row(res.rows, 'Passage');
  check(`${id}: Passage passes, naming all three posns`, pas?.st === 'pass' && /the intermediate posn: 2 lanes/.test(pas.reason) && /Int Posn 2: 2 lanes/.test(pas.reason) && /the new posn: 2 lanes/.test(pas.reason) && /p 47/.test(pas.reason), pas?.reason?.slice(0, 120));
  const noCt = res.items.filter((i) => i.role !== 'ctN');
  check(`${id}: no contact point at the new posn: Passage warns`, row(Wd.withdrawalGeometryRows(noCt, r, doc).rows, 'Passage')?.st === 'warn');
  // the switches take an int posn's passage with it, the new posn keeps its own
  const w1 = Wf.withWdrOptions(r, doc, { intPosns: 1, newPosnBy: 'fresh' }), w0 = Wf.withWdrOptions(r, doc, { intPosns: 0, newPosnBy: 'fresh' });
  const r1 = w1.slots.map((s) => s.role), r0 = w0.slots.map((s) => s.role);
  check(`${id}: one int posn: Int Posn 2's lanes gone, Int Posn 1's and the new posn's kept`, !['ppII1', 'ppII2', 'ctII'].some((x) => r1.includes(x)) && ['ppI1', 'ctI', 'ppN1', 'ctN'].every((x) => r1.includes(x)));
  const s0 = S.solveRecipe(w0, ctx);
  check(`${id}: no int posn: only the new posn's lanes; Passage reads the new posn (before: no passage at all)`, !['ppI1', 'ctI', 'ppII1', 'ctII'].some((x) => r0.includes(x)) && /through the new posn/.test(row(s0.rows, 'Passage')?.reason ?? '') && row(s0.rows, 'Passage')?.st === 'pass', row(s0.rows, 'Passage')?.reason?.slice(0, 80));
  // grey without the ground: the new rows, only those that apply
  const grey = (rs, nm) => row(rs, nm)?.st === 'unchecked';
  check(`${id}: without the ground Int posn 2 obstacle, New posn obstacle, Defiles on routes and Before daylight are grey`, ['Int posn 2 obstacle', 'New posn obstacle', 'Defiles on routes', 'Before daylight'].every((x) => grey(res.rows, x)));
  check(`${id}: no int posn: no grey Behind an obstacle or Int posn 2 obstacle left over`, !row(s0.rows, 'Behind an obstacle') && !row(s0.rows, 'Int posn 2 obstacle') && grey(s0.rows, 'New posn obstacle'));
}
{
  const r = rec('bn-wdr-night');
  const res = S.solveRecipe(r, ctx);
  check('bn-wdr-night: Passage still the int posn\'s alone, worded as before', /^2 passage lanes and a contact point through the intermediate posn/.test(row(res.rows, 'Passage')?.reason ?? ''));
  check('bn-wdr-night: Defiles on routes and Before daylight grey without the ground', row(res.rows, 'Defiles on routes')?.st === 'unchecked' && row(res.rows, 'Before daylight')?.st === 'unchecked');
}

// ── every intermediate posn and the new posn on the ground (s6 para 16 p 33; s12 pp 54-56) ───────────────────────────
{
  const r = rec('bde-wdr-night');
  const res = S.solveRecipe(r, ctx);
  const f = frameFor(res);
  const ip1 = item(res, 'intPosn'), ip2 = item(res, 'intPosn2'), nm = item(res, 'newMain');
  const yIp2 = top(ip2.pts) - 2000, yNm = top(nm.pts) - 600, yFar = top(nm.pts) - 5000;
  const both = Wd.findWithdrawal(res, f, ground({ waterY: [top(ip1.pts) - 2000, yIp2, yNm] }), doc, { date: '2026-12-21' });
  check('water 2 km in front of Int Posn 2: Int posn 2 obstacle passes (OOW3 p 33 para 16 b), its view and flanks read', row(both.rows, 'Int posn 2 obstacle')?.st === 'pass' && /in front of Int Posn 2/.test(row(both.rows, 'Int posn 2 obstacle').reason) && !!row(both.rows, 'Int posn 2 view') && !!row(both.rows, 'Int posn 2 flanks'), row(both.rows, 'Int posn 2 obstacle')?.reason?.slice(0, 80));
  check('a canal 600 m in front of the new posn: New posn obstacle passes, the primary demolition belt on it (pp 54-56)', row(both.rows, 'New posn obstacle')?.st === 'pass' && /primary demolition belt on it/.test(row(both.rows, 'New posn obstacle').reason));
  const none = Wd.findWithdrawal(res, f, ground({ waterY: [top(ip1.pts) - 2000, yFar] }), doc, { date: '2026-12-21' });
  check('no water before Int Posn 2: warns with why and fix', row(none.rows, 'Int posn 2 obstacle')?.st === 'warn' && row(none.rows, 'Int posn 2 obstacle').detail?.fix?.length === 2);
  check('the only canal 5 km in front of the new posn (beyond 1.5 km, beltWaterWithinM E): New posn obstacle warns, mines and ditches', row(none.rows, 'New posn obstacle')?.st === 'warn' && /mines and ditches/.test(row(none.rows, 'New posn obstacle').reason), row(none.rows, 'New posn obstacle')?.reason?.slice(0, 90));
  check('the Bn plan has no demolition belt: no New posn obstacle row', !row(Wd.findWithdrawal(S.solveRecipe(rec('bn-wdr-night'), ctx), frameFor(S.solveRecipe(rec('bn-wdr-night'), ctx)), ground(), doc, {}).rows, 'New posn obstacle'));
  // the ridge: ground falling away in front of Int Posn 1 (the En side is -y)
  const slope = Wd.findWithdrawal(res, f, ground({ elev: (x, y) => 200 + y * 0.01 }), doc, { date: '2026-12-21' });
  const v1 = row(slope.rows, 'Int posn view')?.reason ?? '';
  check('ground rising toward the rear: the view row says how far its front stands above the ground 1-2 km in front (para 16 a)', /its front 15 m above the ground 1-2 km in front/.test(v1), v1.slice(0, 130));
}

// ── defiles and bridges on the routes back (pp 12, 28, 46, 55, 63) ──────────────────────────────────────────────────
{
  const r = rec('bde-wdr-night');
  const res = S.solveRecipe(r, ctx);
  const f = frameFor(res);
  const canal = 5000;
  // the routes run straight back at x = -3000, 0, +3000 (Route A, C, B)
  const own = Wd.findWithdrawal(res, f, ground({ waterY: [canal], bridgesX: [-3000, 0, 3000] }), doc, {});
  const d1 = row(own.rows, 'Defiles on routes');
  check('a bridge on each route: Defiles on routes passes, naming each bridge, AD / AT / security det and reserve demolitions', d1?.st === 'pass' && (d1.reason.match(/a Cl 60\+ bridge at/g) ?? []).length === 3 && /reserve demolitions/.test(d1.reason) && /p 44/.test(d1.reason), d1?.reason?.slice(0, 140));
  const one = Wd.findWithdrawal(res, f, ground({ waterY: [canal], bridgesX: [0], via: { x: 0, y: canal } }), doc, {});
  const d2 = row(one.rows, 'Defiles on routes');
  check('every route routed over the one bridge: warns, one defile for the whole withdrawal (p 46), with fixes', d2?.st === 'warn' && /one defile for the whole withdrawal/.test(d2.reason) && d2.detail?.fix?.length === 3, d2?.reason?.slice(0, 120));
  const wet = Wd.findWithdrawal(res, f, ground({ waterY: [canal], bridgesX: [-3000, 0] }), doc, {});
  const d3 = row(wet.rows, 'Defiles on routes');
  check('a route straight across water with no crossing: warns, recce a crossing', d3?.st === 'warn' && /crosses a canal or permanent water with no crossing on the map/.test(d3.reason), d3?.reason?.slice(0, 120));
  const road = Wd.findWithdrawal(res, f, ground({ waterY: [canal], bridgesX: [-3000, 0], roadsX: [3000] }), doc, {});
  const d4 = row(road.rows, 'Defiles on routes');
  check('a road over the canal with no bridge class (the grid paints the road over its bridge): a road crossing to recce, not "no crossing"', d4?.st === 'pass' && /a road crossing, its bridge class not recorded/.test(d4.reason), d4?.reason?.slice(0, 160));
  const dry = Wd.findWithdrawal(res, f, ground(), doc, {});
  check('no water on the routes: passes, still AD and security at the bottlenecks', row(dry.rows, 'Defiles on routes')?.st === 'pass' && /no water crossed/.test(row(dry.rows, 'Defiles on routes').reason));
  check('the ground not loaded: Defiles on routes grey', row(Wd.findWithdrawal(res, f, ground({ known: false }), doc, {}).rows, 'Defiles on routes')?.st === 'unchecked');
  check('withdrawal.defileSharedM is a method setting (M) with its reason', doc.plan.withdrawal.defileSharedM?.basis === 'M' && !!doc.plan.withdrawal.defileSharedM.src);
}

// ── before daylight (s9 para 1 p 44) ─────────────────────────────────────────────────────────────────────────────────
{
  const r = rec('bn-wdr-night');
  const res = S.solveRecipe(r, ctx);
  // places at 74.3 E (the PKT clock fits there): Lahore at 31.5 N; 55 N for a short summer night
  const at = (latDeg) => ({ x: 6378137 * ((74.3 * Math.PI) / 180), y: 6378137 * Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360)) });
  const fdAt = (lat, date) => { const a = at(lat); return Wd.findWithdrawal(res, { ...frameFor(res, a), k: 1 / Math.cos((lat * Math.PI) / 180) }, ground({ ox: a.x, oy: a.y }), doc, { date }); };
  const lahoreWinter = row(fdAt(31.5, '2026-12-21').rows, 'Before daylight');
  check('Lahore, midwinter: a Bn night withdrawal finishes before daylight, the programme, the drive to the int posn and tonight\'s light named', lahoreWinter?.st === 'pass' && /rear parties leave at L\+/.test(lahoreWinter.reason) && /8 km\/h by night, blacked out \(IPB p 18\)/.test(lahoreWinter.reason) && /civil twilight/.test(lahoreWinter.reason) && /pp 43-44/.test(lahoreWinter.reason), lahoreWinter?.reason?.slice(0, 160));
  const north = row(fdAt(55, '2026-06-21').rows, 'Before daylight');
  check('55 N in midsummer (a short night): warns, with the fix over two nights (Annex A p 71)', north?.st === 'warn' && north.detail?.fix?.some((x) => /two nights/.test(x)), north?.reason?.slice(0, 160));
  check('moves.vehNightKmh 8, IPB p 18', doc.plan.moves.vehNightKmh?.value === 8 && doc.plan.moves.vehNightKmh.refs?.[0]?.page === '18');
  const day = S.solveRecipe(rec('bn-wdr-day'), ctx);
  check('a withdrawal by day has no Before daylight row', !row(Wd.findWithdrawal(day, frameFor(day), ground(), doc, {}).rows, 'Before daylight'));
}

// ── text: the by-day sequence, the covering troops, Check my plan of a variant ───────────────────────────────────────
{
  const day = S.solveRecipe(rec('bn-wdr-day'), ctx);
  check('by day: the sequence starts with the recce parties, AD deployed and the non-essentials, as by night (OOW3 p 41 para 2 a)', /AD deployed at the points likely to be attacked/.test(row(day.rows, 'Sequence')?.reason ?? ''));
  const div = S.solveRecipe(rec('div-wdr-night'), ctx);
  check('covering troops: in plain country fully mobile (armour, recce, mot inf; pp 10-11), small forces cannot hold where there is room to manoeuvre (p 32)', /s2 para 7 a pp 10-11/.test(row(div.rows, 'Covering tps')?.reason ?? '') && /s6 para 13 p 32/.test(row(div.rows, 'Covering tps').reason));
  for (const [o, tag] of [[{ intPosns: 0, newPosnBy: 'fresh' }, 'no int posn'], [{ intPosns: 1, newPosnBy: 'res' }, 'one int posn, Res Bde']]) {
    const v = Wf.withWdrOptions(rec('div-wdr-night'), doc, o);
    const inp = { recipe: v, ctx, opts: {}, ground: ground(), anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', cursor: { x: 0, y: 60000 } };
    const fl = F.fitLayout(inp);
    const drawn = {};
    for (const i of fl.raw.items) if (!drawn[i.role]) drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fl.frame, p); return [w.x, w.y]; }) };
    const ck = Wd.checkWithdrawal(inp, drawn);
    check(`Check my plan of a Div withdrawal built with ${tag}: nothing it left out reported missing`, !!ck && !ck.missing.length, ck ? ck.missing.join(', ') : 'null');
  }
  check('the s9 page cite reads pp 43-47 (the book\'s section 9)', !JSON.stringify(doc.plan).includes('s9 pp 44-48'));
}

// ── time and space (OOW3 s2 para 6 pp 9-10; KYE 2019 rates; OOW1 p 39 prep) ──────────────────────────────────────────
{
  const ts = (id, extra = {}, o = {}) => { const r = { ...rec(id), ...extra }; return Wf.timeSpaceRow(S.solveRecipe(r, ctx).items, r, doc, o); };
  const bde = ts('bde-wdr-night');
  check('Bde withdrawal: Time and space passes against the new posn\'s 36 h prep (OOW1 p 39) at the En Mech\'s fastest, 30 km a day (KYE PDF p 92), the hops listed', bde?.st === 'pass' && bde.m === 47 && /36 working h/.test(bde.reason) && /KYE 2019 PDF p 92/.test(bde.reason) && /Int Posn 1 \(Bn\) to Int Posn 2 \(Bn\)/.test(bde.reason) && /11 h in hand/.test(bde.reason), bde?.reason?.slice(0, 120));
  const ord = ts('bde-wdr-night', { wdrDelayH: 72 });
  check('...72 h ordered: warns 25 h short, about 9 h more at each of the 3 posns, with fixes (OOW3 p 10 para 6 c)', ord?.st === 'warn' && /25 h short/.test(ord.reason) && /each of the 3 posns must hold the En about 9 h more/.test(ord.reason) && ord.detail?.fix?.length === 5, ord?.reason?.slice(300, 520));
  check('...an Inf En: 10-25 km a day (KYE PDF p 216), slower, more in hand', ts('bde-wdr-night', {}, { enemy: 'inf' })?.m === 56 && /Inf Div advances 10-25 km a day/.test(ts('bde-wdr-night', {}, { enemy: 'inf' }).reason));
  check('...mountain ground: the Mtn Div\'s 8-10 km a day (KYE PDF p 217)', /Mtn Div advances 8-10 km a day/.test(ts('bde-wdr-night', {}, { terrain: 'mountain' })?.reason ?? ''));
  const g30 = Wd.withdrawalGeom(rec('div-wdr-night'), doc, 30000);
  const short = Wf.timeSpaceRow(S.solveRecipe(rec('div-wdr-night'), ctx, { geom: g30 }).items, rec('div-wdr-night'), doc, {});
  check('Div withdrawal aimed 30 km: under 36 h at the En\'s fastest, warns', short?.st === 'warn', short?.reason?.slice(0, 90));
  check('Bn withdrawal: no row unless a delay is ordered (the new main posn is the higher Comd\'s); 24 h ordered: warns, 20 h to the new posn', ts('bn-wdr-night') === null && ts('bn-wdr-night', { wdrDelayH: 24 })?.st === 'warn' && ts('bn-wdr-night', { wdrDelayH: 24 }).m === 20);
  check('delay and by-day layouts: no Time and space row (their own Delay time / Sequence rows)', ts('bn-delay', { wdrDelayH: 24 }) === null && ts('bn-wdr-day', { wdrDelayH: 24 }) === null);
  check('the row in the geometry rows and on the ground (findWithdrawal, the En type passed)', !!row(S.solveRecipe(rec('div-wdr-night'), ctx).rows, 'Time and space') && /Inf Div/.test(row(Wd.findWithdrawal(S.solveRecipe(rec('div-wdr-night'), ctx), frameFor(S.solveRecipe(rec('div-wdr-night'), ctx)), ground(), doc, { enemy: 'inf' }).rows, 'Time and space')?.reason ?? ''));
  const ka = doc.plan.withdrawal.timeSpace.enAdvanceKmDay;
  check('KYE a PlanDoctrine source; the rates D with checked refs on PDF pp 92, 216, 217', !!doc.plan.sources.KYE && ['armd', 'inf', 'mountain'].every((k) => ka[k].basis === 'D' && ka[k].refs.every((r) => r.checked?.status === 'ok')));
  const tab = readFileSync(resolve(repo, 'MS/Engines/DeploymentBuilder/PlanBuildTab.ts'), 'utf8');
  check('the tab: Delay chips Prep / 24 / 48 / 72 / 96 h on a withdrawal, carried to the recipe as wdrDelayH', /data: 'wdrDelay:prep'/.test(tab) && /\[24, 48, 72, 96\]/.test(tab) && /wdrDelayH: this\._wdrDelayH/.test(tab));
}

// ── N2: the delay means as symbols (OOW3 s6 para 27 p 36; s12 para 5 b-c pp 56-57) ──────────────────────────────────
{
  const base = rec('bde-wdr-night');
  const m2 = Wf.withWdrOptions(base, doc, { intPosns: 2, newPosnBy: 'fresh', means: true });
  const roles = m2.slots.map((s) => s.role);
  check('Delay means on: id -w2m; two stay-behind parties, a subsidiary belt per int posn, a road denial band', m2.id === 'bde-wdr-night-w2m' && ['sbA', 'sbB', 'dmlSub1', 'dmlSub2', 'rdBand'].every((r) => roles.includes(r)) && m2.wdrMeans === true);
  check('...valid recipe', !V.validateRecipe(m2, { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail').length);
  const g = Wd.withdrawalGeom(m2, doc, 60000);
  const s = S.solveRecipe(m2, ctx, { geom: g });
  const it = (r) => item(s, r), bot = (pts) => Math.max(...pts.map((p) => p.y));
  check('...each subsidiary belt 200 m in front of its int posn (standoff.obstacleInFrontM)', Math.abs(it('dmlSub1').pts[0].y - (top(it('intPosn').pts) - 200)) < 1 && Math.abs(it('dmlSub2').pts[0].y - (top(it('intPosn2').pts) - 200)) < 1);
  const band = it('rdBand');
  check('...the road denial band across the whole front, behind the first covering troops and short of Int Posn 1, 4.8 km deep (E)', top(band.pts) > bot(it('cov1').pts) && bot(band.pts) < top(it('intPosn').pts) && Math.abs(bot(band.pts) - top(band.pts) - 4800) < 1, `${top(band.pts)}-${bot(band.pts)}`);
  check('...Delay means passes, citing pp 36, 56-57', row(s.rows, 'Delay means')?.st === 'pass' && /s6 para 27 p 36/.test(row(s.rows, 'Delay means').reason) && /p 57 para 5 c/.test(row(s.rows, 'Delay means').reason));
  check('one int posn: one subsidiary belt; the default plan has no Delay means row', !Wf.withWdrOptions(base, doc, { intPosns: 1, newPosnBy: 'fresh', means: true }).slots.some((x) => x.role === 'dmlSub2') && !row(S.solveRecipe(base, ctx).rows, 'Delay means'));
  const g30 = Wd.withdrawalGeom(m2, doc, 25000);
  const tight = row(S.solveRecipe(m2, ctx, { geom: g30 }).rows, 'Delay means');
  check('aimed 25 km: the band thinner than several miles where the space runs out: warns', tight?.st === 'warn' && /only/.test(tight.reason), tight?.reason?.slice(-90));
  const inp = { recipe: m2, ctx, opts: {}, ground: ground(), anchor: { x: 0, y: 0 }, bearing: 0, threat: null, terrain: 'plains', cursor: { x: 0, y: 60000 } };
  const fl = F.fitLayout(inp);
  const drawn = {};
  for (const i of fl.raw.items) if (!drawn[i.role]) drawn[i.role] = { pts: i.pts.map((p) => { const w = F.toWorld(fl.frame, p); return [w.x, w.y]; }) };
  const ck = Wd.checkWithdrawal(inp, drawn);
  check('Check my plan of a -w2m plan reads the Delay means row', !!ck && row(ck.rows, 'Delay means')?.st === 'pass');
  check('PlanDoctrine withdrawal.formation.roadDenialDepthM: E, decided and searched', doc.plan.withdrawal.formation.roadDenialDepthM?.basis === 'E' && !!doc.plan.withdrawal.formation.roadDenialDepthM.searched);
}

// ── N3 civil population, N4 weather, N5 HQ by the artery ────────────────────────────────────────────────────────────
{
  const r = rec('bde-wdr-night');
  const res = S.solveRecipe(r, ctx);
  const f = frameFor(res);
  const with_ = (over) => ({ ...ground(), ...over });
  // N3: Route A (x = -3000, y -1000 to 6000) through a town at y 3000-3300; 400 people a km2 everywhere
  const town = (x, y) => (Math.abs(x + 3000) < 400 && y > 3000 && y < 3300 ? 3 : ground().cls(x, y));
  const mov = { people: () => 400, features: () => [] };
  const c1 = row(Wd.findWithdrawal(res, f, with_({ cls: town, mov: () => mov }), doc, {}).rows, 'Civil population');
  check('N3: Route A 300 m through a built-up area: Civil population warns, names it, the people counted (WorldPop), the book\'s rules (pp 68-70)', c1?.st === 'warn' && /Route A runs 300 m through a built-up area/.test(c1.reason) && /people live in the/.test(c1.reason) && /p 70 para 4/.test(c1.reason) && c1.detail?.fix?.length === 3, c1?.reason?.slice(0, 160));
  const c2 = row(Wd.findWithdrawal(res, f, with_({ mov: () => mov }), doc, {}).rows, 'Civil population');
  check('...no town on the routes: passes', c2?.st === 'pass' && /no route back runs through a built-up area/.test(c2.reason));
  check('...a Bn withdrawal: no Civil population row (the highest level decides, p 70)', !row(Wd.findWithdrawal(S.solveRecipe(rec('bn-wdr-night'), ctx), frameFor(S.solveRecipe(rec('bn-wdr-night'), ctx)), with_({ mov: () => mov }), doc, {}).rows, 'Civil population'));
  // N4: the month's visibility
  const vis = (v) => ({ visibility: () => v });
  const foggy = { fogPct: 20, hazePct: 15, lt2kmPct: 30, meanViewKm: 4.2, stationKm: 20 }, clear = { fogPct: 2, hazePct: 3, lt2kmPct: 4, meanViewKm: 9, stationKm: 20 };
  const day = S.solveRecipe(rec('bn-wdr-day'), ctx);
  const w1 = row(Wd.findWithdrawal(day, frameFor(day), with_(vis(foggy)), doc, { date: '2026-12-15' }).rows, 'Weather');
  check('N4: by day in a foggy December (35 % poor-view days): Weather passes, wait for such a day (OOW3 p 9; dayWeatherMinPct 25, E)', w1?.st === 'pass' && /Dec at the old posn/.test(w1.reason) && /35 %/.test(w1.reason) && /p 9/.test(w1.reason), w1?.reason?.slice(0, 120));
  const w2 = row(Wd.findWithdrawal(day, frameFor(day), with_(vis(clear)), doc, { date: '2026-05-15' }).rows, 'Weather');
  check('...by day in a clear month: warns, withdraw by night or smoke and air', w2?.st === 'warn' && w2.detail?.fix?.length === 3);
  const w3 = row(Wd.findWithdrawal(res, f, with_(vis(foggy)), doc, { date: '2026-12-15' }).rows, 'Weather');
  check('...by night: passes, fog and haze cover it too', w3?.st === 'pass' && /covers a night withdrawal/.test(w3.reason));
  check('...the grid still loading: grey; no visibility reader: no row', row(Wd.findWithdrawal(res, f, with_({ visibility: () => null, pending: () => true }), doc, {}).rows, 'Weather')?.st === 'unchecked' && !row(Wd.findWithdrawal(res, f, ground(), doc, {}).rows, 'Weather'));
  // N5: the HQ by the artery
  const road = (dx) => (x, y) => (Math.abs(x - dx) < 20 ? 34 : ground().cls(x, y));
  const h1 = row(Wd.findWithdrawal(res, f, with_({ cls: road(600), mov: () => mov }), doc, {}).rows, 'HQ by the artery');
  check('N5: a Cl 60 road 600 m from the Bde HQ: passes (hqArteryM 1 km, E; OOW3 p 65 para 16)', h1?.st === 'pass' && /p 65/.test(h1.reason), h1?.reason?.slice(0, 100));
  const h2 = row(Wd.findWithdrawal(res, f, with_({ cls: road(2400), mov: () => mov }), doc, {}).rows, 'HQ by the artery');
  check('...the road 2.4 km off: warns, with fixes', h2?.st === 'warn' && /2\.4 km off/.test(h2.reason) && h2.detail?.fix?.length === 3, h2?.reason?.slice(0, 100));
  const tel = { people: () => 400, features: () => [{ kind: 'telephone_exchange', label: 'Telephone exchange', name: '', distM: 700 }] };
  check('...no road, but a telephone exchange 700 m off: an existing signal centre, passes', row(Wd.findWithdrawal(res, f, with_({ mov: () => tel }), doc, {}).rows, 'HQ by the artery')?.st === 'pass');
  const wd = doc.plan.withdrawal;
  check('the new figures backed: dayWeatherMinPct and hqArteryM E (decided, searched), buaRunM M', wd.dayWeatherMinPct?.basis === 'E' && !!wd.dayWeatherMinPct.searched && wd.hqArteryM?.basis === 'E' && !!wd.hqArteryM.searched && wd.buaRunM?.basis === 'M' && !!wd.buaRunM.src);
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
