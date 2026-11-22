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
 *     prompts citing the book's sheet (`MA`). A kind is added with `registerOutline`.
 */

export type AprcKind = 'def' | 'attk';
/** Where a paragraph's draft came from: the ground reading, symbols / a plan on the map, a proposal to judge, or nothing (the planner's). */
export type AprcState = 'gr' | 'map' | 'judge' | 'yours';
export type AprcCopy = 'fair' | 'draft';

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

/** The sub-heads of one Def Possibility. Those the ground reading can propose are filled by the writer; the rest stay the planner's. */
export const DP_HEADS: Array<[string, string]> = [
  ['fdls', 'FDLs'], ['depth', 'Depth'], ['strpt', 'Str Pt Def'], ['screens', 'Screens'], ['adv', 'Adv Posn'], ['bias', 'Bias of Def'], ['atk', 'Bias of A tk Def'],
  ['obs', 'Obs Plan'], ['surv', 'Surv and Obsn Plan'], ['df', 'DF Plan'], ['killing', 'Killing Areas'], ['catk', 'C Attk Objs'], ['mor', 'Loc of Mor Pl'],
  ['hq', 'Bn HQ'], ['tac', 'Bn Tac HQ'], ['misc', 'Misc Measures'],
];

function outlineDef(): AprcPart[] {
  const blankTable = (head: string[], first: string[]): AprcTable => ({ head, rows: first.map((f) => [f, ...head.slice(1).map(() => '')]) });
  return [
    {
      id: 'rev', title: 'REVIEW OF SIT',
      groups: [{ id: 'rev', title: null, paras: [
        yours('rev.en', 'En Forces', ['His forces opposite, his likely aim, when']),
        yours('rev.own', 'Own Forces', ['The higher formation, its layout, units left and right, the reserve']),
        yours('rev.air', 'Air Sit'),
      ] }],
    },
    { id: 'aim', title: 'AIM', groups: [{ id: 'aim', title: null, paras: [yours('aim', null, ['The aim, with its limitations'])] }] },
    {
      id: 'fac', title: 'FACTORS',
      groups: [
        { id: 'gr', title: 'Gr and Weather', paras: [
          yours('gr.gen', 'Gen Description'),
          headOnly('gr.apchs', 'Apchs', []),
          headOnly('gr.itg', 'ITGs', []),
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
              headOnly('gr.ded.dp1', 'DP 1', DP_HEADS.map(([k, h]) => yours(`gr.ded.dp1.${k}`, h))),
              yours('gr.ded.dp2', 'DP 2'),
            ]),
            yours('gr.ded.common', 'Common Deductions', ['Bias of A tk def', 'Incl of BUAs into the def', 'Obs plan', 'Surv plan', 'Loc of adv posn']),
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
          headOnly('en.ded', 'Deductions', [
            yours('en.ded.dp', 'DP', ['Each DP confirmed, modified or refined']),
            yours('en.ded.common', 'Common Deductions', ['Use of fire sp', 'Clearance of SZ and BOPs', 'Use of air', 'En likely FAA / Assy A', 'Heliborne / infiltration force', 'En deception and surprise']),
          ]),
        ] },
        { id: 'own', title: 'Own Sit', paras: [
          yours('own.comp', 'Composn of Own Forces'),
          yours('own.disp', 'Own Disposns'),
          para('own.str', 'Own Str as Related to that of the En', { draft: '', table: blankTable(['Ser', 'Arms', 'En', 'Own', 'Ratio'], ['a.', 'b.', 'c.', 'd.', 'e.']) }),
          headOnly('own.tasks', 'Assessment of Tasks', [
            para('own.tasks.dp1', 'DP 1', { draft: '', table: blankTable(['Ser', 'Locs', 'Inf', 'A tk', 'Engrs'], ['(1)', '(2)', '(3)', '(4)', '(5)']) }),
            yours('own.tasks.dp2', 'DP 2'),
          ]),
          headOnly('own.ded', 'Deductions', [
            yours('own.ded.basic', 'Basic Deductions', ['Almt of tps to tasks: how the tps needed are brought within those held']),
            yours('own.ded.common', 'Common Deductions'),
          ]),
        ] },
        { id: 'ts', title: 'Time and Space', paras: [
          headOnly('ts.data', 'Time Data', ['I Day', 'M Day', 'D Day', 'Time by which def to be occupied', 'Time by which def to be ready', 'Total time aval'].map((h) => yours(`ts.data.${slug(h)}`, h))),
          para('ts.req', 'Time Req', { draft: '', table: blankTable(['S/No', 'Activity', 'Time (hrs)'], ['a.', 'b.', 'c.', 'd.', 'e.', 'f.', 'g.', '']) }),
          headOnly('ts.ded', 'Deductions', [yours('ts.ded.dp', 'DP', ['Essential timings']), yours('ts.ded.common', 'Common Deductions', ['Pri of work when time aval is less than time req'])]),
        ] },
      ],
    },
    {
      id: 'crs', title: 'COURSES',
      groups: [{ id: 'crs', title: null, paras: [
        yours('crs.a', 'Course A'),
        para('crs.react', 'En Reactions and Own Ctr Actions', { draft: '', table: blankTable(['Ser', 'En Reactions', 'Own Ctr Actions'], ['a.', 'b.', 'c.', 'd.']) }),
        headOnly('crs.an', 'Analysis', [yours('crs.an.adv', 'Advs'), yours('crs.an.dis', 'Disadvs')]),
        yours('crs.b', 'Course B'),
        yours('crs.adopted', 'Course Adopted', ['With reasons']),
      ] }],
    },
    {
      id: 'plan', title: 'PLAN',
      groups: [{ id: 'plan', title: null, paras: [
        yours('plan.msn', 'Msn'),
        headOnly('plan.exec', 'Exec', [yours('plan.exec.outline', 'Gen Outline'), yours('plan.exec.tasks', 'Grouping and Tasks'), yours('plan.exec.coord', 'Coord Instrs', ['Timings', 'Bdrys'])]),
        yours('plan.adm', 'Adm and Log'),
        yours('plan.comd', 'Comd and Sig'),
      ] }],
    },
  ];
}

