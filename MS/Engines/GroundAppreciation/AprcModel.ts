/**
 * AprcModel.ts
 *
 * The appreciation of the situation as one model (Appreciation_Plan.md s4). Pure: no DOM, no map, no bundle.
 *
 * The outline follows the layout of a written appreciation: parts (REVIEW OF SIT, AIM, FACTORS, COURSES, PLAN), groups
 * inside FACTORS (Gr and Weather, En Sit, Own Sit, Time and Space) and numbered paragraphs with sub-paragraphs. Headings
 * only: the wording of every paragraph is drafted from the map or left to the planner.
 *
 * Rules the model keeps (user's decisions, 22 Nov 2026):
 *   - a paragraph the planner writes is his (`mine`) and is never overwritten by a new reading; when the draft under it
 *     has changed since, it is marked stale, not replaced;
 *   - a proposal (`judge`) is never printed as fact: the fair copy prints it only once accepted, else a ruled line;
 *   - what the data cannot tell is left as a ruled line (`draft: null`), never guessed;
 *   - the marking at head and foot of every page, like the address block, is a ruled line to fill or stamp by hand:
 *     the model holds no marking text;
 *   - the outline is chosen by kind: `def` from the specimen AprDf; `attk` from "Mechs of Aprc (Attk)" (22 Nov 2026), its
 *     prompts citing the book's sheet (`MA`); `wdr` from OoW Vol III (24 Nov 2026, R78), its prompts citing the printed
 *     page (`O3`). A kind is added with `registerOutline`.
 */

export type AprcKind = 'def' | 'attk' | 'wdr';
/** Where a paragraph's draft came from: the ground reading, symbols / a plan on the map, a proposal to judge, or nothing (the planner's). */
export type AprcState = 'gr' | 'map' | 'judge' | 'yours';
export type AprcCopy = 'fair' | 'draft';
/**
 * Which reading a draft came from, so a change can say what changed: the ground (`gr`), the symbols on the map (`map`),
 * the last Check my plan (`plan`), the en options of the IPB reading (`en`), the ORBAT (`orbat`), timings worked out
 * from H and the Time Req (`time`), or a new H on the sheet (`h`, a cause only).
 */
export type AprcSrc = 'gr' | 'map' | 'plan' | 'en' | 'orbat' | 'time' | 'h' | 'aim';

/**
 * The aim's limitations, as the planner sets them in the Aim's panel (given by the higher comd; Understanding Aprc
 * pp 3-4, 7-8, 22; Mechs of Aprc (Attk) p 1). They draft the aim and drive the defence's layout, its analysis and the
 * attack's Time Calc. Times are D-times ("0600 D+1").
 */
export interface AprcLimits {
  /** Def: as far fwd as tac feasible. */
  fwd?: boolean;
  /** Def: the line of no pen (a line of def's letter, W X Y Z). */
  noPen?: string | null;
  /** Def: a place to be def at all costs. */
  allCosts?: string | null;
  /** Def: cause max attrition / delay onto the En. */
  attrition?: boolean;
  /** Def: delay the En for this many hours. Wdr: delay the En fwd of the new def posn for this many hours (OoW Vol III p 10 para 6c). */
  delayH?: number | null;
  /** Def: inflict this % of cas on the En (a C Tps msn, SZ Battle p 4 para 8 c, p 26 para 41 f: "delay the en for 48 hrs inflicting 30% cas"). */
  casPct?: number | null;
  /** Def: while remaining a viable force, judged against its later tasks (SZ Battle p 27 para 41 g). */
  viable?: boolean;
  /** Def: the def of a salient (def at its base). */
  salient?: boolean;
  /** Def: the En has pen the defs (the line of max pen taken as the border). */
  penetrated?: boolean;
  /** Def: not more than this many Coys. */
  maxCoys?: number | null;
  /** Def: to be ready by; Attk: area to be captured by (a D-time). */
  by?: string | null;
  /** Attk: ensure max destr of the En (block his wdr and rft before the attk). */
  destr?: boolean;
  /** Attk: to be conducted at ni. */
  night?: boolean;
  /** Attk: the obj is a tough area with bunkers (longer fighting on the obj). */
  bunkers?: boolean;
  /**
   * Def: the line of denial (a line of def's letter), spelt out by the higher comd with the msn; the line of no pen is
   * kept in view of it, and the two can be one (OoW Vol I pp 17-18).
   */
  denial?: string | null;
  /** Attk: a quick attk from contact (the Time Calc takes contact to H: MIB pp 89, 96-97, Annex L; IBB p 133). Not a limitation: the planner's. */
  quick?: boolean;
  /**
   * Attk: the climb from the SL to the obj, m (MW Annex F p 313 para 3 c). Not a limitation: the planner's. In mountains a Read
   * takes it off the 30 m elevation through the Ground Guide; a climb typed here overrides the one read.
   */
  climbM?: number | null;
  /** Wdr: the posn to be denied to the En until (a D-time; OoW Vol III p 19 para 17a). */
  deny?: string | null;
  /** Wdr: no rearward mov except recce parties before (a D-time; OoW Vol III p 19 para 17b). */
  noMovBefore?: string | null;
  /** Wdr: the line all tps are to be clear of (its name) and by when (a D-time; OoW Vol III p 19 para 17c). */
  clearLine?: string | null;
  clearBy?: string | null;
  /** Wdr: the new def posn, as given by the higher comd (OoW Vol III p 39 para 1). */
  newPosn?: string | null;
  /** Wdr: by day (a daylight wdr, normally avoided: OoW Vol III p 40 para 1). */
  byDay?: boolean;
  /** Further limitations, in the words given. */
  other?: string[];
}

export interface AprcBasis {
  /** data: a layer and its date; rule: a book rule; input: what the user set or marked; calc: how a figure was worked out. */
  kind: 'data' | 'rule' | 'input' | 'calc';
  text: string;
}

export interface AprcTable {
  head: string[];
  rows: string[][];
  /** Column widths as shares (sum 1); even when absent. */
  widths?: number[];
}

export interface AprcMine {
  text: string;
  /** Hash of the draft the planner wrote over: a different draft later marks the paragraph stale. */
  draftHash: string;
  at: string;
  /** What first changed the draft under his words (kept while it stays stale): says what to look at again. */
  staleBy?: AprcSrc;
}

export interface AprcPara {
  /** Stable id ('gr.apch.lt.capacity'): never the printed number. */
  id: string;
  head: string | null;
  /** The tool's words after the heading. '' = a heading only (its sub-paragraphs carry the text); null = cannot know. */
  draft: string | null;
  state: AprcState;
  mine?: AprcMine;
  /** A proposal the planner took as it stands. */
  accepted?: boolean;
  basis: AprcBasis[];
  /** Heads or facts to consider when the paragraph is the planner's. */
  prompts: string[];
  table?: AprcTable;
  /** Cells the planner typed into the table ("row,col" → text, row 0 is the first row under the head): his, never overwritten. */
  cells?: Record<string, string>;
  /** Rows the planner added under the drafted ones. */
  addRows?: number;
  /** Id of a figure printed under the paragraph. */
  figure?: string;
  children: AprcPara[];
  /** The reading its draft came from. */
  src?: AprcSrc;
  /** Its draft changed on the last Read (or on a new H): the cause, and the draft it had before (null: none). */
  changed?: AprcSrc;
  before?: { draft: string | null; table: boolean };
  /** The planner's last words given back to the tool, kept so they can be put back. */
  discarded?: { text: string; at: string };
  /** Rows he typed into were gone from a new reading: his cells kept as added rows (these, 0-based among the added). */
  moved?: { rows: number[]; at: string };
}

export interface AprcGroup {
  id: string;
  title: string | null;
  paras: AprcPara[];
}

export interface AprcPart {
  id: string;
  title: string;
  groups: AprcGroup[];
}

export interface AprcFigure {
  id: string;
  caption: string;
  kind: 'trace' | 'map';
  /** Vector (the trace). */
  svg?: string;
  /** Raster data URL (a shot of the live map; the trace rasterised for Word). */
  png?: string;
  w: number;
  h: number;
}

export interface AprcConfirm {
  text: string;
  /** Paragraph ids it touches. */
  paras: string[];
  /** The reading it came from (kept with that reading when it is not read again). */
  src?: AprcSrc;
}

/** What the reading was taken with. */
export interface AprcFrame {
  place: string;
  echelon: string;
  mover: string;
  month: string;
  season: 'dry' | 'wet';
  /** In words: "Bdy symbols", "a drawn box", "the Bn frame round the symbol". */
  aor: string;
  /** In words: "threat marker", "assumed forward of the AOR". */
  threat: string;
  readAt: string;
}

export interface AprcDoc {
  version: 1;
  kind: AprcKind;
  title: string;
  frame: AprcFrame | null;
  parts: AprcPart[];
  figures: AprcFigure[];
  confirm: AprcConfirm[];
  sources: string[];
  /** When each reading was last taken ("2027-02-15 11:00", the place's clock): a reading not taken again is kept. */
  readAt?: Partial<Record<AprcSrc, string>>;
  /** The aim's limitations, as the planner set them (the planner's, kept on every Read). */
  limits?: AprcLimits;
}

export interface AprcPatch {
  id: string;
  head?: string | null;
  draft?: string | null;
  state?: AprcState;
  basis?: AprcBasis[];
  prompts?: string[];
  table?: AprcTable | null;
  figure?: string | null;
  /** Replaces the sub-paragraphs (lists whose length follows the ground: approaches, ITGs, lines of def). */
  children?: AprcPara[];
  /** The reading it comes from (else the one `applyPatches` is given). */
  src?: AprcSrc;
}

// ── building ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function para(id: string, head: string | null, o: Partial<Omit<AprcPara, 'id' | 'head'>> = {}): AprcPara {
  return { id, head, draft: o.draft === undefined ? null : o.draft, state: o.state ?? 'yours', basis: o.basis ?? [], prompts: o.prompts ?? [], table: o.table, figure: o.figure, children: o.children ?? [], accepted: o.accepted, mine: o.mine };
}
/** A heading whose sub-paragraphs carry the text. */
const headOnly = (id: string, head: string, children: AprcPara[], state: AprcState = 'yours'): AprcPara => para(id, head, { draft: '', state, children });
/** The planner's paragraph: a ruled line, with the heads to consider. */
const yours = (id: string, head: string | null, prompts: string[] = []): AprcPara => para(id, head, { prompts });

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Ids made from labels stay unique: the second of a base gets -2, the third -3, in reading order (two posns or two
 * ITGs of the same name). `used` is shared by all the ids under one heading; pre-seed it with the fixed ones.
 */
export function uniqueId(used: Set<string>, base: string): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

/** The sub-heads of one Def Possibility. Those the ground reading can propose are filled by the writer; the rest stay the planner's. */
export const DP_HEADS: Array<[string, string]> = [
  ['fdls', 'FDLs'], ['depth', 'Depth'], ['strpt', 'Str Pt Def'], ['screens', 'Screens'], ['adv', 'Adv Posn'], ['bias', 'Bias of Def'], ['atk', 'Bias of A tk Def'],
  ['obs', 'Obs Plan'], ['surv', 'Surv and Obsn Plan'], ['df', 'DF Plan'], ['killing', 'Killing Areas'], ['catk', 'C Attk Objs'], ['cpen', 'C Pen Posns'], ['res', 'Res'],
  ['armr', 'Use of Armr / ATGM'], ['mor', 'Loc of Mor Pl'], ['hq', 'Bn HQ'], ['tac', 'Bn Tac HQ'], ['misc', 'Misc Measures'],
];

/**
 * The books' heads to consider under some DP heads (doctrine review, 24 Nov 2026): the res by OoW Vol I pp 19-20 (R75),
 * the str pt in mountains by MW pp 151-152, 166, 176 (R84). Prompts only: the planner judges.
 */
export const DP_PROMPTS: Record<string, string[]> = {
  fdls: [
    'In desert: defended localities accepting large gaps (DW p 22), gr held by fire and not by men (GSP-1947 p 172); str pts at the comm centres and ITG, adm self-sufficient (DW pp 27-28)',
    'In mountains: the dominating features astride the main axis and on its flks (MW p 147); features the En cannot afford to by-pass (GSP-1947 p 175); M fds thickest in the valleys / foothills (MW p 150); frontages comparatively narrow (OoW Vol I p 72)',
    'On a DCB: a Bde up to 8,000-10,000 m (GSP-1947 p 119 para 5); all three Bns three up, depth from their own resources (pp 120-121)',
  ],
  adv: [
    'Protective elms never so large as to weaken the main def (OoW Vol I p 13); posns held by covering tps and adv posns will not be reinforced (GSP-1947 p 105 para 10)',
    'In desert: covering tps preferred to adv posns, more screens, stay-behind parties (OoW Vol I p 71); covering tps move by ni, canalise the En into a killing gr, a handover line (DW pp 24-25)',
    'The room for them is the SZ\'s: none in Kashmir and the north, 2-5 km in the Punjab plains, 20-50 km in the desert (SZ Battle (C&SC) p 3 para 5)',
    'In a desert SZ: the C Tps msn, delay- or attrition-oriented, the other inbuilt (SZ Battle p 6 para 11); attraction (lure into KGs) or deflection (no pen, deflect into KGs / M fds) (p 11 para 22); in depth on the thrust lines, a line pattern rather than linear (para 22 a); ambush at 1200-1500 m (p 12), or 800-1200 m (p 26)',
    'Technique: successive DLs on a wide sec with too few tps for more than one line, alternate DLs on a narrow sec or when rft (SZ Battle pp 14-16 para 27); a KG in each sec along each DL, round the dhars in desert, battle posns ahead and astride it (p 13 para 25); a mask posn ahead of DL 1 (p 17); the BHOL, the C Tps rear bdry (p 5 para 9 h); their passage through the main def: junc pt, passage pts, lanes and guides, RV, conc area (pp 21-22 para 35)',
    'Grouping (SZ Battle pp 12-13 paras 23-24): a Cbt Gp (Armd Bde + 1-2 HAT Bns, or Mech Bde + HAT Bn + Armr Regt) on 60-70 km; a BG (armr, MIB or HAT heavy) on 20-25 km; a CAT (tk, MIB or HAT heavy) on 8-10 km, 6-8 km within a DL (p 17); recce elms by the Corps Recce Regt or the Div LAT Bn, onto the flks when pushed back (p 10 para 19)',
  ],
  cpen: [
    'A number of C pen posns planned and prepared right at the outset (GSP-1947 p 109 para 22); occupied within a Bn not later than 1.5-2 h after the En H, within a Bde 3 h (IBB p 310)',
    'In desert: tac res in the C pen mode less preferred, not ruled out (DW p 27)',
  ],
  armr: [
    'A tk wpns for the greatest density at the most vital area, never an even distribution (IBB p 73); ATGMs in bulk (OoW Vol I p 26); in desert concentrated on the most threatened tk apch, no dissipation (DW p 58)',
    'A Div res: an Inf Bde or elms, the Armd Regt or its bulk and the LAT Bn, under the Inf Bde Comd (GSP-1947 p 122 para 3)',
  ],
  res: [
    'Loc of the res by four factors: non-involvement (secure from fire, cover and concealment), availability (well fwd, in good time), dispersion (able to conc within the reaction time envisaged), the most likely En cap the plan rests on (OoW Vol I p 19)',
    'The three decisions: the point of employment, the timing of the counter manoeuvre, the dir (OoW Vol I p 20)',
    'Contingencies for its relocation should the En op unfold differently; its comd nominated at the outset (OoW Vol I pp 19-20)',
    'In desert: one-third or more of the force as res, mainly armr, retained down to Bde (DW p 26), employed within 2-6 h (DW p 27)',
    'In mountains: little value in a res upwards of Bn lvl from one central loc (MW p 169); split, positioned to launch at once or conc (GSP-1947 p 176)',
  ],
  strpt: [
    'In mountains: each Coy def posn at least a Pl str pt with 30 days staying power, on the most dominating feature difficult to reduce (MW p 152)',
    'In mountains: a post isolated holds 7 days at least (MW p 151); all posts stocked to fight 7 days when isolated (MW p 166)',
    'In mountains: one third of the force always holds the str pt (MW p 176)',
  ],
};

/** "Understanding Aprc - I" (Maj M Zeeshan Asghar Ch): `UA(3)` is its Sec I (Mechanics) printed p 3; `UA(1, 'V')` Sec V p 1; sheets of the specimens with `UA(7, 'II', true)`. */
export const UA = (p: number | string, sec = 'I', sheet = false): string => `Understanding Aprc${sec === 'I' ? '' : ` Sec ${sec}`} ${sheet ? 'sheet' : 'p'} ${p}`;

// ── the doctrine review's heads to consider (Doctrine_Review.md R79-R93, 24 Nov 2026) ───────────────────────────────
// Prompts only, each with its book and printed page; "In desert" / "In mountains" where the book is a terrain's.

