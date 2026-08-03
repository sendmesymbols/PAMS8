/**
 * CollabTypes.ts
 *
 * Wire protocol for the Collab engine — message envelope, op payloads, and the
 * hybrid logical clock (HLC) used to order persistent ops.
 *
 * Two classes of message travel over one connection:
 *
 *   Ephemeral  (cursor / trail / preview / lock / hello / ping / bye / vp /
 *              chat / pres / ink)
 *     Never stored, never ordered, safe to drop. Sent at up to `cursorHz`.
 *
 *   Persistent (g.up / g.del / slide.* / ov.* / podium)
 *     Carries an HLC stamp. Each client keeps a last-writer table keyed by
 *     entity and applies a remote op only when its stamp is NEWER than the one
 *     already recorded — that is the whole conflict-resolution story
 *     (last-write-wins), with soft locks in CollabLocks making races rare.
 *
 * Why an HLC rather than Date.now(): workstation clocks on an isolated LAN are
 * not synchronised, and two ops in the same millisecond must still order
 * deterministically on every peer. `{ms, c, id}` compares ms → counter →
 * clientId, so every client independently reaches the same answer.
 */

export type ClientId = string;

/** Hybrid logical clock stamp. Compare with `hlcCompare`. */
export interface HLC {
  /** Wall clock millis (monotonically non-decreasing per client). */
  ms: number;
  /** Tie-break counter within the same `ms`. */
  c: number;
  /** Final tie-break — the originating client. */
  id: ClientId;
}

export interface CollabUser {
  id: ClientId;
  name: string;
  /** '#rrggbb' — cursor, trail, and lock-badge colour. */
  color: string;
}

export type CollabMsgType =
  // ── presence / session ──
  | 'hello'
  | 'bye'
  | 'ping'
  | 'cursor'
  | 'preview'
  | 'preview-end'
  | 'lock'
  | 'unlock'
  | 'view'
  // ── awareness ──
  /** Where a peer is looking, whether or not shared view is on. */
  | 'vp'
  /**
   * "Look here" — a decaying attention marker anyone can drop.
   *
   * NOT called 'ping': that name is already the session heartbeat, and
   * `CollabSession._receive` returns early on it after touching the peer's
   * lastSeen. An attention marker sharing the name would have been swallowed
   * there and never delivered to a single handler.
   */
  | 'look'
  /** Room chat line. */
  | 'chat'
  // ── presentation ──
  /** The briefer's slide position + build step. */
  | 'pres'
  /** The briefer's laser / pen / spotlight mark-up. */
  | 'ink'
  // ── persistent: map ──
  | 'g.up'
  | 'g.del'
  // ── persistent: deck ──
  | 'slide.up'
  | 'slide.del'
  | 'slide.order'
  | 'ov.up'
  | 'ov.del'
  /**
   * Who is briefing. Persistent — see PERSISTENT_TYPES for why claiming the
   * podium goes through the last-write-wins gate rather than being arbitrated.
   */
  | 'podium'
  // ── late-joiner sync ──
  | 'snap.req'
  | 'snap.off';

/**
 * Message types that carry an HLC stamp and go through the LWW gate.
 *
 * `podium` is in here for a reason worth spelling out. Arbitrating podium claims
 * the way CollabLocks arbitrates locks (lower client id wins) does NOT converge:
 * two people claiming at the same instant each see their own claim as live and
 * refuse the other, while a bystander accepts whichever arrived first — three
 * peers, two verdicts, and the room disagrees about who is briefing. The HLC
 * already provides a total order that every peer computes identically, so
 * "newest claim wins" needs no arbitration code at all and cannot split-brain.
 * Releasing is the same op with `take: false`, so it orders against claims too.
 */
export const PERSISTENT_TYPES: readonly CollabMsgType[] = [
  'g.up',
  'g.del',
  'slide.up',
  'slide.del',
  'slide.order',
  'ov.up',
  'ov.del',
  'podium',
];

export function isPersistent(t: CollabMsgType): boolean {
  return PERSISTENT_TYPES.includes(t);
}

