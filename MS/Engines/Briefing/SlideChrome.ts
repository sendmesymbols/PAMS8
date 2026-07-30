/**
 * SlideChrome.ts
 *
 * The deck's headers, footers, classification banners and slide numbering —
 * as ONE definition, shared by every surface that has to draw or emit it.
 *
 * Why this module exists: the chrome used to live only inside PptxExporter's
 * generated slide master, driven straight off `exportTools.*`. The slide editor
 * said so in as many words ("Export-only … do not appear on the editor
 * canvas"), which left an author positioning annotations edge-to-edge into
 * space the export would then reclaim, and left a briefing projected off the
 * screen carrying no classification marking at all.
 *
 * Everything here is PURE — no DOM, no canvas, no fabric, no settings reads.
 * Geometry and text come out as a `ChromeBand[]`; each consumer turns bands
 * into its own pixels (DOM strips in the editor and in present mode, native
 * master objects in the .pptx). That split is what keeps the editor and the
 * export from drifting: they disagree about rendering technology, never about
 * where the furniture is or what it says.
 *
 * ## Coordinates
 *
 * Heights and font sizes are fractions of SLIDE HEIGHT, exactly like
 * `SlideOverlay.strokeWidth` / `fontSize` (see BriefingTypes). So the same
 * numbers scale to an editor canvas (× px), a projected view (× px) and a PPTX
 * master (× inches). The two band heights are calibrated to reproduce the
 * exporter's original 0.26in / 0.22in strips on a 7.5in-tall slide — i.e. on
 * both standard PowerPoint layouts — and now scale proportionally on a custom
 * slide size instead of staying a fixed number of inches.
 *
 * ## Insets
 *
 * `chromeInsets()` is the single authority on how much vertical space the
 * furniture takes. A PowerPoint master paints BEHIND slide content, so a
 * full-bleed screenshot would simply cover a banner — the exporter has always
 * had to fit the map between the furniture instead, and the editor now reserves
 * the same fractions so what an author sees is what they get.
 */

/** Slide-number stamp format. `n-of-m` reads "7 / 24". */
export type SlideNumberFormat = 'n' | 'n-of-m';

/**
 * Deck-level chrome. Lives on `BriefingDocument.chrome` so a briefing's
 * classification travels with the briefing — a marking is a property of the
 * document, not of whatever the app's global export settings happen to say.
 * `resolveChrome()` falls back to those settings, so every deck authored
 * before this existed keeps the chrome it already exported with.
 *
 * Every field is optional and an empty string means "absent", so a
 * `{}` here is a deck with no furniture at all.
 */
export interface DeckChrome {
  /**
   * Master switch — absent or false means no furniture anywhere, whatever the
   * other fields say.
   *
   * It exists because the chrome used to be gated by `exportTools.useMaster`
   * (the PPTX slide master carries it), and a deck whose settings held a stale
   * classification with that switch off must not suddenly start showing a
   * banner. `resolveChrome` maps `useMaster` onto this, so the gate now governs
   * the editor canvas and present mode as well as the export — one switch, and
   * the three surfaces cannot disagree about whether there is chrome at all.
   */
  enabled?: boolean;
  /**
   * Security marking, drawn as a full-width strip at BOTH the top and the
   * bottom edge. Free text (caveats and releasability markings are effectively
   * unbounded); the strip colour is derived from it by `classificationColor`.
   */
  classification?: string;
  /** Header strip text, token-expanded. Absent = no header strip. */
  headerText?: string;
  /** Footer strip text, token-expanded. Absent = no footer text. */
  footerText?: string;
  /** Stamp the slide number at the right end of the footer strip. */
  slideNumbers?: boolean;
  /** Absent = 'n'. */
  numberFormat?: SlideNumberFormat;
  /**
   * Leave the title slide bare — PowerPoint's "Don't show on title slide".
   * Applies to slide 1 only; `Slide.noChrome` is the per-slide equivalent.
   */
  skipFirst?: boolean;
}

/**
 * What the tokens in a header/footer template resolve against. Deck-level
 * fields come from the document properties; the rest are per-slide.
 */
export interface ChromeTokenContext {
  deckTitle?: string;
  author?: string;
  company?: string;
  subject?: string;
  /** The slide's own title — `{SLIDE}`, distinct from the deck's `{TITLE}`. */
  slideTitle?: string;
  /** The slide's section, if any — `{SECTION}`. */
  section?: string;
  /** 1-based slide number — `{PAGE}`. */
  page?: number;
  /** Deck length — `{PAGES}`. */
  pages?: number;
  /** Injectable clock, so `{DTG}` / `{DATE}` are testable. Defaults to now. */
  now?: Date;
}