/** Desert ITG (R79): DW p 7 (Gr of tac importance), p 20 (vital Gr to deny). */
const DESERT_ITG = [
  'In desert, Gr of tac importance: comm centres; terrain for the mnvr of mech forces; terrain to def the tac imp Gr; adm and maint areas; water sources (DW p 7)',
  'In desert, deny the vital Gr: comm centres, areas of adm sustenance, pivots of mnvr for the C attk, the lines of denial and no pen (DW p 20)',
];
/** The def's Gr from the En view, interdiction and spoiling attks (R83): MIB pp 161-162. */
const DEF_GR_MIB = [
  'The Gr weighed from the En point of view and his known caps; the apchs analysed for his probable use (MIB p 161)',
  'Interdiction tgts: defiles on the En expected routes, assy areas and other sensitive locs essential to an attacker (MIB p 162)',
  'Spoiling attks: mnvr forces fwd of the def posn to disrupt the En op and his rear areas (MIB p 162)',
];
/** The def's echelons and its main / secondary effort (GSP-1947 Inf Div in Battle; Aprc_Review.md, 28 Nov 2026). */
const DEF_GR_IDB = [
  'In the SZ (SZ Battle pp 24-25): arty fwd, 2/3 of the range toward own AOR, frontages wider near the fwd DL and compact near the BHOL, SP med / hy for close sp; AD first over the mech elms on the DLs, then the fall back, gun posns, HQ; engrs lay mines on the thrust lines along the DLs to cover gaps and lure the En into KGs, anti-trawl / tk ditches if time, tk posns, stay-behind posns, water, laterals',
  'Three echelons: the protective dets, the main posn and the res, resources allotted to each (GSP-1947 p 104 para 5)',
  'A main and a secondary def effort and adequate res; gaps accepted, covered by surveillance and counter-mobility measures (GSP-1947 p 104 para 4)',
];
/** Pri of work and prep time in mountains (R84, R88): MW pp 147, 172, 262. */
const DEF_TS_MTN = [
  'In mountains, pri of work: fighting and amn bunkers with the comn trenches; protective M fds and wire; adm bunkers with ration and water storage; living bunkers (MW p 172)',
  'In mountains: the difficulty of digging means more time for the prep of posns (MW p 147; no figure printed); maint in cold weather about five times the normal (MW p 262)',
];
/** Air sp requests (R93): SO's Hbk 2019 Sec 12. */
const AIR_SP = "Air sp: pre-planned requests up the chain fd units, Bde HQ, Div HQ, ASOC (SO's Hbk 2019 Sec 12 p 1203); emergency requests (p 1204); no timings printed";
/** Adm and Log in the def (R90): Logistics Support in the Field. */
const DEF_ADM = [
  'Commodity pts set up by the Div S&T Bn within or ahead of the DAA (lsf p 24): AP open 24 h, reached by the B ech vehs (p 25); PP open 2-4 h, 24 h for armd fmns (p 26); Sup P 2 h daily on a timed programme (p 27)',
  "1st line holdings: ammo as the unit estb; rations 3 days in reserve, the next day's and an emergency pack a man; POL tanks full with 80 km for A and B vehs, 100 l a C veh, gen sets 3 days at 16 h a day (lsf p 23)",
  'Cas evac: CAP, RAP, ADS, FTC, base hospital (lsf Annex L pp 81-82); never more than 4 h without expert treatment, surgery within 12 h (lsf p 47)',
  'In desert: def posns logistically self contained, able to fight for a pre-determined time without replenishment (DW p 21); str pts stocked with amn to fight on when isolated (DW p 85)',
  'SZ battle: arty ammo for the engagements along each DL worked out in second line lifts, generally 2-2.5 lifts, dumped on selected gun posns along each DL (SZ Battle p 25 para 38 f)',
];
/** The attack's Time Calc (R69, R70 / R82, R85): guns, the quick attk, the uphill assault. */
const ATTK_TS_BOOKS = [
  'Guns: depl excluding travel, a fd Bty 20 min by day and 40 by ni, a fd Regt 45 / 90 min; registration 20 min each plus 20 min (IBB p 122 para 5); the arty orders may govern H (IBB p 170 para 5)',
  'A quick attk, contact to H: a Coy 30-60 min, a Bn 60-100 min (MIB p 89); in an encounter a Coy at most 30-45 min, a Bn 1-2 h (IBB p 133): tick Quick attk in the Limitations box',
  'In mountains: the SL to the obj on the slant (30 degrees 1.16 to 70 degrees 2.93 times the map distance) and 1 h more for every 350 m of climb (MW Annex F pp 311-313): Read takes the climb off the 30 m elevation from the SL, else the FUP, to the obj; a climb typed in the Limitations box overrides it',
  'In mountains: longer moves to the assy, the aslt and the reorg; time for the guns, the log units and dumping; a reserve time for the unexpected (MW pp 80-81); rates by day 3 km/h, by ni 0.5-1 km/h, plus 30-60 min for every 300 m of ascent (MW p 81 para 7 b)',
];
/** The assault's frontage by echelon and ground (the attack's phases; Aprc_Review.md, 28 Nov 2026). */
export const ATTK_FRONT = [
  'Aslt frontage by ni: a Coy 250 m, a Bn two Coys up 450-650 m (IBB S47 para 17 a p 248); a Bde two Bns up from a brigaded FUP 1,100-1,500 m in the plains, each Bde a clear axis (GSP-1947 p 86 para 12 d); in desert up to 3,000-4,000 m, in mountains relatively compact, no figure (GSP-1947 p 87)',
  "By day wider (OoW Vol II p 36); in desert the ni attk's frontage and depth are half the day's, more in bright moonlight (DW p 47)",
  'Phases: thinking two down, the comd considers the phasing (GSP-1947 p 88); in mountains Bn attks in phases with liberal timings (MW p 82)',
];
/** The En res and their times (the attack's En caps): GSP-1947 beside IDD. */
export const EN_RES = 'En res (Indian): a Bn a Coy from the depth to react in 35-40 min; a Bde a tk Sqn and about two Coys in 2-3 h; a Div an Inf Bde and a tk Regt less a Sqn in 4-6 h; a Corps 12-16 h (GSP-1947 p 83); IDD p 5 differs: a Bn about 1 h, a Bde 2-4 h, a Div 4-6 h';
/** The En on a DCB (R92): Indian Defensive Doctrine. */
const IDD_OBS = 'En on a DCB: wire ahead of the water obs, the def M fd beyond it 600-800 m deep (IDD p 3; 600 m on p 5), mines and wire in the obs and below the water line, steep banks (IDD p 5)';
const IDD_ADV = "En on a DCB, its strengths (IDD pp 7-8): no assailable flk, a frontal aslt with heavy attrition; great delay, more with a twin ditch; inf separated from armr in the break-in; water regulated by headworks and regulators; obsn to the front and flks; bunkers that take air burst on own loc; no room for bridging on a twin ditch's middle bund";
const IDD_DIS = 'En on a DCB, its vulnerabilities (IDD pp 5-7): linear, once the crust is broken the whole def is jeopardised; a set, conspicuous pattern; limited all-round def, the bends reduce mutual sp; brs kept as reserve demolitions for the SZ tps, taken intact by a rapid adv; vertical envelopment; gaps and brs, also where nullahs cross; lack of depth except on the main apchs; rolled up sideways once ruptured';

function outlineDef(): AprcPart[] {
  const blankTable = (head: string[], first: string[]): AprcTable => ({ head, rows: first.map((f) => [f, ...head.slice(1).map(() => '')]) });
  return [
    {
      id: 'rev', title: 'REVIEW OF SIT',
      groups: [{ id: 'rev', title: null, paras: [
        yours('rev.en', 'En Forces', ['En forces opposite, their likely aim, when', 'What the En is (two steps up), where, the intent, in what time frame (a date if given, else D Day)', UA(7)]),
        yours('rev.own', 'Own Forces', ['The higher formation, its layout, units left and right, the reserve', 'What you are (two lvls up), where, the task, in what time frame, the neighbouring units', UA(7)]),
        yours('rev.air', 'Air Sit', ['As given; NBC conditions only when given', UA(7)]),
      ] }],
    },
    { id: 'aim', title: 'AIM', groups: [{ id: 'aim', title: null, paras: [yours('aim', null, ['The aim, with its limitations: set them in the Limitations box', 'Starts with "To", the limitations tabulated; a limitation leaves no practical variant (a msn essential does)', UA('7-8')])] }] },
    {
      id: 'fac', title: 'FACTORS',
      groups: [
        { id: 'gr', title: 'Gr and Weather', paras: [
          yours('gr.gen', 'Gen Description'),
          headOnly('gr.apchs', 'Apchs', []),
          para('gr.itg', 'ITGs', { draft: '', prompts: [...DESERT_ITG] }),
          yours('gr.obs', 'Obs'),
          yours('gr.cover', 'Cover'),
          yours('gr.met', 'Met Conditions'),
          headOnly('gr.ded', 'Deductions', [
            headOnly('gr.ded.basic', 'Basic Deductions', [
              yours('gr.ded.pri', 'Pri of Apchs'),
              yours('gr.ded.comb', 'Pri of Comb of Apchs'),
              yours('gr.ded.lines', 'Lines of Def'),
            ]),
            headOnly('gr.ded.dp', 'Def Possibilities (DPs)', [
              headOnly('gr.ded.dp1', 'DP 1', DP_HEADS.map(([k, h]) => yours(`gr.ded.dp1.${k}`, h, DP_PROMPTS[k] ?? []))),
              yours('gr.ded.dp2', 'DP 2'),
            ]),
            yours('gr.ded.common', 'Common Deductions', ['Bias of A tk def', 'Incl of BUAs into the def', 'Obs plan', 'Surv plan', 'Loc of adv posn', 'Pri of C attk objs', 'Anti-infil measures', 'A tk measures: addl A tk M fd in area __', 'Use of moon lt hrs for the prep of def', 'Emp of the Fd Pl Engrs', 'Emp of LAT / HAT elms', 'Emp of tks', 'Never start a deduction with "Keeping in view"', UA(8), UA(1, 'V'), ...DEF_GR_MIB, ...DEF_GR_IDB]),
          ]),
        ] },
        { id: 'en', title: 'En Sit', paras: [
          yours('en.comp', 'En Composn and Disposn'),
          yours('en.expect', 'En Expectations of Our Action'),
          headOnly('en.opts', 'Options Aval to the En', [
            headOnly('en.opt1', 'Option 1', [yours('en.opt1.what', null, ['Force, apchs used, phases with timings']), headOnly('en.opt1.an', 'Analysis', [yours('en.opt1.adv', 'Advs of the Option Aval to En'), yours('en.opt1.dis', 'Disadvs of the Option')])]),
            yours('en.opt2', 'Option 2'),
            yours('en.danger', 'Most Dangerous Option'),
            yours('en.probable', 'Most Probable Option'),
          ]),
          yours('en.vis', 'Vis of En Op', ['The logical unfolding of the En op, stage by stage with timings: "En is likely to", never "En will"', 'A logical success to the En at every stage; no own response in it; the decisive actions only', 'Worst to yourself, best to the En', UA('9-11')]),
          headOnly('en.ded', 'Deductions', [
            yours('en.ded.dp', 'DP', ['Each DP confirmed, modified or refined', 'Cfm of the basic deductions (pri of apchs, ITGs, lines of def, DPs): "stands cfm", or the change', UA(9)]),
            yours('en.ded.common', 'Common Deductions', ['Use of fire sp', 'Clearance of SZ and BOPs', 'Clearance of the SZ: in the Punjab by the holding fmn; in desert by daylight, a Flight Path Bde on the BOPs then an Armd / Mech Bde ex RAPID(D) on 20-25 km, its lean-on unit into the M fd 15-20 min before H (SZ Battle pp 3, 7-8); his shallow mnvr round a DL 10-15 km in 3 h, a deep one 20-25 km in 6 h (p 19)', 'Use of air', 'En likely FAA / Assy A', 'Heliborne / infiltration force', 'In desert his offn: two efforts 40-90 km wide, a feint by the Holding Corps 50-60 km away, para / heliborne forces up to a Bde at a time into the intmed depth (SZ Battle p 7)', 'En deception and surprise', 'En air superiority: passive and active AA measures', 'A tk plan; separating armr from inf', 'Delay', 'Anti-infil measures', 'Pri of C attk objs', 'Denial of the MSR', 'Const of a str pt (if applicable)', UA(1, 'V'), UA('4-5', 'II', true)]),
          ]),
        ] },
        { id: 'own', title: 'Own Sit', paras: [
          yours('own.comp', 'Composn of Own Forces'),
          yours('own.disp', 'Own Disposns'),
          para('own.str', 'Own Str as Related to that of the En', { draft: '', table: blankTable(['Ser', 'Arms', 'En', 'Own', 'Ratio'], ['a.', 'b.', 'c.', 'd.', 'e.']) }),
          headOnly('own.tasks', 'Assessment of Tasks', [
            para('own.tasks.dp1', 'DP 1', { draft: '', table: blankTable(['Ser', 'Locs', 'Inf', 'A tk', 'Engrs'], ['(1)', '(2)', '(3)', '(4)', '(5)']), prompts: ['Think two down: a Bn comd allots tasks and areas down to Pl posns, so his ideas are practicable (MIB p 162)'] }),
            yours('own.tasks.dp2', 'DP 2'),
          ]),
          headOnly('own.ded', 'Deductions', [
            yours('own.ded.basic', 'Basic Deductions', ['Almt of tps to tasks: how the tps needed are brought within those held']),
            yours('own.ded.common', 'Common Deductions', ['Reuse of tps', 'Demand for addl resources', 'Emp of addl A tk resources', 'Use of def stores', 'Use of armr', 'Tk hunting parties', 'Anti heliborne force', 'Emp of the Bn Cdo Pl', 'Method of covering large gaps', 'Emp of obsrs: arty with the protective dets, mor with the FDLs', 'Emp of CAF: less sensitive tasks, depth, the least threatened apch', UA(1, 'V'), UA(6, 'II', true)]),
          ]),
        ] },
        { id: 'ts', title: 'Time and Space', paras: [
          headOnly('ts.data', 'Time Data', ['Time Now', 'I Day', 'M Day', 'D Day', 'Time by which def to be occupied', 'Time by which def to be ready', 'First Lt', 'Last Lt', 'Total time aval'].map((h) => yours(`ts.data.${slug(h)}`, h))),
          para('ts.req', 'Time Req', { draft: '', table: blankTable(['S/No', 'Activity', 'Time (hrs)'], ['a.', 'b.', 'c.', 'd.', 'e.', 'f.', 'g.', '']) }),
          headOnly('ts.ded', 'Deductions', [yours('ts.ded.dp', 'DP', ['Essential timings: mov from the conc A to the FDLs, prep of the main posn, of the screens, obs / mine laying, def ready', UA(7, 'II', true)]), yours('ts.ded.common', 'Common Deductions', ['Pri of work when time aval is less than time req', 'Less time aval: simultaneous activities; prep of depth and C pen posns, mining round them, by day; ask the Bde Comd for addl resources', 'More time aval: more to cam and clt, clearance of F of F, rehearsals of C attk / C pen', 'Utilising day lt hrs; simultaneous recce', UA(1, 'V'), UA('7-8', 'IV'), ...DEF_TS_MTN])]),
        ] },
      ],
    },
    {
      id: 'crs', title: 'COURSES',
      groups: [{ id: 'crs', title: null, paras: [
        yours('crs.a', 'Course A', ['In paragraph form, not starting "To": def along line __, FDLs, depth, screens, covering tps, flk protection, res, C attk objs in pri, C pen posns, bias of def and of A tk def, commencing and completing the prep', 'Give all disposns, reactions and timings; no need for the Bn mors, BHQ, arty OP, DFs', UA(11)]),
        para('crs.react', 'En Reactions and Own Ctr Actions', { draft: '', table: blankTable(['Ser', 'En Reactions', 'Own Ctr Actions'], ['a.', 'b.', 'c.', 'd.']), prompts: ['In the three phases of the def battle: prep, aslt, C attk', UA(13), UA('27-28')] }),
        headOnly('crs.an', 'Analysis', [yours('crs.an.adv', 'Advs', ['Only those on the gr; the limitations turned into advs; fundamentals of def (EFTMADRAS)', 'Not "def on higher gr", "locs mutually sp", "good depth": name the gr', UA(12)]), yours('crs.an.dis', 'Disadvs', [UA('12-13')])]),
        yours('crs.b', 'Course B', ['On the same lines as Course A, shorter', UA(11, 'II', true)]),
        yours('crs.adopted', 'Course Adopted', ['With reasons']),
      ] }],
    },
    {
      id: 'plan', title: 'PLAN',
      groups: [{ id: 'plan', title: null, paras: [
        yours('plan.msn', 'Msn'),
        headOnly('plan.exec', 'Exec', [yours('plan.exec.outline', 'Gen Outline'), yours('plan.exec.tasks', 'Grouping and Tasks'), yours('plan.exec.coord', 'Coord Instrs', ['Timings: occ to start, def ready, screens and standing ptls in posn, C pen ready, mine laying done', 'Bdrys', 'Pri of work, almt of def stores, killing areas, screens, SP / LP', UA('29-30'), AIR_SP])]),
        yours('plan.adm', 'Adm and Log', DEF_ADM),
        yours('plan.comd', 'Comd and Sig'),
      ] }],
    },
    {
      id: 'anx', title: 'ANX P: SKETCH',
      groups: [{ id: 'anx', title: null, paras: [para('anx.sketch', 'Details to be Marked', { prompts: ['Marked two steps down (a Bn to its Pls); SD aspects, map intersections', UA('14'), UA('31-32')] })] }],
    },
  ];
}

