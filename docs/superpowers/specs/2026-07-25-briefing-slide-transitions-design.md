# Briefing — Slide-View Transitions (Design)

Date: 2026-07-25 · Status: draft (pending user review) · Scope: `MS/Engines/Briefing/BriefingEngine.ts`, `BriefingTypes.ts`

## Goal

Add PowerPoint-style transitions (fade / push / wipe) that play in Present mode
when moving between **screen-only "slide view" slides** — imported PPTX slides,
blank slides, and captured-screenshot slides that carry no live map extent/camera.
Map-based slides are untouched: their `view.goTo()` pan/zoom already reads as a
transition, and this feature never engages while either endpoint is a live map slide.

No new dependencies. Reuses the already-bundled/local `window.TweenMax` (same one
`_runFade`/`_runFlyIn`/`_runDrawOn` already animate builds with) and the existing
present-mode overlay-canvas machinery. Nothing here is loaded from a CDN.

## Scope rule

A transition plays only when **all** of:
- Present mode is active (transitions are a playback-only concept; the sorter/editor
  never show them).
- The slide being left (`prevSlide`) and the slide being entered (`slide`) are both
  screen-only (`_isScreenOnly`: no `view.extent` and no `view.camera`).
- The entered slide has a `slideTransition` set (absent = today's instant cut —
  fully backward compatible, no document-version bump needed, same precedent as
  `strokeDash`).

Any other case (map slide on either end, or no `slideTransition`) falls through to
today's exact behavior: `_clearPresentOverlays()` then `_renderPresentOverlays(slide)`,
an instant swap.

Transition direction is fixed to the configured type regardless of Next/Prev/jump —
"Push Left" always pushes left. Reversing direction based on navigation direction
(as PowerPoint does) is a natural follow-up, not in this scope.

## Data model

`BriefingTypes.ts`:

```ts
export type SlideTransitionType = 'fade' | 'pushLeft' | 'pushRight' | 'wipe';
```

`Slide` gains:

```ts
/** Screen-only-slide playback transition. Absent = instant cut (today's behavior). */
slideTransition?: SlideTransitionType;
```

No new duration field — reuses the existing per-slide `transitionMs` (today only
used for map `goTo` duration) as "how long entering this slide takes," whichever
kind of entrance it is.

## Mechanism

Two canvas elements stacked via the existing `.ms-briefing-overlay-canvas`
(`position: absolute; inset: 0`) CSS, animated with a plain TweenMax state tween —
the same pattern as every other build effect in this file (`TweenMax.to(state, sec,
{t: 1, onUpdate, onComplete})`, cancelled via `tween.kill()`). Manually writing
`el.style.opacity` / `el.style.transform` / `el.style.clipPath` in `onUpdate` avoids
any dependency on GSAP's CSSPlugin.

Rejected alternatives:
- **Native CSS transitions/keyframes** driving the two elements directly — less
  code, but introduces a second animation system alongside TweenMax, and rapid-nav
  cancellation needs `transitionend` + computed-style reads instead of the simple
  `.kill()` every other effect already uses.
- **Hand-rolled canvas compositor** (draw both frames into one canvas per rAF tick,
  blend/clip pixels manually) — full control over exact masks, but far more code
  than crossfading two already-rendered static images requires.

### Refactor of the render path

Today, `_renderPresentOverlays(slide)` starts with `this._clearPresentOverlays()`
(disposing the previous frame immediately), then builds the new one. That has to
change for the animated path, since the old frame must stay on screen (and
addressable) while the new one crossfades in.

Split the "build a fully-rendered overlay canvas for a slide" step out of "make it
the active one":

- `_buildOverlayCanvas(slide): Promise<{el, canvas} | null>` — today's
  `_renderPresentOverlays` body minus the clear-and-assign; resolves once the
  background image (if any, `screenBg`) has loaded and overlays are drawn.
  Resolves `null` on the existing early-outs (no fabric / nothing to draw).
