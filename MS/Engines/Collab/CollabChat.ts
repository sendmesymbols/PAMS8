/**
 * CollabChat.ts
 *
 * A text channel for the room. Useful precisely when the room is not one room —
 * a planning cell spread across buildings with nobody on a voice net.
 *
 * Deliberately thin:
 *
 *   No history on the relay. `chat` is ephemeral, like a cursor, so the log is
 *   whatever this client has heard. A late joiner is handed the last
 *   SNAPSHOT_LINES lines by whichever peer answers its snapshot request, which
 *   costs nothing and covers the case that actually matters — walking in and
 *   wondering what was just said.
 *
 *   No formatting, no attachments, no read receipts. Every line is rendered with
 *   `textContent`, never innerHTML: that single choice is the whole sanitising
 *   story for peer-supplied text, and it cannot be got wrong later by someone
 *   adding a feature.
 *
 * Styled from the ThemeManager `--ms-*` variables rather than fixed colours,
 * because one of the five themes (Arctic) is light and a panel this large reads
 * as broken on it otherwise.
 */

import EngineLogger from '../../Support/EngineLogger';
import { cerr } from './CollabDebug';
import type CollabSession from './CollabSession';
import { MAX_CHAT_LEN, type ChatLine, type CollabMsg } from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';
const PANEL_ID = 'ms-collab-chat';
const STYLE_ID = 'ms-collab-chat-style';
/** Lines kept locally. Beyond this the oldest are dropped. */
const MAX_SCROLLBACK = 200;
/** Lines handed to a late joiner in a snapshot. */
const SNAPSHOT_LINES = 50;

export default class CollabChat {
  private _el: HTMLDivElement | null = null;
  private _logEl: HTMLDivElement | null = null;
  private _inputEl: HTMLInputElement | null = null;
  private _lines: ChatLine[] = [];
  private _unread = 0;
  private _open = false;
  private _offMsg: Array<() => void> = [];
  private _changeCbs: Array<() => void> = [];
  /** `from|at|text` of every line held, so an adopted snapshot cannot duplicate. */
  private _seen = new Set<string>();

  constructor(private readonly session: CollabSession) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  public start(): void {
    this._offMsg.push(this.session.on('chat', (m) => this._onRemote(m)));
    CollabChat._injectStyle();
  }

  public destroy(): void {
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._changeCbs = [];
    this._unmount();
    this._lines = [];
    this._seen.clear();
    this._unread = 0;
    this._open = false;
  }

  public onChange(cb: () => void): void {
    this._changeCbs.push(cb);
  }

