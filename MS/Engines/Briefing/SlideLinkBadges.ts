/**
 * SlideLinkBadges.ts
 *
 * The 🔗 pip drawn on every linked annotation in the slide editor. A link is not
 * a visual property — nothing about the object changes — so without a marker
 * there is no way to see which shapes are buttons.
 *
 * Badges are DOM, never fabric objects, for the same reason comment markers are
 * (see SlideComments' header): the editor saves by mapping every canvas object
 * through fabricToOverlay, so a decorative fabric object would be persisted as a
 * real annotation. They ride each object's live bounding box, so they follow a
 * drag, a scale and the canvas viewport transform.
 */

import type { SlideOverlay } from './BriefingTypes';
import { isUsableLink } from './SlideLinks';

/**
 * Chain-link glyph, inlined rather than taken from SlideEditorUI's ICONS map —
 * that module imports THIS one, so borrowing its helper would make a cycle.
 *
 * Monochrome on purpose: this used to be the 🔗 emoji, which browsers render in
 * their own fixed colours, so CSS `color` had no effect and the badge could not
 * be made to read against the slide. Drawn with `currentColor` and a heavier
 * stroke than the editor's 1.6 default, because it renders at 11px.
 */
const LINK_GLYPH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"' +
  ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>' +
  '<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>' +
  '</svg>';

export interface LinkBadgeHost {
  /** The live fabric canvas, or null while a slide is loading. */
  canvas(): any;
  /** Hover text for a badge — the editor routes this to SlideLinks.linkTooltip. */
  tooltip(link: NonNullable<SlideOverlay['link']>): string;
  /** Badge clicked: select that object and open the link dialog. */
  onOpen(overlayId: string): void;
}

export class LinkBadgeLayer {
  private _host: LinkBadgeHost;
  private _layer: HTMLElement | null = null;
  private _canvasEl: HTMLCanvasElement | null = null;

  constructor(host: LinkBadgeHost) {
    this._host = host;
  }

  /**
   * Build the badge layer over `canvasEl`. Called from _initCanvas AFTER the
   * canvas is appended — _initCanvas clears stageWrap.innerHTML on every slide
   * load, exactly as for the comments layer.
   */
  public mount(stageWrap: HTMLElement, canvasEl: HTMLCanvasElement): void {
    this.unmount();
    this._canvasEl = canvasEl;
    const layer = document.createElement('div');
    layer.className = 'ms-sledit-linklayer';
    stageWrap.appendChild(layer);
    this._layer = layer;
  }

  public unmount(): void {
    this._layer?.remove();
    this._layer = null;
    this._canvasEl = null;
  }

  /** Rebuild every badge at its object's current projected position. */
  public refresh(): void {
    const layer = this._layer;
    if (!layer) return;
    layer.innerHTML = '';
    const canvasEl = this._canvasEl;
    if (canvasEl) {
      // The canvas sits inside stagewrap's padding; the layer spans stagewrap,
      // so every badge is offset by the canvas's own position.
      layer.style.left = `${canvasEl.offsetLeft}px`;
      layer.style.top = `${canvasEl.offsetTop}px`;
      layer.style.width = `${canvasEl.clientWidth}px`;
      layer.style.height = `${canvasEl.clientHeight}px`;
    }
    const objects: any[] = this._host.canvas()?.getObjects?.() ?? [];
    for (const obj of objects) {
      const link = obj?.data?.link;
      const id = obj?.data?.id;
      if (!isUsableLink(link) || !id || !obj.getBoundingRect) continue;
      // true, true = absolute coords including the viewport transform.
      const r = obj.getBoundingRect(true, true);
      const badge = document.createElement('button');
      badge.className = 'ms-sledit-linkbadge';
      badge.innerHTML = LINK_GLYPH;
      // Says what the link does AND both gestures — the badge itself edits, so
      // without this there is nothing telling you Ctrl+click follows.
      badge.title = `Link → ${this._host.tooltip(link)}\nClick to edit · Ctrl+click the object to go there`;
      // Top-LEFT corner, so it can't collide with a comment marker (which takes
      // the top-right) on an object that has both.
      badge.style.left = `${r.left - 8}px`;
      badge.style.top = `${r.top - 8}px`;
      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._host.onOpen(id);
      });
      layer.appendChild(badge);
    }
  }

  public static styles(): string {
    return `
      .ms-sledit-linklayer {
        position: absolute; overflow: hidden; pointer-events: none; z-index: 11;
      }
      /* A badge sits over arbitrary slide content — dark map imagery on one
         slide, a white imported raster on the next — so it carries its own
         contrast from BOTH sides: a saturated fill plus a near-white ring that
         reads on dark, and a dark drop shadow that reads on light.

         Violet, not the editor's --sl-accent: comment markers already own that
         light blue, and the two must not be mistaken for one another. Position
         separates them too (badge top-left, comment marker top-right).

         box-sizing is explicit so the ring stays INSIDE the 17px box. */
      .ms-sledit-linkbadge {
        position: absolute; pointer-events: auto;
        box-sizing: border-box;
        width: 17px; height: 17px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border: 1.5px solid rgba(255,255,255,0.92); border-radius: 50%;
        background: #7c3aed; color: #fff;
        cursor: pointer;
        box-shadow: 0 1px 5px rgba(3,7,12,0.6);
        transition: transform 90ms ease, background 90ms ease;
      }
      .ms-sledit-linkbadge svg { width: 11px; height: 11px; display: block; }
      .ms-sledit-linkbadge:hover {
        background: #9f67ff;
        transform: scale(1.15);
      }`;
  }
}

export default LinkBadgeLayer;
