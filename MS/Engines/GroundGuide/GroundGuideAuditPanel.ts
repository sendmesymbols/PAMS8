/**
 * GroundGuideAuditPanel.ts
 *
 * The list the Ground Guide shows after checking symbols that are already on
 * the map: which ones are on ground their unit type cannot use, why, and whether the
 * verdict has changed since they were placed. Click a row to open its details and
 * zoom to it. Built from DOM nodes and `textContent` only, so symbol names and class
 * labels can never inject markup.
 */

import type { GroundGuideAudit, GroundGuideAuditEntry } from './GroundGuideTypes';

const STYLE_ID = 'ms-ground-guide-audit-style';

const CSS = `
.ms-gga{position:fixed;right:12px;top:72px;z-index:2147482000;width:360px;max-height:70vh;display:none;flex-direction:column;
  font:400 12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#f3f5f7;background:#1b1f25;border:1px solid #39414b;
  border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.45);overflow:hidden}
.ms-gga-head{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#242a32;border-bottom:1px solid #39414b}
.ms-gga-title{font-weight:600;font-size:13px;flex:1}
.ms-gga button{font:inherit;color:inherit;cursor:pointer}
.ms-gga-btn{padding:3px 10px;min-height:28px;border-radius:6px;border:1px solid #4a535e;background:#2b323b}
.ms-gga-btn:hover{background:#363f4a}
.ms-gga-x{padding:0;min-width:28px;min-height:28px;font-size:18px;line-height:1;border:0;background:none;color:#9aa3ad}
.ms-gga button:focus-visible,.ms-gga input:focus-visible,.ms-gga-title:focus-visible{outline:2px solid #6db3ff;outline-offset:1px}
.ms-gga-title{outline:none}
@media (prefers-reduced-motion:reduce){.ms-gga-bar>div{transition:none}}
.ms-gga-sum{padding:8px 12px;border-bottom:1px solid #2c333c}
.ms-gga-soft{color:#9aa3ad;font-size:11px}
.ms-gga-opt{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #2c333c;color:#c5cbd2}
.ms-gga-list{overflow:auto;flex:1;min-height:0}
.ms-gga-row{display:block;width:100%;text-align:left;padding:7px 12px;border:0;border-bottom:1px solid #2c333c;background:none}
.ms-gga-row:hover,.ms-gga-row:focus-visible{background:#262d36}
.ms-gga-row:focus-visible{outline:2px solid #6db3ff;outline-offset:-2px}
.ms-gga-line{display:flex;align-items:center;gap:8px}
.ms-gga-dot{flex:none;width:10px;height:10px;border-radius:50%}
.ms-gga-name{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ms-gga-tag{flex:none;padding:0 7px;border-radius:999px;background:#323a44;font-size:11px;color:#c5cbd2}
.ms-gga-msg{margin:2px 0 0 18px;color:#c5cbd2}
.ms-gga-more{margin:5px 0 0 18px;padding:6px 8px;border-radius:6px;background:#14181d;color:#c5cbd2}
.ms-gga-more div+div{margin-top:3px}
.ms-gga-warn{color:#ffc861}
.ms-gga-empty{padding:16px 12px;color:#c5cbd2}
.ms-gga-bar{height:4px;background:#2c333c}.ms-gga-bar>div{height:100%;background:#4f9cf0;transition:width .15s}
`;

const COLOR: Record<string, string> = {
  ok: '#1f8a4c',
  near: '#e9a526',
  caution: '#e08a1e',
  partial: '#d9622b',
  in: '#d63a3f',
};

const LABEL: Record<string, string> = {
  ok: 'Suitable',
  near: 'Marginal',
  caution: 'SLOW-GO',
  partial: 'Partially obstructed',
  in: 'Unsuitable',
};

export interface AuditPanelHandlers {
  onZoom(entry: GroundGuideAuditEntry): void;
  onRecheck(): void;
}