/**
 * One message on the wire. Deliberately terse keys — cursor traffic at 20 Hz
 * per peer is the dominant volume and every byte is repeated thousands of
 * times per session.
 */
export interface CollabMsg {
  /** Protocol version. Peers on a different version are ignored. */
  v: 2;
  t: CollabMsgType;
  /** Originating client. The relay never forwards a message back to its sender. */
  from: ClientId;
  /** Present on persistent ops only. */
  ts?: HLC;
  /** Set to address a single peer (snapshot offers). */
  to?: ClientId;
  /** Type-specific payload. */
  d?: any;
}

/**
 * Bumped from 1 when shared briefing, pings, viewport rectangles and chat were
 * added. Extending the type union without bumping would have been backwards
 * compatible only in the weakest sense: an older peer drops every new message as
 * malformed and logs it, so a partially-rolled-out room half-works with no
 * explanation. A version bump routes it through `onIncompatible` instead, which
 * surfaces the ⚠ badge on the roster chip and says what is wrong.
 */
export const PROTOCOL_VERSION = 2 as const;

// ── Payload shapes (documentation + light type-safety; not validated) ────────

export interface HelloPayload {
  user: CollabUser;
  /** True when this hello answers someone else's — prevents an infinite volley. */
  reply?: boolean;
}

export interface CursorPayload {
  /** WGS84 longitude / latitude of the pointer on the map. */
  lon: number;
  lat: number;
  /** True while the peer is mid-draw (renders a busier cursor). */
  drawing?: boolean;
}

export interface PreviewPayload {
  /** Preview id — one per in-progress drawing, so several can coexist. */
  pid: string;
  kind: 'point' | 'polyline' | 'polygon';
  /** WGS84 [lon, lat] pairs. Simplified before sending. */
  pts: Array<[number, number]>;
  /** Optional label shown at the first vertex (symbol name). */
  label?: string;
}

export interface LockPayload {
  ids: string[];
  scope: 'map' | 'slide';
  /** Millis from receipt after which the lock is considered abandoned. */
  ttlMs: number;
}

/**
 * Where the sender is looking. Ephemeral: a dropped one costs a frame, and the
 * `done` message at the end of every gesture guarantees convergence anyway.
 */
export interface ViewPayload {
  /** Centre, WGS84. */
  lon: number;
  lat: number;
  /**
   * Map scale, not zoom level. Zoom is defined by the basemap's tiling scheme
   * and does not mean the same thing in a SceneView, whereas scale is universal
   * and screen-size independent.
   */
  scale: number;
  /** SceneView only — dropped by a 2D receiver. */
  tilt?: number;
  heading?: number;
  /** Sender's view type, so the receiver knows whether tilt/heading apply. */
  vt: '2d' | '3d';
  /** MapView rotation, degrees. 2D↔2D only — a SceneView has no equivalent. */
  rotation?: number;
  /** Set on the last message of a gesture — applied with a short animation. */
  done?: boolean;
}

/**
 * Where a peer is looking, as a WGS84 bounding box.
 *
 * Deliberately NOT the `view` type. `view` is gated on `syncView` at both the
 * send and the apply end, so reusing it would tie "show me where everyone is
 * looking" to "drag everyone's map around together" — two features people want
 * independently. This one is a 1 Hz heartbeat that costs nothing and drives a
 * passive rectangle.
 */
export interface ViewportPayload {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
}

/** "Look here." Decays on the receiver; nothing is stored. */
export interface LookPayload {
  lon: number;
  lat: number;
}

/** One chat line. Rendered with textContent, never innerHTML. */
export interface ChatPayload {
  text: string;
  /**
   * Sender's wall clock. Display-and-identity only, never used for ordering.
   *
   * It rides the wire so that every peer keys the SAME line identically. The
   * receiver used to stamp its own `Date.now()`, which made `from|at|text`
   * different on each machine — harmless on first join, but `resync()` then
   * re-adopted a provider's copy of lines this client already held and every one
   * of them duplicated.
   *
   * Optional, and NOT a protocol bump: an older v2 peer simply omits it and the
   * receiver falls back to its own clock, which is the previous behaviour. Bumping
   * PROTOCOL_VERSION would black out every message between mixed v2 builds — far
   * worse than the duplicate lines this fixes.
   */
  at?: number;
}

