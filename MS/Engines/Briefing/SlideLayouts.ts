/**
 * SlideLayouts.ts
 *
 * Built-in slide layouts for the editor's "＋ New slide" picker — the same
 * five bento/slides offers (Title, Title + content, Two columns, Section
 * divider, Blank), rebuilt on our overlay model.
 *
 * A layout is nothing more than a factory for `SlideOverlay[]`: coordinates are
 * already normalized [0..1] against the slide's view rect, so the same numbers
 * place the object on the editor canvas, in present mode and inside the PPTX
 * contain-fit rectangle. That means layouts need NO model change at all — a
 * layout slide is an ordinary blank slide that happens to start with overlays.
 *
 * Proportions are ported from bento's 1600×900 layout grid (x/1600, y/900), so
 * the visual rhythm matches; colours come from our own palette rather than
 * bento's peach-and-midnight identity.
 */

import type { SlideOverlay } from './BriefingTypes';
import { DEFAULT_TEXT_COLOR } from './OverlayStyle';

/** Matches the editor's accent, so a layout looks native to the app's theme. */
const ACCENT = '#64b4ff';
/**
 * A layout slide is a *blank* slide (solid white) that starts with overlays, and
 * `captureIntoSlide()` can later drop a map of any brightness underneath. So
 * layout text uses the same background-agnostic ink as the editor's default
 * rather than the white that only worked over dark map imagery.
 */
const INK = DEFAULT_TEXT_COLOR;
/** Placeholder ink — exported so the picker's previews can paint what they get. */
export const LAYOUT_INK_DIM = '#8592A3';
const INK_DIM = LAYOUT_INK_DIM;
/** Section dividers dim the map behind them rather than replacing it. */
const SCRIM = '#0d1117';
/** Ink for the divider's own text, which is only ever read against SCRIM. */
const INK_ON_SCRIM = '#ffffff';

