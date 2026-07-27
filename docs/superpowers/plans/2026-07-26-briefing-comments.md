# Briefing Review Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reviewers can pin threaded comments to a briefing slide — on an annotation, on a spot, or on the slide — reply, resolve and delete them, with the threads saved in the briefing and exported as native PowerPoint comments.

**Architecture:** A DOM marker layer over the slide editor's fabric canvas, projecting normalized `[0..1]` anchors through fabric's `viewportTransform`. Comments live on `Slide.comments` and never touch the fabric object graph, so they can't leak into `overlays[]`, present mode, thumbnails or rasterized exports. PowerPoint emit happens after `pptxgenjs` builds the package: the zip is reopened and legacy comment parts are injected.

**Tech Stack:** TypeScript 5.2, Vite 5, fabric.js 4.5 (CDN global `window.fabric`), pptxgenjs 4.0.1 (script-tag bundle, exposes `window.PptxGenJS` and `window.JSZip`), Node 24 (native type-stripping, used to run the unit tests).

**Spec:** [docs/superpowers/specs/2026-07-26-briefing-comments-design.md](../specs/2026-07-26-briefing-comments-design.md)

## Global Constraints

- **Work in `master`, in place.** No branch, no worktree. (Standing user preference.)
- **Do not commit.** Each task ends with a verification step, not a commit. If you want a commit, the command is `git add <files> && git commit -m "<msg>"`, but do not run it unless asked.
- **`npx tsc` is a no-op stub in this repo.** Type-check with `node node_modules/typescript/bin/tsc -p tsconfig.build.json`, and expect ~3000 pre-existing `TS2307` `@arcgis/core` resolution errors. Filter output to the files you touched; never treat the baseline as broken.
- **The user runs the dev server.** Do not start one. Ask the user to reload their existing `npm run dev` (port 6547) when a task needs GUI verification.
- **No test framework exists.** Tests are standalone scripts in the style of `MS/Engines/ImportExport/Plan.test.ts`, run with bare `node`. Node's ESM resolver rejects extensionless imports (which Vite accepts), so **any module a test imports must have zero runtime imports** — `import type` only, which type-stripping erases.
- **`fabric` is a CDN global.** Never `import` it; read `(window as any).fabric`.
- **Comments are never fabric objects.** `fabricToOverlay` would sweep them into `overlays[]` and the exporter would emit them as shapes.
- **Comments are outside the undo stack.** `_snapshotJson()` stays the overlay array only. Delete confirms instead.
- Normalized coordinates are `[0..1]` against the canvas, top-left origin — the same space as `SlideOverlay`.
- `p:pos` in PowerPoint comment XML is in **eighth-points** (1/8 pt = 1/576 in), not EMU. `LAYOUT_16x9` is 10 × 5.625 in = 5760 × 3240 eighth-points.

## File Structure

| File | Responsibility |
| --- | --- |
| `MS/Engines/Briefing/BriefingTypes.ts` *(modify)* | `SlideCommentEntry`, `SlideComment`, `Slide.comments`, `BriefingDocument.version` → 7. |
| `MS/Engines/Briefing/SlideCommentUtils.ts` *(create)* | Pure core: anchor projection, relative time, dangling-anchor pruning, id minting. **Zero runtime imports.** |
| `MS/Engines/Briefing/SlideCommentUtils.test.ts` *(create)* | Node unit tests for the above. |
| `MS/Engines/Briefing/SlideComments.ts` *(create)* | `CommentsLayer`: marker layer, arm/hover/place flow, composer, thread popover, author name. |
| `MS/Engines/Briefing/SlideEditorUI.ts` *(modify)* | 💬 topbar button, `comment` icon, `.ms-sledit-cmt*` CSS, rail thumb badge, Comments review section, help line. |
| `MS/Engines/Briefing/SlideEditor.ts` *(modify)* | Owns `_comments` working array; mounts/refreshes the layer; `N` / `Ctrl+Alt+M`; Escape rung; save patch. |
| `MS/Engines/Briefing/BriefingEngine.ts` *(modify)* | Persist comments, strip badge, `listComments()`. |
| `MS/Engines/ImportExport/PptxComments.ts` *(create)* | Pure comment-part XML builders + JSZip injection glue. **Zero runtime imports.** |
| `MS/Engines/ImportExport/PptxComments.test.ts` *(create)* | Node unit tests for the pure builders. |
| `MS/Engines/ImportExport/PptxExporter.ts` *(modify)* | `writeFile` → `write` + inject + blob download; pptx-slide↔briefing-slide map. |

Phase 1 is Tasks 1–4 (editor-side, GUI-verifiable). Phase 2 is Tasks 5–6 (PowerPoint emit).

---

### Task 1: Data model and pure comment core

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts`
- Create: `MS/Engines/Briefing/SlideCommentUtils.ts`
- Test: `MS/Engines/Briefing/SlideCommentUtils.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SlideCommentEntry`, `SlideComment`, `Slide.comments` (types). From `SlideCommentUtils.ts`: `commentUuid(): string`, `projectAnchor(nx: number, ny: number, size: {w:number;h:number}, vpt: readonly number[]): {left:number;top:number}`, `relTime(iso: string, now?: number): string`, `pruneComments(comments: readonly SlideComment[], overlayIds: ReadonlySet<string>): SlideComment[]`, `threadCount(c: SlideComment): number`, `openCount(comments: readonly SlideComment[] | undefined): number`.

- [ ] **Step 1: Add the types to `BriefingTypes.ts`**

Insert immediately after the `SlideOverlay` interface's closing brace (currently line 286), before `export interface BuildStep`:

```ts
/** One authored message: the thread opener, or a reply. */
export interface SlideCommentEntry {
  id: string;
  author: string;
  text: string;
  /** ISO datetime. */
  at: string;
}

/**
 * A review comment thread. Editor-only: never drawn in present mode, in
 * thumbnails or in any rasterized export — but saved with the slide so it
 * travels with the briefing, and emitted as a real PowerPoint comment by
 * PptxExporter.
 *
 * Anchors, in the order they are checked: `overlayId` (pinned to an
 * annotation), then `x`/`y` (a spot on the slide), then neither (the slide as a
 * whole). Coordinates are normalized [0..1] like SlideOverlay's, so a thread
 * stays put when the editor canvas is resized and maps straight into the PPTX
 * contain-fit rectangle.
 */
export interface SlideComment extends SlideCommentEntry {
  /**
   * The overlay this thread is pinned to (`SlideOverlay.id`). Dangling ids are
   * dropped on load, so deleting an annotation turns its threads into
   * slide-level ones rather than orphaning them.
   */
  overlayId?: string;
  /** Normalized point anchor. Used when there is no `overlayId`. */
  x?: number;
  y?: number;
  resolved?: boolean;
  replies?: SlideCommentEntry[];
}
```

- [ ] **Step 2: Add `comments` to `Slide` and bump the document version**

In `interface Slide`, after the `overlays?: SlideOverlay[];` line:

```ts
  /** Review comment threads — editor-only, never rendered. See SlideComment. */
  comments?: SlideComment[];
```

In `interface BriefingDocument`, replace the version doc-comment's first line and the type:

```ts
  /**
   * 7 = review comments; 6 = milsym overlays + block/tactical arrows; 5 = table
   * overlays + text listStyle; 4 = slides may be screen-only (imported PPTX: no
   * extent/camera); 3 = full-res backgroundDataUrl fallback; 2 = overlays; 1–7
   * accepted on import. Every added field is optional, so newer documents
   * degrade in older code rather than failing to load.
   */
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
```

- [ ] **Step 3: Write the failing test**

Create `MS/Engines/Briefing/SlideCommentUtils.test.ts`:

```ts
/**
 * SlideCommentUtils.test.ts — run with: node MS/Engines/Briefing/SlideCommentUtils.test.ts
 * House style follows MS/Engines/ImportExport/Plan.test.ts: plain console
 * assertions, non-zero exit on failure. No test framework in this repo.
 */
import {
  commentUuid,
  openCount,
  projectAnchor,
  pruneComments,
  relTime,
  threadCount,
} from './SlideCommentUtils.ts';
import type { SlideComment } from './BriefingTypes.ts';

let passed = 0;
let failed = 0;
/** Fixed timestamp — nothing here may depend on the wall clock. */
const t = '2026-07-26T12:00:00.000Z';

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}

console.log('projectAnchor');
// Identity viewport: normalized × canvas size, nothing else.
check(
  'identity vpt',
  projectAnchor(0.5, 0.25, { w: 800, h: 400 }, [1, 0, 0, 1, 0, 0]),
  { left: 400, top: 100 },
);
// 2× zoom about the origin doubles both axes.
check(
  '2x zoom',
  projectAnchor(0.5, 0.5, { w: 800, h: 400 }, [2, 0, 0, 2, 0, 0]),
  { left: 800, top: 400 },
);
// Pan translates after scaling.
check(
  'zoom + pan',
  projectAnchor(0.5, 0.5, { w: 800, h: 400 }, [2, 0, 0, 2, -100, -50]),
  { left: 700, top: 350 },
);
// A missing/short transform must not produce NaN.
check(
  'missing vpt falls back to identity',
  projectAnchor(0.25, 0.5, { w: 800, h: 400 }, []),
  { left: 200, top: 200 },
);

console.log('relTime');
const t0 = Date.parse('2026-07-26T12:00:00.000Z');
check('under 45s', relTime('2026-07-26T11:59:30.000Z', t0), 'just now');
check('minutes', relTime('2026-07-26T11:30:00.000Z', t0), '30m ago');
check('hours', relTime('2026-07-26T09:00:00.000Z', t0), '3h ago');
check('days', relTime('2026-07-24T12:00:00.000Z', t0), '2d ago');
check('unparseable', relTime('not-a-date', t0), 'just now');

console.log('pruneComments');
const comments: SlideComment[] = [
  { id: 'c1', author: 'A', text: 'on live overlay', at: t, overlayId: 'ov-live' },
  { id: 'c2', author: 'A', text: 'on dead overlay', at: t, overlayId: 'ov-gone' },
  { id: 'c3', author: 'A', text: 'point', at: t, x: 0.5, y: 0.5 },
  { id: 'c4', author: 'A', text: 'slide', at: t },
];
const pruned = pruneComments(comments, new Set(['ov-live']));
check('live overlay anchor kept', pruned[0].overlayId, 'ov-live');
check('dead overlay anchor dropped', pruned[1].overlayId, undefined);
check('dead overlay thread survives as slide-level', pruned[1].text, 'on dead overlay');
check('point anchor untouched', [pruned[2].x, pruned[2].y], [0.5, 0.5]);
check('nothing removed', pruned.length, 4);
check('input not mutated', comments[1].overlayId, 'ov-gone');