/** Longest chat line accepted, in characters. */
export const MAX_CHAT_LEN = 500;
/** Hard caps for ephemeral point arrays before they reach render/apply paths. */
export const MAX_PREVIEW_POINTS = 4096;
export const MAX_INK_POINTS = 2048;

/**
 * Claim or release the podium. Persistent — ordering is the arbitration, see
 * PERSISTENT_TYPES.
 */
export interface PodiumPayload {
  take: boolean;
}

/** The briefer's position in the deck. */
export interface PresPayload {
  /** Slide id, not index — indices shift under a concurrent insert. */
  slideId: string;
  /** Revealed build-group count, or 0 when the slide has no click builds. */
  build: number;
  /** True while the briefer is actually in present mode. */
  active: boolean;
}

/**
 * The briefer's live mark-up. Coordinates are normalised [0..1] against the view
 * container — the same convention PresentAnnotator already stores strokes in, so
 * a stroke lands in the same place on a different screen size.
 */
export interface InkPayload {
  k: 'pen' | 'laser' | 'spot' | 'clear';
  /** Slide the mark-up belongs to; pen ink is kept per slide. */
  sid: string;
  /** Stroke / pointer path. Absent for 'clear'. */
  pts?: Array<[number, number]>;
  /** Spotlight radius as a fraction of the smaller side. 'spot' only. */
  r?: number;
  /** Set on the last message of a pen stroke, which commits it. */
  done?: boolean;
}

export interface GraphicUpsertPayload {
  /** Output of SerializationEngine.saveSymbolToJSON(). */
  sym: any;
}

export interface GraphicDeletePayload {
  id: string;
}

export interface SlideUpsertPayload {
  slide: any;
  /** Desired index; clamped by the receiver. */
  index: number;
}

export interface SlideOrderPayload {
  /** Slide ids in their new order. */
  ids: string[];
}

export interface OverlayUpsertPayload {
  slideId: string;
  ov: any;
}

export interface OverlayDeletePayload {
  slideId: string;
  id: string;
}

/** One line of room chat, as carried in a snapshot. */
export interface ChatLine {
  from: ClientId;
  name: string;
  text: string;
  /** Sender's wall clock. Display only — never used for ordering. */
  at: number;
}

export interface SnapshotPayload {
  /** saveSymbolToJSON() for every graphic on every symbol layer. */
  graphics: any[];
  /** Number of `g` chunks that follow this head. Present on the head only. */
  gTotal?: number;
  /** One chunk of map symbols. */
  g?: { seq: number; symbols: any[] };
  /**
   * `BriefingEngine.exportBriefing()` with its `slides` array EMPTIED — the head
   * of a chunked deck. The slides follow as `dk` messages and the receiver
   * assembles them before importing.
   *
   * Always chunked, even for a small deck, so there is exactly one code path.
   * The previous single-message deck was dropped wholesale once it exceeded the
   * message cap, and a size-conditional second path is the kind of branch that
   * only ever runs on somebody else's machine.
   */
  deck: any | null;
  /** Number of `dk` chunks that follow this head. Present on the head only. */
  dkTotal?: number;
  /** One chunk of the deck's slides. */
  dk?: { seq: number; slides: any[] };
  /** Recent chat, so a late joiner has the last few minutes of context. */
  chat?: ChatLine[];
}

// ── Hybrid logical clock ────────────────────────────────────────────────────

export interface HlcState {
  ms: number;
  c: number;
}

export function newHlcState(): HlcState {
  return { ms: 0, c: 0 };
}

/** Stamp a locally-originated op, advancing the clock. */
export function hlcSend(state: HlcState, id: ClientId): HLC {
  const now = Date.now();
  if (now > state.ms) {
    state.ms = now;
    state.c = 0;
  } else {
    // Clock stalled or went backwards — keep ordering with the counter.
    state.c += 1;
  }
  return { ms: state.ms, c: state.c, id };
}

