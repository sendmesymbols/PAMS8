# Task 3 Report — Transition engine (cancellable crossfade/push/wipe)

Status: **DONE** (see "Fix round 1" for two Important bugs found by the per-task reviewer, and "Final-review fix round" for two more Important issues found by the whole-branch cross-task review, both after initial submission)

File touched: `MS/Engines/Briefing/BriefingEngine.ts` only.

## Pre-flight check

Before editing, read and diffed every "old" code block in the brief against the live file. All matched **exactly**, with one cosmetic addition already present from Task 2 (a doc comment above `_overlayGeneration` in the field-declaration block) that didn't conflict with the splice point. No NEEDS_CONTEXT triggered.

## Edits made

1. **`_activeTransition` field** (`BriefingEngine.ts` ~line 108, after `_overlayGeneration`)
   - Before: field block ended at `private _overlayGeneration = 0;`
   - After: added `private _activeTransition: ActiveBuild | null = null;` immediately below it.

2. **`_cancelPresentTransition()`** (~line 857, right after `_cancelBuilds()`)
   - Added new private method exactly as specified: snapshots `_activeTransition`, nulls the field, then calls the stored `cancel()` in a try/catch.

3. **`_transitionPresentOverlays()`** (~line 1604, inserted immediately before `_clearPresentOverlays()`, i.e. right after the new `_renderPresentOverlays`/`_buildOverlayCanvas` split from Task 2)
   - Added the full async crossfade/push/wipe engine exactly as specified in the brief: generation+identity staleness guard on the awaited `_buildOverlayCanvas` result, `fade`/`pushLeft`/`pushRight`/`wipe` frame application via inline styles, a `finish()` closure that disposes the old frame and hands `_presentOverlay` to the new one, and a `TweenMax`-driven (or instant-fallback) `await new Promise<void>(...)` whose `resolve` is also captured inside `this._activeTransition.cancel`.

4. **`goToSlide()` restructure** (~line 492–543)
   - Before: unconditionally called `_clearPresentOverlays()` up front, then at the end did `if (this._presentMode) this._renderPresentOverlays(slide);`
   - After: calls `_cancelPresentTransition()` (not `_clearPresentOverlays()`) up front, captures `prevSlide`/`prevOverlay` before reassigning `_current`, and — after `_runBuilds` — either awaits `_transitionPresentOverlays(prevOverlay!, slide, slide.slideTransition!, slide.transitionMs ?? 1000)` when `canAnimate` is true, or falls back to `_renderPresentOverlays(slide)` otherwise. Added the `!this._presentMode` early return (present mode exited mid-navigation).

5. **`exitPresent()` cancellation wiring** (~line 956)
   - Before: `_clearPresentOverlays()` was the first teardown call after nulling the click handler/container.
   - After: `_cancelPresentTransition()` now runs immediately before `_clearPresentOverlays()`.

Also confirmed (no action needed, already true pre-Task-3): `onViewChanged` and `disable()` both route through `exitPresent()`, so they inherit the new cancellation call. `applySlideForExport` (a separate headless export path) does **not** call `_cancelPresentTransition()` — the brief didn't ask for it there, and it's not part of the interactive Present-mode flow; it's still protected by the existing `_overlayGeneration` staleness check if it ever ran concurrently with a live transition (extremely unlikely in practice).

## Type-check

Command: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`

Result: exit code 2 (pre-existing baseline — this project's `tsconfig.build.json` has ~1000+ pre-existing errors, almost all `TS2307: Cannot find module '@arcgis/core/...'`).

**Grep for `BriefingEngine.ts` in the full output: zero matches.** Not even a `TS2307` line references this file — completely clean.

## Build

Command: `npx vite build`

Result: **exit 0**. Tail of output:

```
dist/MS/Engines/Briefing/BriefingEngine.min.js                                  49.26 kB │ gzip: 13.09 kB
dist/MS/Engines/Analysis/LOSEngine.min.js                                      49.89 kB │ gzip: 12.03 kB
dist/MS/Engines/SymbolEngine.min.js                                            59.38 kB │ gzip: 15.27 kB
...
[vite:dts] Declaration files built in 4835ms.