console.log('threadCount / openCount');
check('opener only', threadCount({ id: 'x', author: 'A', text: 't', at: t }), 1);
check(
  'opener + 2 replies',
  threadCount({
    id: 'x',
    author: 'A',
    text: 't',
    at: t,
    replies: [
      { id: 'r1', author: 'B', text: 'r', at: t },
      { id: 'r2', author: 'B', text: 'r', at: t },
    ],
  }),
  3,
);
check('openCount ignores resolved', openCount([
  { id: 'a', author: 'A', text: 't', at: t },
  { id: 'b', author: 'A', text: 't', at: t, resolved: true },
]), 1);
check('openCount of undefined', openCount(undefined), 0);

console.log('commentUuid');
check('uuid shape', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(commentUuid()), true);
check('uuids differ', commentUuid() === commentUuid(), false);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
node MS/Engines/Briefing/SlideCommentUtils.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for `./SlideCommentUtils.ts` — the module does not exist yet.

- [ ] **Step 5: Write `SlideCommentUtils.ts`**

Create `MS/Engines/Briefing/SlideCommentUtils.ts`:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node MS/Engines/Briefing/SlideCommentUtils.test.ts
```

Expected: every line prefixed `✅`, final line `Results: 21 passed, 0 failed`, exit code 0.

- [ ] **Step 7: Type-check the touched files**

```bash
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SlideCommentUtils|BriefingTypes" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

---

### Task 2: Marker layer and thread popover

**Files:**
- Create: `MS/Engines/Briefing/SlideComments.ts`
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts` (CSS block only)
- Modify: `MS/Engines/Briefing/SlideEditor.ts`
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: everything Task 1 produced.
- Produces: `CommentsHost` interface and `class CommentsLayer` with `mount(stageWrap: HTMLElement, canvasEl: HTMLCanvasElement): void`, `unmount(): void`, `load(): void`, `refresh(): void`, `addComment(anchor: {overlayId?: string; x?: number; y?: number}, text: string, author: string): void`, `openThread(commentId: string): void`, `pendingThread: string | null`. On `SlideEditor`: private `_comments: SlideComment[]`. On `SlideEditorHost.onSaved`'s patch: `comments?: SlideComment[]`.

- [ ] **Step 1: Create `SlideComments.ts` with the host interface and marker rendering**

Create `MS/Engines/Briefing/SlideComments.ts`:

```ts
/**
 * SlideComments.ts
 *
 * Review comments for the briefing slide editor, ported from bento/slides'
 * editor/comments.ts. Threads live on Slide.comments — saved with the briefing,
 * shown only here, never drawn in present mode, thumbnails or rasterized
 * exports.
 *
 * Markers are DOM, never fabric objects: fabricToOverlay would otherwise sweep
 * them into overlays[] and PptxExporter would emit them as shapes. They are
 * positioned by projecting each normalized anchor through the canvas's
 * viewportTransform, so they track zoom (ctrl+wheel) and pan (space/middle-drag).
 *
 * The pure helpers live in SlideCommentUtils.ts — see the note there about why.
 */

import EngineLogger from '../../Support/EngineLogger';
import type { SlideComment, SlideCommentEntry } from './BriefingTypes';
import {
  commentUuid,
  projectAnchor,
  pruneComments,
  relTime,
  threadCount,
} from './SlideCommentUtils';

const ENGINE_NAME = 'SlideComments';
const AUTHOR_KEY = 'ms-briefing-author';
/** Objects this fraction of the canvas or larger never capture a comment. */
const BACKDROP_AREA = 0.8;
/** Vertical pitch of stacked slide-level markers, in px. */
const STACK_PITCH = 26;

export interface CommentsHost {
  /** Read the open slide's threads. CommentsLayer never mutates this array. */
  comments(): readonly SlideComment[];
  /** Commit a new array; the editor stores it and refreshes its badges. */
  setComments(next: SlideComment[]): void;
  /** The fabric canvas — null while a slide is loading. */
  canvas(): any | null;
  /** Canvas size in px: the normalized↔canvas conversion basis. */
  size(): { w: number; h: number };
}

/** The remembered display name, or null when none is stored yet. */
export function storedAuthor(): string | null {
  try {
    return localStorage.getItem(AUTHOR_KEY) || null;
  } catch {
    return null; // storage blocked
  }
}

export function setStoredAuthor(name: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, name);
  } catch {
    /* storage blocked — the name just won't persist */
  }
}

export class CommentsLayer {
  private _host: CommentsHost;
  private _layer: HTMLElement | null = null;
  private _canvasEl: HTMLCanvasElement | null = null;
  private _fresh: string | null = null;
  /** A thread to open once the next load() finishes (cross-slide navigation). */
  public pendingThread: string | null = null;

  constructor(host: CommentsHost) {
    this._host = host;
  }

  // ── Mounting ───────────────────────────────────────────────────────────────

  /**
   * Build the marker layer over `canvasEl`. Called from _initCanvas AFTER the
   * canvas is appended, because _initCanvas clears stageWrap.innerHTML on
   * every slide load — same reason ui.remountPanel() is called there.
   */
  public mount(stageWrap: HTMLElement, canvasEl: HTMLCanvasElement): void {
    this.unmount();
    this._canvasEl = canvasEl;
    const layer = document.createElement('div');
    layer.className = 'ms-sledit-cmtlayer';
    stageWrap.appendChild(layer);
    this._layer = layer;
  }

  public unmount(): void {
    this._closePopover();
    this._layer?.remove();
    this._layer = null;
    this._canvasEl = null;
  }

  /** Drop dangling overlay anchors, then draw. Called after each slide load. */
  public load(): void {
    const fc = this._host.canvas();
    const live = new Set<string>(
      ((fc?.getObjects?.() ?? []) as any[])
        .map((o) => o?.data?.id)
        .filter((id): id is string => typeof id === 'string'),
    );
    const before = this._host.comments();
    const after = pruneComments(before, live);
    const orphaned = after.filter((c, i) => before[i]?.overlayId && !c.overlayId).length;
    if (orphaned) {
      this._host.setComments(after);
      EngineLogger.nextStep(
        ENGINE_NAME,
        `${orphaned} comment(s) lost their annotation — kept as slide comments`,
      );
    }
    this.refresh();
    if (this.pendingThread) {
      const id = this.pendingThread;
      this.pendingThread = null;
      this.openThread(id);
    }
  }

  // ── Markers ────────────────────────────────────────────────────────────────

