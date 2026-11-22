/**
 * AprcDeck.ts
 *
 * The appreciation as slides for the Briefing module (pure: it returns plain `Slide` objects; the engine hands them to
 * BriefingEngine.importBriefing). Screen-only slides (a white page with text, tables and the trace as overlays), so they
 * need no map and export to PowerPoint with native text and tables.
 *
 *   full      a slide or more for each paragraph that has words;
 *   decision  the short brief: aim, approaches, deductions, his options, relative strength, courses, the plan, confirm;
 *   sand      the orientation order of a sand model: gen description, approaches one by one, ITGs, obs, cover, lines.
 *
 * Each slide carries `sourceRef` (aprc:<paragraph id>) and `sourceHash` (its content as made). On a refresh a slide the
 * user has edited (its content no longer matches the hash) is kept; the others are replaced (`mergeDeck`).
 */

import type { Slide, SlideComment, SlideOverlay } from '../Briefing/BriefingTypes';
import { hash, lines, numberOf, shown, type AprcCopy, type AprcDoc, type AprcFigure, type AprcGroup, type AprcPara, type AprcPart } from './AprcModel';

export type AprcDeckKind = 'full' | 'decision' | 'sand';
export const APRC_DECKS: Array<{ kind: AprcDeckKind; label: string; note: string }> = [
  { kind: 'full', label: 'Full brief', note: 'a slide or more for each paragraph with words' },
  { kind: 'decision', label: 'Decision brief', note: 'aim, apchs, deductions, his options, relative str, courses, plan, confirm' },
  { kind: 'sand', label: 'Sand model', note: 'orientation order: gen description, apchs, ITGs, obs, cover, lines of def' },
];

export interface DeckOptions {
  kind: AprcDeckKind;
  copy: AprcCopy;
  /** A white page as a data URL (the engine paints it; a screen-only slide needs one). */
  blankBg: string;
  thumb?: string;
  transitionMs?: number;
}

const REF = 'aprc:';
const INK = '#1b2733', DIM = '#55606c', ACCENT = '#1f4fb3';
const DECISION = ['aim', 'gr.apchs', 'gr.ded', 'en.opts', 'own.str', 'crs.a', 'crs.react', 'crs.an', 'crs.adopted', 'plan.exec'];
const SAND = ['gr.gen', 'gr.apchs', 'gr.itg', 'gr.obs', 'gr.cover', 'gr.ded'];

let seq = 0;
const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const text = (value: string, box: { x: number; y: number; w: number; h: number }, extra: Partial<SlideOverlay> = {}): SlideOverlay => ({ id: uid('ap'), kind: 'text', ...box, text: value, fontFamily: 'Arial', fontSize: 0.026, textColor: INK, align: 'left', ...extra });
const bar = (): SlideOverlay => ({ id: uid('ap'), kind: 'rect', x: 0.06, y: 0.172, w: 0.88, h: 0.0036, fill: ACCENT, fillOpacity: 1, stroke: ACCENT, strokeWidth: 0.001 });
const title = (t: string, sub = ''): SlideOverlay[] => [
  text(t, { x: 0.06, y: 0.075, w: sub ? 0.62 : 0.88, h: 0.088 }, { fontSize: 0.046, bold: true }),
  ...(sub ? [text(sub, { x: 0.68, y: 0.115, w: 0.26, h: 0.045 }, { fontSize: 0.019, textColor: DIM, align: 'right' })] : []),
  bar(),
];

/** What a slide is made of, for the "edited since" test. */
export function slideHash(s: Pick<Slide, 'title' | 'notes' | 'overlays'>): string {
  const o = (s.overlays ?? []).map((v) => ({ k: v.kind, x: v.x, y: v.y, w: v.w, h: v.h, t: v.text ?? '', r: v.rows ?? null, n: v.src ? v.src.length : 0 }));
  return hash(JSON.stringify([s.title, s.notes ?? '', o]));
}

function hasWords(p: AprcPara, copy: AprcCopy): boolean {
  const s = shown(p, copy);
  if (s.text) return true;
  if (p.table && p.table.rows.some((r) => r.slice(1).some((c) => c.trim()))) return true;
  return p.children.some((c) => hasWords(c, copy));
}

interface Row {
  text: string;
  depth: number;
}

