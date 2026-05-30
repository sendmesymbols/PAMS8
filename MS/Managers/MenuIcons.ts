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

const ICONS: Record<string, string> = {
  // ── Analysis ──────────────────────────────────────────────────────────────
  'eye':
    '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/>' +
    '<circle cx="8" cy="8" r="2"/>',

  'crosshair':
    '<circle cx="8" cy="8" r="5"/>' +
    '<line x1="8" y1="1" x2="8" y2="4"/>' +
    '<line x1="8" y1="12" x2="8" y2="15"/>' +
    '<line x1="1" y1="8" x2="4" y2="8"/>' +
    '<line x1="12" y1="8" x2="15" y2="8"/>',

  'arrow-up-right':
    '<polyline points="5 3 13 3 13 11"/>' +
    '<line x1="3" y1="13" x2="13" y2="3"/>',

  'layers':
    '<polygon points="8 2 14 5.5 8 9 2 5.5"/>' +
    '<polyline points="2 9.5 8 13 14 9.5"/>' +
    '<polyline points="2 6.5 8 10 14 6.5"/>',

  'zap':
    '<polygon points="10 2 4 9 8 9 6 14 12 7 8 7 10 2"/>',

  'activity':
    '<polyline points="2 8 5 8 6 5 8 11 10 3 11 8 14 8"/>',

  // ── Measurement ───────────────────────────────────────────────────────────
  'ruler-simple':
    '<line x1="2" y1="14" x2="14" y2="2"/>' +
    '<path d="M5 11 3 13M8 8 6 10M11 5 9 7"/>',

  'box-3d':
    '<path d="M8 2 14 5v6l-6 3-6-3V5z"/>' +
    '<path d="M8 2v10M2 5l6 3 6-3"/>',

  'move':
    '<polyline points="5 9 2 12 5 15"/>' +
    '<polyline points="9 5 12 2 15 5"/>' +
    '<line x1="2" y1="12" x2="14" y2="12"/>' +
    '<line x1="12" y1="2" x2="12" y2="14"/>',

  // ── Runtime / Misc ────────────────────────────────────────────────────────
  'square-stop':
    '<rect x="3" y="3" width="10" height="10" rx="1.5"/>',

  'map-pin':
    '<path d="M8 2a4 4 0 0 1 4 4c0 3-4 8-4 8S4 9 4 6a4 4 0 0 1 4-4z"/>' +
    '<circle cx="8" cy="6" r="1.5"/>',

  'grid':
    '<rect x="2" y="2" width="5" height="5" rx="0.5"/>' +
    '<rect x="9" y="2" width="5" height="5" rx="0.5"/>' +
    '<rect x="2" y="9" width="5" height="5" rx="0.5"/>' +
    '<rect x="9" y="9" width="5" height="5" rx="0.5"/>',

  'search':
    '<circle cx="7" cy="7" r="4"/>' +
    '<line x1="10.5" y1="10.5" x2="14" y2="14"/>',

  // ── Symbol actions (SymbolEngine) ─────────────────────────────────────────
  'info':
    '<circle cx="8" cy="8" r="6"/>' +
    '<line x1="8" y1="11" x2="8" y2="8"/>' +
    '<line x1="8" y1="5.5" x2="8.01" y2="5.5"/>',

  'navigation':
    '<polygon points="3 3 13 8 8 10 6 14 3 3"/>',

  'trash':
    '<polyline points="3 5 13 5"/>' +
    '<path d="M5 5V3h6v2"/>' +
    '<rect x="4" y="5" width="8" height="9" rx="1"/>',

  'clipboard':
    '<rect x="5" y="3" width="6" height="3" rx="1"/>' +
    '<rect x="3" y="4" width="10" height="10" rx="1"/>' +
    '<line x1="6" y1="8" x2="10" y2="8"/>' +
    '<line x1="6" y1="11" x2="10" y2="11"/>',

  'copy':
    '<rect x="5" y="5" width="8" height="9" rx="1"/>' +
    '<path d="M3 11V3h8"/>',

  'pencil':
    '<path d="M11 3 13 5 5 13H3v-2z"/>' +
    '<line x1="9" y1="5" x2="11" y2="7"/>',

  'rotate-ccw':
    '<polyline points="2 7 2 2 7 2"/>' +
    '<path d="M2 2a8 8 0 1 0 12 0"/>',

  'rotate-cw':
    '<polyline points="14 7 14 2 9 2"/>' +
    '<path d="M14 2a8 8 0 1 1-12 0"/>',

  'x':
    '<line x1="4" y1="4" x2="12" y2="12"/>' +
    '<line x1="12" y1="4" x2="4" y2="12"/>',

  'select-all':
    '<rect x="2" y="2" width="12" height="12" rx="1" stroke-dasharray="3 2"/>',

  'lasso':
    '<path d="M8 4a4 4 0 0 0 0 8H9"/>' +
    '<polyline points="10 10 13 13 10 13 10 10"/>',

  'lock':
    '<rect x="4" y="8" width="8" height="6" rx="1"/>' +
    '<path d="M6 8V6a2 2 0 1 1 4 0v2"/>',

  'unlock':
    '<rect x="4" y="8" width="8" height="6" rx="1"/>' +
    '<path d="M6 8V6a2 2 0 0 1 4 0"/>',

  'align-left':
    '<line x1="2" y1="5" x2="14" y2="5"/>' +
    '<line x1="2" y1="10" x2="10" y2="10"/>' +
    '<line x1="2" y1="2" x2="2" y2="14"/>',

  'sliders':
    '<line x1="4" y1="3" x2="4" y2="6"/>' +
    '<line x1="4" y1="9" x2="4" y2="13"/>' +
    '<line x1="9" y1="3" x2="9" y2="7"/>' +
    '<line x1="9" y1="10" x2="9" y2="13"/>' +
    '<line x1="2" y1="7.5" x2="6" y2="7.5"/>' +
    '<line x1="7" y1="4.5" x2="11" y2="4.5"/>',

  'settings':
    '<circle cx="8" cy="8" r="2"/>' +
    '<path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.6 1.6M11.4 11.4 13 13M3 13l1.6-1.6M11.4 4.6 13 3"/>',
};

const SVG_WRAP = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" ` +
  `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  `${inner}</svg>`;

/**
 * Returns a 16×16 SVG HTML string for the given icon ID.
 * Returns an empty string if the ID is not found (no-op, safe to use as innerHTML).
 */
export function menuIcon(id: string): string {
  const inner = ICONS[id];
  return inner ? SVG_WRAP(inner) : '';
}

/** Exposes the full icon map for tooling / preview use. */
export { ICONS as MENU_ICON_MAP };
