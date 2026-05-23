import Graphic from '@arcgis/core/Graphic';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

import GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
import Amplifier from '../../Support/Amplifier';
import DrawEssentials from '../../Support/DrawEssentials';
import symbolData from '../../Data/Symbols.json';

type ViewLike = MapView | SceneView;

type SymbolDefinition = {
  Class?: string;
  Name?: string;
  SymGeoType?: string;
  Description?: string;
  Parameters?: Array<Record<string, any>>;
  Tools?: Array<Record<string, any>>;
  [key: string]: any;
};

export interface MorphixEditedState {
  sidc: string;
  symbolKey: string;
  symbolDefinition: SymbolDefinition;
  amplifier: Amplifier;
  drawEssentials: DrawEssentials;
  attributes: Record<string, any>;
}

interface MorphixCallbacks {
  applyEdit: (graphic: Graphic, editedState: MorphixEditedState) => Graphic | null;
}

const SYMBOLS = symbolData as Record<string, SymbolDefinition>;

// ──────────────────────────────────────────────────────────────────────────────
// SIDC lookup tables (MIL-STD-2525D, aligned with milsymbol.net combos)

type Option = { value: string; label: string };

const SIDC_VERSION: Option[] = [
  { value: '1', label: '1 — MIL-STD-2525D' },
  { value: '2', label: '2 — APP-6D' },
  { value: '3', label: '3 — 2525E (draft)' },
];

const SIDC_CONTEXT: Option[] = [
  { value: '0', label: '0 — Reality' },
  { value: '1', label: '1 — Exercise' },
  { value: '2', label: '2 — Simulation' },
];

const SIDC_IDENTITY: Option[] = [
  { value: '00', label: '00 — Pending' },
  { value: '01', label: '01 — Unknown' },
  { value: '02', label: '02 — Assumed Friend' },
  { value: '03', label: '03 — Friend' },
  { value: '04', label: '04 — Neutral' },
  { value: '05', label: '05 — Suspect / Joker' },
  { value: '06', label: '06 — Hostile / Faker' },
];

const SIDC_SET: Option[] = [
  { value: '00', label: '00 — Unknown' },
  { value: '01', label: '01 — Air' },
  { value: '02', label: '02 — Air Missile' },
  { value: '05', label: '05 — Space' },
  { value: '06', label: '06 — Space Missile' },
  { value: '10', label: '10 — Land Unit' },
  { value: '11', label: '11 — Land Civilian Unit/Org' },
  { value: '15', label: '15 — Land Equipment' },
  { value: '20', label: '20 — Land Installations' },
  { value: '25', label: '25 — Control Measures' },
  { value: '27', label: '27 — Dismounted Individual' },
  { value: '30', label: '30 — Sea Surface' },
  { value: '35', label: '35 — Sea Subsurface' },
  { value: '36', label: '36 — Mine Warfare' },
  { value: '40', label: '40 — Activities / Events' },
  { value: '50', label: '50 — Cyberspace' },
];

const SIDC_STATUS: Option[] = [
  { value: '0', label: '0 — Present' },
  { value: '1', label: '1 — Planned / Anticipated' },
  { value: '2', label: '2 — Present / Fully Capable' },
  { value: '3', label: '3 — Present / Damaged' },
  { value: '4', label: '4 — Present / Destroyed' },
  { value: '5', label: '5 — Present / Full to Capacity' },
];

const SIDC_HQTF: Option[] = [
  { value: '0', label: '0 — Not applicable' },
  { value: '1', label: '1 — Feint / Dummy' },
  { value: '2', label: '2 — Headquarters' },
  { value: '3', label: '3 — Feint / Dummy HQ' },
  { value: '4', label: '4 — Task Force' },
  { value: '5', label: '5 — Feint / Dummy Task Force' },
  { value: '6', label: '6 — Task Force HQ' },
  { value: '7', label: '7 — Feint / Dummy TF HQ' },
];