✓ built in 14.79s
```

## Self-review — race-condition checklist trace

**1. `prevOverlay` captured before any reassignment, never defensively nulled.**
Confirmed. `const prevOverlay = this._presentOverlay;` sits right after `_cancelPresentTransition()` and right before `this._current = index;` — nothing between the top of `goToSlide` and that line can reassign `_presentOverlay`. Note `_cancelPresentTransition()` itself *can* indirectly reassign `_presentOverlay` (if it synchronously fires a previous in-flight transition's `finish()`, which sets `this._presentOverlay = newHandle`) — but that happens *before* the capture line, so `prevOverlay` correctly picks up the just-finished value, not a stale one. `_presentOverlay` is never nulled out defensively anywhere in the new code — confirmed by inspection of every write site (`_transitionPresentOverlays`'s `finish()`/no-newHandle branch, `_renderPresentOverlays`'s `.then()`, and `_clearPresentOverlays`).

**2. `canAnimate` boolean + non-null assertions.**
Confirmed correct. `canAnimate` is a separately-computed `const` combining `!!prevSlide`, `!!prevOverlay`, `this._presentOverlay === prevOverlay`, `!!slide.slideTransition`, and two `_isScreenOnly` checks — TypeScript cannot narrow `prevOverlay`/`slide.slideTransition` through this boolean (it's not a type guard), so the brief's `prevOverlay!` and `slide.slideTransition!` at the call site are required and present exactly where needed. Verified no new TS errors from this.

**3. Cancelled-mid-tween unblocking trace.**
Traced in detail. `_cancelPresentTransition()` synchronously invokes the stored `cancel` closure, which (in order) kills the tween, calls `applyFrame(1)`, calls `finish()` (disposes `oldHandle`, sets `this._presentOverlay = newHandle`), then calls `resolve()`. Since `resolve()` runs synchronously inside `cancel()`, the `await new Promise<void>(...)` inside the *original* `_transitionPresentOverlays` call settles; its continuation (`this._activeTransition = null;` — redundant but harmless, since `_cancelPresentTransition` already nulled the field) runs as a microtask and the function returns, which resolves the outer `await this._transitionPresentOverlays(...)` in that original `goToSlide` call, letting it finish cleanly. Confirmed no double-resolve, no unhandled rejection, no dangling promise.

I also traced the "shared `oldHandle` across a rapid-nav cancel" scenario one level deeper: if a second navigation's `_cancelPresentTransition()` fires *before* the first transition has even reached its `_buildOverlayCanvas` await (i.e., before `_activeTransition` was ever set for it), the cancel is a no-op, and both navigations end up capturing the *same* `prevOverlay` object. Whichever of the two async builds resolves while its target slide is still `this._current` is the one that actually calls `finish()`/`disposeOld()` on that shared old handle (exactly once); the other backs out via the staleness check without touching it (per the code's own comment: "whichever navigation/teardown is current owns disposing them"). No double-dispose, no leak, consistent with the "settles to exactly 1 canvas" expectation in the manual test. This relies on the pre-existing `_overlayGeneration`/slide-identity staleness guard doing its job across arbitrarily many rapid clicks, which I'm reasonably confident in but flag below as the one thing worth extra scrutiny under real rapid-fire clicking.

**4. `!this._presentMode` short-circuit.**
Confirmed. It sits right after `_runBuilds(slide)` and only does `return;` — it never touches `prevOverlay`/`_presentOverlay`. Comment correctly notes `_clearPresentOverlays` already ran (via whatever called `exitPresent` mid-navigation, e.g. Escape key during the `v.goTo` await).

**5. Map-slide-boundary falls to `else`.**
Confirmed. `canAnimate` requires `_isScreenOnly(prevSlide) && _isScreenOnly(slide)` both true; if either end is a map slide, `_isScreenOnly` returns false and `canAnimate` is false, routing to `else { this._renderPresentOverlays(slide); }` — identical to pre-Task-3 behavior for that case (instant cut driven by the map's own `v.goTo` pan/zoom, which still runs earlier in the same `goToSlide` call).

## Concerns

One thing I'd like the reviewer to specifically double-check, though I implemented exactly what the brief specifies and believe it's correct: the multi-generation "shared `oldHandle`" chain described in trace #3 above, under *very* rapid repeated clicking (3+ clicks arriving before any single `_buildOverlayCanvas` resolves). I'm confident the staleness check prevents double-dispose/leak in the 2-click case I traced by hand; I did not exhaustively enumerate every possible N-click interleaving, and the design relies on exactly one in-flight call's target slide matching `this._current` at its resolve time, which is the same invariant Task 2's `_renderPresentOverlays` already relies on (not new risk introduced by Task 3, just inherited and reused).

## Manual GUI verification recipe (for the human — no test runner / browser automation available to me)

1. Start the dev server yourself (`npm run dev`) and open a briefing with at least 3 screen-only slides (mix of blank/captured/imported is fine).
2. In the browser console:
   ```js
   window.briefingEngine.setSlideTransition(1, 'fade');
   window.briefingEngine.setSlideTransition(2, 'pushLeft');
   ```
   (UI for this lands in Task 4 — console is the only way to set it right now.)
3. Enter Present mode on slide 1, click/press Next twice: confirm slide 2 fades in, then slide 3 pushes in from the right, each over ~1 second.
4. Press Prev back to slide 1: confirm it also transitions (direction is fixed to the configured type regardless of navigation direction — expected, not a bug).
5. Rapid-fire Next several times in a row mid-transition: confirm no visual glitching, no stuck/duplicate canvases — run `document.querySelectorAll('.ms-briefing-overlay-canvas').length` a moment after you stop clicking and confirm it reads exactly `1` — and that the final slide shown matches the last one you clicked to.
6. If the briefing also has a map-based slide, confirm moving into/out of it is still an instant cut with the map's own pan/zoom — no transition should play across that boundary even if the screen-only slide's `slideTransition` is set.
7. (Extra, beyond the brief's list, worth trying given the race-condition focus of this task) Set a transition on slide 2, enter Present mode, click Next then almost immediately press Escape to exit Present mode mid-tween: confirm no console errors and that re-entering Present mode afterward renders cleanly (verifies `_cancelPresentTransition()` wiring in `exitPresent`).

---

## Fix round 1 (post-review)

The reviewer (dispatched at a higher tier specifically because of the concern I self-flagged) confirmed that concern was a real bug and found one more. Both fixed; nothing else in the review needed action.

### Finding 1 — same-slide-in-flight race leaks a canvas (the concern I flagged)

**Root cause:** `_overlayGeneration` (Task 2) is only bumped by `_clearPresentOverlays()`, which the animated path deliberately never calls (calling it would dispose the outgoing frame immediately, defeating the crossfade). So rapid navigation that returns to the SAME slide object while an earlier call for that same slide is still in flight (e.g. Next, Next, Prev landing back on the slide the first call already targeted) produces two `_transitionPresentOverlays` calls with identical `gen` and identical `slide !== this._slides[this._current]` results (both false, i.e. both look "current"). Both proceed past the staleness guard; both eventually call `finish()` on the shared `oldHandle` (double-dispose, benign/idempotent); but the SECOND `finish()` to run overwrites `_presentOverlay` with its own `newHandle`, silently orphaning the FIRST call's `newHandle` — that canvas element is never disposed and stays attached to the DOM forever. `document.querySelectorAll('.ms-briefing-overlay-canvas').length` ends up at 2 instead of settling back to 1.

**Fix applied** — a monotonic ticket counter independent of slide identity/generation, so "only the most recently *issued* call may complete" holds even when the target slide repeats:

1. New field, `BriefingEngine.ts:109-111` (right after `_activeTransition`):
   ```ts
   private _activeTransition: ActiveBuild | null = null;
   /** Bumped at the start of every _transitionPresentOverlays call — see that method for why. */
   private _transitionSeq = 0;
   ```

2. `_transitionPresentOverlays`'s staleness check, `BriefingEngine.ts:1715-1737`:
   - Before: `const gen = this._overlayGeneration;` then `await _buildOverlayCanvas`, then `if (gen !== this._overlayGeneration || slide !== this._slides[this._current]) { ... }`.
   - After: added `const seq = ++this._transitionSeq;` right after capturing `gen` (before the await), and added `|| seq !== this._transitionSeq` as a third OR-condition in the staleness check, with an updated comment explaining why the seq check is necessary (this path never calls `_clearPresentOverlays`, so gen alone can't detect "a newer call started for the same slide").

**Re-trace of the exact Next/Next/Prev-same-slide scenario, with the fix:**

Start at slide 1 (current index 1), all screen-only, transitions configured 1↔2.
- **Call A** (Next, 1→2): captures `seq=1` (global `_transitionSeq` now 1), targets slide 2, awaits its `_buildOverlayCanvas`, suspends.
- **Call B** (Next, 2→3) fires before A resolves: `_current` is already 2 (goToSlide advances `_current` synchronously before any await), so B's `prevSlide`/`prevOverlay` read cleanly; B captures `seq=2` (`_transitionSeq` now 2), targets slide 3, suspends.
- **Call C** (Prev, 3→2) fires before B resolves: `_current` is 3 at this point, so C's `prevSlide` = slide 3, `prevOverlay` = the same shared `oldHandle` (nothing has called `finish()` yet); C captures `seq=3` (`_transitionSeq` now 3), targets slide 2 — **the same slide object Call A already targeted**.
- When **A**'s `_buildOverlayCanvas(slide2)` resolves: `gen` unchanged, `slide(2) === this._slides[this._current]` (current is now 2, from C) — both would say "not stale" under the OLD check — but `seq(1) !== this._transitionSeq(3)` → **stale**. A disposes its own `newHandle` and returns without touching `_presentOverlay`/`oldHandle`.
- When **B**'s build resolves: target slide 3 no longer matches `this._current` (2) anyway, AND `seq(2) !== this._transitionSeq(3)` → stale either way. B disposes its own `newHandle` and backs out.
- When **C**'s build resolves: `slide(2) === this._slides[this._current]` (still 2) ✓, `gen` unchanged ✓, and `seq(3) === this._transitionSeq(3)` ✓ — not stale. C proceeds: tweens from the shared `oldHandle` to its own `newHandle`, and on completion `finish()` disposes `oldHandle` exactly once and sets `_presentOverlay` to C's `newHandle`.

Result: `oldHandle` disposed exactly once (by C, the only call that completes), A's and B's speculative `newHandle`s are each disposed by their own call as soon as they're built, and `_presentOverlay` ends up pointing at C's frame — the correct final state. `document.querySelectorAll('.ms-briefing-overlay-canvas').length` settles to exactly `1`. This also generalizes to N overlapping calls: `_transitionSeq` is a strictly monotonic ticket, so at most one in-flight call can ever have `seq === this._transitionSeq` at the moment its own check runs (any call that started after it will have already bumped the counter past that call's ticket) — the same "ticket" pattern also means `_activeTransition`, once set, always refers to the single canonical in-flight transition, so `_cancelPresentTransition()` continues to cancel the right one.

### Finding 2 — incoming frame's z-index loses to the stylesheet, `wipe` never renders

The shared class rule (confirmed at `BriefingEngine.ts:2134`: `.ms-briefing-overlay-canvas { position: absolute; inset: 0; pointer-events: none; z-index: 40; }`) applies to both the outgoing and incoming canvas elements. The old inline `newEl.style.zIndex = '1'` therefore lost to the class's `z-index: 40` on the outgoing element, so the incoming frame painted underneath, not above. For `wipe` (which only animates `newEl`'s `clipPath` and depends on it being on top) this meant the fully-opaque outgoing frame covered the entire reveal until `finish()` cleared the inline z-index and removed the old element — a stall followed by a hard cut instead of a wipe.

**Fix applied**, `BriefingEngine.ts:1752`:
- Before: `newEl.style.zIndex = '1'; // incoming frame always stacks above the outgoing one`
- After: `newEl.style.zIndex = '41'; // must beat the .ms-briefing-overlay-canvas class's z-index:40 (line ~2125), or the incoming frame paints BELOW the outgoing one and 'wipe' never becomes visible`