/** One horizontal strip of furniture. Consumers turn these into pixels. */
export interface ChromeBand {
  role: 'classification' | 'header' | 'footer';
  /** Which edge it is anchored to. */
  edge: 'top' | 'bottom';
  /** Height, as a fraction of slide height. */
  h: number;
  /** Fill, as a BARE hex triplet (no leading '#') — pptxgenjs wants it that way. */
  fill: string;
  /** Text colour, bare hex. */
  color: string;
  /** Main text, already token-expanded. May be ''. */
  text: string;
  /** Right-aligned text on the same strip — the slide-number stamp. */
  rightText?: string;
  align: 'left' | 'center';
  bold?: boolean;
  /** Font size, as a fraction of slide height. */
  fontSize: number;
}

export interface ChromeInsets {
  /** Fraction of slide height reserved at the top. */
  top: number;
  /** Fraction of slide height reserved at the bottom. */
  bottom: number;
}

/**
 * Strip heights as fractions of slide height. `0.26 / 7.5` and `0.22 / 7.5`
 * reproduce PptxExporter's original inch constants on any 7.5in-tall slide,
 * which is both standard PowerPoint layouts (13.33×7.5 and 10×7.5).
 */
export const BANNER_H = 0.26 / 7.5;
export const STRIP_H = 0.22 / 7.5;

/** Banner text size, and the smaller size the header/footer strips use. */
const BANNER_FONT = 11 / (7.5 * 72);
const STRIP_FONT = 9 / (7.5 * 72);

/** Fill behind a header/footer strip, and the dim ink on it. */
export const STRIP_FILL = '11161C';
export const STRIP_INK = 'A9B4C0';
/** Banner ink — white on every classification colour below. */
export const BANNER_INK = 'FFFFFF';

/**
 * Banner colour by marking. A briefer reads the strip's COLOUR before they
 * read its words, so these matter more than they look. Matched
 * longest-prefix-first, so 'TOP SECRET//SCI' beats 'SECRET'.
 *
 * Moved here from PptxExporter (which now imports it) so the banner an author
 * sees on the canvas is painted from the same table the .pptx is.
 */
export const CLASSIFICATION_COLORS: ReadonlyArray<readonly [string, string]> = [
  ['TOP SECRET', 'FF8C00'],
  ['SECRET', 'C8102E'],
  ['CONFIDENTIAL', '0033A0'],
  ['RESTRICTED', '0033A0'],
  ['UNCLASSIFIED', '007A33'],
  ['CUI', '502B85'],
];

/** Neutral grey for a marking none of the prefixes above recognises. */
export const CLASSIFICATION_FALLBACK = '3A4450';

/** Banner colour for a marking, as a bare hex triplet. */
export function classificationColor(text: string): string {
  const t = String(text ?? '').toUpperCase();
  for (const [prefix, hex] of CLASSIFICATION_COLORS) {
    if (t.startsWith(prefix)) return hex;
  }
  return CLASSIFICATION_FALLBACK;
}

