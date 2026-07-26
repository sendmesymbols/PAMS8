/**
 * MilSymPicker.ts
 *
 * The slide editor's military-symbol browser: a flyout with a search box, an
 * affiliation switch and a collapsible tree over the ~511 FPoint entries in
 * MS/Data/Symbols.json.
 *
 * The catalogue already carries a three-level `Grp` path (Air ▸ Fixed Wing ▸
 * Fighter), so the tree is read straight off it rather than invented here.
 * Thumbnails are rendered by MilSymFactory and only when scrolled into view —
 * rendering all 511 up front would stall the editor for no benefit, and the
 * Activities group alone holds 149.
 */

import SymbolMetadataService from '../SymbolMetadataService';
import { AFFILIATIONS, isMilSymAvailable, renderMilSym, sidcFromKey } from './MilSymFactory';

interface CatalogueEntry {
  key: string;
  name: string;
  /** Grp path, always padded to at least one level. */
  path: string[];
}

/** Cap on how many hits a search renders — beyond this, refine the query. */
const MAX_SEARCH_HITS = 240;
const THUMB_PX = 30;

let _catalogue: CatalogueEntry[] | null = null;

/** Every FPoint entry, flattened once per session. */
function catalogue(): CatalogueEntry[] {
  if (_catalogue) return _catalogue;
  const data = SymbolMetadataService.getData() ?? {};
  const out: CatalogueEntry[] = [];
  for (const [key, def] of Object.entries<any>(data)) {
    if (def?.SymGeoType !== 'FPoint') continue;
    const path = Array.isArray(def.Grp) && def.Grp.length ? def.Grp.map(String) : ['Other'];
    out.push({ key, name: String(def.Name ?? key), path });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  _catalogue = out;
  return out;
}

/** entries grouped by path[0] → path[1], preserving name order within a leaf. */
function grouped(): Map<string, Map<string, CatalogueEntry[]>> {
  const tree = new Map<string, Map<string, CatalogueEntry[]>>();
  for (const e of catalogue()) {
    const top = e.path[0] ?? 'Other';
    const sub = e.path[1] ?? '—';
    let branch = tree.get(top);
    if (!branch) tree.set(top, (branch = new Map()));
    const leaf = branch.get(sub);
    if (leaf) leaf.push(e);
    else branch.set(sub, [e]);
  }
  return tree;
}

export interface MilSymPickerOptions {
  /** Chosen symbol — the editor arms its placement tool with this key. */
  onPick(symKey: string): void;
  /** Current affiliation digit, so the flyout opens showing the live value. */
  getAffiliation(): string;
  /** Affiliation switched inside the flyout — the editor stores it as a default. */
  setAffiliation(value: string): void;
}

export default class MilSymPicker {
  private _opts: MilSymPickerOptions;
  private _el: HTMLElement | null = null;
  private _io: IntersectionObserver | null = null;
  private _outside: ((e: MouseEvent) => void) | null = null;

  constructor(opts: MilSymPickerOptions) {
    this._opts = opts;
  }

  public get isOpen(): boolean {
    return !!this._el;
  }

  public toggle(stage: HTMLElement): void {
    if (this._el) this.hide();
    else this.show(stage);
  }

  public show(stage: HTMLElement): void {
    if (this._el || !isMilSymAvailable()) return;
    this._injectStyles();

    const el = document.createElement('div');
    el.className = 'ms-milsym-picker';
    el.innerHTML = `
      <div class="ms-milsym-head">
        <input type="search" class="ms-milsym-search" placeholder="Search symbols…" autocomplete="off">
        <div class="ms-milsym-affs">${AFFILIATIONS.slice(0, 4)
          .map(
            (a) =>
              `<button data-aff="${a.value}" title="${a.label}">${a.label.split(' ')[0]}</button>`,
          )
          .join('')}</div>
      </div>
      <div class="ms-milsym-body"></div>
      <div class="ms-milsym-foot">Click a symbol, then click the slide to place it.</div>`;
    stage.appendChild(el);
    this._el = el;

    this._io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this._paintThumb(entry.target as HTMLElement);
          this._io?.unobserve(entry.target);
        }
      },
      { root: el.querySelector('.ms-milsym-body'), rootMargin: '120px' },
    );

    this._renderTree();
    this._syncAffiliation();

    const search = el.querySelector('.ms-milsym-search') as HTMLInputElement;
    search.addEventListener('input', () => {
      const q = search.value.trim();
      if (q) this._renderSearch(q);
      else this._renderTree();
    });
    search.focus();

    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const aff = target.closest('[data-aff]') as HTMLElement | null;
      if (aff) {
        this._opts.setAffiliation(aff.dataset.aff!);
        this._syncAffiliation();
        // Every visible thumbnail is now the wrong colour — repaint in place.
        this._el?.querySelectorAll('.ms-milsym-thumb').forEach((t) => this._paintThumb(t as HTMLElement));
        return;
      }
      const group = target.closest('[data-group]') as HTMLElement | null;
      if (group) {
        this._toggleGroup(group);
        return;
      }
      const item = target.closest('[data-key]') as HTMLElement | null;
      if (item) {
        this._opts.onPick(item.dataset.key!);
        this.hide();
      }
    });

    // Click-away, but not on the tool strip: the picker's own tool button
    // toggles it, and closing here first would make that button re-open it.
    this._outside = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement;
      if (this._el?.contains(t) || t.closest('[data-tool="milsym"]')) return;
      this.hide();
    };
    document.addEventListener('mousedown', this._outside, true);
  }

  public hide(): void {
    if (this._outside) {
      document.removeEventListener('mousedown', this._outside, true);
      this._outside = null;
    }
    this._io?.disconnect();
    this._io = null;
    this._el?.remove();
    this._el = null;
  }

  public dispose(): void {
    this.hide();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _body(): HTMLElement | null {
    return this._el?.querySelector('.ms-milsym-body') as HTMLElement | null;
  }

  private _syncAffiliation(): void {
    const current = this._opts.getAffiliation();
    this._el?.querySelectorAll('[data-aff]').forEach((b: any) => {
      b.classList.toggle('active', b.dataset.aff === current);
    });
  }

  private _renderTree(): void {
    const body = this._body();
    if (!body) return;
    this._io?.disconnect();
    body.innerHTML = '';
    for (const [top, branch] of grouped()) {
      const count = [...branch.values()].reduce((n, list) => n + list.length, 0);
      const row = document.createElement('div');
      row.className = 'ms-milsym-group';
      row.dataset.group = top;
      row.innerHTML = `<span class="ms-milsym-caret">▸</span><span>${top}</span><span class="ms-milsym-count">${count}</span>`;
      body.appendChild(row);
      const holder = document.createElement('div');
      holder.className = 'ms-milsym-sub';
      holder.style.display = 'none';
      body.appendChild(holder);
    }
  }

  /** Build a group's rows the first time it is opened, then just show/hide. */
  private _toggleGroup(row: HTMLElement): void {
    const holder = row.nextElementSibling as HTMLElement | null;
    if (!holder) return;
    const open = holder.style.display !== 'none';
    holder.style.display = open ? 'none' : '';
    const caret = row.querySelector('.ms-milsym-caret');
    if (caret) caret.textContent = open ? '▸' : '▾';
    if (open || holder.childElementCount) return;

    const branch = grouped().get(row.dataset.group!);
    if (!branch) return;
    for (const [sub, entries] of branch) {
      const label = document.createElement('div');
      label.className = 'ms-milsym-sublabel';
      label.textContent = sub;
      holder.appendChild(label);
      holder.appendChild(this._grid(entries));
    }
  }

  private _renderSearch(query: string): void {
    const body = this._body();
    if (!body) return;
    this._io?.disconnect();
    const q = query.toLowerCase();
    const hits = catalogue().filter(
      (e) => e.name.toLowerCase().includes(q) || e.path.join(' ').toLowerCase().includes(q),
    );
    body.innerHTML = '';
    if (!hits.length) {
      body.innerHTML = '<div class="ms-milsym-empty">No matching symbols.</div>';
      return;
    }
    const shown = hits.slice(0, MAX_SEARCH_HITS);
    body.appendChild(this._grid(shown));
    if (hits.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'ms-milsym-empty';
      more.textContent = `${hits.length - shown.length} more — refine the search.`;
      body.appendChild(more);
    }
  }

  private _grid(entries: CatalogueEntry[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'ms-milsym-grid';
    for (const e of entries) {
      const cell = document.createElement('button');
      cell.className = 'ms-milsym-cell';
      cell.dataset.key = e.key;
      cell.title = `${e.name}\n${e.path.join(' ▸ ')}`;
      const thumb = document.createElement('span');
      thumb.className = 'ms-milsym-thumb';
      thumb.dataset.key = e.key;
      cell.appendChild(thumb);
      const name = document.createElement('span');
      name.className = 'ms-milsym-name';
      name.textContent = e.name;
      cell.appendChild(name);
      grid.appendChild(cell);
      this._io?.observe(thumb);
    }
    return grid;
  }

  /**
   * Paint one thumbnail. Rendered markers are cached canvases shared with the
   * canvas overlays, so the picker takes a data URL rather than adopting the
   * element itself — a DOM node can only have one parent.
   */
  private _paintThumb(el: HTMLElement): void {
    const key = el.dataset.key;
    if (!key) return;
    const sidc = sidcFromKey(key, { affiliation: this._opts.getAffiliation() });
    const render = renderMilSym(sidc, undefined, THUMB_PX * 2);
    if (!render) {
      el.textContent = '?';
      return;
    }
    const img = new Image();
    img.src = render.canvas.toDataURL();
    el.textContent = '';
    el.appendChild(img);
  }

  private _injectStyles(): void {
    if (document.getElementById('ms-milsym-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-milsym-style';
    style.textContent = `
      .ms-milsym-picker {
        position: absolute; z-index: 30; top: 8px; left: 14px;
        width: 292px; max-height: calc(100% - 24px);
        display: flex; flex-direction: column;
        background: rgba(24,29,35,0.98); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px; box-shadow: 0 12px 34px rgba(0,0,0,0.5);
        font: 12px/1.4 system-ui, sans-serif; color: #dde3e8;
      }
      .ms-milsym-head {
        padding: 8px 9px; border-bottom: 1px solid rgba(255,255,255,0.12);
        display: flex; flex-direction: column; gap: 6px;
      }
      .ms-milsym-search {
        background: rgba(255,255,255,0.06); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 4px 7px; font: inherit; height: 26px; box-sizing: border-box;
      }
      .ms-milsym-search:focus { outline: none; border-color: #2d6cdf; }
      .ms-milsym-affs { display: flex; gap: 4px; }
      .ms-milsym-affs button {
        flex: 1; background: rgba(255,255,255,0.06); color: #aab4be;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 3px 0; font: inherit; cursor: pointer;
      }
      .ms-milsym-affs button:hover { background: rgba(255,255,255,0.12); }
      .ms-milsym-affs button.active { background: #2d6cdf; border-color: #2d6cdf; color: #fff; }
      .ms-milsym-body { overflow: auto; padding: 6px 8px 8px; }
      .ms-milsym-group {
        display: flex; align-items: center; gap: 6px; cursor: pointer;
        padding: 5px 4px; border-radius: 5px;
      }
      .ms-milsym-group:hover { background: rgba(255,255,255,0.07); }
      .ms-milsym-caret { color: #7d8894; width: 10px; }
      .ms-milsym-count { margin-left: auto; color: #7d8894; font-size: 11px; }
      .ms-milsym-sublabel {
        font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
        color: #7d8894; margin: 8px 0 4px 16px;
      }
      .ms-milsym-grid {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-left: 12px;
      }
      .ms-milsym-cell {
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        background: rgba(255,255,255,0.04); border: 1px solid transparent;
        border-radius: 6px; padding: 4px 2px; cursor: pointer; overflow: hidden;
        color: #aab4be; font: inherit;
      }
      .ms-milsym-cell:hover { background: rgba(45,108,223,0.22); border-color: #2d6cdf; }
      .ms-milsym-thumb {
        height: ${THUMB_PX}px; display: flex; align-items: center; justify-content: center;
        color: #7d8894;
      }
      .ms-milsym-thumb img { max-height: ${THUMB_PX}px; max-width: 100%; }
      .ms-milsym-name {
        font-size: 9px; line-height: 1.15; text-align: center; max-height: 22px;
        overflow: hidden; word-break: break-word;
      }
      .ms-milsym-empty { color: #7d8894; padding: 10px 4px; }
      .ms-milsym-foot {
        padding: 6px 9px; border-top: 1px solid rgba(255,255,255,0.12);
        color: #7d8894; font-size: 11px;
      }`;
    document.head.appendChild(style);
  }
}
