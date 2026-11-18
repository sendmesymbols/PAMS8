/**
 * PlanEngr.ts — PURE. Engineers with a plan, from the ORBAT (engr.json, SO's Hbk 2019 Sec 4, pp 402-454):
 *
 * - the engineer units a plan can be given: a Fd Coy, the Indep Fd and Mech Coys, the Div's Offn and Def Engr Bns, the
 *   Mech, Aslt and Br Bns; each with its Fd Pls (they lay mines and breach by hand) and its equipment: MMLs, TAMs, MICLIC,
 *   AVLBs, ribbon bridge, AM-50 / HMB bridge sets;
 * - the protective minefield in time with them (p 439: an Engr Pl 780 mixed clusters in 24 h; a Fd Coy with a set of 6
 *   MMLs 9000 m of ATMs in 24 h, ideal conditions, figures under trial);
 * - their bridging across a gap (pp 427-432: the ribbon bridge, AM-50, the AVLB) and their mechanical breach (p 451: TAM);
 * - an inundation belt in front of a defence in time (pp 452-453: compartments, filling, saturation). Wire, AT ditches
 *   and demolitions have no rates in the ORBAT and are not timed.
 *
 * No ArcGIS, no DOM. The data is passed in, so Node can test it.
 */
import type { Check, CheckState } from './PlanSolve';
import type { OrbatSet } from './PlanOrbat';
import type { DoctrineSet, Recipe } from './PlanRecipes';
import { resolveRange } from './PlanRecipes';

/** An engineer unit and what it brings. */
export interface EngrType {
  id: string;
  name: string;
  strength: number | null;
  /** Its engineer Pls that lay mines and breach by hand (Fd, Aslt Engr, Aslt Fd Pls). */
  pls: number;
  mml: number; tam: number; miclic: number; avlb: number;
  /** Bridge sets: ribbon bridge, AM-50 / HMB. */
  ribbon: number; am50: number;
  /** Its Coys that work (Fd, Aslt Engr, Mech Fd, bridging Coys): what can be shared out between Bns; 1 for a Coy. */
  coys: number;
  src: string;
}

/** The engineer units offered, in this order. */
const OFFERED = ['engr-fd-coy', 'engr-ifce', 'engr-imce', 'engr-bn-def-inf-div-corps', 'engr-bn-offn-inf-div', 'engr-bn-mech', 'engr-bn-aslt', 'engr-bn-br'];
/** The Pls that lay mines and breach by hand. */
const LAYING_PL = /^engr-(fd-pl|aslt-engr-pl|aslt-fd-pl)$/;

const find = (list: any[], id: string | null | undefined) => (id ? list.find((u) => u.id === id) ?? null : null);

function plsOf(list: any[], u: any, depth = 0): number {
  if (!u || depth > 4) return 0;
  if (LAYING_PL.test(u.id)) return 1;
  return (u.children ?? []).reduce((a: number, c: any) => a + (Number(c.count) || 1) * plsOf(list, find(list, c.unit), depth + 1), 0);
}

/** Equipment counted by name on the unit's own lists (the chart's figures for the whole unit). */
function eqCount(u: any, re: RegExp): number {
  const all = [...(u.weapons ?? []), ...(u.equipment ?? []), ...(u.vehicles ?? [])];
  return all.filter((w: any) => re.test(String(w?.name ?? '').trim())).reduce((a: number, w: any) => a + (Number(w.count) || 0), 0);
}

/** The engineer units a plan can be given, with their Pls and equipment (ORBAT). */
export function ownEngrTypes(o: OrbatSet): EngrType[] {
  const out: EngrType[] = [];
  for (const id of OFFERED) {
    const u = find(o.own, id);
    if (!u) continue;
    out.push({
      id, name: String(u.name), strength: Number(u.strength?.total) || null, pls: plsOf(o.own, u),
      mml: eqCount(u, /^MML$/), tam: eqCount(u, /^TAMs?$/), miclic: eqCount(u, /^MICLIC$/), avlb: eqCount(u, /^AVLB$/),
      ribbon: eqCount(u, /^Ribbon Br$/), am50: eqCount(u, /^AM ?-?50/),
      coys: u.echelon === '15' ? 1 : (u.children ?? []).filter((c: any) => { const cu = find(o.own, c.unit); return cu && cu.echelon === '15' && /fd coy|aslt engr coy|br coy|mech fd coy/i.test(String(cu.name)); }).reduce((a: number, c: any) => a + (Number(c.count) || 1), 0) || 1,
      src: `SO's Hbk 2019 p ${u.page ?? '?'} (${id})`,
    });
  }
  return out;
}

