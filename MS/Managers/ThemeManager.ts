export type ThemeName = 'ops-dark' | 'night-vision' | 'sandstorm' | 'arctic' | 'sipr';

interface Theme {
  name: ThemeName;
  label: string;
  vars: Record<string, string>;
}

export const THEMES: Theme[] = [
  {
    name: 'ops-dark',
    label: 'Ops Dark',
    vars: {
      '--ms-bg':         'rgba(14, 17, 26, 0.97)',
      '--ms-bg-header':  'rgba(40, 80, 140, 0.10)',
      '--ms-bg-input':   'rgba(255, 255, 255, 0.05)',
      '--ms-border':     'rgba(64, 140, 220, 0.35)',
      '--ms-accent':     '#64b4ff',
      '--ms-accent-dim': '#378add',
      '--ms-success':    '#4caf50',
      '--ms-danger':     '#e24b4a',
      '--ms-warning':    '#e5a540',
      '--ms-text':       '#b8c5d8',
      '--ms-text-dim':   '#5a6a80',
      '--ms-text-label': '#3a5070',
      '--ms-divider':    'rgba(255, 255, 255, 0.07)',
      '--ms-shadow':     '0 12px 40px rgba(0,0,0,0.65), inset 0 0 0 1px rgba(255,255,255,0.04)',
      '--ms-font':       "'SF Mono', 'Consolas', 'Courier New', monospace",
      '--ms-fs':         '13.5px',
      '--ms-fs-sm':      '15px',
      '--ms-fs-xs':      '11.5px',
      '--ms-radius':     '9px',
      '--ms-scrollbar-track': 'rgba(0,0,0,0.18)',
      '--ms-scrollbar-thumb': 'linear-gradient(180deg, rgba(100,180,255,0.55), rgba(76,175,80,0.55))',
      '--ms-scrollbar-thumb-hover': 'linear-gradient(180deg, rgba(100,180,255,0.85), rgba(76,175,80,0.75))',
    },
  },
  {
    name: 'night-vision',
    label: 'Night Vision',
    vars: {
      '--ms-bg':         'rgba(0, 10, 2, 0.97)',
      '--ms-bg-header':  'rgba(0, 100, 30, 0.10)',
      '--ms-bg-input':   'rgba(0, 200, 60, 0.06)',
      '--ms-border':     'rgba(0, 180, 60, 0.40)',
      '--ms-accent':     '#00c840',
      '--ms-accent-dim': '#00943a',
      '--ms-success':    '#00ff50',
      '--ms-danger':     '#ff4444',
      '--ms-warning':    '#aaff00',
      '--ms-text':       '#80d890',
      '--ms-text-dim':   '#2a6a30',
      '--ms-text-label': '#1a4a20',
      '--ms-divider':    'rgba(0, 200, 60, 0.10)',
      '--ms-shadow':     '0 12px 40px rgba(0,0,0,0.80), inset 0 0 0 1px rgba(0,200,60,0.06)',
      '--ms-font':       "'SF Mono', 'Consolas', 'Courier New', monospace",
      '--ms-fs':         '13.5px',
      '--ms-fs-sm':      '15px',
      '--ms-fs-xs':      '11.5px',
      '--ms-radius':     '9px',
      '--ms-scrollbar-track': 'rgba(0,40,10,0.30)',
      '--ms-scrollbar-thumb': 'linear-gradient(180deg, rgba(0,200,60,0.55), rgba(170,255,0,0.45))',
      '--ms-scrollbar-thumb-hover': 'linear-gradient(180deg, rgba(0,200,60,0.85), rgba(170,255,0,0.75))',
    },
  },
  {
    name: 'sandstorm',
    label: 'Sandstorm',
    vars: {
      '--ms-bg':         'rgba(22, 18, 8, 0.97)',
      '--ms-bg-header':  'rgba(180, 140, 60, 0.08)',
      '--ms-bg-input':   'rgba(200, 160, 60, 0.06)',
      '--ms-border':     'rgba(200, 160, 70, 0.40)',
      '--ms-accent':     '#d4a03c',
      '--ms-accent-dim': '#a87830',
      '--ms-success':    '#6abf6a',
      '--ms-danger':     '#c44030',
      '--ms-warning':    '#e8b420',
      '--ms-text':       '#d8c8a0',
      '--ms-text-dim':   '#8a7850',
      '--ms-text-label': '#6a5a30',
      '--ms-divider':    'rgba(200, 160, 60, 0.12)',
      '--ms-shadow':     '0 12px 40px rgba(0,0,0,0.70), inset 0 0 0 1px rgba(200,160,60,0.05)',
      '--ms-font':       "'SF Mono', 'Consolas', 'Courier New', monospace",
      '--ms-fs':         '13.5px',
      '--ms-fs-sm':      '15px',
      '--ms-fs-xs':      '11.5px',
      '--ms-radius':     '9px',
      '--ms-scrollbar-track': 'rgba(40,30,10,0.30)',
      '--ms-scrollbar-thumb': 'linear-gradient(180deg, rgba(212,160,60,0.55), rgba(232,180,32,0.55))',
      '--ms-scrollbar-thumb-hover': 'linear-gradient(180deg, rgba(212,160,60,0.85), rgba(232,180,32,0.75))',
    },
  },
  {
    name: 'arctic',
    label: 'Arctic',
    vars: {
      '--ms-bg':         'rgba(236, 242, 250, 0.97)',
      '--ms-bg-header':  'rgba(60, 120, 200, 0.07)',
      '--ms-bg-input':   'rgba(60, 120, 200, 0.07)',
      '--ms-border':     'rgba(60, 120, 200, 0.28)',
      '--ms-accent':     '#1a6fc4',
      '--ms-accent-dim': '#1258a0',
      '--ms-success':    '#2e8b57',
      '--ms-danger':     '#c0392b',
      '--ms-warning':    '#d48020',
      '--ms-text':       '#1a2a40',
      '--ms-text-dim':   '#4a6080',
      '--ms-text-label': '#7a90a8',
      '--ms-divider':    'rgba(60, 120, 200, 0.15)',
      '--ms-shadow':     '0 8px 28px rgba(0,0,0,0.20), inset 0 0 0 1px rgba(60,120,200,0.08)',
      '--ms-font':       "'SF Mono', 'Consolas', 'Courier New', monospace",
      '--ms-fs':         '13.5px',
      '--ms-fs-sm':      '15px',
      '--ms-fs-xs':      '11.5px',
      '--ms-radius':     '9px',
      '--ms-scrollbar-track': 'rgba(60,120,200,0.12)',
      '--ms-scrollbar-thumb': 'linear-gradient(180deg, rgba(26,111,196,0.55), rgba(46,139,87,0.45))',
      '--ms-scrollbar-thumb-hover': 'linear-gradient(180deg, rgba(26,111,196,0.85), rgba(46,139,87,0.75))',
    },
  },
  {
    name: 'sipr',
    label: 'SIPR Red',
    vars: {
      '--ms-bg':         'rgba(18, 4, 4, 0.97)',
      '--ms-bg-header':  'rgba(180, 30, 30, 0.10)',
      '--ms-bg-input':   'rgba(200, 40, 40, 0.06)',
      '--ms-border':     'rgba(180, 40, 40, 0.45)',
      '--ms-accent':     '#c84040',
      '--ms-accent-dim': '#a03030',
      '--ms-success':    '#5a9a60',
      '--ms-danger':     '#ff2020',
      '--ms-warning':    '#e08020',
      '--ms-text':       '#d8a0a0',
      '--ms-text-dim':   '#804050',
      '--ms-text-label': '#602040',
      '--ms-divider':    'rgba(200, 50, 50, 0.12)',
      '--ms-shadow':     '0 12px 40px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(200,50,50,0.06)',
      '--ms-font':       "'SF Mono', 'Consolas', 'Courier New', monospace",
      '--ms-fs':         '13.5px',
      '--ms-fs-sm':      '15px',
      '--ms-fs-xs':      '11.5px',
      '--ms-radius':     '9px',
      '--ms-scrollbar-track': 'rgba(60,10,10,0.30)',
      '--ms-scrollbar-thumb': 'linear-gradient(180deg, rgba(200,64,64,0.55), rgba(224,128,32,0.45))',
      '--ms-scrollbar-thumb-hover': 'linear-gradient(180deg, rgba(200,64,64,0.85), rgba(224,128,32,0.75))',
    },
  },
];

