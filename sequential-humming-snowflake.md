# Plan: write a consolidated feature doc (no code changes)

**Action on approval**: write the content below verbatim to a new file,
`Features/N-Annotation-Editor-Upgrades-and-Live-Collaboration.md`, matching the
existing `Features/L-Collaboration-and-Live-Sync.md` naming/style convention.
No other files are touched — this is documentation only, not implementation.

---

# N · Annotation Editor Upgrades & Real-Time Collaboration — Implementation Guide

## Overview

Two related workstreams from evaluating Excalidraw/tldraw as alternatives to fabric.js:

1. **Part 1 — Annotation Editor Upgrades**: adapt specific, cherry-picked pieces of
   Excalidraw's open-source engine (MIT licensed) into the existing fabric.js-based
   Briefing SlideEditor, without adding React or the Excalidraw npm package.
2. **Part 2 — Real-Time Collaboration**: turn PAMS8 from single-user into multiplayer,
   both on the tactical map (extends `Features/L-Collaboration-and-Live-Sync.md`) and
   inside the Briefing SlideEditor (new — not covered by any existing doc).

Both parts share one conclusion, verified against Excalidraw's actual current source:
**no piece of this requires React.** Its rendering/geometry/interaction logic lives in
React-free packages; the sync work is transport plumbing, not a UI-framework problem.

---

## Part 1 — Annotation Editor Upgrades (Excalidraw-Inspired)

**Touches**: `MS/Engines/Briefing/OverlayFabric.ts`, `MS/Engines/Briefing/SlideEditor.ts`.
No new engine.

**Source**: adapting code from `github.com/excalidraw/excalidraw` (MIT). Any lifted
function keeps a short attribution comment pointing at the original file/license —
an MIT requirement, not optional polish.

### 1.1 — Hand-drawn / sketchy rendering (cheapest, do first)
- Add `roughjs` as a direct dependency (confirmed standalone: zero React, 4 tiny
  utility deps).
- Reference: Excalidraw's `packages/element/src/shape.ts` — `generateRoughOptions()`
  (~66 lines, pure function, element style → roughjs `Options`) and the
  rectangle/ellipse/line branches of `_generateElementShape()`. Both are cleanly
  liftable; a handful of small geometry helpers they call (`getCornerRadius`,
  `getDiamondPoints`, etc., from `bounds.ts`/`utils.ts`) need porting too, not the
  whole files.
- Wire into `OverlayFabric.ts`'s shape factories: when building a fabric
  `Rect`/`Ellipse`/`Line`, optionally generate the path via roughjs and construct a
  `fabric.Path` instead — same fabric object model, same pptx-export pipeline, same
  undo/redo, just a sketchy stroke.
- Lowest cost, lowest risk. No data-model changes.