/**
 * `k` of an engineer Bn's Coys grouped to one Bn (the rest go to the other Bns): its Pls shared by the Coys, a set of 6
 * MMLs with a Fd Coy (p 439: "a Fd Coy with a set of 6 MMLs", the rest in reserve), the other equipment shared by the
 * Coys (E). A Coy, or `k` at or over its Coys, comes back whole.
 */
export function engrShare(e: EngrType, k: number): EngrType {
  const n = Math.max(1, Math.round(k));
  if (e.coys <= 1 || n >= e.coys) return e;
  const part = (x: number) => Math.floor((x * n) / e.coys);
  return {
    ...e,
    name: `${n} Coy${n > 1 ? 's' : ''} of the ${e.name}`,
    strength: e.strength ? Math.round((e.strength * n) / e.coys) : null,
    pls: Math.round((e.pls * n) / e.coys),
    mml: Math.min(e.mml, MML_SET * n), tam: part(e.tam), miclic: part(e.miclic), avlb: part(e.avlb), ribbon: part(e.ribbon), am50: part(e.am50),
    coys: n,
    src: `${e.src}; ${n} of its ${e.coys} Coys (E: its Pls and equipment shared by the Coys, a set of MMLs with a Fd Coy, p 439)`,
  };
}

/** The unit in a line: Pls and equipment. */
export function engrText(e: EngrType): string {
  const eq = [e.mml && `${e.mml} MML`, e.tam && `${e.tam} TAM`, e.miclic && `${e.miclic} MICLIC`, e.avlb && `${e.avlb} AVLB`, e.ribbon && `${e.ribbon} ribbon bridge set${e.ribbon > 1 ? 's' : ''}`, e.am50 && `${e.am50} AM-50 / HMB set${e.am50 > 1 ? 's' : ''}`].filter(Boolean);
  return `${e.name}: ${e.pls} engineer Pls${eq.length ? `, ${eq.join(', ')}` : ''}`;
}

/** The p 439 mechanical minelaying figure: a set of 6 MMLs, 9000 m of ATMs in 24 h. */
export const MML_SET = 6, MML_SET_M24 = 9000;

/**
 * The minefield with these engineers: by hand (their Pls at `perPl` mixed clusters, a metre of front each, in 24 h)
 * and, with a set of 6 MMLs, the machines laying alongside them (9000 m of ATMs in 24 h a set, counted as metres of
 * front, E). Hours, each.
 */
export function minesByEngr(e: EngrType, frontageM: number, perPl: number): { handH: number | null; mechH: number | null; sets: number } {
  const handH = e.pls ? Math.round((frontageM / (e.pls * perPl)) * 24) : null;
  const sets = Math.floor(e.mml / MML_SET);
  const mechH = sets ? Math.round((frontageM / (sets * MML_SET_M24 + e.pls * perPl)) * 24) : null;
  return { handH, mechH, sets };
}

// ── bridging and the breach (pp 427-432, 451) ────────────────────────────────────────────────────────────────────────

/** A bridge the engineers can put across, from the planning tables: its span a set, class, hours by light. */
interface BridgeKind { label: string; cls: number; spanM: number; hours: [number, number, number]; page: string; note: string }