// ── the attack ───────────────────────────────────────────────────────────────────────────────────────────────────
// The heads to consider are "Mechs of Aprc (Attk)"'s (Material/Literature/1. Books/MECHS OF APRC - ATTK.pdf, 21 sheets, a
// Coy Comd's attack appreciation; user, 22 Nov 2026; the book prints no page numbers: "p N" is its N-th sheet). The layout
// is the IE's (user, 28 Nov 2026: Material/Literature/Sample IEs/8. Aprc - Attk, the Req and its solution): Gr and Weather
// ITGs, Apchs, Deductions (basic, the attk options, common); En Sit, Own Sit and Time and Space group headings over their
// numbered paras; Courses A and B (only the differences), the course adopted, the En reactions; the Plan's Msn and Exec;
// Anx P. Its "l. Effect if captured" and "m. Effs if Captured" are one head here (m carries the effects). What the book
// gives as specimen wording ("Ref to whites" never) is a prompt, never printed.

/** The book's sheet, cited in the prompts. */
export const MA = (p: number | string): string => `Mechs of Aprc (Attk) p ${p}`;
/** The planner's paragraph with the book's heads to consider and its page. */
const yoursA = (id: string, head: string | null, p: number | string, prompts: string[] = []): AprcPara => para(id, head, { prompts: [...prompts, MA(p)] });

/** The heads of one Imp Tac Gr (p 1-2); the writer fills those the ground can tell. */
export const ITG_HEADS_ATTK: Array<[string, string, string[]]> = [
  ['loc', 'Definition', ['Where it lies: __ m north of __ and __ m east of __ (the IE solution)']],
  ['size', 'Size / Type / Configuration', ['BUA, raised gr, ruins, BOP; its size']],
  ['def', 'Tps Needed to Def', []],
  ['capture', 'Tps Req to Capture', []],
  ['depth', 'Depth', ['What gives it depth behind']],
  ['mutual', 'Mutual Sp', ['By fire, obsn, comms, shifting of tps']],
  ['cover', 'Cover', []],
  ['obsn', 'Obsn', []],
  ['domination', 'Domination', []],
  ['dir', 'Best Dir of Attk', []],
  ['effs', 'Effs if Captured', ['Will facilitate further capture of __ and __', 'My op towards __ will be facilitated', 'Opens an initial firm base for subsequent dev of op towards __ (depth loc of the en)', 'Affords a straight run to __ and will render en stay at __ difficult', 'Will dominate / open Rd / Tr __', 'It will unhinge the en def']],
  // the Req: "explain MITG in detail with significance and effs if captured"; the IE solution's last head
  ['sig', 'Significance', ['Due to its relative ht it dominates the surrounding areas in terms of obsn and F of F', 'It will render the def untenable if captured', 'It dominates the Rd __, the likely MSR (the IE solution)']],
];

/**
 * The Req's economy for the attack's apchs: only the pri apch defined and explained, the others their definition and
 * significance only. The pri apch (own side, `lt` / `cen` / `rt`, the dir of attk's first) goes first; under the others
 * the heads the planner has not written in are dropped. Nothing happens when the pri apch is not among them.
 */
export function briefApchs(doc: AprcDoc, pri: string | null): void {
  const ap = find(doc, 'gr.apchs');
  if (!ap || !pri) return;
  const first = ap.children.find((c) => c.id === `gr.apch.${pri}`);
  if (!first) return;
  const keepHead = (c: AprcPara) => /\.(definition|significance)$/.test(c.id) || !!c.mine;
  ap.children = [first, ...ap.children.filter((c) => c !== first).map((c) => (c.id.startsWith('gr.apch.') && c.children.length ? { ...c, children: c.children.filter(keepHead) } : c))];
}
export const itgHeadsAttk = (base: string): AprcPara[] => ITG_HEADS_ATTK.map(([k, h, pr]) => yoursA(`${base}.${k}`, h, 2, pr));

/** The heads of one apch (p 2-3), in the book's order; ids as the defence's (the head's slug). Tfc is the book's hand note on p 2. */
export const APCH_HEADS_ATTK: Array<[string, string[]]> = [
  ['Definition', ['It originates from __ (own conc area / intl border), passes through __ and terminates at __ (the en\'s rear or depth loc)']],
  ['Length', ['Approx __ km']],
  ['Capacity', ['It can take a __ size force: the capacity to depl 1/3 of the offn force and mnvr 2/3 round it; a Bde size force takes approx 4 km']],
  ['Cover', ['Cover from obsn: air, gr', 'Cover from fire: dir, indir (reverse slopes, BUAs)']],
  ['Mutual Sp', ['By the __ apch in terms of fire, obsn, comms, shifting of tps']],
  ['Depl Areas', ['Area req for the FAA, FUP or BOF, in relation to the quantum of force emp along the apch']],
  ['Obs', ['Maj obs on it, with their obs value']],
  ['Dominating Features', ['Whichever feature affects the mov']],
  ['Obsn and F of F', ['Obsn is clear up to __ m / land mk; if restd, the place up to which restd']],
  ['Tfc', ['Good owing to Rd __']],
  ['Dir Keeping', ['Easy (if so) due to Rd / Tr __ and prominent land mks __']],
  ['Significance', ['Flanking in nature', 'Where it leads to', 'Less expected', 'Armr can be used in CS', 'Shortest apch', 'Draws max str from terrain']],
];

/** The Assessment of Tasks and Almt of Tps to Task tables (p 11-12): the book's rows, the figures the planner's. */
export const TASK_HEAD_ATTK = ['Ser', 'Task / Loc', 'Inf (Sec)', 'Armr (Tp)', 'Aslt Pnr', 'Arty', 'BS / W pn Sec'];
export const taskRowsAttk = (ph1: string[] = [], ph2: string[] = [], bof: string | null = null): string[][] => {
  const blank = (s: string, t: string): string[] => [s, t, '', '', '', '', ''];
  return [
    blank('1.', 'Phase 1'), ...(ph1.length ? ph1 : ['']).map((x) => blank('', `- ${x}`.replace(/^- $/, '-'))),
    blank('2.', 'Phase 2'), ...(ph2.length ? ph2 : ['']).map((x) => blank('', `- ${x}`.replace(/^- $/, '-'))),
    blank('3.', bof ? `BOF: ${bof}` : 'BOF'),
    blank('4.', 'Misc'), blank('', '- FUP protection'), blank('', '- Clearance of route for F ech'), blank('', '- Blocking posn'), blank('', '- Feint activity'),
    blank('', 'Total'),
  ];
};

/** Backward Calc of Timings (p 14): the book's events; the times are the planner's (the book's are a specimen). */
export const BACKWARD_EVENTS = ['Completion time', 'Final reorg', 'Unforeseen', 'Completion Phase 2', 'Fighting on Obj', 'SL to Obj Phase 2', 'A hr (not later than)', 'Stay in FUP Phase 2', 'Reorg Phase 1', 'Unforeseen', 'Fighting on Obj', 'FUP to Obj Phase 1', 'H hr', 'Stay in FUP', 'FAA to FUP', 'Unforeseen', 'Rest and rehearsal', 'Recce, planning and orders'];

/**
 * The attack, laid out as the IE's requirement for the gist of a Bn attack aprc (the Req, "As CO __, write gist of aprc
 * to incl fol", and its Anx P list) and the solution that answers it (Soln Aprc Attk, 2 NLI; user, 28 Nov 2026): REVIEW
 * OF SIT, AIM, FACTORS (Gr and Weather: ITGs, Apchs, Deductions; En Sit; Own Sit; Time and Space as group headings with
 * numbered paras under them), COURSES, PLAN, ANX P. The heads to consider stay the book's ("Mechs of Aprc (Attk)", its
 * sheet cited) and the doctrine books'; the ids are the same as before, so every writer still fills its paragraph.
 */
