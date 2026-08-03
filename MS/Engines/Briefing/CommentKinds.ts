/**
 * CommentKinds.ts
 *
 * The catalogue for typed comments — display metadata (label, glyph, colour
 * token) and the [KIND · …] text-prefix codec used by the PPTX exporter. Pure,
 * no runtime imports, so it runs under bare `node` in tests the same way
 * SlideCommentUtils does.
 *
 * The prefix is a best-effort embedding: PowerPoint's legacy comment model has
 * no kind field, but a leading tag survives a round trip through any consumer
 * and our own importer parses it back into typed fields. When both the tag and
 * the customXml sidecar are present, the sidecar wins.
 */

import type { CommentKind, CommentSeverity, SlideComment } from './BriefingTypes';

/** Per-kind display metadata used by the editor + rail. */
export interface CommentKindSpec {
  kind: CommentKind;
  /** Sentence-case label — used in the composer, chip and prefix. */
  label: string;
  /** Single glyph rendered on the slide-surface badge. */
  glyph: string;
  /**
   * CSS custom-property name (without the leading --). Resolved off the slide
   * editor's own tokens so themes recolour the badge and chips together.
   */
  colorVar: string;
}

/**
 * The canonical order — first entry is the default (plain review comment),
 * the rest are the typed kinds shown in the composer's chip row and the rail's
 * filter row, in this order.
 */
export const COMMENT_KINDS: readonly CommentKindSpec[] = [
  { kind: 'comment', label: 'Comment', glyph: '💬', colorVar: 'sl-cmt-comment' },
  { kind: 'decision', label: 'Decision', glyph: '◆', colorVar: 'sl-cmt-decision' },
  { kind: 'task', label: 'Task', glyph: '☐', colorVar: 'sl-cmt-task' },
  { kind: 'question', label: 'Question', glyph: '?', colorVar: 'sl-cmt-question' },
  { kind: 'risk', label: 'Risk', glyph: '△', colorVar: 'sl-cmt-risk' },
  { kind: 'assumption', label: 'Assumption', glyph: '⬢', colorVar: 'sl-cmt-assumption' },
  { kind: 'issue', label: 'Issue', glyph: '!', colorVar: 'sl-cmt-issue' },
];

const BY_KIND: Record<CommentKind, CommentKindSpec> = COMMENT_KINDS.reduce(
  (acc, s) => {
    acc[s.kind] = s;
    return acc;
  },
  {} as Record<CommentKind, CommentKindSpec>,
);

/** Look up a kind's display metadata, falling back to `comment`. */
export function kindSpec(kind: CommentKind | undefined): CommentKindSpec {
  return BY_KIND[kind ?? 'comment'] ?? BY_KIND.comment;
}

/** Every risk severity value, in escalating order. */
export const SEVERITIES: readonly CommentSeverity[] = ['low', 'medium', 'high', 'critical'];

/** Sentence-case label for a severity. */
export function severityLabel(s: CommentSeverity): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Whether a thread carries any typed metadata beyond `kind` itself. Used by
 * the exporter to decide if a prefix has to be emitted at all — a plain
 * `comment` with no extra fields writes its `text` unchanged.
 */
export function isTypedComment(c: SlideComment): boolean {
  if (c.kind && c.kind !== 'comment') return true;
  if (c.assignee || c.dueAt || c.severity || c.final || c.validated) return true;
  return false;
}

// ── Text-prefix codec ────────────────────────────────────────────────────────

/**
 * `[DECISION · final]`, `[TASK · @jdoe · due 2026-08-05 · open]`, `[RISK · high]`.
 * The tag is capital-case; separators are ` · ` (U+00B7). A plain `comment` or
 * a thread with no metadata returns its `text` unchanged.
 *
 * Reversed by `parsePrefix` on import — every field the exporter emits is
 * something the parser can read back.
 */
export function formatPrefix(c: SlideComment): string {
  if (!isTypedComment(c)) return c.text;
  const tag = (c.kind ?? 'comment').toUpperCase();
  const bits: string[] = [];
  if (c.kind === 'task') {
    if (c.assignee) bits.push(`@${c.assignee}`);
    if (c.dueAt) bits.push(`due ${dueBit(c.dueAt)}`);
    bits.push(c.resolved || c.taskStatus === 'resolved' ? 'resolved' : 'open');
  } else if (c.kind === 'risk') {
    if (c.severity) bits.push(c.severity);
  } else if (c.kind === 'decision') {
    if (c.final) bits.push('final');
  } else if (c.kind === 'question') {
    bits.push(c.answerCommentId ? 'answered' : 'unanswered');
  } else if (c.kind === 'assumption') {
    bits.push(c.validated ? 'validated' : 'unvalidated');
  }
  const meta = bits.length ? ` · ${bits.join(' · ')}` : '';
  return `[${tag}${meta}] ${c.text}`;
}

/** ISO datetime → YYYY-MM-DD for the prefix. Leaves plain YYYY-MM-DD alone. */
function dueBit(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1]! : iso;
}

/**
 * Reverse of `formatPrefix`. Returns null when the text doesn't start with a
 * recognised `[KIND · …]` tag, so callers can fall through to plain-comment
 * handling. The parsed fields are what an importer merges into a
 * `SlideComment`; the returned `text` has the tag stripped.
 */
export function parsePrefix(text: string): {
  kind: CommentKind;
  text: string;
  assignee?: string;
  dueAt?: string;
  severity?: CommentSeverity;
  final?: boolean;
  validated?: boolean;
  taskStatus?: 'open' | 'resolved';
  questionAnswered?: boolean;
} | null {
  const m = /^\[([A-Z]+)(?:\s·\s([^\]]*))?\]\s?(.*)$/s.exec(text);
  if (!m) return null;
  const tag = m[1]!.toLowerCase();
  const kind = COMMENT_KINDS.find((s) => s.kind === tag)?.kind;
  if (!kind || kind === 'comment') return null;
  const rest = (m[3] ?? '').trim();
  const bits = (m[2] ?? '')
    .split(/\s·\s/)
    .map((b) => b.trim())
    .filter(Boolean);
  const out: ReturnType<typeof parsePrefix> = { kind, text: rest };
  for (const b of bits) {
    if (b.startsWith('@')) out!.assignee = b.slice(1);
    else if (b.startsWith('due ')) out!.dueAt = b.slice(4).trim();
    else if (b === 'final') out!.final = true;
    else if (b === 'validated') out!.validated = true;
    else if (b === 'unvalidated') out!.validated = false;
    else if (b === 'answered') out!.questionAnswered = true;
    else if (b === 'unanswered') out!.questionAnswered = false;
    else if (b === 'open') out!.taskStatus = 'open';
    else if (b === 'resolved') out!.taskStatus = 'resolved';
    else if ((SEVERITIES as readonly string[]).includes(b))
      out!.severity = b as CommentSeverity;
  }
  return out;
}