  /** Rebuild every marker at its current projected position. */
  public refresh(): void {
    const layer = this._layer;
    if (!layer) return;
    layer.innerHTML = '';
    const canvasEl = this._canvasEl;
    if (canvasEl) {
      // The canvas sits inside stagewrap's padding; the layer spans stagewrap,
      // so every marker is offset by the canvas's own position.
      layer.style.left = `${canvasEl.offsetLeft}px`;
      layer.style.top = `${canvasEl.offsetTop}px`;
      layer.style.width = `${canvasEl.clientWidth}px`;
      layer.style.height = `${canvasEl.clientHeight}px`;
    }
    const size = this._host.size();
    const vpt: readonly number[] = this._host.canvas()?.viewportTransform ?? [];
    let stack = 0;
    for (const c of this._host.comments()) {
      const marker = document.createElement('button');
      marker.className = 'ms-sledit-cmtmarker' + (c.resolved ? ' resolved' : '');
      if (c.id === this._fresh) {
        marker.classList.add('fresh');
        setTimeout(() => {
          this._fresh = null;
        }, 1200);
      }
      marker.textContent = String(threadCount(c));
      marker.title = `${c.author}: ${c.text.slice(0, 80)}`;
      const box = c.overlayId ? this._objectBox(c.overlayId) : null;
      if (box) {
        // Top-right corner of the live object, so the marker follows a drag.
        marker.style.left = `${box.left + box.width - 9}px`;
        marker.style.top = `${box.top - 9}px`;
      } else if (typeof c.x === 'number' && typeof c.y === 'number') {
        // Teardrop: its bottom-left tip sits ON the point.
        const p = projectAnchor(c.x, c.y, size, vpt);
        marker.classList.add('point');
        marker.style.left = `${p.left}px`;
        marker.style.top = `${p.top - 19}px`;
      } else {
        marker.style.left = '10px';
        marker.style.top = `${10 + stack * STACK_PITCH}px`;
        stack++;
      }
      marker.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openThread(c.id);
      });
      layer.appendChild(marker);
    }
  }

  /**
   * A live overlay's bounding box in canvas-element px, or null when the object
   * is gone (the thread then falls back to its stored point / slide anchor).
   */
  private _objectBox(
    overlayId: string,
  ): { left: number; top: number; width: number; height: number } | null {
    const fc = this._host.canvas();
    const obj = ((fc?.getObjects?.() ?? []) as any[]).find((o) => o?.data?.id === overlayId);
    if (!obj?.getBoundingRect) return null;
    // true, true = absolute coords including the viewport transform, so this is
    // already in the same space as projectAnchor's output.
    const r = obj.getBoundingRect(true, true);
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  // ── Mutation ───────────────────────────────────────────────────────────────

  /** Open a new thread. `anchor` empty = a slide-level comment. */
  public addComment(
    anchor: { overlayId?: string; x?: number; y?: number },
    text: string,
    author: string,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const comment: SlideComment = {
      id: commentUuid(),
      author,
      text: trimmed,
      at: new Date().toISOString(),
      ...(anchor.overlayId
        ? { overlayId: anchor.overlayId }
        : typeof anchor.x === 'number' && typeof anchor.y === 'number'
          ? { x: anchor.x, y: anchor.y }
          : {}),
    };
    this._fresh = comment.id;
    this._host.setComments([...this._host.comments(), comment]);
    this.refresh();
    EngineLogger.success(ENGINE_NAME, `Comment added by ${author}`);
  }

  private _reply(commentId: string, text: string, author: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: SlideCommentEntry = {
      id: commentUuid(),
      author,
      text: trimmed,
      at: new Date().toISOString(),
    };
    this._host.setComments(
      this._host.comments().map((c) =>
        c.id === commentId ? { ...c, replies: [...(c.replies ?? []), entry] } : { ...c },
      ),
    );
    this.refresh();
  }

  private _toggleResolved(commentId: string): void {
    this._host.setComments(
      this._host
        .comments()
        .map((c) => (c.id === commentId ? { ...c, resolved: !c.resolved } : { ...c })),
    );
    this.refresh();
  }

  private _delete(commentId: string): void {
    this._host.setComments(this._host.comments().filter((c) => c.id !== commentId));
    this.refresh();
  }
}
```

- [ ] **Step 2: Add the composer and thread popover to `SlideComments.ts`**

Append these methods inside `class CommentsLayer`, before its closing brace:

```ts
  // ── Popovers ───────────────────────────────────────────────────────────────

  private _popover: HTMLElement | null = null;
  private _popoverDismiss: ((ev: PointerEvent) => void) | null = null;

  private _closePopover(): void {
    if (this._popoverDismiss) {
      document.removeEventListener('pointerdown', this._popoverDismiss, true);
      this._popoverDismiss = null;
    }
    this._popover?.remove();
    this._popover = null;
  }

  /** Position a freshly built panel near client coords, kept on screen. */
  private _showPopover(panel: HTMLElement, clientX: number, clientY: number): void {
    this._closePopover();
    panel.className = 'ms-sledit-cmtpop';
    document.body.appendChild(panel);
    const w = panel.offsetWidth || 300;
    const h = panel.offsetHeight || 240;
    panel.style.left = `${Math.max(8, Math.min(clientX + 12, window.innerWidth - w - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(clientY - 12, window.innerHeight - h - 8))}px`;
    this._popover = panel;
    const dismiss = (ev: PointerEvent) => {
      if (!panel.contains(ev.target as Node)) this._closePopover();
    };
    this._popoverDismiss = dismiss;
    // Deferred, or the click that opened this panel would immediately close it.
    setTimeout(() => document.addEventListener('pointerdown', dismiss, true));
  }

  /**
   * The composer for a new thread. Asks for a display name too, but only the
   * first time — after that the name field is omitted entirely.
   */
  public openComposer(
    anchor: { overlayId?: string; x?: number; y?: number },
    clientX: number,
    clientY: number,
    anchorLabel: string,
  ): void {
    const panel = document.createElement('div');
    const known = storedAuthor();
    panel.innerHTML =
      `<div class="ms-sledit-cmthead"><span>${anchorLabel}</span></div>` +
      (known
        ? ''
        : '<input type="text" class="ms-sledit-cmtname" placeholder="Your name (shown on comments)">') +
      '<textarea class="ms-sledit-cmttext" rows="3" placeholder="Comment…"></textarea>' +
      '<div class="ms-sledit-cmtfoot">' +
      '<button data-cmt="ok" class="primary">Comment</button>' +
      '<button data-cmt="cancel">Cancel</button>' +
      '</div>';
    const textArea = panel.querySelector('.ms-sledit-cmttext') as HTMLTextAreaElement;
    const nameInput = panel.querySelector('.ms-sledit-cmtname') as HTMLInputElement | null;
    const commit = () => {
      const author = (nameInput ? nameInput.value.trim() : known) || '';
      if (!author) {
        nameInput?.focus();
        return;
      }
      if (!textArea.value.trim()) {
        textArea.focus();
        return;
      }
      if (nameInput) setStoredAuthor(author);
      this.addComment(anchor, textArea.value, author);
      this._closePopover();
    };
    panel.querySelector('[data-cmt="ok"]')?.addEventListener('click', commit);
    panel
      .querySelector('[data-cmt="cancel"]')
      ?.addEventListener('click', () => this._closePopover());
    // Ctrl/⌘+Enter commits; plain Enter stays a newline, since comments wrap.
    textArea.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        commit();
      }
    });
    this._showPopover(panel, clientX, clientY);
    (nameInput ?? textArea).focus();
  }

  /** Open a thread: entries, reply box, Resolve/Reopen, Delete. */
  public openThread(commentId: string): void {
    const c = this._host.comments().find((x) => x.id === commentId);
    if (!c) return;
    const marker = this._markerFor(commentId);
    const r = marker?.getBoundingClientRect();

    const panel = document.createElement('div');
    const label = c.overlayId
      ? 'Comment · annotation'
      : typeof c.x === 'number'
        ? `Comment · point (${c.x.toFixed(3)}, ${(c.y ?? 0).toFixed(3)})`
        : 'Comment · slide';
    const entries = [c, ...(c.replies ?? [])]
      .map(
        (e) =>
          '<div class="ms-sledit-cmtentry"><b></b><span class="ms-sledit-cmttime"></span><p></p></div>',
      )
      .join('');
    panel.innerHTML =
      `<div class="ms-sledit-cmthead"><span>${label}</span>` +
      `<button class="ms-sledit-cmtme" title="Change the name used on your new comments and replies"></button></div>` +
      `<div class="ms-sledit-cmtentries">${entries}</div>` +
      '<textarea class="ms-sledit-cmtreply" rows="2" placeholder="Reply…"></textarea>' +
      '<div class="ms-sledit-cmtfoot">' +
      '<button data-cmt="reply">Reply</button>' +
      `<button data-cmt="resolve">${c.resolved ? 'Reopen' : 'Resolve'}</button>` +
      '<button data-cmt="delete">Delete</button>' +
      '</div>';

    // textContent, never innerHTML — comment text is user input.
    const nodes = panel.querySelectorAll('.ms-sledit-cmtentry');
    [c, ...(c.replies ?? [])].forEach((e, i) => {
      const node = nodes[i];
      if (!node) return;
      (node.querySelector('b') as HTMLElement).textContent = e.author;
      (node.querySelector('span') as HTMLElement).textContent = relTime(e.at);
      (node.querySelector('p') as HTMLElement).textContent = e.text;
    });

    const me = panel.querySelector('.ms-sledit-cmtme') as HTMLButtonElement;
    const paintMe = () => {
      me.textContent = `you: ${storedAuthor() ?? '—'} ✎`;
    };
    paintMe();
    me.addEventListener('click', () => {
      const next = window.prompt('Name shown on your new comments:', storedAuthor() ?? '')?.trim();
      if (next) {
        setStoredAuthor(next);
        paintMe();
      }
    });

    const reply = panel.querySelector('.ms-sledit-cmtreply') as HTMLTextAreaElement;
    panel.querySelector('[data-cmt="reply"]')?.addEventListener('click', () => {
      const author = storedAuthor();
      if (!author) {
        window.alert('Set your name first (the ✎ control above).');
        return;
      }
      this._reply(commentId, reply.value, author);
      this._closePopover();
    });
    panel.querySelector('[data-cmt="resolve"]')?.addEventListener('click', () => {
      this._toggleResolved(commentId);
      this._closePopover();
    });
    // Comments are deliberately outside the undo stack, so this confirms.
    panel.querySelector('[data-cmt="delete"]')?.addEventListener('click', () => {
      if (!window.confirm('Delete this comment thread? This cannot be undone.')) return;
      this._delete(commentId);
      this._closePopover();
    });

    this._showPopover(panel, r ? r.right : window.innerWidth / 2, r ? r.top : 120);
    reply.focus();
  }

  private _markerFor(commentId: string): HTMLElement | null {
    const index = this._host.comments().findIndex((c) => c.id === commentId);
    if (index < 0) return null;
    return (this._layer?.children[index] as HTMLElement) ?? null;
  }
```

- [ ] **Step 3: Add the CSS block to `SlideEditorUI.ts`**

Inside `_injectStyles`'s template string, immediately after the `.ms-sledit-stagewrap canvas { … }` rule (around line 2477), add:

```css
      /* review comments — markers over the canvas, popover panels on body */
      .ms-sledit-cmtlayer { position: absolute; overflow: hidden; pointer-events: none; z-index: 12; }
      .ms-sledit-cmtmarker {
        position: absolute;
        pointer-events: auto;
        width: 19px; height: 19px;
        border: none;
        border-radius: 50% 50% 50% 3px;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 10px/19px inherit;
        text-align: center;
        padding: 0;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(3,7,12,0.45);
      }
      .ms-sledit-cmtmarker.resolved { opacity: 0.35; }
      .ms-sledit-cmtmarker:hover { transform: scale(1.15); }
      @keyframes ms-sledit-cmtpop {
        0% { transform: scale(0.3); }
        55% { transform: scale(1.35); }
        100% { transform: scale(1); }
      }
      .ms-sledit-cmtmarker.fresh { animation: ms-sledit-cmtpop 0.45s ease-out; }
      .ms-sledit-cmtpop {
        position: fixed;
        z-index: 10050;
        width: 300px;
        background: var(--sl-surface);
        border: 1px solid var(--sl-line);
        border-radius: 10px;
        box-shadow: 0 18px 44px rgba(2,5,10,0.55);
        padding: 11px 13px;
        color: var(--sl-text);
        font: 12.5px/1.45 inherit;
      }
      .ms-sledit-cmthead {
        display: flex; justify-content: space-between; align-items: baseline; gap: 8px;
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--sl-dim); margin-bottom: 8px;
      }
      .ms-sledit-cmtme {
        border: none; background: none; padding: 0; cursor: pointer;
        font: 600 10px/1.4 inherit; color: var(--sl-dim); white-space: nowrap;
      }
      .ms-sledit-cmtme:hover { color: var(--sl-text); }
      .ms-sledit-cmtentries {
        max-height: 220px; overflow-y: auto;
        display: flex; flex-direction: column; gap: 8px;
      }
      .ms-sledit-cmtentry b { font-size: 12px; }
      .ms-sledit-cmttime { font-size: 10.5px; color: var(--sl-dim); margin-left: 5px; }
      .ms-sledit-cmtentry p { margin: 2px 0 0; font-size: 12.5px; white-space: pre-wrap; }
      .ms-sledit-cmtname, .ms-sledit-cmttext, .ms-sledit-cmtreply {
        width: 100%; box-sizing: border-box; margin-top: 8px;
        font: inherit; font-size: 12.5px;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px; padding: 6px 8px;
      }
      .ms-sledit-cmttext, .ms-sledit-cmtreply { resize: vertical; }
      .ms-sledit-cmtname:focus, .ms-sledit-cmttext:focus, .ms-sledit-cmtreply:focus {
        outline: none; border-color: var(--sl-accent);
      }
      .ms-sledit-cmtfoot { display: flex; gap: 6px; margin-top: 8px; }
      .ms-sledit-cmtfoot button {
        flex: 1; justify-content: center; padding: 5px 6px; font-size: 11.5px;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px; cursor: pointer;
      }
      .ms-sledit-cmtfoot button:hover { background: rgba(255,255,255,0.12); }
      .ms-sledit-cmtfoot button.primary {
        background: var(--sl-accent); border-color: var(--sl-accent); color: #10161d; font-weight: 600;
      }
```

Before writing it, confirm the token names by reading the `:root` block at the top of `_injectStyles` and substitute the repo's actual variable names for `--sl-surface`, `--sl-line`, `--sl-text`, `--sl-dim`, `--sl-input`, `--sl-accent`. If a token like `--sl-dim` does not exist, use the nearest muted-text token that does.

- [ ] **Step 4: Wire the layer into `SlideEditor.ts`**

Add the imports at the top, after the `OverlayTable` import block:

```ts
import { CommentsLayer, type CommentsHost } from './SlideComments';
import { openCount } from './SlideCommentUtils';
```

Add `SlideComment` to the existing `BriefingTypes` type import list.

Add the fields beside the other private state (near `_undo` / `_redo`):

```ts
  /** Working copy of the open slide's threads — collected by _saveCurrent. */
  private _comments: SlideComment[] = [];
  private _cmt: CommentsLayer | null = null;