/** Merge a received stamp into the local clock so our next op sorts after it. */
export function hlcRecv(state: HlcState, remote: HLC | undefined): void {
  if (!remote) return;
  const now = Date.now();
  const maxMs = Math.max(now, state.ms, remote.ms);
  if (maxMs === state.ms && maxMs === remote.ms) {
    state.c = Math.max(state.c, remote.c) + 1;
  } else if (maxMs === state.ms) {
    state.c += 1;
  } else if (maxMs === remote.ms) {
    state.c = remote.c + 1;
  } else {
    state.c = 0;
  }
  state.ms = maxMs;
}

/** -1 / 0 / 1 — total order over stamps, identical on every peer. */
export function hlcCompare(a: HLC | undefined, b: HLC | undefined): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.ms !== b.ms) return a.ms < b.ms ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** True when `candidate` should win over `current`. */
export function hlcNewer(candidate: HLC | undefined, current: HLC | undefined): boolean {
  return hlcCompare(candidate, current) > 0;
}

// ── Identity helpers ────────────────────────────────────────────────────────

/**
 * Peer colours. Chosen to stay legible on both the Ops Dark and Night Vision
 * themes and to avoid the standard-identity colours (blue / red / green /
 * yellow) so a peer cursor is never mistaken for an affiliation.
 */
export const PEER_PALETTE: readonly string[] = [
  '#ff7ac6',
  '#7ae2ff',
  '#ffb457',
  '#b18cff',
  '#5ce6a8',
  '#ff9d9d',
  '#e0d05a',
  '#61c9ff',
];

/** Stable colour for a client id — same peer, same colour on every screen. */
export function colorForClient(id: ClientId): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PEER_PALETTE[h % PEER_PALETTE.length];
}

export function newClientId(): ClientId {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().slice(0, 8);
  return Math.random().toString(36).slice(2, 10);
}

/** Longest display name accepted from a peer — the roster chip is ~120px wide. */
export const MAX_NAME_LEN = 32;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Normalise a `hello` payload's user before it reaches the roster.
 *
 * `color` ends up inside a `style="--c:…"` attribute on the roster chip, so an
 * unvalidated value lets a peer inject arbitrary CSS (`red;position:fixed;
 * inset:0;background:url(…)` both exfiltrates and covers the UI). Escaping the
 * quotes is not enough — the value has to actually be a colour. Anything else
 * falls back to the deterministic per-id colour, which is a better answer than
 * rejecting the peer.
 */
export function sanitizeUser(raw: any): CollabUser | null {
  const id = typeof raw?.id === 'string' ? raw.id.slice(0, 64) : '';
  if (!id) return null;
  const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, MAX_NAME_LEN) : '';
  const color = typeof raw?.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : '';
  return { id, name: name || `User-${id.slice(0, 4)}`, color: color || colorForClient(id) };
}

/**
 * Which peer should answer a snapshot request — decided by the REQUESTER, from
 * its own roster, and addressed with `sendTo`.
 *
 * The previous approach compared `joinedAt`, but that field records when we
 * first *heard* a peer's hello rather than when it joined, so in a room of three
 * everyone believed the others arrived after them and two peers answered the
 * same request. Picking the lowest client id needs no clock at all and is
 * trivially deterministic.
 *
 * `exclude` carries the peers already asked. Asking exactly one peer exactly once
 * was the original design, and it left a joiner permanently divergent whenever
 * that peer left before answering or its reply was lost — a failure whose only
 * symptom is a map that is quietly missing things.
 */
export function pickSnapshotProvider(
  peerIds: readonly ClientId[],
  exclude?: ReadonlySet<ClientId>,
): ClientId | null {
  let best: ClientId | null = null;
  for (const id of peerIds) {
    if (!id) continue;
    if (exclude?.has(id)) continue;
    if (best === null || id < best) best = id;
  }
  return best;
}

/**
 * Is this message's payload the shape its type requires?
 *
 * One gate in CollabSession, rather than a partial check at each use site: a
 * malformed op is then dropped and logged once instead of being half-applied
 * (`Object.assign`-ing junk into a slide, or feeding nonsense to
 * loadSymbolFromJSON). Deliberately shallow — this rejects wrong shapes, it does
 * not attempt to schema-check a serialised symbol.
 */