const hm = (s: unknown): number | null => {
  const m = String(s ?? '').match(/(\d+)\s*[-.:]\s*(\d+)/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && String(s ?? '').trim() ? n : null;
};

/** The bridges the engineer tables give for the ribbon bridge, AM-50 and the Pakistani AVLB (engrData). */
export interface RaftKind { label: string; cls: number | null; buildMin: [number, number, number]; tripsPerH: [number, number, number]; page: string }

export function bridgeKinds(engrData: any[]): { ribbon: BridgeKind | null; am50: BridgeKind | null; avlb: BridgeKind | null; rafts: { us5: RaftKind | null; cn3: RaftKind | null } } {
  const brs = engrData.find((t: any) => /Brs in Pakistan Army - Planning Data/i.test(String(t?.title)));
  const layers = engrData.find((t: any) => /Br Layers - Planning Data/i.test(String(t?.title)));
  const row = (re: RegExp, cls: string) => brs?.rows?.find((r: any) => re.test(String(r.Type)) && String(r['Load Cl']) === cls) ?? null;
  const k = (r: any, label: string, note: string): BridgeKind | null => {
    if (!r) return null;
    const h = [hm(r.Day), hm(r['Moon Lt']), hm(r['Dark Ni'])];
    if (h.some((x) => x === null)) return null;
    return { label, cls: Number(r['Load Cl']), spanM: Number(String(r['Span (M)']).replace(/[^\d.]/g, '')), hours: h as [number, number, number], page: String(brs.page), note };
  };
  // the Br Bn's chart says "Ribbon Br" without the make; the table has the US (1 h by day) and the Chinese (18 min): the
  // US figures taken, the slower (E)
  const ribbon = k(row(/^Ribbon Br \(USA\)/, '60'), 'Ribbon bridge', 'the US one\'s figures: the chart does not say which make, the slower taken (E)');
  const am50 = k(row(/^AM-50/, '50'), 'AM-50 bridge', 'times as printed (1-45 by day, 1-0 by moonlight, 1-15 by dark night)');
  const av = layers?.rows?.find((r: any) => /Med span AVLB \(Pak, T-59\)/.test(String(r.Type)));
  const avlb = av ? { label: 'AVLB (Pak, T-59)', cls: Number(av.Cl), spanM: Number(av['Deck Span (M)']), hours: [3 / 60, 3 / 60, 3 / 60] as [number, number, number], page: String(layers.page), note: 'laid in about 3 min' } : null;
  // the ribbon bridge's bays as rafts (p 430-431): built in minutes by light, round trips an hour over 75 / 150 / 300 m
  const rt = engrData.find((t: any) => /Eqpt Rafts/i.test(String(t?.title)));
  const raft = (re: RegExp, label: string, cls: number | null): RaftKind | null => {
    const r = rt?.rows?.find((x: any) => re.test(String(x.Type)));
    if (!r) return null;
    const n = (v: unknown) => Number(String(v ?? '').replace(/[^\d.]/g, ''));
    return { label, cls, buildMin: [n(r.Day), n(r['Moon lt']), n(r['Dark ni'])], tripsPerH: [n(r['75 M']), n(r['150 M']), n(r['300 M'])], page: String(rt.page) };
  };
  const rafts = { us5: raft(/^Ribbon Raft \(USA\): 5 Bays/, 'Ribbon raft (US, 5 bays)', null), cn3: raft(/^Ribbon Raft \(Chinese\): 3 Bays/, 'Ribbon raft (Chinese, 3 bays, Cl 60)', 60) };
  return { ribbon, am50, avlb, rafts };
}

/**
 * The ribbon bridge's bays as rafts across a gap `widthM` wide (p 430-431): built in minutes by light, round trips an
 * hour by the gap (the 75, 150 or 300 m column at or over it), one tank a trip: the first tank and a Sqn of `sqn`. The
 * chart does not say which make the Br Bn holds: the US raft's class is not printed, the Chinese 3-bay one is Cl 60, so
 * the tanks are timed on the Chinese one and the row says so. Null without ribbon bridge sets.
 */
export function engrRafts(e: EngrType, widthM: number, li: number, kinds: ReturnType<typeof bridgeKinds>, sqn = 14): { row: Check; firstMin: number | null; sqnMin: number | null } | null {
  if (!e.ribbon) return null;
  const k = kinds.rafts.cn3 ?? kinds.rafts.us5;
  if (!k) return null;
  const col: number = widthM <= 75 ? 0 : widthM <= 150 ? 1 : widthM <= 300 ? 2 : -1;
  if (col < 0) return { row: { name: 'Engr rafts', st: 'warn', reason: `${Math.round(widthM)} m: wider than the raft table's 300 m (p ${k.page})` }, firstMin: null, sqnMin: null };
  const per = (k.tripsPerH as number[])[col] ?? 1, build = (k.buildMin as number[])[li] ?? 0;
  const first = Math.round(build + 60 / per / 2), all = Math.round(build + (sqn * 60) / per);
  const us = kinds.rafts.us5;
  return {
    firstMin: first, sqnMin: all,
    row: { name: 'Engr rafts', st: 'pass', reason: `the ${poss(e.name)} ribbon bays as rafts (p ${k.page}): the ${k.label} built in ${build} min ${LIGHT[li]}, ${per} round trips an hour over ${Math.round(widthM)} m: the first tank about ${hRel(first / 60)}, a Sqn of ${sqn} ${hRel(all / 60)}, one a trip${us ? `; the US raft (${us.buildMin[li]} min, ${(us.tripsPerH as number[])[col] ?? "?"} trips an hour) prints no class: the make is not on the chart, tanks timed on the Chinese one (E)` : ''}` },
  };
}

const LIGHT = ['by day', 'by moonlight', 'by dark night'];
/** "the Br Bn Engrs'" / "the Aslt Engr Bn's" */
const poss = (name: string) => (/s$/.test(name) ? `${name}'` : `${name}'s`);
/** 1.25 h -> "1 h 15 min"; under an hour in minutes. */
const dur = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${Math.floor(h)} h${Math.round((h % 1) * 60) ? ` ${Math.round((h % 1) * 60)} min` : ''}`);
const hRel = (h: number) => (h < 1 ? `H+${Math.round(h * 60)} min` : `H+${Math.floor(h)} h${Math.round((h % 1) * 60) ? ` ${Math.round((h % 1) * 60)} min` : ''}`);

/**
 * The engineers' own bridging across a gap of `needM` (the gap and its seats): the fastest of what they hold that spans
 * it (the AVLB under its span, the AM-50 sets end to end, the ribbon bridge sets end to end, the build time by light
 * for each set, E: sets built one after the other). Null when they hold no bridging.
 */
export function engrBridge(e: EngrType, needM: number, li: number, kinds: ReturnType<typeof bridgeKinds>): { row: Check; openH: number | null; label: string | null } | null {
  const opts: { label: string; cls: number; h: number; sets: number; note: string; page: string }[] = [];
  if (e.avlb && kinds.avlb && needM <= kinds.avlb.spanM) opts.push({ label: kinds.avlb.label, cls: kinds.avlb.cls, h: kinds.avlb.hours[li], sets: 1, note: kinds.avlb.note, page: kinds.avlb.page });
  for (const [held, k] of [[e.am50, kinds.am50], [e.ribbon, kinds.ribbon]] as const) {
    if (!held || !k) continue;
    const sets = Math.ceil(needM / k.spanM);
    if (sets <= held) opts.push({ label: k.label, cls: k.cls, h: k.hours[li] * sets, sets, note: k.note, page: k.page });
  }
  if (!e.avlb && !e.am50 && !e.ribbon) return null;
  const held = [e.avlb && `${e.avlb} AVLB (${kinds.avlb?.spanM ?? '?'} m)`, e.am50 && `${e.am50} AM-50 set${e.am50 > 1 ? 's' : ''} (${kinds.am50?.spanM ?? '?'} m each)`, e.ribbon && `${e.ribbon} ribbon bridge set${e.ribbon > 1 ? 's' : ''} (${kinds.ribbon?.spanM ?? '?'} m each)`].filter(Boolean).join(', ');
  if (!opts.length) return { row: { name: 'Engr bridging', st: 'warn', reason: `${Math.round(needM)} m to span: longer than what the ${e.name} hold${/s$/.test(e.name) ? '' : 's'} (${held}): the Div's M2 bridge (Annex Q) above, or Corps bridging` }, openH: null, label: null };
  const best = opts.sort((a, b) => a.h - b.h)[0];
  const st: CheckState = 'pass';
  return {
    row: { name: 'Engr bridging', st, reason: `the ${poss(e.name)} ${best.label}${best.sets > 1 ? `, ${best.sets} sets` : ''} (Cl ${best.cls}) across ${Math.round(needM)} m: ${dur(best.h)} ${LIGHT[li]}, open about ${hRel(best.h)} if begun at H (SO's Hbk p ${best.page}; ${best.note}${best.sets > 1 ? '; sets one after the other, E' : ''}); it holds ${held}` },
    openH: best.h, label: `${best.label} open (${e.name})`,
  };
}

