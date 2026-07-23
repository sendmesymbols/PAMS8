import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../Support/SettingsWidget';
import CommandPalette from '../Support/CommandPalette';
import { briefingSettingsManifest } from './BriefingSettingsManifest';

export function openBriefingSettings(opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {}): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'briefing-settings',
    title: 'Briefing',
    icon: '🎬',
    manifest: briefingSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openBriefingSettings = openBriefingSettings;
}

CommandPalette.registerWidget({
  id: 'briefing',
  label: 'Briefing / Present mode',
  category: 'Tools',
  icon: '🎬',
  hint: 'Slide capture, playback, present mode, builds',
  keywords: ['briefing', 'present', 'slides', 'presentation', 'animation', 'build'],
  opener: () => openBriefingSettings(),
});

CommandPalette.registerActions([
  {
    id: 'briefing.openPanel',
    label: 'Briefing: open slide panel',
    hint: 'Capture / play / present the current plan as slides',
    keywords: ['briefing', 'slides', 'capture', 'present', 'playback'],
    run: () => (window as any).briefingEngine?.openPanel(),
  },
  {
    id: 'briefing.present',
    label: 'Briefing: enter present mode',
    hint: 'Full-screen playback — Esc exits, arrows/space/click advance',
    keywords: ['present', 'fullscreen', 'briefing', 'playback'],
    run: () => (window as any).briefingEngine?.enterPresent(),
  },
  {
    id: 'briefing.openSorter',
    label: 'Briefing: open slide sorter',
    hint: 'Drag-and-drop grid to reorder, duplicate or remove slides',
    keywords: ['sorter', 'reorder', 'arrange', 'order', 'slides', 'grid', 'briefing'],
    run: () => (window as any).briefingEngine?.openSorter(),
  },
  {
    id: 'briefing.editSlide',
    label: 'Briefing: edit current slide',
    hint: 'Full-screen slide editor — text, shapes, arrows, colors',
    keywords: ['edit', 'annotate', 'slide', 'text', 'shapes', 'arrow', 'briefing', 'editor'],
    run: () => {
      const be = (window as any).briefingEngine;
      if (!be) return;
      const idx = typeof be.currentIndex === 'number' && be.currentIndex >= 0 ? be.currentIndex : 0;
      void be.openSlideEditor?.(idx);
    },
  },
]);

export default openBriefingSettings;
