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

  // ── Premium (native paradigm only) ───────────────────────────────────────────
  {
    path: ['stylus', 'premium', 'enabled'],
    label: 'Premium drawing',
    group: 'Premium',
    type: 'boolean',
    help: 'Master switch for the premium stylus experience (glide cursor, input smoothing, snap-to-cursor, palm rejection, optional dwell-to-finish). Applies to the Native paradigm only. Off = plain native drawing, untouched.',
    keywords: ['premium', 'pen', 'stylus', 'elite', 'smooth'],
  },
  {
    path: ['stylus', 'premium', 'cursor', 'enabled'],
    label: 'Glide cursor',
    group: 'Premium',
    type: 'boolean',
    help: 'Show a smooth crosshair/ring that follows the pen or finger (gives touch a visible cursor, and highlights when snapped to a feature).',
  },
  {
    path: ['stylus', 'premium', 'smoothing', 'enabled'],
    label: 'Input smoothing',
    group: 'Premium',
    type: 'boolean',
    help: 'Apply a real-time 1€ filter so the cursor and touch preview glide instead of jittering.',
  },
  {
    path: ['stylus', 'premium', 'smoothing', 'beta'],
    label: 'Smoothing responsiveness',
    group: 'Premium',
    type: 'number',
    min: 0,
    max: 1,
    step: 0.005,
    help: 'Higher = less lag when moving fast (follows the pen more tightly); lower = smoother but laggier. Default 0.02.',
  },
  {
    path: ['stylus', 'premium', 'snap', 'enabled'],
    label: 'Snap cursor to features',
    group: 'Premium',
    type: 'boolean',
    help: 'When ProximityEngine reports a nearby vertex/coordinate, the cursor (and the touch preview) jump to it so you see exactly where the next vertex lands. Requires the Proximity engine.',
  },
  {
    path: ['stylus', 'premium', 'palmReject'],
    label: 'Palm rejection',
    group: 'Premium',
    type: 'boolean',
    help: 'Ignore stray touches while a pen is active, and obvious palm-sized contacts.',
  },
  {
    path: ['stylus', 'premium', 'finish', 'dwellMs'],
    label: 'Dwell-to-finish (ms)',
    group: 'Premium',
    type: 'number',
    min: 0,
    max: 3000,
    step: 100,
    help: 'Finish the draw by holding the pen still for this many milliseconds. 0 = off (use double-tap / Finish button / Enter).',
  },

  // ── Premium precision (capture-time vertex resolution) ───────────────────────
  {
    path: ['stylus', 'premium', 'precision', 'enabled'],
    label: 'Precision (snap-to-commit)',
    group: 'Premium precision',
    type: 'boolean',
    help: 'Make the COMMITTED vertex (and the live preview) land on the resolved target — snap to nearby vertices, angle-lock, length-lock — not just a cursor hint. Off by default; validate on a real device before relying on it.',
    keywords: ['snap', 'precision', 'lock', 'commit'],
  },
  {
    path: ['stylus', 'premium', 'precision', 'snapCommit'],
    label: 'Snap vertices to features',
    group: 'Premium precision',
    type: 'boolean',
    help: 'When Precision is on, snap the committed vertex onto the nearest existing vertex/coordinate (from ProximityEngine).',
  },
  {
    path: ['stylus', 'premium', 'precision', 'angleLock', 'enabled'],
    label: 'Angle lock',
    group: 'Premium precision',
    type: 'boolean',
    help: 'When Precision is on, lock a segment to the nearest guide angle (default every 45°, within 8°) relative to the previous vertex.',
  },
  {
    path: ['stylus', 'premium', 'precision', 'lengthLock', 'enabled'],
    label: 'Length lock',
    group: 'Premium precision',
    type: 'boolean',
    help: 'When Precision is on, snap a segment length to the nearest interval (default 1 km) from the previous vertex.',
  },
  {
    path: ['stylus', 'premium', 'freehandStroke'],
    label: 'Freehand smooth stroke',
    group: 'Premium precision',
    type: 'boolean',
    help: 'For the freehand symbols (FreehandArea/Line/Arrow), draw by dragging a smoothed pen stroke with a live real-symbol preview, lift to finish. Off by default.',
  },
  {
    path: ['stylus', 'premium', 'ink', 'pressure'],
    label: 'Pressure → cursor size',
    group: 'Premium precision',
    type: 'boolean',
    help: 'Scale the glide cursor with pen pressure (visual only). Off by default.',
  },
];
