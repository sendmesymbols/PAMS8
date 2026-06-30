/**
 * StylusSettingsManifest.ts
 *
 * Stylus / pen drawing — lets line/area symbols be drawn with a stylus on a
 * mixed hardware fleet (active pens AND passive/touch, neither guaranteed to
 * hover). Two paradigms (freehand stroke vs tap-to-place) selectable as a
 * global default; per-symbol overrides live in `stylus.perSymbol` and are set
 * contextually from the draw panel rather than from this manifest (the manifest
 * renderer has no map/dictionary control).
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const stylusSettingsManifest: SettingDescriptor[] = [
  {
    path: ['stylus', 'mode'],
    label: 'Pen mode',
    group: 'Activation',
    type: 'enum',
    options: [
      { value: 'auto', label: 'Auto-detect' },
      { value: 'on', label: 'Always on' },
      { value: 'off', label: 'Off' },
    ],
    help: 'Auto-detect engages stylus drawing when the input is a pen or touch; On forces it for every input (incl. mouse); Off keeps the classic click / double-click drawing.',
    keywords: ['stylus', 'pen', 'touch', 'tablet'],
  },
  {
    path: ['stylus', 'paradigm'],
    label: 'Default paradigm',
    group: 'Drawing',
    type: 'enum',
    options: [
      { value: 'native', label: 'Native (live symbol preview)' },
      { value: 'freehand', label: 'Freehand stroke' },
      { value: 'tap', label: 'Tap to place' },
    ],
    help: "Global default. Native: drives each symbol's own interactive drawing — the live preview is the real symbol (uses CTRL_PTS + the native baseline phase); touch gets a synthetic-hover preview; finish via the toolbar / Enter / double-tap. Freehand: press, drag to draw, lift to finish. Tap: tap each vertex then Finish. Per-symbol overrides take precedence.",
    keywords: ['native', 'freehand', 'tap', 'draw', 'preview'],
  },

  // ── Freehand ────────────────────────────────────────────────────────────────
  {
    path: ['stylus', 'freehand', 'simplifyTolerancePx'],
    label: 'Simplify tolerance (px)',
    group: 'Freehand',
    type: 'number',
    min: 0,
    max: 50,
    step: 0.5,
    help: 'Douglas-Peucker tolerance, in screen pixels, used to reduce a freehand stroke to control points. Higher = fewer, smoother control points.',
  },

  // ── Tap ───────────────────────────────────────────────────────────────────
  {
    path: ['stylus', 'tap', 'tapTolerancePx'],
    label: 'Tap tolerance (px)',
    group: 'Tap',
    type: 'number',
    min: 0,
    max: 50,
    step: 1,
    help: 'Maximum pointer drift, in screen pixels, for a press-release to count as a vertex tap rather than a map pan.',
  },
  {
    path: ['stylus', 'tap', 'showFinishToolbar'],
    label: 'Finish toolbar',
    group: 'Tap',
    type: 'boolean',
    help: 'Show a floating Finish / Undo / Cancel toolbar while placing vertices in tap mode.',
  },
];
