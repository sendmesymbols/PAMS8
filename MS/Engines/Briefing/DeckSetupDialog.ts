/**
 * DeckSetupDialog.ts
 *
 * Deck-level setup, from inside the slide editor: slide size, page numbers,
 * the classification/footer master, theme fonts, document properties, and the
 * current slide's section.
 *
 * Why here and not only in the ⚙ settings widget: every one of these is a
 * decision an author makes WHILE building the deck, and the answer is visible
 * on the slide in front of them (a banner takes height off the map; a slide
 * size changes the aspect; a section groups the slide they are on). Sending
 * them out to a settings panel to change the paper they are drawing on is the
 * wrong shape. The widget stays as the exhaustive list; this is the working set.
 *
 * Everything except the section writes through SettingsBus, i.e. the same
 * `settingsChanged` event the legacy Settings panel and the Briefing menu use,
 * so `settingsData` remains the single source of truth and the other surfaces
 * pick the change up with no coupling to this dialog. There is no Apply: edits
 * land immediately, because they are settings rather than a form.
 *
 * Built the same way SlideLinkDialog and ChartDialog are — own DOM, own
 * injected stylesheet, no framework.
 */

import { getSetting, setSetting } from '../../Support/SettingsBus';
import { SAFE_FONTS } from './OverlayStyle';
import { CHROME_TOKENS, type DeckChrome } from './SlideChrome';

export interface DeckSetupDialogOptions {
  /** 1-based number of the slide being edited, for the Section field's label. */
  slideNumber: number;
  /** Current slide's section, or ''. */
  section: string;
  /** Every section title already used in the briefing — offered as suggestions. */
  knownSections: readonly string[];
  /** Commit a section change ('' removes the slide from any section). */
  onSection(section: string): void;
  /**
   * The deck's own chrome fields — only what an author has set. Absent fields
   * fall back to the `exportTools.*` settings, which is what the Header & footer
   * pane shows in that case. See SlideChrome.resolveChrome.
   */
  chrome?: DeckChrome;
  /**
   * Commit a chrome change. '' clears a field back to the settings default.
   * Absent = the host has no deck to write to, and the pane writes to the
   * settings instead (the pre-document behaviour).
   */
  onChrome?(patch: Partial<DeckChrome>): void;
  /** This slide opts out of the deck's chrome — Slide.noChrome. */
  noChrome?: boolean;
  /** Flip that opt-out. Absent = the checkbox is not offered. */
  onNoChrome?(value: boolean): void;
  /** Open the exhaustive PPTX Export settings widget instead. */
  onOpenSettings(): void;
  /** Run the export now, with whatever is set here. */
  onExport(): void;
}

/**
 * Common US/NATO markings, offered as suggestions rather than a fixed list —
 * the field stays free text because caveats and releasability markings are
 * effectively unbounded. Colour is derived from the marking by the exporter,
 * so these only have to be spelled the standard way to be coloured correctly.
 */
const CLASSIFICATION_PRESETS: readonly string[] = [
  'UNCLASSIFIED',
  'UNCLASSIFIED//FOUO',
  'CUI',
  'CONFIDENTIAL',
  'RESTRICTED',
  'SECRET',
  'SECRET//NOFORN',
  'SECRET//REL TO USA, NATO',
  'TOP SECRET',
  'TOP SECRET//SCI',
];

const LAYOUTS: ReadonlyArray<[string, string]> = [
  ['16x9', '16:9 — 10 × 5.63 in'],
  ['16x10', '16:10 — 10 × 6.25 in'],
  ['4x3', '4:3 — 10 × 7.5 in'],
  ['wide', 'Widescreen — 13.3 × 7.5 in'],
  ['custom', 'Custom…'],
];

type TabKey = 'deck' | 'master' | 'theme' | 'props';

const TABS: ReadonlyArray<[TabKey, string]> = [
  ['deck', 'Deck'],
  // Was 'Master' — the pane stopped being about the PPTX slide master when the
  // strips started being drawn on the canvas and in present mode too.
  ['master', 'Header / footer'],
  ['theme', 'Theme'],
  ['props', 'Properties'],
];

function esc(s: string): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/** `exportTools.<key>` with a fallback, read live from the settings tree. */
function cfg<T>(key: string, fallback: T): T {
  const v = getSetting<T>(['exportTools', key]);
  return v === undefined || v === null || (v as unknown) === '' ? fallback : v;
}

