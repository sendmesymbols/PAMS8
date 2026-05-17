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
  Parameters?: Array<Record<string, any>>;
  Tools?: Array<Record<string, any>>;
  [key: string]: any;
};

interface MorphixCallbacks {
  applyEdit: (graphic: Graphic, editedState: MorphixEditedState) => Graphic | null;
}

export interface MorphixEditedState {
  sidc: string;
  symbolKey: string;
  symbolDefinition: SymbolDefinition;
  amplifier: Amplifier;
  drawEssentials: DrawEssentials;
  attributes: Record<string, any>;
}

interface MorphixState {
  graphic: Graphic;
  sidc: string;
  originalSidc: string;
  symbolKey: string;
  originalSymbolKey: string;
  amplifier: Record<string, any>;
  originalAmplifier: Record<string, any>;
  drawEssentials: Record<string, any>;
  originalDrawEssentials: Record<string, any>;
  labelOptions: Record<string, any>;
  originalLabelOptions: Record<string, any>;
  extraSettings: Record<string, any>;
  originalExtraSettings: Record<string, any>;
  cim: Record<string, any>;
  originalCim: Record<string, any>;
  selectedSymbolKey: string;
  errors: string[];
  jsonOpen: boolean;
}

const SYMBOLS = symbolData as Record<string, SymbolDefinition>;
const AMPLIFIER_KEYS = [
  'UNIQUE_DESIG',
  'HIGHER_FORM',
  'STAFF_COM',
  'ADDL_INFO',
  'DTG',
  'EDTG',
  'ALTITUDE_DEPTH',
  'LOC',
  'DISTANCE',
  'AZIMUTH',
  'TARGET_DESIGNATOR',
  'COUNTRY',
  'TYPE',
  'QUANTITY',
  'HOSTILE',
  'SIZE',
  'SIDC',
];
const DRAW_KEYS = [
  'DRAW_TYPE',
  'SIZE',
  'ECHELON',
  'OFFSET',
  'IS_OBS',
  'ARROWHEAD_RATIO',
  'BK_LN_DIST_RATIO',
  'BK_LN_ANGL_RATIO',
  'FRNT_LN_ANGL_RATIO',
  'FRNT_LN_DIST_RATIO',
  'FLAP_DIST_RATIO',
  'FLAP_ANGLE',
  'ISFHAND',
  'opacity',
  'uniqueDesignation',
  'infoFields',
];
const LABEL_KEYS = [
  'textSize',
  'color',
  'haloColor',
  'haloColorSize',
  'bold',
  'italic',
  'uLine',
  'oLine',
  'tLine',
];
const EXTRA_KEYS = ['lineWidth', 'size', 'textSize', 'opacity'];
const SIDC_SEGMENTS = [
  { label: 'Scheme', start: 0, end: 1 },
  { label: 'Identity', start: 1, end: 2 },
  { label: 'Prefix', start: 2, end: 4 },
  { label: 'Set', start: 4, end: 6 },
  { label: 'Status', start: 6, end: 7 },
  { label: 'HQ/TF/Dummy', start: 7, end: 8 },
  { label: 'Echelon/Amp', start: 8, end: 10 },
  { label: 'Entity', start: 10, end: 16 },
  { label: 'Modifier', start: 16, end: 20 },
];

class MorphixEngine {
  private callbacks: MorphixCallbacks | null = null;
  private root: HTMLDivElement | null = null;
  private state: MorphixState | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private keydownHandler = (event: KeyboardEvent) => this.handleKeyDown(event);

  public initialize(
    view: ViewLike,
    layerManager: GraphicsLayerManager,
    callbacks: MorphixCallbacks,
  ): void {
    void view;
    void layerManager;
    this.callbacks = callbacks;
    this.ensureRoot();
    this.ensureStyles();
  }

  public open(graphic: Graphic): void {
    this.ensureRoot();
    this.ensureStyles();
    this.state = this.createState(graphic);
    document.addEventListener('keydown', this.keydownHandler);
    this.render();
  }

