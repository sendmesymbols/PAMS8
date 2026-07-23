/**
 * ScreenAnchorSettingsManifest.ts
 *
 * Pin to Screen — per-item toggle so a title, legend, or callout stays fixed
 * on screen while the map pans and zooms beneath it (ScreenAnchorEngine).
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const screenAnchorSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'screenAnchor'],
    label: 'Pin to Screen',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch for Pin to Screen. When on, right-click a text / AutoShape / freehand graphic and choose "Pin to Screen" — it stays put on screen while the map moves. 2D is exact; 3D pins freeze while the camera is tilted. Pinned items are excluded from GeoJSON export.',
    keywords: ['pin', 'anchor', 'screen', 'fixed', 'legend', 'title', 'callout', 'sticky'],
  },
];
