export type ThemeName = 'ops-dark' | 'night-vision' | 'sandstorm' | 'arctic' | 'sipr';
interface Theme {
    name: ThemeName;
    label: string;
    vars: Record<string, string>;
}
export declare const THEMES: Theme[];
declare class ThemeManager {
    private static _instance;
    private _styleEl;
    private _current;
    private constructor();
    static getInstance(): ThemeManager;
    get currentTheme(): ThemeName;
    get themeNames(): {
        name: ThemeName;
        label: string;
    }[];
    /** Apply a named theme to the entire UI by injecting CSS custom-property overrides on :root. */
    setTheme(name: ThemeName): void;
    /** Bootstrap: inject the default (ops-dark) theme + the global panel-scrollbar rule. */
    init(name?: ThemeName): void;
    /**
     * Inject a one-shot stylesheet that themes scrollbars on every engine widget.
     * Selectors are limited to known panel class/id prefixes so we don't disturb
     * ArcGIS widgets or the rest of the app.
     */
    private _injectGlobalScrollbarStyles;
}
export default ThemeManager;