function outlineAttk(): AprcPart[] {
  return [
    {
      id: 'rev', title: 'REVIEW OF SIT',
      groups: [{ id: 'rev', title: null, paras: [
        yoursA('rev.en', 'En', 1, ['The gist only (the Req)', 'Discuss two up', 'Hostilities between __ and __', 'Loc / intentions: where the en is presently conc and what the En is expected to do', 'Any aspect of heliborne']),
        yoursA('rev.own', 'Own', 1, ['Discuss two up', 'Task of own Bde and what the comd wants to do', 'Depl of neighbouring Bns', 'Addl resources altd: UC, in DS, in sp (the IE solution)', 'Any other detail given by the Bde comd']),
        yoursA('rev.air', 'Air Sit', 1, ['All aspects of air, both own and en']),
      ] }],
    },
    {
      id: 'aim', title: 'AIM',
      groups: [{ id: 'aim', title: null, paras: [
        para('aim', null, {
          prompts: ['To capture / clear area __ or __ complex with fol limitations', MA(1)],
          children: [
            yoursA('aim.destr', null, 1, ['Ensure max destr of the en in process']),
            yoursA('aim.wdr', null, 1, ['Prevent wdr or rft of the en from area __']),
            yoursA('aim.by', null, 1, ['Area to be captured / cleared by __ hrs __ (month / year)']),
          ],
        }),
      ] }],
    },
    {
      id: 'fac', title: 'FACTORS',
      groups: [
        { id: 'gr', title: 'Gr and Weather', paras: [
          // (1) ITGs: the MITG in detail with its significance and effs if captured; the rest listed in order of pri (the Req)
          para('gr.itg', 'ITGs', {
            draft: '',
            prompts: ['Explain the MITG in detail with its significance and effs if captured; list the rest of the ITGs in order of pri (the Req)', MA(1)],
            children: [headOnly('gr.itg.mitg', 'MITG', itgHeadsAttk('gr.itg.mitg')), yoursA('gr.itg.rest', 'Other ITGs in Order of Pri', 2, ['My other ITGs in order of pri are:- (1) __ (2) __ (3) __ (the IE solution)'])],
          }),
          // (2) Apchs: only the pri apch defined and explained; the others their definition and significance (the Req)
          para('gr.apchs', 'Apchs', {
            draft: '',
            prompts: ['Define and explain only the pri apch; for the other apchs only the definition and significance (the Req)', MA(2)],
            children: [para('gr.apch.note', null, { prompts: ['Named A, B, C or northern, southern etc; from own conc area up to the area where it accomplishes own msn', 'Capacity: 2/3 of the force able to mov depl; a Bde size force takes approx 4 km', MA(2)] })],
          }),
          // (3) Deductions: (a) basic, (b) Attk Option-1 and only the differences in Option-2, (c) any three common (the Req)
          headOnly('gr.ded', 'Deductions', [
            headOnly('gr.ded.basic', 'Basic Deductions', [
              yoursA('gr.ded.obj', 'Pri of ITGs', '3-4', ['Irrespective of the dir of attk: the highest and most dominating feature, obsn and F of F all round, near the main Rd / Tr junc, access to the Rd, capture of the area', 'All the apchs terminate on it', 'Most dominating feature of tac significance', 'Dominates the main Rd / Tr; physical clearance needed before capturing it', 'Facilitates further op towards __', 'Mutually sp by all other imp tac gr', 'In desert, objs: comm routes and centres, sources of water supply and adm installations; the En sited on the Gr dominating the apchs to them (DW p 38)', DESERT_ITG[0]]),
              yoursA('gr.ded.apch', 'Pri of Apchs', 4, ['Sufficient space for armr in CS / fire sp', 'Fewer dominating features', 'Flanking in nature: capture of the MITG in the initial phase', 'Shorter; leads dir to the depth of the obj', 'Unexpected', 'Easy dir keeping', 'Suitable depl areas', 'Only obs that can be passed, negotiated or crossed with little engr effort']),
              yoursA('gr.ded.comb', 'Pri of Comb of Apchs', 4, ['Mutual sp, cover, lesser terrain friction; taking more imp tac grs in one phase']),
            ]),
            headOnly('gr.ded.aps', 'Attk Options', [
              para('gr.ded.ap1', 'Attk Option-1', {
                prompts: ['Attk in two phs using __ apch (the IE solution)', 'To attk from Lt / Rt with two Coys / Pls up with tks in CS / fire sp / blocking posn, in two phases, starting the op in the early hrs / later part of the ni', MA(5), 'A main attk on the decisive obj and a secondary attk in another area to fix the En and stop him reacting against the main one (GSP-1947 p 84 para 7)'],
                children: [
                  yoursA('gr.ded.ap1.ph1', 'Ph 1', 5, ['Attk on __ and __ each with a Coy size force sp by a tp of tks, completing the op in __ mins (the IE solution)', 'Capturing __ and __ with a Pl / Pl plus each with tks in CS / fire sp, keeping a Pl in res; 45-60 mins']),
                  yoursA('gr.ded.ap1.ph2', 'Ph 2', 5, ['Attk on __ and __ each with a Coy size force, over PH-I, completing the op in __ mins', 'Capturing __ with a Pl with tks in CS / fire sp; 30-45 mins']),
                  headOnly('gr.ded.ap1.depl', 'Depl Areas', [
                    yoursA('gr.ded.ap1.fup', 'FUP', 5, ['Not less than 1,000-1,200 m from the obj in the plains, less in broken gr and BUAs (IBB pp 201, 203)', 'In mountains no classic FUP: the tps do not form up in extended lines, they cross a designated place at H (MW p 85); with NVDs outside the eff range of MGs, behind cover (MW p 228)']),
                    yoursA('gr.ded.ap1.bof', 'BOF', 5, ['BOF for Ph 1 and for Ph 2: __ for ph-1 and __ for ph-2 (the Req; the IE solution)']),
                    yoursA('gr.ded.ap1.faa', 'FAA', 5),
                  ]),
                  yoursA('gr.ded.ap1.fech', 'Route for F Ech', 5, ['Along Rd / Tr __ with RV at __']),
                  yoursA('gr.ded.ap1.block', 'Blocking Posn', 5, ['If any: estb at __ with __ force, __ mins prior to H, using __ route']),
                  yoursA('gr.ded.ap1.reorg', 'Reorg Plan', 5, ['Initial reorg after ph-1 towards __; final reorg after ph-2 towards __ (the IE solution)', 'Reorg facing __ with a Pl in area __, a Pl facing __ in area __ and depth Pl in area __']),
                  yoursA('gr.ded.ap1.df', 'DFs for Reorg', 5, ['Mk __, __ and __ as DFs and __ as DF (SOS) for arty and mor']),
                  yoursA('gr.ded.ap1.decep', 'Deception', 5, ['If any: fixation or feint attk with __ force from __ dir at __ hrs (the Req, Anx P (6))']),
                ],
              }),
              yoursA('gr.ded.ap2', 'Attk Option-2 (Only Differences)', 5, ['Only the differences from Attk Option-1 (the Req)', 'Either changes the dir of attk', 'Depl areas', 'Use / quantum of forces in different phases', 'Capturing of objs in different phases', 'Use of tks in different roles: CS, fire sp, blocking posn']),
            ]),
            headOnly('gr.ded.common', 'Common Deductions', [
              yoursA('gr.ded.c.bof', 'Loc of Base of Fire', 5, ['Any three common deductions (the Req)', 'Domination, cover, dist from the obj and ability to eff engage the obj area, irrespective of the AP']),
              yoursA('gr.met', 'Weather', 3, ['First and last light, ph of moon and its effs on the op', 'Weather is dry which allows cross cty mov of wh and trk vehs (the IE solution)']),
              yoursA('gr.ded.c.fech', 'F Ech Route', 5, ['The only maj Rd through the obj area that facilitates the mov of vehs']),
              yoursA('gr.ded.c.reorg', 'Reorg Plan', 5, ['Domination, defensibility of gr, obsn and F of F: fwd loc on / in area __, depth along __', 'Reorg at once: patrolling fwd, adequate A tk def, the tks supporting the aslt stay till the RRs are sited (GSP-1947 p 91)', 'In desert it is easier to capture an obj than to hold it (DW p 46)']),
              yoursA('gr.ded.c.surprise', 'Surprise', 5, ['Area devoid of cover, mov by day observed: attk in the hrs of darkness', 'Proper cam and clt', 'All mov at ni']),
              yoursA('gr.ded.c.armr', 'Use of Armr', 5, ['Side open, going easy, no maj A tk obs: tks in CS', 'In desert: the dir of attk by the tk going (DW p 38); tks used in a ni attk under comd of the attacking inf (DW p 48)']),
              yoursA('gr.ded.c.pnr', 'Tasks / Use of Aslt Pnr / Engr', 5, ['Accompany the aslt tps in xing obs', 'Recce, dev and improvement of xing sites', 'Neutralize dmls along br __', 'Improvement of Rd / Tr __ for carriage of F ech', 'Creating gaps in mine fd / wire obs', 'An aslt across an obs at a minimum of two places (GSP-1947 p 90 para 14)', 'In mountains: no breaching of M fds and no mine shoes; close in by the boulders, nullahs and dead gr (MW p 86)']),
              yoursA('gr.ded.c.timing', 'Timing of Attk', 6, ['The moon is in __ qtr and up till __ hrs: attk during the early / later part of the ni (weather too: cloudy / rainy)', 'Day, ni, dawn (cross the SL at first lt) or dusk, with their trade-offs (OoW Vol II pp 26-27)', 'In mountains most attks at ni or under cover of poor visibility (MW p 82)']),
              yoursA('gr.ded.c.smk', 'Use of Smk', 6, ['To protect the mov from the FAA / FUP onwards where cover is less, from __ to __']),
              yoursA('gr.ded.c.phases', 'Phases of Attk', 6, ['The dist between the objs, their depth and wide frontage: phases for each dir of attk (Lt / Rt / centre apch), Phase 1, Phase 2; ph lines PH-I, PH-II on features square to the dir of advance (IC s66 para 8 h p 309)', ...ATTK_FRONT]),
              yoursA('gr.ded.c.flank', 'Flank Protection', 6, ['Both flanks open, no obs: task Pl __ to provide flank protection from area __ to __']),
            ]),
          ]),
        ] },
        { id: 'en', title: 'En Sit', paras: [
          // (1) DP-1 against Attk Option-1 with analysis, only the differences in DP-2 (the Req)
          para('en.opts', 'Def Possibilities', {
            draft: '',
            prompts: ['DP-1 against Attk Option-1 with its analysis, and only the differences in DP-2 (the Req)', MA(6)],
            children: [
              headOnly('en.opt1', 'DP-1 (Against Attk Option-1)', [
                yoursA('en.opt1.disp', 'Depl', 6, ['The En force and its depl pattern down to Pl lvl: No 1 Pl at __, No 2 Pl at __ (the IE solution; Anx P (1))', 'Depl Pl / Pl plus size force in the En AOR: Sec / Sec plus in area __, Sec in area __ and Sec in area __ / depth']),
                yoursA('en.opt1.bias', 'Bias of Def / A Tk Def', 6, ['Lt / Rt and centre']),
                yoursA('en.opt1.wpns', 'Depl of Maj Wpns', 7, ['ATGMs at __, RRs at __ (the IE solution; Anx P (1))']),
                yoursA('en.opt1.obs', 'Obs Plan', 7, ['Protective mine fd and wire obs in front and on flanks from incl __ to incl __', IDD_OBS]),
                yoursA('en.opt1.surv', 'Surv Plan', 7, ['SP in area __', 'LP in area __', 'OP towers on the BOPs', 'Arty obsr __', 'Mor obsr __']),
                yoursA('en.opt1.catk', 'C Attk Objs in Order of Pri', 7),
                yoursA('en.opt1.res', 'Loc of Res', 7, ['Loc of the En Bde res at __ (the IE solution)', EN_RES]),
                yoursA('en.opt1.killing', 'Killing Areas', 6, ['Primary killing area from incl __ to incl __', 'Secondary killing area from incl __ to incl __']),
                yoursA('en.opt1.df', 'DF Plan', 7, ['Mk __, __ and __ as DFs and __ as DF (SOS)']),
                headOnly('en.opt1.an', 'Analysis', [
                  yoursA('en.opt1.adv', 'Advs', 7, ['Eff covers all the apchs', 'Def is compact and caters for all-round def', 'All loc held in str', 'Forces the attacker to phase its attk', 'Good F of F and obsn', 'Rd / Tr __ eff dominated', 'Readjustment possible once the dir of attk is known', 'Def based on natural obs', 'Easy route of wdr / rft', 'Flanks protected', IDD_ADV]),
                  yoursA('en.opt1.dis', 'Disadvs', 7, ['Objs well defined and engaged easily', 'Capture of __ (MITG) unhinges the entire posn', 'Depth is weak', 'Most expected layout of def', 'Route of wdr / rft can be cut', IDD_DIS]),
                ]),
              ]),
              yoursA('en.opt2', 'DP-2 (Only Differences)', 7, ['Only the differences from DP-1: the depl pattern, bias of def, maj wpns, C attk objs (the Req)']),
              para('en.lead', 'Leading DP', { prompts: ['The most likely / leading En course or cap: DP __; all viable APs are analysed against it (OoW Vol II p 30)', 'Contingency plans for the others: see Exec, Contingency Plans (OoW Vol II p 30)'] }),
            ],
          }),
          // (2) Cfm / modify the attk options (the Req)
          headOnly('en.ded.basic', 'Cfm / Modify Attk Options', [
            yoursA('en.ded.obj', 'Pri of ITGs', 8, ['Keeping in view the En cap, pattern of depl and disposn on all imp tac grs: the pri from Gr and Weather stands cfm, or as changed']),
            yoursA('en.ded.apch', 'Pri of Apchs', 8, ['The En depl vis-a-vis its cap and options: the pri from Gr and Weather stands cfm, or the apch the En covers best discarded']),
            yoursA('en.ded.aps', 'Attk Options', 8, ['Keeping in view the aim, en composn and likely pattern of depl, my attk possibility as deduced from gr and weather stands cfm (the IE solution)']),
            headOnly('en.ded.ap1', 'Attk Option-1 (Cfm / Modified)', [
              yoursA('en.ded.ap1.dir', 'Dir / Phases', 8, ['Cfm: capture of these objs renders the En def unbal and opens the main Rd', 'Modified: the En killing gr, swift reactions or wdr / rft cap: discard the apch, attk from __']),
              yoursA('en.ded.ap1.depl', 'Depl Areas', '8-9', ['FUP: covered from the En fire / flanking', 'FAA: central to both dirs of attk', 'BOF: engages the En eff, irrespective of the dir of attk']),
              yoursA('en.ded.ap1.reorg', 'Reorg / DF Plan', 9, ['The En cap to launch a C attk and assy its forces in these areas']),
              yoursA('en.ded.ap1.block', 'Blocking Posn', 9, ['The En cap to wdr / rft the area within __ mins: tks for the blocking posn instead of CS / fire sp', EN_RES]),
            ]),
          ]),
          // (3) any three common deductions (the Req)
          headOnly('en.ded.common', 'Common Deductions', [
            yoursA('en.caps', 'En Caps', 7, ['Any three common deductions (the Req)', EN_RES, 'Local adjustment', 'Local C attk', 'Reinforcement', 'Spoiling attk', 'Use of NVDs', 'Use of arty', 'Use of air', 'Obs laying cap', 'Conduct of BHL', 'Emp of screens and surv elms']),
            yoursA('en.ded.c.isr', 'ISR and Surv Means', 9, ['The En means of surv and ISR to detect the mov and assy of my forces: mov in dark hrs, FUP in the shortest possible time, feint on another apch, a central FAA, his radars and UAVs tgted (the IE solution)']),
            yoursA('en.ded.c.spoil', 'Spoiling Attk', 9, ['Secure the FUP with a Pl / Pl minus before occupying it', 'An altn FUP 300-400 yds away', 'Smk screen from the FAA onwards', 'Mov the tks at the last possible time']),
            yoursA('en.ded.c.armr', 'Use of Armr', 9, ['The En posns well prep, covered and strongly held: armr in fire sp']),
            yoursA('en.ded.c.air', 'Air Superiority', 9, ['All mov in the hrs of darkness', 'Strict Tr discipline', 'Strict cam and clt', 'Attk at ni']),
            yoursA('en.ded.c.nvd', 'En Use of NVDs', 9, ['Max cover afforded by gr after mov from the FUP', 'Covering fire of arty / BOF to keep the En head down', 'Max use of smk']),
            yoursA('en.ded.c.readj', 'Readjustment of the En', '9-10', ['Eff use of arty on fwd and depth loc', 'Conc vol of fire from the BOF', 'Air burst']),
            yoursA('en.ded.c.pnr', 'Use of Aslt Pnr / Engr', 10, ['The En mine fd and wire obs all round: safe lanes for the F ech and the subsequent op']),
            yoursA('en.ded.c.catk', 'En C Attk', 10, ['Keeping in view the cap of the En Bde C attk, estb the blocking posn before Ph 1 completes (the IE solution)', 'Quick reorg / consolidation', 'Launching Phase 2 ASP', 'Early depl of surv elms / tk hunting parties ahead of the obj', 'F ech ASP: disposal / evac of cas, replenishment of ammo', 'DF and DF (SOS) to beat back the En C attk / assy']),
            yoursA('en.ded.c.phases', 'Phases of Attk', 10, ['Size of obj, the En disposn and pattern of depl: phases cfm']),
            yoursA('en.ded.c.arty', 'Use of Arty', 10, ['Soften up well prep defs with prep bombardment', 'Engage the En ptls / LPs before the mov into the FUP', 'Silent or noisy: silent, no prep bombardment before H, the whole fire plan prep and on call, when the tac circumstances favour surprise; noisy, prep bombardment before H, only when own relative str is so favourable that the loss of surprise is acceptable (OoW Vol II p 27)']),
            yoursA('en.ded.c.engrs', 'Emp of Engrs', 10, ['Well prep defs, concrete bunkers, wire and mines: almt of engr elms to the aslt Pls', 'Lanes in the En mine fd for the F ech up to the tgt']),
          ]),
        ] },
        { id: 'own', title: 'Own Sit', paras: [
          // (1) own str as related to the en's; (2) assessment and (3) aloc of tps to task, Attk Option-1 only; (4) any three common (the Req)
          para('own.str', 'Own Str as Related to that of the En', { draft: '', table: { head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'], rows: ['a.', 'b.', 'c.', 'd.'].map((s) => [s, '', '', '', '']) }, prompts: [MA(11)], children: [yoursA('own.comp', 'Composn and Disposn of Own Force', 11)] }),
          para('own.tasks', 'Assessment of Tps to Task (Attk Option-1)', { draft: '', table: { head: TASK_HEAD_ATTK, rows: taskRowsAttk() }, prompts: ['Attk Option-1 only (the Req): tps for each task and phase', MA(11)] }),
          para('almt', 'Aloc of Tps to Task (Attk Option-1)', { draft: '', table: { head: TASK_HEAD_ATTK, rows: taskRowsAttk() }, prompts: ['Attk Option-1 only (the Req), as per the existing resources when addl tps are not provided; remarks under the table: who undertakes each task', MA('12-13')] }),
          headOnly('own.ded.common', 'Common Deductions', [
            yoursA('own.ded.addl', 'Req of Addl Resources / Tps', 12, ['Any three common deductions (the Req)', 'As per the assessment of tasks I req __ inf Sec, __ aslt pnr / engr Sec and __ armr Tp, where I have __: ask for addl resources from the Bn comd; if not provided, the almt of tps to task as per existing resources']),
            yoursA('own.ded.c.armr', 'Use of Armr', 12, ['A tp of tks in the feint, one after the Cat A fence in Ph 1, the rest in the blocking posn (the IE solution)']),
            yoursA('own.ded.c.hold', 'Asst / Coord with Holding Tps', 13, ['A prelim op to clear the En outposts: an OP on his main posn, the guns fwd, a good SL (GSP-1947 p 89)', 'Activity all over the front and feint attk (if nec) from the opposite dir', 'Asst in estb of BOF', 'Info about the En def, obs, lanes and gaps through the mine fd', 'Passage through lanes', 'Guidance arrangement', 'Protection of flanks']),
            yoursA('own.ded.c.bs', 'Emp of BS / RRs', 13, ['Initially as part of BOF at area __', 'Subsequently for str of my reorg in area __']),
            yoursA('own.ded.c.df', 'DF Plan', 13, ['A fd Bty aval in DS: exec my DF plan during reorg as deduced from Gr and Weather', AIR_SP]),
            yoursA('own.ded.c.fwdwpn', 'Arrangements to Carry Fwd Wpns for BOF', 13),
            yoursA('own.ded.c.ammo', 'Task for Fol Up Coys to Carry Ammo for Initial Reorg of Phase 1', 13),
            yoursA('own.ded.c.nvd', 'Use of NVDs / GSRs', 13),
            yoursA('own.ded.c.engr', 'Mine Laying / Use of Engrs', 13, ['Asslt engr Pl assists the fd engr Pl to lay M fds on the fronts and flks during the reorg (the IE solution)']),
            para('own.ded.c.res', 'Emp of Res', { prompts: ['The three decisions: the point of application, the timing, the dir (OoW Vol II pp 31-32)', 'The greater the uncertainty in the attk, the greater the res; neither committed prematurely nor too late; located to exploit an unexpected success and to react to an unexpected En threat (OoW Vol II p 32)', 'Recreated when used; contingency plans for it with the fire sp integrated; be prep tasks (OoW Vol II p 32)', 'In mountains a res on each axis, a central res of little value (MW p 82)', 'In desert the res inf heavy for the break-in, mech for the break-out (DW p 39)'] }),
          ]),
        ] },
        { id: 'ts', title: 'Time and Space', paras: [
          // (1) time data; (2) the time calc for the ldg attk option; (3) cfm / modify the basic deductions; (4) any two common (the Req)
          headOnly('ts.data', 'Time Data', [
            yoursA('ts.data.by', 'Time of Completion', 13),
            yoursA('ts.data.now', 'Time Now', 13),
            yoursA('ts.data.total', 'Time Aval', 13),
            yoursA('ts.data.day', 'Day Hrs', 13),
            yoursA('ts.data.ni', 'Ni Hrs', 13),
          ]),
          para('ts.calc', 'Time Calc for the Ldg Attk Option', {
            draft: '',
            table: { head: ['Ser', 'Events', 'Time Req', 'Running Time'], rows: BACKWARD_EVENTS.map((e, i) => [String(i + 1), e, '', '']), widths: [0.08, 0.5, 0.2, 0.22] },
            prompts: ['For the ldg attk possibility only (the Req)', 'Task to be completed ASP: fwd calc of timings', 'Specified completion time: backward calc of timings', 'ASP and not later than a specified time: both', MA('13-14'), ...ATTK_TS_BOOKS],
          }),
          headOnly('ts.ded.basic', 'Cfm / Modify Basic Deductions', [
            yoursA('ts.ded.obj', 'Pri of ITGs', 14, ['Keeping in view the aim, the resources aval, the time req and the time aval: the pri of ITGs, apchs and AP as deduced from Gr and Weather stands cfm (the IE solution)', 'The distr of timings permits the capture of the MITG and two imp tac grs in Phase 1: the pri stands cfm']),
            yoursA('ts.ded.apch', 'Pri of Apchs', '14-15', ['The apch that completes the asg tasks within the given time frame (shorter, no obs): the pri stands cfm']),
          ]),
          headOnly('ts.ded.common', 'Common Deductions', [
            yoursA('ts.ded.more', 'Appl of Time: More Time Aval', 15, ['Any two common deductions (the Req)', 'Recce of the obj area', 'Coord and rehearsal for attk fmns', 'Coord for fire sp with different echs', 'Stay in FAA', 'Battle drills and procedures']),
            yoursA('ts.ded.less', 'Appl of Time: Less Time Aval', 15, ['Curtail: stay in FAA', 'Battle drill and procedure', 'Recce of the obj area']),
            yoursA('ts.ded.timings', 'Essential Timings', 15, ['Mov from Assy A to FAA __ hrs', 'Mov from FAA to FUP __ hrs', 'H hr __ hrs', 'A hr (not later than) __ hrs', 'Time by which BOF to be estb __ hrs', 'Time by which blocking posn to be estb __ hrs']),
          ]),
        ] },
      ],
    },
    {
      id: 'crs', title: 'COURSES',
      groups: [{ id: 'crs', title: null, paras: [
        // (1) the statement of Course A and only the differences in Course B; (2) the course adopted with reasons / analysis;
        // (3) en reactions and own ctr actions for the adopted course only (the Req)
        para('crs.a', 'Course A', {
          prompts: ['The statement of Course A (the Req): to attk __ using __ apch with __ force in sp by __ in __ phs, commencing by __ and completing by __; Ph 1 __, Ph 2 __; BOF for Ph 1 and Ph 2; FUP; FAA; blocking posn at __ by __; feint by __ at __; H and A hr; reorg after Ph 1 and Ph 2; DFs for reorg (the IE solution)', 'To capture / clear area __ with a Coy / Coy plus force using __ apch, keeping tks in CS / fire sp role, commencing the op at __ hrs in __ phases', 'Phase 1: capturing area __ and __ with a Pl and Pl / Pl plus using tks in CS / fire sp, FUP in area __ and BOF in area __, completing the phase in 45-60 mins', 'Phase 2: capturing __ with a Pl / Pl minus using tks in CS / fire sp, FUP in area __, BOF in area __, A hr at __, completing in 30-45 mins', 'Initial reorg of Phase 1 facing __; final reorg facing __ along __; BS and RRs in the BOF, then in area __ during the reorg to beat back the En C attk', 'Rd / Tr __ as route for the F ech; DFs and DF (SOS) during the reorg; Coy HQ and Tac HQ in area __', 'If time is aval: loc of altn FUP / BOF, the blocking posn if tks are not in CS / fire sp, FAA, use of aslt pnr, feint attk', MA('15-16')],
          children: [
            yoursA('crs.an.adv', 'Adv', 18, ['MITG captured in the 1st phase', 'Two objs captured in Phase 1', 'Main Rd cleared in Phase 1', 'Allows use of armr in CS', 'Ideal depl areas: FUP, BOF and FAA', 'Shorter apch', 'Dir keeping easy', 'Blocking posn before Phase 1', 'Res in both phases', 'Task completed within the time frame']),
            yoursA('crs.an.dis', 'Disadv', 18, ['Most obvious / expected apch', 'More obs between the FUP and the obj', 'Sharp reactions on the loss of the MITG in Phase 1', 'Going difficult: strongly held def in Phase 1']),
          ],
        }),
        yoursA('crs.b', 'Course B (Only Differences)', 19, ['Only the differences from Course A (the Req)']),
        yoursA('crs.adopted', 'Course Adopted', 19, ['Course adopted with reasons / analysis (the Req): I decide to adopt Course __ for the reasons as under']),
        headOnly('crs.react', 'En Reactions and Own Ctr Actions', [
          headOnly('crs.react.conc', 'During Mov from Conc Area / Assy A', [
            yoursA('crs.react.conc.air', 'Air Attk, Recce Msns and Aerial Recce', 16, ['For the adopted course only (the Req)', 'Air alarm scheme during my mov at __ hrs from conc A to Assy A / FAA', 'Dispersion in Assy A and conc A', 'Cam and clt of the highest std', 'Tr discipline', 'Lt discipline']),
            yoursA('crs.react.conc.arty', 'Use of Long Range Arty', 16, ['Good cam and clt', 'Con dispersion', 'Tr discipline', 'Coord with own arty for CB']),
          ]),
          yoursA('crs.react.fup', 'During Mov from Assy A / FAA to FUP', 16, ['The En speculative arty fire where there is no cover: well-dispersed mov in area __', 'Strict Tr discipline', 'Tks / vehs mov at the last possible time', 'HF to cover the tk noises']),
          yoursA('crs.react.occ', 'Occupation of FUP', 17, ['The En DFs and spoiling attk by its SP loc at __: FUP protection by the depth Pl at the appropriate time', 'Strict Lt discipline, min possible Lts in the FUP', 'Mov steadily to the FUP, silent occupation under the cover of arty fire', 'Strict wrls silence', 'Smk with HE through the FOO / MFC', 'Spoiling attk: adv H or mov to the altn FUP in area __', 'Eff CB to silence the En guns']),
          headOnly('crs.react.ph1', 'Phase 1', [
            yoursA('crs.react.ph1.readj', 'Readjustment of Posn by En', 17, ['Subj the En to conc arty fire through my FSP already prep']),
            yoursA('crs.react.ph1.wpns', 'En Use of SA / A Tk Wpns', 17, ['Neutralise the En wpn emplacements by covering fire till the aslt line, then the fire base at __ when the arty fire is lifted', 'Smk shells with HE to deny the En obsn']),
            yoursA('crs.react.ph1.catk', 'Local C Attk by the En', 17, ['Subj the En depth loc to arty fire through my FOO / MFC', 'Quick initial reorg; launch Phase 2 at __ with speed; engage __ and __ already mk as DFs']),
          ]),
          headOnly('crs.react.ph2', 'Phase 2', [
            yoursA('crs.react.ph2.catk', 'Local C Attk by En Res', 17, ['Quick completion of Phase 2 by __ hrs', 'F ech on the tgt ASP', 'Speedy reorg of Phase 2 by __ hrs', 'Quick readjustment of DF / DF (SOS)', 'The blocking posn estb to delay the En C attk (the IE solution)']),
            yoursA('crs.react.ph2.df', 'En Engagement of DF', '17-18', ['Ask for CB', 'Initial reorg __ yds plus of the obj in area __']),
            yoursA('crs.react.ph2.depth', 'Readjustment of Depth Loc', 18, ['Arty fire', 'Maint impetus']),
          ]),
          yoursA('crs.react.reorg', 'Final Reorg', 18, ['Speedy reorg ahead of the obj i.e. __ and __', 'Quick digging', 'Early arrival of the F ech by __ hrs through Rd / Tr __', 'Sel / readjustment of DF', 'Fwd ptls / OPs / LPs in area __', 'Obs in area __', 'M fds laid on the fronts and flks after the reorg (the IE solution)', 'Coord of def loc']),
        ]),
      ] }],
    },
    {
      id: 'plan', title: 'PLAN',
      groups: [{ id: 'plan', title: null, paras: [
        yoursA('plan.msn', 'Msn', 19, ['Capture area __ by __ hrs __']),
        // the exec: gen outline, tasks of the maj fighting elms, coord instrs (the Req)
        headOnly('plan.exec', 'Exec', [
          yoursA('plan.exec.outline', 'Gen Outline', 19, ['Attk will be conducted in two phs as fol (the IE solution): (1) Ph-I capture __ and __ with two Coys up sp by a tp of tks, commencing __, completing by __ (2) Ph-II capture __ and __ (3) BOF at __ and __ for Ph-I and II (4) Blocking posn at __ by __ (5) FUP (6) FAA (7) Initial reorg towards __ (8) Final reorg towards __', 'Anx P: attk from Lt / Rt in two phases']),
          headOnly('plan.exec.grp', 'Grouping / Tasks', [
            headOnly('plan.exec.pl1', 'No 1 Pl', [
              yoursA('plan.exec.pl1.grp', 'Grouping', 19, ['Under comd: a Tp of tks (Phase 1 only, if altd)', 'FOO', 'MFC', 'In loc: RRs etc (during reorg)']),
              yoursA('plan.exec.pl1.task', 'Tasks', 19, ['Every task it is asg in all the phases, phase-wise: i. Ph-I __ ii. Ph-II __ (the IE solution)', 'Capture area __ in Phase 1 by __ hrs; completion (codeword)', 'In Phase 2 be prep to asst No 3 Pl in the capture of area __ on orders', 'Finally reorg along __ facing __', 'Guidance in the FUP; protect the FUP in area __; a Sec for the blocking posn; LP / SP / tk hunting ptl during reorg']),
            ]),
            yoursA('plan.exec.pl2', 'No 2 Pl', 20),
            yoursA('plan.exec.pl3', 'No 3 Pl', 20),
            yoursA('plan.exec.bof', 'BOF', 20, ['Provide the BOF at __ and __ during Ph-I and II respectively; reinforce the def after the final reorg (the IE solution)']),
            yoursA('plan.exec.mor', 'Bn Mors', 20, ['MFC (one each) to each aslt Pl', 'Fire sp as per the FSP (att as anx __)', 'Mk __ as DFs and DF (SOS)']),
            yoursA('plan.exec.pnr', 'Sec Aslt Pnr', 20, ['Under comd No __ Pl in Phase 1', 'Clear Rd / Tr __ for the mov of the F ech', 'Lay M fds on the fronts and flks after the reorg (the IE solution)']),
            yoursA('plan.exec.armr', 'Armr', 20, ['Fire sp from the BOF in area __', 'Estb blocking posn in area __ at __ hrs', 'Asst in reorg by covering area __']),
          ]),
          headOnly('plan.exec.coord', 'Coord Instrs', [
            yoursA('plan.exec.coord.timings', 'Timings', 20, ['Mov from Assy A / FAA __', 'H hr __', 'A hr __', 'BOF to be estb by __', 'Blocking posn to be estb by __', 'Final reorg __']),
            yoursA('plan.exec.coord.loc', 'Depl Areas', 20, ['FAA __', 'BOF __', 'FUP __', 'Blocking posn __']),
          ]),
          para('plan.exec.cont', 'Contingency Plans', { prompts: ['For the En caps other than the leading one, should they materialise (OoW Vol II p 30)', 'Be prep tasks; the res committed and recreated, its contingencies with the fire sp integrated (OoW Vol II p 32)'] }),
        ]),
        headOnly('plan.adm', 'Adm and Log', [yoursA('plan.adm.food', 'Food', 20), yoursA('plan.adm.ammo', 'Ammo', 20), yoursA('plan.adm.water', 'Water', 20), yoursA('plan.adm.cap', 'CAP', 21, ['Cas never more than 4 h without expert treatment, surgery within 12 h; the chain CAP, RAP, ADS, FTC (lsf p 47; Annex L pp 81-82)'])]),
        headOnly('plan.comd', 'Comd and Sig', [
          yoursA('plan.comd.hq', 'Loc of Coy HQ', 21),
          yoursA('plan.comd.tac', 'Loc of Coy Tac HQ', 21),
          yoursA('plan.comd.sig', 'Sig for Breaking the Wrls Silence', 21),
          yoursA('plan.comd.code', 'List of Code Words / Nick Names', 21, ['Being issued separately']),
        ]),
      ] }],
    },
    {
      id: 'anx', title: 'ANX P: SKETCH',
      groups: [{ id: 'anx', title: null, paras: [para('anx.sketch', 'Details to be Marked', { prompts: ['Mk the Bn attk plan to incl (the Req, Anx P): (1) vis En depl down to Pl lvl, maj wpns, obs and surv plan; (2) depl areas incl FUP, BOF, Assy A and routes; (3) BOF for Ph 1 and Ph 2; (4) attk plan with timings, str / composn and ph lines; (5) composn pattern and depl of BOF; (6) deception activity, fixation or feint attk (if any); (7) blocking posn (if any) incl str, composn, loc and time; (8) reorg plan incl loc of Coys, DFs, maj wpns and Bn HQ / Bn Tac, the bias of def and A tk def in the reorg', 'SD aspects, map intersections; conc A and FAA, route to the FUP, FUP, SL with H, attk arrows, ph lines, reorg, BOF, F ech, blocking posn, feint', UA('34-35'), MA(21)] })] }],
    },
  ];
}

// ── the withdrawal ───────────────────────────────────────────────────────────────────────────────────────────────
// From OoW Vol III, Withdrawal (GSP 6-100-0; Doctrine_Review.md R78, 24 Nov 2026), laid out as the defence's written
// appreciation (REVIEW OF SIT, AIM, FACTORS, COURSES, PLAN, the sketch annex). The FACTORS are the book's (pp 7-16):
// terrain and weather, time and space, own and en, intelligence, security, secrecy / surprise / deception, demolitions
// and obstacles, air, administration; the COURSES carry the commander's main decisions (pp 6-7); the PLAN follows what
// the orders must hold (p 21 para 19d) and the execution para of Annex A (pp 71-74). The book prints its page numbers:
// `O3(8)` is its printed p 8. A Read takes the AOR round the MITG as the new def posn: its ground forward, toward the En,
// is the ground the wdr crosses, its lines across the apchs the candidate intmed posns.

/** OoW Vol III, its printed page. */
export const O3 = (p: number | string, para = ''): string => `OoW Vol III ${/[-,]/.test(String(p)) ? 'pp' : 'p'} ${p}${para ? ` para ${para}` : ''}`;

function outlineWdr(): AprcPart[] {
  const blankTable = (head: string[], first: string[]): AprcTable => ({ head, rows: first.map((f) => [f, ...head.slice(1).map(() => '')]) });
  return [
    {
      id: 'rev', title: 'REVIEW OF SIT',
      groups: [{ id: 'rev', title: null, paras: [
        yours('rev.en', 'En Forces', ['En forces opposite, their likely aim, when; in contact, or light or no contact (' + O3(2, '5') + ')', 'The En aim in following up a wdr: to over-run, pen or outflank the posns of the fwd elms and engage the posns in the rear before they are ready; failing that, to destroy the tps left behind (' + O3(24, '2') + ')']),
        yours('rev.own', 'Own Forces', ['Why the wdr: to disengage from an unsuccessful battle or after an operational reverse, or to avoid battle under unfavourable conditions and gain time (' + O3(1, '1') + ')', 'A tac wdr is never carried out except on the orders of the higher comd (' + O3(2, '4') + ')', 'Moving behind another fmn already depl, or prep a new def posn in the rear and fight there at once: the latter more complex and the more usual (' + O3(5, '1') + ')']),
        yours('rev.air', 'Air Sit', ['A force compelled to wdr by day without adequate air sp is severely handicapped; no daylight wdr, as far as possible, if the En has air superiority (' + O3(15, '12') + ')']),
      ] }],
    },
    {
      id: 'aim', title: 'AIM',
      groups: [{ id: 'aim', title: null, paras: [yours('aim', null, [
        'The overall aim: reduce the En superiority by trading space for time, for a sit favourable to resume the offensive (' + O3(2, '6') + ')',
        'The immediate aim: occupy the new def posn with the min of interference from the En and the min of cas; the ultimate: stabilise the sit and renew the offensive (' + O3(3, '7') + ')',
        'The limitations given, set in the Limitations box: the time up to which the posn is denied, no rearward mov before, all tps clear of a line by (' + O3(19, '17') + '); the delay fwd of the new posn (' + O3(10, '6c') + ')',
        'Starts with "To", the limitations tabulated (' + UA('7-8') + ')',
      ])] }],
    },
    {
      id: 'fac', title: 'FACTORS',
      groups: [
        { id: 'gr', title: 'Terrain and Weather', paras: [
          yours('gr.gen', 'Gen Description', ['MITG: the new def posn; the Gr read forward of it, toward the En, is the Gr the wdr crosses']),
          para('gr.apchs', 'Apchs', { draft: '', prompts: ['The En apchs onto the new posn: the ways the follow-up takes (' + O3(24, '2') + ')', 'Cross-country going allows dispersion against air, but eases the En armr wide outflanking movs (' + O3(8, '5a') + ')'] }),
          yours('gr.obs', 'Obs', ['Max use of natural and artificial obs; their significance a maj consideration in the loc of the new def and intmed posns and the grouping and tasks (' + O3(8, '5a') + ')', 'Time may not allow other maj artificial obs: make the existing natural obs more formidable (' + O3(14, '11c') + ')']),
          para('gr.routes', 'Routes Back', { prompts: ['Routes, especially laterals: for redeployment, regrouping, committing the res and the wdr of units (' + O3(8, '5a') + ')', 'Parallel routes: wdr on several axes against congestion, delays and air tgts; routes converging on the axes from the outer flks protected (' + O3(8, '5a') + ')', 'In desert: a broad front, the max routes incl cross-country (DW p 32)', 'Which routes to block and which to keep open for the wdr (' + O3(8, '5a') + ')'] }),
          yours('gr.cover', 'Cover'),
          yours('gr.met', 'Weather', ['Adverse weather is likely to favour the wdr: it impedes the En mobility and air; heavy rain, mist, fog, dust storms and thick haze may let it be done by day too (' + O3(9, '5b') + ')', 'Difficult terrain (bog, thick woods, hills) impedes mov but may make a daylight wdr the only practical means (' + O3('8-9', '5a') + ')']),
          headOnly('gr.ded', 'Deductions', [
            para('gr.ded.newposn', 'Loc of the New Def Posn', { prompts: ['Normally laid down by the higher comd: future plans, the sit on the flks, the suitability of the Gr, its dist from the present posn (' + O3(39, '1') + ')', 'The Div Comd normally details a reserve Bde for the prep and occupation of the rear main posn (GSP-1947 p 145)', 'The line of no pen taken into consideration (' + O3(39, '3') + '); its selection, org and layout as in OoW Vol I (' + O3(39, '1') + ')'] }),
            para('gr.ded.intmed', 'Intmed Posns', { prompts: ['Naturally strong, held with the min of tps, heavy damage to the En; so far apart that the En must redeploy before attacking the next: parallel ridges across the En adv; rivers, canals, unfordable streams, marshes and other obs, mines in front and on the flks; high Gr with good obsn and long F of F; concealed routes of wdr; a Rd network with good going, which helps the En too (' + O3(33, '16') + ')', 'Their number: the delay to impose, the dist to the new posn, the natural str of the Gr, the En and the tps aval; tps to prep and hold them are the maj limitation (' + O3(33, '17') + ')', 'Occupied where necessary to impose further delay (GSP-1947 p 144 para 12); leap-frogging at fmn lvl till the rear main posn; no posn abandoned until the next in the rear is organised and at least partially occupied (GSP-1947 p 149; IBB p 378)'] }),
            para('gr.ded.routes', 'Routes to Block and Keep Open', { prompts: ['Terrain and routes analysed for which routes are to be blocked and which kept open for the wdr (' + O3(8, '5a') + ')', 'Security dets to secure the defiles the wdr uses, with AD for them (' + O3(12, '9a') + ')'] }),
            para('gr.ded.time', 'Wdr by Ni or Day', { prompts: ['A ni wdr is usually preferred: secrecy, surprise, fewer cas; it starts so as to finish before daylight (' + O3('43-44', '1') + ')', 'A daylight wdr is normally avoided unless the weather or the Rds favour or need it (' + O3(40, '1') + ')'] }),
          ]),
        ] },
        { id: 'ts', title: 'Time and Space', paras: [
          headOnly('ts.data', 'Time Data', [
            yours('ts.data.time-now', 'Time Now'),
            yours('ts.data.deny', 'Posn to be Denied Until', [O3(19, '17a')]),
            yours('ts.data.no-mov', 'No Rearward Mov Before', [O3(19, '17b')]),
            yours('ts.data.clear', 'All Tps Clear of the Line By', [O3(19, '17c')]),
            yours('ts.data.last-lt', 'Last Lt'),
            yours('ts.data.first-lt', 'First Lt'),
            yours('ts.data.dark', 'Hrs of Darkness'),
          ]),
          para('ts.req', 'Time Req', { draft: '', table: blankTable(['S/No', 'Activity', 'Time (hrs)', 'Remarks'], ['a.', 'b.', 'c.', 'd.']), prompts: ['The dist between the orig and the new posn and the time to prep the latter calculated carefully (' + O3(10, '6b') + ')', 'A Bn needs at least 36 working hrs to prep its posns (OoW Vol I p 39)'] }),
          headOnly('ts.ded', 'Deductions', [
            yours('ts.ded.timings', 'Essential Timings', ['Laid down by the highest comd: the time the posn is denied till; no rearward mov except recce parties before; all tps clear of a line by (' + O3(19, '17') + ')', 'By the subordinate comds: the time the posn is finally abandoned, the time thinning out may begin (' + O3(19, '18') + ')', 'Timings not tight, allowing each phase to complete (' + O3('18-19', '16') + ')', 'Beside it: the posn to be denied and no rearward mov always laid down (GSP-1947 p 147); thinning out and final abandonment (p 148)']),
            yours('ts.ded.common', 'Common Deductions', ['The time for delay related to the depth of the area: from the Gr, hrs or days to the dist; then the phases, intmed posns, the delaying actions of the covering tps and the time the En is held at each phase line (' + O3(10, '6c') + ')', 'A longer delay: the new posn at a sufficient dist, a series of intmed posns between (' + O3(9, '6a') + ')', 'Time short after an unsuccessful action: a hasty wdr, not a deliberate one (' + O3(10, '6b') + ')']),
          ]),
        ] },
        { id: 'en', title: 'Own and En Sit', paras: [
          yours('en.comp', 'En Composn and Superiority', ['The En superiority in tps, armament and materiel, the En tactics and morale weighed objectively against own; the qualities of the En comds and the course they are likely to adopt (' + O3(10, '7a') + ')']),
          yours('en.caps', 'En Caps Against the Wdr', ['Airborne attk, air attk, turning mov and infiltration to interfere with the wdr; efforts to impede it (' + O3(11, '8b') + ')', 'Airborne or heliborne tps to seize defiles or brs and disrupt comns once the wdr is known (' + O3(46, '6') + ')']),
          para('own.str', 'Own Str as Related to that of the En', { draft: '', table: blankTable(['Ser', 'Arms', 'En', 'Own', 'Ratio'], ['a.', 'b.', 'c.', 'd.']) }),
          yours('own.mob', 'Mobility', ['In desert no unit is expected to wdr any distance on foot: tpt to lift all; a clean break to the next main posn, few features with delay potential on the routes (DW p 32)', 'The En local superiority offset by own superior mobility or by the denial of mobility to the En (' + O3(10, '7a') + ')', 'In plain country, the En likely to lead with armr: fully mobile covering tps of armr, recce elms and motorised inf; tps left behind with armr if the En has it, and tpt to move speedily after the final extrication (' + O3(11, '7a') + ')', 'Max denial of mobility by interdiction and a coord obs and denial plan (' + O3(11, '7a') + ')']),
          headOnly('own.ded', 'Deductions', [yours('own.ded.common', 'Common Deductions', ['Tps on the orig posn to deny it up to the time ordered; the time to wdr them (' + O3(19, '17d') + ')', 'The critical stage: the orig posn thinned out to release men for the posn in the rear, the rest on an extended frontage; all arty and air effort in their sp, the res placed to intervene at short notice (' + O3(24, '3') + ')', 'Balance: each gp formed for its role and able to op independently; no element over-burdened (' + O3(4, '10-11') + ')'])]),
        ] },
        { id: 'sec', title: 'Int, Security and Deception', paras: [
          yours('sec.int', 'Int', ['Early warning of En activities meant to disrupt the wdr: the higher HQ provides the int on the En intentions and moves (' + O3(11, '8a') + ')', 'EEIs: the str and composn of the main attacking force, the loc of the En armr (' + O3(11, '8b') + ')', 'All agencies: air recce, stay behind parties in En held territory, aggressive ptls (' + O3(12, '8c') + ')']),
          yours('sec.sec', 'Security', ['Covering tps, rearguards and, if nec, flk gds; their protection by the terrain and the En str and eqpt (' + O3(12, '9a') + ')', 'Covering tps / rearguards keep contact and impose delay; mobile, their composn by the msn, terrain, weather and the En (GSP-1947 p 143 para 8)', 'Terrain restricting MT favours En infiltration: security elms mainly inf; open country favours mobile forces (' + O3(12, '9a') + ')', 'Def of the rear areas; security dets to secure the defiles the wdr uses, with AD (' + O3(12, '9a') + ')']),
          yours('sec.decep', 'Secrecy, Surprise and Deception', ['Conceal the actual day and time of the wdr; by ni, leave the En guessing at first lt whether the posn has been abandoned (' + O3('12-13', '10a') + ')', 'A cover plan early; all mov to the rear except routine tfc in the hrs of darkness; no abnormal action by fwd tps until the rear parties go; normal ptl to the last moment; need to know; dmls controlled and timed with care; armr and APCs thinned out with care (' + O3(13, '10c') + ')', 'Strict use of wrls; active measures: more ptls, arty fire to cover noises, simulating a build-up for attk (' + O3(14, '10c') + '); active and passive measures (' + O3(54, '8') + ')']),
        ] },
        { id: 'sp', title: 'Dmls, Air and Adm', paras: [
          para('sp.dml', 'Dmls and Obs', { prompts: ['Dmls of comns, and the destruction of local resources and stores that cannot be evacuated (' + O3(14, '11a') + ')', 'Considerable time to org and prep them, coord on the whole front, planning to start at the earliest; Engr resources centralised (' + O3('14-15', '11b-d') + ')', 'Preliminary dmls fired once prep; reserve dmls specifically con, with gds and firing parties, the sites kept open to tfc (' + O3(55, '2-3') + ')', 'Primary dml belts continuous across the front as part of the new def posn; subsidiary belts in front of or behind an intmed posn for a clean break (' + O3(56, '5') + '); selected with Engr advice, the min essential (' + O3(56, '4') + ')'] }),
          yours('sp.air', 'Air', ['A force compelled to wdr by day without adequate air sp is severely handicapped (' + O3(15, '12') + ')', 'AD at pts likely to be attacked (' + O3(44, '2b') + '); at VPs, defiles and bottlenecks (' + O3(28, '8') + '); the air apchs identified, the routes of wdr and bottlenecks protected at ni (' + O3(38, '31') + ')']),
          yours('sp.adm', 'Adm', ['Adm units and installations not needed for maint during the wdr evacuated early; fwd stocks reduced to the min; workshops evacuate what cannot be repaired in a short time; fewer fwd medical installations, more ambulances or air evac; recovery of veh cas, esp tks; a reserve of tpt; denial plans for stores of value (' + O3('15-16', '13b') + ')', 'A correct balance of commodities at judiciously spaced intervals along the routes of wdr; cross-country routes developed to ease the main Rds (' + O3(68, '2b-d') + ')', 'Destruction of what cannot be evacuated authorised, its responsibility fixed; services units to the rear early, under darkness (' + O3(69, '3-4') + ')']),
          yours('sp.civ', 'Civil Population', ['Refugees may block the Rds; panic and the En fifth column (' + O3(69, '1') + ')', 'Close liaison with the civil authorities; if they are evacuated, Rds allotted to them; if they stay, food reserves left with them (' + O3(70, '3-4') + ')', 'A wdr from captured territory: plans against a hostile population (' + O3(70, '5') + ')']),
        ] },
      ],
    },
    {
      id: 'crs', title: 'COURSES',
      groups: [{ id: 'crs', title: null, paras: [
        yours('crs.a', 'Course A', [
          'In paragraph form, not starting "To": the loc and layout of the new def posn and the str to prep and occupy it initially; the delay to impose fwd of it by covering tps, rear parties, flk gds / rearguards, C attks and spoiling attks, intmed posns and Engrs (' + O3(6, '3a-b') + ')',
          'How to impose the delay without a running fight or unnecessary losses (' + O3(7, '3c') + ')',
          'The force left on the present posn and the time it is denied; the number and loc of intmed posns, their tps and the delay at each; the covering tps; the outline obs and denial plan (' + O3(7, '3d') + ')',
          'Surprise and deception, fire sp, the move back of non-essentials first, repair, recovery and cas evac, log sp, the civil population and refugees (' + O3(7, '3e-l') + ')',
        ]),
        para('crs.react', 'En Reactions and Own Ctr Actions', { draft: '', table: blankTable(['Ser', 'En Reactions', 'Own Ctr Actions'], ['a.', 'b.', 'c.', 'd.']), prompts: [
          'The critical stage, the orig posn thinned out: a breakthrough jeopardises the whole op; all arty and air effort in sp of the tps left behind, the res to intervene at short notice (' + O3(24, '3') + ')',
          'Airborne or heliborne attk on defiles, brs and comns: the imp defiles and VPs protected with AD, mobile res close to the danger pts, all tps alerted (' + O3(46, '6-7') + ')',
          'A unit decisively involved: a C attk or spoiling attk with uncommitted units (' + O3(41, '3') + ')',
          'Air attk on the columns: mov by ni, AD at the pts likely to be attacked (' + O3(15, '12') + '; ' + O3(44, '2b') + ')',
        ] }),
        headOnly('crs.an', 'Analysis', [
          yours('crs.an.adv', 'Advs', ['Weighed on the basic considerations: gain time, max cas on the En, the terrain and weather exploited, freedom of action kept, centralised con with decentralised exec (' + O3(6, '2') + ')', 'And the fundamentals: con, clean break, gaining time, balance, int, secrecy, morale (' + O3('3-5', '8-15') + ')']),
          yours('crs.an.dis', 'Disadvs'),
        ]),
        yours('crs.b', 'Course B', ['On the same lines as Course A, shorter']),
        yours('crs.adopted', 'Course Adopted', ['With reasons']),
      ] }],
    },
    {
      id: 'plan', title: 'PLAN',
      groups: [{ id: 'plan', title: null, paras: [
        yours('plan.msn', 'Msn'),
        headOnly('plan.exec', 'Exec', [
          yours('plan.exec.outline', 'Gen Outline', ['Wdr over __ ni(s) starting ni __ (date), or in __ phases; intmed posn(s) in area __; covering tps / rearguards in area __; grouping as an anx (' + O3('71-72') + ', Annex A)']),
          yours('plan.exec.newposn', 'New Def Posn', ['The prep of the rear main posn and its occupation (' + O3(72) + ', Annex A)', 'Fresh tps to prep it when possible, else a portion of own sent back: men for digging and mine laying more than fire power (' + O3(39, '2') + ')', 'Early recce of the next posn in the rear by daylight, both staff branches and every unit to occupy it represented (' + O3(20, '19c') + '); few offrs to recce and coord it (' + O3(17, '14d') + ')']),
          yours('plan.exec.intmed', 'Intmed Posns', ['A complete fmn or unit for each, a comd nominated for the whole posn, regrouping kept to the min (' + O3(34, '18') + ')', 'Inf predominant, some armr and ATGM; max fire sp; the tps made mobile to move speedily after disengaging (' + O3(34, '20') + ')', 'Greater fire power in front to make the En depl, less depth, adequate frontage against a quick outflanking mov, some res for C pen and limited C attks (' + O3(34, '22') + ')']),
          yours('plan.exec.cover', 'Covering Tps, Flk Gds and Rearguards', ['Covering tps delay the En fwd of the new posn for a specified period: deceive the En on the true loc of the new FDLs and make the En depl early, disorganise and inflict cas, give early warning (' + O3(31, '9b') + ')', 'Composn by the msn, terrain, En str and resources; sufficiently strong (' + O3(31, '10') + '); a Div\'s: an armd Regt or its sub-units with arty, Engrs, LAT and motorised inf (' + O3(32, '12') + ')', 'A flk gd from the threatened flk, on a parallel route or on Gr dominating the apchs from it (' + O3(34, '24') + '); a rearguard holds a series of def posns, based on inf, armr if aval (' + O3(35, '22') + ')']),
          yours('plan.exec.rear', 'Rear Parties', ['Designated by the units in contact to remain in contact and protect the wdr; they deny the En the knowledge of it, delay and deceive (' + O3(45, '5') + ')', 'Sufficient mobile elms to disengage quickly at the final abandonment (' + O3(4, '11') + ')', 'Cover the different apchs to the def posns (' + O3(27, '6') + '); Engrs with them to destroy bunkers, fix dmls and crater (' + O3(27, '3h') + ')']),
          yours('plan.exec.catk', 'C Attks and Spoiling Attks', ['C attks with limited objs: gr needed for the security of the force, to extricate elms, to destroy a vulnerable part of the En (' + O3('35-36', '23') + ')', 'Spoiling attks by mobile res, usually armr, the advantage weighed against the effort (' + O3(36, '24-25') + '); stay behind parties (' + O3(36, '27') + ')', 'Res: hard-hitting, highly mobile; the min level a Bde; else the least committed tps prep for the pre-planned tasks (' + O3(40, '4-5') + ')']),
          yours('plan.exec.fire', 'Fire Sp', ['Planned separately throughout the delay; it helps extricate the rear parties; early recce of successive posns; the dml sites covered (' + O3(37, '29') + ')', 'Own air for local air superiority or direct sp at least at the critical stages (' + O3(42, '4') + ')']),
          yours('plan.exec.engrs', 'Engrs', ['Almt, dmls, route maint pri (' + O3(72) + ', Annex A)', 'Obs, cratering, M fds and dmls their pri task in delay, prioritised by the task of the force (' + O3('37-38', '30') + ')']),
          yours('plan.exec.seq', 'Sequence', ['By ni: recce parties back; AD depl; non-essentials back; tps not in contact; all but the rear parties; the posn finally abandoned (' + O3(44, '2') + ')', 'By day: almost the reverse; tps in contact go back through own depth posns, leap-frogging till a clean break; no assy areas (' + O3(41, '2') + ')', 'Committed fmns wdr simultaneously on a broad front where possible (' + O3(45, '4') + ')']),
          yours('plan.exec.coord', 'Coord Instrs', ['Timings: posn denied until __; no rearward mov except recce parties before __; thinning out may begin at __; posn finally abandoned by __; rear parties to cross line __ by __; all tps clear of line __ by __ (' + O3('72-73') + ', Annex A)', 'Recces, RV and check pts, mov and TC (a mov table), routes, tpt, def stores, working parties, destruction of eqpt, dmls (types, gds, firing parties, orders for firing), rear parties (policy on con), deception, air (' + O3(73) + ', Annex A)', 'Bdys; phases, report lines, bounds and harbour areas; routes of wdr, check pts, RVs or assy areas, embussing and debussing pts, SP and RP (' + O3(17, '14e') + ')', AIR_SP]),
          yours('plan.exec.civ', 'Control of Refugees', ['Rds allotted to the civil authorities for civilians, subsistence on the way (' + O3(70, '4') + '); the controlled mov of civilians (' + O3(17, '14k') + '); Rds kept clear for the tps (' + O3(68, '2d') + ')']),
        ]),
        yours('plan.adm', 'Adm and Log', ['Supplies pre-positioned along the routes of wdr; a reserve of tpt under the higher comd (' + O3('68-69', '2b, 3') + ')', 'Cas evac: CAP, RAP, ADS, FTC; never more than 4 h without expert treatment, surgery within 12 h (lsf p 47)']),
        yours('plan.comd', 'Comd and Sig', ['Wire as far as possible; wrls redundant and curtailed; DRs, fd sigs and pyrotechnics (' + O3(38, '32') + ')', 'The senior sigs offr given early warning of the outline plan (' + O3(17, '14j') + ')']),
      ] }],
    },
    {
      id: 'anx', title: 'ANX P: SKETCH',
      groups: [{ id: 'anx', title: null, paras: [para('anx.sketch', 'Details to be Marked', { prompts: ['The conduct of the wdr as Annex P lays it out: the orig def posn, the covering tps (initial posn), flk gd, intmed posns, the new def posn (' + O3(75) + ')', 'The unit layout of Annex Q: Bn RV and embussing pt, Bn check pt, Coy RVs and check pts, the bomb line (' + O3(76) + ')'] })] }],
    },
  ];
}

/** Heads that follow the echelon read (the book is a Coy Comd's): a Bn's sub-units are Coys, its HQ the Bn's. */
export function attkHeads(echelon: string): Array<{ id: string; head: string }> {
  if (echelon !== 'Bn' && echelon !== 'Bde') return [];
  const sub = echelon === 'Bde' ? ['No 1 Bn', 'No 2 Bn', 'No 3 Bn'] : ['A Coy', 'B Coy', 'C Coy'];
  return [
    { id: 'plan.exec.pl1', head: sub[0] }, { id: 'plan.exec.pl2', head: sub[1] }, { id: 'plan.exec.pl3', head: sub[2] },
    { id: 'plan.exec.mor', head: echelon === 'Bde' ? 'Arty' : 'Mor Pl' },
    { id: 'plan.exec.bof', head: echelon === 'Bde' ? 'Sp Gp (BOF)' : 'Cbt Sp Coy (BOF)' },
    { id: 'plan.exec.pnr', head: echelon === 'Bde' ? 'Engrs' : 'Aslt Pnr Pl' },
    { id: 'plan.comd.hq', head: `Loc of ${echelon} HQ` }, { id: 'plan.comd.tac', head: `Loc of ${echelon} Tac HQ` },
  ];
}

const OUTLINES: Partial<Record<AprcKind, { label: string; build: () => AprcPart[] }>> = { def: { label: 'Defence', build: outlineDef } };

/** Add an outline for a kind of appreciation (the attack, when its specimen is to hand). */
export function registerOutline(kind: AprcKind, label: string, build: () => AprcPart[]): void {
  OUTLINES[kind] = { label, build };
}
registerOutline('attk', 'Attack', outlineAttk);
registerOutline('wdr', 'Withdrawal', outlineWdr);

/** The kinds with an outline, and those that have a place but no outline yet. */
export function aprcKinds(): Array<{ kind: AprcKind; label: string; ready: boolean }> {
  return [
    { kind: 'def', label: OUTLINES.def?.label ?? 'Defence', ready: !!OUTLINES.def },
    { kind: 'attk', label: OUTLINES.attk?.label ?? 'Attack', ready: !!OUTLINES.attk },
    { kind: 'wdr', label: OUTLINES.wdr?.label ?? 'Withdrawal', ready: !!OUTLINES.wdr },
  ];
}

/** An empty appreciation of a kind: every heading, nothing written. Falls back to the defence outline when the kind has none yet. */
export function newDoc(kind: AprcKind = 'def'): AprcDoc {
  const o = OUTLINES[kind] ?? OUTLINES.def!;
  return { version: 1, kind: OUTLINES[kind] ? kind : 'def', title: 'APRC OF THE SIT', frame: null, parts: o.build(), figures: [], confirm: [], sources: [] };
}

// ── walking ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function walk(doc: AprcDoc, fn: (p: AprcPara, depth: number, part: AprcPart, group: AprcGroup) => void): void {
  const go = (p: AprcPara, d: number, part: AprcPart, g: AprcGroup) => {
    fn(p, d, part, g);
    for (const c of p.children) go(c, d + 1, part, g);
  };
  for (const part of doc.parts) for (const g of part.groups) for (const p of g.paras) go(p, 0, part, g);
}

export function find(doc: AprcDoc, id: string): AprcPara | null {
  let hit: AprcPara | null = null;
  walk(doc, (p) => {
    if (p.id === id) hit = p;
  });
  return hit;
}

export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── writing into it ──────────────────────────────────────────────────────────────────────────────────────────────

function setSrc(p: AprcPara, src: AprcSrc): void {
  p.src = src;
  for (const c of p.children) if (!c.src) setSrc(c, src);
}

/**
 * Set drafts. A patch for an id the outline does not hold is skipped. The planner's words are untouched. `src` tags
 * the patched paragraphs (and the sub-paragraphs a patch brings) with the reading they came from.
 */
export function applyPatches(doc: AprcDoc, patches: AprcPatch[], src?: AprcSrc): number {
  let n = 0;
  for (const x of patches) {
    const p = find(doc, x.id);
    if (!p) continue;
    n++;
    if (x.head !== undefined) p.head = x.head;
    if (x.draft !== undefined) p.draft = x.draft;
    if (x.state !== undefined) p.state = x.state;
    if (x.basis !== undefined) p.basis = x.basis;
    if (x.prompts !== undefined) p.prompts = x.prompts;
    if (x.table !== undefined) p.table = x.table ?? undefined;
    if (x.figure !== undefined) p.figure = x.figure ?? undefined;
    if (x.children !== undefined) p.children = x.children;
    const from = x.src ?? src;
    if (from) {
      p.src = from;
      for (const c of p.children) if (!c.src) setSrc(c, from);
    }
  }
  return n;
}

/** What a paragraph says as drafted (state, words, table rows); '' for a heading or a ruled line with no table. */
export function draftSig(p: AprcPara | null | undefined): string {
  if (!p || ((p.draft === null || p.draft === '') && !p.table)) return '';
  return `${p.state}|${p.draft ?? ''}|${p.table ? JSON.stringify(p.table.rows) : ''}`;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * A Read that could not take a reading again (the guide off, outside the terrain data, a time-out) never loses the
 * one kept: the paragraphs `prev` (same kind) drafted from those readings are carried into `next` wherever `next` has
 * nothing from a reading taken this time, with their Confirm on Gr items and when they were read; with the ground not
 * read, the frame, the data list and the figures too. Returns how many paragraphs were kept.
 */
export function keepUnread(prev: AprcDoc | null, next: AprcDoc, unread: Iterable<AprcSrc>): number {
  const set = new Set(unread);
  if (!prev || prev.kind !== next.kind || !set.size) return 0;
  const fresh = new Set<string>();
  walk(next, (p) => {
    if (p.src) fresh.add(p.id);
  });
  let n = 0;
  walk(prev, (p) => {
    if (!p.src || !set.has(p.src) || fresh.has(p.id)) return;
    const q = find(next, p.id);
    if (!q) return;
    const c = clone(p);
    q.head = c.head;
    q.draft = c.draft;
    q.state = c.state;
    q.basis = c.basis;
    q.prompts = c.prompts;
    q.table = c.table;
    q.figure = c.figure;
    q.children = c.children;
    q.src = c.src;
    const mark = (x: AprcPara) => {
      fresh.add(x.id);
      x.children.forEach(mark);
    };
    mark(q);
    n++;
  });
  for (const c of prev.confirm) if (c.src && set.has(c.src) && !next.confirm.some((x) => x.text === c.text)) next.confirm.push({ ...c, paras: [...c.paras] });
  for (const k of set) if (prev.readAt?.[k]) (next.readAt ??= {})[k] = prev.readAt[k];
  if (set.has('gr')) {
    if (!next.frame && prev.frame) next.frame = { ...prev.frame };
    if (!next.sources.length) next.sources = [...prev.sources];
    for (const f of prev.figures) if (!next.figures.some((x) => x.id === f.id)) next.figures.push(f);
  }
  return n;
}

/**
 * Mark what a Read changed: each paragraph whose drafted words, state or table differ from `prev`'s gets `changed`
 * (the reading that changed it) and `before` (what it said); the rest lose the marks. Returns how many changed. With
 * no earlier reading (`prev` null or of another kind) nothing is marked.
 */
export function markChanges(prev: AprcDoc | null, next: AprcDoc): number {
  const old = new Map<string, AprcPara>();
  if (prev && prev.kind === next.kind) walk(prev, (p) => old.set(p.id, p));
  let n = 0;
  walk(next, (p) => {
    delete p.changed;
    delete p.before;
    if (!old.size) return;
    const o = old.get(p.id);
    const a = draftSig(o), b = draftSig(p);
    if (a === b) return;
    p.changed = p.src ?? o?.src ?? 'gr';
    p.before = { draft: o && a ? (o.draft || null) : null, table: !!o?.table && a !== '' };
    n++;
  });
  return n;
}

/**
 * Apply patches that only re-time (a new H): only to paragraphs whose draft came from one of `from` (the en options and
 * the timings; a reactions table the plan check settled is left as it is). A draft that changes is marked changed by
 * `cause`; the planner's words over it go stale with that cause, never with another reading's. Returns how many changed.
 */
export function retime(doc: AprcDoc, patches: AprcPatch[], from: AprcSrc[], cause: AprcSrc = 'h'): number {
  const ok = new Set(from);
  let n = 0;
  for (const x of patches) {
    const p = find(doc, x.id);
    if (!p || (p.src && !ok.has(p.src))) continue;
    const before = draftSig(p);
    const was = p.draft;
    applyPatches(doc, [x], x.src ?? p.src ?? from[0]);
    if (draftSig(p) === before) continue;
    n++;
    p.changed = cause;
    p.before = { draft: before ? (was || null) : null, table: !!p.table };
    if (p.mine) {
      if (isStale(p)) p.mine.staleBy ??= cause;
      else delete p.mine.staleBy;
    }
  }
  return n;
}

// ── typed table cells, keyed by the row they were typed on ───────────────────────────────────────────────────────
// A cell the planner types is kept under the row's identity (its first column that is not a serial, with times taken
// out), not its index: a new reading that adds, drops or reorders rows leaves his figures on their rows. Rows he adds
// under the table are his own and stay by index ("+0", "+1").

const SERIAL = /^\s*(\(?[a-z]{1,2}\)?\.?|\(?[ivx]{1,6}\)?\.?|\(?\d{1,3}\)?\.?|-)?\s*$/i;

/** The column that names a row: the first one not made only of serials ("a.", "(1)", "2") and blanks. */
export function idColOf(t: AprcTable): number {
  for (let c = 0; c < t.head.length; c++) if (t.rows.some((r) => !SERIAL.test(String(r[c] ?? '')))) return c;
  return 0;
}

const normKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\(\d{4} hrs[^)]*\)/g, '')
    .replace(/\b\d{4} hrs( d( day|[+-]\d+))?/g, '')
    .replace(/\bh\s*[+-]\s*\d+(:\d\d)?(\s*to\s*h\s*[+-]\s*\d+(:\d\d)?)?/g, '')
    .replace(/\b(in )?\d+(\.\d+)? min\b/g, '')
    .replace(/::/g, ':')
    .replace(/^\++/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Each drafted row's identity: its naming cell (times out), "#2" on a repeat, "~1" after a blank's last named row. */
export function rowKeys(t: AprcTable): string[] {
  const c = idColOf(t);
  const seen = new Map<string, number>();
  let last = '^', blank = 0;
  return t.rows.map((r) => {
    const k = normKey(String(r[c] ?? ''));
    if (!k) return `${last}~${++blank}`;
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    last = n === 1 ? k : `${k}#${n}`;
    blank = 0;
    return last;
  });
}

/** The key of a cell at row `r` (0 is the first row under the head; past the drafted rows, an added row) and column `c`. */
export function cellKey(p: AprcPara, r: number, c: number, keys: string[] = p.table ? rowKeys(p.table) : []): string {
  const n = p.table?.rows.length ?? 0;
  return r < n ? `${keys[r]}::${c}` : `+${r - n}::${c}`;
}

/** Cells kept as "row,col" before they were keyed by row: re-keyed against the table they were typed on. */
export function migrateCells(p: AprcPara): void {
  if (!p.cells || !p.table) return;
  const keys = rowKeys(p.table);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.cells)) {
    const m = /^(\d+),(\d+)$/.exec(k);
    out[m ? cellKey(p, Number(m[1]), Number(m[2]), keys) : k] = String(v);
  }
  p.cells = out;
}

