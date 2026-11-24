/**
 * AprcDeck.ts
 *
 * The appreciation as slides for the Briefing module (pure: it returns plain `Slide` objects; the engine hands them to
 * BriefingEngine.importBriefing). Screen-only slides (a page with text, tables, shapes and the trace as overlays), so they
 * need no map and export to PowerPoint with native text and tables.
 *
 *   full      a cover, a section slide before each group of two or more paragraphs, then each paragraph that has words;
 *   decision  the short brief: aim, approaches, deductions, his options, relative strength, courses, the plan, confirm;
 *   sand      the orientation order of a sand model: gen description, approaches one by one, ITGs, obs, cover, lines.
 *
 * Look (user, 22 Nov 2026: style B "Ops room" of ground-appreciation-slides-options.html): dark slides for a dim command
 * post or a projector; one frame on every slide (section and para at the head, the title, Draft, the deck, a notes mark
 * and the slide number at the foot); short points at a readable size with the whole paragraph in the speaker notes;
 * light-ruled tables; pictures where they say more (the going as a bar, the lines of def as a depth ladder, strength as
 * paired bars, the trace on the apch slides); proposals tagged in the draft copy, left out of the fair copy.
 *
 * Each slide carries `sourceRef` (aprc:<paragraph id>) and `sourceHash` (its content as made). On a refresh a slide the
 * user has edited (its content no longer matches the hash) is kept; the others are replaced (`mergeDeck`).
 */

import type { Slide, SlideComment, SlideOverlay } from '../Briefing/BriefingTypes';
import { hash, lines, numberOf, shown, tableOf, type AprcCopy, type AprcDoc, type AprcFigure, type AprcGroup, type AprcPara, type AprcPart, type AprcTable } from './AprcModel';

export type AprcDeckKind = 'full' | 'decision' | 'sand';
export const APRC_DECKS: Array<{ kind: AprcDeckKind; label: string; note: string }> = [
  { kind: 'full', label: 'Full brief', note: 'a slide or more for each paragraph with words' },
  { kind: 'decision', label: 'Decision brief', note: 'aim, apchs, deductions, En options, relative str, courses, plan, confirm' },
  { kind: 'sand', label: 'Sand model', note: 'orientation order: gen description, apchs, ITGs, obs, cover, lines of def' },
];

/** A picture for the slides (PNG data URL and its pixel size). */
export interface DeckMap {
  png: string;
  w: number;
  h: number;
}

export interface DeckOptions {
  kind: AprcDeckKind;
  copy: AprcCopy;
  /** The page as a data URL (the engine paints it in the deck's background colour; a screen-only slide needs one). */
  blankBg: string;
  thumb?: string;
  transitionMs?: number;
  /**
   * The trace for the slides, drawn for them (dark): the whole AOR, and one per apch keyed by its paragraph's side
   * (Lt / Cen / Rt) showing that apch alone. Absent: the document's own trace.
   */
  maps?: { all?: DeckMap | null; apch?: Record<string, DeckMap> };
  /** Section slides before each group of two or more slides (full brief only). Default true. */
  sections?: boolean;
}

/** The Ops room style. Font: Segoe UI (the export keeps native text, so the font must be on the PC that opens it). */
export const DECK_THEME = {
  bg: '#121820', ink: '#eef2f6', dim: '#9ba7b3', line: '#2b3540', strong: '#4b5866', panel: '#1b2530', acc: '#8ec1ea', accInk: '#0d1620',
  warn: '#ff8a8d', prop: '#ffd27a', propBg: '#3a3320', en: '#ff7b72', own: '#79b8ff', go: '#2f9e5f', slow: '#e8862a', nogo: '#d8434a',
  font: 'Segoe UI',
} as const;
const T = DECK_THEME;

const REF = 'aprc:';
/** The paragraphs each short deck takes, by kind of appreciation; an id may be a sub-paragraph (the attack's En Sit, Own Sit). */
export const DECK_IDS: Record<string, { decision: string[]; sand: string[] }> = {
  def: {
    decision: ['aim', 'gr.apchs', 'gr.ded', 'en.opts', 'own.str', 'crs.a', 'crs.react', 'crs.an', 'crs.adopted', 'plan.exec'],
    sand: ['gr.gen', 'gr.apchs', 'gr.itg', 'gr.obs', 'gr.cover', 'gr.ded'],
  },
  attk: {
    decision: ['aim', 'gr.apchs', 'gr.ded', 'en.opts', 'en.ded', 'own.str', 'own.tasks', 'ts.calc', 'crs.a', 'crs.react', 'crs.an', 'crs.adopted', 'plan.exec'],
    sand: ['gr.gen', 'gr.itg', 'gr.apchs', 'gr.obs', 'gr.cover', 'gr.ded'],
  },
};

let seq = 0;
const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// ── the slide grid (fractions of the slide; font sizes are fractions of its height) ──────────────────────────────────
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const X0 = 0.05, WIDE = 0.9, BOTTOM = 0.89;
const FS = { sec: 0.022, title: 0.058, sub: 0.029, body: 0.031, small: 0.023, foot: 0.019, table: 0.024, pill: 0.018 };
/** Characters a line of a box holds at a font size (a 16 : 9 slide; an average glyph about half the size). */
const perLine = (w: number, fs: number): number => Math.max(8, Math.floor((w * 16) / (fs * 9 * 0.52)));
const lineH = (fs: number): number => fs * 1.55;

const text = (value: string, box: Box, extra: Partial<SlideOverlay> = {}): SlideOverlay => ({ id: uid('ap'), kind: 'text', ...box, text: value, fontFamily: T.font, fontSize: FS.body, textColor: T.ink, align: 'left', ...extra });
const rect = (box: Box, fill: string, extra: Partial<SlideOverlay> = {}): SlideOverlay => ({ id: uid('ap'), kind: 'rect', ...box, fill, fillOpacity: 1, stroke: fill, strokeWidth: 0.0008, ...extra });
const hline = (x0: number, x1: number, y: number, stroke: string, width: number, dash?: 'dashed' | 'dotted'): SlideOverlay => ({
  id: uid('ap'), kind: 'line', x: x0, y, w: x1 - x0, h: 0.001, points: [{ x: x0, y }, { x: x1, y }], stroke, strokeWidth: width, ...(dash ? { strokeDash: dash } : {}),
});
const pill = (label: string, box: Box, fill: string = T.propBg, ink: string = T.prop): SlideOverlay[] => [
  rect(box, fill),
  text(label, { x: box.x, y: box.y + box.h * 0.14, w: box.w, h: box.h * 0.8 }, { fontSize: FS.pill, bold: true, textColor: ink, align: 'center' }),
];

