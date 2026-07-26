### Task 1: Data model + public API

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts`
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Produces: `SlideTransitionType` (exported type), `Slide.slideTransition?: SlideTransitionType`, `BriefingEngine.setSlideTransition(ref: number | string, type?: SlideTransitionType): void`. Tasks 2–4 depend on all three.

- [ ] **Step 1: Add `SlideTransitionType` to `BriefingTypes.ts`**

In `MS/Engines/Briefing/BriefingTypes.ts`, find:

```ts
export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';
```

Replace with:

```ts
export type BuildEffect = 'appear' | 'fade' | 'flyIn' | 'drawOn';

/**
 * Present-mode transition played entering a screen-only ("slide view") slide
 * from another screen-only slide. Map-based slides never use this — their
 * view.goTo() pan/zoom is the transition.
 */
export type SlideTransitionType = 'fade' | 'pushLeft' | 'pushRight' | 'wipe';
```

- [ ] **Step 2: Add `slideTransition` to the `Slide` interface**

In the same file, find:

```ts
  /** goTo duration entering this slide (ms). */
  transitionMs: number;
```

Replace with:

```ts
  /** goTo duration entering this slide (ms). Also reused as the slideTransition duration. */
  transitionMs: number;
  /**
   * Present-mode transition played when both this slide and the one before it
   * are screen-only. Absent = the existing instant cut. See SlideTransitionType.
   */
  slideTransition?: SlideTransitionType;
```

- [ ] **Step 3: Import the new type in `BriefingEngine.ts`**

Find:

```ts
import type {
  BriefingDocument,
  BuildStep,
  CapturedViewState,
  Slide,
  SlideOverlay,
} from './BriefingTypes';
```

Replace with:

```ts
import type {
  BriefingDocument,
  BuildStep,
  CapturedViewState,
  Slide,
  SlideOverlay,
  SlideTransitionType,
} from './BriefingTypes';
```

- [ ] **Step 4: Add `setSlideTransition`**

In `BriefingEngine.ts`, find (this is `setSlideNotes`, right after `renameSlide`):

```ts
  public setSlideNotes(ref: number | string, notes: string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].notes = notes;
  }
```

Replace with:

```ts
  public setSlideNotes(ref: number | string, notes: string): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].notes = notes;
  }

  public setSlideTransition(ref: number | string, type?: SlideTransitionType): void {
    const idx = this._slideIndex(ref);
    if (idx >= 0) this._slides[idx].slideTransition = type;
  }
```

- [ ] **Step 5: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Then check only lines mentioning `BriefingTypes.ts` or `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` @arcgis/core noise.

- [ ] **Step 6: Build**

Run: `vite build`
Expected: exits 0, writes `dist/MS/**`.

- [ ] **Step 7: Manual smoke check**

Ask the user (in their running `npm run dev` session, browser devtools console, with at least one Briefing slide already captured) to run:

```js
window.briefingEngine.setSlideTransition(0, 'fade');
window.briefingEngine.getSlides()[0].slideTransition; // expect 'fade'
window.briefingEngine.setSlideTransition(0, undefined);
window.briefingEngine.getSlides()[0].slideTransition; // expect undefined
```

Confirm both return the expected values and nothing throws or changes on screen (this step wires the field but nothing reads it yet).

---

