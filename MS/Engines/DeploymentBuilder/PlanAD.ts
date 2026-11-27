/**
 * PlanAD.ts — PURE. Air defence over a plan's vulnerable points (VPs), from the ORBAT (ad.json, weapons.json: SO's
 * Hbk 2019 Sec 3 pp 300-321) and PlanDoctrine `ad` (E: how they are sited is not printed in the ORBAT).
 *
 * - the AD units that can cover a plan: the Btys (a Bn or Bde plan) and the Regts (a Div plan), each broken into its
 *   fire units (Gun Tps, Msl Tps, FUs) with their weapons and the weapons' max eff slant range (p 317); the Tps' "SAM
 *   Launcher" is not named in the charts and is taken as the Anza Mk II (`ad.samAssumed`, E);
 * - the VPs, in priority: the bridges, the gun areas, the HQ, the Assy areas and the reserve;
 * - the fire units sited round them: the VPs in priority take one FU each in turn until the FUs are used, each FU a
 *   quarter of its slant range from its VP's centre (held to `ad.siteM`), forward left and forward right first;
 * - the row AD cover: each VP counts the FUs that engage `ad.releaseM` beyond it (slant range minus the distance), the
 *   bridges and gun areas want `ad.minFus`.
 *
 * No ArcGIS, no DOM, so Node can test it.
 */
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { SMALL_TASKS, doctrineAt, footprints } from './PlanRecipes';
import type { Check, CheckState, XY } from './PlanSolve';
import type { OrbatSet } from './PlanOrbat';

export interface AdWeapon { id: string; name: string; count: number; effM: number; ceilingM: number | null; kind: 'gun' | 'sam'; assumed: boolean }
/** A fire unit: a Tp or FU with its weapons; effM the longest slant range among them. */
export interface AdFu { name: string; weapons: AdWeapon[]; effM: number }
export interface AdType { id: string; name: string; unit: 'regt' | 'bty'; fus: AdFu[]; src: string }

/** What the plan carries of its AD (Recipe.ad): the unit, its FUs in the order they are sited, the figures used. */
export interface AdOnPlan extends AdType {
  releaseM: number; minFus: number; siteM: [number, number]; assumedNote: string | null;
  /** The ground the AD was sited for (the desert has its own order of VPs, DW p 63); null when not known. */
  ground?: string | null;
}

const num = (v: unknown, fb: number) => (typeof v === 'number' && isFinite(v) ? v : fb);
const short = (s: string) => s.replace(/\s*\(.*\)\s*$/, '').trim();

function weaponOf(o: OrbatSet, w: any, samId: string): AdWeapon | null {
  const id: string | null = w.weapon ?? (/\bSAM\b/i.test(String(w.name)) ? samId : null);
  const W = id ? o.weapons.find((x) => x.id === id) : null;
  if (!W) return null;
  const effM = num(W.planRangeM?.eff ?? W.rangeM?.slant, 0);
  if (!(effM > 0)) return null;
  return { id: W.id, name: String(W.name), count: Number(w.count) || 1, effM, ceilingM: Number(W.planRangeM?.ceiling ?? W.rangeM?.ceiling) || null, kind: W.type === 'sam' ? 'sam' : 'gun', assumed: !w.weapon };
}

/** The fire units of an AD unit: its Tps / FUs (and chart boxes with weapons of their own), counts expanded. */
function fusOf(o: OrbatSet, u: any, samId: string, depth = 0): AdFu[] {
  const mk = (name: string, ws: any[]): AdFu[] => {
    const weapons = ws.map((w) => weaponOf(o, w, samId)).filter((w): w is AdWeapon => !!w);
    return weapons.length ? [{ name, weapons, effM: Math.max(...weapons.map((w) => w.effM)) }] : [];
  };
  if (u.type === 'tp' || u.type === 'fu') return mk(short(String(u.name)), u.weapons ?? []);
  if (depth > 3) return [];
  const out: AdFu[] = [];
  const kids = (u.children ?? []) as any[];
  for (const c of kids) {
    const n = Math.max(1, Number(c.count) || 1);
    const k = c.unit ? o.own.find((x) => x.id === c.unit) : null;
    for (let i = 0; i < n; i++) {
      const sub = k ? fusOf(o, k, samId, depth + 1) : mk(short(String(c.role ?? '')), c.weapons ?? []);
      // a Regt's Btys: 1 Bty Gun Tp, 2 Bty Msl Tp ...; a Bty's two Msl Tps: Msl Tp 1, Msl Tp 2
      const tag = (f: AdFu) => (k && k.type === 'bty' ? `${i + 1} Bty ${f.name}` : n > 1 ? `${f.name} ${i + 1}` : f.name);
      out.push(...sub.map((f) => ({ ...f, name: tag(f) })));
    }
  }
  // a unit whose chart gives its weapons but not its Tps': one FU for the lot
  return out.length ? out : mk(short(String(u.name)), u.weapons ?? []);
}