/** Fit a picture into a box keeping its shape (the slide is 16 : 9). */
function imageBox(f: DeckMap | AprcFigure, box: Box): Box {
  const boxAspect = (box.w * 16) / (box.h * 9), a = f.w / Math.max(1, f.h);
  if (a >= boxAspect) {
    const h = (box.w * 16) / 9 / a;
    return { x: box.x, y: box.y, w: box.w, h };
  }
  const w = (box.h * 9 * a) / 16;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
}
const picture = (m: DeckMap, box: Box): SlideOverlay => ({ id: uid('ap'), kind: 'image', ...imageBox(m, box), src: m.png });

/** What a slide is made of, for the "edited since" test. */
export function slideHash(s: Pick<Slide, 'title' | 'notes' | 'overlays'>): string {
  const o = (s.overlays ?? []).map((v) => ({ k: v.kind, x: v.x, y: v.y, w: v.w, h: v.h, t: v.text ?? '', r: v.rows ?? null, n: v.src ? v.src.length : 0 }));
  return hash(JSON.stringify([s.title, s.notes ?? '', o]));
}

/** A table that is the book's skeleton only (its row names, nothing drafted or typed) is not words of its own. */
function filledTable(p: AprcPara, copy: AprcCopy): AprcTable | null {
  const tb = tableOf(p, copy);
  const filled = p.state !== 'yours' || !!p.cells || !!p.addRows;
  return tb && filled && tb.rows.some((r) => r.slice(1).some((c) => c.trim())) ? tb : null;
}

function hasWords(p: AprcPara, copy: AprcCopy): boolean {
  if (shown(p, copy).text) return true;
  if (filledTable(p, copy)) return true;
  return p.children.some((c) => hasWords(c, copy));
}

// ── the words: a paragraph and its sub-paragraphs as points (for the slide) and as labelled lines (for the notes) ─────
interface Row {
  text: string;
  depth: number;
}
/** The paragraph in full, as it prints (for the speaker notes). */
function rowsOf(doc: AprcDoc, p: AprcPara, copy: AprcCopy): Row[] {
  const out: Row[] = [];
  let base = -1;
  for (const l of lines(doc)) {
    if (l.type !== 'para') {
      if (base >= 0) break;
      continue;
    }
    if (base < 0) {
      if (l.p.id !== p.id) continue;
      base = l.depth;
    } else if (l.depth <= base) break;
    const s = shown(l.p, copy);
    if (s.text === null) continue;
    if (s.text === '' && !hasWords(l.p, copy)) continue;
    const head = l.p.head ? `${l.p.head}${s.text ? '. ' : ''}` : '';
    const lab = l.depth === base ? '' : `${l.label} `;
    out.push({ text: `${lab}${head}${s.text}${s.proposal ? '  (proposal)' : ''}`.trim(), depth: l.depth - base });
  }
  return out;
}