`41` beats the class's `40` while `fade`/`pushLeft`/`pushRight` are unaffected by which one wins visually (fade cross-dissolves symmetrically; push doesn't overlap in a way that depends on stacking), so this only changes behavior for `wipe`, which is exactly the bug.

### Deferred (per coordinator instruction — not fixed here, already recorded for the final whole-branch review)

- `this._presentOverlay === prevOverlay` in `goToSlide`'s `canAnimate` is unreachable-as-false (harmless, brief-specified) — left as-is.
- `fade` dips to ~75% composite opacity at the midpoint since both frames animate opacity together — left as-is.

### Re-verification after both fixes

Type-check: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` → exit 2 (pre-existing ~1000-error `TS2307` baseline, unrelated to this file). Grep of the full output for `BriefingEngine.ts`: **zero matches** — completely clean, same as before the fixes.

Build: `npx vite build` → **exit 0**. Tail:
```
dist/MS/Engines/Cue/MagneticCompass.min.js                                     60.38 kB │ gzip: 14.61 kB
dist/MS/Engines/Analysis/OpRanker/OpRankerEngine.min.js                        61.14 kB │ gzip: 16.46 kB
dist/MS/Data/CIMFills/Volcano.json.min.js                                      71.47 kB │ gzip: 16.99 kB
dist/MS/Engines/MissionPlanner/MissionPlannerEngine.min.js                     78.06 kB │ gzip: 22.90 kB
dist/MS/Engines/Analysis/TrafficabilityEngine.min.js                          103.64 kB │ gzip: 25.08 kB
dist/MS/Data/TacticalPointSymbols.json.min.js                                 171.63 kB │ gzip: 42.89 kB
dist/MS/Data/Symbols.json.min.js                                              370.84 kB │ gzip: 25.32 kB
[vite:dts] Declaration files built in 4971ms.

