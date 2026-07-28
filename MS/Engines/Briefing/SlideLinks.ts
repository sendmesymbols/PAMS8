/**
 * SlideLinks.ts
 *
 * The one place that knows what an OverlayLink MEANS. Five call sites — the
 * slide editor's link dialog, the properties panel, present-mode navigation,
 * the PPTX exporter and the PPTX importer — all resolve, label and translate
 * links through here, so a link authored in PAMS and a link read back out of
 * PowerPoint can't drift apart.
 *
 * Coordinates and geometry live in OverlayFabric; this module is pure data.
 */

import type { LinkJump, OverlayLink, Slide, SlideOverlay } from './BriefingTypes';

/** Every jump, in the order the link dialog lists them. */
export const LINK_JUMPS: readonly LinkJump[] = [
  'next',
  'prev',
  'first',
  'last',
  'lastViewed',
  'endShow',
] as const;

const JUMP_LABELS: Record<LinkJump, string> = {
  next: 'Next slide',
  prev: 'Previous slide',
  first: 'First slide',
  last: 'Last slide',
  lastViewed: 'Last slide viewed',
  endShow: 'End show',
};

/**
 * `LinkJump` ↔ the token PowerPoint puts in
 * `a:hlinkClick/@action = "ppaction://hlinkshowjump?jump=<token>"`. Shared by
 * the importer and the exporter so the two can never disagree about spelling.
 */
export const PPT_JUMP_ACTIONS: Record<LinkJump, string> = {
  next: 'nextslide',
  prev: 'previousslide',
  first: 'firstslide',
  last: 'lastslide',
  lastViewed: 'lastslideviewed',
  endShow: 'endshow',
};

const PPT_JUMP_BY_TOKEN: Record<string, LinkJump> = Object.fromEntries(
  (Object.keys(PPT_JUMP_ACTIONS) as LinkJump[]).map((j) => [PPT_JUMP_ACTIONS[j], j]),
);

/**
 * The jumps that survive an export. `resolveJumpForExport` turns the other four
 * into a fixed slide number, but "last viewed" and "end show" have no
 * fixed-slide equivalent at all — linking either one to a concrete slide would
 * be silently WRONG rather than merely lossy, so the exporter drops them and
 * says so. (Both would round-trip intact if the exporter ever hand-wrote the
 * `hlinkshowjump` action into the package it already reopens for comments.)
 */
export const UNEXPORTABLE_JUMPS: readonly LinkJump[] = ['lastViewed', 'endShow'] as const;

/** A link with no target set carries no meaning — see OverlayLink. */
export function isUsableLink(link: OverlayLink | undefined): link is OverlayLink {
  return !!link && (!!link.slideId || !!link.jump || !!link.url);
}

/**
 * Schemes an overlay link may point at.
 *
 * An allowlist, not a blocklist: a briefing can be imported from a .pptx a
 * third party authored, and present mode opens these on a click. `javascript:`
 * and `data:` in particular must never reach `window.open` from a document,
 * so anything not named here is refused at normalize time and the link is
 * dropped rather than sanitised into something that still fires.
 */
const ALLOWED_URL_SCHEMES: readonly string[] = ['http:', 'https:', 'mailto:'];

/**
 * True when `url` is ABSOLUTE and one of the schemes present mode will open.
 * Parsed with no base on purpose: a relative string has no scheme to check, so
 * it must be rejected rather than silently resolved against the app's origin.
 */
export function isSafeLinkUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ALLOWED_URL_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * What the link dialog accepts, made absolute. A user typing 'example.com/ops'
 * means https — but only when the string has no scheme at all, so this can
 * never upgrade a rejected scheme into an accepted one. Null when the result
 * still is not a URL we will open.
 */
export function normalizeLinkUrl(raw: string | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  return isSafeLinkUrl(candidate) ? candidate : null;
}

/** Parse `ppaction://hlinkshowjump?jump=nextslide` → 'next'. Null if unknown. */
export function jumpFromPptAction(action: string | null | undefined): LinkJump | null {
  if (!action) return null;
  const m = /[?&]jump=([a-z]+)/i.exec(action);
  if (!m) return null;
  return PPT_JUMP_BY_TOKEN[m[1].toLowerCase()] ?? null;
}