// ── the attack ───────────────────────────────────────────────────────────────────────────────────────────────────
// From "Mechs of Aprc (Attk)" (Material/Literature/1. Books/MECHS OF APRC - ATTK.pdf, 21 sheets, a Coy Comd's attack
// appreciation; user, 22 Nov 2026). The book prints no page numbers: "p N" is its N-th sheet. Its paras 1 to 24 are kept
// in its order and numbering: 12 En Sit, 13 Own Sit, 14 Almt of Tps to Task and 15 Time and Space are numbered paras of
// their own. The FACTORS heading the book leaves out is the sample IE's (IE apprc.pdf p 2), as in the defence. Its
// "l. Effect if captured" and "m. Effs if Captured" are one head here (m carries the effects). What the book gives as
// specimen wording ("Ref to whites" never) is a prompt, never printed.

/** The book's sheet, cited in the prompts. */
export const MA = (p: number | string): string => `Mechs of Aprc (Attk) p ${p}`;
/** The planner's paragraph with the book's heads to consider and its page. */
const yoursA = (id: string, head: string | null, p: number | string, prompts: string[] = []): AprcPara => para(id, head, { prompts: [...prompts, MA(p)] });

/** The heads of one Imp Tac Gr (p 1-2); the writer fills those the ground can tell. */
export const ITG_HEADS_ATTK: Array<[string, string, string[]]> = [
  ['loc', 'Loc', []],
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
];
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

