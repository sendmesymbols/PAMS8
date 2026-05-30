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

import { menuIcon } from '../Managers/MenuIcons';

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

const entries = new Map<string, MenuEntry>();
const categoryOrder = ['Engines', 'Map', 'Appearance', 'Tools'];

let popoverEl: HTMLDivElement | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export const SettingsMenu = {
  registerEntry(entry: MenuEntry): void {
    entries.set(entry.id, entry);
    refreshIfOpen();
  },

  unregisterEntry(id: string): void {
    entries.delete(id);
    refreshIfOpen();
  },

  /** Open the popover anchored beneath `anchor`. Toggles closed if already open. */
  open(anchor: HTMLElement): void {
    if (popoverEl) {
      SettingsMenu.close();
      return;
    }
    popoverEl = buildPopover();
    document.body.appendChild(popoverEl);
    positionPopover(popoverEl, anchor);
    // Force a layout flush so the transition from opacity:0 → 1 actually
    // animates instead of being batched into the initial paint.
    void popoverEl.offsetHeight;
    popoverEl.classList.add('ms-sm-visible');

    // Click outside closes
    outsideClickHandler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!popoverEl) return;
      if (target && (popoverEl.contains(target) || anchor.contains(target))) return;
      SettingsMenu.close();
    };
    document.addEventListener('mousedown', outsideClickHandler);

    escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        SettingsMenu.close();
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  close(): void {
    if (!popoverEl) return;
    popoverEl.remove();
    popoverEl = null;
    if (outsideClickHandler) document.removeEventListener('mousedown', outsideClickHandler);
    if (escHandler) document.removeEventListener('keydown', escHandler);
    outsideClickHandler = null;
    escHandler = null;
  },

  isOpen(): boolean {
    return !!popoverEl;
  },
};

function refreshIfOpen(): void {
  if (!popoverEl) return;
  const body = popoverEl.querySelector<HTMLElement>('.ms-sm-body');
  if (body) body.innerHTML = renderBody();
  bindRowClicks();
}

function buildPopover(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'ms-settings-menu';
  el.className = 'ms-settings-menu ms-theme-ops-dark';
  el.setAttribute('role', 'menu');
  el.innerHTML = `
    <div class="ms-sm-header">
      <span class="ms-sm-title">Settings</span>
      <button class="ms-sm-close" title="Close">✕</button>
    </div>
    <div class="ms-sm-body">${renderBody()}</div>
    <div class="ms-sm-footer">
      <kbd>Ctrl</kbd> + <kbd>K</kbd> &nbsp;to search settings &amp; run actions
    </div>
  `;
  el.querySelector('.ms-sm-close')?.addEventListener('click', () => SettingsMenu.close());
  // Bind row clicks after DOM is in document — buildPopover is called before append.
  // We bind in `open()` via refreshIfOpen+bindRowClicks. But since refreshIfOpen
  // is a no-op until popoverEl is set, we bind here directly.
  setTimeout(() => bindRowClicks(), 0);
  return el;
}

function renderBody(): string {
  if (entries.size === 0) {
    return `<div class="ms-sm-empty">No widgets registered yet.</div>`;
  }

  // Group by category, respecting categoryOrder; unknown categories appear after.
  const buckets = new Map<string, MenuEntry[]>();
  for (const e of entries.values()) {
    if (!buckets.has(e.category)) buckets.set(e.category, []);
    buckets.get(e.category)!.push(e);
  }
  const orderedCats = [
    ...categoryOrder.filter((c) => buckets.has(c)),
    ...Array.from(buckets.keys()).filter((c) => !categoryOrder.includes(c)),
  ];

  return orderedCats
    .map((cat) => {
      const items = buckets.get(cat)!;
      items.sort((a, b) => a.label.localeCompare(b.label));
      return `
        <div class="ms-sm-group">
          <div class="ms-sm-group-title">${escapeHtml(cat)}</div>
          ${items
            .map(
              (it) => `
                <button class="ms-sm-row" data-entry-id="${escapeHtml(it.id)}" role="menuitem">
                  <span class="ms-sm-row-icon">${menuIcon(it.icon ?? 'settings')}</span>
                  <span class="ms-sm-row-label">${escapeHtml(it.label)}</span>
                </button>
              `,
            )
            .join('')}
        </div>
      `;
    })
    .join('');
}

function bindRowClicks(): void {
  if (!popoverEl) return;
  popoverEl.querySelectorAll<HTMLButtonElement>('.ms-sm-row').forEach((row) => {
    row.onclick = () => {
      const id = row.getAttribute('data-entry-id');
      if (!id) return;
      const entry = entries.get(id);
      SettingsMenu.close();
      try {
        entry?.opener();
      } catch (err) {
        console.error(`[SettingsMenu] opener for "${id}" threw:`, err);
      }
    };
  });
}

function positionPopover(el: HTMLDivElement, anchor: HTMLElement): void {
  const margin = 6;
  const anchorRect = anchor.getBoundingClientRect();
  // Measure once made visible (offsetWidth requires layout)
  el.style.visibility = 'hidden';
  el.style.left = '0px';
  el.style.top = '0px';
  // Force layout
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  // Prefer anchor-right alignment so the popover doesn't run off-screen on small viewports.
  let left = anchorRect.right - w;
  if (left < margin) left = anchorRect.left;
  if (left + w > window.innerWidth - margin) left = window.innerWidth - w - margin;
  left = Math.max(margin, left); // never let the popover go off the left edge
  let top = anchorRect.bottom + margin;
  if (top + h > window.innerHeight - margin) top = Math.max(margin, anchorRect.top - h - margin);
  top = Math.max(margin, top);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.visibility = '';
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default SettingsMenu;
