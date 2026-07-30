# Collab Engine

Multi-user collaboration for the map and the briefing deck. **No database, no
separate service, no npm dependencies.**

Off by default: `Settings.json → features.collab: false`.

---

## Quick start

### Try it on one PC (no server at all)

1. `Settings.json` → `features.collab: true`, `collab.transport: "broadcast"`
2. `npm run dev`, then open <http://localhost:6547> in **two** browser windows.

Draw in one window — it appears in the other, with a live cursor and trail.

> Open the second window with **Ctrl+N** (or a new tab) and type the URL. Do
> **not** use "Duplicate tab": Chrome copies `sessionStorage` when duplicating,
> and the client id lives there — the copy would join as the *same* person and
> both windows would ignore each other as their own echo.

### Use it across the LAN

1. `Settings.json` → `features.collab: true` (leave `transport: "sse"`,
   `relayUrl: ""`)
2. On the host PC: `npm run dev` (Vite already binds `0.0.0.0`)
3. Everyone else browses to `http://<host-pc>:6547`

The fan-out relay is already mounted inside the dev server by
`vite.config.ts` — there is nothing extra to start. Confirm it with:

```bash
curl http://localhost:6547/collab/health
```

### Production (something other than Vite serving `dist/`)

Run the relay as its own tiny process and point clients at it:

```bash
npm run relay
```

Then set `collab.relayUrl` to `http://<host>:6600`. Or mount
`createCollabRelay()` as middleware in whatever Node server you already run, and
leave `relayUrl` blank.

---

## What is shared

| | Shared | Channel |
| --- | --- | --- |
| Symbol create / move / edit / delete | yes | persistent, ordered |
| Slide add / delete / reorder / rename / notes | yes | persistent, ordered |
| Objects inside a slide (live co-editing) | yes | persistent, ordered |
| Who is briefing (the podium) | yes | persistent, ordered |
| Cursors, mouse trails, in-progress drawings | yes | ephemeral, never stored |
| Briefer's slide position + build step | yes | ephemeral, heartbeat |
| Briefer's laser / pen / spotlight | yes | ephemeral |
| "Look here" pings | yes | ephemeral |
| Where each peer is looking (viewport) | yes | ephemeral, 1 Hz |
| Room chat | yes | ephemeral (last 50 ride a snapshot) |
| Object locks ("Ali is editing this") | yes | ephemeral, expiring |
| Map view / camera | **opt-in** | ephemeral — see Shared view |
| Undo history | no | — your undo only affects your own edits |

Set `collab.syncMap` / `collab.syncSlides` / `collab.sharePresentation` /
`collab.chat` to false to narrow this.

## The collaboration rail

A vertical rail docked to the **left edge at mid-height**, collapsible with the
chevron at its top (the choice is remembered per browser profile). It carries
connection state, one initial-dot per peer in that peer's cursor colour, and the
live controls: ping, chat, podium, shared view. Clicking the status area opens a
menu built from the real `.ms-settings-menu` / `.ms-sm-*` classes, so it inherits
all five ThemeManager themes.

Collapsed, the rail keeps only what you must not be able to miss: an active
briefing and unread chat. Everything else hides.

## Shared briefing

`collab.sharePresentation`, on by default. One person drives the deck and the
room follows — the deck counterpart of Shared view.

**The podium.** Click the microphone on the rail to take it; click again to hand
it back. Claims are ordered by the hybrid clock rather than arbitrated, so the
newest claim wins and every peer independently agrees who that was. Arbitrating
it the way locks are arbitrated does *not* converge: two people claiming in the
same instant each see their own claim as live and refuse the other, while a
bystander accepts whichever arrived first — three peers, two verdicts. The claim
also expires after 8 s of silence, so a briefer whose browser dies releases it.

**Viewers are not forced into present mode.** Slide position follows
automatically; going fullscreen is a per-viewer choice via **Join** on the rail.
Pushing `PresentSession.enter()` onto somebody would seize their screen because a
peer started talking. One consequence, by design: build steps only visibly apply
to viewers who joined, because `_groups` is populated only while their own
session is active.

**Breaking away.** Navigate a slide yourself and you detach; the rail offers
**Rejoin**. Detaching is driven by the navigation call, never inferred from
position drift — the same reasoning ViewSync's follow-cancel rests on.

**Mark-up.** With `collab.shareInk` the briefer's laser, pen and spotlight are
shared, normalised [0..1] against the view container so a stroke lands in the
same place on any screen size. Peer mark-up is drawn on a canvas this engine owns
and is **never** written into `PresentAnnotator`'s own store — otherwise a
viewer's `inkAsOverlays()` would offer to persist somebody else's ink as
annotations on their own deck.

