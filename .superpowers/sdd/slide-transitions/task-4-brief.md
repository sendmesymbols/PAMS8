### Task 4: Sorter tile transition control

**Files:**
- Modify: `MS/Engines/Briefing/BriefingEngine.ts`

**Interfaces:**
- Consumes: `setSlideTransition` (Task 1), `_isScreenOnly` (existing), `SlideTransitionType` (Task 1).
- Produces: nothing further downstream — this is the last task.

- [ ] **Step 1: Add the transition `<select>` to each Sorter tile**

Find (inside `_refreshSorter`):

```ts
      const buildCount = slide.builds?.length ?? 0;
      tile.innerHTML = `
        <span class="ms-sorter-tile-num">${i + 1}</span>
        ${buildCount ? `<span class="ms-sorter-tile-builds" title="${buildCount} build step(s)">⚡${buildCount}</span>` : ''}
        <span class="ms-sorter-tile-title">${this._escapeHtml(slide.title)}</span>
        <span class="ms-sorter-tile-actions">
          <button class="ms-sorter-tile-btn" data-act="edit" title="Edit this slide — text, shapes, arrows, colors.">✎</button>
          <button class="ms-sorter-tile-btn" data-act="dup" title="Duplicate this slide.">⧉</button>
          <button class="ms-sorter-tile-btn" data-act="del" title="Remove this slide.">✕</button>
        </span>`;
```

Replace with:

```ts
      const buildCount = slide.builds?.length ?? 0;
      const screenOnly = this._isScreenOnly(slide);
      const transitionOptions: Array<[string, string]> = [
        ['', 'Cut'],
        ['fade', 'Fade'],
        ['pushLeft', 'Push Left'],
        ['pushRight', 'Push Right'],
        ['wipe', 'Wipe'],
      ];
      const transitionOptionsHtml = transitionOptions
        .map(([value, label]) => {
          const selected =
            slide.slideTransition === value || (!slide.slideTransition && value === '');
          return `<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
        })
        .join('');
      tile.innerHTML = `
        <span class="ms-sorter-tile-num">${i + 1}</span>
        ${buildCount ? `<span class="ms-sorter-tile-builds" title="${buildCount} build step(s)">⚡${buildCount}</span>` : ''}
        <span class="ms-sorter-tile-title">${this._escapeHtml(slide.title)}</span>
        <span class="ms-sorter-tile-actions">
          <select class="ms-sorter-tile-transition" data-act="transition" ${screenOnly ? '' : 'disabled'} title="${screenOnly ? 'Transition played entering this slide from another slide-view slide.' : 'Only applies between slide-view slides — no live map.'}">${transitionOptionsHtml}</select>
          <button class="ms-sorter-tile-btn" data-act="edit" title="Edit this slide — text, shapes, arrows, colors.">✎</button>
          <button class="ms-sorter-tile-btn" data-act="dup" title="Duplicate this slide.">⧉</button>
          <button class="ms-sorter-tile-btn" data-act="del" title="Remove this slide.">✕</button>
        </span>`;
```

- [ ] **Step 2: Stop the tile's click handler from treating the select as "go to slide"**

Find:

```ts
      tile.addEventListener('click', (e) => {
        const act = ((e.target as HTMLElement).closest('[data-act]') as HTMLElement | null)
          ?.dataset.act;
        if (act === 'del') {
          this.removeSlide(i);
        } else if (act === 'dup') {
          this.duplicateSlide(i);
        } else if (act === 'edit') {
          // openSlideEditor closes the sorter itself.
          void this.openSlideEditor(i);
        } else {
          void this.goToSlide(i);
        }
      });
```

Replace with:

```ts
      tile.addEventListener('click', (e) => {
        const act = ((e.target as HTMLElement).closest('[data-act]') as HTMLElement | null)
          ?.dataset.act;
        if (act === 'del') {
          this.removeSlide(i);
        } else if (act === 'dup') {
          this.duplicateSlide(i);
        } else if (act === 'edit') {
          // openSlideEditor closes the sorter itself.
          void this.openSlideEditor(i);
        } else if (act === 'transition') {
          // Handled by its own 'change' listener below — clicking to open
          // the dropdown must not also navigate to this slide.
        } else {
          void this.goToSlide(i);
        }
      });

      const transitionSelect = tile.querySelector<HTMLSelectElement>(
        '.ms-sorter-tile-transition',
      );
      transitionSelect?.addEventListener('change', () => {
        this.setSlideTransition(
          i,
          (transitionSelect.value || undefined) as SlideTransitionType | undefined,
        );
      });
```

- [ ] **Step 3: Add tile CSS**

Find:

```ts
      .ms-sorter-tile-btn[data-act="del"]:hover {
        color: #ff8d80;
        border-color: var(--ms-danger, #DC3C30);
        background: rgba(220, 60, 48, 0.16);
      }
```

Replace with:

```ts
      .ms-sorter-tile-btn[data-act="del"]:hover {
        color: #ff8d80;
        border-color: var(--ms-danger, #DC3C30);
        background: rgba(220, 60, 48, 0.16);
      }
      .ms-sorter-tile-transition {
        height: 22px; padding: 0 4px;
        border: 1px solid var(--ms-border, rgba(90, 140, 220, 0.25));
        border-radius: var(--ms-radius-sm, 4px);
        background: rgba(10, 13, 18, 0.82);
        color: var(--ms-text-dim, rgba(155, 180, 215, 0.72));
        font-size: 10px; line-height: 1; cursor: pointer;
      }
      .ms-sorter-tile-transition:hover:not(:disabled) {
        color: var(--ms-accent, #EF9F27);
        border-color: var(--ms-accent, #EF9F27);
      }
      .ms-sorter-tile-transition:disabled {
        opacity: 0.35; cursor: not-allowed;
      }
```

- [ ] **Step 4: Type-check**

Run: `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`
Check lines mentioning `BriefingEngine.ts`. Expected: no new errors beyond pre-existing `TS2307` noise.

- [ ] **Step 5: Build**

Run: `vite build`
Expected: exits 0.

- [ ] **Step 6: Manual verification**

Ask the user to open the Slide Sorter (⊞) on a briefing with both screen-only and map-based slides, and confirm: hovering a screen-only tile shows the transition dropdown alongside ✎/⧉/✕ and it's interactive (opening it doesn't navigate to that slide); hovering a map-based tile shows the same dropdown but greyed out/disabled with a tooltip explaining why; picking a value on a screen-only tile sticks (re-opening the Sorter still shows the chosen value selected); and Presenting through the deck reproduces the transition picked here (same check as Task 3 Step 8, now driven entirely from the UI instead of the console).

## Self-Review Notes

- **Spec coverage:** scope rule (Task 3 `canAnimate`), data model (Task 1), mechanism/table (Task 3), cancellation (Task 3 `_cancelPresentTransition`), container overflow (called out as a live-verification item in Task 3 Step 8 rather than a code change, per the spec), UI (Task 4), no-new-dependencies (Global Constraints + confirmed no new imports anywhere above). All spec sections have a corresponding task.
- **Type consistency:** `_buildOverlayCanvas`'s return type (`{ el: HTMLCanvasElement; canvas: any } | null`) matches `_presentOverlay`'s existing declared type exactly (both Task 2 and the pre-existing field use the identical shape), and matches what Task 3's `_transitionPresentOverlays` destructures. `setSlideTransition`'s parameter type (`SlideTransitionType | undefined`) matches what Task 4's `change` listener passes.
- **No placeholders:** every step above is a complete, exact old→new code replacement or a fully-specified command/manual check — nothing deferred to "later."