export function isValidPayload(t: CollabMsgType, d: any): boolean {
  const str = (v: any) => typeof v === 'string' && v.length > 0;
  const ids = (v: any) => Array.isArray(v) && v.every((x) => str(x));
  const finitePair = (v: any) =>
    Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
  const pointList = (v: any, max: number) =>
    Array.isArray(v) && v.length > 0 && v.length <= max && v.every(finitePair);
  const optionalNumber = (v: any) => v === undefined || Number.isFinite(v);
  const optionalBoolean = (v: any) => v === undefined || typeof v === 'boolean';
  switch (t) {
    case 'ping':
    case 'bye':
    case 'snap.req':
      return true;
    case 'hello':
      return str(d?.user?.id);
    case 'cursor':
      return Number.isFinite(d?.lon) && Number.isFinite(d?.lat);
    case 'preview':
      return (
        str(d?.pid) &&
        (d?.kind === 'point' || d?.kind === 'polyline' || d?.kind === 'polygon') &&
        pointList(d?.pts, MAX_PREVIEW_POINTS) &&
        (d?.label === undefined || typeof d.label === 'string')
      );
    case 'preview-end':
      return str(d?.pid);
    case 'lock':
      return (
        ids(d?.ids) &&
        d.ids.length > 0 &&
        (d?.scope === 'map' || d?.scope === 'slide') &&
        Number.isFinite(d?.ttlMs) &&
        d.ttlMs > 0
      );
    case 'unlock':
      return ids(d?.ids) && d.ids.length > 0;
    case 'g.up':
      return str(d?.sym?.id);
    case 'g.del':
    case 'slide.del':
      return str(d?.id);
    case 'slide.up':
      return str(d?.slide?.id);
    case 'slide.order':
      return ids(d?.ids);
    case 'ov.up':
      return str(d?.slideId) && str(d?.ov?.id);
    case 'ov.del':
      return str(d?.slideId) && str(d?.id);
    case 'snap.off':
      // An empty offer (`{graphics: [], deck: null}`) is valid and meaningful:
      // it is how a provider says "you are already up to date" instead of
      // staying silent, which the requester cannot tell from a dead peer.
      return (
        Array.isArray(d?.graphics) ||
        !!d?.deck ||
        (Number.isInteger(d?.g?.seq) && d.g.seq >= 0 && Array.isArray(d.g.symbols)) ||
        (Number.isInteger(d?.dk?.seq) && d.dk.seq >= 0 && Array.isArray(d.dk.slides)) ||
        Array.isArray(d?.chat)
      );
    case 'vp':
      return (
        Number.isFinite(d?.xmin) &&
        Number.isFinite(d?.ymin) &&
        Number.isFinite(d?.xmax) &&
        Number.isFinite(d?.ymax)
      );
    case 'look':
      return Number.isFinite(d?.lon) && Number.isFinite(d?.lat);
    case 'chat':
      return str(d?.text) && d.text.length <= MAX_CHAT_LEN && optionalNumber(d?.at);
    case 'podium':
      return typeof d?.take === 'boolean';
    case 'pres':
      return (
        str(d?.slideId) &&
        Number.isInteger(d?.build) &&
        d.build >= 0 &&
        typeof d?.active === 'boolean'
      );
    case 'ink':
      return (
        (d?.k === 'pen' || d?.k === 'laser' || d?.k === 'spot' || d?.k === 'clear') &&
        str(d?.sid) &&
        optionalBoolean(d?.done) &&
        (d.k === 'clear' ||
          (pointList(d?.pts, MAX_INK_POINTS) &&
            (d.k !== 'spot' || d.r === undefined || (Number.isFinite(d.r) && d.r > 0))))
      );
    case 'view':
      return (
        Number.isFinite(d?.lon) &&
        Number.isFinite(d?.lat) &&
        Number.isFinite(d?.scale) &&
        d.scale > 0 &&
        (d?.vt === '2d' || d?.vt === '3d')
      );
    default:
      return false;
  }
}