A slide the briefer is on but the viewer has not received yet is simply skipped;
the 2 s heartbeat brings everyone into line once the `slide.up` lands.

## Awareness

**"Look here" pings.** Click the pin on the rail, then click the map: an
expanding ring in your colour with your name, gone in four seconds. Ring sizes
are in points, not map units, so a ping reads the same at any zoom — the gesture
means "this spot", not "this area".

Arming beats a modifier chord because every plausible one is already taken:
Ctrl and Shift +click are `SelectionEngine`'s add-to-selection, and Alt is
`ProximityEngine`'s snap modifier. `Ctrl+K → "Ping the centre of my view"` skips
the click.

> The wire type is `look`, not `ping`. `ping` is the session heartbeat, which
> `CollabSession._receive` handles and returns early on — an attention marker
> sharing that name was silently undeliverable. A unit test now guards it.

**Peer viewports.** `collab.showViewports` (off by default — it is busy) outlines
the extent each peer is looking at. A peer looking at substantially the same
place as you is never drawn, since the rectangle would just trace your own screen
edge. Turn off `collab.shareViewport` to stop broadcasting your own.

**Activity log.** `collab.activityLog` writes who-did-what into the existing
Engine Log — "Maj Ali added Phase Line", "Capt Roy moved 3 symbols". One gesture
is one line: a drag publishes several ops and a multi-select nudge one per
graphic, so they are bucketed per actor over 1.5 s and summarised.

## Chat

`collab.chat`. A text channel on the rail, with an unread count. Nothing is
stored on the relay: your scrollback is what you heard while you were here, and a
late joiner is handed the last 50 lines by whichever peer answers its snapshot
request. Every line is rendered with `textContent`, never `innerHTML` — that one
choice is the whole sanitising story, and it cannot be undone later by accident.

## Shared view

Off by default (`collab.syncView`). Toggle it live with the link button on the
online chip, or from the ⚙ menu / Ctrl+K.

**Symmetric.** Anyone can pan or zoom and the whole room follows — nobody has to
be nominated. Whoever moves takes a *baton* for 1.5 s; while somebody else holds
it your own movement is not broadcast. That is what keeps two people panning at
once from dragging each other's map back and forth. If two peers move in the same
instant, the lower client id wins — the same deterministic tie-break `CollabLocks`
uses, so every peer reaches the same verdict without negotiating.

**Or follow one person.** Click a peer's dot on the chip to become their
passenger: only their viewpoint is applied, and the baton no longer applies to
you. Pan the map yourself and you stop following — a deliberate gesture is the
way out. Click their dot again to stop explicitly.

**Mixed 2D/3D rooms.** Centre and scale always cross over; tilt and heading only
between two views of the same type. So a MapView user and a SceneView user stay
on the same spot at the same scale, and each keeps their own camera angle.

**During a gesture** the viewpoint is streamed at 8 Hz and applied with
`animate: false` — instantly, because animating each frame queues `goTo` calls
faster than they can play and followers visibly rubber-band. When the view goes
`stationary`, one final message flagged `done` is applied with a 250 ms
animation, and that is what guarantees everyone converges even though the
intermediate messages are ephemeral and expendable.

Arbitration and the 2D/3D rules are pure functions in `CollabTypes`
(`shouldApplyRemoteView`, `shouldBroadcastLocalView`, `viewTargetFor`), unit-tested
without a view or a DOM.

## Conflict handling

Selecting a symbol or slide object **claims** it for `collab.lockTtlMs` (10 s,
refreshed while in use). Others see a padlock in your colour and cannot edit it;
their selection is refused with a toast. A crashed browser releases its locks
when the TTL lapses.

Behind that, every persistent op carries a hybrid logical clock stamp and the
newest stamp wins per object. Because workstation clocks on an isolated LAN are
not synchronised, ordering uses `{ms, counter, clientId}` so all peers reach the
same verdict independently. Covered by `CollabTypes.test.ts` and
`CollabLocks.test.ts`.

## Late joiners

There is no database, so a joining client picks **one** peer from its roster —
the lowest client id, which every peer computes identically — and asks that peer
directly. The reply is addressed only to the asker. The request fires as soon as
the roster has anybody in it, so two people opening the app simultaneously still
exchange state once they see each other.

