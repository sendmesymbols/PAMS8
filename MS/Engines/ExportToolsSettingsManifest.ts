/**
 * ExportToolsSettingsManifest.ts
 *
 * PowerPoint (.pptx) deck export — mode (flat screenshots vs editable
 * shapes), image format, explode-builds, speaker notes.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const exportToolsSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'exportTools'],
    label: 'Export tools',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch for the PowerPoint deck exporter.',
    keywords: ['enable', 'disable', 'pptx', 'powerpoint'],
  },
  {
    path: ['exportTools', 'mode'],
    label: 'Export mode',
    group: 'Deck',
    type: 'enum',
    options: [
      { value: 'flat', label: 'Flat screenshots (Mode A)' },
      { value: 'editable', label: 'Editable shapes (Mode B)' },
    ],
    help: 'Flat: each slide is one map screenshot. Editable: simple lines / areas / text become native, selectable PowerPoint shapes over a basemap raster (unit icons and decorated tactical graphics stay in the image). In 2D the shapes align exactly; in 3D they are projected from the current camera over terrain and are APPROXIMATE — expect small offsets on steep relief. Choose the view accordingly.',
    keywords: ['flat', 'editable', 'shapes', 'native', 'vector', 'mode', '2d', '3d'],
  },
  {
    path: ['exportTools', 'format'],
    label: 'Image format',
    group: 'Deck',
    type: 'enum',
    options: [
      { value: 'png', label: 'PNG (lossless)' },
      { value: 'jpeg', label: 'JPEG (smaller file)' },
    ],
    help: 'Format of the map screenshot placed on each slide.',
    keywords: ['png', 'jpeg', 'quality', 'size'],
  },
  {
    path: ['exportTools', 'explodeBuilds'],
    label: 'Explode builds',
    group: 'Deck',
    type: 'boolean',
    help: 'Emit one extra slide per staged-reveal build step (base state + cumulative reveals).',
    keywords: ['builds', 'staged', 'reveal', 'animation'],
  },
  {
    path: ['exportTools', 'includeNotes'],
    label: 'Include speaker notes',
    group: 'Deck',
    type: 'boolean',
    help: 'Attach each briefing slide’s notes as PowerPoint speaker notes.',
    keywords: ['notes', 'speaker'],
  },
];