/**
 * The mechanical breach with TAMs (p 451: a 600 m lane by 1 Pl in 2 h, a 900 m lane in 3 h, 5 m wide; the print's
 * columns are uncertain, read so): one TAM a lane, `lanes` lanes `depthM` deep, against the hand breach's `handH`.
 */
export function tamBreach(e: EngrType, lanes: number, depthM: number, handH: number): { row: Check; h: number } | null {
  if (!e.tam) return null;
  const h = Math.round((depthM / 300) * 10) / 10;
  const enough = e.tam >= lanes;
  return {
    h,
    row: { name: 'Mech breach', st: enough ? 'pass' : 'warn', reason: `${lanes} lane${lanes > 1 ? 's' : ''} ${Math.round(depthM)} m deep: one TAM a lane, about ${dur(h)} each (SO's Hbk p 451: a 600 m lane in 2 h, 900 m in 3 h, 5 m wide; the print's columns read so, uncertain) against ${handH} h by hand (Annex Q); the ${e.name} hold${/s$/.test(e.name) ? '' : 's'} ${e.tam} TAM${e.tam > 1 ? 's' : ''}${e.miclic ? ` and ${e.miclic} MICLIC` : ''}${enough ? '' : `: short of ${lanes - e.tam}, the rest by hand`}` },
  };
}