```

In `_buildStage`, after `this._ui.build(stage, slide);`:

```ts
    this._cmt = new CommentsLayer(this._commentsHost());
```

Add the host factory next to `_buildRailHost`:

```ts
  /**
   * The comment layer's view onto the editor. Ownership is one-way: this class
   * holds `_comments` for the open slide and _saveCurrent collects it, exactly
   * as the fabric canvas holds the working overlay state. The layer only reads
   * and commits whole arrays, so there is a single place a comment change can
   * enter the save path.
   */
  private _commentsHost(): CommentsHost {
    return {
      comments: () => this._comments,
      setComments: (next) => {
        this._comments = next;
        this._ui?.refreshRail();
        this._ui?.refreshComments();
      },
      canvas: () => this._fc,
      size: () => ({ w: this._W, h: this._H }),
    };
  }
```

In `_loadSlide`, alongside the other per-slide resets (just before `this._tool = 'select';`):

```ts
      this._comments = (slide.comments ?? []).map((c) => ({ ...c }));
```

In `_initCanvas`, immediately after `ui.remountPanel();`:

```ts
    // Same reason as remountPanel above: the innerHTML reset detached the layer.
    this._cmt?.mount(ui.stageWrap, canvasEl);
```

At the end of `_loadSlide`'s `try` block, after `this._setTool('select');`:

```ts
      this._cmt?.load();
```

In `_saveCurrent`'s `host.onSaved({...})` call, add:

```ts
        comments: this._comments.length ? this._comments : undefined,
```

In `close()`, beside the other teardown (near `this._laser = null;`):

```ts
    this._cmt?.unmount();
    this._cmt = null;
    this._comments = [];
```

- [ ] **Step 5: Add the refresh call sites in `SlideEditor.ts`**

The marker layer has to be repositioned wherever the viewport or canvas size changes. Add `this._cmt?.refresh();` at the end of each of:

- `_zoomTo` — after `this._ui?.setZoom(next);`
- `_resetZoom` — after `this._ui?.setZoom(1);`
- `_resizeStageToFit` — after `this._fc.requestRenderAll();`
- `_beginPan`'s inner `move` handler — after the `relativePan` call

And in `_initCanvas`, extend the two object handlers so overlay-anchored markers follow a drag. In the existing `object:modified` handler, after `this._ui?.refreshGeometry();`:

```ts
      this._cmt?.refresh();
```

And add a new handler beside it:

```ts
    // Overlay-anchored markers ride the object's live bounding box, so they
    // have to be repositioned during the drag, not only on its commit.
    this._fc.on('object:moving', () => this._cmt?.refresh());
    this._fc.on('object:scaling', () => this._cmt?.refresh());
```

- [ ] **Step 6: Widen the host patch type in `SlideEditor.ts`**

In `interface SlideEditorHost`, inside `onSaved`'s `patch` object type, add:

```ts
      comments?: SlideComment[];
```

- [ ] **Step 7: Add a no-op `refreshComments` to `SlideEditorUI.ts`**

Task 4 fills this in; it exists now so `_commentsHost` compiles:

```ts
  /** Redraw the Comments review section. Filled in with that section. */
  public refreshComments(): void {
    /* no-op until the Comments section exists */
  }
```

- [ ] **Step 8: Persist comments in `BriefingEngine.ts`**

In `_editorHost().onSaved`, after `s.overlays = patch.overlays;`:

```ts
        s.comments = patch.comments;
```

Add `SlideComment` to the `BriefingTypes` import list.

Bump the version in `exportBriefing()`:

```ts
    // version 7 = review comments; 6 = milsym overlays + block/tactical arrows;
    // 5 = table overlays + text listStyle; 4 = slides may be screen-only
    // (imported PPTX: no extent/camera, backgroundDataUrl is the slide);
    // 3 = full-res background fallback; 2 = editor overlays. Import accepts
    // 1–7 (every added field is optional, so it reads older documents
    // unchanged).
    return { version: 7, slides: this._slides.map((s) => ({ ...s })) };
```

- [ ] **Step 9: Type-check**

```bash
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SlideComments|SlideCommentUtils|SlideEditor\.ts|SlideEditorUI|BriefingEngine|BriefingTypes" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

- [ ] **Step 10: Verify in the GUI**

Ask the user to reload their dev server, then open the slide editor on a slide that has at least one annotation. In devtools console:

```js
const ed = await import('/MS/Engines/Briefing/SlideEditor.ts').then(m => m.default.getInstance());
// seed one of each anchor kind through the real API
const layer = ed._cmt;
const firstOverlayId = ed._fc.getObjects()[0]?.data?.id;
layer.addComment({ overlayId: firstOverlayId }, 'pinned to this shape', 'Tester');
layer.addComment({ x: 0.5, y: 0.5 }, 'middle of the slide', 'Tester');
layer.addComment({}, 'whole slide', 'Tester');
```

Confirm, one at a time:
1. Three markers appear — one at the annotation's top-right, one mid-canvas, one stacked at the top-left. The fresh one pulses.
2. Ctrl+wheel to zoom and space-drag to pan: all three markers stay glued to their anchors.
3. Drag the annotated shape: its marker follows during the drag, not just after.
4. Toggle the speaker-notes drawer (the canvas refits): markers stay correct.
5. Click a marker: the thread opens with author, relative time and text. Reply, then reopen — the count badge reads 2. Resolve — the marker dims. Delete — it confirms first, then goes.
6. Save & Close, reopen the editor: all threads are still there.
7. Export the briefing to JSON (`briefingEngine.saveBriefingToFile()`), open the file: `version` is 7 and the slide carries a `comments` array.
8. Start the slide show: **no markers appear**. Check a rail thumbnail: no markers baked into it.

Report which of the eight checks passed. Do not proceed to Task 3 until all eight do.

---

### Task 3: Arm, hover-preview and place

**Files:**
- Modify: `MS/Engines/Briefing/SlideComments.ts`
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts`
- Modify: `MS/Engines/Briefing/SlideEditor.ts`

**Interfaces:**
- Consumes: `CommentsLayer` from Task 2.
- Produces: on `CommentsLayer` — `arm(): void`, `disarm(): void`, `get armed(): boolean`, `onArmChange: ((on: boolean) => void) | null`. On `SlideEditorUI` — `setCommentMode(on: boolean): void`. On `SlideEditor` — private `_toggleCommentMode(): void`.

- [ ] **Step 1: Add the anchor hit-test and arming to `SlideComments.ts`**

Append inside `class CommentsLayer`:

```ts
  // ── Arming ─────────────────────────────────────────────────────────────────

  private _armCleanup: (() => void) | null = null;
  /** Notified when the tool arms/disarms, so the topbar button can light up. */
  public onArmChange: ((on: boolean) => void) | null = null;

  public get armed(): boolean {
    return !!this._armCleanup;
  }

  /**
   * Where a comment click at these client coords would land. Returns null when
   * the point is off the slide — the caller reads that as the WHOLE SLIDE.
   * Objects covering BACKDROP_AREA or more of the canvas never capture: a
   * comment "here" on scenery means the spot, not the backdrop.
   */
  public anchorAt(
    clientX: number,
    clientY: number,
  ): { x: number; y: number; overlayId?: string } | null {
    const canvasEl = this._canvasEl;
    const fc = this._host.canvas();
    if (!canvasEl || !fc) return null;
    const r = canvasEl.getBoundingClientRect();
    const size = this._host.size();
    const vpt: readonly number[] = fc.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    const zx = vpt[0] || 1;
    const zy = vpt[3] || 1;
    // Undo the viewport transform, then normalize.
    const cx = (clientX - r.left - (vpt[4] ?? 0)) / zx;
    const cy = (clientY - r.top - (vpt[5] ?? 0)) / zy;
    if (cx < 0 || cy < 0 || cx > size.w || cy > size.h) return null;
    const nx = cx / size.w;
    const ny = cy / size.h;
    const area = size.w * size.h;
    let hit: string | undefined;
    for (const obj of (fc.getObjects?.() ?? []) as any[]) {
      if (obj.visible === false || !obj.getBoundingRect) continue;
      // false, false = canvas coords, ignoring the viewport transform, which is
      // the space cx/cy were just converted back into.
      const b = obj.getBoundingRect(false, false);
      if (cx < b.left || cx > b.left + b.width || cy < b.top || cy > b.top + b.height) continue;
      if (b.width * b.height >= area * BACKDROP_AREA) continue;
      const id = obj?.data?.id;
      if (typeof id === 'string') hit = id; // later objects paint on top
    }
    return { x: nx, y: ny, overlayId: hit };
  }

  /**
   * Arm the one-shot placement mode. The listeners are capture-phase on
   * `document`, which propagates top-down and therefore fires before fabric's
   * own wrapperEl capture handler and before _onPreMouseDown — the same trick
   * bento uses to beat Selecto and Moveable.
   */
  public arm(stage: HTMLElement): void {
    if (this._armCleanup) {
      this.disarm();
      return;
    }
    this._closePopover();
    stage.classList.add('ms-sledit-cmtarmed');

    const hl = document.createElement('div');
    hl.className = 'ms-sledit-cmthl';
    this._layer?.parentElement?.appendChild(hl);
    const chip = document.createElement('div');
    chip.className = 'ms-sledit-cmtchip';
    chip.textContent = '💬 whole slide';
    chip.style.display = 'none';
    this._layer?.parentElement?.appendChild(chip);

    const cleanup = () => {
      this._armCleanup = null;
      stage.classList.remove('ms-sledit-cmtarmed');
      hl.remove();
      chip.remove();
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mousemove', onMove, true);
      this.onArmChange?.(false);
    };

    const onMove = (ev: MouseEvent) => {
      const inCanvasArea =
        ev.target instanceof Element && !!ev.target.closest('.ms-sledit-canvaswrap');
      if (!inCanvasArea) {
        hl.style.display = 'none';
        chip.style.display = 'none';
        return;
      }
      hl.style.display = '';
      const canvasEl = this._canvasEl;
      const a = this.anchorAt(ev.clientX, ev.clientY);
      const base = canvasEl
        ? { left: canvasEl.offsetLeft, top: canvasEl.offsetTop }
        : { left: 0, top: 0 };
      if (!a) {
        // On the canvas area but off the slide: the WHOLE SLIDE is the anchor.
        // Outline the slide and pin a chip to the cursor, where the eye is.
        hl.className = 'ms-sledit-cmthl slide';
        hl.style.left = `${base.left - 3}px`;
        hl.style.top = `${base.top - 3}px`;
        hl.style.width = `${(canvasEl?.clientWidth ?? 0) + 6}px`;
        hl.style.height = `${(canvasEl?.clientHeight ?? 0) + 6}px`;
        hl.textContent = '';
        const hostR = (this._layer?.parentElement ?? document.body).getBoundingClientRect();
        chip.style.display = '';
        chip.style.left = `${ev.clientX - hostR.left + 14}px`;
        chip.style.top = `${ev.clientY - hostR.top + 8}px`;
        return;
      }
      chip.style.display = 'none';
      const size = this._host.size();
      const vpt: readonly number[] = this._host.canvas()?.viewportTransform ?? [];
      if (a.overlayId) {
        const box = this._objectBox(a.overlayId);
        hl.className = 'ms-sledit-cmthl element';
        hl.style.left = `${base.left + (box?.left ?? 0) - 3}px`;
        hl.style.top = `${base.top + (box?.top ?? 0) - 3}px`;
        hl.style.width = `${(box?.width ?? 0) + 6}px`;
        hl.style.height = `${(box?.height ?? 0) + 6}px`;
        hl.textContent = '';
      } else {
        const p = projectAnchor(a.x, a.y, size, vpt);
        hl.className = 'ms-sledit-cmthl pin';
        hl.style.left = `${base.left + p.left}px`;
        hl.style.top = `${base.top + p.top}px`;
        hl.style.width = '';
        hl.style.height = '';
        hl.textContent = `${a.x.toFixed(3)}, ${a.y.toFixed(3)}`;
      }
    };

    const onDown = (ev: MouseEvent) => {
      const target = ev.target instanceof Element ? ev.target : null;
      // Let the topbar's own 💬 toggle handle its click.
      if (target?.closest('.ms-sledit-topbar')) return;
      if (!target?.closest('.ms-sledit-canvaswrap')) {
        cleanup(); // clicked other chrome: disarm without placing
        return;
      }
      const a = this.anchorAt(ev.clientX, ev.clientY);
      cleanup();
      ev.preventDefault();
      ev.stopPropagation();
      if (!a) {
        this.openComposer({}, ev.clientX, ev.clientY, 'Comment · slide');
      } else if (a.overlayId) {
        this.openComposer(
          { overlayId: a.overlayId },
          ev.clientX,
          ev.clientY,
          'Comment · annotation',
        );
      } else {
        this.openComposer(
          { x: a.x, y: a.y },
          ev.clientX,
          ev.clientY,
          `Comment · point (${a.x.toFixed(3)}, ${a.y.toFixed(3)})`,
        );
      }
    };

    this._armCleanup = cleanup;
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('mousemove', onMove, true);
    this.onArmChange?.(true);
  }

  public disarm(): void {
    this._armCleanup?.();
  }