const SIDC_ECHELON: Option[] = [
  { value: '00', label: '00 — None / Unknown' },
  { value: '11', label: '11 — Team / Crew' },
  { value: '12', label: '12 — Squad' },
  { value: '13', label: '13 — Section' },
  { value: '14', label: '14 — Platoon / Detachment' },
  { value: '15', label: '15 — Company / Battery / Troop' },
  { value: '16', label: '16 — Battalion / Squadron' },
  { value: '17', label: '17 — Regiment / Group' },
  { value: '18', label: '18 — Brigade' },
  { value: '21', label: '21 — Division' },
  { value: '22', label: '22 — Corps / MEF' },
  { value: '23', label: '23 — Army' },
  { value: '24', label: '24 — Army Group / Front' },
  { value: '25', label: '25 — Region / Theater' },
  { value: '26', label: '26 — Command' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Editable field tables

type FieldType = 'number' | 'text' | 'bool';

const AMPLIFIER_FIELDS: Array<[string, string]> = [
  ['UNIQUE_DESIG',      'Unique Desig'],
  ['HIGHER_FORM',       'Higher Formation'],
  ['STAFF_COM',         'Staff Comments'],
  ['ADDL_INFO',         'Addl Information'],
  ['DTG',               'DTG'],
  ['EDTG',              'EDTG'],
  ['ALTITUDE_DEPTH',    'Altitude / Depth'],
  ['LOC',               'Location'],
  ['DISTANCE',          'Distance'],
  ['AZIMUTH',           'Azimuth'],
  ['TYPE',              'Type'],
  ['QUANTITY',          'Quantity'],
  ['COUNTRY',           'Country'],
  ['TARGET_DESIGNATOR', 'Target Designator'],
];

const DRAW_FIELDS_COMMON: Array<[string, string, FieldType]> = [
  ['SIZE',    'Size',    'number'],
  ['opacity', 'Opacity', 'number'],
];

const DRAW_FIELDS_POINT: Array<[string, string, FieldType]> = [
  ['ANGLE',  'Angle (°)', 'number'],
  ['OFFSET', 'Offset',    'text'],
];

const DRAW_FIELDS_LINEAREA: Array<[string, string, FieldType]> = [
  ['DRAW_TYPE',          'Draw Type',            'number'],
  ['IS_OBS',             'Is Observation',       'number'],
  ['ARROWHEAD_RATIO',    'Arrowhead Ratio',      'number'],
  ['BK_LN_DIST_RATIO',   'Back Line Dist Ratio', 'number'],
  ['BK_LN_ANGL_RATIO',   'Back Line Angl Ratio', 'number'],
  ['FRNT_LN_DIST_RATIO', 'Front Line Dist Ratio','number'],
  ['FRNT_LN_ANGL_RATIO', 'Front Line Angl Ratio','number'],
  ['FLAP_DIST_RATIO',    'Flap Dist Ratio',      'number'],
  ['FLAP_ANGLE',         'Flap Angle',           'number'],
  ['ISFHAND',            'Freehand',             'bool'],
];

const LABEL_FIELDS: Array<[string, string, 'number' | 'color' | 'bool']> = [
  ['textSize',      'Text Size',     'number'],
  ['haloColorSize', 'Halo Size',     'number'],
  ['color',         'Text Color',    'color'],
  ['haloColor',     'Halo Color',    'color'],
  ['bold',          'Bold',          'bool'],
  ['italic',        'Italic',        'bool'],
  ['uLine',         'Underline',     'bool'],
  ['oLine',         'Overline',      'bool'],
  ['tLine',         'Strikethrough', 'bool'],
];

const EXTRA_FIELDS: Array<[string, string]> = [
  ['lineWidth', 'Line Width'],
  ['size',      'Marker Size'],
  ['textSize',  'Text Size'],
  ['opacity',   'Opacity'],
];

// ──────────────────────────────────────────────────────────────────────────────
// State

interface EditableState {
  graphic: Graphic;
  sidc: string;
  symbolKey: string;
  geomFamily: 'point' | 'line' | 'area' | '';
  /** Geometry refs kept aside — never JSON-cloned, re-attached on save. */
  geomRefs: { GEOM?: any; CTRL_PTS?: any[] };
  amplifier: Record<string, any>;
  drawEssentials: Record<string, any>;
  labelOptions: Record<string, any>;
  extraSettings: Record<string, any>;
  cim: Record<string, any>;
  jsonOpen: boolean;
}

interface FocusInfo {
  kind: string;
  group?: string;
  key?: string;
  start?: string;
  selectionStart?: number;
  selectionEnd?: number;
}

class MorphixEngine {
  private callbacks: MorphixCallbacks | null = null;
  private root: HTMLDivElement | null = null;
  private state: EditableState | null = null;
  private originalSnapshot: string = '';
  private symbolFilter: string = '';
  private focusInfo: FocusInfo | null = null;
  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);

  public initialize(
    view: ViewLike,
    layerManager: GraphicsLayerManager,
    callbacks: MorphixCallbacks,
  ): void {
    void view;
    void layerManager;
    this.callbacks = callbacks;
    this.ensureRoot();
  }

  public open(graphic: Graphic): void {
    this.ensureRoot();
    this.state = this.buildState(graphic);
    this.originalSnapshot = JSON.stringify(this.serialize(this.state));
    document.addEventListener('keydown', this.keydownHandler);
    this.render();
  }

  public destroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    this.root?.remove();
    this.root = null;
    this.state = null;
    this.focusInfo = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // State

  private ensureRoot(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.id = 'morphix-root';
    root.className = 'ms-theme-ops-dark';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '4000',
      display: 'none',
      background: 'color-mix(in oklch, #0a0e15, transparent 30%)',
      fontFamily: 'var(--ms-font)',
      color: 'var(--ms-text)',
    } as CSSStyleDeclaration);
    document.body.appendChild(root);
    this.root = root;
  }

  private buildState(graphic: Graphic): EditableState {
    const attrs = (graphic.attributes || {}) as Record<string, any>;
    const de = (attrs.drawEssentials || {}) as Record<string, any>;
    const ampSource =
      (de.AMPLIFIER && typeof de.AMPLIFIER === 'object'
        ? de.AMPLIFIER
        : (attrs.amplifier as Record<string, any>) || {}) as Record<string, any>;

    const sidc = this.normalizeSidc(
      ampSource.SIDC || de.SIDC || attrs.sidc || '',
      de.SID,
    );
    const symbolKey = this.getSymbolKey(sidc);
    const def = SYMBOLS[symbolKey];

    // Stash geometry refs — these must survive untouched through the editor
    const geomRefs: EditableState['geomRefs'] = {};
    if (de.GEOM) geomRefs.GEOM = de.GEOM;
    if (Array.isArray(de.CTRL_PTS)) geomRefs.CTRL_PTS = de.CTRL_PTS;

    // Amplifier — known fields first, then any extra payload the symbol carried
    const amplifier: Record<string, any> = { SIDC: sidc };
    for (const [k] of AMPLIFIER_FIELDS) amplifier[k] = ampSource[k] ?? '';
    for (const k of Object.keys(ampSource)) {
      if (!(k in amplifier)) amplifier[k] = this.jsonClone(ampSource[k]);
    }

    // DrawEssentials — JSON-clone the saved metadata; strip geometry, AMPLIFIER, and nested groups
    const drawEssentials = this.jsonClone(de) as Record<string, any>;
    delete drawEssentials.GEOM;
    delete drawEssentials.CTRL_PTS;
    delete drawEssentials.AMPLIFIER;
    delete drawEssentials.labelOptions;
    delete drawEssentials.extraSettings;
    delete drawEssentials.cim;

    drawEssentials.SIDC = sidc;
    drawEssentials.SID = sidc.slice(10, 16);
    drawEssentials.SYM_NAME = def?.Name || de.SYM_NAME || '';
    drawEssentials.SYM_GEO_TYPE = def?.SymGeoType || de.SYM_GEO_TYPE || '';
    drawEssentials.ECHELON = de.ECHELON ?? sidc.slice(8, 10);

    const defaults = new DrawEssentials();
    const family = this.geomFamilyOf(def?.SymGeoType || de.SYM_GEO_TYPE);

    return {
      graphic,
      sidc,
      symbolKey,
      geomFamily: family,
      geomRefs,
      amplifier,
      drawEssentials,
      labelOptions: this.jsonClone(de.labelOptions || defaults.labelOptions),
      extraSettings: this.jsonClone(de.extraSettings || defaults.extraSettings),
      cim: this.jsonClone(de.cim || {}),
      jsonOpen: false,
    };
  }

  private serialize(s: EditableState): unknown {
    return {
      sidc: s.sidc,
      symbolKey: s.symbolKey,
      amplifier: s.amplifier,
      drawEssentials: s.drawEssentials,
      labelOptions: s.labelOptions,
      extraSettings: s.extraSettings,
      cim: s.cim,
    };
  }

  private parseSnapshot(): {
    sidc: string;
    symbolKey: string;
    amplifier: Record<string, any>;
    drawEssentials: Record<string, any>;
    labelOptions: Record<string, any>;
    extraSettings: Record<string, any>;
    cim: Record<string, any>;
  } {
    return JSON.parse(this.originalSnapshot);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Render

  private render(): void {
    if (!this.root || !this.state) return;
    this.snapshotFocus();
    this.root.style.display = 'block';

    const s = this.state;
    const def = SYMBOLS[s.symbolKey];
    const errors = this.validate(s);
    const isValid = errors.length === 0;
    const isDirty =
      JSON.stringify(this.serialize(s)) !== this.originalSnapshot;

    const modalStyle = [
      'position:absolute',
      'top:4vh',
      'left:50%',
      'transform:translateX(-50%)',
      'width:min(980px, calc(100vw - 32px))',
      'max-height:92vh',
      'background:var(--ms-bg)',
      'border:1px solid var(--ms-border)',
      'border-radius:var(--ms-radius)',
      'box-shadow:var(--ms-shadow)',
      'display:flex',
      'flex-direction:column',
      'overflow:hidden',
      'font-size:var(--ms-fs)',
    ].join(';');

    this.root.innerHTML = `
      <div data-action="cancel" style="position:absolute;inset:0;"></div>
      <section role="dialog" aria-modal="true" aria-label="Symbol editor" style="${modalStyle}">
        ${this.renderHeader(def)}
        <div class="ms-body" style="flex:1;overflow:auto;padding:0 0 12px;max-height:none;">
          ${this.renderIdentitySection(def)}
          ${this.renderSidcSection()}
          ${this.renderSymbolSwapSection(def)}
          ${this.renderAmplifierSection()}
          ${this.renderDrawSection(def)}
          ${this.renderLabelSection()}
          ${this.renderExtraSection()}
          ${this.renderCimSection()}
          ${this.renderJsonSection()}
        </div>
        ${this.renderFooter(errors, isValid, isDirty)}
      </section>
    `;

    this.wire();
    this.restoreFocus();
  }

  private renderHeader(def?: SymbolDefinition): string {
    const s = this.state!;
    return `
      <div class="ms-header" style="cursor:default;">
        <div class="ms-header-icon">MX</div>
        <div class="ms-header-title">Morphix · ${this.esc(def?.Name || s.drawEssentials.SYM_NAME || 'Symbol')}</div>
        <span class="ms-status-lbl">${this.esc(s.symbolKey || '?')}</span>
        <button class="ms-header-btn" type="button" data-action="cancel" title="Close (Esc)">×</button>
      </div>
    `;
  }

  private renderSection(title: string, body: string, resetAction?: string): string {
    const reset = resetAction
      ? `<button type="button" class="ms-btn" data-action="${resetAction}" style="margin-right:12px;padding:3px 9px;font-size:var(--ms-fs-xs);">Reset</button>`
      : '';
    return `
      <div style="display:flex;align-items:baseline;justify-content:space-between;">
        <div class="ms-section-title">${this.esc(title)}</div>
        ${reset}
      </div>
      ${body}
    `;
  }

  private renderIdentitySection(def?: SymbolDefinition): string {
    const s = this.state!;
    return this.renderSection('Identity', `
      <div class="ms-grid">
        <div class="ms-field">
          <span class="ms-label">Symbol Name</span>
          <input class="ms-input" type="text" disabled value="${this.esc(def?.Name || s.drawEssentials.SYM_NAME || '')}">
        </div>
        <div class="ms-field">
          <span class="ms-label">Geometry</span>
          <input class="ms-input" type="text" disabled value="${this.esc(this.geomLabel(def?.SymGeoType || s.drawEssentials.SYM_GEO_TYPE))}">
        </div>
      </div>
    `);
  }

  private renderSidcSection(): string {
    const s = this.state!;
    const padded = s.sidc.padEnd(20, '0');

    const seg = (start: number, end: number) => padded.slice(start, end);
    const combo = (label: string, hint: string, kind: string, value: string, options: Option[]) => `
      <div class="ms-field">
        <span class="ms-label" title="${this.esc(hint)}">${this.esc(label)}</span>
        <select class="ms-select" data-kind="${this.esc(kind)}">
          ${options
            .map((o) => `<option value="${this.esc(o.value)}" ${o.value === value ? 'selected' : ''}>${this.esc(o.label)}</option>`)
            .join('')}
          ${options.find((o) => o.value === value) ? '' : `<option value="${this.esc(value)}" selected>${this.esc(value)} — (custom)</option>`}
        </select>
      </div>
    `;

    const mod1 = seg(16, 18);
    const mod2 = seg(18, 20);

    return this.renderSection('SIDC', `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${combo('Version',   'Position 0 — symbology version',           'sidc-version',  seg(0, 1),  SIDC_VERSION)}
        ${combo('Context',   'Position 1 — reality / exercise / sim',    'sidc-context',  seg(1, 2),  SIDC_CONTEXT)}
        ${combo('Identity',  'Positions 2–3 — standard identity',        'sidc-identity', seg(2, 4),  SIDC_IDENTITY)}
        ${combo('Set',       'Positions 4–5 — symbol set',               'sidc-set',      seg(4, 6),  SIDC_SET)}
        ${combo('Status',    'Position 6 — operational status',          'sidc-status',   seg(6, 7),  SIDC_STATUS)}
        ${combo('HQ / TF',   'Position 7 — HQ / Task Force / Dummy',     'sidc-hqtf',     seg(7, 8),  SIDC_HQTF)}
        ${combo('Echelon',   'Positions 8–9 — amplifier / echelon',      'sidc-echelon',  seg(8, 10), SIDC_ECHELON)}
        <div class="ms-field">
          <span class="ms-label" title="Positions 16–17 — modifier 1">Modifier 1</span>
          <input class="ms-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
                 value="${this.esc(mod1)}" data-kind="sidc-mod1"
                 style="font-family:var(--ms-font-mono);text-align:center;">
        </div>
        <div class="ms-field">
          <span class="ms-label" title="Positions 18–19 — modifier 2">Modifier 2</span>
          <input class="ms-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
                 value="${this.esc(mod2)}" data-kind="sidc-mod2"
                 style="font-family:var(--ms-font-mono);text-align:center;">
        </div>
      </div>
      <div class="ms-grid full">
        <div class="ms-field">
          <span class="ms-label">SIDC (read-only)</span>
          <input class="ms-input" type="text" disabled value="${this.esc(s.sidc)}"
                 style="font-family:var(--ms-font-mono);letter-spacing:1px;color:var(--ms-accent);">
        </div>
      </div>
    `);
  }

  private renderSymbolSwapSection(def?: SymbolDefinition): string {
    const s = this.state!;

    // Lines and areas use a fixed SymbolEngine class — swapping changes rendering wholesale.
    // Restrict swap to point symbols, like milsymbol.net.
    if (s.geomFamily !== 'point') {
      return this.renderSection('Symbol Swap', `
        <div class="ms-status warning" style="margin:6px 12px 0;">
          Symbol swap is disabled for ${this.esc(this.geomLabel(s.drawEssentials.SYM_GEO_TYPE))} graphics.
          Edit the SIDC <em>amplifier</em>, <em>echelon</em>, <em>status</em>, and other fields above instead.
        </div>
        <div class="ms-hint">
          Class: ${this.esc(def?.Class || '—')} ·
          Key: ${this.esc(s.symbolKey)} ·
          Name: ${this.esc(def?.Name || s.drawEssentials.SYM_NAME || '—')}
        </div>
      `);
    }

    const filter = this.symbolFilter.trim().toLowerCase();
    const filtered = Object.entries(SYMBOLS).filter(([key, d]) => {
      if (this.geomFamilyOf(d.SymGeoType) !== 'point') return false;
      if (!filter) return true;
      return (
        key.toLowerCase().includes(filter) ||
        (d.Name || '').toLowerCase().includes(filter) ||
        (d.Class || '').toLowerCase().includes(filter)
      );
    });

    filtered.sort((a, b) => (a[1].Name || a[0]).localeCompare(b[1].Name || b[0]));

    const limit = 800;
    const trimmed = filtered.slice(0, limit);
    const options = trimmed
      .map(([k, d]) => `<option value="${this.esc(k)}" ${k === s.symbolKey ? 'selected' : ''}>${this.esc(`${d.Name || k} · ${k}`)}</option>`)
      .join('');

    const more = filtered.length > limit
      ? ` <span style="opacity:.6">(first ${limit} of ${filtered.length})</span>`
      : '';

    return this.renderSection('Symbol Swap', `
      <div class="ms-grid">
        <div class="ms-field">
          <span class="ms-label">Search</span>
          <input class="ms-input" type="search" placeholder="Filter by name, class or key"
                 value="${this.esc(this.symbolFilter)}" data-kind="symbol-filter">
        </div>
        <div class="ms-field">
          <span class="ms-label">Symbol (${filtered.length} match${filtered.length === 1 ? '' : 'es'})${more}</span>
          <select class="ms-select" data-kind="symbol-key">${options}</select>
        </div>
      </div>
      <div class="ms-hint">
        Class: ${this.esc(def?.Class || '—')} ·
        Geometry: ${this.esc(this.geomLabel(def?.SymGeoType))}
        ${def?.Description ? ' · ' + this.esc(def.Description) : ''}
      </div>
    `);
  }

  private renderAmplifierSection(): string {
    const s = this.state!;
    const cells = AMPLIFIER_FIELDS
      .map(([k, l]) => this.textField('amplifier', k, l, s.amplifier[k], 'text'))
      .join('');
    return this.renderSection('Amplifiers', `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${cells}
      </div>
    `, 'reset-amplifiers');
  }

  private renderDrawSection(def?: SymbolDefinition): string {
    const s = this.state!;
    const family = this.geomFamilyOf(def?.SymGeoType || s.drawEssentials.SYM_GEO_TYPE);

    const fields: Array<[string, string, FieldType]> = [
      ...DRAW_FIELDS_COMMON,
      ...(family === 'point' ? DRAW_FIELDS_POINT : []),
      ...(family === 'line' || family === 'area' ? DRAW_FIELDS_LINEAREA : []),
    ];

    const cells = fields.map(([k, l, t]) => {
      if (t === 'bool') return this.boolField('drawEssentials', k, l, s.drawEssentials[k]);
      return this.textField('drawEssentials', k, l, s.drawEssentials[k], t);
    }).join('');

    return this.renderSection('Draw Settings', `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${cells}
      </div>
      ${this.renderParameters(def)}
    `, 'reset-draw');
  }

  private renderParameters(def?: SymbolDefinition): string {
    const params = def?.Parameters || [];
    const tools = def?.Tools || [];
    if (!params.length && !tools.length) return '';

    const chip = (text: string) =>
      `<span style="display:inline-block;margin:3px 4px 0 0;padding:2px 8px;border-radius:999px;background:var(--ms-bg-input);border:1px solid var(--ms-border);font-size:var(--ms-fs-xs);">${this.esc(text)}</span>`;

    const chips = (arr: Array<Record<string, any>>) =>
      arr.map((it) => chip(it.Name || it.value || JSON.stringify(it))).join('');

    return `
      <div class="ms-hint" style="padding-top:8px;line-height:1.7;">
        ${params.length ? `<div><strong>Parameters:</strong> ${chips(params)}</div>` : ''}
        ${tools.length ? `<div style="margin-top:4px;"><strong>Tools:</strong> ${chips(tools)}</div>` : ''}
      </div>
    `;
  }

  private renderLabelSection(): string {
    const s = this.state!;
    const cells = LABEL_FIELDS.map(([k, l, t]) => {
      if (t === 'color') return this.colorField('labelOptions', k, l, s.labelOptions[k]);
      if (t === 'bool') return this.boolField('labelOptions', k, l, s.labelOptions[k]);
      return this.textField('labelOptions', k, l, s.labelOptions[k], 'number');
    }).join('');

    return this.renderSection('Label Options', `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${cells}
      </div>
    `, 'reset-labels');
  }

  private renderExtraSection(): string {
    const s = this.state!;
    const cells = EXTRA_FIELDS
      .map(([k, l]) => this.textField('extraSettings', k, l, s.extraSettings[k], 'number'))
      .join('');
    return this.renderSection('Style Controls', `
      <div class="ms-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">
        ${cells}
      </div>
    `);
  }

  private renderCimSection(): string {
    const s = this.state!;
    const keys = Object.keys(s.cim);
    if (!keys.length) return '';
    const cells = keys.map((k) => this.textField('cim', k, k, s.cim[k], 'text')).join('');
    return this.renderSection('CIM (Cartographic Info Model)', `
      <div class="ms-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));">
        ${cells}
      </div>
    `);
  }

  private renderJsonSection(): string {
    const open = this.state!.jsonOpen;
    return `
      <div style="display:flex;align-items:baseline;justify-content:space-between;">
        <div class="ms-section-title">Advanced JSON</div>
        <button type="button" class="ms-btn" data-action="toggle-json" style="margin-right:12px;padding:3px 9px;font-size:var(--ms-fs-xs);">${open ? 'Hide' : 'Show'}</button>
      </div>
      ${open
        ? `<div class="ms-grid full"><textarea class="ms-input" readonly rows="14" style="font-family:var(--ms-font-mono);min-height:240px;resize:vertical;">${this.esc(JSON.stringify(this.serialize(this.state!), null, 2))}</textarea></div>`
        : ''}
    `;
  }

  private renderFooter(errors: string[], isValid: boolean, isDirty: boolean): string {
    const message = isValid
      ? (isDirty ? 'Ready to save.' : 'No changes yet.')
      : errors.map((e) => this.esc(e)).join(' · ');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--ms-bg-header);border-top:1px solid var(--ms-divider);">
        <div style="font-size:var(--ms-fs-xs);color:${isValid ? 'var(--ms-text-dim)' : 'var(--ms-danger)'};line-height:1.5;flex:1;min-width:0;">
          ${message}
        </div>
        <div style="display:flex;gap:6px;">
          <button type="button" class="ms-btn" data-action="cancel">Cancel</button>
          <button type="button" class="ms-btn primary" data-action="save" ${isValid && isDirty ? '' : 'disabled'}>Save</button>
        </div>
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Field builders

  private textField(group: string, key: string, label: string, value: any, type: FieldType): string {
    const v = value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(label)}</span>
        <input class="ms-input" type="text"
               data-kind="value" data-group="${this.esc(group)}" data-key="${this.esc(key)}"
               data-type="${this.esc(type)}"
               value="${this.esc(v)}">
      </div>
    `;
  }

  private boolField(group: string, key: string, label: string, value: any): string {
    const checked = !!value && value !== 0 && value !== '0' && value !== '';
    return `
      <div class="ms-toggle-row" style="padding:6px 0;">
        <label>${this.esc(label)}</label>
        <input type="checkbox" data-kind="value-bool" data-group="${this.esc(group)}" data-key="${this.esc(key)}" ${checked ? 'checked' : ''}>
      </div>
    `;
  }

  private colorField(group: string, key: string, label: string, value: any): string {
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(label)}</span>
        <input class="ms-input" type="color" data-kind="value-color"
               data-group="${this.esc(group)}" data-key="${this.esc(key)}"
               value="${this.esc(this.rgbToHex(value))}"
               style="height:32px;padding:2px;cursor:pointer;">
      </div>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Event wiring

  private wire(): void {
    if (!this.root) return;
    this.root.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => this.onAction(e));
    });
    this.root.querySelectorAll('input, select, textarea').forEach((el) => {
      const target = el as HTMLInputElement | HTMLSelectElement;
      const kind = (target as HTMLInputElement).dataset.kind;
      if (!kind) return;
      const liveKinds = new Set(['symbol-filter']);
      const eventName = liveKinds.has(kind) ? 'input' : 'change';
      target.addEventListener(eventName, (e) => this.onInput(e));
    });
  }

  private onInput(event: Event): void {
    if (!this.state) return;
    const t = event.target as HTMLInputElement;
    const kind = t.dataset.kind;

    switch (kind) {
      case 'symbol-filter':
        this.symbolFilter = t.value;
        this.render();
        return;

      case 'symbol-key':
        this.applySymbolKey(t.value);
        this.render();
        return;

      case 'sidc-version':  this.setSidcRange(0,  1,  t.value); this.render(); return;
      case 'sidc-context':  this.setSidcRange(1,  2,  t.value); this.render(); return;
      case 'sidc-identity': this.setSidcRange(2,  4,  t.value); this.render(); return;
      case 'sidc-set':      this.setSidcRange(4,  6,  t.value); this.render(); return;
      case 'sidc-status':   this.setSidcRange(6,  7,  t.value); this.render(); return;
      case 'sidc-hqtf':     this.setSidcRange(7,  8,  t.value); this.render(); return;
      case 'sidc-echelon':  this.setSidcRange(8,  10, t.value); this.render(); return;
      case 'sidc-mod1':     this.setSidcRange(16, 18, t.value); this.render(); return;
      case 'sidc-mod2':     this.setSidcRange(18, 20, t.value); this.render(); return;

      case 'value': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        const type = (t.dataset.type as FieldType) || 'text';
        (this.state as any)[group][key] = this.coerce(t.value, type);
        if (group === 'amplifier' && key === 'SIDC') {
          this.applySidc(String(t.value), true);
        }
        this.render();
        return;
      }

      case 'value-bool': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        (this.state as any)[group][key] = t.checked ? 1 : 0;
        this.render();
        return;
      }

      case 'value-color': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        (this.state as any)[group][key] = this.hexToRgb(t.value);
        this.render();
        return;
      }
    }
  }

  private onAction(event: Event): void {
    const t = event.currentTarget as HTMLElement;
    const action = t.dataset.action;
    if (!action || !this.state) return;
    event.preventDefault();

    switch (action) {
      case 'cancel':
        this.close();
        return;
      case 'save':
        this.save();
        return;
      case 'reset-amplifiers':
        this.state.amplifier = this.parseSnapshot().amplifier;
        break;
      case 'reset-draw': {
        const snap = this.parseSnapshot();
        this.state.drawEssentials = snap.drawEssentials;
        this.state.sidc = snap.sidc;
        this.state.symbolKey = snap.symbolKey;
        break;
      }
      case 'reset-labels': {
        const snap = this.parseSnapshot();
        this.state.labelOptions = snap.labelOptions;
        this.state.extraSettings = snap.extraSettings;
        this.state.cim = snap.cim;
        break;
      }
      case 'toggle-json':
        this.state.jsonOpen = !this.state.jsonOpen;
        break;
    }
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.validate(this.state).length === 0) this.save();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Mutations

  private setSidcRange(start: number, end: number, raw: string): void {
    if (!this.state) return;
    const len = end - start;
    const seg = String(raw || '').replace(/\D/g, '').slice(0, len).padEnd(len, '0');
    const cur = this.state.sidc.padEnd(20, '0').split('');
    for (let i = 0; i < len; i++) cur[start + i] = seg[i];
    this.applySidc(cur.join(''), false);
  }

  private applySymbolKey(symbolKey: string): void {
    if (!this.state || !SYMBOLS[symbolKey]) return;
    const cur = this.state.sidc.padEnd(20, '0');
    // symbolKey is set(2) + entity(6) → slots [4-6] and [10-16]
    const next =
      cur.slice(0, 4) +
      symbolKey.slice(0, 2) +
      cur.slice(6, 10) +
      symbolKey.slice(2).padEnd(6, '0').slice(0, 6) +
      cur.slice(16, 20);
    this.applySidc(next, true);
  }

  private applySidc(rawSidc: string, sanitize: boolean): void {
    if (!this.state) return;
    const cleaned = sanitize
      ? rawSidc.replace(/\D/g, '').slice(0, 20)
      : rawSidc.slice(0, 20);
    const sidc = cleaned.padEnd(20, '0');

    const s = this.state;
    s.sidc = sidc;
    s.symbolKey = this.getSymbolKey(sidc);
    s.amplifier.SIDC = sidc;
    s.drawEssentials.SIDC = sidc;
    s.drawEssentials.SID = sidc.slice(10, 16);
    s.drawEssentials.ECHELON = sidc.slice(8, 10);

    const def = SYMBOLS[s.symbolKey];
    if (def) {
      s.drawEssentials.SYM_NAME = def.Name || '';
      s.drawEssentials.SYM_GEO_TYPE = def.SymGeoType || '';
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Validation & save

  private validate(s: EditableState): string[] {
    const errors: string[] = [];
    if (!/^\d{20}$/.test(s.sidc)) {
      errors.push('SIDC must be exactly 20 digits.');
    }
    if (!SYMBOLS[s.symbolKey]) {
      errors.push(`Unknown symbol key ${s.symbolKey || '(empty)'} — adjust SIDC Set/Entity.`);
    }

    // For non-point graphics, only refuse if SIDC was somehow swapped to a point family
    const newFamily = this.geomFamilyOf(SYMBOLS[s.symbolKey]?.SymGeoType);
    if (newFamily && newFamily !== s.geomFamily) {
      errors.push(`Cannot change a ${this.geomLabel(s.geomFamily)} symbol to a ${this.geomLabel(newFamily)} symbol.`);
    }
    return errors;
  }

  private save(): void {
    if (!this.state || !this.callbacks) return;
    if (this.validate(this.state).length) {
      this.render();
      return;
    }

    const s = this.state;
    const def = SYMBOLS[s.symbolKey];

    const amplifier = new Amplifier(undefined, this.jsonClone(s.amplifier) as Partial<Amplifier>);
    amplifier.SIDC = s.sidc;

    const drawEssentials = new DrawEssentials(
      this.jsonClone(s.drawEssentials) as Partial<DrawEssentials>,
    );
    drawEssentials.SIDC = s.sidc;
    drawEssentials.SID = s.sidc.slice(10, 16);
    drawEssentials.SYM_NAME = def?.Name || drawEssentials.SYM_NAME;
    drawEssentials.SYM_GEO_TYPE = def?.SymGeoType || drawEssentials.SYM_GEO_TYPE;
    drawEssentials.ECHELON = s.sidc.slice(8, 10);
    drawEssentials.labelOptions = this.jsonClone(s.labelOptions) as any;
    drawEssentials.extraSettings = this.jsonClone(s.extraSettings) as any;
    if (Object.keys(s.cim).length) {
      drawEssentials.cim = this.jsonClone(s.cim);
    }

    // CRITICAL: re-attach the original ArcGIS geometry refs — JSON-cloning these
    // would strip the .clone() / .toJSON() methods downstream renderers depend on.
    if (s.geomRefs.GEOM) {
      drawEssentials.GEOM = this.cloneGeometry(s.geomRefs.GEOM);
    }
    if (s.geomRefs.CTRL_PTS) {
      (drawEssentials as any).CTRL_PTS = s.geomRefs.CTRL_PTS.map((p) => this.cloneGeometry(p));
    }
    (drawEssentials as any).AMPLIFIER = amplifier;

    const oldAttrs = (s.graphic.attributes || {}) as Record<string, any>;
    const editedState: MorphixEditedState = {
      sidc: s.sidc,
      symbolKey: s.symbolKey,
      symbolDefinition: def!,
      amplifier,
      drawEssentials,
      attributes: {
        ...oldAttrs,
        sidc: s.sidc,
        drawEssentials,
      },
    };

    try {
      this.callbacks.applyEdit(s.graphic, editedState);
      this.close();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MorphixEngine] applyEdit failed:', err);
      this.render();
    }
  }

  private close(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    if (this.root) {
      this.root.style.display = 'none';
      this.root.innerHTML = '';
    }
    this.state = null;
    this.symbolFilter = '';
    this.focusInfo = null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Focus restoration

  private snapshotFocus(): void {
    const el = document.activeElement as HTMLInputElement | null;
    if (!el || !this.root?.contains(el) || !el.dataset.kind) {
      this.focusInfo = null;
      return;
    }
    this.focusInfo = {
      kind: el.dataset.kind,
      group: el.dataset.group,
      key: el.dataset.key,
      start: el.dataset.start,
      selectionStart: el.selectionStart ?? undefined,
      selectionEnd: el.selectionEnd ?? undefined,
    };
  }

  private restoreFocus(): void {
    if (!this.focusInfo || !this.root) return;
    const { kind, group, key, start, selectionStart, selectionEnd } = this.focusInfo;
    let selector = `[data-kind="${kind}"]`;
    if (group) selector += `[data-group="${group}"]`;
    if (key) selector += `[data-key="${key}"]`;
    if (start) selector += `[data-start="${start}"]`;
    const el = this.root.querySelector(selector) as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
      try {
        el.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        /* color/checkbox/select etc. don't support setSelectionRange */
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Utilities

  private normalizeSidc(sidc: string, sid?: string): string {
    const digits = String(sidc || '').replace(/\D/g, '');
    if (digits.length >= 20) return digits.slice(0, 20);
    if (digits.length > 0) return digits.padEnd(20, '0');
    const key = sid
      ? Object.keys(SYMBOLS).find((k) => k.slice(2, 8) === sid)
      : undefined;
    return key
      ? `1003${key.slice(0, 2)}0000${key.slice(2).padEnd(6, '0')}0000`
      : '10000000000000000000';
  }

  private getSymbolKey(sidc: string): string {
    const padded = sidc.padEnd(20, '0');
    return `${padded.slice(4, 6)}${padded.slice(10, 16)}`;
  }

  private geomFamilyOf(value?: string): 'point' | 'line' | 'area' | '' {
    const v = String(value || '').toLowerCase();
    if (v === 'point' || v === 'fpoint') return 'point';
    if (v === 'line' || v === 'polyline') return 'line';
    if (v === 'area' || v === 'polygon') return 'area';
    return '';
  }

  private geomLabel(value?: string): string {
    const f = this.geomFamilyOf(value);
    if (f === 'point') return 'Point';
    if (f === 'line') return 'Line';
    if (f === 'area') return 'Area';
    return value || '—';
  }

  /** Plain JSON clone — for amplifier/draw/label/extra/cim fields only. Never use on ArcGIS geometry. */
  private jsonClone<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.jsonClone(v)) as any;
    const out: Record<string, any> = {};
    for (const k of Object.keys(value as any)) {
      const v = (value as any)[k];
      if (typeof v === 'function') continue;
      out[k] = this.jsonClone(v);
    }
    return out as T;
  }

  /** Preserve ArcGIS geometry instances by calling their .clone() when available. */
  private cloneGeometry(value: any): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'object' && typeof value.clone === 'function') return value.clone();
    return this.jsonClone(value);
  }

  private coerce(value: string, type: FieldType): any {
    const t = value.trim();
    if (t === '') return type === 'number' ? '' : '';
    if (type === 'number') {
      const n = Number(t);
      return Number.isFinite(n) ? n : value;
    }
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (
      (t.startsWith('[') && t.endsWith(']')) ||
      (t.startsWith('{') && t.endsWith('}'))
    ) {
      try {
        return JSON.parse(t);
      } catch {
        /* fall through */
      }
    }
    return value;
  }

  private esc(value: string | undefined | null): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private rgbToHex(value: any): string {
    if (Array.isArray(value) && value.length >= 3) {
      const [r, g, b] = value;
      const toHex = (n: number) =>
        Math.max(0, Math.min(255, Math.round(Number(n) || 0)))
          .toString(16)
          .padStart(2, '0');
      return '#' + toHex(r) + toHex(g) + toHex(b);
    }
    if (typeof value === 'string') {
      const m = /^#?([0-9a-f]{6})$/i.exec(value);
      if (m) return '#' + m[1];
    }
    return '#000000';
  }

  private hexToRgb(hex: string): number[] {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m
      ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
      : [0, 0, 0];
  }
}

export default MorphixEngine;
