// gaps2.mjs -- checks the second round of doctrine gaps filled from the 24 Nov 2026 book review (Doctrine_Review.md):
// the Bn Adv Gd (IBB pp 133-150, Fig 12; MIB pp 81-84), the Armd Div on a broad front (OoW Vol II pp 52-53; DW pp 35,
// 55), halting areas sited on the ground (IBB p 160; OoW Vol II p 12), and the checks added after them. Every rule cites
// its book and page in the row it writes.
//   node tools/planbuilder-test/gaps2.mjs          (add --quiet to print only failures and the summary)
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register('../movement-test/hooks.mjs', import.meta.url);
const S = await import('../../MS/Engines/DeploymentBuilder/PlanSolve.ts');
const Av = await import('../../MS/Engines/DeploymentBuilder/PlanAdvance.ts');
const V = await import('../../MS/Engines/DeploymentBuilder/PlanRecipes.ts');

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
const rec = (id) => json(`MS/Data/Deployments/Recipes/${id}.json`);
const row = (rows, name) => rows.find((r) => r.name === name);
const rules = json('MS/Data/terrain-bundle/rules.json');
const goingOf = (p) => ({ nogo: new Set(rules.profiles[p].nogo), caution: new Set(rules.profiles[p].caution ?? []) });
const mk = (cls, extra = {}) => ({ cls, elev: () => 200, going: goingOf, label: (c) => rules.classes[c]?.label ?? `class ${c}`, pending: () => false, dataLine: () => 'synthetic', ...extra });
const A = { x: 8200000, y: 3700000 };
const OPEN = 0, TREES = 1, CANAL = 20, BR60 = 39, BUA = 3;
const inp = (recipe, ground, bearing = 0) => ({ recipe, ctx, opts: {}, ground, anchor: A, bearing });
const valid = (id) => V.validateRecipe(rec(id), { doc, symbols: ctx.symbols }).filter((i) => i.level === 'fail');