/**
 * Where a click on this link goes.
 *
 * - `{ index }`   — navigate to that slide.
 * - `'endShow'`   — leave present mode.
 * - `null`        — nothing to do: the link is empty, its target slide is gone,
 *                   'next' was clicked on the last slide, or 'lastViewed' was
 *                   clicked before anything else had been viewed.
 *
 * `lastViewedIndex` is the caller's own history cursor (present mode keeps one);
 * pass null when there is no history.
 */
export function resolveLink(
  link: OverlayLink | undefined,
  slides: readonly Slide[],
  currentIndex: number,
  lastViewedIndex: number | null = null,
): { index: number } | { url: string } | 'endShow' | null {
  if (!isUsableLink(link)) return null;
  // Checked before the slide-count guard: an external link is meaningful even
  // in a deck of one slide.
  if (link.url) return isSafeLinkUrl(link.url) ? { url: link.url } : null;
  if (!slides.length) return null;

  if (link.slideId) {
    const index = slides.findIndex((s) => s.id === link.slideId);
    return index >= 0 ? { index } : null;
  }
  if (link.jump === 'endShow') return 'endShow';
  const index = jumpIndex(
    link.jump!,
    slides.length,
    currentIndex,
    lastViewedIndex,
    (i) => !!slides[i]?.hidden,
  );
  return index == null ? null : { index };
}

/**
 * What a relative jump lands on, as an index into a deck of `slideCount`
 * slides — the ONE implementation of what 'next' means. Both the present-mode
 * resolver and the export path go through it, which is why the export path
 * takes a count rather than a slide array. Null when it would land outside the
 * deck, when there is no history for 'lastViewed', or for 'endShow' (which is
 * not a slide at all — callers handle it before getting here).
 *
 * `isHidden` marks slides playback skips (Slide.hidden). Relative jumps step
 * over them, so a "Next slide" link lands exactly where advancing would —
 * otherwise a link could drop the briefer onto a slide the deck deliberately
 * skips. 'lastViewed' is exempt: it names a slide the briefer demonstrably DID
 * view, hidden or not. Omit the predicate to treat every slide as visible.
 */
function jumpIndex(
  jump: LinkJump,
  slideCount: number,
  currentIndex: number,
  lastViewedIndex: number | null,
  isHidden: (i: number) => boolean = () => false,
): number | null {
  const last = slideCount - 1;
  const inRange = (i: number | null) => (i != null && i >= 0 && i <= last ? i : null);
  /** First visible index from `from` inclusive, walking in `dir`. */
  const seek = (from: number, dir: 1 | -1): number | null => {
    for (let i = from; i >= 0 && i <= last; i += dir) {
      if (!isHidden(i)) return i;
    }
    return null;
  };
  switch (jump) {
    case 'next':
      return inRange(seek(currentIndex + 1, 1));
    case 'prev':
      return inRange(seek(currentIndex - 1, -1));
    case 'first':
      return inRange(seek(0, 1));
    case 'last':
      return inRange(seek(last, -1));
    case 'lastViewed':
      return inRange(lastViewedIndex);
    default:
      return null; // endShow — not an index
  }
}

/**
 * A fixed slide index for a jump, for the export path — which cannot express
 * relative navigation (see UNEXPORTABLE_JUMPS). Null when the jump has no
 * fixed equivalent, or would land outside the deck.
 */
export function resolveJumpForExport(
  link: OverlayLink,
  slideCount: number,
  currentIndex: number,
  isHidden?: (i: number) => boolean,
): number | null {
  if (link.slideId || !link.jump) return null;
  if ((UNEXPORTABLE_JUMPS as readonly string[]).includes(link.jump)) return null;
  return jumpIndex(link.jump, slideCount, currentIndex, null, isHidden);
}

