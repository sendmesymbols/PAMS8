### Task 6: Arrow-type selector panel (Sharp / Curved / Elbow)

**Files:**
- Modify: `MS/Engines/Briefing/SlideEditorUI.ts` — `StyleProp`, `PanelContext['kind']`, `SECTIONS_BY_CONTEXT`, `ICONS`, `build()` template, `_wirePanel()`, `refreshPanelValues()`
- Modify: `MS/Engines/Briefing/SlideEditor.ts` — `_panelContextFor()`, `_syncControlsFromSelection()`, `_onStyleChanged()`; new method `_applyArrowTypeChange`

**Interfaces:**
- Consumes: `_rebuildArrow` (Task 5)

- [ ] **Step 1: `StyleProp` and `PanelContext['kind']`**

In `SlideEditorUI.ts`, add `| 'arrowType'` to the `StyleProp` union, and add `'arrow'` to the `PanelContext['kind']` union (`kind: 'none' | 'text' | 'box' | 'linework' | 'highlight' | 'mixed'` → add `| 'arrow'`).

- [ ] **Step 2: `SECTIONS_BY_CONTEXT`**

Add an entry:
```ts
  arrow: ['stroke', 'width', 'dash', 'arrowtype', 'opacity'],
```

- [ ] **Step 3: Icons**

Add to `ICONS`:
```ts
  arrowSharp: svg('<path d="M4.5 19.5L18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowCurved: svg('<path d="M4.5 19.5C4.5 10 9 5 18.5 5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
  arrowElbow: svg('<path d="M4.5 19.5V9.5h14V5.5M18.5 5.5h-6.2M18.5 5.5v6.2"/>'),
```

- [ ] **Step 4: Panel section markup**

In `build()`'s template string, add a new section right after the `data-sec="dash"` section (before `data-sec="text"`):
```html
          <div class="ms-sledit-sec" data-sec="arrowtype">
            <div class="ms-sledit-seclabel">Arrow type</div>
            <div class="ms-sledit-row">
              <button data-arrowtype="sharp" title="Sharp">${ICONS.arrowSharp}</button>
              <button data-arrowtype="curved" title="Curved">${ICONS.arrowCurved}</button>
              <button data-arrowtype="elbow" title="Elbow">${ICONS.arrowElbow}</button>
            </div>
          </div>
```

- [ ] **Step 5: Wire the click handler**

In `_wirePanel()`, extend the selector passed to `closest(...)` from:
```ts
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-style],[data-align],[data-act]',
      ) as HTMLElement | null;
```
to:
```ts
      const el = (e.target as HTMLElement).closest(
        '[data-color],[data-width],[data-dash],[data-arrowtype],[data-style],[data-align],[data-act]',
      ) as HTMLElement | null;
```
and add a branch (e.g. right after the `else if (el.dataset.dash) { ... }` branch):
```ts
      } else if (el.dataset.arrowtype) {
        d().arrowType = el.dataset.arrowtype as StyleDefaults['arrowType'];
        this._host.onStyleChanged('arrowType');
```

- [ ] **Step 6: Reflect current value in `refreshPanelValues()`**

Add, anywhere in the method body:
```ts
    panel.querySelectorAll('[data-arrowtype]').forEach((el: any) => {
      el.classList.toggle('active', el.dataset.arrowtype === d.arrowType);
    });
```

- [ ] **Step 7: `_panelContextFor()` in `SlideEditor.ts`**

Replace the whole method (`:1162-1187`) with:
```ts
  private _panelContextFor(): PanelContext {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (objs.length) {
      const kinds = new Set(objs.map((o) => o?.data?.kind).filter(Boolean));
      let kind: PanelContext['kind'] = 'mixed';
      if (kinds.size === 1) {
        const k = [...kinds][0] as string;
        kind =
          k === 'text'
            ? 'text'
            : isBoxKind(k)
              ? 'box'
              : k === 'highlight'
                ? 'highlight'
                : k === 'arrow'
                  ? 'arrow'
                  : 'linework';
      }
      return { kind, hasSelection: true };
    }
    if (BOX_TOOLS.has(this._tool)) return { kind: 'box', hasSelection: false };
    switch (this._tool) {
      case 'text':
        return { kind: 'text', hasSelection: false };
      case 'arrow':
        return { kind: 'arrow', hasSelection: false };
      case 'line':
      case 'freehand':
        return { kind: 'linework', hasSelection: false };
      case 'highlighter':
        return { kind: 'highlight', hasSelection: false };
      default:
        return { kind: 'none', hasSelection: false };
    }
  }
```

- [ ] **Step 8: Read `arrowType` back on selection, in `_syncControlsFromSelection()`**

Right after the existing line `d.strokeDash = obj.data.strokeDash ?? 'solid';` (inside the non-text `else` branch, `:1231`), add:
```ts
      if (kind === 'arrow') d.arrowType = (obj.data.arrowType ?? 'sharp') as ArrowType;
```

- [ ] **Step 9: Special-case `arrowType` in `_onStyleChanged`, add `_applyArrowTypeChange`**

Replace `_onStyleChanged` (`:1067-1075`) with:
```ts
  private _onStyleChanged(prop: StyleProp): void {
    const objs: any[] = this._fc?.getActiveObjects?.() ?? [];
    if (prop === 'arrowType') {
      const rebuilt = objs
        .filter((o) => o?.data?.kind === 'arrow')
        .map((o) => this._applyArrowTypeChange(o));
      if (rebuilt.length > 1) {
        const fabric = (window as any).fabric;
        this._fc.setActiveObject(new fabric.ActiveSelection(rebuilt, { canvas: this._fc }));
        this._fc.requestRenderAll();
      } else if (rebuilt.length === 1) {
        this._fc.setActiveObject(rebuilt[0]);
      }
      if (this._fc?.isDrawingMode) this._configureBrush();
      return;
    }
    for (const obj of objs) this._applyStyleTo(obj, prop);
    if (objs.length) {
      this._fc.requestRenderAll();
      this._commitDebounced();
    }
    if (this._fc?.isDrawingMode) this._configureBrush();
  }

  private _applyArrowTypeChange(obj: any): any {
    const fabric = (window as any).fabric;
    const lp: Array<{ x: number; y: number }> = obj.data?.localPoints ?? [];
    const m = obj.calcTransformMatrix();
    const absPoints = lp.map((p) => {
      const abs = fabric.util.transformPoint(new fabric.Point(p.x, p.y), m);
      return { x: abs.x, y: abs.y };
    });
    obj.data.arrowType = this._defaults.arrowType;
    return this._rebuildArrow(obj, absPoints);
  }
```

- [ ] **Step 10: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/SlideEditor.ts MS/Engines/Briefing/SlideEditorUI.ts`
Expected: no new errors.

- [ ] **Step 11: Manual verification**

Draw a multi-point arrow (Sharp by default). Select it; the properties panel now shows a "Arrow type" row with 3 buttons, Sharp highlighted. Click Curved: the arrow re-renders as a smooth curve through the same points, still selected, bow handles still present. Click Elbow: re-renders as an orthogonal connector with rounded corners. Draw a brand-new arrow while Elbow is active: it comes out elbowed immediately. Save & reload: the chosen type persists.

- [ ] **Checkpoint:** Sharp/Curved/Elbow selectable per-arrow via the panel; new arrows honor the last-chosen type. Do not commit.

---