// ── the Bn Adv Gd (IBB pp 133-150, Fig 12; MIB pp 81-84) ───────────────────────────────────────────────────────────────
{
  const r = rec('bn-advance-one-up');
  check('bn-advance-one-up validates and is offered as the Bn Advance family', !valid('bn-advance-one-up').length && json('MS/Data/Deployments/Recipes/index.json').families.find((f) => f.id === 'bn-advance')?.recipes.includes('bn-advance-one-up'), valid('bn-advance-one-up').map((i) => i.msg).join('; '));
  const sv = S.solveRecipe(r, ctx, {});
  check('...an advance of the Bn kind (it has a Bn HQ)', Av.advanceKind(sv.items) === 'bn');
  const day = Av.advanceRows(sv.items, doc, 'first');
  check('by day: the vanguard a Coy group (IBB p 138), its gaps in time, not space (p 138 para 4)', row(day, 'Vanguard')?.st === 'pass' && /IBB S33 para 3 p 138/.test(row(day, 'Vanguard').reason) && /time, not space/.test(row(day, 'Vanguard').reason), row(day, 'Vanguard')?.reason);
  check('...the main guard behind, the follow-up Coys a Pl about every 100-300 m (IBB p 139)', row(day, 'Main Gd')?.st === 'pass' && /100-300 m/.test(row(day, 'Main Gd').reason), row(day, 'Main Gd')?.reason);
  check('...Bn HQ one bound behind the rear troops of the vanguard (MIB p 81 b)', row(day, 'Bn HQ')?.st === 'pass' && /MIB p 81 para 22 b/.test(row(day, 'Bn HQ').reason));
  check('...tanks in the vanguard by day and night (MIB p 82 e)', row(day, 'Tanks')?.st === 'pass' && /MIB p 82 para 22 e/.test(row(day, 'Tanks').reason));
  check('...the mortars and ATGM well forward (MIB p 82 g, h)', row(day, 'Mortars, ATGM, RR')?.st === 'pass');
  check('...at least 800 m cleared either side of the axis by day (IBB p 133)', /800 m either side/.test(row(day, 'Flank clearance')?.reason ?? '') && /IBB S32 para 2 i \(1\) p 133/.test(row(day, 'Flank clearance').reason));
  const night = Av.advanceRows(sv.items, doc, 'last');
  check('by night: the main guard 900 m behind the vanguard\'s tail: at least 300-400 m (IBB p 149), Fig 12\'s 800-900 m link groups (p 150)', row(night, 'Main Gd')?.st === 'pass' && /IBB p 149 para 4 d \(4\)/.test(row(night, 'Main Gd').reason) && /800-900 m/.test(row(night, 'Main Gd').reason) && !/here (shorter|longer)/.test(row(night, 'Main Gd').reason), row(night, 'Main Gd')?.reason);
  check('...the vanguard 500-600 m deep by night (Fig 12)', /500 m-600 m deep \(IBB Fig 12 p 150\)/.test(row(night, 'Vanguard')?.reason ?? ''), row(night, 'Vanguard')?.reason);
  const close = sv.items.map((i) => (['bnHq', 'mor', 'mainGd'].includes(i.role) ? { ...i, pts: i.pts.map((p) => ({ x: p.x, y: -700 })) } : i));
  const cr = row(Av.advanceRows(close, doc, 'last'), 'Main Gd');
  check('...closed up to 150 m behind the vanguard by night: inside his small arms, warn with a fix', cr?.st === 'warn' && cr.detail?.fix?.length === 1, cr?.reason);
  // on the ground: who leads, read from the country (MIB p 82 f)
  const open = Av.fitAdvance(inp(r, mk(() => OPEN)));
  check('on open ground: tanks lead, the infantry one bound behind (MIB p 82 f (3))', /open country: tanks lead/.test(row(open.res.rows, 'Who leads')?.reason ?? '') && /0 %/.test(row(open.res.rows, 'Who leads').reason), row(open.res.rows, 'Who leads')?.reason);
  const wood = Av.fitAdvance(inp(r, mk((x) => (Math.abs(x - A.x) < 300 ? OPEN : TREES))));
  check('...among woods both sides: close country, dismounted infantry lead (MIB p 82 f (1))', /close country: when contact is imminent dismounted infantry lead/.test(row(wood.res.rows, 'Who leads')?.reason ?? ''), row(wood.res.rows, 'Who leads')?.reason);
  check('...the Bn\'s axis read from its main guard through the SP (Going on the axis) and its own rows kept', !!row(open.res.rows, 'Going on the axis') && !!row(open.res.rows, 'Bn HQ'));
  const night2 = Av.fitAdvance(inp({ ...r, advance: { rlApartM: 1000, hAt: 'last' } }, mk(() => OPEN)));
  check('...a night advance adds the Bn\'s night rules: bounds and report lines closer (IBB p 148)', /IBB p 148 para 4 b/.test(row(night2.res.rows, 'By night')?.reason ?? ''), row(night2.res.rows, 'By night')?.reason?.slice(-200));
}

