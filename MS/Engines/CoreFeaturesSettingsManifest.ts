/**
 * CoreFeaturesSettingsManifest.ts
 *
 * Application-level capabilities (context menu, edit, clipboard, save/load,
 * etc.). These are not a single engine — they're framework features that the
 * library exposes through SymbolEngine.
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

const intx = (label: string, key: string, help: string): SettingDescriptor => ({
  path: ['features', key],
  label,
  group: 'Interaction',
  type: 'boolean',
  help,
});

const edit = (label: string, key: string, help: string): SettingDescriptor => ({
  path: ['features', key],
  label,
  group: 'Editing',
  type: 'boolean',
  help,
});

const data = (label: string, key: string, help: string): SettingDescriptor => ({
  path: ['features', key],
  label,
  group: 'Data',
  type: 'boolean',
  help,
});

const sel = (label: string, key: string, help: string): SettingDescriptor => ({
  path: ['features', key],
  label,
  group: 'Selection',
  type: 'boolean',
  help,
});

export const coreFeaturesSettingsManifest: SettingDescriptor[] = [
  intx('Context menu', 'contextMenu', 'Right-click menu on map graphics with edit / measurement / analysis actions.'),
  intx('Keyboard shortcuts', 'shortcuts', 'Global keyboard shortcuts: M (move), L (lasso), E (edit), Esc (cancel), Del (delete), I (info), C (center), Ctrl+K (palette).'),
  intx('Annotations', 'annotationEngine', 'Automatically add labels (designation, DTG, etc.) to drawn symbols.'),

  edit('Edit engine', 'editEngine', 'Interactive edit of existing symbols (move, reshape, delete).'),
  edit('Edit · move/scale/rotate menu', 'editMoveScaleRotate', 'Show Move/Scale/Rotate items in the Edit context menu.'),
  edit('Edit · control points menu', 'editControlPoints', 'Show "Edit control points" items in the Edit context menu.'),

  sel('Selection menu', 'selectionMenu', 'Show Selection submenu (lasso, select-similar, filter-by-type) in the right-click context menu.'),
  sel('Align menu', 'alignMenu', 'Show Align / Distribute / Arrange submenu in the right-click context menu (requires 2+ selected).'),
  sel('Selection quick toolbar', 'selectionQuickToolbar', 'Bottom-centre on-map toolbar that appears whenever symbols are selected.'),
  sel('Copy / paste', 'copyPaste', 'Enable copy-paste for selected symbols and Cmd/Ctrl+Shift+drag clone-drag.'),
  sel('Clipboard', 'clipboard', 'Storage backing for copy / paste. Disable to free memory and skip Ctrl+C storage.'),

  data('Save / load plans', 'saveLoad', 'Save and load full symbol plans to / from disk via ImportExportEngine.'),
  data('Templates', 'templates', 'Re-usable symbol templates for rapid deployment.'),
  data('Deployment Manager', 'deploymentBuilder', 'Manager widget for placing pre-built tactical plans from the context menu.'),

  {
    path: ['logging', 'enabled'],
    label: 'Engine logging',
    group: 'Diagnostics',
    type: 'boolean',
    help: 'Show engine events (drawing, editing, measurements) in the on-screen Engine Log panel.',
    keywords: ['debug', 'logs'],
  },
];