/** A paragraph and its sub-paragraphs as labelled lines (ruled lines and empty heads left out). */
function rowsOf(doc: AprcDoc, p: AprcPara, copy: AprcCopy, skipSelf = false): Row[] {
  const all = lines(doc);
  const out: Row[] = [];
  let base = -1;
  for (const l of all) {
    if (l.type !== 'para') {
      if (base >= 0) break;
      continue;
    }
    if (base < 0) {
      if (l.p.id !== p.id) continue;
      base = l.depth;
      if (skipSelf) continue;
    } else if (l.depth <= base) break;
    const s = shown(l.p, copy);
    if (s.text === null) continue;
    if (s.text === '' && !hasWords(l.p, copy)) continue;
    const head = l.p.head ? `${l.p.head}${s.text ? '. ' : ''}` : '';
    const lab = l.depth === base && !skipSelf ? '' : `${l.label} `;
    out.push({ text: `${lab}${head}${s.text}${s.proposal ? '  (proposal)' : ''}`.trim(), depth: Math.max(0, l.depth - base - (skipSelf ? 1 : 0)) });
  }
  return out;
}

/** Split rows over slides: `perLine` characters fit a line of the box, `max` lines a slide. */
function pages(rows: Row[], perLine: number, max: number): Row[][] {
  const out: Row[][] = [];
  let cur: Row[] = [], used = 0;
  for (const r of rows) {
    const need = Math.max(1, Math.ceil((r.text.length + r.depth * 4) / perLine));
    if (cur.length && used + need > max) {
      out.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(r);
    used += need;
  }
  if (cur.length) out.push(cur);
  return out;
}
const bodyText = (rows: Row[]): string => rows.map((r) => `${'    '.repeat(r.depth)}${r.text}`).join('\n');

function imageBox(f: AprcFigure, box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  // The slide is 16 : 9; fit the picture into the box keeping its shape.
  const boxAspect = (box.w * 16) / (box.h * 9), a = f.w / Math.max(1, f.h);
  if (a >= boxAspect) {
    const h = (box.w * 16) / 9 / a;
    return { x: box.x, y: box.y, w: box.w, h };
  }
  const w = (box.h * 9 * a) / 16;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h };
}

