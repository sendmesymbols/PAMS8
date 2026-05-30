/**
 * SettingsWidget.ts
 *
 * Manifest-driven settings widget renderer. One `mountSettingsWidget()` call
 * produces a draggable `ms-panel` populated from a `SettingDescriptor[]`.
 *
 * Per-engine widget files are thin shells around this — see
 *   MS/Engines/MeasurementSettingsWidget.ts for the canonical example.
 *
 * Wiring conventions:
 *   - Widget reads + writes through SettingsBus (the same `settingsChanged`
 *     CustomEvent the legacy #settingsPanel drives). Engines need no changes.
 *   - Theme is CSS-var driven via ThemeManager. The widget tags itself
 *     `ms-theme-ops-dark` at creation; theme switches happen via :root vars and
 *     repaint automatically.
 *   - One widget instance per `id`. Re-opening focuses + raises the existing
 *     widget rather than stacking duplicates.
 *
 * Gear-icon convention (for follow-up widgets):
 *   Topbar buttons that own a feature get a small `.ms-gear-btn` adjacent to
 *   them. The main button toggles/activates the feature; the gear calls the
 *   feature's `openXxxSettings()` to mount this widget anchored just below.
 */

import { getSetting, setSetting, onSettingsChanged, toHexColor, hexToRgb } from './SettingsBus';

export type SettingType = 'boolean' | 'number' | 'enum' | 'color' | 'string';

export interface SettingOption {
  value: string;
  label: string;
}

export interface SettingDescriptor {
  path: string[];
  label: string;
  group: string;
  type: SettingType;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  /** Value persisted as `[r,g,b]` triple instead of `'#hex'` (e.g. measurement.lineColor). */
  colorAsRgb?: boolean;
  /** Display only — no live setting. Used for header help text. */
  hint?: string;
  help: string;
  keywords?: string[];
}

export interface MountWidgetOptions {
  /** DOM id for the panel. Doubles as instance-singleton key. */
  id: string;
  /** Header title (e.g. "Measurement"). */
  title: string;
  /** Header icon (short text or emoji, rendered in the icon badge). */
  icon: string;
  /** Settings to render. */
  manifest: SettingDescriptor[];
  /** Optional anchor — pixel coordinates near which to place the widget. */
  anchor?: { x?: number; y?: number };
  /** Optional override for the default panel width (px). */
  width?: number;
  /** Optional preselected group to scroll into view on open. */
  focusGroup?: string;
}

export interface SettingsWidgetHandle {
  /** DOM id of the mounted panel. */
  id: string;
  /** Focus + raise the widget. */
  focus(): void;
  /** Scroll the named group into view. */
  scrollToGroup(group: string): void;
  /** Remove the widget. */
  close(): void;
}

const MOUNTED = new Map<string, SettingsWidgetHandle>();

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip portal — one element on <body> so panel `overflow: hidden` never clips
// the help bubble. Installed lazily on first widget mount; reused thereafter.
// ─────────────────────────────────────────────────────────────────────────────
let tooltipPortalEl: HTMLDivElement | null = null;
let tooltipInstalled = false;

function installTooltipPortal(): void {
  if (tooltipInstalled) return;
  tooltipInstalled = true;

  tooltipPortalEl = document.createElement('div');
  tooltipPortalEl.className = 'ms-help-tooltip-portal';
  tooltipPortalEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipPortalEl);

  const show = (anchor: HTMLElement) => {
    const text = anchor.getAttribute('data-tooltip');
    if (!text || !tooltipPortalEl) return;
    tooltipPortalEl.textContent = text;
    tooltipPortalEl.classList.add('ms-tt-visible');

    // Measure after content set so width is correct
    const portal = tooltipPortalEl.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const margin = 8;
    let left = anchorRect.left + anchorRect.width / 2 - portal.width / 2;
    let top = anchorRect.top - portal.height - margin;
    // Flip below if no room above
    if (top < margin) top = anchorRect.bottom + margin;
    // Clamp horizontally
    left = Math.max(margin, Math.min(left, window.innerWidth - portal.width - margin));
    tooltipPortalEl.style.left = `${left}px`;
    tooltipPortalEl.style.top = `${top}px`;
  };

  const hide = () => {
    tooltipPortalEl?.classList.remove('ms-tt-visible');
  };

  document.addEventListener('mouseover', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('.ms-help-tooltip');
    if (t instanceof HTMLElement) show(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('.ms-help-tooltip');
    if (t) hide();
  });
  // Also hide on scroll within any panel — position would otherwise stick
  document.addEventListener('scroll', hide, true);
}