/**
 * Old column index to new, by the column's head ("Inf" → "Inf (Pl)", "Locs" → "Task / Loc"), when a reading changed a
 * table's columns; a column with no match goes to "Remarks" when the new table has one, else keeps its index.
 */
export function colMap(oldHead: string[] | undefined, newHead: string[] | undefined): (c: number) => number {
  if (!oldHead || !newHead || oldHead.join('|') === newHead.join('|')) return (c) => c;
  const norm = (s: string): string => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]+/g, ' ').trim();
  const words = newHead.map((h) => norm(h).split(' ').filter(Boolean));
  const remarks = newHead.findIndex((h) => norm(h) === 'remarks');
  return (c) => {
    const o = norm(oldHead[c] ?? '');
    if (!o) return c;
    let i = newHead.findIndex((h) => norm(h) === o);
    const stem = o.split(' ')[0].replace(/s$/, '');
    if (i < 0) i = words.findIndex((ws) => ws.some((w) => w.replace(/s$/, '') === stem));
    return i >= 0 ? i : remarks >= 0 ? remarks : c;
  };
}

/** Bring the planner's typed cells onto a newly read table; rows of his that are gone become added rows (`moved`). */
function carryCells(k: AprcPara, p: AprcPara, at: string): void {
  let added = k.addRows ?? 0;
  const cells: Record<string, string> = {};
  const newKeys = p.table ? new Set(rowKeys(p.table)) : null;
  const orphan = new Map<string, Array<[number, string]>>();
  const col = colMap(k.table?.head, p.table?.head);
  for (const [key0, text] of Object.entries(k.cells ?? {})) {
    const m0 = /^(.*)::(\d+)$/.exec(key0);
    if (!m0) continue;
    const key = `${m0[1]}::${col(Number(m0[2]))}`;
    const m = /^(.*)::(\d+)$/.exec(key)!;
    if (m[1].startsWith('+') || !newKeys || newKeys.has(m[1])) cells[key] = text;
    else {
      const l = orphan.get(m[1]) ?? [];
      l.push([Number(m[2]), text]);
      orphan.set(m[1], l);
    }
  }
  if (orphan.size && p.table) {
    const oldKeys = k.table ? rowKeys(k.table) : [];
    const idCol = idColOf(k.table ?? p.table);
    const rows: number[] = [];
    for (const [rk, cs] of [...orphan].sort((a, b) => oldKeys.indexOf(a[0]) - oldKeys.indexOf(b[0]))) {
      const i = added++;
      rows.push(i);
      for (const [c, t] of cs) cells[`+${i}::${c}`] = t;
      const r = oldKeys.indexOf(rk);
      const label = r >= 0 ? String(k.table?.rows[r]?.[idCol] ?? '') : '';
      if (label && cells[`+${i}::${idCol}`] === undefined) cells[`+${i}::${idCol}`] = label;
    }
    p.moved = { rows: [...(k.moved?.rows ?? []), ...rows], at };
  } else if (k.moved) p.moved = { rows: [...k.moved.rows], at: k.moved.at };
  p.cells = Object.keys(cells).length ? cells : undefined;
  p.addRows = added || undefined;
}

