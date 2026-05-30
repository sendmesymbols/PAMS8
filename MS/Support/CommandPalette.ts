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

import { getSetting, setSetting, toHexColor } from './SettingsBus';
import type { SettingDescriptor } from './SettingsWidget';
import SettingsMenu from './SettingsMenu';

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

interface SettingEntry {
  manifestId: string;
  descriptor: SettingDescriptor;
  /** When set, Enter on this row mounts the owning widget rather than editing inline. */
  opener?: () => void;
}

interface RankedItem {
  kind: 'setting' | 'action';
  score: number;
  setting?: SettingEntry;
  action?: ActionEntry;
}

const settingsRegistry = new Map<string, SettingEntry>();
const actionsRegistry = new Map<string, ActionEntry>();

let overlayEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let activeIndex = 0;
let lastResults: RankedItem[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export const CommandPalette = {
  registerSettings(
    manifestId: string,
    manifest: SettingDescriptor[],
    opener?: () => void,
  ): void {
    for (const d of manifest) {
      const key = `${manifestId}:${d.path.join('.')}`;
      settingsRegistry.set(key, { manifestId, descriptor: d, opener });
    }
  },

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
  }): void {
    const safeOpener = () => {
      try {
        opts.opener();
      } catch (err) {
        console.error(`[CommandPalette] failed to open ${opts.id}:`, err);
      }
    };

    actionsRegistry.set(`widget.${opts.id}`, {
      id: `widget.${opts.id}`,
      label: `Open ${opts.label} settings`,
      hint: opts.hint ?? 'Settings widget',
      keywords: ['settings', 'panel', 'widget', ...(opts.keywords ?? [])],
      run: safeOpener,
    });

    SettingsMenu.registerEntry({
      id: opts.id,
      label: opts.label,
      category: opts.category ?? 'Engines',
      icon: opts.icon,
      hint: opts.hint,
      opener: safeOpener,
    });
  },

  registerActions(actions: ActionEntry[]): void {
    for (const a of actions) actionsRegistry.set(a.id, a);
  },

  unregisterAction(id: string): void {
    actionsRegistry.delete(id);
  },

  open(): void {
    ensureOverlay();
    if (!overlayEl) return;
    overlayEl.classList.add('ms-palette-open');
    inputEl!.value = '';
    inputEl!.focus();
    renderResults('');
  },

  close(): void {
    if (overlayEl) overlayEl.classList.remove('ms-palette-open');
  },

  toggle(): void {
    if (overlayEl?.classList.contains('ms-palette-open')) {
      this.close();
    } else {
      this.open();
    }
  },

  isOpen(): boolean {
    return !!overlayEl?.classList.contains('ms-palette-open');
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Overlay construction
// ─────────────────────────────────────────────────────────────────────────────

function ensureOverlay(): void {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = 'ms-command-palette';
  overlayEl.className = 'ms-palette-overlay';
  overlayEl.innerHTML = `
    <div class="ms-palette ms-theme-ops-dark" role="dialog" aria-label="Command palette">
      <div class="ms-palette-input-wrap">
        <span class="ms-palette-prompt">⌘K</span>
        <input class="ms-palette-input" type="text" placeholder="Search settings and actions…" autocomplete="off" spellcheck="false" />
        <span class="ms-palette-hint">↑ ↓ navigate · ⏎ run · esc close</span>
      </div>
      <div class="ms-palette-list" role="listbox"></div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  inputEl = overlayEl.querySelector<HTMLInputElement>('.ms-palette-input');
  listEl = overlayEl.querySelector<HTMLElement>('.ms-palette-list');

  // Click outside the inner panel closes
  overlayEl.addEventListener('mousedown', (e) => {
    if (e.target === overlayEl) CommandPalette.close();
  });

  inputEl?.addEventListener('input', () => renderResults(inputEl!.value));
  inputEl?.addEventListener('keydown', onKeydown);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    CommandPalette.close();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    moveActive(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    moveActive(-1);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    activateCurrent();
  }
}

function moveActive(delta: number): void {
  if (!lastResults.length) return;
  activeIndex = (activeIndex + delta + lastResults.length) % lastResults.length;
  highlightActive();
}

function highlightActive(): void {
  if (!listEl) return;
  const rows = listEl.querySelectorAll<HTMLElement>('.ms-palette-row');
  rows.forEach((r, i) => r.classList.toggle('ms-active', i === activeIndex));
  const active = rows[activeIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function activateCurrent(): void {
  const item = lastResults[activeIndex];
  if (!item) return;
  if (item.kind === 'action' && item.action) {
    CommandPalette.close();
    try {
      item.action.run();
    } catch (err) {
      console.error('[CommandPalette] action threw:', err);
    }
    return;
  }
  if (item.kind === 'setting' && item.setting) {
    const { descriptor, opener } = item.setting;
    if (descriptor.type === 'boolean') {
      const cur = getSetting<boolean>(descriptor.path) === true;
      setSetting(descriptor.path, !cur);
      renderResults(inputEl?.value ?? '');
      return;
    }
    if (descriptor.type === 'number' || descriptor.type === 'string' || descriptor.type === 'enum') {
      openInlineEdit(item.setting);
      return;
    }
    // color or anything else — defer to widget
    CommandPalette.close();
    if (opener) opener();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderResults(query: string): void {
  if (!listEl) return;

  const ranked = rank(query).slice(0, 50);

  if (!ranked.length) {
    lastResults = [];
    activeIndex = 0;
    listEl.innerHTML = `<div class="ms-palette-empty">No matches for “${escapeHtml(query)}”.</div>`;
    return;
  }

  // Palette is a launcher only — actions are the sole row kind.
  const actions = ranked.filter((r) => r.kind === 'action');
  lastResults = actions;
  activeIndex = 0;

  listEl.innerHTML = actions.length ? renderGroup('Launch', actions, 0) : '';

  // Bind clicks
  listEl.querySelectorAll<HTMLElement>('.ms-palette-row').forEach((row) => {
    row.addEventListener('mouseenter', () => {
      activeIndex = Number(row.getAttribute('data-index') ?? 0);
      highlightActive();
    });
    row.addEventListener('click', () => {
      activeIndex = Number(row.getAttribute('data-index') ?? 0);
      activateCurrent();
    });
  });

  highlightActive();
}

function renderGroup(title: string, items: RankedItem[], indexOffset: number): string {
  const rows = items
    .map((it, i) => renderRow(it, indexOffset + i))
    .join('');
  return `
    <div class="ms-palette-group">
      <div class="ms-palette-group-title">${escapeHtml(title)}</div>
      ${rows}
    </div>
  `;
}

function renderRow(item: RankedItem, index: number): string {
  if (item.kind === 'action' && item.action) {
    const a = item.action;
    return `
      <div class="ms-palette-row" data-index="${index}" data-kind="action" role="option">
        <span class="ms-palette-row-icon">▸</span>
        <span class="ms-palette-row-label">${escapeHtml(a.label)}</span>
        ${a.hint ? `<span class="ms-palette-row-hint">${escapeHtml(a.hint)}</span>` : ''}
      </div>
    `;
  }
  if (item.kind === 'setting' && item.setting) {
    const d = item.setting.descriptor;
    const v = getSetting(d.path);
    const valueText = formatValueForRow(d, v);
    return `
      <div class="ms-palette-row" data-index="${index}" data-kind="setting" data-path="${escapeHtml(d.path.join('.'))}" role="option">
        <span class="ms-palette-row-icon">${typeIcon(d.type)}</span>
        <span class="ms-palette-row-label">${escapeHtml(d.label)}</span>
        <span class="ms-palette-row-hint">${escapeHtml(d.group)}</span>
        <span class="ms-palette-row-value">${escapeHtml(valueText)}</span>
      </div>
    `;
  }
  return '';
}

function typeIcon(t: string): string {
  switch (t) {
    case 'boolean':
      return '◉';
    case 'number':
      return '#';
    case 'enum':
      return '☰';
    case 'color':
      return '◐';
    default:
      return '·';
  }
}

function formatValueForRow(d: SettingDescriptor, v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (d.type === 'boolean') return v === true ? 'on' : 'off';
  if (d.type === 'enum' && d.options) {
    const found = d.options.find((o) => o.value === String(v));
    return found ? found.label : String(v);
  }
  if (d.type === 'color') return toHexColor(v);
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline editor for number / string / enum
// ─────────────────────────────────────────────────────────────────────────────

function openInlineEdit(entry: SettingEntry): void {
  if (!listEl) return;
  const d = entry.descriptor;
  const cur = getSetting(d.path);
  const row = listEl.querySelector<HTMLElement>(
    `.ms-palette-row[data-path="${cssEscape(d.path.join('.'))}"]`,
  );
  if (!row) return;

  // Replace the value span with an input/select
  const valueSpan = row.querySelector<HTMLElement>('.ms-palette-row-value');
  if (!valueSpan) return;

  let control: HTMLInputElement | HTMLSelectElement;
  if (d.type === 'enum') {
    const select = document.createElement('select');
    select.className = 'ms-palette-inline ms-select';
    (d.options ?? []).forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (String(cur) === o.value) opt.selected = true;
      select.appendChild(opt);
    });
    control = select;
  } else {
    const input = document.createElement('input');
    input.className = 'ms-palette-inline ms-input';
    input.type = d.type === 'number' ? 'number' : 'text';
    if (d.min !== undefined) input.min = String(d.min);
    if (d.max !== undefined) input.max = String(d.max);
    if (d.step !== undefined) input.step = String(d.step);
    input.value = cur === undefined || cur === null ? '' : String(cur);
    control = input;
  }

  valueSpan.replaceWith(control);
  control.focus();
  if (control instanceof HTMLInputElement) control.select();

  const commit = () => {
    let value: unknown;
    if (d.type === 'number') {
      const n = Number((control as HTMLInputElement).value);
      value = Number.isFinite(n) ? n : 0;
    } else {
      value = control.value;
    }
    setSetting(d.path, value);
    renderResults(inputEl?.value ?? '');
  };

  const cancel = () => renderResults(inputEl?.value ?? '');

  const onCtrlKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };
  control.addEventListener('keydown', onCtrlKey as EventListener);
  control.addEventListener('blur', commit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Ranking
// ─────────────────────────────────────────────────────────────────────────────

function rank(query: string): RankedItem[] {
  const q = query.trim().toLowerCase();
  const items: RankedItem[] = [];

  // Individual settings are intentionally NOT surfaced in the palette — the
  // palette is a launcher for widgets / tools / dialogs. To configure a value,
  // users open the relevant widget (where the row + tooltip live in context).
  // `settingsRegistry` is still populated by engines for the opener-back-pointer
  // mechanism, but skipped during ranking.

  for (const a of actionsRegistry.values()) {
    const haystack = [a.label, a.hint ?? '', ...(a.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    const score = scoreMatch(q, haystack, a.label.toLowerCase());
    if (score > 0 || q === '') {
      // Boost actions slightly when query is empty so the user sees them first
      const baseScore = q === '' ? 70 : score;
      items.push({ kind: 'action', score: baseScore, action: a });
    }
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}

/** Cheap fuzzy scorer — substring + token + acronym hits, with label boost. */
function scoreMatch(query: string, haystack: string, label: string): number {
  if (!query) return 1;
  let score = 0;
  if (label.includes(query)) score += 60;
  if (haystack.includes(query)) score += 30;

  // All tokens of the query found somewhere
  const tokens = query.split(/\s+/).filter(Boolean);
  let allHit = true;
  for (const t of tokens) {
    if (haystack.includes(t)) score += 8;
    else allHit = false;
  }
  if (!allHit && tokens.length > 1 && !haystack.includes(query)) {
    // partial token miss, drop hard
    return Math.max(0, score - 30);
  }

  // Acronym match against label words
  const words = label.split(/[^a-z0-9]+/i).filter(Boolean);
  if (words.length > 1) {
    const acronym = words.map((w) => w[0] ?? '').join('').toLowerCase();
    if (acronym.startsWith(query)) score += 25;
  }

  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(s: string): string {
  if (typeof (window as any).CSS?.escape === 'function') {
    return (window as any).CSS.escape(s);
  }
  return s.replace(/(["\\\][:.#()])/g, '\\$1');
}

export default CommandPalette;
