# PAMS8 Widget Design Detail

Shared design language for engine widgets (analysis panels, side widgets, profile
windows). Mirrors the look established by `LocalPeaksEngine` so every new widget
feels like part of the same toolkit. Use this as a copy-paste baseline; tweak the
accent colour per engine but keep structure and scales identical.

---

## 0. Where tokens live (single source of truth)

**Tokens are owned by `MS/Managers/ThemeManager.ts`.** That class injects a
`<style id="ms-theme-vars">` block on `:root` whenever the theme changes, and
also injects a one-shot global scrollbar stylesheet (`#ms-global-scrollbar-styles`)
that themes scrollbars on all engine panels using the token set below.

- Active theme is read from `MS/Data/Settings.json` → `ui.theme` at bootstrap
  (see `SymbolEngine.ts` which calls `ThemeManager.getInstance().init(...)`).
- The Settings panel in `index.html` (`<select id="setting-uiTheme">`) wires
  user changes to `SymbolEngine.onSettingChanged(['ui','theme'], value)`, which
  calls `ThemeManager.setTheme(value)`.
- To add a new theme: append a new entry to the `THEMES` array in
  `ThemeManager.ts` and an `<option>` in `index.html`. No engine code touched.

**Don't redeclare `--ms-*` tokens inside an engine's `_injectStyles()`.**
Engines must read from the tokens via `var(--ms-fs)` etc. Hard-coded sizes
or colours undermine theming.

## 1. Design tokens

Declare these as CSS variables on the panel root (`.<engine>-panel`). All
sub-selectors should read from these — never hard-code colours or sizes.

```css
.<engine>-panel {
  /* Surfaces */
  --ms-bg:          #141820;
  --ms-bg-header:   rgba(26, 32, 48, .97);
  --ms-bg-input:    rgba(0, 0, 0, .28);

  /* Lines */
  --ms-border:      rgba(90, 140, 220, .25);
  --ms-divider:     rgba(80, 100, 150, .18);

  /* Text */
  --ms-text:        #dce8f5;
  --ms-text-dim:    rgba(175, 200, 230, .82);
  --ms-text-label:  rgba(140, 170, 205, .85);

  /* Geometry */
  --ms-radius:      9px;
  --ms-shadow:      0 8px 36px rgba(0, 0, 0, .55),
                    inset 0 0 0 1px rgba(255, 255, 255, .04);

  /* Typography */
  --ms-font:        'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
  --ms-fs:          13.5px;   /* body */
  --ms-fs-sm:       15px;     /* emphasis */
  --ms-fs-xs:       11.5px;   /* captions, micro-labels */

  /* Accent — override per engine */
  --ms-accent:      #EF9F27;  /* peaks/terrain = orange */
  --ms-accent-2:    #1D9E75;  /* secondary status = green */
}
```

### Accent palette by engine family

| Family                       | Accent     | Hex       |
| ---------------------------- | ---------- | --------- |
| Terrain / Peaks / Key Terrain| Orange     | `#EF9F27` |
| Force / Defensibility / OP   | Blue       | `#378ADD` |
| Threats / WEZ / Effects      | Red        | `#DC3C30` |
| Route / Corridor / Flight    | Cyan       | `#50C8FF` |
| Mission / Planner            | Violet     | `#B070E0` |

Status dots use a fixed semantic palette regardless of engine:
`ready/done = #1D9E75`, `running = #EF9F27`, `pick = #378ADD`,
`warn = #DC3C30`.

---

## 2. Panel shell

```css
.<engine>-panel {
  position: fixed;
  top: 62px; left: 306px;
  width: 380px;                    /* default — wide enough to read at arm's length */
  max-height: calc(100vh - 84px);
  background: var(--ms-bg);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius);
  color: var(--ms-text);
  font-family: var(--ms-font);
  font-size: var(--ms-fs);
  z-index: 1100;
  box-shadow: var(--ms-shadow);
  display: none;
  overflow: hidden;
  user-select: none;
  animation: panelIn .18s cubic-bezier(.34, 1.56, .64, 1);
}
@keyframes panelIn {
  from { opacity: 0; transform: scale(.96) translateY(-8px); }
  to   { opacity: 1; transform: scale(1)   translateY(0);    }
}
```

**Rules**
- Default panel width: **380 px** (was 304 px — too narrow to read from a
  distance). Wider panels go to 420–460 px.
- Drag clamp: `window.innerWidth - panelWidth - 16` for the right edge.
- Always `overflow: hidden` on the shell, and put the scroll on `.<engine>-body`.

---

## 3. Header