// ── Shared view ─────────────────────────────────────────────────────────────

/** What a receiver should actually pass to `view.goTo`. */
export interface ViewTarget {
  center: [number, number];
  scale: number;
  tilt?: number;
  heading?: number;
  rotation?: number;
}

/**
 * Translate a peer's viewpoint into a target for OUR view type.
 *
 * Centre and scale always cross over. Tilt and heading only apply between two
 * views of the same type: pushing a 3D camera angle onto a MapView is
 * meaningless, and forcing a SceneView flat because the sender was in 2D would
 * take away a camera the local user chose deliberately. So a mixed room stays in
 * sync on *where* everyone is looking, and each person keeps their own *how*.
 */
export function viewTargetFor(d: ViewPayload, localType: '2d' | '3d'): ViewTarget {
  const target: ViewTarget = { center: [d.lon, d.lat], scale: d.scale };
  if (localType === '3d' && d.vt === '3d') {
    if (Number.isFinite(d.tilt)) target.tilt = d.tilt;
    if (Number.isFinite(d.heading)) target.heading = d.heading;
  }
  // Rotation is the 2D counterpart of heading and crosses over on the same
  // terms: only between two MapViews. A SceneView has no `rotation`, and
  // flattening one to match a 2D sender would take away a camera the local user
  // chose — the identical argument the tilt/heading rule above rests on.
  if (localType === '2d' && d.vt === '2d' && Number.isFinite(d.rotation)) {
    target.rotation = d.rotation;
  }
  return target;
}

export interface BatonState {
  /** Who moved last, or null if nobody has yet. */
  owner: ClientId | null;
  /** Millis since epoch until which `owner` keeps the right to drive. */
  until: number;
}

/**
 * Should an incoming viewpoint be applied?
 *
 * Following someone is unconditional — you asked to be their passenger, so their
 * viewpoint always wins and the baton is irrelevant.
 *
 * Otherwise the baton keeps exactly one broadcaster at a time. A live baton held
 * by somebody else is honoured; a live baton held by US is defended, except
 * against a lower client id, which is the same deterministic tie-break
 * CollabLocks uses so that two peers who move in the same instant agree on the
 * winner instead of oscillating.
 */
export function shouldApplyRemoteView(o: {
  following: ClientId | null;
  from: ClientId;
  myId: ClientId;
  baton: BatonState;
  now: number;
}): boolean {
  if (o.following) return o.from === o.following;
  const live = o.baton.owner !== null && o.now < o.baton.until;
  if (!live) return true;
  if (o.baton.owner === o.myId) return o.from < o.myId; // defend, but yield to a lower id
  return o.from === o.baton.owner; // one broadcaster at a time
}

/**
 * Should our own view movement be broadcast?
 *
 * No while following (a passenger does not steer) and no while another peer
 * holds a live baton — that suppression is what stops two people panning at
 * once from dragging each other's map back and forth.
 */
export function shouldBroadcastLocalView(o: {
  following: ClientId | null;
  myId: ClientId;
  baton: BatonState;
  now: number;
}): boolean {
  if (o.following) return false;
  const live = o.baton.owner !== null && o.now < o.baton.until;
  return !live || o.baton.owner === o.myId;
}

// ── Podium (shared briefing) ────────────────────────────────────────────────

export interface PodiumState {
  /** Who is briefing, or null when the podium is vacant. */
  holder: ClientId | null;
  /**
   * Millis since epoch until which the claim stands unrefreshed. The briefer's
   * `pres` heartbeat pushes this forward; silence lets it lapse.
   */
  until: number;
}

/**
 * Who holds the podium right now, accounting for expiry.
 *
 * The podium expires for the same reason a lock does: a briefer whose browser
 * crashes says nothing on the way out, and a room that stays hostage to a peer
 * who is no longer there has no way back short of everyone reloading. Because
 * every peer observes the same absence of heartbeats, expiry needs no agreement
 * protocol — they all reach the same verdict within one heartbeat of each other.
 */
export function podiumHolderAt(p: PodiumState, now: number): ClientId | null {
  return p.holder !== null && now < p.until ? p.holder : null;
}
