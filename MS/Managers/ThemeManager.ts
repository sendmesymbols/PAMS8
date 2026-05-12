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
      '--ms-fs':         '12px',
      '--ms-fs-sm':      '10px',
      '--ms-fs-xs':      '9.5px',
      '--ms-radius':     '6px',
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
      '--ms-fs':         '12px',
      '--ms-fs-sm':      '10px',
      '--ms-fs-xs':      '9.5px',
      '--ms-radius':     '6px',
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
      '--ms-fs':         '12px',
      '--ms-fs-sm':      '10px',
      '--ms-fs-xs':      '9.5px',
      '--ms-radius':     '6px',
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
      '--ms-fs':         '12px',
      '--ms-fs-sm':      '10px',
      '--ms-fs-xs':      '9.5px',
      '--ms-radius':     '6px',
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
      '--ms-fs':         '12px',
      '--ms-fs-sm':      '10px',
      '--ms-fs-xs':      '9.5px',
      '--ms-radius':     '6px',
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

  /** Bootstrap: inject the default (ops-dark) theme on first load. */
  public init(name: ThemeName = 'ops-dark'): void {
    this.setTheme(name);
  }
}

export default ThemeManager;
