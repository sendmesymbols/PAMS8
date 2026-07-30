/**
 * SlideChromeLayer.ts
 *
 * Draws a deck's headers, footers, classification banners and slide-number
 * stamp as DOM strips. One layer serves both in-app surfaces: the slide editor
 * (bands laid around the fabric canvas) and present mode (bands on the view's
 * top and bottom edges).
 *
 * DOM rather than fabric objects, for the same reason SlideLinkBadges and
 * SlideComments are DOM: the editor saves by mapping every canvas object through
 * `fabricToOverlay`, so a decorative fabric object would be persisted as a real
 * annotation — and a classification banner that can be dragged, restyled or
 * deleted is worse than no banner at all. Nothing here is selectable and nothing
 * here is ever saved.
 *
 * Geometry and text come from SlideChrome, which the PPTX exporter builds its
 * slide master from — so what is painted here and what PowerPoint receives
 * cannot drift apart.
 */

import {
  chromeBands,
  cssColor,
  pageRect,
  type ChromeRect,
  type ChromeTokenContext,
  type DeckChrome,
} from './SlideChrome';

export class SlideChromeLayer {
  private _layer: HTMLElement | null = null;
  /** Class added to the layer, so the two hosts can style their own variant. */
  private _variant: string;

  constructor(variant: 'editor' | 'present') {
    this._variant = `ms-chrome-${variant}`;
  }

  public mount(parent: HTMLElement): void {
    this.unmount();
    const layer = document.createElement('div');
    layer.className = `ms-chrome-layer ${this._variant}`;
    parent.appendChild(layer);
    this._layer = layer;
  }

  public unmount(): void {
    this._layer?.remove();
    this._layer = null;
  }

  public get mounted(): boolean {
    return !!this._layer;
  }

  /**
   * Rebuild the bands around `content` — the slide's CONTENT rect, i.e. the
   * fabric canvas in the editor or the inset view rect in present mode. The page
   * the bands live on is derived back out of it (see SlideChrome.pageRect), so
   * the strips keep the exact proportion to the content that the exported slide
   * master gives them.
   *
   * `visible: false` empties the layer without unmounting — the editor's chrome
   * toggle, which hides the furniture while authoring without changing a thing
   * about what exports.
   */
  public render(
    chrome: DeckChrome | null | undefined,
    content: ChromeRect,
    ctx: ChromeTokenContext = {},
    visible = true,
  ): void {
    const layer = this._layer;
    if (!layer) return;
    layer.innerHTML = '';
    const bands = visible ? chromeBands(chrome, ctx) : [];
    if (!bands.length) {
      layer.style.display = 'none';
      return;
    }
    const page = pageRect(content, chrome);
    layer.style.display = '';
    layer.style.left = `${page.left}px`;
    layer.style.top = `${page.top}px`;
    layer.style.width = `${page.width}px`;
    layer.style.height = `${page.height}px`;

    let top = 0;
    let bottom = 0;
    for (const band of bands) {
      const h = band.h * page.height;
      const y = band.edge === 'top' ? top : page.height - bottom - h;
      if (band.edge === 'top') top += h;
      else bottom += h;

      const el = document.createElement('div');
      el.className = 'ms-chrome-band';
      el.dataset.role = band.role;
      el.style.top = `${y}px`;
      el.style.height = `${h}px`;
      el.style.background = cssColor(band.fill);
      el.style.color = cssColor(band.color);
      // Font size is a fraction of slide height, exactly as in the .pptx — so a
      // band reads the same relative size on a small editor canvas and on a
      // projector.
      el.style.fontSize = `${Math.max(7, band.fontSize * page.height)}px`;
      el.style.fontWeight = band.bold ? '700' : '500';
      el.style.justifyContent = band.align === 'center' ? 'center' : 'space-between';

      const main = document.createElement('span');
      main.className = 'ms-chrome-text';
      main.textContent = band.text;
      el.appendChild(main);
      // The slide-number stamp shares the footer strip, pushed to its right end
      // by the band's space-between. Present even when the footer text is empty,
      // which is why it is a sibling rather than part of `text`.
      if (band.rightText) {
        const stamp = document.createElement('span');
        stamp.className = 'ms-chrome-stamp';
        stamp.textContent = band.rightText;
        el.appendChild(stamp);
      }
      layer.appendChild(el);
    }
  }

  /**
   * Shared stylesheet. Both hosts inject this into their own <style> block —
   * the editor's is scoped inside its full-screen shell and present mode's is
   * global, so neither can be the single owner.
   */
  public static styles(): string {
    return `
      .ms-chrome-layer {
        position: absolute; pointer-events: none;
        overflow: hidden;
      }
      .ms-chrome-band {
        position: absolute; left: 0; right: 0;
        display: flex; align-items: center;
        gap: 12px;
        padding: 0 10px;
        box-sizing: border-box;
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      /* A marking must stay legible over anything and must not be mistakable
         for content — hence the flat saturated strip and the hard edge. */
      .ms-chrome-band[data-role="classification"] {
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      /* The one part of a band that may be clipped: a long footer must not push
         the slide-number stamp off the strip. */
      .ms-chrome-text {
        overflow: hidden; text-overflow: ellipsis;
      }
      .ms-chrome-stamp {
        flex: 0 0 auto; font-variant-numeric: tabular-nums;
      }
      /* In the editor the strips sit above the canvas shadow but below the
         properties island, comment markers and link badges. */
      .ms-chrome-editor { z-index: 6; border-radius: 3px; }
      /* Present mode: over the map and the overlay canvas, under the control
         bar (which is z-index 20+ and auto-hides). The banner never hides — a
         marking that disappears after a few idle seconds is not a marking. */
      .ms-chrome-present { z-index: 12; }`;
  }
}

export default SlideChromeLayer;