export function mountSettingsWidget(opts: MountWidgetOptions): SettingsWidgetHandle {
  installTooltipPortal();
  const existing = MOUNTED.get(opts.id);
  if (existing) {
    existing.focus();
    if (opts.focusGroup) existing.scrollToGroup(opts.focusGroup);
    return existing;
  }

  const panel = document.createElement('div');
  panel.id = opts.id;
  panel.className = 'ms-panel ms-theme-ops-dark ms-settings-widget';
  panel.setAttribute('data-engine', opts.id);

  const width = opts.width ?? 340;
  panel.style.width = `${width}px`;

  // Anchor placement — clamp to viewport
  const margin = 8;
  const fallbackTop = 62;
  const fallbackLeft = 320;
  const x = opts.anchor?.x;
  const y = opts.anchor?.y;
  const targetLeft = typeof x === 'number' ? x : fallbackLeft;
  const targetTop = typeof y === 'number' ? y : fallbackTop;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - 180);
  panel.style.left = `${Math.max(margin, Math.min(targetLeft, maxLeft))}px`;
  panel.style.top = `${Math.max(margin, Math.min(targetTop, maxTop))}px`;
  panel.style.right = 'auto';

  panel.innerHTML = buildPanelHTML(opts);
  document.body.appendChild(panel);
  panel.classList.add('ms-visible');

  // Wire row controls
  const cleanupRows = bindRowControls(panel, opts.manifest);

  // Cross-sync — if the old panel changes the same path, update our control.
  const unsubBus = onSettingsChanged((detail) => {
    syncRowFromBus(panel, opts.manifest, detail.path, detail.value);
  });

  // Header buttons
  const helpBtn = panel.querySelector('.ms-help-btn') as HTMLButtonElement | null;
  const helpPopover = panel.querySelector('.ms-help-popover') as HTMLElement | null;
  helpBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (helpPopover) helpPopover.hidden = !helpPopover.hidden;
  });
  panel.querySelector('.ms-help-popover .ms-help-close')?.addEventListener('click', () => {
    if (helpPopover) helpPopover.hidden = true;
  });

  // Drag — anchored to the header
  const dragCleanup = installDrag(panel);

  // Close
  const close = () => {
    cleanupRows();
    dragCleanup();
    unsubBus();
    panel.classList.remove('ms-visible');
    panel.remove();
    MOUNTED.delete(opts.id);
  };
  panel.querySelector('.ms-close-btn')?.addEventListener('click', close);

  // Esc closes (only if no popover open)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && document.body.contains(panel)) {
      if (helpPopover && !helpPopover.hidden) {
        helpPopover.hidden = true;
        return;
      }
      close();
    }
  };
  document.addEventListener('keydown', onKey);

  const handle: SettingsWidgetHandle = {
    id: opts.id,
    focus() {
      raise(panel);
    },
    scrollToGroup(group: string) {
      const target = panel.querySelector(
        `.ms-sw-group[data-group="${cssEscape(group)}"]`,
      ) as HTMLElement | null;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    close() {
      document.removeEventListener('keydown', onKey);
      close();
    },
  };

  MOUNTED.set(opts.id, handle);
  if (opts.focusGroup) handle.scrollToGroup(opts.focusGroup);
  raise(panel);
  return handle;
}

