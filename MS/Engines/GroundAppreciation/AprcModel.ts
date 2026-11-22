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
 *   - the outline is chosen by kind: `def` is built; `attk` has its place and is registered when its specimen comes.
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

const OUTLINES: Partial<Record<AprcKind, { label: string; build: () => AprcPart[] }>> = { def: { label: 'Defence', build: outlineDef } };

/** Add an outline for a kind of appreciation (the attack, when its specimen is to hand). */
export function registerOutline(kind: AprcKind, label: string, build: () => AprcPart[]): void {
  OUTLINES[kind] = { label, build };
}
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
  const keep = new Map<string, { mine?: AprcMine; accepted?: boolean; table?: AprcTable }>();
  walk(prev, (p) => {
    if (p.mine || p.accepted) keep.set(p.id, { mine: p.mine, accepted: p.accepted });
  });
  walk(next, (p) => {
    const k = keep.get(p.id);
    if (!k) return;
    if (k.mine) p.mine = k.mine;
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
    if (p.state === 'judge' && !p.accepted && !p.mine && p.draft) {
      p.accepted = true;
      n++;
    }
  });
  return n;
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
    if (p.state === 'judge' && p.draft && !p.accepted) c.open++;
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
      if (l.p.table) {
        L.push(`${pad}   ${l.p.table.head.join(' | ')}`);
        for (const r of l.p.table.rows) L.push(`${pad}   ${r.map((c) => c || '____').join(' | ')}`);
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