export interface AuditPanelOptions {
  title?: string;
  /** Open this entry's details straight away and list every entry, not only the problems. */
  focus?: GroundGuideAuditEntry;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export class GroundGuideAuditPanel {
  private _root: HTMLDivElement | null = null;
  private _title!: HTMLElement;
  private _body!: HTMLElement;
  private _audit: GroundGuideAudit | null = null;
  private _handlers: AuditPanelHandlers | null = null;
  private _opts: AuditPanelOptions = {};
  private _showAll = false;
  private _open = new Set<any>();
  private _returnFocus: HTMLElement | null = null;

  get isOpen(): boolean {
    return this._root !== null && this._root.style.display !== 'none';
  }

  /** Progress while symbols are being checked. */
  showProgress(done: number, total: number, title = 'Ground check'): void {
    const root = this._ensure();
    this._title.textContent = title;
    root.style.display = 'flex';
    const bar = el('div', 'ms-gga-bar');
    const fill = el('div');
    fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
    bar.appendChild(fill);
    this._body.replaceChildren(bar, el('div', 'ms-gga-sum', `Checking ${done} of ${total} symbols…`));
  }

  show(audit: GroundGuideAudit, handlers: AuditPanelHandlers, opts: AuditPanelOptions = {}): void {
    this._audit = audit;
    this._handlers = handlers;
    this._opts = opts;
    this._showAll = opts.focus !== undefined;
    this._open = new Set(opts.focus ? [opts.focus.graphic] : []);
    const root = this._ensure();
    root.style.display = 'flex';
    this._render();
    // Opened from a button or a menu: take keyboard focus into the panel (on its title, so the heading is read
    // first), and give it back on close. Re-checking from inside the panel leaves focus where it is.
    if (!root.contains(document.activeElement)) {
      this._returnFocus = document.activeElement as HTMLElement | null;
      this._title.focus({ preventScroll: true });
    }
  }

  hide(): void {
    if (this._root) this._root.style.display = 'none';
    const back = this._returnFocus;
    this._returnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  destroy(): void {
    this._root?.remove();
    this._root = null;
    this._audit = null;
    this._handlers = null;
  }

  private _render(): void {
    const a = this._audit;
    if (!a || !this._root) return;
    this._title.textContent = this._opts.title ?? 'Ground check';

    const parts: Node[] = [];
    const sum = el('div', 'ms-gga-sum');
    const skipped = [
      a.exempt ? `${a.exempt} not terrain-bound` : '',
      a.outside ? `${a.outside} outside data coverage` : '',
      a.unchecked ? `${a.unchecked} could not be checked (terrain data missing)` : '',
    ].filter(Boolean);
    const headline =
      a.checked === 0
        ? 'No symbols to check.'
        : a.problems.length === 0
          ? `All ${plural(a.checked, 'checked symbol')} on suitable ground.`
          : `${plural(a.problems.length, 'symbol')} ${a.problems.length === 1 ? 'needs' : 'need'} attention, ${a.checked} checked.`;
    const head = el('div', undefined, headline);
    head.setAttribute('role', 'status'); // read out when the result arrives or changes
    sum.append(head);
    if (skipped.length) sum.append(el('div', 'ms-gga-soft', skipped.join(' · ')));
    parts.push(sum);

    if (!this._opts.focus && a.entries.length > a.problems.length) {
      const opt = el('label', 'ms-gga-opt');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = this._showAll;
      cb.addEventListener('change', () => {
        this._showAll = cb.checked;
        this._render();
      });
      opt.append(cb, document.createTextNode('Show symbols on suitable ground too'));
      parts.push(opt);
    }

    const rows = this._showAll ? a.entries : a.problems;
    const list = el('div', 'ms-gga-list');
    for (const e of rows) list.appendChild(this._row(e));
    if (rows.length === 0 && a.checked > 0) list.appendChild(el('div', 'ms-gga-empty', 'Nothing to show.'));
    parts.push(list);
    this._body.replaceChildren(...parts);
  }

  private _row(e: GroundGuideAuditEntry): HTMLElement {
    const open = this._open.has(e.graphic);
    const row = el('button', 'ms-gga-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', String(open));
    const dot = el('span', 'ms-gga-dot');
    dot.style.background = COLOR[e.verdict] ?? '#5b6470';
    const line = el('div', 'ms-gga-line');
    line.append(dot, el('span', 'ms-gga-name', e.name), el('span', 'ms-gga-tag', LABEL[e.verdict] ?? e.verdict));
    row.append(line, el('div', 'ms-gga-msg', e.message));

    if (open) {
      const more = el('div', 'ms-gga-more');
      if (e.rule) more.append(el('div', undefined, e.rule));
      if (e.detail) more.append(el('div', undefined, e.detail));
      more.append(el('div', 'ms-gga-soft', `Mode: ${e.profileLabel}${e.profileOverride ? ' (chosen when placed)' : ''}`));
      if (e.previous === null) more.append(el('div', 'ms-gga-soft', 'Not checked when it was placed.'));
      else if (e.changed) {
        more.append(el('div', 'ms-gga-warn', `Was ${LABEL[e.previous] ?? e.previous} when placed.`));
      }
      if (e.overridden) {
        more.append(el('div', 'ms-gga-warn', `Placed against the rules${e.reason ? `: ${e.reason}` : '.'}`));
      }
      if (e.spacing) more.append(el('div', 'ms-gga-warn', e.spacing));
      row.append(more);
    }

    row.addEventListener('click', () => {
      if (this._open.has(e.graphic)) this._open.delete(e.graphic);
      else this._open.add(e.graphic);
      this._handlers?.onZoom(e);
      this._render();
    });
    return row;
  }

  private _ensure(): HTMLDivElement {
    if (this._root) return this._root;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    const root = el('div', 'ms-gga');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Ground check');
    const head = el('div', 'ms-gga-head');
    this._title = el('div', 'ms-gga-title', 'Ground check');
    this._title.tabIndex = -1; // focusable by script only, so opening the panel can land on its heading
    this._title.setAttribute('role', 'heading');
    this._title.setAttribute('aria-level', '2');
    const again = el('button', 'ms-gga-btn', 'Check again');
    again.type = 'button';
    again.addEventListener('click', () => this._handlers?.onRecheck());
    const close = el('button', 'ms-gga-x', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.hide());
    head.append(this._title, again, close);
    this._body = el('div');
    this._body.style.cssText = 'display:flex;flex-direction:column;min-height:0;flex:1';
    root.append(head, this._body);
    root.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.hide();
    });
    document.body.appendChild(root);
    this._root = root;
    return root;
  }
}
