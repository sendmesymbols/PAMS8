# Analysis Widget Style Guide

This guide captures the readable, wide widget treatment used by `LocalPeaksEngine` and now applied to `BufferEngine`. Use it for map analysis panels that need dense controls, live status, and repeated field work.

## Panel Frame

- Scope all widget tokens on the panel root, for example `.peaks-panel` or `.buffer-panel`.
- Use a fixed panel with `top: 62px`, a practical left offset, and a width around `304px` for compact tools or `360px` for tools with legends and stats.
- Set `max-height: calc(100vh - 84px)`, `overflow: hidden` on the frame, and a scrollable body with `max-height: calc(100vh - 122px)`.
- Use `border-radius: 9px`, a subtle blue-tinted border, and the same inset-plus-drop shadow.

Core tokens:

```css
--ms-bg: #141820;
--ms-bg-header: rgba(26, 32, 48, 0.97);
--ms-bg-input: rgba(0, 0, 0, 0.28);
--ms-border: rgba(90, 140, 220, 0.25);
--ms-divider: rgba(80, 100, 150, 0.18);
--ms-text: #dce8f5;
--ms-text-dim: rgba(155, 180, 215, 0.72);
--ms-text-label: rgba(120, 150, 185, 0.75);
--ms-accent: #EF9F27;
--ms-success: #1D9E75;
--ms-danger: #DC3C30;
--ms-info: #378ADD;
--ms-radius: 9px;
--ms-font: 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
--ms-fs: 11.5px;
--ms-fs-sm: 12.5px;
--ms-fs-xs: 10px;
```

## Header

- Use a compact draggable header with `9px 10px 8px` padding and `7px` gap.
- Add a small bordered icon capsule, uppercase title, status dot, status label, help button, minimize button, and close button.
- Keep the title and primary active state on `--ms-accent`.
- Keep status tones consistent: green ready/done, amber running/computing, blue pick, red error.

## Controls

- Use two-column grids with `gap: 7px 8px` for paired controls.
- Use full-width field rows for high-importance selects.
- Labels are uppercase, 10px, letter-spaced, and dim.
- Inputs and selects use `--ms-bg-input`, `--ms-border`, `3px` radius, and focus border on `--ms-accent`.
- Toggles are simple rows with the label on the left and native checkbox on the right using `accent-color: var(--ms-accent)`.

## Sections, Stats, And Legends

- Section headers are uppercase 10px labels with `9px 12px 5px` padding.
- Stats should be small inset cells using `--ms-bg-input`, `--ms-divider`, and `3px` radius, not plain text floating in the panel.
- Legends should use two columns when the panel is wide enough, one column on mobile.
- Repeated rows may use inset cells with subtle borders and hover border on `--ms-accent`.

## Buttons

- Buttons are uppercase, 10px, compact, and equal-width within rows.
- Primary action uses `border-color` and text color `--ms-accent`.
- Destructive action uses `--ms-danger`.
- Disabled buttons use `opacity: 0.35` and `cursor: not-allowed`.
- Hover only applies when not disabled.

## Responsive Rules

```css
@media (max-width: 560px) {
  .analysis-panel { left: 12px; top: 72px; width: calc(100vw - 24px); }
  .analysis-grid, .analysis-legend { grid-template-columns: 1fr; }
  .analysis-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

Use the widget's actual class prefix instead of `analysis-*`.

## Implementation Notes

- Keep styles injected once with a stable style element id.
- Prefer scoped class prefixes per engine to avoid leaking styles across widgets.
- Store behavior in TypeScript and keep CSS focused on layout, readability, and interaction states.
- Avoid nested cards. Use sections, grid fields, stat cells, and list rows instead.