class ThemeManager {
  private static _instance: ThemeManager;
  private _styleEl: HTMLStyleElement | null = null;
  private _current: ThemeName = 'ops-dark';

  private constructor() {}

  public static getInstance(): ThemeManager {
    if (!ThemeManager._instance) {
      ThemeManager._instance = new ThemeManager();
    }
    return ThemeManager._instance;
  }

  public get currentTheme(): ThemeName { return this._current; }

  public get themeNames(): { name: ThemeName; label: string }[] {
    return THEMES.map(t => ({ name: t.name, label: t.label }));
  }

  /** Apply a named theme to the entire UI by injecting CSS custom-property overrides on :root. */
  public setTheme(name: ThemeName): void {
    const theme = THEMES.find(t => t.name === name);
    if (!theme) { console.warn('[ThemeManager] Unknown theme:', name); return; }

    this._current = name;

    if (!this._styleEl) {
      this._styleEl = document.createElement('style');
      this._styleEl.id = 'ms-theme-vars';
      document.head.appendChild(this._styleEl);
    }

    const rules = Object.entries(theme.vars)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');

    this._styleEl.textContent = `:root {\n${rules}\n}`;

    document.documentElement.setAttribute('data-ms-theme', name);
    document.dispatchEvent(new CustomEvent('ms-theme-changed', { detail: { theme: name } }));
  }