```html
<div class="<e>-header">
  <span class="<e>-header-icon">PEAK</span>
  <span class="<e>-header-title">Peak Analysis</span>
  <span class="<e>-status-dot"></span>
  <span class="<e>-status-lbl">Ready</span>
  <button class="<e>-help-btn">?</button>
  <button class="<e>-min-btn">v</button>
  <button class="<e>-close-btn">x</button>
</div>
```

- Title: **16 px, uppercase, letter-spacing .12em, weight 700**, accent colour.
- Icon kicker: 10.5 px boxed in `--ms-border`, accent colour.
- Status dot: 9 px circle, drop-shadow `0 0 8px <color>88` when live.
- Status label: 11.5 px, uppercase, weight 600, min-width 48 px so the
  badge doesn't reflow as text changes.
- Header is the drag handle (`cursor: grab` / `grabbing` on `:active`).
- Buttons in the header must `closest('button')`-guard the drag-start handler.

---

## 4. Sections, fields, controls

### Section heading

```css
.<e>-sec {
  font-size: 12px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--ms-accent);
  font-weight: 700;
  padding: 11px 14px 6px;
}
```

### 2-column field grid

```css
.<e>-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 10px; padding: 0 12px 9px; }
.<e>-field.full { grid-column: 1 / -1; }
.<e>-field span { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase;
                  color: var(--ms-text-label); font-weight: 600; }
.<e>-field input, .<e>-field select {
  background: var(--ms-bg-input);
  border: 1px solid var(--ms-border);
  border-radius: 4px;
  color: var(--ms-text);
  font: inherit; font-size: 13.5px;
  padding: 7px 9px;
  width: 100%; box-sizing: border-box;
}
.<e>-field input:focus, .<e>-field select:focus { border-color: var(--ms-accent); }
```

### Buttons

```css
.<e>-btn-row { display: flex; gap: 7px; padding: 7px 12px 0; }
.<e>-btn {
  flex: 1; padding: 8px 5px;
  font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; font-weight: 600;
  border: 1px solid var(--ms-border); border-radius: 4px;
  background: var(--ms-bg-input); color: var(--ms-text-dim);
  cursor: pointer; transition: all .14s;
}
.<e>-btn:hover:not(:disabled) { background: var(--ms-bg-header); color: var(--ms-text); }
.<e>-btn.primary { border-color: var(--ms-accent); color: var(--ms-accent); font-weight: 700; }
.<e>-btn:disabled { opacity: .35; cursor: not-allowed; }
```

### Toggles

```css
.<e>-toggle { display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; }
.<e>-toggle input { accent-color: var(--ms-accent); width: 15px; height: 15px; cursor: pointer; }
```

### Progress bar

```css
.<e>-progress > div { height: 6px; background: var(--ms-bg-input); border: 1px solid var(--ms-divider); border-radius: 3px; overflow: hidden; }
.<e>-progress-fill { height: 100%; width: 0; background: linear-gradient(90deg, var(--ms-accent-2), var(--ms-accent)); transition: width .16s; }
```

### Stat tiles (3-up)

```css
.<e>-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; padding: 0 12px 9px; }
.<e>-stats div { background: var(--ms-bg-input); border: 1px solid var(--ms-divider); border-radius: 4px; padding: 7px 9px; }
.<e>-stats span { display: block; font-size: 10.5px; text-transform: uppercase; color: var(--ms-text-label); letter-spacing: .06em; font-weight: 600; }
.<e>-stats b { display: block; margin-top: 3px; font-size: 16px; color: var(--ms-text); white-space: nowrap; font-weight: 700; }
```

---

## 5. Result rows

Use this anywhere a panel lists ranked items (peaks, OPs, candidates, hits).

```css
.<e>-row { border: 1px solid var(--ms-divider); border-radius: 5px; background: var(--ms-bg-input); padding: 9px 11px; margin-bottom: 8px; cursor: pointer; }
.<e>-row:hover, .<e>-row.selected { border-color: var(--ms-accent); background: var(--ms-bg-header); }
.<e>-row-header { display: flex; align-items: center; gap: 9px; margin-bottom: 7px; }
.<e>-row-badge { padding: 4px 10px; border-radius: 4px; font-size: 13px; font-weight: 700; color: #fff;
                 min-width: 46px; text-align: center; letter-spacing: .03em; }
.<e>-row-elev { font-size: 18px; font-weight: 700; color: var(--ms-text); }      /* primary metric */
.<e>-row-unit { font-size: 12px; font-weight: 500; color: var(--ms-text-dim); }
.<e>-row-btns button { padding: 5px 10px; border: 1px solid var(--ms-border); background: transparent;
                       color: var(--ms-text-dim); border-radius: 4px; font-size: 11px; font-weight: 600; }
.<e>-row-btns button:hover { color: var(--ms-accent); border-color: var(--ms-accent); }
.<e>-row-bar-wrap { height: 4px; background: rgba(255,255,255,.06); border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
.<e>-row-metrics { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--ms-text); font-weight: 600; }
.<e>-lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: .07em; color: var(--ms-text-label); margin-right: 3px; font-weight: 600; }
.<e>-row-coord { font-size: 11px; color: var(--ms-text-label); margin-top: 5px;
                 font-family: 'SF Mono', 'Consolas', monospace; letter-spacing: .03em; }
```

