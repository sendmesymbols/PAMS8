/**
 * BriefingSettingsManifest.ts
 *
 * Briefing / Present mode — slide capture, goTo playback, full-screen
 * present mode, and staged reveal builds (appear / fade / flyIn / drawOn).
 */

import type { SettingDescriptor } from '../Support/SettingsWidget';

export const briefingSettingsManifest: SettingDescriptor[] = [
  {
    path: ['features', 'briefing'],
    label: 'Briefing engine',
    group: 'Engine',
    type: 'boolean',
    help: 'Master switch for the Briefing / Present mode engine (slide capture, playback, builds).',
    keywords: ['enable', 'disable', 'present', 'slides', 'presentation'],
  },
  {
    path: ['briefing', 'defaultTransitionMs'],
    label: 'Transition (ms)',
    group: 'Playback',
    type: 'number',
    min: 0,
    max: 5000,
    step: 100,
    help: 'Default goTo duration when entering a slide. Stored per slide at capture time.',
    keywords: ['duration', 'goto', 'speed'],
  },
  {
    path: ['briefing', 'defaultEffect'],
    label: 'Default build effect',
    group: 'Builds',
    type: 'enum',
    options: [
      { value: 'appear', label: 'Appear' },
      { value: 'fade', label: 'Fade' },
      { value: 'flyIn', label: 'Fly in' },
      { value: 'drawOn', label: 'Draw on' },
    ],
    help: 'Effect used when a build step is added without an explicit effect.',
    keywords: ['animation', 'reveal', 'stagger'],
  },
  {
    path: ['briefing', 'autoplayIntervalMs'],
    label: 'Autoplay interval (ms)',
    group: 'Playback',
    type: 'number',
    min: 500,
    max: 60000,
    step: 500,
    help: 'Delay between slides when autoplay is running (briefingEngine.startAutoplay()).',
    keywords: ['auto', 'advance', 'loop'],
  },
];