```

- [ ] **Step 2: Add the hover-preview CSS to `SlideEditorUI.ts`**

Append to the comment CSS block added in Task 2:

```css
      .ms-sledit-cmtarmed .ms-sledit-canvaswrap,
      .ms-sledit-cmtarmed .ms-sledit-canvaswrap canvas { cursor: crosshair !important; }
      .ms-sledit-cmthl { position: absolute; pointer-events: none; z-index: 13; }
      .ms-sledit-cmthl.element {
        border: 2px dashed var(--sl-accent);
        border-radius: 5px;
        background: rgba(255,209,102,0.10);
      }
      .ms-sledit-cmthl.slide {
        border: 2px dashed var(--sl-accent);
        border-radius: 7px;
        background: rgba(255,209,102,0.05);
      }
      .ms-sledit-cmthl.pin {
        width: 0; height: 0;
        font: 600 10px/1 ui-monospace, Consolas, monospace;
        color: var(--sl-accent);
        white-space: nowrap;
        padding-left: 12px; padding-top: 2px;
      }
      .ms-sledit-cmthl.pin::before {
        content: '';
        position: absolute;
        left: -5px; top: -5px;
        width: 10px; height: 10px;
        border-radius: 50%;
        border: 2.5px solid var(--sl-accent);
        background: rgba(255,255,255,0.7);
      }
      .ms-sledit-cmtchip {
        position: absolute;
        z-index: 14;
        pointer-events: none;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 10px/1 inherit;
        padding: 5px 9px;
        border-radius: 999px;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(3,7,12,0.45);
      }
```

- [ ] **Step 3: Add the topbar button and its state to `SlideEditorUI.ts`**

Add to `ICONS`:

```ts
  comment: svg('<path d="M4 5h16v10.5H11l-4.5 3.5v-3.5H4z"/><path d="M8 8.6h8M8 11.6h5"/>'),
```

In the topbar template, in the `ms-sledit-topright` group, before the `notes` button:

```html
          <button data-act="comment" class="ms-sledit-iconbtn" title="Comment (N or Ctrl+Alt+M) — click an annotation, a spot on the slide, or off the slide for the whole slide">${ICONS.comment}</button>
```

Add the state setter beside `setToolLock`:

```ts
  /** Reflect the 💬 comment tool's armed state in the topbar. */
  public setCommentMode(on: boolean): void {
    const btn = this._bar?.querySelector('[data-act="comment"]') as HTMLElement | null;
    btn?.classList.toggle('active', on);
  }
```

- [ ] **Step 4: Wire the toggle, keys and Escape rung in `SlideEditor.ts`**

Add the toggle method beside `_setToolLock`:

```ts
  /**
   * Arm/disarm the comment tool. Comment mode and the drawing tools are
   * mutually exclusive and THIS class owns that rule — CommentsLayer has no
   * view of the tool state. Comment mode is deliberately not a Tool, so the
   * _setTool('select') every slide load performs cannot leave it armed.
   */
  private _toggleCommentMode(): void {
    const stage = this._stage;
    const layer = this._cmt;
    if (!stage || !layer) return;
    if (layer.armed) {
      layer.disarm();
      return;
    }
    this._setTool('select');
    layer.arm(stage);
  }
```

In `_buildStage`, after constructing the layer:

```ts
    this._cmt.onArmChange = (on) => this._ui?.setCommentMode(on);
```

In `_setTool`, as the first statement after the existing `this._ui?.hideContextMenu();`:

```ts
    this._cmt?.disarm(); // arming a tool cancels a pending comment placement
```

In `_onAction`'s switch, beside `case 'toolLock'`:

```ts
      case 'comment':
        this._toggleCommentMode();
        break;
```

In `_attachKeys`'s Escape ladder, **before** the `if (this._tool !== 'select')` rung:

```ts
        if (this._cmt?.armed) {
          this._cmt.disarm();
          return;
        }
```

In the plain-key block, beside the `k === 'q'` branch (inside `if (!e.shiftKey) {`):

```ts
          // 'c' is already the callout tool, so comments take 'n' (note).
          if (k === 'n') {
            e.preventDefault();
            e.stopPropagation();
            this._toggleCommentMode();
            return;
          }
```

And add PowerPoint's own New Comment chord. Put it with the other modifier shortcuts, in the `mod` branch, guarded on `e.altKey`:

```ts
        // Ctrl+Alt+M is PowerPoint's New Comment shortcut.
        if (e.altKey && k === 'm') {
          e.preventDefault();
          e.stopPropagation();
          this._toggleCommentMode();
          return;
        }
```

- [ ] **Step 5: Add the help-overlay line in `SlideEditorUI.ts`**

In the help overlay's shortcut table, in the same group as the tool-lock entry, add a row for `N · Ctrl+Alt+M` → `Comment — click an annotation, a spot, or off the slide for the whole slide`. Match the surrounding rows' exact markup.

- [ ] **Step 6: Type-check**

```bash
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SlideComments|SlideEditor\.ts|SlideEditorUI" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

- [ ] **Step 7: Verify in the GUI**

Reload, open the slide editor on a slide with at least one annotation and one large background-ish object if available.

1. Click 💬 (or press `N`): the button lights up and the cursor becomes a crosshair over the whole canvas area.
2. Hover an annotation: a dashed amber outline hugs it. Hover bare slide: a pin dot with normalized coordinates. Hover the grey surround: the whole slide outlines and a "💬 whole slide" chip follows the cursor.
3. Hover an object covering ≥80% of the slide: it does **not** outline — you get the point pin instead.
4. Click on an annotation: the composer opens, asks for your name the first time only, and Ctrl+Enter commits. A marker appears at the shape's corner.
5. Press `N`, then `Esc`: disarms, button unlights, no comment placed, and the editor does **not** close.
6. Press `N`, then click a drawing tool: comment mode disarms.
7. Press `Ctrl+Alt+M`: arms the same way.
8. Press `N` and click on the grey surround: a slide-level comment is created, stacked top-left.
9. With comment mode armed, clicking an annotation must **not** also select it in fabric — the capture-phase listener swallowed the click.

Report which of the nine checks passed.

---

### Task 4: Badges, review list and the public API

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts`
- Modify: `MS/Engines/Briefing/SlideEditor.ts`
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: `openCount` (Task 1), `CommentsLayer.openThread` / `pendingThread` (Task 2).
- Produces: `RailHost.slides()` entries widen with `openComments?: number`; `SlideEditorUI.refreshComments()` becomes real; `EditorUIHost` gains `comments(): readonly SlideComment[]`, `allComments(): Array<{slideIndex: number; comment: SlideComment}>` and `goToComment(slideIndex: number, commentId: string): void`; `BriefingEngine.listComments()` is public.

- [ ] **Step 1: Widen `RailHost` and badge the rail thumbs in `SlideEditorUI.ts`**

In `interface RailHost`:

```ts
  slides(): Array<{ title: string; thumb?: string; openComments?: number }>;
```

In `refreshRail()`'s `.map`, add the badge inside the tile markup, after the `ms-sledit-thumbnum` span:

```ts
        const badge = s.openComments
          ? `<span class="ms-sledit-thumbcmt" title="${s.openComments} open comment(s)">${s.openComments}</span>`
          : '';
```

and interpolate `${badge}` into the returned template right after the `ms-sledit-thumbnum` span.

Add the CSS to the comment block:

```css
      .ms-sledit-thumbcmt {
        position: absolute;
        top: 4px; right: 4px;
        min-width: 15px; height: 15px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--sl-accent);
        color: #10161d;
        font: 700 9.5px/15px inherit;
        text-align: center;
        z-index: 3;
      }
```

- [ ] **Step 2: Add the Comments review section to `SlideEditorUI.ts`**

In the stage template, inside `ms-sledit-slidesecs` and after the existing `data-sec="slide"` section:

```html
            <div class="ms-sledit-sec" data-sec="comments">
              <div class="ms-sledit-seclabel">Comments</div>
              <label class="ms-sledit-prow" data-row="cmtscope" title="List comments from every slide, not just this one">
                <span>All slides</span>
                <input type="checkbox" class="ms-sledit-cmtall">
              </label>
              <div class="ms-sledit-cmtlist"></div>
            </div>
```

Add to `EditorUIHost`:

```ts
  /** The open slide's threads — the Comments section's default scope. */
  comments(): readonly SlideComment[];
  /** Every thread in the briefing, for the "All slides" scope. */
  allComments(): Array<{ slideIndex: number; comment: SlideComment }>;
  /** Navigate to a thread — same slide opens it, another slide loads first. */
  goToComment(slideIndex: number, commentId: string): void;
