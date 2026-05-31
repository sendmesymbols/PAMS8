/**
 * AppearanceSettingsManifest.ts
 *
 * Library-wide appearance knobs: default symbol/line/text sizes, UI theme,
 * and creation mode. These are not owned by one engine — they apply to every
 * newly drawn symbol. Lives outside the per-engine widgets but ships in the
 * Settings menu just like them.
 */
import type { SettingDescriptor } from '../Support/SettingsWidget';
export declare const appearanceSettingsManifest: SettingDescriptor[];
