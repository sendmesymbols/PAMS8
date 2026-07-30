/**
 * CollabSnapshot.ts
 *
 * Late-joiner catch-up, with no database and no state on the relay.
 *
 * A joining client picks ONE peer from its roster and asks that peer directly
 * (`pickSnapshotProvider` — lowest client id, so the choice needs no clock and
 * no negotiation). Whoever is first into a room simply keeps whatever they
 * already have: there is nobody to ask, which is the correct outcome rather than
 * an error.
 *
 * The request is driven by the roster rather than by a fixed delay. An earlier
 * version asked once, 900 ms after joining, and only if peers were already
 * known — so two people opening the app at the same moment both saw an empty
 * room at 900 ms, neither asked, and their maps stayed divergent until somebody
 * happened to edit something. Now the first peer to appear triggers the request,
 * however long that takes.
 *
 * Asking once was still not enough. The chosen provider might leave before
 * answering, or its reply might be lost, and the joiner then stayed permanently
 * out of date with no symptom other than a map quietly missing things. So a
 * request is now timed: on silence it falls to the next-lowest peer, up to
 * MAX_ATTEMPTS distinct peers, and a provider's `bye` retries at once rather
 * than waiting out the timer. A provider with nothing to send answers anyway,
 * with an empty offer — "you are up to date" and "I am dead" must not look the
 * same from the asking end.
 *
 * Snapshots never overwrite local work: graphics are merged by id, and the deck
 * is only accepted when the joiner has no slides of its own. Someone who opens
 * the app with a plan already loaded keeps it. That also bounds what `resync()`
 * can repair — it recovers objects you are MISSING, not local copies that are
 * stale, because a snapshot carries no HLC stamps to compare against.
 */

import EngineLogger from '../../Support/EngineLogger';
import { cerr, clog } from './CollabDebug';
import type CollabSession from './CollabSession';
import type MapSync from './MapSync';
import type SlideSync from './SlideSync';
import {
  pickSnapshotProvider,
  type ChatLine,
  type ClientId,
  type CollabMsg,
  type SnapshotPayload,
} from './CollabTypes';

const ENGINE_NAME = 'Collab Engine';
/** Grace period before reporting "first in the room" — lets the hello volley land. */
const ALONE_REPORT_MS = 900;
/**
 * How long to wait for an offer before trying the next peer.
 *
 * Generous next to a LAN round trip, because the provider has to serialise every
 * graphic it holds before it can answer and a large plan makes that take real
 * time. Too short and a busy provider gets abandoned for no reason.
 */
const REQUEST_TIMEOUT_MS = 2500;
/** Distinct peers asked before giving up and saying so. */
const MAX_ATTEMPTS = 3;
/**
 * Split a snapshot across this many characters per message.
 *
 * A full plan plus a deck comfortably exceeds the relay's body cap
 * (MAX_BODY_BYTES in tools/collabRelay.js), and a rejected POST used to mean the
 * joiner silently received nothing at all. Chunking turns "all or nothing" into
 * "arrives in pieces", and keeps each POST small enough for any intermediate
 * proxy as well.
 */
const MAX_MSG_CHARS = 1_000_000;
/** Abandon a half-arrived deck after this long rather than buffering it forever. */
const DECK_ASSEMBLY_MS = 20000;

/** A deck arriving in pieces: the head document plus the chunks seen so far. */
interface PendingDeck {
  /** `exportBriefing()` output with an empty `slides`, or null if not here yet. */
  doc: any | null;
  /** Chunks to expect, or -1 until the head arrives and says. */
  total: number;
  parts: Map<number, any[]>;
  at: number;
}

/** What CollabSnapshot needs of the chat panel, so chat stays optional. */
export interface ChatPort {
  history(): ChatLine[];
  adopt(lines: ChatLine[]): void;
}

export default class CollabSnapshot {
  private _offMsg: Array<() => void> = [];
  private _offRoster: (() => void) | null = null;
  private _aloneTimer: ReturnType<typeof setTimeout> | null = null;
  private _waitTimer: ReturnType<typeof setTimeout> | null = null;
  private _deckTimer: ReturnType<typeof setTimeout> | null = null;
  /** Peers already asked this round — never asked twice. */
  private _asked = new Set<ClientId>();
  /** True once ANY peer has answered, which is what stops the retry ladder. */
  private _caughtUp = false;
  private _pendingDeck = new Map<ClientId, PendingDeck>();

  constructor(
    private readonly session: CollabSession,
    private readonly mapSync: MapSync | null,
    private readonly slideSync: SlideSync | null,
    private chat: ChatPort | null = null,
  ) {}

  /**
   * Re-point the chat port. `collab.chat` creates and destroys CollabChat at
   * runtime, so the port this was constructed with goes stale in both directions:
   * joining with chat off then switching it on left this client unable to serve
   * OR adopt any scrollback, and switching it off left a destroyed CollabChat
   * still wired in as the snapshot's chat.
   */
  public setChat(chat: ChatPort | null): void {
    this.chat = chat;
  }