/**
 * The AD Btys and Regts with fire units whose weapons' ranges are printed (ad.json; the SC&R units, radars only, and
 * the higher HQs are left out). A Regt is listed after the Btys.
 */
export function ownAdTypes(o: OrbatSet, doc: DoctrineSet | null = null): AdType[] {
  const samId = String((doc && doctrineAt(doc, 'ad.samAssumed')) ?? 'anza-mk-ii');
  const out: AdType[] = [];
  for (const u of o.own.filter((x) => x.arm === 'ad' && (x.type === 'regt' || x.type === 'bty'))) {
    const fus = fusOf(o, u, samId);
    if (!fus.length) continue;
    const ws = new Map<string, number>();
    for (const f of fus) for (const w of f.weapons) ws.set(w.name, (ws.get(w.name) ?? 0) + w.count);
    out.push({ id: u.id, name: String(u.name), unit: u.type === 'regt' ? 'regt' : 'bty', fus,
      src: `SO's Hbk 2019 p ${u.page ?? '?'} (${u.id}): ${fus.length} fire units, ${[...ws].map(([k, v]) => `${v} x ${k}`).join(', ')}; slant ranges p 317 (weapons.json)` });
  }
  return out.sort((a, b) => Number(a.unit === 'regt') - Number(b.unit === 'regt'));
}

/** The AD for a plan, with the doctrine's figures. */
export function adOnPlan(a: AdType, doc: DoctrineSet, ground: string | null = null): AdOnPlan {
  const site = doctrineAt(doc, 'ad.siteM');
  const assumed = a.fus.some((f) => f.weapons.some((w) => w.assumed));
  return {
    ...a,
    releaseM: num(doctrineAt(doc, 'ad.releaseM'), 1500),
    minFus: num(doctrineAt(doc, 'ad.minFus'), 2),
    ground,
    siteM: Array.isArray(site) && site.length === 2 ? [Number(site[0]), Number(site[1])] : [300, 1000],
    assumedNote: assumed ? `the Tps' SAM Launcher is not named in the chart: taken as the ${a.fus.flatMap((f) => f.weapons).find((w) => w.assumed)!.name} (as set)` : null,
  };
}

/**
 * VP roles in priority: [pattern, what it is, priority (1 first), priority in the desert]. The set is the books' (OOW1
 * s6 p 27: HQs, armour concentrations, gun areas, reserves and vital bridges get the higher priority); the order among
 * them off the desert is a decision (PlanDoctrine ad.vps, E). In the desert the order is printed (ad.vps.desert, D: DW
 * s18 para 5 p 63): reserves, then key HQs, then gun areas, logistic installations and assault engineers, then MSR
 * bottlenecks; crossing sites the highest in a break-in (DW p 64). The tank Sqn's Assy area before an attack (role
 * tkHarbour: MIB p 118) is an armour concentration (OOW1 p 27).
 */
const VP: [RegExp, string, number, number][] = [
  [/^bridge\d*$/, 'the bridge', 1, 1],
  [/^gunArea\d*$/, 'the gun area', 1, 3],
  [/^hq$/, 'the HQ', 2, 2],
  [/^tkHarbour\d*$/, 'the tank Assy area', 2, 2],
  [/^(assy\d*|vwa)$/, 'the Assy area', 3, 3],
  [/^res$/, 'the reserve', 3, 1],
];
export const vpOf = (role: string, ground: string | null = null) => { const v = VP.find(([re]) => re.test(role)); return v ? { what: v[1], pri: ground === 'desert' ? v[3] : v[2] } : null; };

