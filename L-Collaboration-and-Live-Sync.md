# L · Collaboration & Live Sync — Implementation Guide

## Overview

These features transform PAMS8 from a single-user tool into a multiplayer, real-time collaborative planning environment. Planners on different machines can see each other's cursor, drawings, and edits live.

---

## Architecture

- **New file**: `MS/Engines/SyncEngine.ts` (singleton)
- **Backend requirement**: a WebSocket server (e.g., Socket.io or native WebSockets) for message brokering. PAMS8 UI acts as the client.
- **Feature flag**: `Settings.json → features.liveSync`
- **Data Model**: JSON serialisation of `Graphic` objects.

---

## L1 — Live Cursor Broadcast

**What it does**: Shows remote users' cursors on the map with their name tag.

**Constraints**:
- **Emit**: throttle `view.on("pointer-move")` to ~10fps. Send `{ type: "cursor", userId: "...", lat, lon }` over WebSocket.
- **Receive**: `SyncEngine` maintains a `GraphicsLayer` named `"sync-cursors"`. On receiving a cursor message, update the `Point` geometry of the corresponding user's cursor graphic.
- **Symbol**: `PictureMarkerSymbol` resembling a mouse pointer, plus a `TextSymbol` with the user's name.
- Remove cursor graphic if no update received for > 5 seconds.

---

## L2 — Real-Time Graphic Replication

**What it does**: When User A draws or edits a symbol, User B sees the result instantly.

**Constraints**:
- **Serialization**: `SyncEngine.graphicToJson(graphic)` converts geometry and attributes (including `drawEssentials`) to a flat JSON object.
- **Events to sync**:
  - `onDrawEnd` -> broadcast `{ type: "add-graphic", graphic: json }`
  - `onEditEnd` (from EditEngine) -> broadcast `{ type: "update-graphic", graphicId: id, graphic: json }`
  - `onDelete` -> broadcast `{ type: "remove-graphic", graphicId: id }`
- **Deserialization**: `SyncEngine.jsonToGraphic(json)` reconstructs the `Graphic`.
- **Applying**: `SyncEngine` adds/updates/removes the graphic in the appropriate local `GraphicsLayer`.
- **Conflict Resolution**: last-write-wins based on a timestamp included in the sync message.

---

## L3 — Live Draw-Progress Sync

**What it does**: User B sees User A's rubber-band line *while* User A is drawing, before the final `onDrawEnd`.

**Constraints**:
- **Emit**: throttle `onDrawProgress` to ~5fps. Broadcast `{ type: "draw-progress", userId, points: CTRL_PTS, sidc: ... }`.
- **Receive**: render a temporary Polyline/Ghost symbol on `"sync-draw-progress"` layer.
- Clear temporary graphics when the corresponding `add-graphic` message is received.

---

## L4 — User Presence & Lock Management

**What it does**: Prevents two users from editing the same symbol simultaneously.

**Constraints**:
- When User A selects a graphic (via `SelectionEngine`), broadcast `{ type: "lock-graphic", graphicId: id, userId: A }`.
- User B's `SelectionEngine` ignores hit-tests for locked graphics.
- Render a small padlock icon or halo (in User A's colour) around locked graphics on User B's screen.
- Broadcast `unlock-graphic` on deselection.
- User presence list UI component showing who is currently connected and their assigned colour.

---

## Settings.json Additions

```json
"features": { "liveSync": false },
"liveSync": {
  "webSocketUrl": "wss://sync.pams8.example.com",
  "cursorThrottleMs": 100
}
```

---

## Implementation Order

1. Implement `SyncEngine.ts` WebSocket connection and JSON serialization.
2. Hook `onDrawEnd`, `onEditEnd`, `onDelete` to broadcast messages (L2).
3. Implement incoming message handler to update local layers (L2).
4. Implement live cursor broadcast and rendering (L1).
5. Add Edit Lock management to `SelectionEngine` (L4).
6. Add live draw-progress ghosting (L3).