// ── inundation (p 452-453): a belt of water in front of a defence ───────────────────────────────────────────────────

/** The inundation asked for: the belt's depth (the table's 300, 500 or 1000 yd), the water fed in, the soil. */
export interface InundSpec { beltYds: 300 | 500 | 1000; cusecs: 50 | 100 | 150; soil: InundSoil }
export type InundSoil = 'sand' | 'sandyLoam' | 'loam' | 'clayLoam' | 'siltyClayLoam' | 'clay';
const YD = 0.9144;
/** Permeability, ft a day (p 453 Saturation of Soils), by soil: [low, high]. */
const PERM: Record<InundSoil, { word: string; ft: [number, number] }> = {
  sand: { word: 'sand / loamy sand', ft: [10, 20] },
  sandyLoam: { word: 'sandy loam', ft: [5, 10] },
  loam: { word: 'loam / silt loam', ft: [1.5, 5] },
  clayLoam: { word: 'clay loam', ft: [0.5, 1.5] },
  siltyClayLoam: { word: 'sandy / silty clay loam', ft: [0.1, 0.5] },
  clay: { word: 'clay', ft: [0.05, 0.1] },
};
export const INUND_SOILS = Object.keys(PERM) as InundSoil[];
export const soilWord = (s: InundSoil) => PERM[s].word;

/**
 * The time to inundate a defence's front (p 452-453), by compartments of 1000 yd along it: each built by 4 Pls and 4
 * Size II dozers in 8, 10 or 14 days (a 300, 500 or 1000 yd belt), half a day off for each common dyke; the Pls the
 * engineers have share the compartments; then filled one after another from one source (34-100 h a 1000 yd belt at
 * 150-50 cusecs, pro rata), then the soil saturated to 2.5 ft (2-3 ft makes an effective bog). Soils that saturate in
 * 2-4 days are the ones suitable (p 453). Planning, design and delays are not counted. Null without the table.
 */
