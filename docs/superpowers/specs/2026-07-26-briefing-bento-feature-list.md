# Briefing module — comprehensive feature list (bento/slides + Excalidraw analysis)

Date: 2026-07-26
Scope: `MS/Engines/Briefing/*` + `MS/Engines/ImportExport/PptxExporter.ts`
Reference sources: `bento-main/` (MIT, © 2026 The Bento authors), `excalidraw-master/` (MIT)

---

## 0. Executive summary

Bento's editor is what our Briefing module is trying to become. Its stack is
**vanilla TS + Vite, no framework** (deps: `moveable`, `selecto`, `reveal.js`,
`temml`) — structurally identical to ours, so its code can be read, adapted and
in places copied outright under MIT with the notice preserved.

The three things worth taking, in order of value:

1. **The three-pane shell** — left slide rail · minimal topbar · right
   collapsible properties panel. We currently have *three separate UIs* doing
   this job (floating filmstrip panel, modal slide sorter, full-screen editor)
   and none of them is the bento shape.
2. **The document model** — `theme` + `layouts` + element `role` +
   `morphId` + `fx`. This is what unlocks templates, one-click restyle,
   PowerPoint-grade Morph transitions, and entrance animations. Our
   `SlideOverlay` has none of it.
3. **Speaker view + present chrome** — separate window with timer, next-slide
   preview, notes, overview grid, blackout. ~150 lines in bento
   (`screens.ts` + the `sv-*` block of `present.ts`); we have none of it.