✓ built in 13.82s
```

No commit made, no branch created — all changes remain as uncommitted working-tree edits on `master`, per project convention.

---

## Final-review fix round (whole-branch cross-task review)

After all 4 tasks individually passed review, a final review looked specifically at cross-task interactions and found 2 Important issues plus 1 high-value Minor, all in this task's code. User approved the fix approach for all three; applied the two Important ones (the Minor was folded into one of the same edits, see below). Nothing else in that review needed action — see the "deferred" list at the end of this section.

### Fix 1 (Important) — container doesn't clip overflow; push transitions could bleed

The original spec assumed ArcGIS's view container clips overflow (`.esri-view-root { overflow: hidden }`). That assumption is false in the actual vendored `@arcgis/core` 5.0.19 CSS — nothing clips an absolutely-positioned child of the view container. An unguarded `pushLeft`/`pushRight` transition could therefore cause a transient horizontal scrollbar, and for a library consumer embedding the view in a non-full-bleed div, the sliding frames could visibly extend across the whole host page.

**Fix applied**, `BriefingEngine.ts` inside `_transitionPresentOverlays` (~lines 1780–1834): scope `position: relative; overflow: hidden` onto the view's container, but only for `pushLeft`/`pushRight` transitions, only for the transition's duration — captured `savedPosition`/`savedOverflow` before mutating, applied the clip guard right after computing `isPush`, and restored the saved values inside `finish()` (which runs on both normal completion and on `_cancelPresentTransition()`'s synchronous cancel path, since `finish` is a shared closure — so the restore fires either way, no leftover `overflow: hidden` stuck on the container if a transition gets cancelled mid-flight).

### Fix 3 (high-value Minor, folded into the same edit) — `fade` let the map bleed through at the midpoint

Previously `applyFrame` animated both `newEl.style.opacity` (0→1) and `oldEl.style.opacity` (1→0) simultaneously for `type === 'fade'`. Since `oldEl` is stacked below `newEl` (z-index 41 vs the class default 40), fading the outgoing frame's opacity down let whatever is beneath both canvases (the live map/background) show through at up to ~25% at the crossfade's midpoint, instead of a clean dissolve between the two frames.

**Fix applied** (same edit as Fix 1, since both touched the `applyFrame`/`finish` block): `fade` now only animates `newEl.style.opacity = String(t)`; `oldEl` is left at full opacity (whatever it already was) since it's directly underneath `newEl` and gets disposed immediately after `finish()` runs — no visible bleed-through, and no functional change to `pushLeft`/`pushRight`/`wipe` (which never touched `oldEl.style.opacity` to begin with).

### Fix 2 (Important) — PPTX export path doesn't cancel an in-flight transition

`applySlideForExport` called `_clearPresentOverlays()` (bumping `_overlayGeneration`) but never `_cancelPresentTransition()`. My original Task 3 report reasoned this was "extremely unlikely to run concurrently with Present mode" — the reviewer traced that this reasoning was actually wrong: Ctrl+K can reach the export command while Present mode is active (the present-mode keydown handler doesn't block it, and the `.ms-present-mode` CSS class doesn't hide the command palette), and `_overlayGeneration`'s bump alone doesn't rescue a mid-tween transition, because `_transitionPresentOverlays`'s staleness check only runs once, right after its single `await this._buildOverlayCanvas(slide)` — by design it doesn't re-check on every tween frame. A transition that was already past that check and mid-tween when export fires would still run to completion and call `finish()` (setting `_presentOverlay` to its `newHandle`) *after* `applySlideForExport` had already cleared and moved on, effectively resurrecting a stray overlay canvas post-export.

**Fix applied**, `BriefingEngine.ts:561-567`: added `this._cancelPresentTransition();` immediately before the existing `this._clearPresentOverlays();` call in `applySlideForExport`, mirroring the same ordering already used in `exitPresent()` (Fix round 1 / Task 3 Step 5) — jump-cut any in-flight transition to its end state synchronously before clearing, so there's nothing left in-flight for `_clearPresentOverlays()`'s generation bump to race against.

### Deferred (recorded, deliberately not fixed — per coordinator instruction)

- Transient duplicate canvases on the instant (non-transition) path under rapid nav — self-healing, same staleness-guard pattern already relied on elsewhere.
- A stranded JSDoc comment left over from the pre-Task-2 `_renderPresentOverlays`/`_buildOverlayCanvas` split.
- The trailing `this._activeTransition = null;` at the end of `_transitionPresentOverlays` not being `seq`-gated — traced safe (it only clears the field after this call's own promise has already resolved), latent-only, no observed failure mode.
- Unvalidated `slideTransition` value on import (e.g. a hand-edited briefing JSON with a typo'd transition name) — falls through the `switch` in `applyFrame` with no `default` case, i.e. silently renders no transform for that frame; not a crash.
- A missing ordering comment in `exitPresent()` explaining why `_cancelPresentTransition()` must precede `_clearPresentOverlays()`.
- An autoplay-interaction note (interaction between autoplay's own timer and a running transition) — flagged for awareness, no concrete bug identified.

### Re-verification after both fixes

Type-check: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit` → exit 2 (same pre-existing `TS2307` baseline noise as every prior run). Grep of the full output for `BriefingEngine.ts`: **zero matches** — still completely clean.

Build: `npx vite build` → **exit 0**. Tail:
```
dist/MS/Data/CIMFills/Volcano.json.min.js                                      71.47 kB │ gzip: 16.99 kB
dist/MS/Engines/MissionPlanner/MissionPlannerEngine.min.js                     78.06 kB │ gzip: 22.90 kB
dist/MS/Engines/Analysis/TrafficabilityEngine.min.js                          103.64 kB │ gzip: 25.08 kB
dist/MS/Data/TacticalPointSymbols.json.min.js                                 171.63 kB │ gzip: 42.89 kB
dist/MS/Data/Symbols.json.min.js                                              370.84 kB │ gzip: 25.32 kB
[vite:dts] Declaration files built in 5261ms.

✓ built in 14.64s
```

No commit made, no branch created — all changes remain as uncommitted working-tree edits on `master`, per project convention.