// ── the Armd Div on a broad front with two Bdes (OoW Vol II pp 52-53; DW pp 35, 55) ───────────────────────────────────
{
  const r = rec('div-advance-two-bde');
  check('div-advance-two-bde validates and is offered as the Armd Div Advance family', !valid('div-advance-two-bde').length && json('MS/Data/Deployments/Recipes/index.json').families.find((f) => f.id === 'div-advance')?.recipes.includes('div-advance-two-bde'), valid('div-advance-two-bde').map((i) => i.msg).join('; '));
  const sv = S.solveRecipe(r, ctx, {});
  const rows = Av.advanceRows(sv.items, doc);
  check('two Bdes up, one with two Regt groups up, one with one (OoW Vol II pp 52-53; DW pp 35, 55)', row(rows, 'Broad front')?.st === 'pass' && /two Regt groups up/.test(row(rows, 'Broad front').reason) && /OoW Vol II pp 52-53/.test(row(rows, 'Broad front').reason) && /DW pp 35, 55/.test(row(rows, 'Broad front').reason), row(rows, 'Broad front')?.reason);
  check('...the axes 5 km apart: inside 3-8 km (E)', row(rows, 'Axes apart')?.st === 'pass' && /5\.0 km apart at the SP/.test(row(rows, 'Axes apart').reason), row(rows, 'Axes apart')?.reason);
  check('...covering troops 6 km ahead on each axis, flank guards 17.5 km out from the outer axes (Fig 2)', row(rows, 'Covering troops')?.st === 'pass' && row(rows, 'Flank guards')?.st === 'pass' && /17\.5 km and 17\.5 km out from the outer axes/.test(row(rows, 'Flank guards').reason), row(rows, 'Flank guards')?.reason);
  check('...the follow-up Bde 8 km behind (Fig 2\'s note, reading uncertain)', row(rows, 'Follow-up Bde')?.st === 'pass' && /uncertain/.test(row(rows, 'Follow-up Bde').reason));
  const near = sv.items.map((i) => (i.role === 'axisR' ? { ...i, pts: i.pts.map((p) => ({ x: p.x - 4000, y: p.y })) } : i));
  const ar = row(Av.advanceRows(near, doc), 'Axes apart');
  check('...axes 1 km apart: one En posn stops both, warn with a fix', ar?.st === 'warn' && /1\.0 km/.test(ar.detail?.head ?? ''), ar?.reason);
  // on the ground: each axis read for its going and crossings; a canal across the Rt axis with no bridge
  const g = mk((x, y) => (y > A.y + 2000 && y < A.y + 2060 && x > A.x ? CANAL : OPEN));
  const f = Av.fitAdvance(inp(r, g));
  check('on the ground: Going and Crossings on the Lt axis and on the Rt axis', ['Going on the Lt axis', 'Going on the Rt axis', 'Crossings on the Lt axis', 'Crossings on the Rt axis'].every((k) => !!row(f.res.rows, k)), f.res.rows.map((x) => x.name).join(', '));
  check('...the canal across the Rt axis with no bridge: Crossings on the Rt axis fails, the Lt passes', row(f.res.rows, 'Crossings on the Rt axis')?.st === 'fail' && row(f.res.rows, 'Crossings on the Lt axis')?.st === 'pass', row(f.res.rows, 'Crossings on the Rt axis')?.reason);
  check('...bounds and report lines left to each Bde on its axis (grey, never a pass)', row(f.res.rows, 'Bounds')?.st === 'unchecked');
  // Check my plan reads the Div as drawn
  const W = (role) => { const it = f.raw.items.find((i) => i.role === role); return it ? { pts: it.pts.map((p) => { const w = { x: A.x + (p.x - f.frame.pivot.x) * f.frame.k, y: A.y + (p.y - f.frame.pivot.y) * f.frame.k }; return [w.x, w.y]; }) } : null; };
  const drawn = Object.fromEntries(['sp', 'axisL', 'axisR', 'ctpsL', 'ctpsR', 'flankL', 'flankR', 'rgL1', 'rgL2', 'rgR1', 'bdeL', 'bdeR', 'res'].map((k) => [k, W(k)]).filter(([, v]) => v));
  const ck = Av.checkAdvance(inp(r, g), drawn);
  check('Check my plan: the Div read as drawn, the same rows, nothing missing', ck && row(ck.rows, 'Axes apart')?.st === 'pass' && row(ck.rows, 'Crossings on the Rt axis')?.st === 'fail' && ck.missing.length === 0, ck ? `${ck.missing.join(', ')} | ${row(ck.rows, 'Axes apart')?.reason}` : 'null');
}