  /** Bootstrap: inject the default (ops-dark) theme + the global panel-scrollbar rule. */
  public init(name: ThemeName = 'ops-dark'): void {
    this.setTheme(name);
    this._injectGlobalScrollbarStyles();
  }

  /**
   * Inject a one-shot stylesheet that themes scrollbars on every engine widget.
   * Selectors are limited to known panel class/id prefixes so we don't disturb
   * ArcGIS widgets or the rest of the app.
   */
  private _injectGlobalScrollbarStyles(): void {
    if (document.getElementById('ms-global-scrollbar-styles')) return;
    const style = document.createElement('style');
    style.id = 'ms-global-scrollbar-styles';
    style.textContent = `
      .peaks-panel, .ocoka-left-panel, .ocoka-right-panel, .wez-panel,
      #deploymentBuilderWidget, .kt-panel, .kti-panel, .dg-panel, .dgm-panel,
      .mp-panel, .opr-panel, .flight-panel, .uav-panel, .traj-panel,
      [class*="-panel"][class*="ms-"], [class*="-widget"][class*="ms-"],
      .peaks-panel *, .ocoka-left-panel *, .ocoka-right-panel *, .wez-panel *,
      #deploymentBuilderWidget *, .kt-panel *, .kti-panel *, .dg-panel *, .dgm-panel *,
      .mp-panel *, .opr-panel *, .flight-panel *, .uav-panel *, .traj-panel * {
        scrollbar-width: thin;
        scrollbar-color: var(--ms-accent, #64b4ff) var(--ms-scrollbar-track, rgba(0,0,0,0.18));
      }
      .peaks-panel ::-webkit-scrollbar,
      .ocoka-left-panel ::-webkit-scrollbar,
      .ocoka-right-panel ::-webkit-scrollbar,
      .wez-panel ::-webkit-scrollbar,
      #deploymentBuilderWidget ::-webkit-scrollbar,
      .kt-panel ::-webkit-scrollbar, .kti-panel ::-webkit-scrollbar,
      .dg-panel ::-webkit-scrollbar, .dgm-panel ::-webkit-scrollbar,
      .mp-panel ::-webkit-scrollbar, .opr-panel ::-webkit-scrollbar,
      .flight-panel ::-webkit-scrollbar, .uav-panel ::-webkit-scrollbar,
      .traj-panel ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .peaks-panel ::-webkit-scrollbar-track,
      .ocoka-left-panel ::-webkit-scrollbar-track,
      .ocoka-right-panel ::-webkit-scrollbar-track,
      .wez-panel ::-webkit-scrollbar-track,
      #deploymentBuilderWidget ::-webkit-scrollbar-track,
      .kt-panel ::-webkit-scrollbar-track, .kti-panel ::-webkit-scrollbar-track,
      .dg-panel ::-webkit-scrollbar-track, .dgm-panel ::-webkit-scrollbar-track,
      .mp-panel ::-webkit-scrollbar-track, .opr-panel ::-webkit-scrollbar-track,
      .flight-panel ::-webkit-scrollbar-track, .uav-panel ::-webkit-scrollbar-track,
      .traj-panel ::-webkit-scrollbar-track {
        background: var(--ms-scrollbar-track, rgba(0,0,0,0.18));
        border-radius: 3px;
      }
      .peaks-panel ::-webkit-scrollbar-thumb,
      .ocoka-left-panel ::-webkit-scrollbar-thumb,
      .ocoka-right-panel ::-webkit-scrollbar-thumb,
      .wez-panel ::-webkit-scrollbar-thumb,
      #deploymentBuilderWidget ::-webkit-scrollbar-thumb,
      .kt-panel ::-webkit-scrollbar-thumb, .kti-panel ::-webkit-scrollbar-thumb,
      .dg-panel ::-webkit-scrollbar-thumb, .dgm-panel ::-webkit-scrollbar-thumb,
      .mp-panel ::-webkit-scrollbar-thumb, .opr-panel ::-webkit-scrollbar-thumb,
      .flight-panel ::-webkit-scrollbar-thumb, .uav-panel ::-webkit-scrollbar-thumb,
      .traj-panel ::-webkit-scrollbar-thumb {
        background: var(--ms-scrollbar-thumb, var(--ms-accent, #64b4ff));
        border-radius: 3px;
        border: 1px solid rgba(0,0,0,0.25);
      }
      .peaks-panel ::-webkit-scrollbar-thumb:hover,
      .ocoka-left-panel ::-webkit-scrollbar-thumb:hover,
      .ocoka-right-panel ::-webkit-scrollbar-thumb:hover,
      .wez-panel ::-webkit-scrollbar-thumb:hover,
      #deploymentBuilderWidget ::-webkit-scrollbar-thumb:hover,
      .kt-panel ::-webkit-scrollbar-thumb:hover, .kti-panel ::-webkit-scrollbar-thumb:hover,
      .dg-panel ::-webkit-scrollbar-thumb:hover, .dgm-panel ::-webkit-scrollbar-thumb:hover,
      .mp-panel ::-webkit-scrollbar-thumb:hover, .opr-panel ::-webkit-scrollbar-thumb:hover,
      .flight-panel ::-webkit-scrollbar-thumb:hover, .uav-panel ::-webkit-scrollbar-thumb:hover,
      .traj-panel ::-webkit-scrollbar-thumb:hover {
        background: var(--ms-scrollbar-thumb-hover, var(--ms-accent, #64b4ff));
      }
      .peaks-panel ::-webkit-scrollbar-corner,
      .ocoka-left-panel ::-webkit-scrollbar-corner,
      .ocoka-right-panel ::-webkit-scrollbar-corner,
      .wez-panel ::-webkit-scrollbar-corner,
      #deploymentBuilderWidget ::-webkit-scrollbar-corner,
      .kt-panel ::-webkit-scrollbar-corner, .kti-panel ::-webkit-scrollbar-corner,
      .dg-panel ::-webkit-scrollbar-corner, .dgm-panel ::-webkit-scrollbar-corner,
      .mp-panel ::-webkit-scrollbar-corner, .opr-panel ::-webkit-scrollbar-corner,
      .flight-panel ::-webkit-scrollbar-corner, .uav-panel ::-webkit-scrollbar-corner,
      .traj-panel ::-webkit-scrollbar-corner {
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }
}

export default ThemeManager;