function outlineAttk(): AprcPart[] {
  return [
    {
      id: 'rev', title: 'REVIEW OF THE SIT',
      groups: [{ id: 'rev', title: null, paras: [
        yoursA('rev.en', 'En', 1, ['Discuss two up', 'Hostilities between __ and __', 'Loc / intentions: where the en is presently conc and what he is expected to do', 'Any aspect of heliborne']),
        yoursA('rev.own', 'Own', 1, ['Discuss two up', 'Task of own Bde and what the comd wants to do', 'Depl of neighbouring Bns', 'Any other detail given by the Bde comd']),
        yoursA('rev.air', 'Air', 1, ['All aspects of air, both own and en']),
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
          yoursA('gr.gen', 'Gen Description', 1, ['The ground of the obj area and the apchs to it']),
          headOnly('gr.itg', 'Imp Tac Grs', [headOnly('gr.itg.mitg', 'MITG', itgHeadsAttk('gr.itg.mitg'))]),
          headOnly('gr.apchs', 'Apchs', [para('gr.apch.note', null, { prompts: ['Named A, B, C or northern, southern etc; from own conc area up to the area where it accomplishes own msn', 'Capacity: 2/3 of the force able to mov depl; a Bde size force takes approx 4 km', MA(2)] })]),
          yoursA('gr.obs', 'Obs', 3, ['Type, loc, width / depth and concl: engr effort req, eff on mnvr (canalising)']),
          yoursA('gr.cover', 'Cover', 3, ['From gr and air']),
          yoursA('gr.met', 'Met', 3, ['First and last light, ph of moon and its effs on the op']),
          headOnly('gr.ded', 'Deductions', [
            yoursA('gr.ded.obj', 'Pri of Objs / ITG', '3-4', ['Irrespective of the dir of attk: the highest and most dominating feature, obsn and F of F all round, near the main Rd / Tr junc, access to the Rd, capture of the area', 'All the apchs terminate on it', 'Most dominating feature of tac significance', 'Dominates the main Rd / Tr; physical clearance needed before capturing it', 'Facilitates further op towards __', 'Mutually sp by all other imp tac gr']),
            yoursA('gr.ded.apch', 'Pri of Apchs / Dir of Attk', 4, ['Sufficient space for armr in CS / fire sp', 'Fewer dominating features', 'Flanking in nature: capture of the MITG in the initial phase', 'Shorter; leads dir to the depth of the obj', 'Unexpected', 'Easy dir keeping', 'Suitable depl areas', 'Only obs that can be passed, negotiated or crossed with little engr effort']),
            yoursA('gr.ded.comb', 'Pri of Comb of Apchs', 4, ['Mutual sp, cover, lesser terrain friction; taking more imp tac grs in one phase']),
            headOnly('gr.ded.aps', 'Attk Possibilities (APs)', [
              para('gr.ded.ap1', 'AP-1', {
                prompts: ['To attk from Lt / Rt with two Pls up with tks in CS / fire sp / blocking posn, in two phases, starting the op in the early hrs / later part of the ni', MA(5)],
                children: [
                  yoursA('gr.ded.ap1.ph1', 'Phase 1', 5, ['Capturing __ and __ with a Pl / Pl plus each with tks in CS / fire sp, keeping a Pl in res; 45-60 mins']),
                  yoursA('gr.ded.ap1.ph2', 'Phase 2', 5, ['Capturing __ with a Pl with tks in CS / fire sp; 30-45 mins']),
                  headOnly('gr.ded.ap1.depl', 'Depl Areas', [yoursA('gr.ded.ap1.fup', 'FUP', 5), yoursA('gr.ded.ap1.bof', 'BOF', 5), yoursA('gr.ded.ap1.faa', 'FAA', 5)]),
                  yoursA('gr.ded.ap1.reorg', 'Reorg and DF Plan', 5, ['Reorg facing __ with a Pl in area __, a Pl facing __ in area __ and depth Pl in area __', 'Mk __ as DFs and __ as DF (SOS) for arty and mor']),
                  yoursA('gr.ded.ap1.fech', 'F Ech Route', 5, ['Along Rd / Tr __ with RV at __']),
                  yoursA('gr.ded.ap1.block', 'Blocking Posn', 5, ['If any: estb at __ with __ force, __ mins prior to H, using __ route']),
                  yoursA('gr.ded.ap1.decep', 'Deception', 5, ['If any: with __ force from __ dir at __ hrs']),
                ],
              }),
              yoursA('gr.ded.ap2', 'AP-2 (on Similar Lines as AP-1)', 5, ['Either changes the dir of attk', 'Depl areas', 'Use / quantum of forces in different phases', 'Capturing of objs in different phases', 'Use of tks in different roles: CS, fire sp, blocking posn']),
            ]),
            headOnly('gr.ded.common', 'Common Deductions', [
              yoursA('gr.ded.c.bof', 'Loc of Base of Fire', 5, ['Domination, cover, dist from the obj and ability to eff engage the obj area, irrespective of the AP']),
              yoursA('gr.ded.c.fech', 'F Ech Route', 5, ['The only maj Rd through the obj area that facilitates the mov of vehs']),
              yoursA('gr.ded.c.reorg', 'Reorg Plan', 5, ['Domination, defensibility of gr, obsn and F of F: fwd loc on / in area __, depth along __']),
              yoursA('gr.ded.c.surprise', 'Surprise', 5, ['Area devoid of cover, mov by day observed: attk in the hrs of darkness', 'Proper cam and clt', 'All mov at ni']),
              yoursA('gr.ded.c.armr', 'Use of Armr', 5, ['Side open, going easy, no maj A tk obs: tks in CS']),
              yoursA('gr.ded.c.pnr', 'Tasks / Use of Aslt Pnr / Engr', 5, ['Accompany the aslt tps in xing obs', 'Recce, dev and improvement of xing sites', 'Neutralize dmls along br __', 'Improvement of Rd / Tr __ for carriage of F ech', 'Creating gaps in mine fd / wire obs']),
              yoursA('gr.ded.c.timing', 'Timing of Attk', 6, ['The moon is in __ qtr and up till __ hrs: attk during the early / later part of the ni (weather too: cloudy / rainy)']),
              yoursA('gr.ded.c.smk', 'Use of Smk', 6, ['To protect the mov from the FAA / FUP onwards where cover is less, from __ to __']),
              yoursA('gr.ded.c.phases', 'Phases of Attk', 6, ['The dist between the objs, their depth and wide frontage: phases for each dir of attk (Lt / Rt / centre apch), Phase 1, Phase 2']),
              yoursA('gr.ded.c.flank', 'Flank Protection', 6, ['Both flanks open, no obs: task Pl __ to provide flank protection from area __ to __']),
            ]),
          ]),
        ] },
        { id: 'sit', title: null, paras: [
          headOnly('en', 'En Sit', [
            headOnly('en.opts', 'Options Aval to En', [
              headOnly('en.opt1', 'Option 1 (Against AP-1)', [
                yoursA('en.opt1.disp', 'Sec Disposns', 6, ['Depl Pl / Pl plus size force in his AOR: Sec / Sec plus in area __, Sec in area __ and Sec in area __ / depth']),
                yoursA('en.opt1.bias', 'Bias of Def / A Tk Def', 6, ['Lt / Rt and centre']),
                yoursA('en.opt1.killing', 'Killing Areas', 6, ['Primary killing area from incl __ to incl __', 'Secondary killing area from incl __ to incl __']),
                yoursA('en.opt1.catk', 'C Attk Obj in Order of Pri', 7),
                yoursA('en.opt1.obs', 'Obs Plan', 7, ['Protective mine fd and wire obs in front and on flanks from incl __ to incl __']),
                yoursA('en.opt1.surv', 'Surv / Obsn Plan', 7, ['SP in area __', 'LP in area __', 'Arty obsr __', 'Mor obsr __']),
                yoursA('en.opt1.df', 'DF Plan', 7, ['Mk __, __ and __ as DFs and __ as DF (SOS)']),
                headOnly('en.opt1.an', 'Analysis', [
                  yoursA('en.opt1.adv', 'Advantages', 7, ['Eff covers all the apchs', 'Def is compact and caters for all-round def', 'All loc held in str', 'Forces the attacker to phase his attk', 'Good F of F and obsn', 'Rd / Tr __ eff dominated', 'Readjustment possible once the dir of attk is known', 'Def based on natural obs', 'Easy route of wdr / rft', 'Flanks protected']),
                  yoursA('en.opt1.dis', 'Disadvantages', 7, ['Objs well defined and engaged easily', 'Capture of __ (MITG) unhinges the entire posn', 'Depth is weak', 'Most expected layout of def', 'Route of wdr / rft can be cut']),
                ]),
              ]),
              yoursA('en.opt2', 'Option 2', 7),
            ]),
            yoursA('en.caps', 'En Caps', 7, ['Local adjustment', 'Local C attk', 'Reinforcement', 'Spoiling attk', 'Use of NVDs', 'Use of arty', 'Use of air', 'Obs laying cap', 'Conduct of BHL', 'Emp of screens and surv elms']),
            headOnly('en.ded', 'Deductions', [
              headOnly('en.ded.basic', 'Basic Deductions', [
                yoursA('en.ded.obj', 'Pri of Obj / Imp Tac Grs', 8, ['Keeping in view his cap, pattern of depl and disposn on all imp tac grs: the pri from Gr and Weather stands cfm, or as changed']),
                yoursA('en.ded.apch', 'Pri of Apchs / Dir of Attk', 8, ['His depl vis-a-vis his cap and options: the pri from Gr and Weather stands cfm, or the apch he covers best discarded']),
                yoursA('en.ded.aps', 'Attk Possibilities', 8, ['Against his options: the APs from Gr and Weather stand cfm']),
                headOnly('en.ded.ap1', 'AP-1 (Cfm / Modified)', [
                  yoursA('en.ded.ap1.dir', 'Dir / Phases', 8, ['Cfm: capture of these objs renders his def unbal and opens the main Rd', 'Modified: his killing gr, swift reactions or wdr / rft cap: discard the apch, attk from __']),
                  yoursA('en.ded.ap1.depl', 'Depl Areas', '8-9', ['FUP: covered from his fire / flanking', 'FAA: central to both dirs of attk', 'BOF: engages him eff, irrespective of the dir of attk']),
                  yoursA('en.ded.ap1.reorg', 'Reorg / DF Plan', 9, ['His cap to launch a C attk and assy his forces in these areas']),
                  yoursA('en.ded.ap1.block', 'Blocking Posn', 9, ['His cap to wdr / rft the area within __ mins: tks for the blocking posn instead of CS / fire sp']),
                ]),
              ]),
              headOnly('en.ded.common', 'Common Deductions', [
                yoursA('en.ded.c.spoil', 'Spoiling Attk', 9, ['Secure the FUP with a Pl / Pl minus before occupying it', 'An altn FUP 300-400 yds away', 'Smk screen from the FAA onwards', 'Mov the tks at the last possible time']),
                yoursA('en.ded.c.armr', 'Use of Armr', 9, ['His posns well prep, covered and strongly held: armr in fire sp']),
                yoursA('en.ded.c.air', 'Air Superiority', 9, ['All mov in the hrs of darkness', 'Strict Tr discipline', 'Strict cam and clt', 'Attk at ni']),
                yoursA('en.ded.c.nvd', 'En Use of NVDs', 9, ['Max cover afforded by gr after mov from the FUP', 'Covering fire of arty / BOF to keep his head down', 'Max use of smk']),
                yoursA('en.ded.c.readj', 'Readjustment of the En', '9-10', ['Eff use of arty on fwd and depth loc', 'Conc vol of fire from the BOF', 'Air burst']),
                yoursA('en.ded.c.pnr', 'Use of Aslt Pnr / Engr', 10, ['His mine fd and wire obs all round: safe lanes for the F ech and the subsequent op']),
                yoursA('en.ded.c.catk', 'Local C Attk', 10, ['Quick reorg / consolidation', 'Launching Phase 2 ASP', 'Early depl of surv elms / tk hunting parties ahead of the obj', 'F ech ASP: disposal / evac of cas, replenishment of ammo', 'DF and DF (SOS) to beat back his C attk / assy']),
                yoursA('en.ded.c.phases', 'Phases of Attk', 10, ['Size of obj, his disposn and pattern of depl: phases cfm']),
                yoursA('en.ded.c.arty', 'Use of Arty', 10, ['Soften up well prep defs with prep bombardment', 'Engage his ptls / LPs before the mov into the FUP']),
                yoursA('en.ded.c.engrs', 'Emp of Engrs', 10, ['Well prep defs, concrete bunkers, wire and mines: almt of engr elms to the aslt Pls', 'Lanes in his mine fd for the F ech up to the tgt']),
              ]),
            ]),
          ]),
          headOnly('own', 'Own Sit', [
            yoursA('own.comp', 'Composn and Disposn of Own Force', 11),
            para('own.str', 'Own Str as Related to that of En', { draft: '', table: { head: ['Ser', 'Arms', 'En', 'Own', 'Ratio'], rows: ['a.', 'b.', 'c.', 'd.'].map((s) => [s, '', '', '', '']) }, prompts: [MA(11)] }),
            para('own.tasks', 'Assessment of Tasks', { draft: '', table: { head: TASK_HEAD_ATTK, rows: taskRowsAttk() }, prompts: ['AP-1: tps for each task and phase', MA(11)] }),
            headOnly('own.ded', 'Deductions', [
              headOnly('own.ded.basic', 'Basic Deductions', [
                yoursA('own.ded.obj', 'Pri of Most Imp Tac Gr', 11, ['Resources vis-a-vis suitability of emp, imp of ITGs in his overall def plan and the cap to aloc sufficient tps for their capture: the pri stands cfm']),
                yoursA('own.ded.apch', 'Pri of Apchs', '11-12', ['Resources, own cap and optimum use of the resources altd: the pri stands cfm']),
                yoursA('own.ded.aps', 'Attk Possibilities', 12, ['Resources aval for the capture of different objs: the APs stand cfm or as modified in En Sit']),
                yoursA('own.ded.addl', 'Req of Addl Resources / Tps', 12, ['As per the assessment of tasks I req __ inf Sec, __ aslt pnr / engr Sec and __ armr Tp, where I have __: ask for addl resources from the Bn comd; if not provided, the almt of tps to task as per existing resources']),
              ]),
              headOnly('own.ded.common', 'Common Deductions', [
                yoursA('own.ded.c.hold', 'Asst / Coord with Holding Tps', 13, ['Activity all over the front and feint attk (if nec) from the opposite dir', 'Asst in estb of BOF', 'Info about his def, obs, lanes and gaps through the mine fd', 'Passage through lanes', 'Guidance arrangement', 'Protection of flanks']),
                yoursA('own.ded.c.bs', 'Emp of BS / RRs', 13, ['Initially as part of BOF at area __', 'Subsequently for str of my reorg in area __']),
                yoursA('own.ded.c.df', 'DF Plan', 13, ['A fd Bty aval in DS: exec my DF plan during reorg as deduced from Gr and Weather']),
                yoursA('own.ded.c.fwdwpn', 'Arrangements to Carry Fwd Wpns for BOF', 13),
                yoursA('own.ded.c.ammo', 'Task for Fol Up Pls to Carry Ammo for Initial Reorg of Phase 1', 13),
                yoursA('own.ded.c.nvd', 'Use of NVDs / GSRs', 13),
                yoursA('own.ded.c.engr', 'Use of Engrs / Aslt Pnrs', 13),
              ]),
            ]),
          ]),
          para('almt', 'Almt of Tps to Task', { draft: '', table: { head: TASK_HEAD_ATTK, rows: taskRowsAttk() }, prompts: ['As per the existing resources when addl tps are not provided; remarks under the table: who undertakes each task', MA('12-13')] }),
          headOnly('ts', 'Time and Space', [
            headOnly('ts.data', 'Time Data', [
              yoursA('ts.data.now', 'Time Now', 13),
              yoursA('ts.data.by', 'Msn to be Accomplished by', 13),
              yoursA('ts.data.total', 'Total Time in Hrs', 13),
              yoursA('ts.data.ni', 'Ni Hrs', 13),
              yoursA('ts.data.day', 'Day Hrs', 13),
            ]),
            para('ts.calc', 'Time Calc', {
              draft: '',
              table: { head: ['Ser', 'Events', 'Time Req', 'Running Time'], rows: BACKWARD_EVENTS.map((e, i) => [String(i + 1), e, '', '']), widths: [0.08, 0.5, 0.2, 0.22] },
              prompts: ['Task to be completed ASP: fwd calc of timings', 'Specified completion time: backward calc of timings', 'ASP and not later than a specified time: both', MA('13-14')],
            }),
            headOnly('ts.ded', 'Deductions', [
              headOnly('ts.ded.basic', 'Basic Deductions', [
                yoursA('ts.ded.obj', 'Pri of Most Imp Tac Gr', 14, ['The distr of timings permits the capture of the MITG and two imp tac grs in Phase 1: the pri stands cfm']),
                yoursA('ts.ded.apch', 'Pri of Apchs', '14-15', ['The apch that completes the asg tasks within the given time frame (shorter, no obs): the pri stands cfm']),
              ]),
              headOnly('ts.ded.common', 'Common Deductions', [
                yoursA('ts.ded.more', 'In Case More Time is Aval', 15, ['Recce of the obj area', 'Coord and rehearsal for attk fmns', 'Coord for fire sp with different echs', 'Stay in FAA', 'Battle drills and procedures']),
                yoursA('ts.ded.less', 'In Case Less Time is Aval', 15, ['Curtail: stay in FAA', 'Battle drill and procedure', 'Recce of the obj area']),
                yoursA('ts.ded.timings', 'Essential Timings', 15, ['Mov from Assy A to FAA __ hrs', 'Mov from FAA to FUP __ hrs', 'H hr __ hrs', 'A hr (not later than) __ hrs', 'Time by which BOF to be estb __ hrs', 'Time by which blocking posn to be estb __ hrs']),
              ]),
            ]),
          ]),
        ] },
      ],
    },
    {
      id: 'crs', title: 'COURSES',
      groups: [{ id: 'crs', title: null, paras: [
        yoursA('crs.a', 'Course A', '15-16', ['To capture / clear area __ with a Coy / Coy plus force using __ apch, keeping tks in CS / fire sp role, commencing the op at __ hrs in __ phases', 'Phase 1: capturing area __ and __ with a Pl and Pl / Pl plus using tks in CS / fire sp, FUP in area __ and BOF in area __, completing the phase in 45-60 mins', 'Phase 2: capturing __ with a Pl / Pl minus using tks in CS / fire sp, FUP in area __, BOF in area __, A hr at __, completing in 30-45 mins', 'Initial reorg of Phase 1 facing __; final reorg facing __ along __; BS and RRs in the BOF, then in area __ during the reorg to beat back his C attk', 'Rd / Tr __ as route for the F ech; DFs and DF (SOS) during the reorg; Coy HQ and Tac HQ in area __', 'If time is aval: loc of altn FUP / BOF, the blocking posn if tks are not in CS / fire sp, FAA, use of aslt pnr, feint attk']),
        headOnly('crs.react', 'En Reactions and Own Ctr Actions', [
          headOnly('crs.react.conc', 'During Mov from Conc Area / Assy A', [
            yoursA('crs.react.conc.air', 'Air Attk, Recce Msns and Aerial Recce', 16, ['Air alarm scheme during my mov at __ hrs from conc A to Assy A / FAA', 'Dispersion in Assy A and conc A', 'Cam and clt of the highest std', 'Tr discipline', 'Lt discipline']),
            yoursA('crs.react.conc.arty', 'Use of Long Range Arty', 16, ['Good cam and clt', 'Con dispersion', 'Tr discipline', 'Coord with own arty for CB']),
          ]),
          yoursA('crs.react.fup', 'During Mov from Assy A / FAA to FUP', 16, ['His speculative arty fire where there is no cover: well-dispersed mov in area __', 'Strict Tr discipline', 'Tks / vehs mov at the last possible time', 'HF to cover the tk noises']),
          yoursA('crs.react.occ', 'Occupation of FUP', 17, ['His DFs and spoiling attk by his SP loc at __: FUP protection by the depth Pl at the appropriate time', 'Strict Lt discipline, min possible Lts in the FUP', 'Mov steadily to the FUP, silent occupation under the cover of arty fire', 'Strict wrls silence', 'Smk with HE through the FOO / MFC', 'Spoiling attk: adv H or mov to the altn FUP in area __', 'Eff CB to silence his guns']),
          headOnly('crs.react.ph1', 'Phase 1', [
            yoursA('crs.react.ph1.readj', 'Readjustment of Posn by En', 17, ['Subj him to conc arty fire through my FSP already prep']),
            yoursA('crs.react.ph1.wpns', 'En Use of SA / A Tk Wpns', 17, ['Neutralise his wpn emplacements by covering fire till the aslt line, then the fire base at __ when the arty fire is lifted', 'Smk shells with HE to deny his obsn']),
            yoursA('crs.react.ph1.catk', 'Local C Attk by the En', 17, ['Subj his depth loc to arty fire through my FOO / MFC', 'Quick initial reorg; launch Phase 2 at __ with speed; engage __ and __ already mk as DFs']),
          ]),
          headOnly('crs.react.ph2', 'Phase 2', [
            yoursA('crs.react.ph2.catk', 'Local C Attk by En Res', 17, ['Quick completion of Phase 2 by __ hrs', 'F ech on the tgt ASP', 'Speedy reorg of Phase 2 by __ hrs', 'Quick readjustment of DF / DF (SOS)']),
            yoursA('crs.react.ph2.df', 'En Engagement of DF', '17-18', ['Ask for CB', 'Initial reorg __ yds plus of the obj in area __']),
            yoursA('crs.react.ph2.depth', 'Readjustment of Depth Loc', 18, ['Arty fire', 'Maint impetus']),
          ]),
          yoursA('crs.react.reorg', 'Final Reorg', 18, ['Speedy reorg ahead of the obj i.e. __ and __', 'Quick digging', 'Early arrival of the F ech by __ hrs through Rd / Tr __', 'Sel / readjustment of DF', 'Fwd ptls / OPs / LPs in area __', 'Obs in area __', 'Coord of def loc']),
        ]),
        headOnly('crs.an', 'Analysis', [
          yoursA('crs.an.adv', 'Advantages', 18, ['MITG captured in the 1st phase', 'Two objs captured in Phase 1', 'Main Rd cleared in Phase 1', 'Allows use of armr in CS', 'Ideal depl areas: FUP, BOF and FAA', 'Shorter apch', 'Dir keeping easy', 'Blocking posn before Phase 1', 'Res in both phases', 'Task completed within the time frame']),
          yoursA('crs.an.dis', 'Disadvantages', 18, ['Most obvious / expected apch', 'More obs between the FUP and the obj', 'Sharp reactions on the loss of the MITG in Phase 1', 'Going difficult: strongly held def in Phase 1']),
        ]),
        yoursA('crs.b', 'Course B', 19),
        yoursA('crs.adopted', 'Course Adopted with Reasons', 19, ['I decide to adopt Course __ for the reasons as under']),
      ] }],
    },
    {
      id: 'plan', title: 'PLAN',
      groups: [{ id: 'plan', title: null, paras: [
        yoursA('plan.msn', 'Msn', 19, ['Capture area __ by __ hrs __']),
        headOnly('plan.exec', 'Exec', [
          yoursA('plan.exec.outline', 'Gen Outline', 19, ['Anx P: attk from Lt / Rt in two phases', 'Phase 1: capture __, __ with a Pl / Pl plus each, sp by a Tp of tks in CS / FSP', 'Phase 2: capture area __ with a Pl with tks in CS / FSP']),
          headOnly('plan.exec.pl1', 'No 1 Pl', [
            yoursA('plan.exec.pl1.grp', 'Grouping', 19, ['Under comd: a Tp of tks (Phase 1 only, if altd)', 'FOO', 'MFC', 'In loc: RRs etc (during reorg)']),
            yoursA('plan.exec.pl1.task', 'Task', 19, ['Every task it is asg in all the phases, phase-wise', 'Capture area __ in Phase 1 by __ hrs; completion (codeword)', 'In Phase 2 be prep to asst No 3 Pl in the capture of area __ on orders', 'Finally reorg along __ facing __', 'Guidance in the FUP; protect the FUP in area __; a Sec for the blocking posn; LP / SP / tk hunting ptl during reorg']),
          ]),
          yoursA('plan.exec.pl2', 'No 2 Pl', 20),
          yoursA('plan.exec.pl3', 'No 3 Pl', 20),
          yoursA('plan.exec.mor', 'Bn Mors', 20, ['MFC (one each) to each aslt Pl', 'Fire sp as per the FSP (att as anx __)', 'Mk __ as DFs and DF (SOS)']),
          yoursA('plan.exec.pnr', 'Sec Aslt Pnr', 20, ['Under comd No __ Pl in Phase 1', 'Clear Rd / Tr __ for the mov of the F ech']),
          yoursA('plan.exec.armr', 'Armr', 20, ['Fire sp from the BOF in area __', 'Estb blocking posn in area __ at __ hrs', 'Asst in reorg by covering area __']),
          headOnly('plan.exec.coord', 'Coord Instrs', [
            yoursA('plan.exec.coord.timings', 'Timings', 20, ['Mov from Assy A / FAA __', 'H hr __', 'A hr __', 'BOF to be estb by __', 'Blocking posn to be estb by __']),
            yoursA('plan.exec.coord.loc', 'Loc', 20, ['FAA __', 'BOF __', 'FUP __', 'Blocking posn __']),
          ]),
        ]),
        headOnly('plan.adm', 'Adm and Log', [yoursA('plan.adm.food', 'Food', 20), yoursA('plan.adm.ammo', 'Ammo', 20), yoursA('plan.adm.water', 'Water', 20), yoursA('plan.adm.cap', 'CAP', 21)]),
        headOnly('plan.comd', 'Comd and Sig', [
          yoursA('plan.comd.hq', 'Loc of Coy HQ', 21),
          yoursA('plan.comd.tac', 'Loc of Coy Tac HQ', 21),
          yoursA('plan.comd.sig', 'Sig for Breaking the Wrls Silence', 21),
          yoursA('plan.comd.code', 'List of Code Words / Nick Names', 21, ['Being issued separately']),
        ]),
      ] }],
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

/** The kinds with an outline, and those that have a place but no outline yet. */
export function aprcKinds(): Array<{ kind: AprcKind; label: string; ready: boolean }> {
  return [
    { kind: 'def', label: OUTLINES.def?.label ?? 'Defence', ready: !!OUTLINES.def },
    { kind: 'attk', label: OUTLINES.attk?.label ?? 'Attack', ready: !!OUTLINES.attk },
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

/** Set drafts. A patch for an id the outline does not hold is skipped. The planner's words are untouched. */
export function applyPatches(doc: AprcDoc, patches: AprcPatch[]): number {
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
  }
  return n;
}

/** Bring the planner's words and acceptances from an earlier document into a newly read one (by paragraph id). */
export function carryOver(prev: AprcDoc | null, next: AprcDoc): AprcDoc {
  if (!prev) return next;
  const keep = new Map<string, { mine?: AprcMine; accepted?: boolean; cells?: Record<string, string>; addRows?: number }>();
  walk(prev, (p) => {
    if (p.mine || p.accepted || p.cells || p.addRows) keep.set(p.id, { mine: p.mine, accepted: p.accepted, cells: p.cells, addRows: p.addRows });
  });
  walk(next, (p) => {
    const k = keep.get(p.id);
    if (!k) return;
    if (k.mine) p.mine = k.mine;
    if (p.table && k.cells) p.cells = k.cells;
    if (p.table && k.addRows) p.addRows = k.addRows;
    // An acceptance holds only while the proposal is the one that was accepted.
    if (k.accepted && p.state === 'judge') p.accepted = true;
  });
  return next;
}

/** The planner writes a paragraph (empty text gives it back to the tool). */
export function setMine(doc: AprcDoc, id: string, text: string | null, at = new Date().toISOString()): boolean {
  const p = find(doc, id);
  if (!p) return false;
  const t = (text ?? '').trim();
  if (!t) delete p.mine;
  else p.mine = { text: t, draftHash: hash(p.draft ?? ''), at };
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
  const rows: string[][] = [];
  for (let r = 0; r < n; r++) {
    const base = t.rows[r] ?? t.head.map(() => '');
    rows.push(t.head.map((_, c) => {
      const mine = p.cells?.[`${r},${c}`];
      if (mine !== undefined) return mine;
      const d = base[c] ?? '';
      return hide && c > 0 ? '' : d;
    }));
  }
  return { head: t.head, rows, widths: t.widths };
}

/** The planner types into a cell (null gives it back to the tool). */
export function setCell(doc: AprcDoc, id: string, r: number, c: number, text: string | null): boolean {
  const p = find(doc, id);
  if (!p?.table || c < 0 || c >= p.table.head.length || r < 0 || r >= p.table.rows.length + (p.addRows ?? 0)) return false;
  const cells = { ...(p.cells ?? {}) };
  if (text === null) delete cells[`${r},${c}`];
  else cells[`${r},${c}`] = text.trim();
  p.cells = Object.keys(cells).length ? cells : undefined;
  return true;
}

/** Add an empty row under the table (or take the last added one away). */
export function addRow(doc: AprcDoc, id: string, n = 1): boolean {
  const p = find(doc, id);
  if (!p?.table) return false;
  const next = Math.max(0, (p.addRows ?? 0) + n);
  if (n < 0 && p.cells) {
    const last = p.table.rows.length + next;
    for (const k of Object.keys(p.cells)) if (Number(k.split(',')[0]) >= last) delete p.cells[k];
  }
  p.addRows = next || undefined;
  return true;
}

/** The draft under the planner's words has changed since he wrote them. */
export const isStale = (p: AprcPara): boolean => !!p.mine && p.draft !== null && hash(p.draft) !== p.mine.draftHash;

// ── reading it out ───────────────────────────────────────────────────────────────────────────────────────────────

export type AprcMark = 'GR' | 'MAP' | 'YOU JUDGE' | 'YOURS' | 'WRITTEN';

export interface AprcShown {
  /** The words to print after the heading; '' for a heading only; null for a ruled line. */
  text: string | null;
  mark: AprcMark;
  /** A proposal shown but not yet accepted (draft copy only). */
  proposal: boolean;
  stale: boolean;
}

/** What a paragraph prints in a copy. */
export function shown(p: AprcPara, copy: AprcCopy): AprcShown {
  if (p.mine) return { text: p.mine.text, mark: 'WRITTEN', proposal: false, stale: isStale(p) };
  if (p.draft === null) return { text: null, mark: 'YOURS', proposal: false, stale: false };
  if (p.draft === '') return { text: '', mark: p.state === 'gr' ? 'GR' : p.state === 'map' ? 'MAP' : p.state === 'judge' ? 'YOU JUDGE' : 'YOURS', proposal: false, stale: false };
  if (p.state === 'judge' && !p.accepted) return copy === 'fair' ? { text: null, mark: 'YOU JUDGE', proposal: false, stale: false } : { text: p.draft, mark: 'YOU JUDGE', proposal: true, stale: false };
  return { text: p.draft, mark: p.state === 'gr' ? 'GR' : p.state === 'map' ? 'MAP' : p.state === 'judge' ? 'YOU JUDGE' : 'YOURS', proposal: false, stale: false };
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
}

/** Paragraphs by state (headings without words of their own are not counted). */
export function counts(doc: AprcDoc): AprcCounts {
  const c: AprcCounts = { gr: 0, map: 0, judge: 0, yours: 0, written: 0, stale: 0, open: 0 };
  walk(doc, (p) => {
    if (p.mine) {
      c.written++;
      if (isStale(p)) c.stale++;
      return;
    }
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
      const mark = copy === 'draft' && (s.text !== '' || l.p.table) ? ` [${s.proposal ? 'PROPOSAL' : s.mark}${s.stale ? ', Gr changed since' : ''}]` : '';
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