// ── halting areas sited on the ground (IBB p 160; OoW Vol II p 12) ─────────────────────────────────────────────────────
{
  const r = rec('bde-advance-armd');
  const band = (y, y0) => y > A.y + y0 && y < A.y + y0 + 60;
  const water = (x, y) => (band(y, 2000) || band(y, 4500) ? (Math.abs(x - A.x) < 20 ? BR60 : CANAL) : null);
  // a wood left of the axis: the halting area moves there and passes
  const g = mk((x, y) => water(x, y) ?? (x < A.x - 200 ? TREES : OPEN));
  const f = Av.fitAdvance(inp(r, g));
  const ha = f.raw.items.filter((i) => /^ha\d$/.test(i.role));
  const hr = row(f.res.rows, 'Halting areas');
  check('a wood left of the axis: the halting areas go to the left (Fig 2 draws HAR-2 on the left), under cover: pass', ha.length === 2 && ha.every((h) => h.pts.every((p) => p.x < 0)) && hr?.st === 'pass' && /HA 1 left of the axis: 100 % under trees/.test(hr.reason) && /IBB S35 para 11 a p 160/.test(hr.reason), hr?.reason);
  // a marsh beside the axis on both sides: no room, no entry from the axis; a road 250 m away gives the entry
  const marsh = 6;
  const g2 = mk((x, y) => water(x, y) ?? (Math.abs(x - A.x) < 150 ? OPEN : marsh));
  const h2 = row(Av.fitAdvance(inp(r, g2)).res.rows, 'Halting areas');
  check('...marsh both sides: not firm, no entry found: warn, the area named with a fix', h2?.st === 'warn' && /only 0 % firm/.test(h2.detail?.items?.[0] ?? '') && /no entry found/.test(h2.detail.items[0]) && h2.detail.fix.length === 3, h2?.detail?.items?.join(' | '));
  const sites = Av.siteHaltingAreas({ path: [{ x: 0, y: -5000 }, { x: 0, y: 0 }, { x: 0, y: 10000 }], spAt: 5000, routed: true, pending: false }, [{ label: 'RL 1', s: 9000 }], { anchor: A, bearing: 0, k: 1, pivot: { x: 0, y: 0 } }, mk((x) => (x > A.x + 200 && x < A.x + 1400 ? TREES : OPEN)), doc);
  check('...the right side kept when it is the better (trees on the right)', sites.sites[0]?.side === 'right' && (sites.sites[0].cover ?? 0) > 0.9 && sites.row?.st === 'pass', JSON.stringify(sites.sites[0] && { side: sites.sites[0].side, cover: sites.sites[0].cover }));
}

// ── the RRs in a Bn defence (IBB S8 pp 38-42; IC p 367) ──────────────────────────────────────────────────────────────────
{
  for (const id of ['bn-def-two-up', 'bn-def-three-up', 'bn-def-one-up', 'bn-def-all-round', 'bn-def-canal', 'bn-def-rev-slope', 'bn3-def-two-up', 'bn3-def-three-up']) {
    const sv = S.solveRecipe(rec(id), ctx, {});
    const rr = sv.items.filter((i) => i.role === 'rr'), alt = sv.items.filter((i) => i.role === 'rrAlt');
    const nFwd = rec(id).slots.filter((s) => s.kind === 'fwd' || s.kind === 'round').length;
    if (rr.length !== nFwd || alt.length !== nFwd || row(sv.rows, 'RR')?.st !== 'pass') { check(`${id}: an RR and its alternative in each forward locality`, false, `${rr.length} RR, ${alt.length} alt, ${row(sv.rows, 'RR')?.st}: ${row(sv.rows, 'RR')?.reason}`); }
  }
  check('every Bn defence layout: an RR detachment and its alternative (planned) in each forward locality; the RR row passes (IBB pp 38-42)', true);
  const sv = S.solveRecipe(rec('bn-def-two-up'), ctx, {});
  const r1 = row(sv.rows, 'RR');
  check('...the row names the section of two a Coy, eight in the Bn, sited first, inside the localities by night, an alternative each', /IBB S8 para 4 p 38/.test(r1.reason) && /S9 para 1 p 42/.test(r1.reason) && /IBB S8 para 2 e p 41/.test(r1.reason) && /2 of 2 with an alternative 200-300 m back/.test(r1.reason), r1.reason);
  check('...the alternatives drawn planned (dashed)', sv.items.filter((i) => i.role === 'rrAlt').every((i) => i.planned));
}