function put(key: string, value: unknown): void {
  setSetting(['exportTools', key], value);
}

export default class DeckSetupDialog {
  private _el: HTMLElement | null = null;
  private _opts: DeckSetupDialogOptions | null = null;
  private _onKey: ((e: KeyboardEvent) => void) | null = null;
  /** Remembered across opens — an author returning to the dialog wants the tab they left on. */
  private _tab: TabKey = 'deck';

  public get isOpen(): boolean {
    return !!this._el;
  }

  public show(stage: HTMLElement, opts: DeckSetupDialogOptions): void {
    this.hide();
    this._injectStyles();
    this._opts = opts;

    // Chrome fields read the DECK first and the `exportTools.*` settings only as
    // a fallback — the same precedence SlideChrome.resolveChrome applies, so the
    // pane always shows what will actually be drawn. `tx` for text and select
    // values, `ch` for checkboxes (which need a real boolean, not a truthy string).
    const deck = opts.chrome ?? {};
    const tx = <T extends string>(field: keyof DeckChrome, key: string, fallback: T): T => {
      const own = deck[field];
      return own === undefined || own === null || own === '' ? cfg<T>(key, fallback) : (own as T);
    };
    const ch = (field: keyof DeckChrome, key: string, fallback: boolean): boolean => {
      const own = deck[field];
      return own === undefined || own === null ? cfg<boolean>(key, fallback) === true : own === true;
    };
    const ofM = tx<string>('numberFormat', 'numberFormat', 'n') === 'n-of-m';

    const fontOptions = (selected: string): string =>
      [
        `<option value=""${selected ? '' : ' selected'}>(PowerPoint default)</option>`,
        ...SAFE_FONTS.map(
          (f) =>
            `<option value="${esc(f)}"${f === selected ? ' selected' : ''}>${esc(f)}</option>`,
        ),
      ].join('');

    const el = document.createElement('div');
    el.className = 'ms-deck-wrap';
    el.innerHTML = `
      <div class="ms-deck" role="dialog" aria-label="Deck setup">
        <div class="ms-deck-head">
          <span class="ms-deck-title">Deck setup</span>
          <span class="ms-deck-sub">Applies to the whole exported deck</span>
          <button class="ms-deck-x" title="Close (Esc)">✕</button>
        </div>
        <div class="ms-deck-tabs">
          ${TABS.map(
            ([k, label]) =>
              `<button data-tab="${k}" class="${k === this._tab ? 'active' : ''}">${label}</button>`,
          ).join('')}
        </div>

        <div class="ms-deck-body">
          <section data-pane="deck">
            <p class="ms-deck-export-only">
              This tab affects the exported .pptx only — slide size, export mode
              and packaging are not things the editor canvas can show. The
              Header / footer tab is different: what you set there is drawn on
              the slide behind this dialog and in the slideshow as well.
            </p>
            <label class="ms-deck-row">
              <span>Slide size</span>
              <select class="ms-deck-layout">
                ${LAYOUTS.map(
                  ([v, label]) =>
                    `<option value="${v}"${
                      v === cfg<string>('layout', '16x9') ? ' selected' : ''
                    }>${esc(label)}</option>`,
                ).join('')}
              </select>
            </label>
            <div class="ms-deck-custom">
              <label class="ms-deck-row">
                <span>Width (px)</span>
                <input type="number" class="ms-deck-w" min="96" max="5376" step="16"
                       value="${cfg('deckWidth', 1280)}">
              </label>
              <label class="ms-deck-row">
                <span>Height (px)</span>
                <input type="number" class="ms-deck-h" min="96" max="5376" step="16"
                       value="${cfg('deckHeight', 720)}">
              </label>
              <p class="ms-deck-hint">Read at 96 DPI — 1280 × 720 is the same as Widescreen.</p>
            </div>
            <label class="ms-deck-row">
              <span>Export mode</span>
              <select class="ms-deck-mode">
                <option value="flat"${
                  cfg<string>('mode', 'flat') !== 'editable' ? ' selected' : ''
                }>Flat screenshots</option>
                <option value="editable"${
                  cfg<string>('mode', 'flat') === 'editable' ? ' selected' : ''
                }>Editable shapes</option>
              </select>
            </label>
            <label class="ms-deck-row">
              <span>Image format</span>
              <select class="ms-deck-format">
                <option value="png"${
                  cfg<string>('format', 'png') !== 'jpeg' ? ' selected' : ''
                }>PNG (lossless)</option>
                <option value="jpeg"${
                  cfg<string>('format', 'png') === 'jpeg' ? ' selected' : ''
                }>JPEG (smaller)</option>
              </select>
            </label>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-compress"${
                cfg('compress', false) ? ' checked' : ''
              }>
              <span>Compress package<em>Helps most with editable-shape decks; screenshots barely shrink</em></span>
            </label>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-builds"${
                cfg('explodeBuilds', false) ? ' checked' : ''
              }>
              <span>Explode builds<em>One extra slide per staged reveal</em></span>
            </label>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-notes"${
                cfg('includeNotes', true) ? ' checked' : ''
              }>
              <span>Include speaker notes</span>
            </label>
          </section>

          <section data-pane="master">
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-usemaster"${
                ch('enabled', 'useMaster', false) ? ' checked' : ''
              }>
              <span>Header &amp; footer<em>Draws the strips on the slide behind this dialog, in the slideshow, and in the exported .pptx</em></span>
            </label>
            <label class="ms-deck-row">
              <span>Classification</span>
              <input type="text" class="ms-deck-class" list="ms-deck-classlist" maxlength="120"
                     placeholder="Blank = no banner" value="${esc(
                       tx('classification', 'classification', ''),
                     )}">
            </label>
            <datalist id="ms-deck-classlist">
              ${CLASSIFICATION_PRESETS.map((c) => `<option value="${esc(c)}"></option>`).join('')}
            </datalist>
            <p class="ms-deck-hint">
              Drawn top and bottom. The strip colour follows the marking —
              UNCLASSIFIED green, CONFIDENTIAL/RESTRICTED blue, SECRET red,
              TOP SECRET orange, CUI purple.
            </p>
            <label class="ms-deck-row">
              <span>Header</span>
              <input type="text" class="ms-deck-header" maxlength="200"
                     placeholder="e.g. {SECTION}" value="${esc(
                       tx('headerText', 'headerText', ''),
                     )}">
            </label>
            <label class="ms-deck-row">
              <span>Footer</span>
              <input type="text" class="ms-deck-footer" maxlength="200"
                     placeholder="e.g. 1 Bde · {DTG}" value="${esc(
                       tx('footerText', 'footerText', ''),
                     )}">
            </label>
            <p class="ms-deck-hint">
              Tokens: ${CHROME_TOKENS.map((t) => `<code>${esc(t)}</code>`).join(' ')}
            </p>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-numbers"${
                ch('slideNumbers', 'slideNumbers', false) ? ' checked' : ''
              }>
              <span>Slide numbers<em>Stamped at the right end of the footer strip</em></span>
            </label>
            <label class="ms-deck-row">
              <span>Number style</span>
              <select class="ms-deck-numfmt">
                <option value="n"${ofM ? '' : ' selected'}>7</option>
                <option value="n-of-m"${ofM ? ' selected' : ''}>7 / 24</option>
              </select>
            </label>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-skipfirst"${
                ch('skipFirst', 'skipFirst', false) ? ' checked' : ''
              }>
              <span>Not on the title slide<em>Leaves slide 1 bare, PowerPoint's own default</em></span>
            </label>
            <p class="ms-deck-note">
              The strips take height off the slide, so the map is fitted between
              them — the editor canvas shrinks to match what gets exported.
            </p>
          </section>

          <section data-pane="theme">
            <label class="ms-deck-row">
              <span>Heading font</span>
              <select class="ms-deck-headfont">${fontOptions(cfg('headFont', ''))}</select>
            </label>
            <label class="ms-deck-row">
              <span>Body font</span>
              <select class="ms-deck-bodyfont">${fontOptions(cfg('bodyFont', ''))}</select>
            </label>
            <p class="ms-deck-hint">
              Only fonts that ship with Office on both Windows and macOS are
              listed — anything else substitutes on the recipient's machine.
              Leave as default to let their PowerPoint theme decide.
            </p>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-scheme"${
                cfg('useSchemeColors', false) ? ' checked' : ''
              }>
              <span>Theme-aware chrome<em>Title/footer/page numbers follow the recipient's theme. Your annotation colours and the classification banner never change.</em></span>
            </label>
            <label class="ms-deck-check">
              <input type="checkbox" class="ms-deck-rtl"${cfg('rtl', false) ? ' checked' : ''}>
              <span>Right-to-left<em>Arabic, Hebrew, Farsi</em></span>
            </label>
          </section>

          <section data-pane="props">
            <p class="ms-deck-hint">
              Written into the file's document properties — PowerPoint shows
              them under File → Info.
            </p>
            <label class="ms-deck-row">
              <span>Title</span>
              <input type="text" class="ms-deck-doctitle" maxlength="200"
                     value="${esc(cfg('deckTitle', 'PAMS8 Briefing'))}">
            </label>
            <label class="ms-deck-row">
              <span>Author</span>
              <input type="text" class="ms-deck-author" maxlength="120"
                     value="${esc(cfg('author', ''))}">
            </label>
            <label class="ms-deck-row">
              <span>Company / unit</span>
              <input type="text" class="ms-deck-company" maxlength="120"
                     value="${esc(cfg('company', ''))}">
            </label>
            <label class="ms-deck-row">
              <span>Subject</span>
              <input type="text" class="ms-deck-subject" maxlength="200"
                     placeholder="Operation or exercise name" value="${esc(cfg('subject', ''))}">
            </label>
            <label class="ms-deck-row">
              <span>Revision</span>
              <input type="text" class="ms-deck-revision" maxlength="40"
                     value="${esc(cfg('revision', ''))}">
            </label>
          </section>
        </div>

        <div class="ms-deck-slide">
          <label class="ms-deck-row">
            <span>Section</span>
            <input type="text" class="ms-deck-section" list="ms-deck-sectlist" maxlength="120"
                   placeholder="Blank = no section" value="${esc(opts.section)}">
          </label>
          <datalist id="ms-deck-sectlist">
            ${opts.knownSections.map((s) => `<option value="${esc(s)}"></option>`).join('')}
          </datalist>
          <p class="ms-deck-hint">
            Groups slide ${opts.slideNumber} in PowerPoint's section navigator.
            Consecutive slides sharing a name form one section — e.g. the
            five-paragraph OPORD.
          </p>
          ${
            opts.onNoChrome
              ? `<label class="ms-deck-check">
                   <input type="checkbox" class="ms-deck-nochrome"${
                     opts.noChrome ? ' checked' : ''
                   }>
                   <span>No header or footer on this slide<em>Slide ${opts.slideNumber} fills the whole page. It keeps its number.</em></span>
                 </label>`
              : ''
          }
        </div>

        <div class="ms-deck-foot">
          <button class="ms-deck-more" type="button">All export settings…</button>
          <span class="ms-deck-spring"></span>
          <button class="ms-deck-export" type="button">Export PPTX</button>
          <button class="ms-deck-close primary" type="button">Done</button>
        </div>
      </div>`;
    stage.appendChild(el);
    this._el = el;
    this._wire();
    this._selectTab(this._tab);

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      }
    };
    el.addEventListener('keydown', this._onKey, true);
  }

  public hide(): void {
    if (this._el && this._onKey) this._el.removeEventListener('keydown', this._onKey, true);
    this._el?.remove();
    this._el = null;
    this._opts = null;
    this._onKey = null;
  }

  private _selectTab(tab: TabKey): void {
    const el = this._el;
    if (!el) return;
    this._tab = tab;
    el.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
    });
    el.querySelectorAll('[data-pane]').forEach((p) => {
      (p as HTMLElement).style.display =
        (p as HTMLElement).dataset.pane === tab ? 'flex' : 'none';
    });
  }

  private _wire(): void {
    const el = this._el;
    const opts = this._opts;
    if (!el || !opts) return;
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;

    el.querySelectorAll('[data-tab]').forEach((b) => {
      (b as HTMLElement).onclick = () => this._selectTab((b as HTMLElement).dataset.tab as TabKey);
    });
    q('.ms-deck-x').onclick = () => this.hide();
    q('.ms-deck-close').onclick = () => this.hide();
    q('.ms-deck-more').onclick = () => {
      this.hide();
      opts.onOpenSettings();
    };
    q('.ms-deck-export').onclick = () => {
      this.hide();
      opts.onExport();
    };

    // Custom width/height only mean anything for the 'custom' layout — hidden
    // otherwise rather than left enabled and inert.
    const layout = q<HTMLSelectElement>('.ms-deck-layout');
    const syncCustom = () => {
      q<HTMLElement>('.ms-deck-custom').style.display =
        layout.value === 'custom' ? 'block' : 'none';
    };
    layout.onchange = () => {
      put('layout', layout.value);
      syncCustom();
    };
    syncCustom();

    /** Number input → setting, clamped. */
    const num = (sel: string, key: string, lo: number, hi: number, dflt: number) => {
      const input = q<HTMLInputElement>(sel);
      input.onchange = () => {
        const v = Math.min(hi, Math.max(lo, Math.round(Number(input.value) || dflt)));
        input.value = String(v);
        put(key, v);
      };
    };
    num('.ms-deck-w', 'deckWidth', 96, 5376, 1280);
    num('.ms-deck-h', 'deckHeight', 96, 5376, 720);

    const pick = (sel: string, key: string) => {
      const s = q<HTMLSelectElement>(sel);
      s.onchange = () => put(key, s.value);
    };
    pick('.ms-deck-mode', 'mode');
    pick('.ms-deck-format', 'format');
    pick('.ms-deck-headfont', 'headFont');
    pick('.ms-deck-bodyfont', 'bodyFont');

    const check = (sel: string, key: string) => {
      const c = q<HTMLInputElement>(sel);
      c.onchange = () => put(key, c.checked);
    };
    check('.ms-deck-compress', 'compress');
    check('.ms-deck-builds', 'explodeBuilds');
    check('.ms-deck-notes', 'includeNotes');
    check('.ms-deck-scheme', 'useSchemeColors');
    check('.ms-deck-rtl', 'rtl');

    // ── Chrome fields ────────────────────────────────────────────────────────
    // These write to the DECK when the host offers somewhere to put them — a
    // briefing's classification belongs to the briefing, not to the app's global
    // export settings. Without a host they fall back to writing the settings,
    // which is what they always did.
    const chromeCheck = (sel: string, field: keyof DeckChrome, key: string) => {
      const c = q<HTMLInputElement>(sel);
      c.onchange = () => {
        if (opts.onChrome) opts.onChrome({ [field]: c.checked } as Partial<DeckChrome>);
        else put(key, c.checked);
      };
    };
    chromeCheck('.ms-deck-usemaster', 'enabled', 'useMaster');
    chromeCheck('.ms-deck-numbers', 'slideNumbers', 'slideNumbers');
    chromeCheck('.ms-deck-skipfirst', 'skipFirst', 'skipFirst');

    const chromeText = (sel: string, field: keyof DeckChrome, key: string) => {
      const input = q<HTMLInputElement>(sel);
      input.onchange = () => {
        const value = input.value.trim();
        if (opts.onChrome) opts.onChrome({ [field]: value } as Partial<DeckChrome>);
        else put(key, value);
      };
    };
    chromeText('.ms-deck-class', 'classification', 'classification');
    chromeText('.ms-deck-header', 'headerText', 'headerText');
    chromeText('.ms-deck-footer', 'footerText', 'footerText');

    const numfmt = q<HTMLSelectElement>('.ms-deck-numfmt');
    numfmt.onchange = () => {
      if (opts.onChrome) opts.onChrome({ numberFormat: numfmt.value as 'n' | 'n-of-m' });
      else put('numberFormat', numfmt.value);
    };

    // Text fields commit on blur/Enter rather than per keystroke — a settings
    // write per character would spam every listener on the bus.
    const text = (sel: string, key: string) => {
      const input = q<HTMLInputElement>(sel);
      input.onchange = () => put(key, input.value.trim());
    };
    text('.ms-deck-doctitle', 'deckTitle');
    text('.ms-deck-author', 'author');
    text('.ms-deck-company', 'company');
    text('.ms-deck-subject', 'subject');
    text('.ms-deck-revision', 'revision');

    // Section is per-slide, not a setting — it goes back through the host.
    const section = q<HTMLInputElement>('.ms-deck-section');
    section.onchange = () => opts.onSection(section.value.trim());

    // Per-slide, and only rendered when the host can accept it.
    const noChrome = el.querySelector('.ms-deck-nochrome') as HTMLInputElement | null;
    if (noChrome) noChrome.onchange = () => opts.onNoChrome?.(noChrome.checked);
  }

  private _injectStyles(): void {
    if (document.getElementById('ms-deck-style')) return;
    const style = document.createElement('style');
    style.id = 'ms-deck-style';
    style.textContent = `
      .ms-deck-wrap {
        position: absolute; inset: 0; z-index: 62;
        display: flex; align-items: center; justify-content: center;
        background: rgba(8,11,14,0.55);
      }
      .ms-deck {
        width: 470px; max-width: calc(100% - 32px); max-height: calc(100% - 40px);
        display: flex; flex-direction: column;
        background: rgba(24,29,35,0.99); border: 1px solid rgba(255,255,255,0.16);
        border-radius: 10px; box-shadow: 0 16px 44px rgba(0,0,0,0.55);
        font: 12px/1.45 system-ui, sans-serif; color: #dde3e8;
      }
      .ms-deck-head {
        display: flex; align-items: baseline; gap: 8px; padding: 9px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-deck-title { font-weight: 600; font-size: 13px; }
      .ms-deck-sub { color: #7d8894; font-size: 11px; flex: 1; }
      .ms-deck-x {
        background: none; border: none; color: #9aa6b2; cursor: pointer;
        font-size: 13px; padding: 2px 4px;
      }
      .ms-deck-x:hover { color: #fff; }
      .ms-deck-tabs {
        display: flex; gap: 2px; padding: 6px 8px 0;
        border-bottom: 1px solid rgba(255,255,255,0.12);
      }
      .ms-deck-tabs button {
        background: none; border: none; border-bottom: 2px solid transparent;
        color: #9aa6b2; cursor: pointer; font: inherit; padding: 5px 10px 6px;
      }
      .ms-deck-tabs button:hover { color: #dde3e8; }
      .ms-deck-tabs button.active { color: #fff; border-bottom-color: #2D6CDF; }
      .ms-deck-body { overflow: auto; }
      .ms-deck-body > section { flex-direction: column; gap: 8px; padding: 10px; }
      .ms-deck-row { display: flex; align-items: center; gap: 8px; }
      .ms-deck-row > span { width: 108px; color: #9aa6b2; flex: none; }
      .ms-deck-row input, .ms-deck-row select {
        flex: 1; min-width: 0; background: rgba(0,0,0,0.3); color: #dde3e8;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 4px 6px; font: inherit;
      }
      .ms-deck-row select { cursor: pointer; }
      .ms-deck-row option { background: #181d23; color: #dde3e8; }
      .ms-deck-check { display: flex; align-items: flex-start; gap: 7px; cursor: pointer; }
      .ms-deck-check input { margin-top: 2px; flex: none; }
      .ms-deck-check > span { display: flex; flex-direction: column; }
      .ms-deck-check em {
        color: #7d8894; font-style: normal; font-size: 11px; line-height: 1.35;
      }
      .ms-deck-hint { color: #7d8894; font-size: 11px; margin: 0; }
      .ms-deck-hint code {
        background: rgba(255,255,255,0.08); border-radius: 3px; padding: 0 3px;
        font: 10.5px ui-monospace, Consolas, monospace;
      }
      .ms-deck-note {
        color: #c9a227; font-size: 11px; margin: 0;
        border-left: 2px solid rgba(201,162,39,0.5); padding-left: 7px;
      }
      /* Answers "why did nothing change on my slide?" before it is asked. */
      .ms-deck-export-only {
        color: #9aa6b2; font-size: 11px; margin: 0 0 2px;
        background: rgba(45,108,223,0.12); border: 1px solid rgba(45,108,223,0.3);
        border-radius: 5px; padding: 6px 8px;
      }
      .ms-deck-custom { display: none; }
      .ms-deck-custom .ms-deck-row { margin-bottom: 8px; }
      .ms-deck-slide {
        padding: 10px; border-top: 1px solid rgba(255,255,255,0.12);
        display: flex; flex-direction: column; gap: 7px;
        background: rgba(255,255,255,0.02);
      }
      .ms-deck-foot {
        display: flex; align-items: center; gap: 8px; padding: 9px 10px;
        border-top: 1px solid rgba(255,255,255,0.12);
      }
      .ms-deck-spring { flex: 1; }
      .ms-deck-foot button {
        background: rgba(255,255,255,0.08); color: #dde3e8; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
        padding: 4px 12px; font: inherit;
      }
      .ms-deck-foot button:hover { background: rgba(255,255,255,0.14); }
      .ms-deck-more { color: #9aa6b2 !important; }
      .ms-deck-foot button.primary {
        background: #2D6CDF; border-color: #2D6CDF; color: #fff;
      }
      .ms-deck-foot button.primary:hover { background: #3d7cef; }
    `;
    document.head.appendChild(style);
  }
}