  public destroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    this.root?.remove();
    this.styleElement?.remove();
    this.root = null;
    this.styleElement = null;
    this.state = null;
  }

  private createState(graphic: Graphic): MorphixState {
    const attrs = graphic.attributes || {};
    const de = attrs.drawEssentials || {};
    const ampSource = de.AMPLIFIER || attrs.amplifier || {};
    const sidc = this.normalizeSidc(
      ampSource.SIDC || de.SIDC || attrs.sidc || '',
      de.SID,
    );
    const symbolKey = this.getSymbolKey(sidc);
    const amplifier = {
      ...this.pickExistingKeys(ampSource, AMPLIFIER_KEYS),
      ...this.pickExtraKeys(ampSource, AMPLIFIER_KEYS),
      SIDC: sidc,
    };
    const drawEssentials = {
      ...this.cloneValue(de),
      SIDC: sidc,
      SID: sidc.slice(10, 16),
      SYM_NAME: SYMBOLS[symbolKey]?.Name || de.SYM_NAME || '',
      SYM_GEO_TYPE: this.displayGeometryFamily(SYMBOLS[symbolKey]?.SymGeoType || de.SYM_GEO_TYPE),
    };
    const labelOptions = this.cloneValue(de.labelOptions || new DrawEssentials().labelOptions);
    const extraSettings = this.cloneValue(de.extraSettings || new DrawEssentials().extraSettings);
    const cim = this.cloneValue(de.cim || {});

    return {
      graphic,
      sidc,
      originalSidc: sidc,
      symbolKey,
      originalSymbolKey: symbolKey,
      amplifier,
      originalAmplifier: this.cloneValue(amplifier),
      drawEssentials,
      originalDrawEssentials: this.cloneValue(drawEssentials),
      labelOptions,
      originalLabelOptions: this.cloneValue(labelOptions),
      extraSettings,
      originalExtraSettings: this.cloneValue(extraSettings),
      cim,
      originalCim: this.cloneValue(cim),
      selectedSymbolKey: symbolKey,
      errors: [],
      jsonOpen: false,
    };
  }

  private render(): void {
    if (!this.root || !this.state) return;
    this.state.errors = this.validateState(this.state);
    const attrs = this.state.graphic.attributes || {};
    const de = this.state.drawEssentials;
    const def = SYMBOLS[this.state.symbolKey];
    const isValid = this.state.errors.length === 0;

    this.root.innerHTML = `
      <div class="morphix-backdrop" data-action="cancel"></div>
      <section class="morphix-modal" role="dialog" aria-modal="true" aria-label="Symbol details editor">
        <header class="morphix-header">
          <div>
            <div class="morphix-kicker">Morphix</div>
            <h2>${this.escape(def?.Name || de.SYM_NAME || 'Symbol Details')}</h2>
          </div>
          <button class="morphix-icon-btn" type="button" data-action="cancel" title="Close">x</button>
        </header>
        <main class="morphix-body">
          ${this.renderSummary(attrs, def)}
          ${this.renderSymbolSwap()}
          ${this.renderSidc()}
          ${this.renderAmplifiers()}
          ${this.renderDrawSettings()}
          ${this.renderLabelSettings()}
          ${this.renderPreview()}
          ${this.renderAdvancedJson()}
        </main>
        <footer class="morphix-footer">
          <div class="morphix-validation ${isValid ? 'is-valid' : 'is-invalid'}">
            ${isValid ? 'Ready to save.' : this.state.errors.map((e) => `<div>${this.escape(e)}</div>`).join('')}
          </div>
          <div class="morphix-actions">
            <button type="button" class="morphix-btn" data-action="cancel">Cancel</button>
            <button type="button" class="morphix-btn morphix-primary" data-action="save" ${isValid ? '' : 'disabled'}>Save</button>
          </div>
        </footer>
      </section>
    `;

    this.root.querySelectorAll('input, select, textarea').forEach((el) => {
      el.addEventListener('input', (event) => this.handleInput(event));
      el.addEventListener('change', (event) => this.handleInput(event));
    });
    const symbolSelect = this.root.querySelector(
      'select[data-kind="symbol"]',
    ) as HTMLSelectElement | null;
    if (symbolSelect) symbolSelect.value = this.state.symbolKey;
    this.root.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (event) => this.handleAction(event));
    });
  }

  private renderSummary(attrs: Record<string, any>, def?: SymbolDefinition): string {
    const layerId = (this.state?.graphic.layer as any)?.id || 'Detached';
    const rows = [
      ['SID', this.state?.drawEssentials.SID || this.state?.sidc.slice(10, 16)],
      ['SYM_NAME', this.state?.drawEssentials.SYM_NAME || def?.Name],
      ['Geometry', this.displayGeometryFamily(def?.SymGeoType || this.state?.drawEssentials.SYM_GEO_TYPE)],
      ['Layer', layerId],
      ['Graphic ID', attrs.id || '(none)'],
      ['SIDC', this.state?.sidc],
    ];

    return `
      <section class="morphix-section morphix-summary">
        <div class="morphix-section-head"><h3>Current Symbol</h3></div>
        <dl>${rows
          .map(([label, value]) => `<div><dt>${this.escape(label || '')}</dt><dd>${this.escape(String(value || ''))}</dd></div>`)
          .join('')}</dl>
      </section>
    `;
  }

  private renderSymbolSwap(): string {
    const options = Object.entries(SYMBOLS)
      .sort((a, b) => (a[1].Name || '').localeCompare(b[1].Name || ''))
      .map(([key, def]) => `<option value="${this.escape(key)}">${this.escape(`${def.Name || key} (${key})`)}</option>`)
      .join('');

    const selectedDef = SYMBOLS[this.state!.selectedSymbolKey];
    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>Symbol Swap</h3>
        </div>
        <div class="morphix-grid morphix-grid-2">
          <label>Search
            <input type="search" data-field="symbolSearch" placeholder="Filter by name, class, or key" list="morphixSymbolKeys">
          </label>
          <label>Symbol
            <select data-field="symbolKey" data-kind="symbol">${options}</select>
          </label>
        </div>
        <datalist id="morphixSymbolKeys">${options}</datalist>
        <div class="morphix-meta">${this.escape(selectedDef?.Class || '')} · ${this.escape(this.displayGeometryFamily(selectedDef?.SymGeoType))}</div>
      </section>
    `;
  }

  private renderSidc(): string {
    const controls = SIDC_SEGMENTS.map((segment) => `
      <label>${this.escape(segment.label)}
        <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="${segment.end - segment.start}" value="${this.escape(this.state!.sidc.slice(segment.start, segment.end))}" data-kind="sidcSegment" data-start="${segment.start}" data-end="${segment.end}">
      </label>
    `).join('');

    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>SIDC</h3>
          <button type="button" class="morphix-link-btn" data-action="reset-sidc">Reset Section</button>
        </div>
        <div class="morphix-grid morphix-grid-3">${controls}</div>
        <label class="morphix-raw">Raw SIDC
          <input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="20" value="${this.escape(this.state!.sidc)}" data-kind="rawSidc">
        </label>
      </section>
    `;
  }

  private renderAmplifiers(): string {
    const amp = this.state!.amplifier;
    const keys = Array.from(new Set([...AMPLIFIER_KEYS, ...Object.keys(amp)]));
    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>Amplifiers</h3>
          <button type="button" class="morphix-link-btn" data-action="reset-amplifiers">Reset Section</button>
        </div>
        <div class="morphix-grid morphix-grid-3">
          ${keys.map((key) => this.renderValueInput('amplifier', key, amp[key])).join('')}
        </div>
      </section>
    `;
  }

  private renderDrawSettings(): string {
    const de = this.state!.drawEssentials;
    const def = SYMBOLS[this.state!.symbolKey];
    const keys = Array.from(new Set([...DRAW_KEYS, ...Object.keys(de).filter((key) => DRAW_KEYS.includes(key))]));
    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>Draw Settings</h3>
          <button type="button" class="morphix-link-btn" data-action="reset-draw">Reset Section</button>
        </div>
        <div class="morphix-grid morphix-grid-3">
          ${keys.map((key) => this.renderValueInput('drawEssentials', key, de[key])).join('')}
        </div>
        ${this.renderParameters(def)}
      </section>
    `;
  }

  private renderLabelSettings(): string {
    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>Labels And Style</h3>
          <button type="button" class="morphix-link-btn" data-action="reset-labels">Reset Section</button>
        </div>
        <div class="morphix-subhead">Label Options</div>
        <div class="morphix-grid morphix-grid-3">
          ${LABEL_KEYS.map((key) => this.renderValueInput('labelOptions', key, this.state!.labelOptions[key])).join('')}
        </div>
        <div class="morphix-subhead">Style Controls</div>
        <div class="morphix-grid morphix-grid-3">
          ${EXTRA_KEYS.map((key) => this.renderValueInput('extraSettings', key, this.state!.extraSettings[key])).join('')}
          ${Object.keys(this.state!.cim).map((key) => this.renderValueInput('cim', key, this.state!.cim[key])).join('')}
        </div>
      </section>
    `;
  }

  private renderPreview(): string {
    const def = SYMBOLS[this.state!.symbolKey];
    const labelParts = [
      this.state!.amplifier.UNIQUE_DESIG,
      this.state!.amplifier.HIGHER_FORM,
      this.state!.amplifier.DTG,
      this.state!.amplifier.ADDL_INFO,
    ].filter(Boolean);
    return `
      <section class="morphix-section morphix-preview">
        <div>
          <div class="morphix-subhead">Preview</div>
          <h3>${this.escape(def?.Name || 'Unresolved Symbol')}</h3>
          <p>${this.escape(this.displayGeometryFamily(def?.SymGeoType))}</p>
        </div>
        <div class="morphix-code">${this.escape(this.state!.sidc)}</div>
        <div class="morphix-label-preview">${this.escape(labelParts.join(' · ') || 'No label amplifier text')}</div>
      </section>
    `;
  }

  private renderAdvancedJson(): string {
    const open = this.state!.jsonOpen;
    const current = {
      drawEssentials: this.prepareJson(this.state!.drawEssentials),
      AMPLIFIER: this.prepareJson(this.state!.amplifier),
    };
    return `
      <section class="morphix-section">
        <div class="morphix-section-head">
          <h3>Advanced JSON</h3>
          <button type="button" class="morphix-link-btn" data-action="toggle-json">${open ? 'Hide' : 'Show'}</button>
        </div>
        ${open ? `<textarea readonly class="morphix-json">${this.escape(JSON.stringify(current, null, 2))}</textarea>` : ''}
      </section>
    `;
  }

  private renderParameters(def?: SymbolDefinition): string {
    const parameters = def?.Parameters || [];
    const tools = def?.Tools || [];
    if (!parameters.length && !tools.length) return '';
    return `
      <div class="morphix-params">
        ${parameters.length ? `<div><div class="morphix-subhead">Parameters</div>${parameters.map((p) => `<span>${this.escape(p.Name || p.value || '')}</span>`).join('')}</div>` : ''}
        ${tools.length ? `<div><div class="morphix-subhead">Tools</div>${tools.map((t) => `<span>${this.escape(t.Name || JSON.stringify(t))}</span>`).join('')}</div>` : ''}
      </div>
    `;
  }

  private renderValueInput(group: string, key: string, value: any): string {
    const isObject = value !== null && typeof value === 'object';
    const text = isObject ? JSON.stringify(this.prepareJson(value)) : value ?? '';
    return `
      <label>${this.escape(key)}
        <input type="text" value="${this.escape(String(text))}" data-kind="value" data-group="${this.escape(group)}" data-key="${this.escape(key)}">
      </label>
    `;
  }

  private handleInput(event: Event): void {
    if (!this.state) return;
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const kind = target.dataset.kind;

    if (target.dataset.field === 'symbolSearch') {
      this.applySymbolSearch(target.value);
      return;
    }

    if (kind === 'symbol') {
      this.applySymbolKey(target.value);
    } else if (kind === 'rawSidc') {
      this.applySidc(target.value, false);
    } else if (kind === 'sidcSegment') {
      const start = Number(target.dataset.start);
      const end = Number(target.dataset.end);
      const next = this.state.sidc.split('');
      const value = target.value.replace(/\D/g, '').padEnd(end - start, '0').slice(0, end - start);
      while (next.length < 20) next.push('0');
      next.splice(start, end - start, ...value.split(''));
      this.applySidc(next.join(''), true);
    } else if (kind === 'value') {
      const group = target.dataset.group!;
      const key = target.dataset.key!;
      (this.state as any)[group][key] = this.coerceValue(target.value);
      if (group === 'amplifier' && key === 'SIDC') this.applySidc(String(target.value), false);
    }
    this.render();
  }

  private handleAction(event: Event): void {
    const target = event.currentTarget as HTMLElement;
    const action = target.dataset.action;
    if (!action) return;
    event.preventDefault();

    if (action === 'cancel') this.close();
    else if (action === 'save') this.save();
    else if (action === 'reset-sidc') this.applySidc(this.state!.originalSidc, true);
    else if (action === 'reset-amplifiers') this.state!.amplifier = this.cloneValue(this.state!.originalAmplifier);
    else if (action === 'reset-draw') this.state!.drawEssentials = this.cloneValue(this.state!.originalDrawEssentials);
    else if (action === 'reset-labels') {
      this.state!.labelOptions = this.cloneValue(this.state!.originalLabelOptions);
      this.state!.extraSettings = this.cloneValue(this.state!.originalExtraSettings);
      this.state!.cim = this.cloneValue(this.state!.originalCim);
    } else if (action === 'toggle-json') this.state!.jsonOpen = !this.state!.jsonOpen;
    if (action !== 'cancel' && action !== 'save') this.render();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.validateState(this.state).length === 0) this.save();
    }
  }

  private save(): void {
    if (!this.state || !this.callbacks) return;
    const errors = this.validateState(this.state);
    if (errors.length) {
      this.state.errors = errors;
      this.render();
      return;
    }

    const def = SYMBOLS[this.state.symbolKey];
    const amplifier = new Amplifier(undefined, this.cloneValue(this.state.amplifier));
    amplifier.SIDC = this.state.sidc;

    const drawEssentials = new DrawEssentials(this.cloneValue(this.state.drawEssentials));
    drawEssentials.SIDC = this.state.sidc;
    drawEssentials.SID = this.state.sidc.slice(10, 16);
    drawEssentials.SYM_NAME = def?.Name || drawEssentials.SYM_NAME;
    drawEssentials.SYM_GEO_TYPE = this.displayGeometryFamily(def?.SymGeoType);
    drawEssentials.ECHELON = this.state.sidc.slice(8, 10);
    drawEssentials.labelOptions = this.cloneValue(this.state.labelOptions) as any;
    drawEssentials.extraSettings = this.cloneValue(this.state.extraSettings) as any;
    if (Object.keys(this.state.cim).length) drawEssentials.cim = this.cloneValue(this.state.cim);
    (drawEssentials as any).AMPLIFIER = amplifier;

    const attrs = this.state.graphic.attributes || {};
    const editedState: MorphixEditedState = {
      sidc: this.state.sidc,
      symbolKey: this.state.symbolKey,
      symbolDefinition: def,
      amplifier,
      drawEssentials,
      attributes: {
        ...attrs,
        id: attrs.id,
        symbolId: attrs.symbolId,
        sidc: this.state.sidc,
        drawEssentials,
      },
    };

    try {
      this.callbacks.applyEdit(this.state.graphic, editedState);
      this.close();
    } catch (error) {
      this.state.errors = [error instanceof Error ? error.message : String(error)];
      this.render();
    }
  }

  private applySymbolSearch(query: string): void {
    if (!this.state) return;
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = Object.entries(SYMBOLS).find(([key, def]) =>
      [key, def.Name, def.Class, def.Description].some((value) =>
        String(value || '').toLowerCase().includes(q),
      ),
    );
    if (match) this.applySymbolKey(match[0]);
  }

  private applySymbolKey(symbolKey: string): void {
    if (!this.state || !SYMBOLS[symbolKey]) return;
    const current = this.state.sidc.padEnd(20, '0');
    const nextSidc =
      current.slice(0, 4) +
      symbolKey.slice(0, 2) +
      current.slice(6, 10) +
      symbolKey.slice(2).padEnd(10, '0').slice(0, 10);
    this.state.selectedSymbolKey = symbolKey;
    this.applySidc(nextSidc, true);
  }

  private applySidc(rawSidc: string, sanitize: boolean): void {
    if (!this.state) return;
    const sidc = sanitize
      ? rawSidc.replace(/\D/g, '').slice(0, 20).padEnd(20, '0')
      : rawSidc.slice(0, 20);
    this.state.sidc = sidc;
    this.state.symbolKey = this.getSymbolKey(sidc);
    this.state.selectedSymbolKey = this.state.symbolKey;
    this.state.amplifier.SIDC = sidc;
    this.state.drawEssentials.SIDC = sidc;
    this.state.drawEssentials.SID = sidc.slice(10, 16);
    this.state.drawEssentials.ECHELON = sidc.slice(8, 10);
    const def = SYMBOLS[this.state.symbolKey];
    if (def) {
      this.state.drawEssentials.SYM_NAME = def.Name || '';
      this.state.drawEssentials.SYM_GEO_TYPE = this.displayGeometryFamily(def.SymGeoType);
    }
  }

  private validateState(state: MorphixState): string[] {
    const errors: string[] = [];
    if (!/^\d{20}$/.test(state.sidc)) errors.push('SIDC must be exactly 20 numeric characters.');
    const key = this.getSymbolKey(state.sidc);
    if (!SYMBOLS[key]) errors.push(`SIDC does not resolve to Symbols.json key ${key || '(empty)'}.`);

    const oldFamily = this.geometryFamily(
      SYMBOLS[state.originalSymbolKey]?.SymGeoType ||
        state.originalDrawEssentials.SYM_GEO_TYPE ||
        state.graphic.geometry?.type,
    );
    const newFamily = this.geometryFamily(SYMBOLS[key]?.SymGeoType);
    const hasPointGeometry = state.graphic.geometry?.type === 'point' || !!state.drawEssentials.GEOM;
    const hasControlGeometry =
      state.graphic.geometry?.type === 'polyline' ||
      state.graphic.geometry?.type === 'polygon' ||
      (Array.isArray(state.drawEssentials.CTRL_PTS) && state.drawEssentials.CTRL_PTS.length > 0) ||
      !!state.drawEssentials.BASE_LN_PTS;

    if (oldFamily === 'point' || newFamily === 'point') {
      if (!(oldFamily === 'point' && newFamily === 'point' && hasPointGeometry)) {
        errors.push('Point symbols can only be swapped with compatible point symbols in this editor.');
      }
    } else if (newFamily && !hasControlGeometry) {
      errors.push('Line and area swaps require existing control geometry.');
    }

    return errors;
  }

  private close(): void {
    document.removeEventListener('keydown', this.keydownHandler);
    if (this.root) this.root.innerHTML = '';
    this.state = null;
  }

  private ensureRoot(): void {
    if (this.root) return;
    this.root = document.createElement('div');
    this.root.id = 'morphix-root';
    document.body.appendChild(this.root);
  }

  private ensureStyles(): void {
    if (this.styleElement) return;
    this.styleElement = document.createElement('style');
    this.styleElement.id = 'morphix-styles';
    this.styleElement.textContent = `
      #morphix-root { position: relative; z-index: 4000; font-family: Inter, Arial, sans-serif; color: oklch(94% 0.01 225); }
      .morphix-backdrop { position: fixed; inset: 0; background: color-mix(in oklch, oklch(17% 0.03 230), transparent 18%); }
      .morphix-modal { position: fixed; inset: 5vh max(18px, calc((100vw - 1120px) / 2)); max-height: 90vh; display: grid; grid-template-rows: auto 1fr auto; background: oklch(23% 0.025 230); border: 1px solid oklch(39% 0.035 225); box-shadow: 0 24px 70px color-mix(in oklch, oklch(10% 0.02 230), transparent 18%); border-radius: 8px; overflow: hidden; }
      .morphix-header, .morphix-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; background: oklch(20% 0.022 230); border-bottom: 1px solid oklch(35% 0.03 225); }
      .morphix-footer { border-top: 1px solid oklch(35% 0.03 225); border-bottom: 0; }
      .morphix-kicker, .morphix-subhead { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0; color: oklch(74% 0.08 175); }
      .morphix-header h2, .morphix-section h3 { margin: 0; font-size: 19px; line-height: 1.25; font-weight: 700; }
      .morphix-body { overflow: auto; padding: 18px 20px 22px; display: grid; gap: 14px; background: oklch(25% 0.02 230); }
      .morphix-section { border: 1px solid oklch(37% 0.03 225); border-radius: 8px; padding: 14px; background: oklch(27% 0.018 230); }
      .morphix-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      .morphix-summary dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0; }
      .morphix-summary div { min-width: 0; }
      .morphix-summary dt { color: oklch(72% 0.02 225); font-size: 11px; margin-bottom: 3px; }
      .morphix-summary dd { margin: 0; overflow-wrap: anywhere; font-family: Consolas, monospace; font-size: 12px; }
      .morphix-grid { display: grid; gap: 10px; }
      .morphix-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .morphix-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .morphix-section label { display: grid; gap: 5px; font-size: 12px; color: oklch(78% 0.018 225); min-width: 0; }
      .morphix-section input, .morphix-section select, .morphix-section textarea { width: 100%; box-sizing: border-box; border: 1px solid oklch(43% 0.035 225); border-radius: 6px; background: oklch(19% 0.018 230); color: oklch(95% 0.008 225); min-height: 32px; padding: 6px 8px; font: inherit; font-size: 12px; }
      .morphix-section input:focus, .morphix-section select:focus, .morphix-section textarea:focus { outline: 2px solid oklch(67% 0.12 175); outline-offset: 1px; }
      .morphix-raw { margin-top: 10px; }
      .morphix-meta, .morphix-label-preview { margin-top: 10px; color: oklch(74% 0.018 225); font-size: 12px; overflow-wrap: anywhere; }
      .morphix-preview { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: start; }
      .morphix-preview p { margin: 4px 0 0; color: oklch(76% 0.02 225); }
      .morphix-code { font-family: Consolas, monospace; padding: 8px 10px; border-radius: 6px; background: oklch(18% 0.02 230); border: 1px solid oklch(42% 0.035 225); }
      .morphix-label-preview { grid-column: 1 / -1; }
      .morphix-params { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
      .morphix-params span { display: inline-block; margin: 6px 6px 0 0; padding: 4px 7px; border-radius: 999px; background: oklch(20% 0.018 230); border: 1px solid oklch(39% 0.03 225); font-size: 11px; }
      .morphix-json { min-height: 220px; font-family: Consolas, monospace; resize: vertical; }
      .morphix-btn, .morphix-link-btn, .morphix-icon-btn { border: 1px solid oklch(43% 0.035 225); background: oklch(29% 0.02 230); color: oklch(94% 0.01 225); border-radius: 6px; min-height: 32px; padding: 6px 11px; cursor: pointer; }
      .morphix-link-btn { min-height: 28px; color: oklch(78% 0.09 175); background: transparent; }
      .morphix-icon-btn { width: 32px; padding: 0; font-weight: 700; }
      .morphix-primary { background: oklch(55% 0.12 175); border-color: oklch(62% 0.13 175); color: oklch(16% 0.02 175); font-weight: 700; }
      .morphix-primary:disabled { opacity: .45; cursor: not-allowed; }
      .morphix-actions { display: flex; gap: 8px; }
      .morphix-validation { font-size: 12px; line-height: 1.4; color: oklch(77% 0.02 225); }
      .morphix-validation.is-invalid { color: oklch(78% 0.13 35); }
      @media (max-width: 760px) {
        .morphix-modal { inset: 0; max-height: 100vh; border-radius: 0; }
        .morphix-summary dl, .morphix-grid-2, .morphix-grid-3, .morphix-params, .morphix-preview { grid-template-columns: 1fr; }
        .morphix-header, .morphix-footer { align-items: stretch; flex-direction: column; }
      }
    `;
    document.head.appendChild(this.styleElement);
  }

  private normalizeSidc(sidc: string, sid?: string): string {
    const digits = String(sidc || '').replace(/\D/g, '');
    if (digits.length >= 20) return digits.slice(0, 20);
    if (digits.length > 0) return digits.padEnd(20, '0');
    const key = Object.keys(SYMBOLS).find((k) => k.slice(2, 8) === sid);
    return key ? `1000${key.slice(0, 2)}0000${key.slice(2).padEnd(10, '0')}` : '10000000000000000000';
  }

  private getSymbolKey(sidc: string): string {
    return `${sidc.slice(4, 6)}${sidc.slice(10, 16)}`;
  }

  private geometryFamily(value?: string): 'point' | 'line' | 'area' | '' {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'point' || normalized === 'fpoint') return 'point';
    if (normalized === 'line' || normalized === 'polyline') return 'line';
    if (normalized === 'area' || normalized === 'polygon') return 'area';
    return '';
  }

  private displayGeometryFamily(value?: string): string {
    const family = this.geometryFamily(value);
    if (family === 'point') return 'Point';
    if (family === 'line') return 'Line';
    if (family === 'area') return 'Area';
    return String(value || '');
  }

  private pickExistingKeys(source: Record<string, any>, keys: string[]): Record<string, any> {
    return keys.reduce((acc, key) => {
      acc[key] = source?.[key] ?? '';
      return acc;
    }, {} as Record<string, any>);
  }

  private pickExtraKeys(source: Record<string, any>, known: string[]): Record<string, any> {
    return Object.keys(source || {}).reduce((acc, key) => {
      if (!known.includes(key)) acc[key] = this.cloneValue(source[key]);
      return acc;
    }, {} as Record<string, any>);
  }

  private coerceValue(value: string): any {
    const trimmed = value.trim();
    if (trimmed === '') return '';
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
    return value;
  }

  private cloneValue<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    if ((value as any).clone) return (value as any).clone();
    if (Array.isArray(value)) return value.map((item) => this.cloneValue(item)) as T;
    return Object.entries(value as Record<string, any>).reduce((acc, [key, item]) => {
      (acc as Record<string, any>)[key] = this.cloneValue(item);
      return acc;
    }, {} as T);
  }

  private prepareJson(value: any): any {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => this.prepareJson(item));
    if ('type' in value && typeof value.toJSON === 'function') return value.toJSON();
    return Object.entries(value).reduce((acc, [key, item]) => {
      if (typeof item !== 'function') acc[key] = this.prepareJson(item);
      return acc;
    }, {} as Record<string, any>);
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

export default MorphixEngine;
