/**
 * PlanEngr.ts — PURE. Engineers with a plan, from the ORBAT (engr.json, SO's Hbk 2019 Sec 4, pp 402-454):
 *
 * - the engineer units a plan can be given: a Fd Coy, the Indep Fd and Mech Coys, the Div's Offn and Def Engr Bns, the
 *   Mech, Aslt and Br Bns; each with its Fd Pls (they lay mines and breach by hand) and its equipment: MMLs, TAMs, MICLIC,
 *   AVLBs, ribbon bridge, AM-50 / HMB bridge sets;
 * - the protective minefield in time with them (p 439: an Engr Pl 780 mixed clusters in 24 h; a Fd Coy with a set of 6
 *   MMLs 9000 m of ATMs in 24 h, ideal conditions, figures under trial);
 * - their bridging across a gap (pp 427-432: the ribbon bridge, AM-50, the AVLB) and their mechanical breach (p 451: TAM).
 *
 * No ArcGIS, no DOM. The data is passed in, so Node can test it.
 */
import type { Check, CheckState } from './PlanSolve';
import type { OrbatSet } from './PlanOrbat';

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
      src: `SO's Hbk 2019 p ${u.page ?? '?'} (${id})`,
    });
  }
  return out;
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
export function bridgeKinds(engrData: any[]): { ribbon: BridgeKind | null; am50: BridgeKind | null; avlb: BridgeKind | null } {
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
  return { ribbon, am50, avlb };
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