What **not** to take: the CRDT collab stack, the self-updating single-file HTML
shell, blob relay, and `reveal.js` (our present mode runs over a live ArcGIS
view — reveal's DOM slide model does not fit).

**Renderer decision:** bento renders elements as DOM+CSS+SVG through one shared
`render.ts` used by canvas, thumbnails, present and print. We render with
fabric.js 4.5 on canvas. Per the stack constraint, **keep fabric** — but adopt
bento's *single-renderer discipline*: today `OverlayFabric.overlayToFabric()`,
the present-overlay builder in `BriefingEngine`, and `PptxExporter`'s shape
emitter are three independent interpretations of the same overlay model, and
they drift.

---

## 1. Current state (what Briefing already has)

| Area | Present today |
|---|---|
| Capture | `captureSlide` (extent/camera/rotation, layer visibility, per-graphic visibility, thumbnail + full-res background), `addBlankSlide`, `captureIntoSlide` |
| Slide ops | rename, duplicate, delete, reorder (drag-drop sorter), notes |
| Builds | `appear` / `fade` / `flyIn` / `drawOn` per graphic id, delay + duration, shared clock |
| Transitions | `goTo` pan/zoom for map slides; `fade` / `pushLeft` / `pushRight` / `wipe` between screen-only slides |
| Editor | fabric canvas, 12+ overlay kinds, 9 arrowheads, curved/elbow routing, groups, lock, flip, z-order, align/distribute, style copy-paste, undo/redo, lasso, eraser, laser trail, zoom/pan, context menu, shortcut help |
| Editor (in flight, uncommitted) | **tables**, **MIL-STD-2525D symbol overlays** (`MilSymFactory`), **block arrows**, **tactical attack arrows** (`TacArrowGeometry`) |
| Present | fullscreen, keyboard nav, slide counter, autoplay, Esc-back-to-editor |
| Interop | briefing JSON save/load, PPTX export (flat raster + editable native shapes), PPTX import → screen-only slides |

**Structural gaps:** no theme, no layouts/placeholders, no element roles, no
morph, no entrance animations, no speaker view, no slide rail inside the
editor, no charts/media, no comments, no gradients/shadows/blur, no connector
binding, no template fields, no document metadata.

---

## 2. Feature list

Effort key: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks.
Source key: **port** = adapt bento/excal code · **concept** = borrow the idea, write our own · **new** = ours alone.

### A. Shell & UI/UX — the bento restyle

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| A1 | **Three-pane editor shell** | full-screen modal, single slide, no rail | left slide rail · topbar · right panel, `flex` column + row, exactly bento's `.ed-root` / `.ed-topbar` / `.ed-body` | port | **M** |
| A2 | **Left slide rail inside the editor** | prev/next buttons only | live thumbnail strip, click to switch, drag to reorder, number badge, context menu, multi-select | port | **M** |
| A3 | **Minimal topbar** | dense toolbar, all tools always visible | logo · title input · undo/redo · Text / Shape▾ / Image / Media / Table / Chart / Comment · right cluster (print, share, save, help) | port | **S** |
| A4 | **Right properties panel, collapsible sections** | floating style "islands" positioned near selection | fixed right rail, `<details>`-style sections that remember open/closed: Slide / Interactivity / Layout / Speaker notes → per-selection: Typography / Fill & stroke / Position & size / Effects / Arrange / Morph / Presenting | port | **M** |
| A5 | **Collapsible rails** (`[` / `]`) | — | both rails collapse to slivers; state persisted | port | **S** |
| A6 | **Design tokens** | ad-hoc CSS in `SlideEditorUI` | `--ink / --chrome / --line / --muted / --accent / --radius` token block, wired to `ThemeManager` so Ops Dark / Night Vision reach the editor | concept | **S** |
| A7 | **Shape menu as a dropdown** | 12 flat toolbar buttons | one Shape▾ with labelled entries + one-line tips, bento's `SHAPE_MENU` array shape | port | **S** |
| A8 | **Position & size numeric panel** | drag only | X / Y / W / H / Angle / Opacity number inputs | port | **S** |
| A9 | **Unify panel + sorter + editor** | three separate UIs | the editor's rail *is* the sorter; the floating panel becomes a launcher | new | **M** |
| A10 | **Splash / boot polish** | — | low value for us — skip | — | — |

### B. Document model

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| B1 | **`theme` on the briefing doc** | none | `{ background, color, accent, fontFamily, chartPalette, table }`; new overlays inherit it. Enables one-click restyle of a whole deck | port | **M** |
| B2 | **`readableInk()` / `isLightBg()`** | new text can land invisible | luminance-derived default ink so a fresh label is never white-on-white | port | **S** |
| B3 | **Element `role`** (`title`/`subtitle`/`body`/`kicker`) | none | prerequisite for layouts; free-form string on `SlideOverlay` | port | **S** |
| B4 | **`morphId`** override | none | element identity for morph pairing, separate from `id` | port | **S** |
| B5 | **`link`** — click an overlay to jump to a slide | none | interactive briefs: click a phase box → jump to that phase's slide | port | **S** |
| B6 | **`stateOf`** — variant slides off linear flow | none | "what if the enemy does X" branch slides, reachable only by link | port | **M** |
| B7 | **Document `meta`** + template fields | none | `{{author}} {{unit}} {{dtg}} {{classification}}` resolved at render — see H1 | port | **S** |
| B8 | **`assets` map** (dedupe by key) | every image inlines its own data URL | `asset:<key>` refs; a symbol used 20× stores once | port | **S** |
| B9 | **Doc-level `present` chrome flags** | none | `{ slideNumber, controls, progress }` | port | **S** |
| B10 | **Model version bump + migration** | `version: 1..4` | v5 covering the above; loader upgrades in place | new | **S** |

### C. Layouts, templates, themes

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| C1 | **Slide layouts** (`doc.layouts`) | none | slide-shaped templates outside `slides[]`; instantiating deep-copies elements **keeping ids** so shared chrome morphs | port | **M** |
| C2 | **"New slide" layout picker** | one blank button | popover grid of layout thumbnails (bento's built-in five + ours) | port | **S** |
| C3 | **Placeholders** (`placeholder: "Click to add title"`) | none | dimmed prompt in the editor, hidden in present/print | port | **S** |
| C4 | **`applyLayout()` role-matched content migration** | none | change a slide's layout and text moves between same-role placeholders, PowerPoint-style | port | **M** |
| C5 | **Military layout set** | none | Title / Section divider / Situation / Mission / Execution / Task-org / Timeline / Terrain-with-legend / Map-full-bleed / Comparison — see H2 | new | **M** |
| C6 | **Deck templates** (`template: true`) | none | opening a template mints a fresh briefing; instructors ship exercise skeletons | port | **S** |
| C7 | **Theme presets** | none | 3–4 built-in themes matching `ThemeManager` | concept | **S** |

### D. Elements & editing

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| D1 | **Charts** | none | bar / line / pie / scatter. Bento dropped ECharts for an in-house dependency-free engine (`charts.ts`) — port that, it renders to SVG and maps cleanly to `pptx.addChart` | port | **L** |
| D2 | **Media (video/audio)** | none | drone footage, range video, recorded narration. Autoplay only in present mode | port | **M** |
| D3 | **Connector binding** | arrows are free-floating | `from`/`to` anchor to another overlay; endpoints re-route on the border when either moves (`syncConnectors`) | port | **M** |
| D4 | **Gradients** (`fillGradient`, `colorGradient`) | flat fills only | linear gradient with stops; morphs solid⇄gradient | port | **M** |
| D5 | **Shadows / blur / blend / backdrop-filter** | none | `ShadowSpec[]`, `blur`, `blend`, `backdropFilter`. Fabric supports shadow + filters natively | port | **M** |
| D6 | **Text stroke / hollow glyphs** | none | outline section titles | port | **S** |
| D7 | **Rich text** (bold/italic/underline *inside* one text box) | whole-object only | sanitized inline HTML subset; fabric needs `IText` styles ranges | port | **M** |
| D8 | **Markdown autoformat while typing** | none | `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `- ` bullets; paste converts | port | **M** |
| D9 | **LaTeX / math** (`temml`) | none | low value for this audience — skip unless artillery calc slides matter | port | **S** |
| D10 | **Bezier / path editor** | curved arrows via 3 preset types | true anchor+handle editing, double-click add/remove point, freehand→smoothed curve (`patheditor.ts`, `beziereditor.ts`, `simplifyPoints`) | port | **M** |
| D11 | **Polygon tool** (click corners, close) | closed lines only | proper poly tool with first-point close | port | **S** |
| D12 | **Image fit + crop + radius** | stretch only | `contain`/`cover`/`fill`, corner radius, crop editor | port (excal `cropElement.ts`) | **M** |
| D13 | **Element library / stencil** | none | reusable stamps: north arrow, scale bar, classification banner, unit symbol sets. Excalidraw's library model | port (excal) | **M** |
| D14 | **Frames** | none | group a region into a named frame; useful for task-org boxes | port (excal `frame.ts`) | **M** |
| D15 | **Eyedropper** | none | pick a colour off the map screenshot | port (excal) | **S** |
| D16 | **Stats / measure panel** | none | selection dimensions readout | port (excal) | **S** |
| D17 | **Table live-link to chart** (`source: {tableId}`) | table in flight, no link | chart tracks a table's values | port | **M** |
| D18 | **Column-width drag handles on tables** | in flight | bento's `bento-col-handle` pattern | port | **S** |
| D19 | **Smart guides / snapping** | fabric default | `moveable`-grade snapping: element edges, centers, slide bounds, 6px threshold, live guideline overlay | port | **M** |
| D20 | **Marquee + additive selection** | lasso exists | `selecto`-grade: shift-extend, click-through to group members with Alt | port | **S** |
| D21 | **Duplicate-drag / center-resize modifiers** | Alt+drag dup | Alt = duplicate, Ctrl = resize from center, Shift = 15° rotate snap | port | **S** |

### E. Animation & transitions

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| E1 | **Morph transition** | none | **the headline feature.** Elements sharing an id across adjacent slides tween position/size/rotation/colour. Bento does it with FLIP over DOM; in fabric it is *easier* — tween object props directly. `kernel/src/anim.ts` is a dependency-free tween engine we can port instead of leaning further on TweenMax | port + adapt | **M** |
| E2 | **Entrance animations** (`fx.enter`) | builds are map-graphic-only | `fade`, `fade-up`, `fade-down`, `slide-left/right/up/down` per overlay, with `enterDur` | port | **M** |
| E3 | **Stagger order** (`fx.order`) | `delayMs` per build | equal values enter together; simpler mental model than raw ms | port | **S** |
| E4 | **Count-up numbers** | none | strength figures, ranges, casualty estimates animate 0→value | port | **S** |
| E5 | **Ken Burns / ambient** | none | slow zoom on a full-bleed map or photo | port | **S** |
| E6 | **Motion path loop** (`fx.loop.motion-path`) | none | a unit icon crawling its axis of advance, with per-anchor speed control. Directly serves approach briefs | port | **M** |
| E7 | **Dash-march loop** | none | animated dashed line along a route/boundary | port | **S** |
| E8 | **Reduce-motion honoured** | partial | global `prefers-reduced-motion` + an in-show `M` toggle | port | **S** |
| E9 | **Unify builds and fx** | two systems (map builds vs. nothing for overlays) | one timeline: map-graphic builds and overlay entrances share a clock and a UI | new | **M** |

### F. Present & delivery

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| F1 | **Speaker view (second window)** | none | timer (click to reset) · wall clock · slide counter · current · next thumbnail · notes · rail · nav buttons. `screens.ts` + `sv-*` block ≈ 150 lines | port | **M** |
| F2 | **macOS-safe open order** | n/a | open notes window *before* fullscreen so neither gesture steals the other's activation — bento learned this the hard way | port | **S** |
| F3 | **Blackout (`B`)** | none | audience sees black, presenter keeps notes | port | **S** |
| F4 | **Overview grid (`G`)** | none | all-slides grid, click to jump | port | **S** |
| F5 | **Laser + ink in present mode** | `LaserTrail` exists, editor-only | reuse it over the present overlay canvas; ink optionally promotable to real overlays | new | **S** |
| F6 | **Present chrome** | counter only | progress bar, slide number, prev/next controls, all doc-configurable | port | **S** |
| F7 | **Per-slide time budget** | none | target seconds per slide; speaker view goes amber/red on overrun. Graded briefs are timed | new | **S** |
| F8 | **Swipe / touch navigation** | none | tablet-friendly present | port | **S** |
| F9 | **Wake-lock while presenting** | none | screen never sleeps mid-brief | port | **S** |
| F10 | **Autoplay with per-slide dwell** | global interval | per-slide `advanceAfterMs` | new | **S** |

### G. Map-native features (our differentiator — bento has nothing here)

| # | Feature | Proposed | Effort |
|---|---|---|---|
| G1 | **Feature-anchored callouts** | `anchorGraphicId` on an overlay; position resolves via `view.toScreen()` at render, so a leader line stays on its symbol across re-capture, pan and 2D↔3D. Falls back to stored x/y on screen-only slides | **M** |
| G2 | **Analysis data cards** | "Send to slide" from Measurement / LOS / Buffer / Trajectory / Road-network → a formatted key-value card overlay; exports as native PPTX text so numbers stay selectable | **M** |
| G3 | **Route flythrough build** | `BuildEffect: 'followRoute'` — camera tracks an axis-of-advance polyline over the build duration | **M** |
| G4 | **Auto legend slide** | walk visible symbol layers, render each distinct SIDC via `MilSymFactory`, lay out as an image+text grid. Uses machinery that now exists | **S** |
| G5 | **Phase slides from the timeline** | one slide per DTG phase from the Simulation engine's ORBAT timeline, visibility pre-set per phase | **M** |
| G6 | **Map inset / picture-in-picture** | a second small map extent as an overlay element (overview locator map) | **M** |
| G7 | **Live map element on a screen-only slide** | embed a small live map frame inside an otherwise-designed slide | **L** |
| G8 | **Graphic → overlay "flatten"** | convert a selected map graphic into an editable overlay for annotation-only slides | **M** |

### H. Military-briefing features

| # | Feature | Proposed | Effort |
|---|---|---|---|
| H1 | **Classification banner + slide master** | top/bottom banner, footer, DTG stamp, slide numbers — doc-level, rendered on every slide, emitted natively in PPTX. Uses B7 template fields | **S** |
| H2 | **OPORD deck template** | skeleton slides (Situation → Mission → Execution → Sustainment → Command & Signal) with per-slide notes prompts | **S** |
| H3 | **Task-organisation slide builder** | ORBAT tree of MIL-STD symbols with connectors, generated from the plan | **M** |
| H4 | **Timeline / synch matrix table** | a table preset with DTG columns and unit rows | **S** |
| H5 | **OCOKA / METT-TC prompt cards** | notes-pane checklists per terrain slide | **S** |
| H6 | **North arrow / scale bar / grid ref stamps** | library items (D13) that read live values from the captured extent | **M** |
| H7 | **Handout export** | PDF/PPTX notes pages, N-up | **M** |
| H8 | **Instructor comment threads** | bento's `Comment` model (anchored to element or point, replies, resolved) — editor-only, saved in the file, never presented | **M** |
| H9 | **Grading rubric overlay** | instructor-side scoring panel per slide, exported as a review report | **M** |

### I. Export / import / interop

| # | Feature | Today | Proposed | Src | Effort |
|---|---|---|---|---|---|
| I1 | **PDF export** | none | bento uses browser print with a print stylesheet — cheapest path | port | **S** |
| I2 | **PPTX: new element kinds** | overlays only | charts → `addChart`, media → `addMedia`, gradients → gradient fill, shadows → `shadow` | new | **M** |
| I3 | **PPTX: native tables** | in flight | `pptx.addTable` from the table model | new | **S** |
| I4 | **PPTX: slide master** | per-slide text | `defineSlideMaster` for banner/footer/numbers | new | **S** |
| I5 | **PPTX import: richer fidelity** | screen-only raster slides | pull native text/shape/table geometry out of the OOXML into real overlays | new | **L** |
| I6 | **Single-file HTML export** | none | self-contained `.html` briefing playable with no app — bento's whole premise, and genuinely useful for handing a brief to a boss | port | **M** |
| I7 | **Copy/paste between decks** | in-editor only | bento's `clipboard.ts` serializes elements *and whole slides* to the system clipboard | port | **S** |
| I8 | **Autosave + version history + crash recovery** | none | `autosave.ts`: periodic snapshots to IndexedDB, version list, recovery prompt on reopen | port | **M** |
| I9 | **Document print stylesheet** | none | shared with I1 | port | **S** |

### J. Deliberately out of scope

| Item | Why |
|---|---|
| CRDT live collaboration (`sync/`) | ~2,900 lines, needs a relay; PAMS8 is single-user offline-first |
| Self-updating single-file shell | product model we don't share |
| reveal.js present engine | our present mode drives a live ArcGIS view |
| Signed release channel | n/a |
| i18n to 8 locales | unless the school needs it |

---

## 3. Recommended sequencing

**Phase 1 — the shell (visible win, no model risk).**
A1–A9 + A6 tokens. Rebuild `SlideEditorUI` as the bento three-pane shell,
fold the sorter into the left rail, move the floating style islands into a
right panel with collapsible sections. No change to `SlideOverlay`.

**Phase 2 — the model.** B1–B10 + C1–C7. Theme, roles, layouts,
placeholders, template fields, deck templates. Ship the military layout set
(C5) and the classification master (H1) on top.

**Phase 3 — motion.** E1 morph (port `kernel/src/anim.ts`), E2/E3 entrance
animations, E9 unify with map builds.

**Phase 4 — delivery.** F1–F7 speaker view, blackout, overview, laser in
present, time budget.

**Phase 5 — map-native.** G1 anchored callouts, G2 analysis cards, G4 legend,
G3 route flythrough.

**Phase 6 — content depth.** D1 charts, D3 connectors, D19 snapping,
I8 autosave, H8 comments.

Phases 1 and 2 are the ones that make the module read as professional. Phase 3
is the one that makes a brief look expensive.

---

## 4. Licensing

Both sources are MIT. Any file we copy substantially from keeps its
`SPDX-License-Identifier: MIT` header and the copyright line, and
`MS/ThirdParty/` gains a notice entry — same treatment `milsymbol.js` and
`pptxgenjs` already get. Concept-level borrowing needs no notice, but the
attribution costs nothing and settles the question.
