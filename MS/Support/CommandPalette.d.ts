/**
 * CommandPalette.ts
 *
 * Universal Ctrl+K command bar. Two registries:
 *
 *   CommandPalette.registerSettings(manifest, opener?)
 *     -> indexes every SettingDescriptor in the manifest. For boolean / number /
 *        enum settings, the palette edits the value inline. For color or any
 *        setting whose owner provides an `opener`, hitting Enter mounts that
 *        engine's settings widget instead.
 *
 *   CommandPalette.registerActions([{ id, label, run }, ...])
 *     -> arbitrary commands. Ranking shares the same fuzzy scorer as settings.
 *
 * Open / close:
 *   CommandPalette.open() / close() / toggle()
 *
 * Used by KeyboardShortcutManager on Ctrl+K and by the topbar gear-icon
 * pattern when no specific widget is targeted.
 */
import type { SettingDescriptor } from './SettingsWidget';
export type ActionEntry = {
    id: string;
    label: string;
    /** Optional secondary text — engine name, category etc. Shown faintly. */
    hint?: string;
    /** Synonyms boosting search rank. */
    keywords?: string[];
    /** Invoked on Enter / click. */
    run: () => void;
};
export declare const CommandPalette: {
    registerSettings(manifestId: string, manifest: SettingDescriptor[], opener?: () => void): void;
    /**
     * One-line widget self-registration. Feeds **both** surfaces:
     *   - Ctrl+K palette: adds `Open <label> settings` as an action entry.
     *   - Settings menu (the ⚙ topbar popover): adds the item under `category`.
     *
     * Engines call this from their `XxxSettingsWidget.ts` so a single declaration
     * makes the widget discoverable everywhere.
     */
    registerWidget(opts: {
        id: string;
        label: string;
        opener: () => void;
        /** Menu bucket — defaults to 'Engines'. Known categories: Engines, Map, Appearance, Tools. */
        category?: string;
        /** Emoji / icon for the menu row. */
        icon?: string;
        hint?: string;
        keywords?: string[];
    }): void;
    registerActions(actions: ActionEntry[]): void;
    unregisterAction(id: string): void;
    open(): void;
    close(): void;
    toggle(): void;
    isOpen(): boolean;
};
export default CommandPalette;