interface Pt {
  text: string;
  depth: number;
  prop: boolean;
}
/** Sentence ends: a full stop before a capital, a figure or a bracket (figures like "2.3 km" carry no space). */
const sentences = (t: string): string[] => {
  const out: string[] = [];
  for (const s of t.split(/(?<=[.?!])\s+(?=[A-Z0-9(])/).map((x) => x.trim()).filter(Boolean)) {
    // a sentence of a few words ("Canal plains.") rides with the next
    if (out.length && out[out.length - 1].length < 28) out[out.length - 1] += ` ${s}`;
    else out.push(s);
  }
  return out;
};
/**
 * A paragraph's words as points. The tool's draft: a sentence a point, and a long sentence of clauses split at its
 * semicolons under its first. The planner's own words: split by sentence only, never shortened.
 */
function pointsOfText(t: string, depth: number, prop: boolean, lead: string, mine: boolean): Pt[] {
  const out: Pt[] = [];
  sentences(t).forEach((s, i) => {
    const d = lead && i > 0 ? depth + 1 : depth;
    const line = i === 0 && lead ? `${lead}: ${s}` : s;
    if (!mine && line.length > 170 && line.includes('; ')) {
      const [first, ...rest] = line.split('; ');
      out.push({ text: first, depth: d, prop });
      for (const c of rest) out.push({ text: c, depth: d + 1, prop });
    } else out.push({ text: line, depth: d, prop });
  });
  return out;
}
/** A paragraph (its own words unless `skipSelf`) and its sub-paragraphs as points; a heading without words names its sub-paragraphs. */
function pointsOf(p: AprcPara, copy: AprcCopy, skipSelf = false): Pt[] {
  const out: Pt[] = [];
  const go = (q: AprcPara, depth: number, ctx: string): void => {
    const s = shown(q, copy);
    if (s.text === null) return;
    const head = q === p ? '' : q.head ?? '';
    const lead = [ctx, head].filter(Boolean).join(' · ');
    if (s.text) out.push(...pointsOfText(s.text, depth, s.proposal, lead, !!q.mine));
    const next = s.text ? depth + 1 : depth;
    q.children.forEach((c) => go(c, next, s.text ? '' : head || ctx));
  };
  if (skipSelf) p.children.forEach((c) => go(c, 0, ''));
  else go(p, 0, '');
  return out;
}
const ptsText = (pts: Pt[]): string => pts.map((r) => `${'  '.repeat(r.depth)}${r.text}`).join('\n');
const linesOf = (pts: Pt[], w: number, fs: number): number => pts.reduce((a, r) => a + Math.max(1, Math.ceil((r.text.length + r.depth * 4 + 3) / perLine(w, fs))), 0);

/** Points over slides: the facts first, then the proposals under their own tag. */
function pointPages(pts: Pt[], box: Box, fs: number): Array<{ facts: Pt[]; props: Pt[] }> {
  const budget = Math.max(3, Math.floor(box.h / lineH(fs)));
  const pages: Array<{ facts: Pt[]; props: Pt[] }> = [];
  let cur = { facts: [] as Pt[], props: [] as Pt[] }, used = 0;
  const seq2 = [...pts.filter((r) => !r.prop), ...pts.filter((r) => r.prop)];
  for (const r of seq2) {
    const need = linesOf([r], box.w, fs) + (r.prop && !cur.props.length && cur.facts.length ? 1.6 : 0);
    if (used + need > budget && (cur.facts.length || cur.props.length)) {
      pages.push(cur);
      cur = { facts: [], props: [] };
      used = 0;
    }
    (r.prop ? cur.props : cur.facts).push(r);
    used += need;
  }
  if (cur.facts.length || cur.props.length) pages.push(cur);
  return pages;
}
function pointOverlays(page: { facts: Pt[]; props: Pt[] }, box: Box, fs: number): SlideOverlay[] {
  const ov: SlideOverlay[] = [];
  let y = box.y;
  const block = (pts: Pt[]) => {
    const h = Math.min(box.y + box.h - y, linesOf(pts, box.w, fs) * lineH(fs) + fs * 0.4);
    ov.push(text(ptsText(pts), { x: box.x, y, w: box.w, h }, { fontSize: fs, listStyle: 'bullet', lineSpacing: 1.3 }));
    y += h + fs * 0.5;
  };
  if (page.facts.length) block(page.facts);
  if (page.props.length) {
    if (page.facts.length) {
      ov.push(...pill('Proposals', { x: box.x, y, w: 0.1, h: 0.036 }));
      y += 0.052;
    }
    block(page.props);
  }
  return ov;
}

// ── tables ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A dark table sized to its words: rows that say nothing past their first cell are left out. */
function tableOverlay(t: { head: string[] | null; rows: string[][]; widths?: number[] }, box: Box, fs = FS.table): SlideOverlay {
  const n = (t.head ?? t.rows[0] ?? []).length || 1;
  const widths = t.widths?.length === n ? t.widths : new Array(n).fill(1 / n);
  const all = t.head ? [t.head, ...t.rows] : t.rows;
  const hs = all.map((r) => Math.max(1, ...r.map((c, i) => Math.ceil((String(c).length + 1) / perLine(box.w * widths[i] - 0.012, fs)))) * lineH(fs) + fs * 0.75);
  const sum = hs.reduce((a, b) => a + b, 0);
  const h = Math.min(box.h, sum);
  return {
    id: uid('ap'), kind: 'table', x: box.x, y: box.y, w: box.w, h, rows: all, headerRow: !!t.head, headerFill: T.panel,
    fill: T.bg, fillOpacity: 1, stroke: T.line, strokeWidth: 0.0012, textColor: T.ink, fontSize: fs, colWidths: widths, rowHeights: hs.map((x) => x / sum), fontFamily: T.font,
  };
}
const liveRows = (tb: AprcTable): string[][] => tb.rows.filter((r) => r.slice(1).some((c) => c.trim()));

// ── the deck ────────────────────────────────────────────────────────────────────────────────────────────────────────
const cap = (s: string): string => (s ? s[0] + s.slice(1).toLowerCase() : s);
const words = (s: string): string => (s === s.toUpperCase() ? s.toLowerCase().split(' ').map((w, i) => (i > 0 && ['of', 'and', 'the', 'to', 'in', 'on'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ') : s);
const flip = (s: string): string => (s === 'Lt' ? 'Rt' : s === 'Rt' ? 'Lt' : s);

/** The slides of a deck kind, in order. */
export function buildDeck(doc: AprcDoc, o: DeckOptions): Slide[] {
  type S = Slide & { sourceRef?: string; sourceHash?: string };
  const out: S[] = [];
  const copy = o.copy, draft = copy === 'draft';
  const fr = doc.frame;
  const traceFig = doc.figures.find((f) => f.id === 'trace' && f.png) ?? null;
  const mapAll: DeckMap | null = o.maps?.all ?? (traceFig ? { png: traceFig.png!, w: traceFig.w, h: traceFig.h } : null);
  const mapOf = (side: string): DeckMap | null => o.maps?.apch?.[side] ?? mapAll;
  const deckWord = `Aprc · ${doc.kind === 'attk' ? 'Attk' : 'Def'}${fr ? ` · ${fr.echelon} · ${fr.place}` : ''}`;
  const sectionOf = (part: AprcPart, group: AprcGroup): string => (group.title ? `${cap(part.title)}: ${group.title}` : cap(part.title));
  const notesOf = (p: AprcPara): string => rowsOf(doc, p, copy).map((r) => `${'  '.repeat(r.depth)}${r.text}`).join('\n');
  const numberOfP = (p: AprcPara): string => numberOf(doc, p.id);

  const mk = (ref: string, ttl: string, section: string, overlays: SlideOverlay[], notes = '', comments: SlideComment[] = []): void => {
    out.push({
      id: uid('aprc'),
      title: ttl,
      notes: notes || undefined,
      view: { capturedIn: '2d' },
      visibleLayers: {},
      transitionMs: o.transitionMs ?? 600,
      section: section || undefined,
      backgroundDataUrl: o.blankBg,
      thumbnailDataUrl: o.thumb ?? o.blankBg,
      overlays,
      comments: comments.length ? comments : undefined,
      sourceRef: `${REF}${ref}`,
    });
  };

  /** The head every content slide shares; returns where its body starts. */
  const head = (sec: string, para: string, ttl: string, sub = '', tag = false): { ov: SlideOverlay[]; top: number } => {
    const ov: SlideOverlay[] = [text(sec.replace(': ', ' · '), { x: X0, y: 0.05, w: 0.6, h: 0.036 }, { fontSize: FS.sec, textColor: T.dim })];
    const right = tag && draft ? 0.845 : X0 + WIDE;
    if (para) ov.push(text(para, { x: right - 0.2, y: 0.05, w: 0.2, h: 0.036 }, { fontSize: FS.sec, textColor: T.acc, bold: true, align: 'right' }));
    if (tag && draft) ov.push(...pill('Proposal', { x: 0.86, y: 0.047, w: 0.09, h: 0.038 }));
    ov.push(text(ttl, { x: X0, y: 0.088, w: WIDE, h: 0.08 }, { fontSize: ttl.length > 44 ? 0.047 : FS.title, bold: true }));
    let y = 0.178;
    if (sub) {
      ov.push(text(sub, { x: X0, y: 0.168, w: WIDE, h: 0.05 }, { fontSize: FS.sub, textColor: T.dim }));
      y = 0.228;
    }
    ov.push(rect({ x: X0, y, w: 0.05, h: 0.0056 }, T.acc));
    return { ov, top: y + 0.04 };
  };
  /** The foot every slide shares; the slide number is filled in once the deck is made. */
  const foot = (notes: boolean): SlideOverlay[] => {
    const ov: SlideOverlay[] = [];
    let x = X0;
    if (draft) {
      ov.push(rect({ x, y: 0.926, w: 0.052, h: 0.034 }, T.bg, { stroke: T.dim, strokeWidth: 0.0016 }), text('Draft', { x, y: 0.931, w: 0.052, h: 0.03 }, { fontSize: FS.foot, bold: true, textColor: T.dim, align: 'center' }));
      x += 0.065;
    }
    ov.push(text(deckWord, { x, y: 0.931, w: 0.4, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim }));
    if (notes) ov.push(text('Para in full in the notes', { x: 0.5, y: 0.931, w: 0.3, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim }));
    ov.push({ ...text('', { x: 0.8, y: 0.931, w: 0.15, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim, align: 'right' }), id: uid('apno') });
    return ov;
  };
  /** Points slides for words, paged; `extra` lays a picture or a block beside them on the first page. */
  const pointsSlides = (ref: string, ttl: string, section: string, para: string, pts: Pt[], notes: string, sub = ''): void => {
    if (!pts.length) return;
    const allProp = pts.every((r) => r.prop);
    const probe = head(section, para, ttl, sub, allProp);
    const box = { x: X0, y: probe.top, w: WIDE, h: BOTTOM - probe.top };
    pointPages(pts, box, FS.body).forEach((pg, i) => {
      const t2 = i ? `${ttl} (cont)` : ttl;
      const h = head(section, para, t2, i ? '' : sub, allProp);
      const b2 = { ...box, y: h.top, h: BOTTOM - h.top };
      mk(i ? `${ref}#${i}` : ref, t2, section, [...h.ov, ...pointOverlays(allProp ? { facts: pg.props, props: [] } : pg, b2, FS.body), ...foot(!!notes)], i ? '' : notes);
    });
  };
  /** Table slides, eight rows a slide. */
  const tableSlides = (ref: string, ttl: string, section: string, para: string, tb: AprcTable, notes: string, prop: boolean): void => {
    const rows = liveRows(tb);
    for (let i = 0; i < rows.length; i += 8) {
      const t2 = i ? `${ttl} (cont)` : ttl;
      const h = head(section, para, t2, '', prop);
      mk(i ? `${ref}#t${i / 8}` : ref, t2, section, [...h.ov, tableOverlay({ head: tb.head, rows: rows.slice(i, i + 8), widths: tb.widths }, { x: X0, y: h.top, w: WIDE, h: BOTTOM - h.top }), ...foot(!!notes)], i ? '' : notes);
    }
  };

  // ── cover ──
  {
    const ov: SlideOverlay[] = [
      text(`${fr ? `${fr.echelon} ` : ''}${doc.kind === 'attk' ? 'Attk' : 'Def'}`, { x: 0.07, y: 0.24, w: 0.5, h: 0.045 }, { fontSize: 0.03, bold: true, textColor: T.acc }),
      text(doc.title, { x: 0.07, y: 0.29, w: 0.55, h: 0.16 }, { fontSize: 0.095, bold: true }),
      text(fr ? `${fr.place} · ${fr.mover} · ${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'}` : 'Not read yet', { x: 0.07, y: 0.46, w: 0.55, h: 0.06 }, { fontSize: 0.038, textColor: T.dim }),
    ];
    if (fr) {
      ov.push(text('AOR\nThreat\nRead', { x: 0.07, y: 0.58, w: 0.1, h: 0.15 }, { fontSize: 0.025, bold: true, textColor: T.dim, lineSpacing: 1.35 }));
      ov.push(text(`${fr.aor}\n${fr.threat}\n${fr.readAt}`, { x: 0.17, y: 0.58, w: 0.42, h: 0.15 }, { fontSize: 0.025, lineSpacing: 1.35 }));
    }
    if (mapAll) ov.push(picture(mapAll, { x: 0.63, y: 0.17, w: 0.32, h: 0.64 }));
    mk('title', doc.title, '', [...ov, ...foot(false)]);
  }

  const ids = DECK_IDS[doc.kind] ?? DECK_IDS.def;
  const want = (id: string): boolean => o.kind === 'full' || (o.kind === 'decision' ? ids.decision : ids.sand).includes(id);
  /** The paragraphs a deck takes in a group: the top-level ones it wants, else the first it wants under each. */
  const units = (paras: AprcPara[]): AprcPara[] => {
    const res: AprcPara[] = [];
    const go = (p: AprcPara): void => {
      if (want(p.id)) res.push(p);
      else p.children.forEach(go);
    };
    paras.forEach(go);
    return res;
  };
  // A heading that two paragraphs share ("Deductions") is told apart by its group.
  const headCount = new Map<string, number>();
  for (const part of doc.parts) for (const g of part.groups) for (const p of g.paras) if (p.head) headCount.set(p.head, (headCount.get(p.head) ?? 0) + 1);

  for (const part of doc.parts) for (const group of part.groups) {
    const list = units(group.paras).filter((p) => hasWords(p, copy));
    if (!list.length) continue;
    const section = sectionOf(part, group);
    const start = out.length;

    for (const p of list) {
      const base = p.head ?? words(part.title);
      const ttl = p.head && (headCount.get(p.head) ?? 0) > 1 ? `${p.head}: ${group.title ?? words(part.title)}` : base;
      const para = `Para ${numberOfP(p)}`;
      const notes = notesOf(p);
      const s = shown(p, copy);

      // Apchs: the trace beside a table that compares them, then a slide each
      if (p.id === 'gr.apchs' && p.children.length) {
        const get = (a: AprcPara, k: string): string => {
          const c = a.children.find((q) => q.id.endsWith(`.${k}`));
          return (c ? shown(c, copy).text : null) ?? '';
        };
        const apchs = p.children.filter((a) => hasWords(a, copy));
        const rows = apchs.map((a) => {
          const len = get(a, 'length'), capy = get(a, 'capacity'), obs = get(a, 'obs');
          return [
            (a.head ?? '').replace(/ Apch$/, ''),
            len.match(/([\d.]+ km) past the front/)?.[1] ?? len.split(';')[0].replace(/\.$/, ''),
            capy.match(/[\d.]+ km/)?.[0] ?? capy.split(':')[0].replace(/\.$/, ''),
            obs.split(';')[0].replace(/ \([^)]*\)/g, '').replace(/\.$/, ''),
          ];
        });
        const need = apchs.map((a) => ({ c: get(a, 'capacity') }));
        const rule = need.map((x) => x.c.match(/less than the ([\d.]+ km) an? (\w+) needs/)).find(Boolean);
        const lead = (s.text ?? '').replace(/\.$/, '');
        const h = head(section, para, ttl, lead);
        const ov = [...h.ov];
        if (mapAll) ov.push(picture(mapAll, { x: X0, y: h.top, w: 0.44, h: BOTTOM - h.top }));
        const tx = mapAll ? 0.52 : X0, tw = mapAll ? 0.43 : WIDE;
        const tbl = tableOverlay({ head: ['Apch', 'Past the front', 'Narrowest', 'First obstacle'], rows, widths: [0.16, 0.24, 0.2, 0.4] }, { x: tx, y: h.top, w: tw, h: 0.5 }, 0.026);
        ov.push(tbl);
        if (rule) ov.push(text(`Narrowest: between NO-GO areas. A ${rule[2]} needs ${rule[1]}; ${need.filter((x) => /less than/.test(x.c)).length} of ${rows.length} apchs are narrower.`, { x: tx, y: h.top + tbl.h + 0.025, w: tw, h: 0.1 }, { fontSize: FS.small, textColor: T.dim }));
        mk(p.id, ttl, section, [...ov, ...foot(true)], notes);
        if (o.kind !== 'decision') {
          for (const a of p.children) {
            if (!hasWords(a, copy)) continue;
            const side = (a.head ?? '').split(' ')[0];
            const kids = a.children.map((c) => ({ head: c.head ?? '', t: shown(c, copy).text ?? '' })).filter((c) => c.t);
            const def = kids.find((c) => /^Definition$/i.test(c.head))?.t ?? '';
            const m = def.match(/Originates from (.+?), passes through (.+?) and terminates at (.+?)\.?$/);
            let route = '';
            if (m) {
              const thru = m[2].split(', ').map((x) => x.trim()).filter((x) => x && x !== m[1]);
              const names = [m[1], ...thru, m[3]];
              route = names.length <= 5 ? names.join(' → ') : `${names[0]} → ${names[1]} → … → ${names[names.length - 2]} → ${names[names.length - 1]} · ${names.length - 2} places on it`;
            }
            const sig = kids.find((c) => /^Significance$/i.test(c.head))?.t ?? '';
            const NOTES_ONLY = /^(Definition|Significance|Depl Areas|Dominating Features|Dir Keeping)$/i;
            const short = (head2: string, t: string): string => {
              if (/^Obs$/i.test(head2)) return t.split('; ').slice(0, 2).join('; ').replace(/\.$/, '');
              return sentences(t)[0].replace(/\.$/, '');
            };
            const frows = kids.filter((c) => !NOTES_ONLY.test(c.head)).map((c) => [c.head, short(c.head, c.t)]);
            const h2 = head(section, `Para ${numberOfP(a)}`, a.head ?? 'Apch', route);
            const ov2 = [...h2.ov];
            const mp = mapOf(side);
            if (mp) ov2.push(picture(mp, { x: X0, y: h2.top, w: 0.36, h: BOTTOM - h2.top }));
            const ax = mp ? 0.44 : X0, aw = mp ? 0.51 : WIDE;
            const sigH = sig ? 0.12 : 0;
            if (frows.length) ov2.push(tableOverlay({ head: null, rows: frows, widths: [0.26, 0.74] }, { x: ax, y: h2.top, w: aw, h: BOTTOM - h2.top - sigH - 0.02 }, 0.0225));
            if (sig) {
              ov2.push(rect({ x: ax, y: BOTTOM - sigH, w: aw, h: sigH }, T.panel, { stroke: T.line, strokeWidth: 0.0012 }));
              ov2.push(text('Significance', { x: ax + 0.012, y: BOTTOM - sigH + 0.01, w: aw - 0.024, h: 0.03 }, { fontSize: FS.foot, bold: true, textColor: T.dim }));
              ov2.push(text(sig.replace(/\.$/, ''), { x: ax + 0.012, y: BOTTOM - sigH + 0.04, w: aw - 0.024, h: sigH - 0.045 }, { fontSize: 0.0235 }));
            }
            mk(a.id, a.head ?? 'Apch', section, [...ov2, ...foot(true)], notesOf(a));
          }
        }
        continue;
      }

      // Gen description: the going as a bar, the rest as points
      if (p.id === 'gr.gen' && s.text) {
        const g = s.text.match(/For ([\w ]+?) in (\w+) \(([^)]+)\): GO on (\d+) % of the AOR, SLOW-GO (\d+) %, NO-GO (\d+) %( in \d+ patch(?:es)?)?\.?/);
        if (g) {
          const rest = s.text.replace(g[0], '').replace(/\s{2,}/g, ' ').trim();
          const h = head(section, para, ttl);
          const ov = [...h.ov, text(`Going for ${g[1]} · ${g[2]}, ${g[3]}`, { x: X0, y: h.top, w: WIDE, h: 0.034 }, { fontSize: FS.small, bold: true, textColor: T.dim })];
          const go = +g[4], slow = +g[5], no = +g[6], sum = Math.max(1, go + slow + no);
          let x = X0;
          const segs: Array<[number, string, string, string]> = [[go, T.go, '#ffffff', `GO ${go} %`], [slow, T.slow, '#1c1206', `SLOW-GO ${slow} %`], [no, T.nogo, '#ffffff', `NO-GO ${no} %`]];
          const below: string[] = [];
          for (const [v, fill, ink, label] of segs) {
            if (!v) continue;
            const w = Math.max(0.006, (WIDE * v) / sum);
            ov.push(rect({ x, y: h.top + 0.042, w: w - 0.002, h: 0.058 }, fill));
            if (w > 0.12) ov.push(text(label, { x: x + 0.01, y: h.top + 0.055, w: w - 0.02, h: 0.04 }, { fontSize: FS.small, bold: true, textColor: ink }));
            else below.push(`${label}${label.startsWith('NO-GO') && g[7] ? ` (${g[7].trim().replace(/^in /, '')})` : ''}`);
            x += w;
          }
          if (below.length) ov.push(text(below.join(' · '), { x: X0, y: h.top + 0.106, w: WIDE, h: 0.032 }, { fontSize: FS.foot, textColor: T.dim, align: 'right' }));
          const pts = [...(rest ? pointsOfText(rest, 0, s.proposal, '', !!p.mine) : []), ...pointsOf(p, copy, true)];
          const box = { x: X0, y: h.top + 0.16, w: WIDE, h: BOTTOM - h.top - 0.16 };
          const pages = pointPages(pts, box, FS.body);
          mk(p.id, ttl, section, [...ov, ...(pages[0] ? pointOverlays(pages[0], box, FS.body) : []), ...foot(true)], notes);
          if (pages.length > 1) pointsSlides(`${p.id}#more`, `${ttl} (cont)`, section, para, pages.slice(1).flatMap((pg) => [...pg.facts, ...pg.props]), '');
          continue;
        }
      }

      // Deductions on the ground: the apchs ranked and the lines of def as a depth ladder, then the rest as points
      if (p.id === 'gr.ded') {
        const done = groundDeductions(p, copy, draft, section, para, ttl, head, foot);
        if (done) {
          mk(p.id, ttl, section, done.ov, notes);
          pointsSlides(`${p.id}#rest`, `${ttl} (cont)`, section, para, done.rest, '');
          continue;
        }
      }

      // Relative strength: the table and paired bars, en and own
      if (p.id === 'own.str') {
        const tb = filledTable(p, copy);
        const rows = tb ? liveRows(tb) : [];
        const num2 = (c: string): number => Number(String(c).replace(/[^\d.]/g, ''));
        const ok = rows.length && rows.every((r) => num2(r[2]) >= 0 && num2(r[3]) >= 0);
        if (tb && ok) {
          const r0 = rows[0], top = rows.reduce((a, r) => (num2(r[2]) / Math.max(1, num2(r[3])) > num2(a[2]) / Math.max(1, num2(a[3])) ? r : a), r0);
          const sub = `En to own: ${r0[4]} in ${r0[1]}${top !== r0 ? `, ${top[4]} in ${top[1]}` : ''}`;
          const h = head(section, para, ttl, sub, s.proposal);
          const tbl = tableOverlay({ head: tb.head, rows, widths: tb.widths }, { x: X0, y: h.top, w: 0.6, h: BOTTOM - h.top - 0.08 }, 0.026);
          const ov = [...h.ov, tbl];
          const rh = (tbl.rowHeights ?? []).map((f) => f * tbl.h);
          let y = h.top + (rh[0] ?? 0);
          rows.forEach((r, i) => {
            const en = num2(r[2]), own = num2(r[3]), max = Math.max(1, en, own), bw = 0.27, cy = y + (rh[i + 1] ?? 0) / 2;
            ov.push(rect({ x: 0.67, y: cy - 0.02, w: Math.max(0.004, (bw * en) / max), h: 0.016 }, T.en), rect({ x: 0.67, y: cy + 0.004, w: Math.max(0.004, (bw * own) / max), h: 0.016 }, T.own));
            y += rh[i + 1] ?? 0;
          });
          const ky = h.top + tbl.h + 0.03;
          ov.push(rect({ x: X0, y: ky + 0.006, w: 0.022, h: 0.016 }, T.en), text('En', { x: X0 + 0.028, y: ky, w: 0.06, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim }));
          ov.push(rect({ x: X0 + 0.08, y: ky + 0.006, w: 0.022, h: 0.016 }, T.own), text('Own', { x: X0 + 0.108, y: ky, w: 0.06, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim }));
          mk(p.id, ttl, section, [...ov, ...foot(true)], notes);
          continue;
        }
      }

      // Everything else: a table when it has one, else points; then any table under it on a slide of its own
      const tb = filledTable(p, copy);
      if (tb) {
        if (s.text) pointsSlides(`${p.id}#words`, ttl, section, para, pointsOfText(s.text, 0, s.proposal, '', !!p.mine), '');
        tableSlides(p.id, ttl, section, para, tb, notes, s.proposal);
      } else {
        pointsSlides(p.id, ttl, section, para, pointsOf(p, copy), notes);
      }
      const walk = (q: AprcPara): void => {
        for (const c of q.children) {
          const ct = filledTable(c, copy);
          if (ct && shown(c, copy).text !== null) tableSlides(c.id, `${ttl}: ${c.head ?? 'Table'}`, section, `Para ${numberOfP(c)}`, ct, notesOf(c), shown(c, copy).proposal);
          walk(c);
        }
      };
      walk(p);
    }

    // a section slide before a group of two or more slides (full brief)
    if (o.kind === 'full' && o.sections !== false && list.length >= 2 && out.length - start >= 2) {
      const paras = list.map((p) => ({ n: numberOfP(p), name: p.head ?? words(part.title) }));
      const half = Math.ceil(paras.length / 2);
      const col = (xs: typeof paras, x: number): SlideOverlay[] => [
        text(xs.map((q) => q.n).join('\n'), { x, y: 0.47, w: 0.06, h: 0.4 }, { fontSize: 0.036, bold: true, textColor: T.acc, align: 'right', lineSpacing: 1.45 }),
        text(xs.map((q) => q.name).join('\n'), { x: x + 0.075, y: 0.47, w: 0.34, h: 0.4 }, { fontSize: 0.036, lineSpacing: 1.45 }),
      ];
      const ov = [
        text(group.title ? words(part.title) : paras.length > 1 ? `Paras ${paras[0].n} to ${paras[paras.length - 1].n}` : `Para ${paras[0].n}`, { x: 0.07, y: 0.24, w: 0.8, h: 0.045 }, { fontSize: 0.03, bold: true, textColor: T.acc }),
        text(group.title ?? words(part.title), { x: 0.07, y: 0.29, w: 0.86, h: 0.12 }, { fontSize: 0.085, bold: true }),
        ...col(paras.slice(0, half), 0.06),
        ...(paras.length > half ? col(paras.slice(half), 0.52) : []),
      ];
      const before = out.length;
      mk(`section:${group.id}`, group.title ?? words(part.title), section, [...ov, ...foot(false)]);
      out.splice(start, 0, out.splice(before, 1)[0]);
    }
  }

  // confirm on Gr: a checklist, each item once, and each as a task on the slide
  const items = doc.confirm.map((c) => c.text).filter((t, i, all) => all.indexOf(t) === i);
  if (items.length) {
    const at = new Date().toISOString();
    for (let i = 0; i < items.length; i += 10) {
      const part = items.slice(i, i + 10);
      const ttl = i ? 'Confirm on Gr (cont)' : 'Confirm on Gr';
      const h = head('Close', '', ttl, 'What the reading could not tell');
      const ov = [...h.ov];
      const colW = 0.42, fs = 0.0225, top = h.top;
      let col = 0, y = top;
      part.forEach((t) => {
        const hh = Math.max(1, Math.ceil((t.length + 6) / perLine(colW - 0.04, fs))) * lineH(fs) + 0.018;
        if (y + hh > BOTTOM && col === 0) {
          col = 1;
          y = top;
        }
        const x = X0 + col * (colW + 0.06);
        ov.push(rect({ x, y: y + 0.004, w: 0.017, h: 0.03 }, T.bg, { stroke: T.ink, strokeWidth: 0.0018 }));
        ov.push(text(t, { x: x + 0.03, y, w: colW - 0.03, h: hh }, { fontSize: fs }));
        y += hh;
      });
      mk(i ? `confirm#${i / 10}` : 'confirm', ttl, 'Close', [...ov, ...foot(false)], items.join('\n'), part.map((t, k) => ({ id: uid('apc'), author: 'Aprc', text: t, at, kind: 'task', x: 0.95, y: 0.24 + k * 0.065 }) as SlideComment));
    }
  }

  // slide numbers, then what each slide is made of
  out.forEach((s, i) => {
    const no = s.overlays?.find((v) => v.id.startsWith('apno'));
    if (no) no.text = `${i + 1} / ${out.length}`;
    s.sourceHash = slideHash(s);
  });
  return out;
}

/**
 * The ground deductions laid out: the apchs ranked (from "Pri of Apchs") on the left, the lines of def as a depth
 * ladder on the right (from the "Line W" heads and the "(FDLs)" / "(Depth)" roles). Null when the words do not read
 * that way (the planner wrote them his own way): the slide is then points like any other.
 */
function groundDeductions(
  p: AprcPara,
  copy: AprcCopy,
  draft: boolean,
  section: string,
  para: string,
  ttl: string,
  head: (sec: string, para: string, ttl: string, sub?: string, tag?: boolean) => { ov: SlideOverlay[]; top: number },
  foot: (notes: boolean) => SlideOverlay[],
): { ov: SlideOverlay[]; rest: Pt[] } | null {
  const all: AprcPara[] = [];
  const walk = (q: AprcPara): void => {
    all.push(q);
    q.children.forEach(walk);
  };
  walk(p);
  const pri = all.find((q) => /^Pri of Apchs$/i.test(q.head ?? ''));
  const comb = all.find((q) => /^Pri of Comb of Apchs$/i.test(q.head ?? ''));
  const linesP = all.find((q) => /^Lines of Def$/i.test(q.head ?? ''));
  const priS = pri ? shown(pri, copy) : null;
  const ranked = [...(priS?.text ?? '').matchAll(/\b(Lt|Cen|Rt) \(([^)]*)\)/g)].map((m) => ({ side: m[1], why: m[2] }));
  if (!pri || !linesP || ranked.length < 2) return null;
  const under: AprcPara[] = [];
  const walk2 = (q: AprcPara): void => {
    under.push(q);
    q.children.forEach(walk2);
  };
  walk2(linesP);
  const lineRows = under
    .filter((q) => /^Line [A-Z]$/.test(q.head ?? '') && shown(q, copy).text)
    .map((q) => {
      const t = shown(q, copy).text ?? '';
      const behind = t.match(/([\d.]+) km behind the front/);
      return { name: q.head!, places: t.split(',')[0].replace(/\.$/, ''), behind: behind ? Number(behind[1]) : null };
    });
  if (lineRows.length < 2) return null;
  const roleText = under.map((q) => shown(q, copy).text ?? '').join(' ');
  const roles = new Map([...roleText.matchAll(/Line ([A-Z]) \((FDLs|Depth)\)/g)].map((m) => [`Line ${m[1]}`, m[2]]));
  const rolesProp = under.some((q) => /\((FDLs|Depth)\)/.test(shown(q, copy).text ?? '') && shown(q, copy).proposal);

  const h = head(section, para, ttl);
  const ov = [...h.ov];
  const tag = (x: number, y: number, on: boolean | undefined): void => {
    if (on && draft) ov.push(...pill('Proposal', { x, y: y - 0.004, w: 0.085, h: 0.034 }));
  };
  // left: the apchs ranked
  let y = h.top;
  ov.push(text('Pri of apchs', { x: X0, y, w: 0.2, h: 0.034 }, { fontSize: FS.small, bold: true, textColor: T.dim }));
  tag(X0 + 0.15, y, priS?.proposal);
  y += 0.05;
  ranked.slice(0, 4).forEach((r, i) => {
    ov.push({ id: uid('ap'), kind: 'ellipse', x: X0, y, w: 0.0253, h: 0.045, fill: T.acc, fillOpacity: 1, stroke: T.acc, strokeWidth: 0.001 });
    ov.push(text(String(i + 1), { x: X0, y: y + 0.008, w: 0.0253, h: 0.035 }, { fontSize: 0.024, bold: true, textColor: T.accInk, align: 'center' }));
    ov.push(text(r.side, { x: X0 + 0.038, y: y - 0.004, w: 0.36, h: 0.045 }, { fontSize: 0.034, bold: true }));
    ov.push(text(r.why.replace(/, /g, ' · '), { x: X0 + 0.038, y: y + 0.044, w: 0.38, h: 0.034 }, { fontSize: FS.foot, textColor: T.dim }));
    y += 0.1;
  });
  const combS = comb ? shown(comb, copy) : null;
  if (combS?.text) {
    y += 0.01;
    ov.push(text('Pri of comb of apchs', { x: X0, y, w: 0.25, h: 0.034 }, { fontSize: FS.small, bold: true, textColor: T.dim }));
    tag(X0 + 0.22, y, combS.proposal);
    y += 0.045;
    const pts = combS.text.replace(/\.$/, '').split('; ').map((t) => ({ text: t, depth: 0, prop: false }));
    ov.push(text(ptsText(pts), { x: X0, y, w: 0.42, h: Math.min(BOTTOM - y, linesOf(pts, 0.42, 0.026) * lineH(0.026) + 0.01) }, { fontSize: 0.026, listStyle: 'bullet', lineSpacing: 1.2 }));
  }
  // right: the lines of def by depth behind the front
  const lx = 0.53, lw = 0.42, ly = h.top;
  ov.push(text('Lines of def, from the front', { x: lx, y: ly, w: 0.3, h: 0.034 }, { fontSize: FS.small, bold: true, textColor: T.dim }));
  tag(lx + 0.29, ly, rolesProp);
  ov.push(text('Front of the AOR ↓', { x: lx, y: ly + 0.045, w: 0.3, h: 0.03 }, { fontSize: FS.foot, textColor: T.dim }));
  const known = lineRows.map((r) => r.behind ?? 0);
  const maxD = Math.max(1, ...known) * 1.18;
  const top = ly + 0.13, span = BOTTOM - top - 0.03;
  lineRows.forEach((r, i) => {
    const yy = r.behind === null ? top + span : top + (r.behind / maxD) * span + (i === 0 && r.behind < maxD * 0.04 ? 0.01 : 0);
    ov.push(hline(lx, lx + lw, yy, T.acc, 0.0028, 'dashed'));
    ov.push(text(`${r.name} · ${r.places}`, { x: lx, y: yy - 0.045, w: lw * 0.68, h: 0.036 }, { fontSize: 0.0235 }));
    const role = roles.get(r.name);
    if (role) ov.push(...pill(role, { x: lx + lw * 0.68, y: yy - 0.046, w: 0.07, h: 0.034 }, T.acc, T.accInk));
    ov.push(text(r.behind === null ? 'MITG' : `${r.behind} km`, { x: lx + lw - 0.1, y: yy - 0.045, w: 0.1, h: 0.034 }, { fontSize: 0.0225, textColor: T.dim, align: 'right' }));
  });
  ov.push(...foot(true));
  // the rest (DPs, common deductions) as points on the slides after
  const skip = new Set([pri.id, comb?.id, linesP.id].filter(Boolean) as string[]);
  const rest: Pt[] = [];
  const go = (q: AprcPara, depth: number, ctx: string): void => {
    if (skip.has(q.id)) return;
    const s = shown(q, copy);
    if (s.text === null) return;
    const lead = [ctx, q.head ?? ''].filter(Boolean).join(' · ');
    if (s.text) rest.push(...pointsOfText(s.text, depth, s.proposal, lead, !!q.mine));
    const kids = q.children.filter((c) => !skip.has(c.id));
    kids.forEach((c) => go(c, s.text ? depth + 1 : depth, s.text ? '' : q.head ?? ctx));
  };
  p.children.forEach((c) => go(c, 0, ''));
  // a heading left holding only what the slide already shows ("Basic Deductions") says nothing more
  return { ov, rest: rest.filter((r) => !/^Basic Deductions$/i.test(r.text)) };
}

/**
 * Put a newly made deck into the slides the briefing holds: slides that are not the appreciation's stay where they are;
 * an appreciation slide the user edited since it was made is kept in place of its new version; the rest are replaced.
 */
export function mergeDeck(existing: readonly Slide[], fresh: Slide[]): { slides: Slide[]; kept: number; replaced: number; added: number } {
  type S = Slide & { sourceRef?: string; sourceHash?: string };
  const others = (existing as S[]).filter((s) => !s.sourceRef?.startsWith(REF));
  const edited = new Map<string, S>();
  let replaced = 0;
  for (const s of existing as S[]) {
    if (!s.sourceRef?.startsWith(REF)) continue;
    if (s.sourceHash && slideHash(s) !== s.sourceHash) edited.set(s.sourceRef, s);
    else replaced++;
  }
  const out: Slide[] = [...others];
  let kept = 0, added = 0;
  for (const f of fresh as S[]) {
    const e = f.sourceRef ? edited.get(f.sourceRef) : undefined;
    if (e) {
      out.push(e);
      edited.delete(f.sourceRef!);
      kept++;
    } else {
      out.push(f);
      added++;
    }
  }
  // edited slides whose paragraph is gone from the new deck: the user's work stays
  for (const e of edited.values()) {
    out.push(e);
    kept++;
  }
  return { slides: out, kept, replaced, added };
}

/** The attack reads its apchs from own side, so its Lt / Rt are the en's mirrored: the map for a slide's side. */
export const deckSideOfReading = (kind: string, readingSide: string): string => (kind === 'attk' ? flip(readingSide) : readingSide);