/**
 * Human-readable target, for the link dialog, the properties-panel chip and the
 * badge tooltip. Falls back to a plain description when the target slide is
 * missing, so a dangling link still reads as something rather than blank.
 */
export function linkLabel(link: OverlayLink | undefined, slides: readonly Slide[]): string {
  if (!isUsableLink(link)) return 'No link';
  if (link!.url) return link!.url!;
  if (link.jump) return JUMP_LABELS[link.jump] ?? 'Jump';
  const index = slides.findIndex((s) => s.id === link.slideId);
  if (index < 0) return 'Missing slide';
  const title = String(slides[index].title ?? '').trim();
  return `${index + 1}. ${title || 'Untitled'}`;
}

/** The tooltip a linked object shows on hover — the author's text, else the target. */
export function linkTooltip(link: OverlayLink | undefined, slides: readonly Slide[]): string {
  const custom = String(link?.tooltip ?? '').trim();
  return custom || linkLabel(link, slides);
}

/**
 * Drop links that cannot resolve, in place, and report how many went. Called
 * once when a briefing is loaded: a link whose target slide was deleted in
 * another session is exactly the dangling-reference case `labelOf` and
 * `SlideComment.overlayId` already prune, and leaving it would make an object
 * look clickable in the editor while doing nothing in present mode.
 */
export function pruneLinks(slides: readonly Slide[]): number {
  const ids = new Set(slides.map((s) => s.id));
  let dropped = 0;
  for (const slide of slides) {
    for (const o of slide.overlays ?? []) {
      if (!o.link) continue;
      const link = normalizeLink(o.link, ids);
      if (link) o.link = link;
      else {
        delete o.link;
        dropped++;
      }
    }
  }
  return dropped;
}

/**
 * One link, cleaned: exactly one target, a trimmed tooltip, and nothing else
 * carried over from whatever JSON produced it. Null when unusable.
 */
export function normalizeLink(
  raw: unknown,
  knownSlideIds?: ReadonlySet<string>,
): OverlayLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Partial<OverlayLink>;
  const tooltip = typeof src.tooltip === 'string' ? src.tooltip.trim() : '';

  // An external URL is checked FIRST and independently of the deck: it is the
  // only target whose validity does not depend on what slides exist, and a
  // rejected scheme must not fall through to some other interpretation.
  if (typeof src.url === 'string' && src.url) {
    const url = normalizeLinkUrl(src.url);
    if (!url) return null;
    return tooltip ? { url, tooltip } : { url };
  }

  // slideId wins when a hand-edited document somehow carries both, because a
  // fixed target is the more specific statement of intent.
  if (typeof src.slideId === 'string' && src.slideId) {
    if (knownSlideIds && !knownSlideIds.has(src.slideId)) return null;
    return tooltip ? { slideId: src.slideId, tooltip } : { slideId: src.slideId };
  }
  if (typeof src.jump === 'string' && (LINK_JUMPS as readonly string[]).includes(src.jump)) {
    const jump = src.jump as LinkJump;
    return tooltip ? { jump, tooltip } : { jump };
  }
  return null;
}

/**
 * The linked overlay whose box contains a normalized point, topmost first.
 * `overlays` is in paint order (last painted is on top), so the scan runs
 * backwards — the same precedence a click gets in the editor.
 *
 * Rotation is deliberately ignored: the hit box is the axis-aligned bbox, which
 * is what PowerPoint's own hit area for a rotated linked shape approximates too,
 * and it keeps present-mode click handling free of geometry work.
 */
export function linkAtPoint(
  overlays: readonly SlideOverlay[] | undefined,
  nx: number,
  ny: number,
): SlideOverlay | null {
  if (!overlays?.length) return null;
  for (let i = overlays.length - 1; i >= 0; i--) {
    const o = overlays[i];
    if (!isUsableLink(o.link)) continue;
    const x0 = Math.min(o.x, o.x + o.w);
    const y0 = Math.min(o.y, o.y + o.h);
    if (nx >= x0 && nx <= x0 + Math.abs(o.w) && ny >= y0 && ny <= y0 + Math.abs(o.h)) return o;
  }
  return null;
}