/** Close all settings widgets currently mounted. */
export function closeAllSettingsWidgets(): void {
  Array.from(MOUNTED.values()).forEach((h) => h.close());
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function buildPanelHTML(opts: MountWidgetOptions): string {
  const groups = groupManifest(opts.manifest);

  const header = `
    <div class="ms-header" data-drag-handle>
      <span class="ms-header-icon">${escapeHtml(opts.icon)}</span>
      <span class="ms-header-title">${escapeHtml(opts.title)}</span>
      <button class="ms-header-btn ms-btn-round ms-help-btn" title="About this panel">?</button>
      <button class="ms-header-btn ms-close-btn" title="Close">✕</button>
    </div>
    <div class="ms-help-popover" hidden>
      <div class="ms-help-head">
        <div>
          <div class="ms-help-kicker">Settings</div>
          <div class="ms-help-title">${escapeHtml(opts.title)}</div>
        </div>
        <button class="ms-help-close">✕</button>
      </div>
      <div class="ms-help-body">
        <p>Every row controls one setting. Hover the <strong>?</strong> next to a label to see what it does. Changes apply live and stay in sync with the legacy Settings panel.</p>
        <p>Open this widget any time from <kbd>Ctrl</kbd>+<kbd>K</kbd>.</p>
      </div>
    </div>
  `;

  const body = `
    <div class="ms-body ms-sw-body">
      ${groups
        .map(
          (g) => `
            <div class="ms-sw-group" data-group="${escapeHtml(g.title)}">
              <div class="ms-section-title">${escapeHtml(g.title)}</div>
              <div class="ms-sw-rows">
                ${g.items.map((it) => renderRow(it)).join('')}
              </div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;

  return header + body;
}

interface GroupBlock {
  title: string;
  items: SettingDescriptor[];
}

function groupManifest(manifest: SettingDescriptor[]): GroupBlock[] {
  const order: string[] = [];
  const map = new Map<string, SettingDescriptor[]>();
  for (const item of manifest) {
    if (!map.has(item.group)) {
      map.set(item.group, []);
      order.push(item.group);
    }
    map.get(item.group)!.push(item);
  }
  return order.map((title) => ({ title, items: map.get(title)! }));
}

function renderRow(d: SettingDescriptor): string {
  const v = getSetting(d.path);
  const rowAttrs = `data-path="${escapeHtml(d.path.join('.'))}" data-type="${d.type}"`;
  const label = `
    <label class="ms-sw-label">
      ${escapeHtml(d.label)}
      <span class="ms-help-tooltip" data-tooltip="${escapeHtml(d.help)}">?</span>
    </label>
  `;

  let control = '';
  switch (d.type) {
    case 'boolean': {
      const checked = v === true ? 'checked' : '';
      control = `<input type="checkbox" class="ms-sw-input" ${checked}>`;
      break;
    }
    case 'number': {
      const min = d.min !== undefined ? `min="${d.min}"` : '';
      const max = d.max !== undefined ? `max="${d.max}"` : '';
      const step = d.step !== undefined ? `step="${d.step}"` : '';
      const val = typeof v === 'number' ? String(v) : '';
      control = `<input type="number" class="ms-sw-input ms-input" ${min} ${max} ${step} value="${escapeHtml(val)}">`;
      break;
    }
    case 'enum': {
      const opts = d.options ?? [];
      const cur = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      control = `<select class="ms-sw-input ms-select">${opts
        .map(
          (o) =>
            `<option value="${escapeHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`,
        )
        .join('')}</select>`;
      break;
    }
    case 'color': {
      const hex = toHexColor(v);
      control = `<input type="color" class="ms-sw-input" value="${escapeHtml(hex)}">`;
      break;
    }
    case 'string': {
      const s = typeof v === 'string' ? v : '';
      control = `<input type="text" class="ms-sw-input ms-input" value="${escapeHtml(s)}">`;
      break;
    }
  }

  return `<div class="ms-sw-row" ${rowAttrs}>${label}<div class="ms-sw-ctrl">${control}</div></div>`;
}

function bindRowControls(
  panel: HTMLElement,
  manifest: SettingDescriptor[],
): () => void {
  const rows = panel.querySelectorAll<HTMLElement>('.ms-sw-row');
  const cleanups: Array<() => void> = [];

  rows.forEach((row) => {
    const fullPath = row.getAttribute('data-path') ?? '';
    const type = row.getAttribute('data-type') as SettingType;
    const descriptor = manifest.find((d) => d.path.join('.') === fullPath);
    if (!descriptor) return;
    const input = row.querySelector<HTMLInputElement | HTMLSelectElement>('.ms-sw-input');
    if (!input) return;

    const fire = () => {
      const value = readValue(input, type, descriptor);
      setSetting(descriptor.path, value);
    };

    const evt = type === 'number' || type === 'string' ? 'change' : 'change';
    input.addEventListener(evt, fire);
    if (type === 'number' || type === 'string') {
      input.addEventListener('blur', fire);
    }
    cleanups.push(() => input.removeEventListener(evt, fire));
  });

  return () => cleanups.forEach((fn) => fn());
}

function readValue(
  input: HTMLInputElement | HTMLSelectElement,
  type: SettingType,
  d: SettingDescriptor,
): unknown {
  switch (type) {
    case 'boolean':
      return (input as HTMLInputElement).checked;
    case 'number': {
      const n = Number((input as HTMLInputElement).value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'enum':
      return (input as HTMLSelectElement).value;
    case 'color': {
      const hex = (input as HTMLInputElement).value;
      return d.colorAsRgb ? hexToRgb(hex) : hex;
    }
    case 'string':
    default:
      return (input as HTMLInputElement).value;
  }
}

function syncRowFromBus(
  panel: HTMLElement,
  manifest: SettingDescriptor[],
  path: string[],
  value: unknown,
): void {
  const fullPath = path.join('.');
  const row = panel.querySelector<HTMLElement>(
    `.ms-sw-row[data-path="${cssEscape(fullPath)}"]`,
  );
  if (!row) return;
  const descriptor = manifest.find((d) => d.path.join('.') === fullPath);
  if (!descriptor) return;
  const input = row.querySelector<HTMLInputElement | HTMLSelectElement>('.ms-sw-input');
  if (!input) return;

  switch (descriptor.type) {
    case 'boolean':
      (input as HTMLInputElement).checked = value === true;
      break;
    case 'number':
      (input as HTMLInputElement).value =
        typeof value === 'number' ? String(value) : '';
      break;
    case 'enum':
      (input as HTMLSelectElement).value =
        typeof value === 'string' || typeof value === 'number' ? String(value) : '';
      break;
    case 'color':
      (input as HTMLInputElement).value = toHexColor(value);
      break;
    case 'string':
      (input as HTMLInputElement).value =
        typeof value === 'string' ? value : '';
      break;
  }
}

function installDrag(panel: HTMLElement): () => void {
  const handle = panel.querySelector<HTMLElement>('[data-drag-handle]');
  if (!handle) return () => {};
  let dragging = false;
  let ox = 0;
  let oy = 0;

  const onDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    document.body.style.userSelect = 'none';
    handle.style.cursor = 'grabbing';
    e.preventDefault();
  };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth - 4);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight - 4);
    panel.style.left = `${Math.max(0, Math.min(e.clientX - ox, maxLeft))}px`;
    panel.style.top = `${Math.max(0, Math.min(e.clientY - oy, maxTop))}px`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    handle.style.cursor = '';
  };

  handle.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  return () => {
    handle.removeEventListener('mousedown', onDown);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
}

let zCounter = 1100;
function raise(panel: HTMLElement): void {
  zCounter += 1;
  panel.style.zIndex = String(zCounter);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cssEscape(s: string): string {
  // CSS.escape isn't typed everywhere; fall back to a simple safe regex
  if (typeof (window as any).CSS?.escape === 'function') {
    return (window as any).CSS.escape(s);
  }
  return s.replace(/(["\\\][:.#()])/g, '\\$1');
}