```

Implement `refreshComments`, replacing the Task 2 no-op:

```ts
  /** Redraw the Comments review section for the current scope. */
  public refreshComments(): void {
    const box = this._stage?.querySelector('.ms-sledit-cmtlist') as HTMLElement | null;
    if (!box) return;
    const all = (this._stage?.querySelector('.ms-sledit-cmtall') as HTMLInputElement)?.checked;
    const rows = all
      ? this._host.allComments()
      : this._host.comments().map((comment) => ({ slideIndex: -1, comment }));
    if (!rows.length) {
      box.innerHTML = `<div class="ms-sledit-cmtempty">No comments${
        all ? '' : ' on this slide'
      } yet — press N and click.</div>`;
      return;
    }
    box.innerHTML = rows
      .map(({ slideIndex, comment: c }) => {
        const replies = c.replies?.length ?? 0;
        const where = c.overlayId ? 'annotation' : typeof c.x === 'number' ? 'point' : 'slide';
        return (
          `<button class="ms-sledit-cmtrow${c.resolved ? ' resolved' : ''}"` +
          ` data-cmt-id="${this._escape(c.id)}" data-cmt-slide="${slideIndex}">` +
          `<span class="ms-sledit-cmtrowhead"><b>${this._escape(c.author)}</b>` +
          `<i>${all && slideIndex >= 0 ? `slide ${slideIndex + 1} · ` : ''}${where}` +
          `${replies ? ` · ${replies} repl${replies === 1 ? 'y' : 'ies'}` : ''}</i></span>` +
          `<span class="ms-sledit-cmtrowtext">${this._escape(c.text.slice(0, 120))}</span>` +
          '</button>'
        );
      })
      .join('');
    box.onclick = (e) => {
      const row = (e.target as HTMLElement).closest('[data-cmt-id]') as HTMLElement | null;
      if (!row) return;
      this._host.goToComment(Number(row.dataset.cmtSlide), row.dataset.cmtId!);
    };
  }
```

Wire the scope checkbox where the other stage controls are wired (in the method that runs after `stage.innerHTML` is set, alongside `this.stageWrap = …`):

```ts
    const cmtAll = stage.querySelector('.ms-sledit-cmtall') as HTMLInputElement | null;
    if (cmtAll) cmtAll.onchange = () => this.refreshComments();
```

Add the CSS:

```css
      .ms-sledit-cmtempty { font-size: 11px; color: var(--sl-dim); padding: 4px 2px 6px; }
      .ms-sledit-cmtlist { display: flex; flex-direction: column; gap: 4px; }
      .ms-sledit-cmtrow {
        display: flex; flex-direction: column; gap: 2px;
        text-align: left; width: 100%;
        background: var(--sl-input); color: var(--sl-text);
        border: 1px solid var(--sl-line); border-radius: 7px;
        padding: 5px 7px; cursor: pointer; font: inherit;
      }
      .ms-sledit-cmtrow:hover { border-color: var(--sl-accent); }
      .ms-sledit-cmtrow.resolved { opacity: 0.45; }
      .ms-sledit-cmtrowhead { display: flex; gap: 6px; align-items: baseline; }
      .ms-sledit-cmtrowhead b { font-size: 11.5px; }
      .ms-sledit-cmtrowhead i { font-size: 10px; font-style: normal; color: var(--sl-dim); }
      .ms-sledit-cmtrowtext {
        font-size: 11.5px; color: var(--sl-dim);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
```

- [ ] **Step 3: Implement the three new host methods in `SlideEditor.ts`**

Add to the `new SlideEditorUI({ … })` options object in `_buildStage`:

```ts
      comments: () => this._comments,
      allComments: () => this._host?.listComments?.() ?? [],
      goToComment: (slideIndex, commentId) => this._goToComment(slideIndex, commentId),
```

Add the navigation method beside `_toggleCommentMode`:

```ts
  /**
   * Open a thread from the review list. `slideIndex` < 0 means "this slide".
   * A cross-slide jump goes through _loadSlide, which is async, so the thread
   * id is parked on the layer and consumed at the end of its load() — opening
   * it right after the call would race the rebuild.
   */
  private _goToComment(slideIndex: number, commentId: string): void {
    if (slideIndex < 0 || slideIndex === this._index) {
      this._cmt?.openThread(commentId);
      return;
    }
    if (this._opening || !this._cmt) return;
    this._cmt.pendingThread = commentId;
    this._saveCurrent();
    void this._loadSlide(slideIndex);
  }
```

Add `listComments` to `interface SlideEditorHost` as optional, so a host without it still compiles:

```ts
  /** Every thread in the briefing — powers the Comments section's All-slides scope. */
  listComments?(): Array<{ slideIndex: number; comment: SlideComment }>;
```

Also call `this._ui?.refreshComments();` at the end of `_loadSlide`'s `try` block, right after `this._cmt?.load();` — the section's scope is per-slide.

- [ ] **Step 4: Add `openComments`, the strip badge and `listComments()` to `BriefingEngine.ts`**

Import `openCount`:

```ts
import { openCount } from './SlideCommentUtils';
```

Widen `listSlides` in `_editorHost()`:

```ts
      listSlides: () =>
        this._slides.map((s, i) => ({
          title: s.title || `Slide ${i + 1}`,
          thumb: s.thumbnailDataUrl,
          openComments: openCount(s.comments),
        })),
```

Add the editor host's briefing-wide list, beside `listSlides`:

```ts
      listComments: () =>
        this._slides.flatMap((s, slideIndex) =>
          (s.comments ?? []).map((comment) => ({ slideIndex, comment })),
        ),
```

Add the public API next to `exportBriefing`:

```ts
  /**
   * Every review comment in the briefing, flattened with a typed anchor — the
   * entry point for scripting and tooling ("show me everything people flagged").
   */
  public listComments(): Array<{
    slideIndex: number;
    slideId: string;
    id: string;
    anchor:
      | { type: 'overlay'; overlayId: string }
      | { type: 'point'; x: number; y: number }
      | { type: 'slide' };
    author: string;
    at: string;
    text: string;
    resolved: boolean;
    replies: SlideCommentEntry[];
  }> {
    return this._slides.flatMap((s, slideIndex) =>
      (s.comments ?? []).map((c) => ({
        slideIndex,
        slideId: s.id,
        id: c.id,
        anchor: c.overlayId
          ? ({ type: 'overlay', overlayId: c.overlayId } as const)
          : typeof c.x === 'number' && typeof c.y === 'number'
            ? ({ type: 'point', x: c.x, y: c.y } as const)
            : ({ type: 'slide' } as const),
        author: c.author,
        at: c.at,
        text: c.text,
        resolved: !!c.resolved,
        replies: c.replies ?? [],
      })),
    );
  }
```

Add `SlideCommentEntry` to the `BriefingTypes` import list.

In `_refreshStrip`, badge slides with open threads. Find where each strip tile's markup is built and add, mirroring the rail badge:

```ts
      const open = openCount(s.comments);
      const cmtBadge = open
        ? `<span class="ms-brief-cmt" title="${open} open comment(s)">${open}</span>`
        : '';
```

Interpolate `${cmtBadge}` into the tile, and add to the panel's stylesheet:

```css
  .ms-brief-cmt {
    position: absolute; top: 3px; right: 3px;
    min-width: 15px; height: 15px; padding: 0 3px;
    border-radius: 999px; background: #ffd166; color: #10161d;
    font: 700 9.5px/15px sans-serif; text-align: center; z-index: 3;
  }
```

Match the surrounding markup and confirm the tile element is `position: relative` — add it if not, or the badge will anchor to the wrong box.

- [ ] **Step 5: Type-check**

```bash
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep -E "SlideComments|SlideEditor\.ts|SlideEditorUI|BriefingEngine" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

- [ ] **Step 6: Verify in the GUI**

1. With comments on two different slides, open the editor: the Comments section lists the current slide's threads with author, anchor kind and reply count.
2. Tick "All slides": threads from both slides appear, each labelled `slide N`.
3. Click a thread on the current slide: its popover opens.
4. Click a thread on the other slide: the editor navigates there **and** the popover opens once the slide has loaded.
5. Rail thumbnails show an open-count badge on both slides. Resolve every thread on one: its badge disappears.
6. Close the editor. The briefing strip panel shows the same badge.
7. In the console: `briefingEngine.listComments()` returns one row per thread with the right `anchor.type` for each of the three anchor kinds, plus `replies`.

Report which of the seven checks passed. Phase 1 is complete when they all do.

---

### Task 5: PowerPoint comment XML builders

**Files:**
- Create: `MS/Engines/ImportExport/PptxComments.ts`
- Test: `MS/Engines/ImportExport/PptxComments.test.ts`

**Interfaces:**
- Consumes: nothing (deliberately — this module has no runtime imports so the test can run under node).
- Produces: `PptxCommentRecord`, `PptxCommentParts`, `buildCommentParts(records)`, `addRelationship(relsXml, type, target)`, `addContentTypeOverrides(ctXml, overrides)`, `EIGHTH_POINTS_PER_INCH`, `REL_TYPE_COMMENTS`, `REL_TYPE_COMMENT_AUTHORS`, `CT_COMMENTS`, `CT_COMMENT_AUTHORS`.

- [ ] **Step 1: Write the failing test**

Create `MS/Engines/ImportExport/PptxComments.test.ts`:

```ts
/**
 * PptxComments.test.ts — run with: node MS/Engines/ImportExport/PptxComments.test.ts
 * Covers the PURE half of the comment injector; the JSZip glue is verified by
 * opening a real export in PowerPoint (see the plan's Task 6).
 */
import {
  addContentTypeOverrides,
  addRelationship,
  buildCommentParts,
  EIGHTH_POINTS_PER_INCH,
  REL_TYPE_COMMENTS,
  type PptxCommentRecord,
} from './PptxComments.ts';

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}
function contains(name: string, haystack: string, needle: string): void {
  if (haystack.includes(needle)) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       missing: ${needle}\n       in: ${haystack}`);
    failed++;
  }
}

console.log('units');
// 1/8 point = 1/576 inch. This constant is the whole reason comments land in
// the right place — PowerPoint reads p:pos as ST_EighthPointMeasure, not EMU.
check('eighth-points per inch', EIGHTH_POINTS_PER_INCH, 576);

const recs: PptxCommentRecord[] = [
  { slide: 1, author: 'Abdul', at: '2026-07-26T10:00:00.000Z', text: 'first', x: 100, y: 200 },
  { slide: 1, author: 'Abdul', at: '2026-07-26T10:05:00.000Z', text: 'second', x: 100, y: 200 },
  { slide: 3, author: 'Sara Khan', at: '2026-07-26T11:00:00.000Z', text: 'a < b & "c"', x: 50, y: 60 },
];
const parts = buildCommentParts(recs);