  public start(): void {
    this._offMsg.push(this.session.on('snap.req', (m) => this._onRequest(m)));
    this._offMsg.push(this.session.on('snap.off', (m) => this._onOffer(m)));
    // A provider that leaves before answering is a dead end we can detect
    // immediately, instead of sitting out the full timeout.
    this._offMsg.push(
      this.session.on('bye', (m) => {
        if (this._caughtUp || !this._asked.has(m.from)) return;
        clog('snapshot provider left before answering — trying the next peer');
        this._tryRequest();
      }),
    );

    // Ask as soon as there is somebody to ask — which may be before or well
    // after the timer below.
    this._offRoster = this.session.onRoster(() => this._tryRequest());
    this._tryRequest();

    this._aloneTimer = setTimeout(() => {
      this._aloneTimer = null;
      if (!this._asked.size) {
        EngineLogger.success(ENGINE_NAME, 'First in the room — nothing to catch up on');
      }
    }, ALONE_REPORT_MS);
  }

  public destroy(): void {
    for (const t of [this._aloneTimer, this._waitTimer, this._deckTimer]) {
      if (t) clearTimeout(t);
    }
    this._aloneTimer = this._waitTimer = this._deckTimer = null;
    this._offRoster?.();
    this._offRoster = null;
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._asked.clear();
    this._pendingDeck.clear();
    this._caughtUp = false;
  }

  /**
   * Ask the room for its state again from scratch — `window.collabEngine.resync()`
   * and the Ctrl+K command.
   *
   * For when a client suspects it has drifted: an outage that outlasted the
   * transport's replay queue, or simply a nagging doubt. Merge-only, as above.
   */
  public resync(): void {
    if (this._waitTimer) {
      clearTimeout(this._waitTimer);
      this._waitTimer = null;
    }
    this._caughtUp = false;
    this._asked.clear();
    this._pendingDeck.clear();
    if (!this.session.peerCount) {
      EngineLogger.error(ENGINE_NAME, 'Nobody else is in the room — nothing to resync from');
      return;
    }
    EngineLogger.success(ENGINE_NAME, 'Asking the room for its current state');
    this._tryRequest();
  }

  /** Ask the next unasked peer, if there is one and we still need an answer. */
  private _tryRequest(): void {
    if (this._caughtUp || this._asked.size >= MAX_ATTEMPTS) return;
    const provider = pickSnapshotProvider(this.session.peerIds, this._asked);
    if (!provider) return;
    this._asked.add(provider);
    clog('requesting snapshot from', provider, `(attempt ${this._asked.size}/${MAX_ATTEMPTS})`);
    this.session.sendTo(provider, 'snap.req', {});
    this._armTimeout();
  }

  private _armTimeout(): void {
    if (this._waitTimer) clearTimeout(this._waitTimer);
    this._waitTimer = setTimeout(() => {
      this._waitTimer = null;
      if (this._caughtUp) return;
      if (this._asked.size >= MAX_ATTEMPTS) {
        EngineLogger.error(
          ENGINE_NAME,
          `No peer answered a catch-up request after ${MAX_ATTEMPTS} tries — ` +
            'this map may be missing shared work. Run window.collabEngine.resync() to retry.',
        );
        return;
      }
      clog('snapshot request timed out — trying the next peer');
      this._tryRequest();
    }, REQUEST_TIMEOUT_MS);
  }

  // ── Answering ─────────────────────────────────────────────────────────────

  /**
   * Answer a request. No election here — the requester already chose us and
   * CollabSession only delivers a message whose `to` matches this client.
   *
   * The deck always goes as a head plus per-slide chunks, even when it would fit
   * in one message. One code path means the >1 MB case is not a branch that only
   * ever runs on somebody else's machine.
   */
  private _onRequest(msg: CollabMsg): void {
    const graphics = this.mapSync?.collectSnapshot() ?? [];
    const deck = this.slideSync?.collectSnapshot() ?? null;
    const chat = this.chat?.history() ?? [];
    const slides: any[] = Array.isArray(deck?.slides) ? deck.slides : [];
    const deckChunks = CollabSnapshot._chunk(slides, 'slide');

    const head: SnapshotPayload = {
      graphics: [],
      deck: deck ? { ...deck, slides: [] } : null,
      dkTotal: deckChunks.length,
      ...(chat.length ? { chat } : {}),
    };
    this.session.sendTo(msg.from, 'snap.off', head);

    deckChunks.forEach((slidesChunk, seq) => {
      this.session.sendTo(msg.from, 'snap.off', {
        graphics: [],
        deck: null,
        dk: { seq, slides: slidesChunk },
      } as SnapshotPayload);
    });

    let sent = 0;
    for (const chunk of CollabSnapshot._chunk(graphics, 'symbol')) {
      this.session.sendTo(msg.from, 'snap.off', { graphics: chunk, deck: null } as SnapshotPayload);
      sent += chunk.length;
    }

    const who = this.session.nameOf(msg.from);
    EngineLogger.success(
      ENGINE_NAME,
      sent || slides.length
        ? `Sent ${sent} symbols${slides.length ? ` + ${slides.length} slides` : ''} to ${who}`
        : `${who} asked to catch up — nothing here to send`,
    );
  }