- `_renderPresentOverlays(slide)` (instant path, unchanged call sites) becomes:
  clear old → `_buildOverlayCanvas(slide)` → assign result to `_presentOverlay`.
- New `_transitionPresentOverlays(oldHandle, slide, type, durationMs): Promise<void>`
  (animated path): build the new handle via `_buildOverlayCanvas` *without*
  touching `_presentOverlay` or disposing `oldHandle`, set the new element's
  initial CSS state for `type`, then tween `{t: 0→1}`:

| type | onUpdate (new element) | onUpdate (old element) |
|---|---|---|
| `fade` | `opacity = t` | `opacity = 1 - t` |
| `pushLeft` | `translateX(${(1-t)*100}%)` | `translateX(${-t*100}%)` |
| `pushRight` | `translateX(${-(1-t)*100}%)` | `translateX(${t*100}%)` |
| `wipe` | `clipPath: inset(0 ${(1-t)*100}% 0 0)`, stacked above old | unchanged |

  `onComplete` (and cancel, see below) disposes `oldHandle` and assigns the new
  handle to `this._presentOverlay`.

`goToSlide` currently calls `_clearPresentOverlays()` unconditionally near the top,
before the map `goTo` even runs. That has to move: capture `prevSlide` (the
pre-navigation `this._current`) and the current `_presentOverlay` handle *before*
mutating state, and only clear-immediately when the eligibility check above fails;
otherwise hand both off to `_transitionPresentOverlays`.

### Cancellation

`_activeTransition: { cancel(): void } | null`, mirroring `_activeBuilds`. Cancel
kills the in-flight tween and immediately runs the same disposal `onComplete` would
have (snap to end state, dispose the old handle) — so rapid Next/Prev during a
transition jump-cuts cleanly with no leaked canvases/fabric instances. Called at the
top of `goToSlide` (alongside `_cancelBuilds()`) and from `exitPresent()`.

### Container overflow

`pushLeft`/`pushRight` need the view container to clip content sliding past its
edges. ArcGIS view containers clip by default (`.esri-view-root` sets `overflow:
hidden`); verify this holds during implementation rather than assuming it blind.

## UI

No per-slide inspector exists today beyond the Sorter tile (title, build-count
badge, ✎/⧉/✕). Add a `<select>` to each tile's action row (`ms-sorter-tile-actions`
in `_refreshSorter()`), options None/Fade/Push Left/Push Right/Wipe, bound to
`slide.slideTransition`. Disabled (greyed, tooltipped "Only applies between
slide-view slides — no live map") when `!this._isScreenOnly(slide)`, since the
setting is inert there.

New public method, mirroring `renameSlide`'s shape:

```ts
public setSlideTransition(ref: number | string, type?: SlideTransitionType): void
```

## Files touched

- `BriefingTypes.ts` — `SlideTransitionType`, `Slide.slideTransition`.
- `BriefingEngine.ts` — `_buildOverlayCanvas` extraction, `_transitionPresentOverlays`,
  `_activeTransition` bookkeeping, `goToSlide` reordering, `setSlideTransition`,
  Sorter tile `<select>` + wiring.

No changes to `SlideEditor.ts`, `SlideEditorUI.ts`, `OverlayFabric.ts`, `LaserTrail.ts`,
or the PPTX exporter/importer — transitions are a Present-mode playback concern only,
not part of the persisted-overlay editing model or the exported deck.

## Verification

`npm run build` (vite) + `tsc` filtered to the two touched files, then manual GUI:
build a briefing with 3+ screen-only slides (mix of imported-PPTX/blank/captured),
set different transition types via the Sorter, Present through them forward and
backward, and rapid-fire Next during an in-flight transition to confirm clean
cancellation. Also confirm a map-slide ↔ screen-only-slide pair still cuts instantly
(no accidental transition bleed across the scope boundary).