console.log('authors part');
contains('declares the pml namespace', parts.authorsXml,
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"');
contains('first author id 1, clrIdx 0', parts.authorsXml,
  '<p:cmAuthor id="1" name="Abdul" initials="A" lastIdx="2" clrIdx="0"/>');
contains('second author id 2, initials from both words', parts.authorsXml,
  '<p:cmAuthor id="2" name="Sara Khan" initials="SK" lastIdx="1" clrIdx="1"/>');

console.log('slide parts');
check('one part per commented slide', parts.slideParts.length, 2);
check('paths run 1..n over commented slides, not slide numbers',
  parts.slideParts.map((p) => p.path),
  ['ppt/comments/comment1.xml', 'ppt/comments/comment2.xml']);
check('parts carry their pptx slide number', parts.slideParts.map((p) => p.slide), [1, 3]);
contains('position emitted verbatim', parts.slideParts[0].xml, '<p:pos x="100" y="200"/>');
contains('idx increments per author', parts.slideParts[0].xml, 'idx="1"');
contains('second comment is idx 2', parts.slideParts[0].xml, 'idx="2"');
contains('dt drops the timezone suffix', parts.slideParts[0].xml, 'dt="2026-07-26T10:00:00.000"');
contains('text is XML-escaped', parts.slideParts[1].xml,
  '<p:text>a &lt; b &amp; &quot;c&quot;</p:text>');
contains('second author referenced by id', parts.slideParts[1].xml, 'authorId="2"');
check('no records means no parts', buildCommentParts([]).slideParts.length, 0);

console.log('addRelationship');
const rels =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="x" Target="a.xml"/>' +
  '<Relationship Id="rId7" Type="y" Target="b.xml"/>' +
  '</Relationships>';
const withRel = addRelationship(rels, REL_TYPE_COMMENTS, '../comments/comment1.xml');
contains('id is max+1, never a fixed number', withRel, 'Id="rId8"');
contains('keeps the existing relationships', withRel, 'Id="rId7"');
contains('inserted before the close tag', withRel, 'comment1.xml"/></Relationships>');
contains('empty rels part gets rId1',
  addRelationship(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
    REL_TYPE_COMMENTS,
    'x.xml',
  ),
  'Id="rId1"');

console.log('addContentTypeOverrides');
const ct =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/ppt/presentation.xml" ContentType="existing"/>' +
  '</Types>';
const withCt = addContentTypeOverrides(ct, [
  { partName: '/ppt/commentAuthors.xml', contentType: 'authors-ct' },
  { partName: '/ppt/comments/comment1.xml', contentType: 'comments-ct' },
]);
contains('adds the authors override', withCt,
  '<Override PartName="/ppt/commentAuthors.xml" ContentType="authors-ct"/>');
contains('adds a per-part comments override', withCt,
  '<Override PartName="/ppt/comments/comment1.xml" ContentType="comments-ct"/>');
contains('keeps existing overrides', withCt, 'PartName="/ppt/presentation.xml"');
check('an already-present override is not duplicated',
  (addContentTypeOverrides(withCt, [{ partName: '/ppt/commentAuthors.xml', contentType: 'authors-ct' }])
    .match(/commentAuthors\.xml/g) ?? []).length,
  1);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node MS/Engines/ImportExport/PptxComments.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for `./PptxComments.ts`.

- [ ] **Step 3: Write the pure half of `PptxComments.ts`**

Create `MS/Engines/ImportExport/PptxComments.ts`:

```ts
/**
 * PptxComments.ts
 *
 * Native PowerPoint comments for the briefing exporter. pptxgenjs cannot write
 * comments, so the generated package is reopened and legacy PresentationML
 * comment parts are injected: ppt/commentAuthors.xml, one
 * ppt/comments/commentN.xml per commented slide, two relationships and two
 * content-type overrides.
 *
 * Legacy parts rather than modern threaded ones (p188): legacy is fully
 * specified in ISO/IEC 29500 and read by every PowerPoint version as well as
 * LibreOffice and Google Slides, where modern comments are a Microsoft
 * extension with GUID-named parts and thin public documentation.
 *
 * THE UNITS TRAP: ISO/IEC 29500 declares p:pos's x/y as ST_Coordinate (EMU),
 * but MS-OI29500 §19.4.5 note (b) records that PowerPoint actually reads them
 * as ST_EighthPointMeasure — 1/8 point, 1/576 inch. Writing EMUs puts every
 * marker in the slide's top-left corner.
 *
 * The XML and string work below is pure and separately exported so it can run
 * under bare `node` for tests, which is also why this module has NO runtime
 * imports (node's ESM resolver rejects the extensionless imports Vite accepts).
 */

/** 1/8 point = 1/576 inch — the unit of p:pos. See the note above. */
export const EIGHTH_POINTS_PER_INCH = 576;

export const REL_TYPE_COMMENTS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';
export const REL_TYPE_COMMENT_AUTHORS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors';
export const CT_COMMENTS =
  'application/vnd.openxmlformats-officedocument.presentationml.comments+xml';
export const CT_COMMENT_AUTHORS =
  'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml';

const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface PptxCommentRecord {
  /** 1-based pptx slide number this comment belongs to. */
  slide: number;
  author: string;
  /** ISO datetime. */
  at: string;
  text: string;
  /** Eighth-points from the slide's top-left. */
  x: number;
  y: number;
}

export interface PptxCommentParts {
  /** ppt/commentAuthors.xml */
  authorsXml: string;
  /** One per commented slide, in ascending slide order. */
  slideParts: Array<{ slide: number; path: string; xml: string }>;
}

function esc(v: string): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "Sara Khan" → "SK"; falls back to '?' for an empty name. */
function initialsOf(name: string): string {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters.slice(0, 4) || '?';
}

/**
 * PowerPoint writes `dt` without a timezone suffix, at millisecond precision.
 * An unparseable value falls back to the epoch rather than emitting `Invalid
 * Date`, which would make the part unreadable.
 */
function dtOf(iso: string): string {
  const ms = Date.parse(iso);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  return d.toISOString().replace(/Z$/, '');
}

/** Records → the XML of every part that has to be added to the package. */
export function buildCommentParts(records: readonly PptxCommentRecord[]): PptxCommentParts {
  // Authors are ids 1..n in first-seen order; clrIdx is id-1 so PowerPoint
  // gives each one a different marker colour.
  const authorIds = new Map<string, number>();
  for (const r of records) {
    if (!authorIds.has(r.author)) authorIds.set(r.author, authorIds.size + 1);
  }

  // idx is unique per author across the whole document, starting at 1.
  const nextIdx = new Map<string, number>();
  const bySlide = new Map<number, string[]>();
  for (const r of [...records].sort((a, b) => a.slide - b.slide)) {
    const idx = (nextIdx.get(r.author) ?? 0) + 1;
    nextIdx.set(r.author, idx);
    const cm =
      `<p:cm authorId="${authorIds.get(r.author)}" dt="${dtOf(r.at)}" idx="${idx}">` +
      `<p:pos x="${Math.round(r.x)}" y="${Math.round(r.y)}"/>` +
      `<p:text>${esc(r.text)}</p:text>` +
      '</p:cm>';
    const list = bySlide.get(r.slide);
    if (list) list.push(cm);
    else bySlide.set(r.slide, [cm]);
  }

  const authorsXml =
    `${XML_DECL}<p:cmAuthorLst xmlns:p="${PML_NS}">` +
    [...authorIds.entries()]
      .map(
        ([name, id]) =>
          `<p:cmAuthor id="${id}" name="${esc(name)}" initials="${esc(initialsOf(name))}"` +
          ` lastIdx="${nextIdx.get(name) ?? 1}" clrIdx="${id - 1}"/>`,
      )
      .join('') +
    '</p:cmAuthorLst>';

  // The part NUMBER counts commented slides, not slide numbers: a deck whose
  // only comments are on slide 3 gets ppt/comments/comment1.xml.
  const slideParts = [...bySlide.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slide, cms], i) => ({
      slide,
      path: `ppt/comments/comment${i + 1}.xml`,
      xml: `${XML_DECL}<p:cmLst xmlns:a="${DML_NS}" xmlns:p="${PML_NS}">${cms.join('')}</p:cmLst>`,
    }));

  return { authorsXml, slideParts };
}

/**
 * Append a Relationship, allocating `rId(max+1)` **within this specific rels
 * part**. A fixed id would collide with pptxgenjs's own numbering and silently
 * break the package.
 */
export function addRelationship(relsXml: string, type: string, target: string): string {
  let max = 0;
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) {
    max = Math.max(max, Number(m[1]));
  }
  const rel = `<Relationship Id="rId${max + 1}" Type="${type}" Target="${esc(target)}"/>`;
  return relsXml.replace('</Relationships>', `${rel}</Relationships>`);
}

/** Append `<Override>` entries before `</Types>`, skipping any already present. */
export function addContentTypeOverrides(
  ctXml: string,
  overrides: ReadonlyArray<{ partName: string; contentType: string }>,
): string {
  const add = overrides
    .filter((o) => !ctXml.includes(`PartName="${o.partName}"`))
    .map((o) => `<Override PartName="${o.partName}" ContentType="${o.contentType}"/>`)
    .join('');
  return add ? ctXml.replace('</Types>', `${add}</Types>`) : ctXml;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node MS/Engines/ImportExport/PptxComments.test.ts
```

Expected: every check `✅`, final line `Results: 22 passed, 0 failed`, exit code 0.

- [ ] **Step 5: Type-check**

```bash
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit 2>&1 | grep "PptxComments" || echo "no errors in touched files"
```

Expected: `no errors in touched files`.

---

### Task 6: Inject the comment parts on export

**Files:**
- Modify: `MS/Engines/ImportExport/PptxComments.ts`
- Modify: `MS/Engines/ImportExport/PptxExporter.ts`

**Interfaces:**
- Consumes: everything Task 5 produced; `Slide.comments` (Task 1); `BriefingEngine.getSlides()`.
- Produces: `injectPptxComments(pkg: ArrayBuffer, records: readonly PptxCommentRecord[]): Promise<Blob>`.

- [ ] **Step 1: Add the JSZip glue to `PptxComments.ts`**

Append:

```ts
export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/**
 * Inject legacy comment parts into a pptxgenjs-generated package.
 *
 * `window.JSZip` is read INSIDE the function, never at module scope, so this
 * module stays importable in node for the unit tests. The global is the pptxgen
 * bundle's first UMD segment — the same one PptxImporter already relies on, so
 * it is present whenever an export has just run.
 */
export async function injectPptxComments(
  pkg: ArrayBuffer,
  records: readonly PptxCommentRecord[],
): Promise<Blob> {
  const JSZip = (globalThis as any).JSZip;
  if (!JSZip) throw new Error('window.JSZip unavailable — cannot inject comments');
  const zip = await JSZip.loadAsync(pkg);
  const parts = buildCommentParts(records);
  if (!parts.slideParts.length) return zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME });

  zip.file('ppt/commentAuthors.xml', parts.authorsXml);
  for (const p of parts.slideParts) zip.file(p.path, p.xml);

  // presentation.xml.rels → commentAuthors.xml
  const presRelsPath = 'ppt/_rels/presentation.xml.rels';
  const presRels = await zip.file(presRelsPath)?.async('string');
  if (!presRels) throw new Error(`${presRelsPath} missing from the generated package`);
  zip.file(
    presRelsPath,
    addRelationship(presRels, REL_TYPE_COMMENT_AUTHORS, 'commentAuthors.xml'),
  );

  // slideN.xml.rels → ../comments/commentM.xml
  for (const p of parts.slideParts) {
    const relPath = `ppt/slides/_rels/slide${p.slide}.xml.rels`;
    const rels = await zip.file(relPath)?.async('string');
    if (!rels) throw new Error(`${relPath} missing — cannot attach comments to slide ${p.slide}`);
    const target = `../comments/${p.path.split('/').pop()}`;
    zip.file(relPath, addRelationship(rels, REL_TYPE_COMMENTS, target));
  }

  // [Content_Types].xml → one override per part
  const ctPath = '[Content_Types].xml';
  const ct = await zip.file(ctPath)?.async('string');
  if (!ct) throw new Error(`${ctPath} missing from the generated package`);
  zip.file(
    ctPath,
    addContentTypeOverrides(ct, [
      { partName: '/ppt/commentAuthors.xml', contentType: CT_COMMENT_AUTHORS },
      ...parts.slideParts.map((p) => ({
        partName: `/${p.path}`,
        contentType: CT_COMMENTS,
      })),
    ]),
  );

  return zip.generateAsync({ type: 'blob', mimeType: PPTX_MIME });
}
```

- [ ] **Step 2: Collect comment records while emitting slides in `PptxExporter.ts`**

Add the import:

```ts
import {
  EIGHTH_POINTS_PER_INCH,
  injectPptxComments,
  PPTX_MIME,
  type PptxCommentRecord,
} from './PptxComments';
```

Declare the collector beside the existing `stats` in the export method:

```ts
    const commentRecords: PptxCommentRecord[] = [];
    let skippedResolved = 0;
    // pptxgenjs names slide parts in add order, so the pptx slide number is
    // just the running emit count.
    let pptxSlideNo = 0;
```

Every `await this._addSlide(...)` site is followed by `emitted++`. Add `pptxSlideNo++;` beside each one. Then, in the three branches, collect comments for the **first** pptx slide of each briefing slide only:

- In the screen-only branch, after `emitted++`:

```ts
          this._collectComments(commentRecords, slide, pptxSlideNo, view, (n) => {
            skippedResolved += n;
          });
```

- In the `explodeBuilds` branch, inside the reveal loop, guarded to the base frame:

```ts
            // Only the first pptx slide of a build sequence carries the
            // comments — otherwise every build frame would repeat them.
            if (reveal === 0) {
              this._collectComments(commentRecords, slide, pptxSlideNo, view, (n) => {
                skippedResolved += n;
              });
            }
```

- In the plain branch, after `emitted++`, the same call as the screen-only branch.

- [ ] **Step 3: Add the collector to `PptxExporter.ts`**

Add beside `_containFit`:

```ts
  /**
   * Turn a briefing slide's threads into comment records positioned in
   * eighth-points (1/8 pt = 1/576 in — the unit PowerPoint reads p:pos in; see
   * PptxComments.ts). Resolved threads are skipped: a resolved comment is
   * closed business. Replies become their own records at the SAME position,
   * which is how PowerPoint threads co-located legacy comments.
   */
  private _collectComments(
    into: PptxCommentRecord[],
    slide: BriefingSlide,
    pptxSlide: number,
    view: any,
    onSkipped: (n: number) => void,
  ): void {
    const threads = slide.comments ?? [];
    if (!threads.length) return;
    const fit = this._containFit(view);
    const toEighths = (inches: number) => Math.round(inches * EIGHTH_POINTS_PER_INCH);
    let skipped = 0;
    let stack = 0;
    for (const c of threads) {
      if (c.resolved) {
        skipped++;
        continue;
      }
      let xIn: number;
      let yIn: number;
      const ov = c.overlayId ? slide.overlays?.find((o) => o.id === c.overlayId) : undefined;
      if (ov) {
        // Box top-right, matching where the editor draws the marker.
        xIn = fit.x + (ov.x + ov.w) * fit.w;
        yIn = fit.y + ov.y * fit.h;
      } else if (typeof c.x === 'number' && typeof c.y === 'number') {
        xIn = fit.x + c.x * fit.w;
        yIn = fit.y + c.y * fit.h;
      } else {
        xIn = fit.x + 0.02 * fit.w;
        yIn = fit.y + (0.02 + stack * 0.05) * fit.h;
        stack++;
      }
      const x = toEighths(xIn);
      const y = toEighths(yIn);
      into.push({ slide: pptxSlide, author: c.author, at: c.at, text: c.text, x, y });
      for (const r of c.replies ?? []) {
        into.push({ slide: pptxSlide, author: r.author, at: r.at, text: r.text, x, y });
      }
    }
    if (skipped) onSkipped(skipped);
  }
```

Confirm `BriefingSlide` is the exporter's existing alias for the briefing `Slide` type; if it does not already expose `comments`, that is Task 1's `Slide.comments` and needs no further change.

- [ ] **Step 4: Replace the download in `PptxExporter.ts`**

Replace `await pptx.writeFile({ fileName });` with:

```ts
    // pptxgenjs cannot write comments, so the package is built in memory and
    // reopened to inject them — which also means the download becomes ours.
    const pkg: ArrayBuffer = await pptx.write({ outputType: 'arraybuffer' });
    const blob = commentRecords.length
      ? await injectPptxComments(pkg, commentRecords)
      : new Blob([pkg], { type: PPTX_MIME });
    this._downloadBlob(blob, fileName);
```

Add the download helper beside `_containFit`:

```ts
  /** Anchor-click download of an in-memory package. */
  private _downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
```

Extend the success log:

```ts
    EngineLogger.success(
      ENGINE_NAME,
      `PPTX exported — ${emitted} slides${
        mode === 'editable' ? `, ${stats.shapes} editable shapes` : ''
      }${commentRecords.length ? `, ${commentRecords.length} comment entries` : ''} → ${fileName}`,
    );
    if (skippedResolved) {
      EngineLogger.nextStep(
        ENGINE_NAME,
        `${skippedResolved} resolved comment thread(s) were not exported`,
      );
    }
```

- [ ] **Step 5: Re-run both unit test suites**

```bash
node MS/Engines/Briefing/SlideCommentUtils.test.ts && node MS/Engines/ImportExport/PptxComments.test.ts
```

Expected: both print `0 failed`.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: the Vite build succeeds. `tsc` afterwards reports only the pre-existing `@arcgis/core` `TS2307` baseline — grep for the touched filenames to confirm none of them appear.

- [ ] **Step 7: Verify the package structure**

Export a deck with comments from the GUI, then inspect the downloaded file (adjust the path):

```bash
python -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
names = [n for n in z.namelist() if 'comment' in n.lower()]
print('comment parts:', names)
print()
print(z.read('ppt/commentAuthors.xml').decode())
print()
for n in names:
    if n.startswith('ppt/comments/'):
        print(n, '->'); print(z.read(n).decode()); print()
ct = z.read('[Content_Types].xml').decode()
print('content-type overrides present:', 'commentAuthors' in ct, 'comments/comment1' in ct)
" "$HOME/Downloads/<exported file>.pptx"
```

Expected: `ppt/commentAuthors.xml` plus one `ppt/comments/commentN.xml` per commented slide; each `p:cm` carries a plausible `p:pos` (both values inside 0–5760 / 0–3240); both content-type overrides present.

- [ ] **Step 8: Verify in PowerPoint**

This is the step that checks the eighth-point conversion — nothing else can.

Open the exported `.pptx` in PowerPoint and confirm:
1. It opens with **no repair prompt**. A repair prompt means a malformed part or a bad relationship — check step 7's output before anything else.
2. The Comments pane lists the comments, attributed to the right authors.
3. Each comment marker sits where the marker sat in the slide editor — on its annotation, on its spot, or stacked at the slide's top-left. Markers bunched in the top-left corner mean the units are wrong.
4. Replies appear grouped with their parent comment.
5. Resolved threads are absent.

Report the result of each check. If markers are misplaced, capture one comment's editor-side normalized anchor and its `p:pos` from step 7 and compare against `normalized → inches → × 576` by hand before changing anything.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 Data model, version 7 | 1 (types), 2 step 8 (version bump) |
| §2 `SlideCommentUtils` split, projection, pruning | 1 |
| §2 `CommentsLayer`, mount, refresh call sites, ownership | 2 |
| §2 Placement flow, hit-test, backdrop rule, hover preview | 3 |
| §2 Composer, thread popover, author name | 2 |
| §2 Escape ladder rung | 3 step 4 |
| §3 💬 button, icon, CSS, help line | 2 step 3, 3 steps 2–5 |
| §3 Rail thumb badge | 4 step 1 |
| §3 Comments review section | 4 step 2 |
| §4 SlideEditor wiring, save patch | 2 steps 4–6 |
| §4 BriefingEngine persist, strip badge, `listComments()` | 2 step 8, 4 step 4 |
| §5 Pure builders, eighth-points, rel ids, content types | 5 |
| §5 JSZip glue, replies, resolved skipping, build mapping | 6 |
| §5 Exporter download rewiring | 6 step 4 |
| §6 Two-phase sequencing | Tasks 1–4, then 5–6 |

No spec requirement is unassigned.

**Placeholder scan:** every code step carries complete code; every command has an expected result. The two places that say "confirm the surrounding markup" (Task 2 step 3's CSS tokens, Task 4 step 4's strip tile) are deliberate — they name exactly what to check and what to do if it differs, because the target markup has to be read at that moment rather than guessed here.

**Type consistency:** `openCount` / `threadCount` / `pruneComments` / `projectAnchor` / `relTime` / `commentUuid` are defined in Task 1 and used with those exact names in Tasks 2–4. `CommentsHost` has four members in Task 2 and no task adds a fifth. `refreshComments()` is stubbed in Task 2 step 7 and implemented in Task 4 step 2 — same name, same zero-arg signature. `EIGHTH_POINTS_PER_INCH`, `PPTX_MIME`, `injectPptxComments`, `PptxCommentRecord` are defined in Task 5/6 step 1 and consumed under those names in Task 6. `SlideEditorHost.listComments?()` returns `Array<{slideIndex, comment}>`, matching what `BriefingEngine._editorHost().listComments` returns and what `EditorUIHost.allComments()` expects — note this is deliberately a different shape from the public `BriefingEngine.listComments()`, which returns the flattened typed-anchor rows for scripting.
