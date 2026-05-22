/**
 * MenuIcons — lightweight inline SVG registry for context menu and action palette icons.
 *
 * All icons are 16×16 Lucide-style: stroke="currentColor", fill="none", stroke-width="1.5".
 * They inherit `color` from CSS, making them fully themeable with no extra setup.
 *
 * Usage:
 *   import { menuIcon } from './MenuIcons';
 *   icon: menuIcon('eye')   // returns an SVG HTML string
 */
declare const ICONS: Record<string, string>;
/**
 * Returns a 16×16 SVG HTML string for the given icon ID.
 * Returns an empty string if the ID is not found (no-op, safe to use as innerHTML).
 */
export declare function menuIcon(id: string): string;
/** Exposes the full icon map for tooling / preview use. */
export { ICONS as MENU_ICON_MAP };