  private _emit(): void {
    this._changeCbs.forEach((cb) => {
      try {
        cb();
      } catch (err) {
        cerr('chat change handler failed', err);
      }
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  public get isOpen(): boolean {
    return this._open;
  }

  /** Unread since the panel was last open — drives the badge on the roster chip. */
  public get unread(): number {
    return this._unread;
  }

  public toggle(): void {
    if (this._open) this.close();
    else this.open();
  }

  public open(): void {
    if (this._open) return;
    this._open = true;
    this._unread = 0;
    this._mount();
    this._render();
    this._inputEl?.focus();
    this._emit();
  }

  public close(): void {
    if (!this._open) return;
    this._open = false;
    this._unmount();
    this._emit();
  }

  // ── Send / receive ────────────────────────────────────────────────────────

  public send(raw: string): void {
    const text = (raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;
    // One timestamp for the wire and for the local echo, so our own line has the
    // same identity here as it does on every other screen — see ChatPayload.at.
    const at = Date.now();
    this.session.send('chat', { text, at });
    // Echo locally: the relay never sends a message back to its author.
    this._append({ from: this.session.me.id, name: this.session.me.name, text, at });
  }

  private _onRemote(msg: CollabMsg): void {
    const raw = typeof msg.d?.text === 'string' ? msg.d.text : '';
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LEN);
    if (!text) return;
    const name = this.session.nameOf(msg.from);
    // The sender's stamp when it sent one; our own only as a fallback for a peer
    // on an older build. Keeping the sender's is what lets `adopt()` recognise a
    // line we already hold.
    const at = Number.isFinite(msg.d?.at) ? Number(msg.d.at) : Date.now();
    this._append({ from: msg.from, name, text, at });
    if (!this._open) {
      this._unread++;
      EngineLogger.success(ENGINE_NAME, `${name}: ${text}`);
      this._emit();
    }
  }

  private _append(line: ChatLine): void {
    const key = CollabChat._key(line);
    if (this._seen.has(key)) return;
    this._seen.add(key);
    this._lines.push(line);
    if (this._lines.length > MAX_SCROLLBACK) {
      const dropped = this._lines.splice(0, this._lines.length - MAX_SCROLLBACK);
      for (const d of dropped) this._seen.delete(CollabChat._key(d));
    }
    if (this._open) this._render();
  }

  private static _key(l: ChatLine): string {
    return `${l.from}|${l.at}|${l.text}`;
  }

  // ── Snapshot port (see CollabSnapshot.ChatPort) ────────────────────────────

  public history(): ChatLine[] {
    return this._lines.slice(-SNAPSHOT_LINES);
  }

  /**
   * Merge a peer's recent lines in. Sorted by the sender's wall clock purely for
   * display — chat is never ordered against anything, so an unsynchronised
   * workstation clock costs at most a slightly odd ordering of two lines nobody
   * was waiting on.
   */
  public adopt(lines: ChatLine[]): void {
    let added = 0;
    for (const raw of lines) {
      const text = typeof raw?.text === 'string' ? raw.text.trim().slice(0, MAX_CHAT_LEN) : '';
      if (!text || typeof raw.from !== 'string') continue;
      const line: ChatLine = {
        from: raw.from.slice(0, 64),
        name: typeof raw.name === 'string' ? raw.name.slice(0, 32) : raw.from.slice(0, 6),
        text,
        at: Number.isFinite(raw.at) ? Number(raw.at) : Date.now(),
      };
      if (this._seen.has(CollabChat._key(line))) continue;
      this._seen.add(CollabChat._key(line));
      this._lines.push(line);
      added++;
    }
    if (!added) return;
    this._lines.sort((a, b) => a.at - b.at);
    if (this._lines.length > MAX_SCROLLBACK) {
      this._lines.splice(0, this._lines.length - MAX_SCROLLBACK);
    }
    if (this._open) this._render();
  }

  // ── DOM ───────────────────────────────────────────────────────────────────

  private _mount(): void {
    if (this._el) return;
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'ms-collab-chat';

    const head = document.createElement('div');
    head.className = 'ms-collab-chat-head';
    const title = document.createElement('span');
    title.textContent = 'Room chat';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ms-collab-chat-x';
    close.textContent = '✕';
    close.title = 'Close chat';
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    const log = document.createElement('div');
    log.className = 'ms-collab-chat-log';
    // Announced politely so a message that arrives while the panel is open
    // reaches a screen reader without interrupting whatever it is reading.
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    this._logEl = log;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ms-collab-chat-input';
    input.maxLength = MAX_CHAT_LEN;
    input.placeholder = 'Message the room…';
    input.setAttribute('aria-label', 'Message the room');
    input.addEventListener('keydown', (e) => {
      // Stop Ctrl+K, Delete, arrow keys and the rest reaching the map's own
      // shortcut handlers while somebody is typing a message.
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      this.send(input.value);
      input.value = '';
    });
    this._inputEl = input;

    el.append(head, log, input);
    document.body.appendChild(el);
    this._el = el;
  }

  private _unmount(): void {
    this._el?.remove();
    this._el = null;
    this._logEl = null;
    this._inputEl = null;
  }

  private _render(): void {
    const log = this._logEl;
    if (!log) return;
    log.replaceChildren();
    for (const l of this._lines) {
      const row = document.createElement('div');
      row.className = 'ms-collab-chat-row';
      const who = document.createElement('span');
      who.className = 'ms-collab-chat-who';
      who.style.setProperty('--c', this.session.colorOf(l.from));
      who.textContent = l.from === this.session.me.id ? 'you' : l.name;
      const body = document.createElement('span');
      // textContent, always. See the file header.
      body.textContent = l.text;
      row.append(who, body);
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  private static _injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.ms-collab-chat{position:fixed;right:12px;top:44px;z-index:9001;width:268px;display:flex;
  flex-direction:column;max-height:46vh;border-radius:var(--ms-radius,6px);
  background:var(--ms-bg,rgba(18,22,28,.96));color:var(--ms-text,#e8eef5);
  border:1px solid var(--ms-border,rgba(255,255,255,.14));
  box-shadow:var(--ms-shadow,0 8px 24px rgba(0,0,0,.5));
  font:var(--ms-fs-sm,500 11px/1.5) var(--ms-font,system-ui,Segoe UI,sans-serif)}
.ms-collab-chat-head{display:flex;align-items:center;justify-content:space-between;
  padding:5px 8px;background:var(--ms-bg-header,rgba(255,255,255,.05));
  border-bottom:1px solid var(--ms-divider,rgba(255,255,255,.1));
  color:var(--ms-text-label,#9fb0c0);text-transform:uppercase;letter-spacing:.04em;
  font-size:var(--ms-fs-xs,9px);font-weight:700;border-radius:var(--ms-radius,6px) var(--ms-radius,6px) 0 0}
.ms-collab-chat-x{border:0;background:none;color:inherit;cursor:pointer;padding:0 2px;font-size:11px}
.ms-collab-chat-x:hover{color:var(--ms-text,#fff)}
.ms-collab-chat-log{flex:1;overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:3px;
  scrollbar-color:var(--ms-scrollbar-thumb,#4a5560) var(--ms-scrollbar-track,transparent)}
.ms-collab-chat-row{word-break:break-word}
.ms-collab-chat-who{color:var(--c);font-weight:700;margin-right:5px}
.ms-collab-chat-who::after{content:':'}
.ms-collab-chat-input{margin:0;border:0;border-top:1px solid var(--ms-divider,rgba(255,255,255,.1));
  background:var(--ms-bg-input,rgba(255,255,255,.04));color:var(--ms-text,#e8eef5);
  padding:6px 8px;font:inherit;outline:none;
  border-radius:0 0 var(--ms-radius,6px) var(--ms-radius,6px)}
.ms-collab-chat-input:focus{background:var(--ms-bg-input,rgba(255,255,255,.07));
  box-shadow:inset 0 1px 0 var(--ms-accent,#5ce6a8)}
`;
    document.head.appendChild(style);
  }
}