// ── the desert reserve share (DW pp 26-27) ─────────────────────────────────────────────────────────────────────────────
{
  const C = await import('../../MS/Engines/DeploymentBuilder/PlanContext.ts');
  const r3 = S.solveRecipe(rec('div-def-three-axes'), ctx, {}).rows, r2 = S.solveRecipe(rec('div-def-two-up'), ctx, {}).rows;
  check('a Div defence measures its reserve share: three axes 1 of 4 Bdes (25 %), two up 1 of 3 (33 %)', row(r3, 'Reserve share')?.m === 0.25 && Math.abs(row(r2, 'Reserve share')?.m - 1 / 3) < 1e-9, `${row(r3, 'Reserve share')?.reason} | ${row(r2, 'Reserve share')?.reason}`);
  const d3 = row(C.groundNotes(r3, doc, 'desert', 'defence', '21', null), 'Reserve share');
  check('...in the desert 25 % warns: one third or more (DW p 26), with a fix', d3?.st === 'warn' && /DW p 26/.test(d3.reason) && d3.detail?.fix?.length === 2, d3?.reason);
  check('...a third passes in the desert; on the plains the share is not judged', row(C.groundNotes(r2, doc, 'desert', 'defence', '21', null), 'Reserve share')?.st === 'pass' && row(C.groundNotes(r3, doc, 'plains', 'defence', '21', null), 'Reserve share')?.st === 'pass');
  const rr = row(C.groundNotes(r2, doc, 'desert', 'defence', '21', null), 'Reserve reach');
  check('...the desert reserve reach names its 2-6 h (DW p 27, terrain.kinds.desert.reserveH)', /within 2-6 h \(DW p 27\)/.test(rr?.reason ?? ''), rr?.reason);
}

// ── the what-if: own minefields on the reserve's way (OoW Vol I pp 38, 42); the En's quick attack (MIB p 89) ─────────────
{
  const W = await import('../../MS/Engines/DeploymentBuilder/PlanWhatIf.ts');
  const route = (pts) => ({ pts, lengthM: 1000, min: 20, slowPct: 0, coveredPct: null, detour: false, blocked: false });
  const w = { enemyToFdlMin: 40, triggers: [
    { id: 'cpen-main', trigger: 'Penetration on A (main)', who: 'D Coy', from: 'D Coy', to: 'C Pen posn', route: route([{ x: 0, y: -1500 }, { x: 0, y: 200 }]), min: 20, enemyMin: 45, st: 'pass', reason: '', coveredBy: '' },
    { id: 'shell-fwdL', trigger: 'Heavy shelling on A Coy', who: 'A Coy', from: 'A Coy', to: 'Alt A', route: route([{ x: -1000, y: 1000 }, { x: -1000, y: 300 }]), min: 10, enemyMin: 30, st: 'pass', reason: '', coveredBy: '' },
  ] };
  const field = (y0, y1) => ({ role: 'atMines', key: '25270703', pts: [{ x: -500, y: y0 }, { x: 500, y: y0 }, { x: 500, y: y1 }, { x: -500, y: y1 }] });
  const hit = W.mineGapRow(w, [field(-200, 0)]);
  check('a minefield across the reserve\'s way to the C Pen posn: Mine gaps warns, a gap or lane, a phony field (OoW Vol I pp 38, 42)', hit?.st === 'warn' && /D Coy to C Pen posn/.test(hit.reason) && /OoW Vol I p 42/.test(hit.reason) && hit.detail?.fix?.length === 3, hit?.reason);
  check('...the field in front of the FDL, off the reserve\'s way: pass (the shelled move to the alternate is not a reserve move)', W.mineGapRow(w, [field(1500, 1800)])?.st === 'pass');
  check('...no own minefield on the plan: pass, the rule said for when one is laid', /no own minefield on the plan/.test(W.mineGapRow(w, [])?.reason ?? ''));
  const q = W.quickAttackRow(w, { echelon: '16', type: 'mech', source: 'default' }, doc);
  check('the En held at the FDL: a Bn quick attack 60-100 min from contact to H (MIB p 89), its H about 100-140 min; IBB p 133 beside it', q?.st === 'pass' && /60-100 min/.test(q.reason) && /H about 100-140 min/.test(q.reason) && /IBB p 133/.test(q.reason) && /not this H/.test(q.reason), q?.reason);
  check('...a Coy 30-60 min; a Bde: no figure printed, at least a Bn\'s', /30-60 min/.test(W.quickAttackRow(w, { echelon: '15', type: 'inf', source: 'user' }, doc).reason) && /no figure printed: at least a Bn's/.test(W.quickAttackRow(w, { echelon: '18', type: 'mech', source: 'default' }, doc).reason));
}

console.log(`\n${n} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