/** The slides of a deck kind, in order. */
export function buildDeck(doc: AprcDoc, o: DeckOptions): Slide[] {
  const out: Slide[] = [];
  const copy = o.copy;
  const mk = (ref: string, ttl: string, section: string, overlays: SlideOverlay[], notes = '', comments: SlideComment[] = []): void => {
    const s: Slide & { sourceRef?: string; sourceHash?: string } = {
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
    };
    s.sourceRef = `${REF}${ref}`;
    s.sourceHash = slideHash(s);
    out.push(s);
  };
  const fr = doc.frame;
  const trace = doc.figures.find((f) => f.id === 'trace' && f.png) ?? null;
  const sectionOf = (part: AprcPart, group: AprcGroup): string => (group.title ? `${cap(part.title)}: ${group.title}` : cap(part.title));
  const notesOf = (p: AprcPara): string => rowsOf(doc, p, copy).map((r) => `${'  '.repeat(r.depth)}${r.text}`).join('\n');
  const num = (p: AprcPara): string => numberOf(doc, p.id);

  // title
  mk('title', doc.title, '', [
    { id: uid('ap'), kind: 'rect', x: 0.1, y: 0.4, w: 0.05, h: 0.009, fill: ACCENT, fillOpacity: 1, stroke: ACCENT, strokeWidth: 0.001 },
    text(doc.title, { x: 0.1, y: 0.43, w: 0.8, h: 0.15 }, { fontSize: 0.078, bold: true }),
    text(fr ? `${fr.echelon} · ${fr.place} · ${fr.month}, ${fr.season === 'wet' ? 'after rain' : 'dry'}` : 'Not read yet', { x: 0.1, y: 0.6, w: 0.8, h: 0.06 }, { fontSize: 0.03, textColor: DIM }),
  ]);

  const want = (id: string): boolean => o.kind === 'full' || (o.kind === 'decision' ? DECISION : SAND).includes(id);

  for (const part of doc.parts) for (const group of part.groups) for (const p of group.paras) {
    if (!want(p.id) || !hasWords(p, copy)) continue;
    const section = sectionOf(part, group);
    const ttl = p.head ?? cap(part.title);
    const sub = `Para ${num(p)}`;

    if (p.id === 'gr.apchs') {
      // overview: the trace beside a table of the approaches, then a slide each
      const head = ['Apch', 'Length', 'Capacity', 'Obs'];
      const get = (a: AprcPara, k: string): string => {
        const c = a.children.find((q) => q.id.endsWith(`.${k}`));
        const t = c ? shown(c, copy).text : null;
        return t ? t.replace(/\.$/, '') : '';
      };
      const rows = p.children.map((a) => [a.head ?? '', get(a, 'length'), get(a, 'capacity').split(':')[0], get(a, 'obs').split(';')[0]]);
      const ov: SlideOverlay[] = [...title(ttl, sub)];
      const lead = shown(p, copy).text;
      if (trace) ov.push({ id: uid('ap'), kind: 'image', ...imageBox(trace, { x: 0.06, y: 0.205, w: 0.4, h: 0.7 }), src: trace.png });
      const tx = trace ? 0.49 : 0.06, tw = trace ? 0.45 : 0.88;
      if (lead) ov.push(text(lead, { x: tx, y: 0.205, w: tw, h: 0.07 }, { fontSize: 0.024 }));
      ov.push({ id: uid('ap'), kind: 'table', x: tx, y: 0.29, w: tw, h: Math.min(0.56, 0.11 * (rows.length + 1)), rows: [head, ...rows], headerRow: true, colWidths: [0.14, 0.2, 0.26, 0.4], fontSize: 0.019 });
      mk(p.id, ttl, section, ov, notesOf(p));
      if (o.kind !== 'decision') {
        for (const a of p.children) {
          const r2 = a.children.map((c) => [c.head ?? '', shown(c, copy).text ?? '']).filter((r) => r[1]);
          if (!r2.length) continue;
          const ov2: SlideOverlay[] = [...title(a.head ?? 'Apch', `Para ${num(a)}`)];
          if (trace) ov2.push({ id: uid('ap'), kind: 'image', ...imageBox(trace, { x: 0.06, y: 0.205, w: 0.3, h: 0.7 }), src: trace.png });
          const weights = r2.map((r) => Math.max(1, Math.ceil(r[1].length / (trace ? 62 : 100))));
          const sum = weights.reduce((x, y) => x + y, 0);
          ov2.push({ id: uid('ap'), kind: 'table', x: trace ? 0.38 : 0.06, y: 0.205, w: trace ? 0.56 : 0.88, h: 0.7, rows: r2, colWidths: [0.22, 0.78], rowHeights: weights.map((x) => x / sum), fontSize: sum > 22 ? 0.0155 : 0.0175 });
          mk(a.id, a.head ?? 'Apch', section, ov2, notesOf(a));
        }
      }
      continue;
    }

    if (p.table && p.table.rows.some((r) => r.slice(1).some((c) => c.trim()))) {
      const t = p.table;
      const chunk = 9;
      for (let i = 0; i < t.rows.length; i += chunk) {
        const part2 = t.rows.slice(i, i + chunk);
        const ov: SlideOverlay[] = [...title(i ? `${ttl} (cont)` : ttl, sub)];
        ov.push({ id: uid('ap'), kind: 'table', x: 0.06, y: 0.21, w: 0.88, h: Math.min(0.68, 0.085 * (part2.length + 1)), rows: [t.head, ...part2], headerRow: true, colWidths: t.widths, fontSize: 0.019 });
        mk(i ? `${p.id}#${i / chunk}` : p.id, i ? `${ttl} (cont)` : ttl, section, ov, notesOf(p));
      }
      continue;
    }

    const fig = p.figure ? doc.figures.find((f) => f.id === p.figure && f.png) ?? null : null;
    const rows = rowsOf(doc, p, copy, true);
    const own = shown(p, copy).text;
    const all: Row[] = [...(own ? [{ text: own, depth: 0 }] : []), ...rows];
    const pg = pages(all, fig ? 58 : 108, 15);
    pg.forEach((rs, i) => {
      const t2 = i ? `${ttl} (cont)` : ttl;
      const ov: SlideOverlay[] = [...title(t2, sub)];
      if (fig && i === 0) ov.push({ id: uid('ap'), kind: 'image', ...imageBox(fig, { x: 0.06, y: 0.205, w: 0.4, h: 0.7 }), src: fig.png });
      ov.push(text(bodyText(rs), fig && i === 0 ? { x: 0.49, y: 0.205, w: 0.45, h: 0.7 } : { x: 0.06, y: 0.205, w: 0.88, h: 0.7 }, { fontSize: 0.0255, lineSpacing: 1.25 }));
      mk(i ? `${p.id}#${i}` : p.id, t2, section, ov, i ? '' : notesOf(p));
    });
  }

  // confirm on Gr: the list, and each item as a task on the slide
  if (doc.confirm.length) {
    const items = doc.confirm.slice(0, 10);
    const at = new Date().toISOString();
    mk('confirm', 'Confirm on Gr', 'Close', [...title('Confirm on Gr', 'What the reading could not tell'), text(items.map((c, i) => `${i + 1}. ${c.text}`).join('\n'), { x: 0.06, y: 0.205, w: 0.88, h: 0.7 }, { fontSize: 0.0245, lineSpacing: 1.3 })],
      doc.confirm.map((c) => c.text).join('\n'),
      items.map((c, i) => ({ id: uid('apc'), author: 'Aprc', text: c.text, at, kind: 'task', x: 0.95, y: 0.24 + i * 0.065 }) as SlideComment));
  }
  return out;
}
const cap = (s: string): string => (s ? s[0] + s.slice(1).toLowerCase() : s);

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