/**
 * Bring the planner's words, acceptances, typed cells, added rows and given-back words from an earlier document into
 * a newly read one (by paragraph id). His words over a draft that changed are marked stale with what changed it; typed
 * cells follow their rows (a row gone keeps his cells as an added row, the paragraph marked).
 */
export function carryOver(prev: AprcDoc | null, next: AprcDoc, at = new Date().toISOString()): AprcDoc {
  if (!prev) return next;
  const keep = new Map<string, AprcPara>();
  walk(prev, (p) => {
    if (p.mine || p.accepted || p.cells || p.addRows || p.discarded || p.moved) keep.set(p.id, p);
  });
  walk(next, (p) => {
    const k = keep.get(p.id);
    if (!k) return;
    if (k.mine) {
      p.mine = { ...k.mine };
      if (isStale(p)) {
        if (!p.mine.staleBy) p.mine.staleBy = (hash(k.draft ?? '') !== hash(p.draft ?? '') || !isStale(k) ? p.changed ?? p.src : undefined) ?? p.src ?? 'gr';
      } else delete p.mine.staleBy;
    }
    if (k.discarded) p.discarded = { ...k.discarded };
    // An acceptance holds only while the paragraph is still a proposal.
    if (k.accepted && p.state === 'judge') p.accepted = true;
    if (k.cells || k.addRows || k.moved) carryCells(k, p, at);
  });
  return next;
}

