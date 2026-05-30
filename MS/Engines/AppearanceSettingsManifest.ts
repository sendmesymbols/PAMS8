/**
 * AppearanceSettingsManifest.ts
 *
 * Library-wide appearance knobs: default symbol/line/text sizes, UI theme,
 * and creation mode. These are not owned by one engine — they apply to every
 * newly drawn symbol. Lives outside the per-engine widgets but ships in the
 * Settings menu just like them.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const appearanceSettingsManifest: SettingDescriptor[] = [
  // ── Symbol sizes ───────────────────────────────────────────────────────────
  {
    path: ['size'],
    label: 'Symbol size',
    group: 'Symbol sizes',
    type: 'number',
    min: 5,
    max: 200,
    step: 1,
    help: 'Default pixel size for all newly drawn tactical symbols (points, lines, areas).',
    keywords: ['default', 'big', 'small'],
  },
  {
    path: ['lineWidth'],
    label: 'Line width',
    group: 'Symbol sizes',
    type: 'number',
    min: 0.5,
    max: 20,
    step: 0.5,
    help: 'Default line width for symbol strokes, borders, and tactical graphics in pixels.',
  },
  {
    path: ['PtlineWidth'],
    label: 'Point line width',
    group: 'Symbol sizes',
    type: 'number',
    min: 1,
    max: 50,
    step: 1,
    help: 'Line width for point-based tactical symbols (e.g. unit equipment) in pixels.',
  },
  {
    path: ['textSize'],
    label: 'Text size',
    group: 'Symbol sizes',
    type: 'number',
    min: 6,
    max: 48,
    step: 1,
    help: 'Default font size for symbol annotations and labels in pixels.',
  },
  {
    path: ['freeHandTextSize'],
    label: 'Freehand text size',
    group: 'Symbol sizes',
    type: 'number',
    min: 6,
    max: 48,
    step: 1,
    help: 'Font size for text added via freehand drawing tools in pixels.',
  },
  {
    path: ['freeHandLineWidth'],
    label: 'Freehand line width',
    group: 'Symbol sizes',
    type: 'number',
    min: 0.5,
    max: 20,
    step: 0.5,
    help: 'Line width for freehand-drawn tactical graphics in pixels.',
  },

  // ── Theme & creation ───────────────────────────────────────────────────────
  {
    path: ['ui', 'theme'],
    label: 'UI theme',
    group: 'Interface',
    type: 'enum',
    options: [
      { value: 'ops-dark', label: 'Ops Dark' },
      { value: 'night-vision', label: 'Night Vision' },
      { value: 'sandstorm', label: 'Sandstorm' },
      { value: 'arctic', label: 'Arctic' },
      { value: 'sipr', label: 'SIPR Red' },
    ],
    help: 'Color theme used by every settings widget, menu, and engine panel. Does not affect map symbols.',
    keywords: ['color', 'dark', 'light', 'night vision'],
  },
  {
    path: ['creationMode'],
    label: 'Creation mode',
    group: 'Interface',
    type: 'enum',
    options: [
      { value: 'single', label: 'Single (one at a time)' },
      { value: 'continuous', label: 'Continuous (draw many in sequence)' },
    ],
    help: 'Single: finish a symbol and stop. Continuous: stay in drawing mode so you can place more of the same symbol.',
    keywords: ['draw', 'repeat'],
  },
];
