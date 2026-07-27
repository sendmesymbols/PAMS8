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
/** Vertical pitch of stacked slide-level markers, in px. */
const STACK_PITCH = 26;
/** Objects this fraction of the canvas or larger never capture a comment. */
const BACKDROP_AREA = 0.8;

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
    // Arming attaches document-level listeners (mousedown, mousemove) stored in
    // _armCleanup. Tearing down without disarming would leave them holding a
    // closure over the discarded DOM, layer, and overlay elements.
    this.disarm();
    this.closePopover();
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

  // ── Popovers ───────────────────────────────────────────────────────────────

  private _popover: HTMLElement | null = null;
  private _popoverDismiss: ((ev: PointerEvent) => void) | null = null;

  public closePopover(): void {
    if (this._popoverDismiss) {
      document.removeEventListener('pointerdown', this._popoverDismiss, true);
      this._popoverDismiss = null;
    }
    this._popover?.remove();
    this._popover = null;
  }

  /** Position a freshly built panel near client coords, kept on screen. */
  private _showPopover(panel: HTMLElement, clientX: number, clientY: number): void {
    this.closePopover();
    panel.className = 'ms-sledit-cmtpop';
    document.body.appendChild(panel);
    const w = panel.offsetWidth || 300;
    const h = panel.offsetHeight || 240;
    panel.style.left = `${Math.max(8, Math.min(clientX + 12, window.innerWidth - w - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(clientY - 12, window.innerHeight - h - 8))}px`;
    this._popover = panel;
    const dismiss = (ev: PointerEvent) => {
      if (!panel.contains(ev.target as Node)) this.closePopover();
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
      this.closePopover();
    };
    panel.querySelector('[data-cmt="ok"]')?.addEventListener('click', commit);
    panel
      .querySelector('[data-cmt="cancel"]')
      ?.addEventListener('click', () => this.closePopover());
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
        // Only the count matters here — each entry's fields are filled in by
        // index below, via textContent.
        (_e) =>
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
      this.closePopover();
    });
    panel.querySelector('[data-cmt="resolve"]')?.addEventListener('click', () => {
      this._toggleResolved(commentId);
      this.closePopover();
    });
    // Comments are deliberately outside the undo stack, so this confirms.
    panel.querySelector('[data-cmt="delete"]')?.addEventListener('click', () => {
      if (!window.confirm('Delete this comment thread? This cannot be undone.')) return;
      this._delete(commentId);
      this.closePopover();
    });

    this._showPopover(panel, r ? r.right : window.innerWidth / 2, r ? r.top : 120);
    reply.focus();
  }

  private _markerFor(commentId: string): HTMLElement | null {
    const index = this._host.comments().findIndex((c) => c.id === commentId);
    if (index < 0) return null;
    return (this._layer?.children[index] as HTMLElement) ?? null;
  }

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
    this.closePopover();
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
}