/** A slot's centre in recipe metres (x across, y back toward home), when its shape gives one. */
function centreOf(s: Recipe['slots'][number]): [number, number] | null {
  const S: any = s.shape;
  if (!S) return null;
  if (S.rect && typeof S.rect.acrossM === 'number' && typeof S.rect.backM === 'number') return [S.rect.acrossM, S.rect.backM];
  if (S.at) return [S.at[0], S.at[1]];
  const pts: [number, number][] = [...(S.pts ?? []), ...(S.base ?? [])];
  if (!pts.length) return null;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

/** The plan's VPs in recipe metres, in priority (a defence's reserve from its footprint). */
export function vpsOf(r: Recipe, doc: DoctrineSet, ground: string | null = null): { role: string; what: string; pri: number; x: number; y: number }[] {
  const fp = footprints(doc, r);
  const out: { role: string; what: string; pri: number; x: number; y: number }[] = [];
  // an ambush, patrol or recce has no VP: its reserve (role res, IC s44 para 8 c p 149) is a party, not a Bn reserve
  if (SMALL_TASKS.includes(r.task)) return out;
  for (const s of r.slots) {
    const v = vpOf(s.role, ground);
    if (!v) continue;
    const c = centreOf(s) ?? (() => { const b = fp.find((q) => q.role === s.role); return b ? [b.x, b.y] as [number, number] : null; })();
    if (c) out.push({ role: s.role, ...v, x: c[0], y: c[1] });
  }
  return out.sort((a, b) => a.pri - b.pri);
}

/** Where the k-th FU at a VP stands, degrees off the line to the threat: forward left, forward right, behind, the flanks. */
const SITE_DEG = [-40, 40, 180, -100, 100, 0];

/**
 * The AD sited round the plan's VPs (a new recipe `-ad`; the one passed in is not changed): the first-priority VPs take
 * FUs in turn until each has `ad.minFus`, then the others in priority, round again while FUs are left, each FU a quarter of its slant range from the VP (held to `siteM`). A plan
 * with no VP, or with its AD already, is left as it is.
 */
export function withAd(r: Recipe, doc: DoctrineSet, a: AdOnPlan): Recipe {
  if (r.ad) return r;
  const vps = vpsOf(r, doc, a.ground ?? null);
  if (!vps.length) return r;
  const out: Recipe = JSON.parse(JSON.stringify(r));
  const at = new Map<string, number>();
  const where: string[] = [];
  // the order the FUs go: the first-priority VPs (bridges, gun areas; in the desert the reserve and bridges) in turn until each has `minFus` (the AD cover row
  // wants that many over each), then every VP in priority, round again while FUs are left
  const first = vps.filter((v) => v.pri === 1);
  const order = [...Array.from({ length: a.minFus }, () => first).flat(), ...vps.filter((v) => v.pri > 1)];
  const seq = order.length ? order : vps;
  a.fus.forEach((f, i) => {
    const v = i < seq.length ? seq[i] : vps[(i - seq.length) % vps.length];
    const k = at.get(v.role) ?? 0;
    at.set(v.role, k + 1);
    const d = Math.min(a.siteM[1], Math.max(a.siteM[0], Math.round(f.effM / 4)));
    const t = (SITE_DEG[k % SITE_DEG.length] * Math.PI) / 180;
    // recipe y is back toward home: forward is -y
    out.slots.push({ role: `ad${i + 1}`, kind: 'point', sym: '10130100', label: f.name, order: 8, shape: { at: [Math.round(v.x + d * Math.sin(t)), Math.round(v.y - d * Math.cos(t))] } });
    if (!k) where.push(v.what);
  });
  out.id = `${r.id}-ad`;
  out.name = `${r.name}, ${a.name}`;
  out.ad = a;
  out.note = `${r.note ?? ''} ${a.name}: ${a.fus.length} fire units sited round ${[...new Set(where)].join(', ')} (PlanAD.withAd; siting E).`.trim();
  return out;
}

const centre = (pts: XY[]): XY => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const fmtM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/**
 * AD cover: for each VP on the plan, the FUs that engage `releaseM` beyond it (slant range less the distance from the
 * FU). Fail when a first-priority VP (a bridge, a gun area) has none; warn when one has fewer than `minFus` or another
 * VP has none. Plan metres; the FUs read from their `adN` items. Empty with no AD.
 */
export function adRows(items: { role: string; pts: XY[] }[], recipe: Pick<Recipe, 'ad'>, ground: string | null = null): Check[] {
  const a = recipe.ad as AdOnPlan | undefined;
  if (!a) return [];
  const gk = ground ?? a.ground ?? null;
  const fus = a.fus.map((f, i) => ({ f, it: items.find((x) => x.role === `ad${i + 1}` && x.pts.length) })).filter((x) => !!x.it).map((x) => ({ f: x.f, c: centre(x.it!.pts) }));
  const vps = items.filter((i) => vpOf(i.role, gk) && i.pts.length);
  if (!fus.length || !vps.length) return [];
  const seen = new Set<string>();
  const parts: string[] = [];
  let st: CheckState = 'pass';
  const worse = (s: CheckState) => { const o = ['pass', 'warn', 'fail']; if (o.indexOf(s) > o.indexOf(st)) st = s; };
  for (const v of vps.sort((p, q) => vpOf(p.role, gk)!.pri - vpOf(q.role, gk)!.pri)) {
    const { what, pri } = vpOf(v.role, gk)!;
    const c = centre(v.pts);
    const n = fus.filter((u) => u.f.effM - Math.hypot(u.c.x - c.x, u.c.y - c.y) >= a.releaseM).length;
    const no = v.role.match(/(\d+)$/)?.[1];
    const label = (v as any).label ? `${what} (${(v as any).label})` : no ? `${what} ${no}` : what;
    if (pri === 1 && n === 0) worse('fail');
    else if (pri === 1 && n < a.minFus) worse('warn');
    else if (n === 0) worse('warn');
    const key = `${label}:${n}`;
    if (seen.has(key) && pri > 1) continue;
    seen.add(key);
    parts.push(`${label}: ${n} FU${n === 1 ? '' : 's'}`);
  }
  const ranges = [...new Set(a.fus.flatMap((f) => f.weapons).map((w) => `${w.name} ${fmtM(w.effM)}`))].join(', ');
  const fix = st === 'pass' ? '' : `; more fire units (${a.unit === 'bty' ? 'a Regt, or a second Bty' : 'a second Regt'}) or a longer reach (RBS-70 Bolide 8 km, 57 mm 6 km: p 317)`;
  return [{ name: 'AD cover', st, reason: `${a.name} (${a.fus.length} fire units; ${ranges} slant), the FUs that engage ${fmtM(a.releaseM)} out: ${parts.join('; ')}; ${a.minFus} wanted over ${gk === 'desert' ? 'the reserve and the bridges (desert: reserves first, then HQs, then gun areas, DW p 63; crossing sites highest, DW p 64)' : gk === 'mountain' ? 'the bridges and gun areas; in the mountains the AD is concentrated on the defiles on the main axis, the gun areas and the logistic installations (MW p 247)' : 'the bridges and gun areas'}${fix}${a.assumedNote ? `; ${a.assumedNote}` : ''}. Clear arcs, the radar's cover and the early warning: on the ground` }];
}

/**
 * AD on the defiles in the mountains (MW s22 para 7 p 247: the AD is concentrated on the defiles on the main axis, the gun
 * areas and the logistic installations): each narrow on the attack's route (the avenue finder's chokes, plan metres)
 * against the FUs that engage `releaseM` beyond it. Warns when a defile has none. Empty with no AD or no defile.
 */
export function adDefileRows(items: { role: string; pts: XY[] }[], recipe: Pick<Recipe, 'ad'>, defiles: { at: XY; widthM: number; label?: string }[]): Check[] {
  const a = recipe.ad as AdOnPlan | undefined;
  if (!a || !defiles.length) return [];
  const fus = a.fus.map((f, i) => ({ f, it: items.find((x) => x.role === `ad${i + 1}` && x.pts.length) })).filter((x) => !!x.it).map((x) => ({ f: x.f, c: centre(x.it!.pts) }));
  if (!fus.length) return [];
  const read = defiles.map((d) => ({ d, n: fus.filter((u) => u.f.effM - Math.hypot(u.c.x - d.at.x, u.c.y - d.at.y) >= a.releaseM).length }));
  const bare = read.filter((r) => !r.n);
  const parts = read.map((r) => `${r.d.label ? `${r.d.label}, ` : ''}${fmtM(r.d.widthM)} wide: ${r.n} FU${r.n === 1 ? '' : 's'}`);
  const rule = 'in the mountains the AD is concentrated on the defiles on the main axis, the gun areas and the logistic installations (MW s22 para 7 p 247)';
  return [bare.length ? {
    name: 'AD on defiles', st: 'warn',
    reason: `${read.length} defile${read.length === 1 ? '' : 's'} on the route to the FUP (${parts.join('; ')}), ${bare.length} with no FU engaging ${fmtM(a.releaseM)} beyond it: ${rule}`,
    detail: { head: `${bare.length} defile${bare.length === 1 ? '' : 's'} on the axis without AD`, why: 'Air interdiction in the mountains goes for the defiles (MW p 93) and the bridges, with land slides set off to block the roads (p 257); a column held in a defile under air attack blocks the whole axis.', fix: ['Site a fire unit on a dominating feature over each defile (MW p 247)', 'Move through the defiles by night', 'More fire units (a second Bty / Regt)'] },
  } : { name: 'AD on defiles', st: 'pass', reason: `${parts.join('; ')}: each defile on the route to the FUP under at least one FU; ${rule}` }];
}

/**
 * AD sites in the mountains (MW p 247: the run-ins are canalized and the AD weapons cover them fairly well from dominating
 * features): each fire unit's site against the ground within `ad.mountains.siteRadiusM`; within `siteTolM` of its highest
 * point it is on a dominating feature, else the nearest higher site is named. Warns when fewer than half stand on one.
 * World points through `toWorld` (the fit's frame); unchecked while the elevation is not loaded.
 */
export function adMountainRows(items: { role: string; pts: XY[] }[], recipe: Pick<Recipe, 'ad'>, toWorld: (p: XY) => XY, elev: (x: number, y: number) => number, doc: DoctrineSet): Check[] {
  const a = recipe.ad as AdOnPlan | undefined;
  if (!a) return [];
  const R = num(doctrineAt(doc, 'ad.mountains.siteRadiusM'), 500), tol = num(doctrineAt(doc, 'ad.mountains.siteTolM'), 10);
  const fus = a.fus.map((f, i) => ({ f, it: items.find((x) => x.role === `ad${i + 1}` && x.pts.length) })).filter((x) => !!x.it).map((x) => ({ f: x.f, c: centre(x.it!.pts) }));
  if (!fus.length) return [];
  // plan metres face the front (+y): the height's direction said as the plan sees it
  const DIRS = ['ahead', 'ahead right', 'right', 'behind right', 'behind', 'behind left', 'left', 'ahead left'];
  let read = 0, on = 0;
  const below: string[] = [];
  for (const u of fus) {
    const w0 = toWorld(u.c), e0 = elev(w0.x, w0.y);
    if (!Number.isFinite(e0)) continue;
    let top = e0, at = { d: 0, deg: 0 };
    for (let d = 100; d <= R + 1; d += 100) for (let k = 0; k < 16; k++) {
      const t = (k * Math.PI) / 8, p = toWorld({ x: u.c.x + d * Math.sin(t), y: u.c.y + d * Math.cos(t) });
      const e = elev(p.x, p.y);
      if (Number.isFinite(e) && e > top) { top = e; at = { d, deg: k * 22.5 }; }
    }
    read++;
    if (top - e0 <= tol) on++;
    else below.push(`${u.f.name} ${Math.round(top - e0)} m below the height ${fmtM(at.d)} ${DIRS[Math.round(at.deg / 45) % 8]}`);
  }
  if (!read) return [{ name: 'AD sites', st: 'unchecked', reason: 'the heights round the fire units are not loaded yet' }];
  const ok = on * 2 >= read;
  return [{ name: 'AD sites', st: ok ? 'pass' : 'warn', reason: `${on} of ${read} fire units on a dominating feature (within ${tol} m of the highest ground within ${fmtM(R)}, E)${below.length ? `; ${below.join('; ')}` : ''}: in the mountains the run-ins to the targets are canalized and the AD covers them fairly well from dominating features (MW p 247)`,
    ...(ok ? {} : { detail: { head: `${read - on} of ${read} fire units below the heights round them`, items: below, why: 'From low ground in a valley the AD sees the canalized run-in late; from the height over it the weapons cover it fairly well (MW p 247).', fix: ['Move each onto the height named, if a weapon and its crew can be got there', 'Keep the FUs over the defiles on the main axis, the gun areas and the logistic installations (MW p 247)'] } }) }];
}