**It retries.** On 2.5 s of silence the request falls to the next-lowest peer, up
to three distinct peers; a provider's `bye` retries at once rather than waiting
out the timer. Asking exactly one peer exactly once used to leave a joiner
permanently out of date whenever that peer left before answering or its reply was
lost — a failure whose only symptom was a map quietly missing things.

**A provider with nothing to send answers anyway**, with an empty offer. Silence
and death are indistinguishable from the asking end.

First person into a room keeps whatever they already have. A snapshot never
overwrites local work: graphics merge by id, and a deck is only accepted if the
joiner has no slides of their own. Both graphics and slides are split across
several messages so a big plan degrades into "arrives in pieces" rather than being
rejected wholesale by the relay's body limit. The deck is **always** sent as a
head plus per-slide chunks, even when it would fit in one message — a
size-conditional second path is the kind of branch that only ever runs on somebody
else's machine.

## When the network drops

`EventSource` reconnects the downstream on its own, which made an outage look
survivable — but every op posted during it was gone, so two maps silently
disagreed from then on with nothing logged on either side.

Persistent ops whose POST fails are now queued (bounded at 200, oldest dropped)
and replayed with 0.5→4 s backoff, plus an immediate flush when the stream
reopens. Ephemeral traffic is never retried, being expendable by design. Replay
needs no re-stamping: an op keeps its original HLC, so if it *did* land the first
time — a lost response looks identical to a lost request — the receiver's
last-write-wins gate sees an equal, not newer, stamp and discards it. A 4xx is not
retried at all: an oversized body or a wrong token will not fix itself, and
looping on it would bury the real error.

`window.collabEngine.resync()`, or `Ctrl+K → "Resync"`, re-asks the room from
scratch. **Merge-only**: it recovers objects you are *missing*, not local copies
that are *stale*, because a snapshot carries no stamps to arbitrate against.

## Rooms

The room is resolved most-specific-first:

1. `?room=OPORD-12` in the URL — the easiest way to share a room as a link
2. the last room used on this browser profile (`localStorage`)
3. `collab.room` in Settings.json

**Copy invite link** in the rail's menu puts that URL on the clipboard, so nobody
has to read a room name out over a radio.

Your display name is remembered the same way. Your colour is derived from your
client id, so it is the same on every screen without being stored anywhere.

## Known limitations

**Slide capture images are not transmitted.** `backgroundDataUrl` (a
full-resolution map screenshot, often megabytes) is always stripped, and
thumbnails over `collab.slideImageMaxKb` are dropped. A shared slide arrives with
its annotations and falls back to the live map beneath them — which is correct
anyway, since the map graphics are themselves synced. Streaming multi-megabyte
PNGs to every peer on every capture is not a good trade on a LAN.

**A slide-level op does not carry object state.** Renaming a slide, or editing
its notes, publishes the slide without its `overlays`; objects inside a slide
travel only as `ov.up` / `ov.del`. This is what stops a rename from reverting
whatever somebody else is editing on that slide — the two are stamped
independently, so a whole-slide payload would arbitrarily win. A slide the
receiver has never seen (including a duplicate) does carry its overlays, because
there is nothing local to protect.

**Room size is capped at 16.** Cursor traffic is fanned out once per other
member, so cost grows with the square of the room: 16 peers at 20 Hz is already
~4,800 SSE writes a second. The 17th client gets a clear `503` rather than
everybody quietly degrading. Lower `collab.cursorHz` before raising the cap.

**Chat has no history.** Nothing is stored anywhere, so the last 50 lines from one
peer's memory is the whole of a late joiner's context. There is no search and no
persistence across a reload.

**`resync()` cannot fix a stale object**, only a missing one — snapshots carry no
HLC stamps, so there is nothing to arbitrate a local copy against. Deleting the
object and letting the peer's next edit recreate it is the workaround.

**Protocol is v2, and only v2.** No compatibility with v1 is kept or wanted —
every client in a room runs the same build. Peers on a different version ignore
each other completely and each shows the ⚠ badge on the rail.

In practice the version that trips this is a **stale browser tab** left open
across a rebuild. The badge is the tell; reload the tab. That is the whole reason
the bump was worth making rather than quietly extending the message set: an older
peer would otherwise drop each new message as malformed and the room would
half-work with no explanation.

## Trust model

The relay is **unauthenticated by default**. It stores nothing and carries no
credentials, but it does not verify the `client` query parameter and it sets
`Access-Control-Allow-Origin: *` so a separately-hosted relay works without
configuration. On an isolated LAN that is the intended trade; treat it as such.
Concretely: anyone who can reach the relay can join a room, read every op, and
send ops under any client id.

