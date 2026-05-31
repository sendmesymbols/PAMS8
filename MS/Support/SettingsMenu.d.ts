/**
 * SettingsMenu.ts
 *
 * The single ⚙ Settings popover anchored under a topbar button. Lists every
 * registered settings widget grouped by category. Click an entry → its widget
 * mounts; the menu closes.
 *
 * Entries register themselves via `CommandPalette.registerWidget()` — this
 * module is a thin sibling that surfaces the same set in a click-driven UI
 * (the palette covers keyboard-driven discovery).
 *
 *   SettingsMenu.registerEntry({ id, label, category, icon, opener })
 *   SettingsMenu.open(anchorEl)
 *   SettingsMenu.close()
 *
 * No second registry pathway — engines just call `registerWidget`, which in
 * turn feeds both this menu and the palette.
 */
export interface MenuEntry {
    id: string;
    label: string;
    /** Category bucket — e.g. 'Engines', 'Appearance', 'Map'. */
    category: string;
    /** Icon name from MS/Managers/MenuIcons.ts (e.g. 'ruler-simple', 'crosshair'). */
    icon?: string;
    /** Optional secondary text. */
    hint?: string;
    /** Invoked on click. */
    opener: () => void;
}
export declare const SettingsMenu: {
    registerEntry(entry: MenuEntry): void;
    unregisterEntry(id: string): void;
    /** Open the popover anchored beneath `anchor`. Toggles closed if already open. */
    open(anchor: HTMLElement): void;
    close(): void;
    isOpen(): boolean;
};
export default SettingsMenu;