Composition order inside a row:
1. **Header line** — badge, primary metric, action buttons (right-aligned).
2. **Bar** — single-pixel-thin gradient bar; encodes relative magnitude.
3. **Metrics** — 2–4 inline `<span>` pairs of `<lbl>` + value.
4. **Coord/footnote** — monospaced, dim, optional.

---

## 6. Scrollbars

**Don't write scrollbar CSS in your engine.** `ThemeManager.init()` already
injects a global stylesheet (`#ms-global-scrollbar-styles`) that themes every
engine panel. If you add a new engine with a new class prefix, append your
selector to that stylesheet's list in `ThemeManager._injectGlobalScrollbarStyles`.

The thumb uses `var(--ms-scrollbar-thumb)` (a theme-specific gradient), the
track uses `var(--ms-scrollbar-track)`, and the width is **6 px** everywhere.

Tokens involved (defined per theme in `ThemeManager.ts`):

```
--ms-scrollbar-track          /* track background */
--ms-scrollbar-thumb          /* thumb gradient or solid colour */
--ms-scrollbar-thumb-hover    /* brighter variant on hover */
```

If for some reason you need to override scrollbars inside an engine (e.g. a
nested list with a different accent), prefer extending the `--ms-scrollbar-*`
tokens locally on the engine's panel root rather than writing fresh
`::-webkit-scrollbar-*` rules:

```css
.<engine>-panel {
  --ms-scrollbar-thumb: linear-gradient(180deg, var(--ms-accent), var(--ms-success));
}
```

---

## 7. Help popover

```html
<div class="<e>-help-popover" hidden>
  <div class="<e>-help-head">
    <div>
      <div class="<e>-help-kicker">Field Guide</div>
      <div class="<e>-help-title">Prominence-based peaks</div>
    </div>
    <button>x</button>
  </div>
  <div class="<e>-help-body">…</div>
</div>
```

- Absolutely positioned just under the header (`top: 39px`), inset 8 px
  left/right, same `--ms-shadow`.
- Body text: 11.5–12 px, line-height 1.45, `user-select: text` so users can
  copy formulas.
- Toggle via the header `?` button; `event.stopPropagation()` so a global
  outside-click handler doesn't immediately re-close it.

---

## 8. Companion windows (profile, chart, table popouts)

```css
.<e>-profile-panel {
  position: fixed; right: 18px; bottom: 18px;
  width: min(560px, calc(100vw - 36px)); height: 240px;
  background: var(--ms-bg); border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius); box-shadow: var(--ms-shadow);
  z-index: 1099;            /* one below the main panel */
  overflow: hidden;
}
```

- Always **one z-index below** the owning panel so dragging the main panel
  over the popout works intuitively.
- Header uses the same kicker treatment as the main panel.

---

## 9. Responsive fallback

```css
@media (max-width: 560px) {
  .<e>-panel { left: 12px; top: 72px; width: calc(100vw - 24px); }
  .<e>-grid  { grid-template-columns: 1fr; }
  .<e>-profile-panel { left: 12px; right: 12px; width: auto; }
}
```

Below 560 px, collapse the 2-column field grid to single-column and let the
panel span the viewport.

---

## 10. Implementation checklist for a new widget

1. Inject styles once via a `_injectStyles()` method guarded by a sentinel
   `document.getElementById('<engine>-styles')` so HMR doesn't duplicate them.
2. Declare the token block on `.<engine>-panel` — only override `--ms-accent`
   and `--ms-accent-2` for the engine family.
3. Use the markup skeleton from `LocalPeaksEngine._buildPanelHTML` as the
   starting point. Rename `peaks-*` → `<engine>-*` consistently.
4. Wire the scrollbar block on the panel root (Section 6). Don't try to do it
   per-scrollable element — the wildcard rule covers all current and future
   inner scrollers.
5. Set the drag-clamp constants to match the panel width
   (`window.innerWidth - <panelWidth + 16>`).
6. If the engine lists ranked items, copy Section 5 verbatim — visual parity
   across engines lets users transfer learning between widgets.

---

## Reference implementation

`MS/Engines/Analysis/Peaks/LocalPeaksEngine.ts` — the styles in
`_injectStyles()` are the source of truth. When this doc and that file
disagree, update one of them in the same commit.