  /**
   * Group serialised items into messages under the size cap. A single item
   * bigger than the cap cannot be sent at all — dropped with a log rather than
   * silently poisoning the batch it belongs to.
   */
  private static _chunk(items: any[], label: string): any[][] {
    const out: any[][] = [];
    let current: any[] = [];
    let size = 0;
    for (const item of items) {
      const len = JSON.stringify(item).length;
      if (len > MAX_MSG_CHARS) {
        cerr(`${label} ${item?.id} is ${Math.round(len / 1024)}KB — too large to share`, null);
        continue;
      }
      if (current.length && size + len > MAX_MSG_CHARS) {
        out.push(current);
        current = [];
        size = 0;
      }
      current.push(item);
      size += len;
    }
    if (current.length) out.push(current);
    return out;
  }

  // ── Receiving ─────────────────────────────────────────────────────────────

  private _onOffer(msg: CollabMsg): void {
    const d: SnapshotPayload | undefined = msg.d;
    if (!d) return;
    // Somebody answered — stop the retry ladder even if this particular message
    // carries nothing, because an empty offer IS the answer "you are up to date".
    if (!this._caughtUp) {
      this._caughtUp = true;
      if (this._waitTimer) {
        clearTimeout(this._waitTimer);
        this._waitTimer = null;
      }
    }

    let applied = 0;
    for (const sym of d.graphics ?? []) {
      // Merge, not replace: a graphic we already hold is left alone, and the
      // ordinary LWW path will reconcile it if the peer edits it next.
      if (!sym?.id || this.mapSync?.findGraphic(sym.id)) continue;
      if (this.mapSync?.applySymbol(sym)) applied++;
    }
    if (applied) {
      EngineLogger.success(
        ENGINE_NAME,
        `Caught up from ${this.session.nameOf(msg.from)} — ${applied} symbols`,
      );
    }

    if (Array.isArray(d.chat) && d.chat.length) this.chat?.adopt(d.chat);

    if (d.deck) this._deckHead(msg.from, d);
    if (d.dk && Array.isArray(d.dk.slides)) this._deckChunk(msg.from, d.dk.seq, d.dk.slides);
  }

  private _deckHead(from: ClientId, d: SnapshotPayload): void {
    const existing = this._pendingDeck.get(from);
    this._pendingDeck.set(from, {
      doc: d.deck,
      total: Math.max(0, Number(d.dkTotal ?? 0)),
      // Chunks can outrun the head on a batched POST — keep any already buffered.
      parts: existing?.parts ?? new Map(),
      at: Date.now(),
    });
    this._maybeAssemble(from);
  }

  private _deckChunk(from: ClientId, seq: number, slides: any[]): void {
    let e = this._pendingDeck.get(from);
    if (!e) {
      // total = -1 marks "head not seen yet"; assembly waits for it.
      e = { doc: null, total: -1, parts: new Map(), at: Date.now() };
      this._pendingDeck.set(from, e);
    }
    e.parts.set(Number(seq), slides);
    this._maybeAssemble(from);
  }

  /** Import once every chunk of a sender's deck has arrived. */
  private _maybeAssemble(from: ClientId): void {
    const e = this._pendingDeck.get(from);
    if (!e || !e.doc || e.total < 0) return;
    if (e.parts.size < e.total) {
      this._armDeckSweep();
      return;
    }
    this._pendingDeck.delete(from);
    const slides: any[] = [];
    for (let i = 0; i < e.total; i++) {
      const part = e.parts.get(i);
      if (part) slides.push(...part);
    }
    if (!slides.length) return;
    this.slideSync?.applySnapshot({ ...e.doc, slides });
    EngineLogger.success(
      ENGINE_NAME,
      `Adopted a shared deck — ${slides.length} slide(s) from ${this.session.nameOf(from)}`,
    );
  }

  /** Discard decks whose remaining chunks never arrived. */
  private _armDeckSweep(): void {
    if (this._deckTimer) return;
    this._deckTimer = setTimeout(() => {
      this._deckTimer = null;
      const cutoff = Date.now() - DECK_ASSEMBLY_MS;
      for (const [from, e] of this._pendingDeck) {
        if (e.at >= cutoff) continue;
        this._pendingDeck.delete(from);
        cerr(
          `incomplete deck from ${from} discarded — ${e.parts.size}/${e.total} chunks arrived`,
          null,
        );
      }
      if (this._pendingDeck.size) this._armDeckSweep();
    }, DECK_ASSEMBLY_MS);
  }
}