/** The planner writes a paragraph (empty text gives it back to the tool; his words are kept to put back). */
export function setMine(doc: AprcDoc, id: string, text: string | null, at = new Date().toISOString()): boolean {
  const p = find(doc, id);
  if (!p) return false;
  const t = (text ?? '').trim();
  if (!t) {
    if (p.mine) p.discarded = { text: p.mine.text, at };
    delete p.mine;
  } else p.mine = { text: t, draftHash: hash(p.draft ?? ''), at };
  return true;
}

/** Put back the words last given back to the tool. */
export function restoreDiscarded(doc: AprcDoc, id: string, at = new Date().toISOString()): boolean {
  const p = find(doc, id);
  if (!p?.discarded) return false;
  const text = p.discarded.text;
  delete p.discarded;
  p.mine = { text, draftHash: hash(p.draft ?? ''), at };
  return true;
}

/** Take a proposal as it stands (or take the acceptance back). */
export function accept(doc: AprcDoc, id: string, on = true): boolean {
  const p = find(doc, id);
  if (!p || p.state !== 'judge') return false;
  p.accepted = on || undefined;
  return true;
}

/** Accept every proposal not yet accepted or rewritten. Returns how many. */
export function acceptAll(doc: AprcDoc): number {
  let n = 0;
  walk(doc, (p) => {
    if (p.state === 'judge' && !p.accepted && !p.mine && (p.draft || p.table)) {
      p.accepted = true;
      n++;
    }
  });
  return n;
}

/**
 * The table as it prints: the planner's cells over the drafted ones, his added rows below. In the fair copy a drafted
 * table that is a proposal not yet accepted keeps only its head, its first column and his cells (the rest ruled).
 */