export function inundation(engrData: any[], frontageM: number, e: EngrType | null, spec: InundSpec): { row: Check; days: number; beltM: number; compartments: number } | null {
  const t = (engrData ?? []).find((x: any) => /Inundation/i.test(String(x?.title)));
  if (!t || !(frontageM > 0)) return null;
  const rowOf = (table: string) => (t.rows ?? []).find((r: any) => r.Table === table && Number(r['Depth of Inundation Belt (Yds)']) === spec.beltYds);
  const build = Number(rowOf('Const of One Compartment')?.['Time Req (Days)']);
  const fillH = Number(rowOf('Filling of One Compartment')?.[`Time Req (Hrs) ${spec.cusecs} Cusecs`]);
  if (!(build > 0) || !(fillH > 0)) return null;
  const n = Math.max(1, Math.ceil(frontageM / (1000 * YD)));
  const pls = e?.pls ?? 0;
  // teams of 4 Pls; with fewer than 4 Pls one team works slower in proportion
  const teams = Math.max(1, Math.floor(pls / 4));
  const slow = pls > 0 && pls < 4 ? 4 / pls : 1;
  const buildDays = Math.max(build, (n * build - (n - 1) * 0.5) / teams) * slow;
  const fillDays = (fillH * n) / 24;
  const p = PERM[spec.soil];
  const sat: [number, number] = [2.5 / p.ft[1], 2.5 / p.ft[0]];
  const suitable = sat[1] >= 2 - 1e-9 && sat[0] <= 4 + 1e-9 ? 'suitable' : sat[1] < 2 ? 'fast' : 'slow';
  const days = buildDays + fillDays + (sat[0] + sat[1]) / 2;
  const d1 = (x: number) => (x >= 10 ? Math.round(x).toString() : x.toFixed(1));
  const st: CheckState = suitable === 'slow' ? 'fail' : suitable === 'fast' ? 'warn' : 'unchecked';
  const who = e ? `${e.name} (${pls} Pls: ${teams} team${teams > 1 ? 's' : ''} of 4${slow > 1 ? `, short of 4 Pls: ${d1(slow)} times as long` : ''})` : 'one team of 4 Pls (no engineers chosen)';
  return {
    days, beltM: Math.round(spec.beltYds * YD), compartments: n,
    row: {
      name: 'Inundation', st,
      reason: `A ${spec.beltYds} yd (${Math.round(spec.beltYds * YD)} m) belt across ${(frontageM / 1000).toFixed(1)} km: ${n} compartment${n > 1 ? 's' : ''} of 1000 yd. Build ${d1(buildDays)} days by ${who}, 4 Size II dozers a compartment (${build} days each, half a day off a common dyke); fill ${d1(fillDays)} days at ${spec.cusecs} cusecs (${fillH} h a compartment); saturate ${d1(sat[0])}-${d1(sat[1])} days in ${p.word} (${p.ft[0]}-${p.ft[1]} ft a day to 2.5 ft)${suitable === 'suitable' ? ': within the 2-4 days the book calls suitable' : suitable === 'fast' ? ': quicker than the 2-4 days the book calls suitable, more water lost to percolation (p 453 notes 2, 3)' : ': over the 2-4 days the book calls suitable: it will not bog in time'} (SO's Hbk pp 452-453). About ${d1(days)} days in all, before planning, design and delays: begun before the defence is occupied, it is set against the warning time you have. Tilling (1-2 tractor days a compartment) and the distys are extra. Wire, AT ditches and demolitions: the ORBAT prints no rates, not timed`,
    },
  };
}

/**
 * A defence with an inundation belt (a new recipe `-inu`; the one passed in is not changed): an Obstacle Zone labelled
 * Inundation across the front of the forward posns, beyond the protective minefield (its stand-off, its depth and 100 m),
 * as deep as the belt. The map has no flooded-area symbol.
 */
export function withInundation(r: Recipe, doc: DoctrineSet, spec: InundSpec): Recipe {
  if (r.task !== 'defence' || r.inund) return r;
  const fwd = r.slots.filter((s) => s.kind === 'fwd').map((s) => s.role);
  if (!fwd.length) return r;
  const off = resolveRange(doc, { doctrine: 'standoff.obstacleInFrontM' })?.[0] ?? 200;
  const mf = resolveRange(doc, { doctrine: 'standoff.protectiveMinefieldDepthM' })?.[1] ?? 300;
  const beltM = Math.round(spec.beltYds * YD);
  const out: Recipe = JSON.parse(JSON.stringify(r));
  out.slots.push({ role: 'inund', kind: 'obstacle', sym: '25270200', label: 'Inundation', order: 4, rule: { inFrontOf: fwd, distM: off + mf + 100, depthM: beltM } } as any);
  out.id = `${r.id}-inu`;
  out.name = `${r.name}, inundated`;
  out.inund = spec;
  out.note = `${r.note ?? ''} An inundation belt ${spec.beltYds} yd (${beltM} m) deep beyond the protective minefield (SO's Hbk pp 452-453; PlanEngr.withInundation).`.trim();
  return out;
}