### 1.2 — Shape/stencil library
- Format: Excalidraw's `.excalidrawlib` — `{type: "excalidrawlib", version: 2, source,
  libraryItems: [{id, status, elements, created, name?}]}` (current schema — the only
  example fixture in Excalidraw's own repo is a stale v1 format; don't trust it, test
  against a real current export).
- Fields worth mapping for rectangle/ellipse/arrow/text/freedraw: base geometry+style
  (`x, y, width, height, angle, strokeColor, backgroundColor, fillStyle, strokeWidth,
  roughness, opacity, points`) plus per-type fields (arrow: `points`,
  `startBinding`/`endBinding`; text: `fontSize`, `text`, `textAlign`).
- New converter, same shape as the existing `overlayToFabric`/`fabricToOverlay`:
  `libraryElementToFabric(el)`. Skip binding/frame/group fields initially (v1 = static
  shape stencils, not live-bound diagrams).
- Moderate effort, pure data mapping — no code lifted from Excalidraw (library files
  are just JSON).

### 1.3 — Interaction engine adaptations (optional, later)
- Verified against current source: arrow-binding (`binding.ts`, 3156 lines),
  resize/rotate math (`resizeElements.ts` + `transformHandles.ts`, ~1865 lines),
  snapping (`snapping.ts`, 1414 lines), grouping (`groups.ts`, 466 lines) are all plain
  TypeScript, zero React, operating on plain data — a non-React harness can satisfy
  their inputs by duck-typing.
- Real cost is adapting ~9,200 lines of geometry logic onto fabric.js's object model
  (a data-model-mapping problem, not a React-untangling one). Rough estimate: 1–3 days
  per behavior in isolation; a combined v1 of all four is multi-day/low-weeks.
- Not scheduled — revisit only if the SlideEditor's editing feel (not just its look)
  becomes a priority.

---

## Part 2 — Real-Time Collaboration

**New engine**: `MS/Engines/SyncEngine.ts` (singleton). **New backend**: a small
self-hosted WebSocket server (new top-level folder, its own `package.json`/deploy
story — PAMS8 has zero server-side code today, confirmed via `package.json`). Chosen
over third-party managed sync (Liveblocks/PartyKit/Yjs cloud) and over ArcGIS
feature-service sync, given tactical/military data sensitivity — nothing should
transit a third party. ArcGIS feature sync is also the architecturally wrong tool for
the live pieces below: it's a periodic/eventual-consistency mechanism, not a
low-latency push channel, so at best it could cover graphic replication (2.2/L2)
and not cursors or draw-progress ghosting.

**Feature flag**: `Settings.json → features.liveSync` (default `false`), config block
`liveSync: { webSocketUrl, cursorThrottleMs }` — same pattern as every other optional
engine (`XSettingsManifest.ts` + `XSettingsWidget.ts` + a lazy `_initSyncEngine()` in
`SymbolEngine.ts`, gated on the flag, mirroring `_initProximityEngine()`).

**Message envelope** (shared transport for both map and SlideEditor sync):
`{ type, room, senderId, userName, userColor, payload, ts }`. `room` distinguishes a
map session from a specific briefing+slide. Every message carries `senderId`; a
client drops any message whose `senderId` matches its own, to prevent echo loops
(re-applying or re-broadcasting your own change back to yourself).

### 2.1 — Briefing SlideEditor collaboration (new — start here)

Recommended **first milestone**: smaller, cleaner data model than the map (5–6
overlay kinds via an existing converter, vs. ~124 symbol types), and no interaction
with `drawSymEnd`/undo-stack semantics. Proves the WebSocket plumbing before the
bigger map-side lift.

- `SlideEditor.ts` currently persists overlays **only** on `close(save)` — no
  per-edit event exists yet. New instrumentation: listen to the underlying fabric
  canvas's own `object:added`/`object:modified`/`object:removed` events on `_fc`,
  convert the touched object via the **existing** `fabricToOverlay()`
  (`OverlayFabric.ts`), and broadcast
  `{type: "overlay-upsert" | "overlay-remove", room: "slide:<briefingId>:<slideIndex>", overlay}`.
- Remote apply: on receipt, convert via the **existing** `overlayToFabric()` and
  add/update/remove directly on the local `_fc`. No new converter code needed — the
  payoff of reusing `OverlayFabric.ts`.
- Conflict resolution: last-write-wins by `ts`, same as the map side.
- Presence: show connected editors' names/colors in the SlideEditor toolbar. Live
  in-canvas cursors are a nice-to-have, not required for v1.

### 2.2 — Map-wide collaboration (extends `Features/L-Collaboration-and-Live-Sync.md`)

Same L1–L4 as the existing doc, with hook points confirmed against the current code:

- **L2 (graphic replication)** — add-graphic: `onDrawEnd` already bubbles as a global
  `document` CustomEvent (`SymbolEngine.setupGlobalEventListener()`); broadcast from
  there. update-graphic: `EditEngine` has no bubbled event, but does have a private
  `changeInSymbol` emitter (already consumed by `UndoRedoManager`) — `SyncEngine`
  subscribes as a second listener. remove-graphic: **no delete event exists anywhere
  today** — must add one (in `SymbolEngine.removeGraphic()`, plus anywhere else
  graphics are destructively removed — clipboard delete, undo/redo's own removal
  path).
  - `graphicToJson`/`jsonToGraphic`: write fresh rather than reusing
    `SerializationEngine`'s existing converter (that one targets a lossy, DB-oriented
    legacy `Plan` schema for save/load, not a direct mirror). Mirror
    `graphic.attributes` directly (`drawEssentials` nested, as `drawSymEnd()` already
    builds it).
  - Applying a remote add/update needs a **new** `applyRemoteGraphic(json)` method
    that builds/updates the `Graphic` directly and adds it to the right layer (via
    `Mapper.ts`'s existing Class→constructor lookup) **without** going through
    `drawSymEnd()` — that path always pushes an undo entry and re-fires a local
    `onDrawEnd`, which would both pollute your undo stack with other people's edits
    and echo the change back onto the network. Today's closest precedent
    (`loadSymbolFromJSON`'s fallback branch) is an unintended legacy edge case, not a
    designed silent-apply path — build this one on purpose.
- **L1 (cursors)** / **L3 (draw-progress)** — as specified in the existing doc; both
  already have a natural source event (`pointer-move`, `onDrawProgress` — also
  bubbles globally, same mechanism as `onDrawEnd`). New layers
  `sync-cursors`/`sync-draw-progress` added to `GraphicsLayerManager.LAYER_NAMES`,
  created lazily via `getOrCreateLayer()` (same pattern as `ClusterEngine`/
  `LadderEngine`) — not added to `SYMBOL_LAYER_IDS` (hit-testable layers only).
- **L4 (presence/locking)** — `SelectionEngine`'s hit-test handler (`activate()`,
  resolves a hit then calls `selectGraphic()`) is the exact place to reject a hit on
  a graphic locked by another user, before selection happens. Broadcast lock/unlock
  alongside the existing `selectionChange` emit.

### Auth / access control (v1 stance)

PAMS8 has no auth system today; building one is out of scope here. Minimum
reasonable guard: a shared per-session room token (a random string in the session's
share link/URL param), checked by the WebSocket server before admitting a
connection to a room. Not real authentication — just keeps a room from being
joinable by anyone without the link. Flag as a known limitation, not a solved
problem.

### Implementation order

1. WebSocket server skeleton (rooms, broadcast-to-room-except-sender) +
   `SyncEngine.ts` core (connect, reconnect/backoff, send/on, local userId+color) +
   Settings/feature-flag plumbing.
2. SlideEditor collaboration (2.1) — first real feature, validates the plumbing.
3. Map L1 — live cursors (simplest map feature, second proof point).
4. Map L2 — graphic replication, including the new delete event and the new
   `applyRemoteGraphic` silent-apply path (the biggest single piece of work here).
5. Map L3 — draw-progress ghosting.
6. Map L4 — presence & edit-locking.

(Part 1's roughjs rendering, §1.1, is independent of all of the above and can happen
in parallel any time.)