let seq = 0;
const uid = (): string => `lay-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const text = (
  value: string,
  box: { x: number; y: number; w: number; h: number },
  extra: Partial<SlideOverlay> = {},
): SlideOverlay => ({
  id: uid(),
  kind: 'text',
  ...box,
  text: value,
  fontFamily: 'Arial',
  fontSize: 0.049,
  textColor: INK,
  align: 'left',
  ...extra,
});

/** The short accent rule bento puts above a title. */
const bar = (box: { x: number; y: number; w: number; h: number }): SlideOverlay => ({
  id: uid(),
  kind: 'rect',
  ...box,
  fill: ACCENT,
  fillOpacity: 1,
  stroke: ACCENT,
  strokeWidth: 0.001,
});

export interface SlideLayout {
  id: string;
  name: string;
  /** Fresh overlays for a new slide — called once per insertion, so ids are unique. */
  overlays(): SlideOverlay[];
  /** Tiny inline SVG shown in the picker, drawn in a 100×56 box. */
  preview: string;
}

/**
 * Every preview starts with the white page the layout actually lands on (a
 * layout slide is a blank slide), so the swatch shows the real contrast — ink
 * on paper — rather than pale bars on the picker's dark card.
 */
const pv = (inner: string): string =>
  `<svg viewBox="0 0 100 56" preserveAspectRatio="none" aria-hidden="true">` +
  `<rect class="pv-paper" x="0" y="0" width="100" height="56"/>${inner}</svg>`;

export const BUILTIN_LAYOUTS: SlideLayout[] = [
  {
    id: 'title',
    name: 'Title',
    preview: pv(
      '<rect class="pv-accent" x="10" y="23" width="6" height="2"/>' +
        '<rect class="pv-ink" x="10" y="28" width="52" height="7"/>' +
        '<rect class="pv-dim" x="10" y="38" width="34" height="4"/>',
    ),
    overlays: () => [
      bar({ x: 0.1, y: 0.422, w: 0.045, h: 0.009 }),
      text('Click to add title', { x: 0.1, y: 0.449, w: 0.8, h: 0.156 }, { fontSize: 0.084, bold: true }),
      text('Click to add subtitle', { x: 0.1, y: 0.618, w: 0.688, h: 0.067 }, { fontSize: 0.031, textColor: INK_DIM }),
    ],
  },
  {
    id: 'title-content',
    name: 'Title + content',
    preview: pv(
      '<rect class="pv-ink" x="8" y="8" width="46" height="6"/>' +
        '<rect class="pv-accent" x="8" y="17" width="84" height="1.4"/>' +
        '<rect class="pv-dim" x="8" y="23" width="84" height="3"/>' +
        '<rect class="pv-dim" x="8" y="30" width="84" height="3"/>' +
        '<rect class="pv-dim" x="8" y="37" width="58" height="3"/>',
    ),
    overlays: () => [
      text('Click to add title', { x: 0.075, y: 0.08, w: 0.85, h: 0.093 }, { fontSize: 0.049, bold: true }),
      bar({ x: 0.075, y: 0.187, w: 0.85, h: 0.0033 }),
      text('Click to add content', { x: 0.075, y: 0.231, w: 0.85, h: 0.667 }, { fontSize: 0.029, textColor: INK_DIM }),
    ],
  },
  {
    id: 'two-col',
    name: 'Two columns',
    preview: pv(
      '<rect class="pv-ink" x="8" y="8" width="46" height="6"/>' +
        '<rect class="pv-accent" x="8" y="17" width="84" height="1.4"/>' +
        '<rect class="pv-dim" x="8" y="23" width="38" height="3"/>' +
        '<rect class="pv-dim" x="8" y="30" width="38" height="3"/>' +
        '<rect class="pv-dim" x="54" y="23" width="38" height="3"/>' +
        '<rect class="pv-dim" x="54" y="30" width="38" height="3"/>',
    ),
    overlays: () => [
      text('Click to add title', { x: 0.075, y: 0.08, w: 0.85, h: 0.093 }, { fontSize: 0.049, bold: true }),
      bar({ x: 0.075, y: 0.187, w: 0.85, h: 0.0033 }),
      text('Left column', { x: 0.075, y: 0.231, w: 0.4125, h: 0.667 }, { fontSize: 0.027, textColor: INK_DIM }),
      text('Right column', { x: 0.5125, y: 0.231, w: 0.4125, h: 0.667 }, { fontSize: 0.027, textColor: INK_DIM }),
    ],
  },
  {
    id: 'section',
    name: 'Section divider',
    preview: pv(
      '<rect class="pv-scrim" x="0" y="0" width="100" height="56"/>' +
        '<rect class="pv-accent" x="10" y="19" width="12" height="2"/>' +
        '<rect class="pv-accent" x="10" y="25" width="5" height="2.6"/>' +
        // Light ink: this layout's title is read against the scrim, not paper.
        '<rect class="pv-inkscrim" x="10" y="31" width="54" height="7"/>',
    ),
    overlays: () => [
      // A scrim rather than a slide background: the map stays faintly visible,
      // which is what makes a divider still read as part of the same brief.
      {
        id: uid(),
        kind: 'rect',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        fill: SCRIM,
        fillOpacity: 0.86,
        stroke: SCRIM,
        strokeWidth: 0.001,
      },
      text('PART 1', { x: 0.1, y: 0.389, w: 0.5, h: 0.044 }, { fontSize: 0.02, bold: true, textColor: ACCENT }),
      bar({ x: 0.1, y: 0.44, w: 0.045, h: 0.009 }),
      text(
        'Section title',
        { x: 0.1, y: 0.467, w: 0.8, h: 0.133 },
        { fontSize: 0.071, bold: true, textColor: INK_ON_SCRIM },
      ),
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    preview: pv(''),
    overlays: () => [],
  },
];

export function layoutById(id: string): SlideLayout | undefined {
  return BUILTIN_LAYOUTS.find((l) => l.id === id);
}