/** `#RRGGBB` for the DOM consumers, from any of the bare hex values above. */
export function cssColor(bareHex: string): string {
  return `#${String(bareHex ?? '').replace(/^#/, '')}`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Merge a deck's own chrome over the `exportTools.*` defaults and normalize the
 * result: strings trimmed, empties dropped, booleans coerced.
 *
 * Precedence is per FIELD, not whole-object: a deck that only names a
 * classification still inherits the footer template from settings. `deck`
 * wins wherever it has a defined value, which is what makes the settings a
 * default rather than a competing source of truth.
 */
export function resolveChrome(
  deck: DeckChrome | null | undefined,
  cfg: Record<string, unknown> | null | undefined,
): DeckChrome {
  const d = deck ?? {};
  const c = cfg ?? {};
  const pick = (key: keyof DeckChrome): unknown =>
    d[key] !== undefined && d[key] !== null ? d[key] : c[key];

  const out: DeckChrome = {};
  // `exportTools.useMaster` is the settings-side spelling of `enabled` — the
  // switch predates this module and is what existing decks are gated on.
  const enabled = d.enabled !== undefined && d.enabled !== null ? d.enabled : c.useMaster;
  if (enabled === true) out.enabled = true;
  const classification = str(pick('classification'));
  if (classification) out.classification = classification;
  const headerText = str(pick('headerText'));
  if (headerText) out.headerText = headerText;
  const footerText = str(pick('footerText'));
  if (footerText) out.footerText = footerText;
  if (pick('slideNumbers') === true) out.slideNumbers = true;
  const fmt = pick('numberFormat');
  if (fmt === 'n-of-m') out.numberFormat = 'n-of-m';
  if (pick('skipFirst') === true) out.skipFirst = true;
  return out;
}

/** Whether anything at all would be drawn — the gate plus something to draw. */
export function hasChrome(chrome: DeckChrome | null | undefined): boolean {
  if (!chrome?.enabled) return false;
  return !!(chrome.classification || chrome.headerText || chrome.footerText || chrome.slideNumbers);
}

/**
 * The chrome that applies to one slide, or null when the slide is bare.
 *
 * Two suppressions, and they are the reason this is a function rather than a
 * field read: the deck-level `skipFirst` (title slide) and the per-slide
 * `Slide.noChrome` (a full-bleed map, a section divider). Both zero the insets
 * for that slide, in the editor and in the export alike.
 */
export function chromeForSlide(
  chrome: DeckChrome | null | undefined,
  index: number,
  slide?: { noChrome?: boolean } | null,
): DeckChrome | null {
  if (!hasChrome(chrome)) return null;
  if (slide?.noChrome) return null;
  if (chrome!.skipFirst && index === 0) return null;
  return chrome!;
}

/** DTG — `281430ZJUL26`, UTC, the form the exporter has always written. */
export function formatDtg(d: Date): string {
  const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const p2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z` +
    `${MON[d.getUTCMonth()]}${p2(d.getUTCFullYear() % 100)}`
  );
}

/** The tokens a header/footer template may use, for the dialog's hint line. */
export const CHROME_TOKENS: readonly string[] = [
  '{DTG}',
  '{DATE}',
  '{TITLE}',
  '{SLIDE}',
  '{SECTION}',
  '{PAGE}',
  '{PAGES}',
  '{COMPANY}',
  '{AUTHOR}',
  '{SUBJECT}',
];

/**
 * Substitute the tokens in a header/footer template. Case-insensitive, and an
 * unresolved token becomes '' rather than being left as literal braces — a
 * briefing slide showing `{AUTHOR}` to a room is worse than showing nothing.
 */
export function expandTokens(tpl: string, ctx: ChromeTokenContext = {}): string {
  const now = ctx.now ?? new Date();
  return String(tpl ?? '')
    .replace(/\{DTG\}/gi, formatDtg(now))
    .replace(/\{DATE\}/gi, now.toISOString().slice(0, 10))
    .replace(/\{TITLE\}/gi, str(ctx.deckTitle))
    .replace(/\{SLIDE\}/gi, str(ctx.slideTitle))
    .replace(/\{SECTION\}/gi, str(ctx.section))
    .replace(/\{PAGE\}/gi, ctx.page ? String(ctx.page) : '')
    .replace(/\{PAGES\}/gi, ctx.pages ? String(ctx.pages) : '')
    .replace(/\{COMPANY\}/gi, str(ctx.company))
    .replace(/\{AUTHOR\}/gi, str(ctx.author))
    .replace(/\{SUBJECT\}/gi, str(ctx.subject));
}

/** The slide-number stamp, or '' when there is nothing to number. */
export function formatSlideNumber(
  fmt: SlideNumberFormat | undefined,
  page: number | undefined,
  pages: number | undefined,
): string {
  if (!page || page < 1) return '';
  if (fmt === 'n-of-m' && pages && pages > 0) return `${page} / ${pages}`;
  return String(page);
}

/**
 * Whether a footer strip exists at all.
 *
 * Deliberately keyed on the TEMPLATE rather than on its expansion: a template
 * of `{AUTHOR}` with no author set expands to '', and if that removed the strip
 * the reserved insets would differ from one slide to the next and the editor
 * canvas would jump as you navigated. Presence is a deck-level fact; text is a
 * per-slide one.
 */
function hasFooterStrip(chrome: DeckChrome): boolean {
  return !!(chrome.footerText || chrome.slideNumbers);
}

/**
 * The furniture for one slide, outermost band first per edge — so a consumer
 * renders top bands stacking DOWN from the top edge in array order, and bottom
 * bands stacking UP from the bottom edge in array order.
 *
 * That ordering is what puts the classification banner at the extreme edges
 * with the header/footer strips just inside them, matching the master the
 * exporter has always emitted.
 */
export function chromeBands(
  chrome: DeckChrome | null | undefined,
  ctx: ChromeTokenContext = {},
): ChromeBand[] {
  if (!hasChrome(chrome)) return [];
  const c = chrome!;
  const bands: ChromeBand[] = [];

  if (c.classification) {
    const fill = classificationColor(c.classification);
    const banner = (edge: 'top' | 'bottom'): ChromeBand => ({
      role: 'classification',
      edge,
      h: BANNER_H,
      fill,
      color: BANNER_INK,
      text: c.classification!,
      align: 'center',
      bold: true,
      fontSize: BANNER_FONT,
    });
    bands.push(banner('top'), banner('bottom'));
  }

  if (c.headerText) {
    bands.push({
      role: 'header',
      edge: 'top',
      h: STRIP_H,
      fill: STRIP_FILL,
      color: STRIP_INK,
      text: expandTokens(c.headerText, ctx),
      align: 'left',
      fontSize: STRIP_FONT,
    });
  }

  if (hasFooterStrip(c)) {
    const stamp = c.slideNumbers
      ? formatSlideNumber(c.numberFormat, ctx.page, ctx.pages)
      : '';
    bands.push({
      role: 'footer',
      edge: 'bottom',
      h: STRIP_H,
      fill: STRIP_FILL,
      color: STRIP_INK,
      text: c.footerText ? expandTokens(c.footerText, ctx) : '',
      rightText: stamp || undefined,
      align: 'left',
      fontSize: STRIP_FONT,
    });
  }

  // Outermost-first per edge. `classification` is pushed before the strips, so
  // a stable sort by role rank already has it — this only makes that explicit.
  const rank = (b: ChromeBand): number => (b.role === 'classification' ? 0 : 1);
  return bands.sort((a, b) => rank(a) - rank(b));
}

/**
 * Vertical space the furniture reserves, as fractions of slide height.
 *
 * Derived from `chromeBands` so it can never disagree with what gets drawn.
 * Independent of the token context by construction — see `hasFooterStrip`.
 */
export function chromeInsets(chrome: DeckChrome | null | undefined): ChromeInsets {
  let top = 0;
  let bottom = 0;
  for (const b of chromeBands(chrome)) {
    if (b.edge === 'top') top += b.h;
    else bottom += b.h;
  }
  return { top, bottom };
}

/**
 * The fraction of slide height left for slide CONTENT. Consumers multiply their
 * available height by this to size the content rect, then place bands in what
 * is left. Clamped so a pathological chrome definition can never produce a
 * zero-height or negative content area.
 */
export function contentHeightFraction(chrome: DeckChrome | null | undefined): number {
  const { top, bottom } = chromeInsets(chrome);
  return Math.max(0.2, 1 - top - bottom);
}

/** A pixel rect, in whatever space the caller is working in. */
export interface ChromeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The content rect inside a full slide page — what the map / annotations get
 * once the furniture has taken its bands. The horizontal extent is untouched:
 * every band is full-width.
 */
export function contentRect(page: ChromeRect, chrome: DeckChrome | null | undefined): ChromeRect {
  const { top, bottom } = chromeInsets(chrome);
  return {
    left: page.left,
    top: page.top + top * page.height,
    width: page.width,
    height: page.height * Math.max(0.2, 1 - top - bottom),
  };
}

/**
 * The inverse: the full page rect around a known content rect. The slide editor
 * needs this direction — its fabric canvas IS the content rect (overlay
 * coordinates normalize to it), so the page has to be derived back out of the
 * canvas's measured position in order to place the bands around it.
 */
export function pageRect(content: ChromeRect, chrome: DeckChrome | null | undefined): ChromeRect {
  const { top, bottom } = chromeInsets(chrome);
  const usable = Math.max(0.2, 1 - top - bottom);
  const height = content.height / usable;
  return {
    left: content.left,
    top: content.top - top * height,
    width: content.width,
    height,
  };
}

export default {
  BANNER_H,
  contentRect,
  pageRect,
  STRIP_H,
  chromeBands,
  chromeForSlide,
  chromeInsets,
  classificationColor,
  contentHeightFraction,
  cssColor,
  expandTokens,
  formatDtg,
  formatSlideNumber,
  hasChrome,
  resolveChrome,
};