**Optional shared secret.** Set `collab.token` on every client and start the relay
with the same value in `COLLAB_TOKEN`; anything else gets a `401`. Comparison is
constant-time-ish so a wrong token cannot be narrowed down by timing, and
`/collab/health` stays open because it reports two counts and no room names.

This is defence in depth, not a security boundary: the token travels in a query
string, so it is visible to anything that can see the URL. It raises the bar from
"anyone who can reach the port" to "anyone who was told the token". Leave it blank
and behaviour is exactly as before.

What the client does *not* trust is the content of a message. Payload shapes are
checked on arrival (`isValidPayload`), a peer's display name is length-capped and
its colour must be a real hex triplet before it reaches the DOM
(`sanitizeUser`), and slide payloads are copied key-by-key so a `__proto__` in
the JSON cannot reach `Object.prototype`.

## Removing the feature

1. Delete `MS/Engines/Collab/`
2. In `MS/Engines/SymbolEngine.ts` remove: the `CollabEngine` type import, the
   `_collabEngine` field, `_initCollabEngine()`, the `collabEngine` getter, the
   `import './Collab/CollabSettingsWidget'` side-effect, the `onViewChanged`
   line, and the `feature === 'collab'` branch.
3. Delete `tools/collabRelay.js`, the `relay` script in `package.json`, and the
   `collabRelayPlugin` import + plugin entry in `vite.config.ts`.
4. In `MS/Data/Settings.json` remove `features.collab` and the `collab` block.

If you only want `vite.config.ts` to stop referencing the relay (but keep
collaboration), delete just the import and plugin entry, then run `npm run relay`
and set `collab.relayUrl` to `http://<host>:6600`. That trades one line of build
config for one extra process — nothing else changes.

Nothing else in the codebase refers to it. No symbol class, `EditEngine`,
`MorphixEngine`, `BriefingEngine` or `SlideEditor` source was modified — those
are wrapped at runtime from inside this folder and restored on teardown.

## Tests

```bash
node MS/Engines/Collab/CollabTypes.test.ts
node MS/Engines/Collab/CollabLocks.test.ts
node MS/Engines/Collab/CollabSession.test.ts
```

**214 assertions, no framework.** They cover the parts where being wrong is
silent: hybrid-clock ordering (if peers disagree, maps diverge without an error),
lock arbitration under concurrent claims, view-baton arbitration (if both peers
refuse to yield they fight over the map forever), the snapshot retry ladder,
podium expiry and its reliance on the LWW gate, the payload shape gate, identity
sanitising, the roster/hello volley terminating, and the rediscovery path.

`CollabSession` is exercised headlessly through `SessionOptions.transportFactory`,
which exists solely for that — the real path needs `EventSource` and `fetch`. Two
files in that import graph therefore declare `opts` as a plain field instead of a
constructor parameter property, which node's strip-only TypeScript rejects, and
their runtime imports carry explicit `.ts` extensions.

The wrap-heavy paths (`MapSync`, `SlideSync`, `PresentSync`, `CollabChat`) stay
manual-GUI verified: two browser windows, `collab.debug: true`, and
`window.collabEngine.diagnose()`.

## Files

| File | Role |
| --- | --- |
| `CollabTypes.ts` | Wire protocol + hybrid logical clock |
| `CollabTransport.ts` | SSE+POST and BroadcastChannel backends |
| `CollabSession.ts` | Identity, roster, heartbeat, last-write-wins gate |
| `CollabLocks.ts` | Soft expiring per-object locks |
| `CollabPresence.ts` | Cursors, trails, previews, lock badges, pings, peer viewports |
| `CollabRosterBar.ts` | The left-edge rail + its menu |
| `MapSync.ts` | Map graphics in/out, pings, viewport heartbeat |
| `SlideSync.ts` | Deck + in-slide objects, slide lock badges |
| `ViewSync.ts` | Shared pan/zoom — baton arbitration + follow-a-peer |
| `PresentSync.ts` | Shared briefing — podium, slide position, build step, ink |
| `PresentInkLayer.ts` | Canvas for *peers'* laser / pen / spotlight |
| `CollabChat.ts` | Room chat panel |
| `CollabActivity.ts` | Who-did-what → Engine Log |
| `CollabSnapshot.ts` | Peer-served late-joiner catch-up, with retry |
| `CollabEngine.ts` | Orchestrator, settings, lifecycle |
| `CollabSettings*.ts` | ⚙ menu + Ctrl+K palette surface |
| `../../../tools/collabRelay.js` | Dependency-free fan-out relay (server-side, so it lives outside `MS/`) |