export function tableOf(p: AprcPara, copy: AprcCopy): AprcTable | null {
  const t = p.table;
  if (!t) return null;
  const hide = copy === 'fair' && p.state === 'judge' && !p.accepted;
  const n = t.rows.length + (p.addRows ?? 0);
  const keys = rowKeys(t);
  const rows: string[][] = [];
  for (let r = 0; r < n; r++) {
    const base = t.rows[r] ?? t.head.map(() => '');
    rows.push(t.head.map((_, c) => {
      const mine = p.cells?.[cellKey(p, r, c, keys)];
      if (mine !== undefined) return mine;
      const d = base[c] ?? '';
      return hide && c > 0 ? '' : d;
    }));
  }
  return { head: t.head, rows, widths: t.widths };
}

/** The planner types into a cell (null gives it back to the tool). `r` counts the rows as shown, added rows last. */
export function setCell(doc: AprcDoc, id: string, r: number, c: number, text: string | null): boolean {
  const p = find(doc, id);
  if (!p?.table || c < 0 || c >= p.table.head.length || r < 0 || r >= p.table.rows.length + (p.addRows ?? 0)) return false;
  const key = cellKey(p, r, c);
  const cells = { ...(p.cells ?? {}) };
  if (text === null) delete cells[key];
  else cells[key] = text.trim();
  p.cells = Object.keys(cells).length ? cells : undefined;
  return true;
}

/** Whether the planner typed into a cell. */
export function cellTyped(p: AprcPara, r: number, c: number): boolean {
  return !!p.table && p.cells?.[cellKey(p, r, c)] !== undefined;
}

/** Add an empty row under the table (or take the last added one away). */
export function addRow(doc: AprcDoc, id: string, n = 1): boolean {
  const p = find(doc, id);
  if (!p?.table) return false;
  const next = Math.max(0, (p.addRows ?? 0) + n);
  if (n < 0 && p.cells) {
    for (const k of Object.keys(p.cells)) {
      const m = /^\+(\d+)::/.exec(k);
      if (m && Number(m[1]) >= next) delete p.cells[k];
    }
    if (!Object.keys(p.cells).length) p.cells = undefined;
  }
  if (p.moved) {
    const rows = p.moved.rows.filter((i) => i < next);
    if (rows.length) p.moved.rows = rows;
    else delete p.moved;
  }
  p.addRows = next || undefined;
  return true;
}

/** The rows a new reading moved: keep them as his (the mark goes). */
export function keepMoved(doc: AprcDoc, id: string): boolean {
  const p = find(doc, id);
  if (!p?.moved) return false;
  delete p.moved;
  return true;
}

/** The rows a new reading moved: drop them and their cells (take the new reading). */
export function dropMoved(doc: AprcDoc, id: string): boolean {
  const p = find(doc, id);
  if (!p?.moved) return false;
  const gone = new Set(p.moved.rows);
  const n = p.addRows ?? 0;
  const to = new Map<number, number>();
  let j = 0;
  for (let i = 0; i < n; i++) if (!gone.has(i)) to.set(i, j++);
  const cells: Record<string, string> = {};
  for (const [k, t] of Object.entries(p.cells ?? {})) {
    const m = /^\+(\d+)::(\d+)$/.exec(k);
    if (!m) cells[k] = t;
    else if (to.has(Number(m[1]))) cells[`+${to.get(Number(m[1]))}::${m[2]}`] = t;
  }
  p.cells = Object.keys(cells).length ? cells : undefined;
  p.addRows = j || undefined;
  delete p.moved;
  return true;
}

/** The draft under the planner's words has changed since he wrote them. */
export const isStale = (p: AprcPara): boolean => !!p.mine && p.draft !== null && hash(p.draft) !== p.mine.draftHash;

/** Why a paragraph wants looking at again: what changed under his words, or his table rows that moved; null when nothing. */
export function staleWhy(p: AprcPara): AprcSrc | 'rows' | null {
  if (isStale(p)) return p.mine!.staleBy ?? p.src ?? 'gr';
  if (p.moved) return 'rows';
  return null;
}

/** The short mark of a stale paragraph in the draft copy, by what changed. */
export const STALE_MARK: Record<AprcSrc | 'rows', string> = {
  gr: 'Gr changed since',
  map: 'Map changed since',
  plan: 'Plan check changed since',
  en: 'En options changed since',
  orbat: 'ORBAT changed since',
  time: 'Timings changed since',
  h: 'H changed since',
  aim: 'Aim changed since',
  rows: 'Table rows changed since',
};

// ── opening a kept or saved document ─────────────────────────────────────────────────────────────────────────────

const STATES = new Set<AprcState>(['gr', 'map', 'judge', 'yours']);

function normPara(x: any): AprcPara | null {
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) return null;
  const p: AprcPara = {
    ...x,
    head: typeof x.head === 'string' ? x.head : null,
    draft: typeof x.draft === 'string' ? x.draft : null,
    state: STATES.has(x.state) ? x.state : 'yours',
    basis: Array.isArray(x.basis) ? x.basis.filter((b: any) => b && typeof b.text === 'string').map((b: any) => ({ kind: ['data', 'rule', 'input', 'calc'].includes(b.kind) ? b.kind : 'data', text: b.text })) : [],
    prompts: Array.isArray(x.prompts) ? x.prompts.map(String) : [],
    children: Array.isArray(x.children) ? (x.children.map(normPara).filter(Boolean) as AprcPara[]) : [],
  };
  if (p.table && !(Array.isArray(p.table.head) && Array.isArray(p.table.rows))) delete p.table;
  if (p.cells && typeof p.cells !== 'object') delete p.cells;
  if (p.mine && typeof p.mine.text !== 'string') delete p.mine;
  migrateCells(p);
  return p;
}

/**
 * A sheet kept before drafts carried their reading (`src`): each drafted paragraph is given the reading its writer
 * draws on, by its id, so a Read that cannot read again still keeps it. Only when no paragraph carries one.
 */
function inferSrc(parts: AprcPart[]): void {
  let any = false;
  const all: AprcPara[] = [];
  const go = (p: AprcPara) => {
    if (p.src) any = true;
    all.push(p);
    p.children.forEach(go);
  };
  for (const pt of parts) for (const g of pt.groups) g.paras.forEach(go);
  if (any) return;
  const RULES: Array<[RegExp, AprcSrc]> = [
    [/^(rev\.|en\.comp|en\.opt1\.disp|own\.disp|plan\.comd)/, 'map'],
    [/^(own\.str|own\.comp|own\.ded\.basic|own\.ded\.addl|ts\.req)/, 'orbat'],
    [/^(ts\.data|ts\.calc)/, 'time'],
    [/^(en\.|crs\.react|gr\.ded\.apch|gr\.ded\.ap1|gr\.ded\.ap2|gr\.itg\.mitg\.dir)/, 'en'],
    [/^(crs\.|plan\.)/, 'plan'],
    [/^(gr\.|aim|own\.tasks)/, 'gr'],
  ];
  for (const p of all) {
    if (p.state === 'yours' && p.draft === null && !p.table) continue;
    const hit = RULES.find(([re]) => re.test(p.id));
    if (hit) p.src = hit[1];
  }
}

/**
 * An appreciation from a file, the browser or a plan, made safe to open: the arrays the sheet and the exports read
 * are there (an older or hand-edited file may lack figures, confirm or sources), typed cells keyed by row. Null when
 * it is not an appreciation.
 */
export function normalizeDoc(raw: unknown): AprcDoc | null {
  const d: any = raw && typeof raw === 'object' ? clone(raw) : null;
  if (!d || d.version !== 1 || !Array.isArray(d.parts)) return null;
  delete d.marking; // kept before the marking became a ruled line
  const parts: AprcPart[] = d.parts
    .filter((pt: any) => pt && typeof pt === 'object')
    .map((pt: any) => ({
      id: String(pt.id ?? ''),
      title: String(pt.title ?? ''),
      groups: (Array.isArray(pt.groups) ? pt.groups : []).filter((g: any) => g && typeof g === 'object').map((g: any) => ({ id: String(g.id ?? ''), title: typeof g.title === 'string' ? g.title : null, paras: (Array.isArray(g.paras) ? g.paras : []).map(normPara).filter(Boolean) as AprcPara[] })),
    }));
  inferSrc(parts);
  return {
    ...d,
    version: 1,
    kind: d.kind === 'attk' || d.kind === 'wdr' ? d.kind : 'def',
    title: typeof d.title === 'string' && d.title ? d.title : 'APRC OF THE SIT',
    frame: d.frame && typeof d.frame === 'object' ? d.frame : null,
    parts,
    figures: Array.isArray(d.figures) ? d.figures.filter((f: any) => f && typeof f.id === 'string') : [],
    confirm: Array.isArray(d.confirm) ? d.confirm.filter((c: any) => c && typeof c.text === 'string').map((c: any) => ({ ...c, paras: Array.isArray(c.paras) ? c.paras.map(String) : [] })) : [],
    sources: Array.isArray(d.sources) ? d.sources.map(String) : [],
    readAt: d.readAt && typeof d.readAt === 'object' ? d.readAt : undefined,
    limits: normLimits(d.limits),
  };
}

/** The aim's limitations from a file, made safe; undefined when none are set. */
export function normLimits(x: any): AprcLimits | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const s = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const n = (v: any): number | null => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const l: AprcLimits = {
    fwd: !!x.fwd || undefined, noPen: s(x.noPen), allCosts: s(x.allCosts), attrition: !!x.attrition || undefined, delayH: n(x.delayH), casPct: n(x.casPct) !== null && n(x.casPct)! <= 100 ? n(x.casPct) : null, viable: !!x.viable || undefined,
    salient: !!x.salient || undefined, penetrated: !!x.penetrated || undefined, maxCoys: n(x.maxCoys), by: s(x.by),
    destr: !!x.destr || undefined, night: !!x.night || undefined, bunkers: !!x.bunkers || undefined,
    denial: s(x.denial), quick: !!x.quick || undefined, climbM: n(x.climbM),
    deny: s(x.deny), noMovBefore: s(x.noMovBefore), clearLine: s(x.clearLine), clearBy: s(x.clearBy), newPosn: s(x.newPosn), byDay: !!x.byDay || undefined,
    other: Array.isArray(x.other) ? x.other.map(String).map((t: string) => t.trim()).filter(Boolean) : undefined,
  };
  for (const k of Object.keys(l) as Array<keyof AprcLimits>) if (l[k] === undefined || l[k] === null || (Array.isArray(l[k]) && !(l[k] as string[]).length)) delete l[k];
  return Object.keys(l).length ? l : undefined;
}

// ── reading it out ───────────────────────────────────────────────────────────────────────────────────────────────

export type AprcMark = 'GR' | 'MAP' | 'YOU JUDGE' | 'YOURS' | 'WRITTEN';

export interface AprcShown {
  /** The words to print after the heading; '' for a heading only; null for a ruled line. */
  text: string | null;
  mark: AprcMark;
  /** A proposal shown but not yet accepted (draft copy only). */
  proposal: boolean;
  stale: boolean;
  /** What changed under it (when stale). */
  why?: AprcSrc | 'rows' | null;
}

/** What a paragraph prints in a copy. */
export function shown(p: AprcPara, copy: AprcCopy): AprcShown {
  const why = staleWhy(p);
  const stale = why !== null;
  const markOf = (): AprcMark => (p.state === 'gr' ? 'GR' : p.state === 'map' ? 'MAP' : p.state === 'judge' ? 'YOU JUDGE' : 'YOURS');
  if (p.mine) return { text: p.mine.text, mark: 'WRITTEN', proposal: false, stale, why };
  if (p.draft === null) return { text: null, mark: 'YOURS', proposal: false, stale, why };
  if (p.draft === '') return { text: '', mark: markOf(), proposal: false, stale, why };
  if (p.state === 'judge' && !p.accepted) return copy === 'fair' ? { text: null, mark: 'YOU JUDGE', proposal: false, stale, why } : { text: p.draft, mark: 'YOU JUDGE', proposal: true, stale, why };
  return { text: p.draft, mark: markOf(), proposal: false, stale, why };
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
const alpha = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : alpha(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));

/** The label of a paragraph by depth: 1. / a. / (1) / (a) / i. */
export function label(depth: number, index: number): string {
  if (depth === 0) return `${index + 1}.`;
  if (depth === 1) return `${alpha(index)}.`;
  if (depth === 2) return `(${index + 1})`;
  if (depth === 3) return `(${alpha(index)})`;
  return `${ROMAN[index] ?? index + 1}.`;
}

export type AprcLine =
  | { type: 'part'; title: string; id: string }
  | { type: 'group'; title: string; id: string }
  | { type: 'para'; p: AprcPara; depth: number; label: string; part: AprcPart; group: AprcGroup };

/** The document in printing order, paragraphs numbered through (top-level numbers run on across parts). */
export function lines(doc: AprcDoc): AprcLine[] {
  const out: AprcLine[] = [];
  let n = 0;
  const go = (p: AprcPara, depth: number, i: number, part: AprcPart, group: AprcGroup) => {
    out.push({ type: 'para', p, depth, label: label(depth, depth === 0 ? n++ : i), part, group });
    p.children.forEach((c, j) => go(c, depth + 1, j, part, group));
  };
  for (const part of doc.parts) {
    // an annex numbers its paragraphs afresh
    if (part.id.startsWith('anx')) n = 0;
    out.push({ type: 'part', title: part.title, id: part.id });
    for (const g of part.groups) {
      if (g.title) out.push({ type: 'group', title: g.title, id: g.id });
      g.paras.forEach((p, i) => go(p, 0, i, part, g));
    }
  }
  return out;
}

/** The printed number of a paragraph ("6a(3)"), for the sheet and the slides. */
export function numberOf(doc: AprcDoc, id: string): string {
  const all = lines(doc);
  const stack: string[] = [];
  for (const l of all) {
    if (l.type !== 'para') continue;
    stack.length = l.depth;
    stack[l.depth] = l.label;
    if (l.p.id === id) return stack.map((s, i) => (i === 0 ? s.replace(/\.$/, '') : s.replace(/\.$/, ''))).join('');
  }
  return '';
}

export interface AprcCounts {
  gr: number;
  map: number;
  judge: number;
  yours: number;
  written: number;
  stale: number;
  /** Proposals neither accepted nor rewritten. */
  open: number;
  /** Proposals taken as they stand (counted in `judge` too). */
  accepted: number;
}

/** Paragraphs by state (headings without words of their own are not counted). */
export function counts(doc: AprcDoc): AprcCounts {
  const c: AprcCounts = { gr: 0, map: 0, judge: 0, yours: 0, written: 0, stale: 0, open: 0, accepted: 0 };
  walk(doc, (p) => {
    if (p.mine) {
      c.written++;
      if (isStale(p)) c.stale++;
      return;
    }
    if (p.moved) c.stale++;
    if (p.state === 'judge' && p.accepted && (p.draft || p.table)) c.accepted++;
    if (p.draft === '' && !p.table) return;
    if (p.draft === null) c.yours++;
    else if (p.state === 'yours') c.yours++;
    else c[p.state]++;
    if (p.state === 'judge' && (p.draft || p.table) && !p.accepted && !p.mine) c.open++;
  });
  return c;
}

const RULE = '________________';

/** The appreciation as plain text. */
export function toText(doc: AprcDoc, copy: AprcCopy = 'draft'): string {
  const L: string[] = [];
  L.push(RULE, '');
  L.push('Copy no ____ of ____', RULE, RULE, 'Tel Mil: ________', 'G-________', 'Dated ________', '', doc.title, '', 'Ref: ________', '');
  for (const l of lines(doc)) {
    if (l.type === 'part') L.push('', l.title, '');
    else if (l.type === 'group') L.push(l.title);
    else {
      const s = shown(l.p, copy);
      const pad = '   '.repeat(l.depth);
      const head = l.p.head ? `${l.p.head}.` : '';
      const body = s.text === null ? RULE : s.text;
      const mark = copy === 'draft' && (s.text !== '' || l.p.table) ? ` [${s.proposal ? 'PROPOSAL' : s.mark}${s.stale && s.why ? `, ${STALE_MARK[s.why]}` : ''}]` : '';
      L.push(`${pad}${l.label} ${[head, body].filter(Boolean).join(' ')}${mark}`.trimEnd());
      if (copy === 'draft' && s.text === null && l.p.prompts.length) L.push(`${pad}   (${l.p.prompts.join('; ')})`);
      const tb = tableOf(l.p, copy);
      if (tb) {
        L.push(`${pad}   ${tb.head.join(' | ')}`);
        for (const r of tb.rows) L.push(`${pad}   ${r.map((c) => c || '____').join(' | ')}`);
      }
    }
  }
  L.push('', RULE);
  if (copy === 'draft') {
    if (doc.confirm.length) L.push('', 'CONFIRM ON GR', ...doc.confirm.map((c, i) => `${i + 1}. ${c.text}`));
    if (doc.sources.length) L.push('', 'DATA', ...doc.sources.map((s, i) => `${i + 1}. ${s}`));
    if (doc.frame) L.push('', `Read ${doc.frame.readAt}: ${doc.frame.echelon} AOR (${doc.frame.aor}), ${doc.frame.mover}, ${doc.frame.month}, ${doc.frame.season === 'wet' ? 'after rain' : 'dry'}; threat: ${doc.frame.threat}.`);
  }
  return L.join('\n');
}

export const AprcRule = RULE;
