/**
 * SlideCommentUtils.ts
 *
 * The pure half of the slide editor's review comments: coordinate projection,
 * time formatting, anchor pruning, id minting. Split out from SlideComments.ts
 * so it can run under bare `node` for tests — which is also why this module has
 * NO runtime imports (node's ESM resolver rejects the extensionless imports
 * Vite accepts, so one import here would make the tests unrunnable).
 */

import type { SlideComment } from './BriefingTypes';

/** RFC-4122 v4, same generator shape as OverlayStyle's overlayUuid. */
export function commentUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normalized [0..1] anchor → pixel offset inside the canvas element, through
 * fabric's viewport transform `[zx, 0, 0, zy, tx, ty]` (zoom then pan). A
 * short or absent transform is treated as the identity, so a marker can never
 * land at NaN while a canvas is still being built.
 */
export function projectAnchor(
  nx: number,
  ny: number,
  size: { w: number; h: number },
  vpt: readonly number[],
): { left: number; top: number } {
  const zx = Number.isFinite(vpt?.[0]) ? (vpt[0] as number) : 1;
  const zy = Number.isFinite(vpt?.[3]) ? (vpt[3] as number) : 1;
  const tx = Number.isFinite(vpt?.[4]) ? (vpt[4] as number) : 0;
  const ty = Number.isFinite(vpt?.[5]) ? (vpt[5] as number) : 0;
  return {
    left: nx * size.w * zx + tx,
    top: ny * size.h * zy + ty,
  };
}

/**
 * "just now" / "30m ago" / "3h ago" / "2d ago", falling back to a locale date
 * past a month. `now` is injectable so the tests don't depend on the clock.
 */
export function relTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'just now';
  const s = (now - then) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(then).toLocaleDateString();
}

/**
 * Drop `overlayId`s that no longer resolve to a live annotation — the thread
 * itself survives as a slide-level one, so deleting a shape never silently
 * deletes the feedback about it. Returns a new array; the input is untouched.
 */
export function pruneComments(
  comments: readonly SlideComment[],
  overlayIds: ReadonlySet<string>,
): SlideComment[] {
  return comments.map((c) => {
    if (!c.overlayId || overlayIds.has(c.overlayId)) return { ...c };
    const { overlayId, ...rest } = c;
    return rest;
  });
}

/** Entries in a thread: the opener plus its replies. Drives the marker badge. */
export function threadCount(c: SlideComment): number {
  return 1 + (c.replies?.length ?? 0);
}

/** Unresolved threads — the number the rail and strip badges show. */
export function openCount(comments: readonly SlideComment[] | undefined): number {
  return (comments ?? []).reduce((n, c) => (c.resolved ? n : n + 1), 0);
}
