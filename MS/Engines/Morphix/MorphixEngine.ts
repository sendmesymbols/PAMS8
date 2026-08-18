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

/**
 * The four geometry families a symbol can belong to, mirroring the
 * `SYM_GEO_TYPE` written into every symbol's drawEssentials:
 *   - `Point`  → Tactical point (TacticalPoint) — edited via flat SIZE/ANGLE fields.
 *   - `FPoint` → Force / UEI (milsymbol) — edited via the nested OPTIONS object.
 *   - `Line`   → Polyline tactical graphic.
 *   - `Area`   → Polygon tactical graphic.
 */
export type GeoKind = 'Point' | 'FPoint' | 'Line' | 'Area';

export interface MorphixEditedState {
  sidc: string;
  symbolKey: string;
  symbolDefinition: SymbolDefinition;
  amplifier: Amplifier;
  drawEssentials: DrawEssentials;
  attributes: Record<string, any>;
}

/**
 * Partial patch a host program supplies to {@link MorphixEngine.update} (and,
 * via the library entry point, `symbolEngine.updateSymbol`). Each member is
 * shallow-merged onto the symbol's current state, so only the fields you want
 * to change need to be present. The patch is geometry-preserving — the symbol's
 * GEOM / CTRL_PTS are never touched.
 */
export interface MorphixSymbolPatch {
  /** Replace the 20-digit SIDC. Re-derives SID / echelon / symbol name. */
  sidc?: string;
  /** Merge into the amplifier fields (UNIQUE_DESIG, DTG, …) of Point/Line/Area symbols. */
  amplifier?: Record<string, any>;
  /** Merge into drawEssentials top-level fields (SIZE, ANGLE, DRAW_TYPE, ratios, opacity, …). */
  drawEssentials?: Record<string, any>;
  /** FPoint only: merge into the milsymbol OPTIONS object (uniqueDesignation, higherFormation, …). */
  options?: Record<string, any>;
  /** Merge into label styling options (textSize, color, bold, …). */
  labelOptions?: Record<string, any>;
  /** Merge into extraSettings (lineWidth, size, textSize, opacity). For FPoint, `size` drives the marker size. */
  extraSettings?: Record<string, any>;
  /** Merge into the CIM cartographic info model. */
  cim?: Record<string, any>;
}

/** Read-only view of a symbol's editable state, returned by {@link MorphixEngine.getSymbolState}. */
export interface MorphixSymbolSnapshot {
  kind: GeoKind | '';
  sidc: string;
  symbolKey: string;
  symbolName: string;
  amplifier: Record<string, any>;
  drawEssentials: Record<string, any>;
  options: Record<string, any>;
  labelOptions: Record<string, any>;
  extraSettings: Record<string, any>;
  cim: Record<string, any>;
}

interface MorphixCallbacks {
  applyEdit: (graphic: Graphic, editedState: MorphixEditedState) => Graphic | null;
}

const SYMBOLS = symbolData as Record<string, SymbolDefinition>;

/**
 * DrawEssentials fields whose CLASS default is a concrete value AND which symbol
 * classes resolve through GeoTools.setDefault (which tests hasOwnProperty, not
 * the value). Re-rendering a symbol with one of these present when the symbol
 * never carried it overrides the symbol's own default — see buildEditedState.
 */
/**
 * Graphic-record attribute names — bookkeeping written by drawSymEnd / plan load,
 * NOT symbol data. They must never be used to fill an amplifier or a milsymbol
 * option: `attributes.type` is the record kind ('symbol'), and reading it as the
 * FPoint `type` amplifier auto-populated every UEI symbol's Type field with
 * "symbol". Keep in sync with the attrs built in SymbolEngine.drawSymEnd.
 */
const RESERVED_GRAPHIC_ATTRS = new Set([
  'type',
  'id',
  'sidc',
  'symbolId',
  'drawEssentials',
]);

/**
 * DrawEssentials keys that must never be JSON-cloned into the editor's working
 * copy — either because the value is a live object rather than data, or because
 * the editor models it separately:
 *   • GEOM / CTRL_PTS / BASE_LN_PTS — ArcGIS geometry; stashed in geomRefs by
 *     reference and re-attached through cloneGeometry() on save.
 *   • AMPLIFIER / OPTIONS / labelOptions / extraSettings / cim — nested groups
 *     the editor builds its own state for.
 *   • SCOPE — the drawing symbol-class instance. 158 of the ~160 tactical symbol
 *     classes stamp `SCOPE = this` onto their own drawEssentials (EditEngine
 *     calls SCOPE.createSymbol() to redraw from control points), and that
 *     instance holds `view`, so it transitively reaches the entire ArcGIS object
 *     graph. Walking it does not terminate in any useful time. Force (UEI)
 *     symbols never set it, which is why only tactical symbols were affected.
 *     Every other consumer of drawEssentials strips it the same way — see
 *     SerializationEngine, TemplateEngine and SymbolEngine.serializeSymbol.
 */
const DE_NON_DATA_KEYS = new Set([
  'GEOM',
  'CTRL_PTS',
  'BASE_LN_PTS',
  'AMPLIFIER',
  'OPTIONS',
  'labelOptions',
  'extraSettings',
  'cim',
  'SCOPE',
]);

const DE_RATIO_DEFAULTS = [
  'BK_LN_DIST_RATIO',
  'BK_LN_ANGL_RATIO',
  'FRNT_LN_ANGL_RATIO',
  'FRNT_LN_DIST_RATIO',
  'FLAP_DIST_RATIO',
] as const;

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

type FieldType = 'number' | 'text' | 'bool' | 'color';
type FieldGroup =
  | 'amplifier'
  | 'drawEssentials'
  | 'options'
  | 'labelOptions'
  | 'extraSettings'
  | 'cim';

interface FieldSpec {
  group: FieldGroup;
  key: string;
  label: string;
  type: FieldType;
}

const fs = (group: FieldGroup, key: string, label: string, type: FieldType = 'text'): FieldSpec => ({
  group,
  key,
  label,
  type,
});

/** Object-form amplifier fields used by Point / Line / Area symbols. */
const AMPLIFIER_FIELDS: FieldSpec[] = [
  fs('amplifier', 'UNIQUE_DESIG', 'Unique Desig'),
  fs('amplifier', 'HIGHER_FORM', 'Higher Formation'),
  fs('amplifier', 'STAFF_COM', 'Staff Comments'),
  fs('amplifier', 'ADDL_INFO', 'Addl Information'),
  fs('amplifier', 'DTG', 'DTG'),
  fs('amplifier', 'EDTG', 'EDTG'),
  fs('amplifier', 'ALTITUDE_DEPTH', 'Altitude / Depth'),
  fs('amplifier', 'LOC', 'Location'),
  fs('amplifier', 'DISTANCE', 'Distance'),
  fs('amplifier', 'AZIMUTH', 'Azimuth'),
  fs('amplifier', 'TYPE', 'Type'),
  fs('amplifier', 'QUANTITY', 'Quantity'),
  fs('amplifier', 'COUNTRY', 'Country'),
  fs('amplifier', 'TARGET_DESIGNATOR', 'Target Designator'),
];

/**
 * milsymbol amplifier fields for Force (FPoint) symbols. These live inside the
 * symbol's OPTIONS object — the renderer (UEISymbol) reads them from there, so
 * editing the flat amplifier would have no visible effect.
 */
const FPOINT_OPTION_FIELDS: FieldSpec[] = [
  fs('options', 'uniqueDesignation', 'Unique Desig'),
  fs('options', 'higherFormation', 'Higher Formation'),
  fs('options', 'quantity', 'Quantity'),
  fs('options', 'reinforcedReduced', 'Reinforced / Reduced'),
  fs('options', 'staffComments', 'Staff Comments'),
  fs('options', 'additionalInformation', 'Addl Information'),
  fs('options', 'type', 'Type'),
  fs('options', 'dtg', 'DTG'),
  fs('options', 'location', 'Location'),
  fs('options', 'direction', 'Direction'),
  fs('options', 'speed', 'Speed'),
  fs('options', 'combatEffectiveness', 'Combat Effectiveness'),
  fs('options', 'evaluationRating', 'Evaluation Rating'),
  fs('options', 'roa', 'ROA'),
  fs('options', 'msn', 'Mission'),
];

/**
 * Bridge between the flat amplifier field names (Point/Line/Area, e.g. `UNIQUE_DESIG`)
 * and the camelCase milsymbol option names (FPoint, e.g. `uniqueDesignation`). The same
 * datum is stored under different keys depending on how the symbol was created, so we
 * read both when populating and write both when needed.
 */
const FLAT_TO_OPT: Record<string, string> = {
  UNIQUE_DESIG: 'uniqueDesignation',
  HIGHER_FORM: 'higherFormation',
  STAFF_COM: 'staffComments',
  ADDL_INFO: 'additionalInformation',
  QUANTITY: 'quantity',
  TYPE: 'type',
  DTG: 'dtg',
  LOC: 'location',
};
const OPT_TO_FLAT: Record<string, string> = Object.fromEntries(
  Object.entries(FLAT_TO_OPT).map(([k, v]) => [v, k]),
);

const DRAW_FIELDS_POINT: FieldSpec[] = [
  fs('drawEssentials', 'SIZE', 'Size', 'number'),
  fs('drawEssentials', 'ANGLE', 'Angle (°)', 'number'),
  fs('drawEssentials', 'OFFSET', 'Offset', 'text'),
  fs('drawEssentials', 'opacity', 'Opacity', 'number'),
  fs('drawEssentials', 'ISFHAND', 'Freehand', 'bool'),
  fs('drawEssentials', 'FRHNDSZ', 'Freehand Size', 'number'),
  fs('drawEssentials', 'FRHNDWDTH', 'Freehand Width', 'number'),
];

// FPoint "Size" is read from extraSettings.size by the milsymbol renderer;
// ANGLE / opacity are read from the top-level drawEssentials.
const DRAW_FIELDS_FPOINT: FieldSpec[] = [
  fs('extraSettings', 'size', 'Size', 'number'),
  fs('drawEssentials', 'ANGLE', 'Angle (°)', 'number'),
  fs('drawEssentials', 'opacity', 'Opacity', 'number'),
];

const DRAW_FIELDS_LINE: FieldSpec[] = [
  fs('drawEssentials', 'opacity', 'Opacity', 'number'),
  fs('drawEssentials', 'DRAW_TYPE', 'Draw Type', 'number'),
  fs('drawEssentials', 'IS_OBS', 'Is Observation', 'number'),
  fs('drawEssentials', 'ARROWHEAD_RATIO', 'Arrowhead Ratio', 'number'),
  fs('drawEssentials', 'BK_LN_DIST_RATIO', 'Back Line Dist Ratio', 'number'),
  fs('drawEssentials', 'BK_LN_ANGL_RATIO', 'Back Line Angl Ratio', 'number'),
  fs('drawEssentials', 'FRNT_LN_DIST_RATIO', 'Front Line Dist Ratio', 'number'),
  fs('drawEssentials', 'FRNT_LN_ANGL_RATIO', 'Front Line Angl Ratio', 'number'),
  fs('drawEssentials', 'FLAP_DIST_RATIO', 'Flap Dist Ratio', 'number'),
  fs('drawEssentials', 'FLAP_ANGLE', 'Flap Angle', 'number'),
  fs('drawEssentials', 'ISFHAND', 'Freehand', 'bool'),
  fs('drawEssentials', 'FRHNDSZ', 'Freehand Size', 'number'),
  fs('drawEssentials', 'FRHNDWDTH', 'Freehand Width', 'number'),
];

const DRAW_FIELDS_AREA: FieldSpec[] = [
  fs('drawEssentials', 'opacity', 'Opacity', 'number'),
  fs('drawEssentials', 'DRAW_TYPE', 'Draw Type', 'number'),
  fs('drawEssentials', 'IS_OBS', 'Is Observation', 'number'),
  fs('drawEssentials', 'ISFHAND', 'Freehand', 'bool'),
  fs('drawEssentials', 'FRHNDSZ', 'Freehand Size', 'number'),
  fs('drawEssentials', 'FRHNDWDTH', 'Freehand Width', 'number'),
];

// Cross-platform, 3D-safe font families (kept in sync with TextStyleSettingsManifest).
const FONT_FAMILIES: string[] = [
  'Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Georgia', 'Trebuchet MS',
];

// A LABEL field is [key, label, type, options?]; options only for 'select'.
const LABEL_FIELDS: Array<[string, string, 'number' | 'color' | 'bool' | 'select', string[]?]> = [
  ['fontFamily', 'Font', 'select', FONT_FAMILIES],
  ['textSize', 'Text Size', 'number'],
  ['haloColorSize', 'Halo Size', 'number'],
  ['color', 'Text Color', 'color'],
  ['haloColor', 'Halo Color', 'color'],
  ['bold', 'Bold', 'bool'],
  ['italic', 'Italic', 'bool'],
  ['uLine', 'Underline', 'bool'],
  ['oLine', 'Overline', 'bool'],
  ['tLine', 'Strikethrough', 'bool'],
];

const EXTRA_FIELDS: Array<[string, string]> = [
  ['lineWidth', 'Line Width'],
  ['size', 'Marker Size'],
  ['textSize', 'Text Size'],
  ['opacity', 'Opacity'],
];

// ──────────────────────────────────────────────────────────────────────────────
// State

interface EditableState {
  graphic: Graphic;
  /** Resolved geometry family — drives which fields populate and how we rebuild. */
  kind: GeoKind | '';
  sidc: string;
  symbolKey: string;
  /** Geometry refs kept aside — never JSON-cloned, re-attached on save. */
  geomRefs: { GEOM?: any; CTRL_PTS?: any[]; BASE_LN_PTS?: any };
  /**
   * Live (non-data) back-references kept aside BY REFERENCE and re-attached on
   * save, never cloned. Currently just SCOPE — see DE_NON_DATA_KEYS.
   */
  liveRefs: { SCOPE?: any };
  amplifier: Record<string, any>;
  drawEssentials: Record<string, any>;
  /** FPoint OPTIONS payload (geometry + labelOptions stripped). Empty for other kinds. */
  options: Record<string, any>;
  labelOptions: Record<string, any>;
  extraSettings: Record<string, any>;
  /**
   * Whether labelOptions / extraSettings came from the SYMBOL itself (or were
   * edited in this session) rather than from the DrawEssentials class fallback
   * that only exists to give the form something to show. Groups the symbol
   * doesn't own are NOT written back on save — otherwise changing an unrelated
   * field would stamp the class defaults (red halo, green 20pt label text,
   * marker size 20) onto a symbol that had been using its own.
   */
  owns: { labelOptions: boolean; extraSettings: boolean };
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
  /** EditableState.owns as it was when the editor opened — restored by the per-section Reset buttons. */
  private originalOwns: EditableState['owns'] = { labelOptions: false, extraSettings: false };
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
    this.originalOwns = { ...this.state.owns };
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
  // Public programmatic API (no UI) — for host programs driving their own editors

  /**
   * Apply a partial patch to a symbol and re-render it through the same pipeline
   * the interactive editor uses. Geometry is preserved untouched. Returns the
   * newly created Graphic, or null if the edit could not be applied.
   *
   * @example
   * symbolEngine.updateSymbol(graphic, {
   *   sidc: '10031000151211000000',
   *   options: { uniqueDesignation: 'A Coy', higherFormation: '1 Bn' }, // FPoint
   *   extraSettings: { size: 40 },
   * });
   */
  public update(graphic: Graphic, patch: MorphixSymbolPatch): Graphic | null {
    if (!this.callbacks) {
      // eslint-disable-next-line no-console
      console.error('[MorphixEngine] update() called before initialize().');
      return null;
    }
    if (!graphic) return null;

    const state = this.buildState(graphic);
    this.applyPatch(state, patch || {});

    const errors = this.validate(state);
    if (errors.length) {
      // eslint-disable-next-line no-console
      console.error('[MorphixEngine] update() rejected:', errors.join(' · '));
      return null;
    }

    const editedState = this.buildEditedState(state);
    try {
      return this.callbacks.applyEdit(graphic, editedState);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[MorphixEngine] update() applyEdit failed:', err);
      return null;
    }
  }

  /** Read a symbol's current editable state without opening the editor. */
  public getSymbolState(graphic: Graphic): MorphixSymbolSnapshot {
    const s = this.buildState(graphic);
    const def = SYMBOLS[s.symbolKey];
    return {
      kind: s.kind,
      sidc: s.sidc,
      symbolKey: s.symbolKey,
      symbolName: def?.Name || s.drawEssentials.SYM_NAME || '',
      amplifier: this.jsonClone(s.amplifier),
      drawEssentials: this.jsonClone(s.drawEssentials),
      options: this.jsonClone(s.options),
      labelOptions: this.jsonClone(s.labelOptions),
      extraSettings: this.jsonClone(s.extraSettings),
      cim: this.jsonClone(s.cim),
    };
  }

  /** Merge a patch onto a working state. Shared by update() and (indirectly) the modal. */
  private applyPatch(state: EditableState, patch: MorphixSymbolPatch): void {
    if (typeof patch.sidc === 'string' && patch.sidc.length) {
      this.applySidc(patch.sidc, true, state);
    }
    if (patch.amplifier && typeof patch.amplifier === 'object') {
      Object.assign(state.amplifier, patch.amplifier);
    }
    if (patch.drawEssentials && typeof patch.drawEssentials === 'object') {
      Object.assign(state.drawEssentials, patch.drawEssentials);
    }
    if (patch.options && typeof patch.options === 'object' && state.kind === 'FPoint') {
      Object.assign(state.options, patch.options);
    }
    if (patch.labelOptions && typeof patch.labelOptions === 'object') {
      Object.assign(state.labelOptions, patch.labelOptions);
      state.owns.labelOptions = true;
    }
    if (patch.extraSettings && typeof patch.extraSettings === 'object') {
      Object.assign(state.extraSettings, patch.extraSettings);
      state.owns.extraSettings = true;
    }
    if (patch.cim && typeof patch.cim === 'object') {
      Object.assign(state.cim, patch.cim);
    }
    // Keep amplifier/options SIDC aligned even when sidc wasn't part of the patch.
    state.amplifier.SIDC = state.sidc;
    if (state.kind === 'FPoint') state.options.SIDC = state.sidc;
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

    // FPoint carries its renderable amplifier data inside OPTIONS — which at
    // runtime can be nested (de.OPTIONS.OPTIONS for plan-loaded symbols) and uses
    // camelCase milsymbol names. Everything else uses the flat AMPLIFIER object.
    const optSource = this.resolveOptions(de);

    const ampSource =
      (de.AMPLIFIER && typeof de.AMPLIFIER === 'object'
        ? de.AMPLIFIER
        : attrs.amplifier && typeof attrs.amplifier === 'object'
          ? (attrs.amplifier as Record<string, any>)
          : {}) as Record<string, any>;

    const sidc = this.normalizeSidc(
      ampSource.SIDC || de.SIDC || optSource.SIDC || attrs.sidc || '',
      de.SID,
    );
    const symbolKey = this.getSymbolKey(sidc);
    const def = SYMBOLS[symbolKey];

    const kind = this.geomKindOf(
      de.SYM_GEO_TYPE || def?.SymGeoType || optSource.symType || this.geomTypeOf(graphic),
    );

    // Stash geometry refs — these must survive untouched through the editor.
    const geomRefs: EditableState['geomRefs'] = {};
    if (de.GEOM) geomRefs.GEOM = de.GEOM;
    else if (optSource.GEOM) geomRefs.GEOM = optSource.GEOM;
    if (Array.isArray(de.CTRL_PTS)) geomRefs.CTRL_PTS = de.CTRL_PTS;
    if (de.BASE_LN_PTS) geomRefs.BASE_LN_PTS = de.BASE_LN_PTS;

    // FPoint OPTIONS — clone the payload (strip geometry + nested label opts),
    // then fill the known editable fields from every place the value can live:
    // the OPTIONS object (milsymbol name), the de top-level (camelCase), or the
    // flat amplifier (bridged name). This makes populate work for symbols created
    // interactively, loaded from a plan, or imported.
    const options: Record<string, any> = {};
    if (kind === 'FPoint') {
      for (const k of Object.keys(optSource)) {
        if (k === 'GEOM' || k === 'labelOptions' || k === 'OPTIONS') continue;
        options[k] = this.jsonClone(optSource[k]);
      }
      for (const f of FPOINT_OPTION_FIELDS) {
        const flatKey = OPT_TO_FLAT[f.key];
        options[f.key] = this.firstFilled(
          optSource[f.key],
          (de as Record<string, any>)[f.key],
          this.attrValue(attrs, f.key),
          flatKey ? ampSource[flatKey] : undefined,
          options[f.key],
        );
      }
      options.SIDC = sidc;
    }

    // Amplifier — known fields, sourced from the flat AMPLIFIER, then bridged from
    // the FPoint OPTIONS (milsymbol name) or de top-level when the flat field is empty.
    const amplifier: Record<string, any> = { SIDC: sidc };
    for (const f of AMPLIFIER_FIELDS) {
      const optKey = FLAT_TO_OPT[f.key];
      amplifier[f.key] = this.firstFilled(
        ampSource[f.key],
        optKey ? optSource[optKey] : undefined,
        (de as Record<string, any>)[f.key],
        this.attrValue(attrs, f.key),
      );
    }
    for (const k of Object.keys(ampSource)) {
      if (!(k in amplifier)) amplifier[k] = this.jsonClone(ampSource[k]);
    }

    // Live back-references held aside so the clone below never walks them, and
    // so the re-rendered symbol can get them back (see buildEditedState).
    const liveRefs: EditableState['liveRefs'] = {};
    if (de.SCOPE && typeof de.SCOPE === 'object') liveRefs.SCOPE = de.SCOPE;

    // DrawEssentials — JSON-clone the saved metadata field by field, skipping
    // geometry, the nested groups and SCOPE. Cloning the whole object and
    // deleting those keys afterwards still WALKED them first: with SCOPE present
    // that walk reaches the ArcGIS view and never finishes, so Show Details on
    // any tactical symbol froze the tab before its dock/modal could open.
    const drawEssentials: Record<string, any> = {};
    for (const key of Object.keys(de)) {
      if (DE_NON_DATA_KEYS.has(key)) continue;
      drawEssentials[key] = this.jsonClone(de[key]);
    }

    drawEssentials.SIDC = sidc;
    drawEssentials.SID = sidc.slice(10, 16);
    drawEssentials.SYM_NAME = def?.Name || de.SYM_NAME || '';
    drawEssentials.SYM_GEO_TYPE = def?.SymGeoType || de.SYM_GEO_TYPE || kind;
    drawEssentials.ECHELON = de.ECHELON ?? sidc.slice(8, 10);

    const defaults = new DrawEssentials();

    // Did the symbol actually carry these, or are we about to show class
    // defaults? See EditableState.owns — the answer decides whether they get
    // written back on save.
    const owns = {
      labelOptions: !!(de.labelOptions || optSource.labelOptions),
      extraSettings: !!(de.extraSettings || optSource.extraSettings),
    };

    const extraSettings = this.jsonClone(
      de.extraSettings || optSource.extraSettings || defaults.extraSettings,
    ) as Record<string, any>;

    if (kind === 'FPoint') {
      // The milsymbol renderer reads marker size from extraSettings.size.
      // Seed it from the saved OPTIONS.size / ANGLE / opacity so the editor
      // shows what's actually on screen.
      if (optSource.size != null && Number(optSource.size)) {
        extraSettings.size = Number(optSource.size);
        owns.extraSettings = true;
      }
      if (drawEssentials.ANGLE == null && optSource.ANGLE != null) {
        drawEssentials.ANGLE = optSource.ANGLE;
      }
      if (drawEssentials.opacity == null && optSource.opacity != null) {
        drawEssentials.opacity = optSource.opacity;
      }
    }

    return {
      graphic,
      kind,
      sidc,
      symbolKey,
      geomRefs,
      liveRefs,
      amplifier,
      drawEssentials,
      options,
      labelOptions: this.jsonClone(
        de.labelOptions || optSource.labelOptions || defaults.labelOptions,
      ),
      extraSettings,
      owns,
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
      options: s.options,
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
    options: Record<string, any>;
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
          ${this.renderDrawSection()}
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

  /**
   * Update only the parts of the modal that depend on field values — the footer
   * status / Save button enabled-state, the read-only SIDC mirror, and the JSON
   * preview — WITHOUT rebuilding the form. This keeps the editable inputs (and
   * the Save button) alive and focused, so a value edit followed immediately by
   * a Save click doesn't destroy the button mid-click. Used for plain value /
   * bool / color edits; structural changes (SIDC, symbol swap, reset, JSON
   * toggle) still go through the full render().
   */
  private refreshDynamic(): void {
    if (!this.root || !this.state) return;
    const s = this.state;
    const errors = this.validate(s);
    const isValid = errors.length === 0;
    const isDirty = JSON.stringify(this.serialize(s)) !== this.originalSnapshot;

    const saveBtn = this.root.querySelector(
      '[data-action="save"]',
    ) as HTMLButtonElement | null;
    if (saveBtn) saveBtn.disabled = !(isValid && isDirty);

    const msg = this.root.querySelector(
      '[data-mx="footer-msg"]',
    ) as HTMLElement | null;
    if (msg) {
      msg.textContent = isValid
        ? isDirty
          ? 'Ready to save.'
          : 'No changes yet.'
        : errors.join(' · ');
      msg.style.color = isValid ? 'var(--ms-text-dim)' : 'var(--ms-danger)';
    }

    const mirror = this.root.querySelector(
      '[data-mx="sidc-mirror"]',
    ) as HTMLInputElement | null;
    if (mirror) mirror.value = s.sidc;

    if (s.jsonOpen) {
      const ta = this.root.querySelector(
        '[data-mx="json-text"]',
      ) as HTMLTextAreaElement | null;
      if (ta) ta.value = JSON.stringify(this.serialize(s), null, 2);
    }
  }

  private renderHeader(def?: SymbolDefinition): string {
    const s = this.state!;
    return `
      <div class="ms-header" style="cursor:default;">
        <div class="ms-header-icon">MX</div>
        <div class="ms-header-title">Morphix · ${this.esc(def?.Name || s.drawEssentials.SYM_NAME || 'Symbol')}</div>
        <span class="ms-status-lbl">${this.esc(this.geomLabel(s.kind))} · ${this.esc(s.symbolKey || '?')}</span>
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
          <input class="ms-input" type="text" disabled value="${this.esc(this.geomLabel(s.kind))}">
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
          <input class="ms-input" type="text" disabled value="${this.esc(s.sidc)}" data-mx="sidc-mirror"
                 style="font-family:var(--ms-font-mono);letter-spacing:1px;color:var(--ms-accent);">
        </div>
      </div>
    `);
  }

  private renderSymbolSwapSection(def?: SymbolDefinition): string {
    const s = this.state!;

    // Lines and areas use a fixed SymbolEngine class — swapping changes rendering wholesale.
    // Restrict swap to point families (Point / FPoint), like milsymbol.net.
    if (s.kind !== 'Point' && s.kind !== 'FPoint') {
      return this.renderSection('Symbol Swap', `
        <div class="ms-status warning" style="margin:6px 12px 0;">
          Symbol swap is disabled for ${this.esc(this.geomLabel(s.kind))} graphics.
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
      if (this.geomKindOf(d.SymGeoType) !== s.kind) return false;
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
        Geometry: ${this.esc(this.geomLabel(s.kind))}
        ${def?.Description ? ' · ' + this.esc(def.Description) : ''}
      </div>
    `);
  }

  private renderAmplifierSection(): string {
    const s = this.state!;
    const isFPoint = s.kind === 'FPoint';
    const fields = isFPoint ? FPOINT_OPTION_FIELDS : AMPLIFIER_FIELDS;
    const groupValues = isFPoint ? s.options : s.amplifier;

    const cells = fields
      .map((f) => this.textField(f.group, f.key, f.label, groupValues[f.key], f.type))
      .join('');

    const title = isFPoint ? 'Force Symbol Options' : 'Amplifiers';
    const hint = isFPoint
      ? `<div class="ms-hint">These fields drive the milsymbol render of this force symbol.</div>`
      : '';

    return this.renderSection(title, `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${cells}
      </div>
      ${hint}
    `, 'reset-amplifiers');
  }

  private renderDrawSection(): string {
    const s = this.state!;
    const fields = this.drawFieldsFor(s.kind);

    const cells = fields.map((f) => {
      if (f.type === 'bool') return this.boolField(f.group, f.key, f.label, this.groupValue(s, f.group)[f.key]);
      return this.textField(f.group, f.key, f.label, this.groupValue(s, f.group)[f.key], f.type);
    }).join('');

    const def = SYMBOLS[s.symbolKey];

    return this.renderSection('Draw Settings', `
      <div class="ms-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));">
        ${cells}
      </div>
      ${this.renderParameters(def)}
    `, 'reset-draw');
  }

  private drawFieldsFor(kind: GeoKind | ''): FieldSpec[] {
    switch (kind) {
      case 'Point':  return DRAW_FIELDS_POINT;
      case 'FPoint': return DRAW_FIELDS_FPOINT;
      case 'Line':   return DRAW_FIELDS_LINE;
      case 'Area':   return DRAW_FIELDS_AREA;
      default:       return DRAW_FIELDS_POINT;
    }
  }

  private groupValue(s: EditableState, group: FieldGroup): Record<string, any> {
    return (s as any)[group] as Record<string, any>;
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
    const cells = LABEL_FIELDS.map(([k, l, t, opts]) => {
      if (t === 'color') return this.colorField('labelOptions', k, l, s.labelOptions[k]);
      if (t === 'bool') return this.boolField('labelOptions', k, l, s.labelOptions[k]);
      if (t === 'select') return this.selectField('labelOptions', k, l, s.labelOptions[k], opts || []);
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
        ? `<div class="ms-grid full"><textarea class="ms-input" readonly rows="14" data-mx="json-text" style="font-family:var(--ms-font-mono);min-height:240px;resize:vertical;">${this.esc(JSON.stringify(this.serialize(this.state!), null, 2))}</textarea></div>`
        : ''}
    `;
  }

  private renderFooter(errors: string[], isValid: boolean, isDirty: boolean): string {
    const message = isValid
      ? (isDirty ? 'Ready to save.' : 'No changes yet.')
      : errors.map((e) => this.esc(e)).join(' · ');
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--ms-bg-header);border-top:1px solid var(--ms-divider);">
        <div data-mx="footer-msg" style="font-size:var(--ms-fs-xs);color:${isValid ? 'var(--ms-text-dim)' : 'var(--ms-danger)'};line-height:1.5;flex:1;min-width:0;">
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

  private selectField(group: string, key: string, label: string, value: any, options: string[]): string {
    const current = value == null ? '' : String(value);
    const opts = options
      .map((o) => `<option value="${this.esc(o)}" ${o === current ? 'selected' : ''}>${this.esc(o)}</option>`)
      .join('');
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(label)}</span>
        <select class="ms-input" data-kind="value-select"
                data-group="${this.esc(group)}" data-key="${this.esc(key)}">
          ${opts}
        </select>
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
      // Text/number value fields update live on `input` so state (and the
      // Save button's enabled state) stay current WITHOUT a full re-render.
      // `change` fires on blur — which happens when the user clicks Save —
      // and a full re-render there destroys the Save button mid-click,
      // swallowing the click. `symbol-filter` is also live for instant search.
      const liveKinds = new Set(['symbol-filter', 'value']);
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
        const coerced = this.coerce(t.value, type);
        if (!(type === 'number' && coerced === undefined)) {
          (this.state as any)[group][key] = coerced;
          this.claimGroup(group);
        }
        // Editing the SIDC restructures the form (combos, echelon, name) so it
        // needs a full re-render; every other value edit only affects the
        // footer / mirror, so refresh those in place to keep inputs (and the
        // Save button) alive and focused.
        if (group === 'amplifier' && key === 'SIDC') {
          this.applySidc(String(t.value), true);
          this.render();
        } else {
          this.refreshDynamic();
        }
        return;
      }

      case 'value-bool': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        (this.state as any)[group][key] = t.checked ? 1 : 0;
        this.claimGroup(group);
        this.refreshDynamic();
        return;
      }

      case 'value-color': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        (this.state as any)[group][key] = this.hexToRgb(t.value);
        this.claimGroup(group);
        this.refreshDynamic();
        return;
      }

      case 'value-select': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        (this.state as any)[group][key] = t.value;
        this.claimGroup(group);
        this.refreshDynamic();
        return;
      }
    }
  }

  /**
   * The form is seeded with DrawEssentials class defaults when the symbol has no
   * labelOptions / extraSettings of its own. Once the user edits a field in one
   * of those groups the values become intentional, so the symbol now owns them
   * and they are written back on save. See EditableState.owns.
   */
  private claimGroup(group: string): void {
    if (!this.state) return;
    if (group === 'labelOptions' || group === 'extraSettings') {
      this.state.owns[group] = true;
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
      case 'reset-amplifiers': {
        const snap = this.parseSnapshot();
        this.state.amplifier = snap.amplifier;
        this.state.options = snap.options;
        break;
      }
      case 'reset-draw': {
        const snap = this.parseSnapshot();
        this.state.drawEssentials = snap.drawEssentials;
        this.state.extraSettings = snap.extraSettings;
        this.state.owns.extraSettings = this.originalOwns.extraSettings;
        this.state.sidc = snap.sidc;
        this.state.symbolKey = snap.symbolKey;
        break;
      }
      case 'reset-labels': {
        const snap = this.parseSnapshot();
        this.state.labelOptions = snap.labelOptions;
        this.state.owns.labelOptions = this.originalOwns.labelOptions;
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

  /**
   * Apply a SIDC to a state (defaults to the open modal's state). Re-derives the
   * symbol key, SID, echelon, name and geometry kind, and keeps the SIDC mirrored
   * across amplifier / options / drawEssentials.
   */
  private applySidc(rawSidc: string, sanitize: boolean, target?: EditableState): void {
    const s = target ?? this.state;
    if (!s) return;
    const cleaned = sanitize ? rawSidc.replace(/\D/g, '') : rawSidc;
    // Keep the native length (20 or 30 char); pad short codes to the 20-char minimum.
    const sidc = cleaned.padEnd(20, '0');

    s.sidc = sidc;
    s.symbolKey = this.getSymbolKey(sidc);
    s.amplifier.SIDC = sidc;
    s.drawEssentials.SIDC = sidc;
    s.drawEssentials.SID = sidc.slice(10, 16);
    s.drawEssentials.ECHELON = sidc.slice(8, 10);
    if (s.kind === 'FPoint') s.options.SIDC = sidc;

    const def = SYMBOLS[s.symbolKey];
    if (def) {
      s.drawEssentials.SYM_NAME = def.Name || '';
      s.drawEssentials.SYM_GEO_TYPE = def.SymGeoType || s.drawEssentials.SYM_GEO_TYPE;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Validation & save

  private validate(s: EditableState): string[] {
    const errors: string[] = [];
    if (!/^\d{20,}$/.test(s.sidc)) {
      errors.push('SIDC must be at least 20 digits.');
    }
    if (!SYMBOLS[s.symbolKey]) {
      errors.push(`Unknown symbol key ${s.symbolKey || '(empty)'} — adjust SIDC Set/Entity.`);
    }

    // The symbol can only be re-rendered into the same geometry family it started in.
    const newKind = this.geomKindOf(SYMBOLS[s.symbolKey]?.SymGeoType);
    if (newKind && s.kind && newKind !== s.kind) {
      errors.push(`Cannot change a ${this.geomLabel(s.kind)} symbol to a ${this.geomLabel(newKind)} symbol.`);
    }
    return errors;
  }

  /**
   * Build the {@link MorphixEditedState} consumed by SymbolEngine.applyMorphixEdit.
   * Shared by the modal Save button and the programmatic {@link update} API so both
   * paths produce identical, geometry-correct results.
   */
  private buildEditedState(s: EditableState): MorphixEditedState {
    const def = SYMBOLS[s.symbolKey];

    const amplifier = new Amplifier(undefined, this.jsonClone(s.amplifier) as Partial<Amplifier>);
    amplifier.SIDC = s.sidc;

    const dePayload = this.jsonClone(s.drawEssentials) as Record<string, any>;
    const drawEssentials = new DrawEssentials(dePayload as Partial<DrawEssentials>);
    // A fresh DrawEssentials ships CONCRETE defaults for these five ratios, and
    // symbol classes resolve them through GeoTools.setDefault — which keys off
    // hasOwnProperty, not on the value. So handing one to a symbol that never
    // carried it OVERRIDES the symbol class's OWN default and silently redraws it
    // with a different shape (Support By Fire resolves FRNT_LN_ANGL_RATIO to 5;
    // the injected class default of 0.8 won instead). Drop the ones the source
    // symbol didn't have so the symbol's default applies again. Every other class
    // default is either identity data we re-set below or inert downstream
    // (SIZE 0 / ARROWHEAD_RATIO 0 / GEOM null are all falsy-guarded), so they stay.
    for (const key of DE_RATIO_DEFAULTS) {
      if (!(key in dePayload)) delete (drawEssentials as any)[key];
    }

    drawEssentials.SIDC = s.sidc;
    drawEssentials.SID = s.sidc.slice(10, 16);
    drawEssentials.SYM_NAME = def?.Name || drawEssentials.SYM_NAME;
    drawEssentials.SYM_GEO_TYPE = def?.SymGeoType || drawEssentials.SYM_GEO_TYPE || s.kind;
    drawEssentials.ECHELON = s.sidc.slice(8, 10);
    // Same rule for the two nested groups — and here the class default has to be
    // deleted, not merely left unassigned: the DrawEssentials constructor already
    // put it on the instance. Left in place it repaints an unstyled symbol's
    // labels red-on-green at 20pt and pins its marker size to 20.
    if (s.owns.labelOptions) {
      drawEssentials.labelOptions = this.jsonClone(s.labelOptions) as any;
    } else {
      delete (drawEssentials as any).labelOptions;
    }
    if (s.owns.extraSettings) {
      drawEssentials.extraSettings = this.jsonClone(s.extraSettings) as any;
    } else {
      delete (drawEssentials as any).extraSettings;
    }
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
    if (s.geomRefs.BASE_LN_PTS) {
      const b = s.geomRefs.BASE_LN_PTS;
      (drawEssentials as any).BASE_LN_PTS = {
        startPt: b.startPt ? this.cloneGeometry(b.startPt) : b.startPt,
        midPt: b.midPt ? this.cloneGeometry(b.midPt) : b.midPt,
        endPt: b.endPt ? this.cloneGeometry(b.endPt) : b.endPt,
      };
    }

    // Hand the live symbol-class back-reference to the re-rendered symbol so
    // control-point editing (EditEngine._redrawFromCtrlPts -> SCOPE.createSymbol)
    // still works after a details edit. By reference, like the geometry above.
    if (s.liveRefs.SCOPE) (drawEssentials as any).SCOPE = s.liveRefs.SCOPE;

    // FPoint: rebuild the milsymbol OPTIONS object the renderer reads from, syncing
    // the canonical edit homes (SIDC, ANGLE, size, opacity) back into it.
    if (s.kind === 'FPoint') {
      const size = Number(s.extraSettings.size);
      const options: Record<string, any> = {
        ...this.jsonClone(s.options),
        symType: 'FPoint',
        SIDC: s.sidc,
        ANGLE: (drawEssentials as any).ANGLE ?? 0,
        opacity: drawEssentials.opacity ?? 1,
      };
      if (s.owns.labelOptions) {
        options.labelOptions = this.jsonClone(s.labelOptions);
      }
      // Only pin the marker size when it's the symbol's own — the placeholder
      // default (20) would otherwise shrink a UEI symbol on every edit.
      if (s.owns.extraSettings && Number.isFinite(size) && size > 0) {
        options.size = size;
      }
      if (s.geomRefs.GEOM) options.GEOM = this.cloneGeometry(s.geomRefs.GEOM);
      (drawEssentials as any).OPTIONS = options;
      (drawEssentials as any).UEI = '1';
    }

    (drawEssentials as any).AMPLIFIER = amplifier;

    const oldAttrs = (s.graphic.attributes || {}) as Record<string, any>;
    return {
      sidc: s.sidc,
      symbolKey: s.symbolKey,
      symbolDefinition: def || ({ Name: drawEssentials.SYM_NAME, SymGeoType: s.kind } as SymbolDefinition),
      amplifier,
      drawEssentials,
      attributes: {
        ...oldAttrs,
        sidc: s.sidc,
        drawEssentials,
      },
    };
  }

  private save(): void {
    if (!this.state || !this.callbacks) return;
    if (this.validate(this.state).length) {
      this.render();
      return;
    }

    const editedState = this.buildEditedState(this.state);

    // ── [Morphix DEBUG] remove after diagnosis ─────────────────────────────
    console.log('[Morphix DEBUG] save() → applyEdit', {
      kind: this.state.kind,
      symbolKey: this.state.symbolKey,
      sidc: this.state.sidc,
      isDirty: JSON.stringify(this.serialize(this.state)) !== this.originalSnapshot,
    });
    // ───────────────────────────────────────────────────────────────────────

    try {
      const result = this.callbacks.applyEdit(this.state.graphic, editedState);
      // ── [Morphix DEBUG] remove after diagnosis ───────────────────────────
      console.log('[Morphix DEBUG] save() ← applyEdit returned', {
        kind: this.state.kind,
        gotGraphic: !!result,
      });
      // ─────────────────────────────────────────────────────────────────────
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
    // Preserve the symbol's native length (this codebase uses both 20- and 30-char
    // SIDCs); only pad short codes up to the 20-char minimum.
    if (digits.length >= 20) return digits;
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

  /**
   * Resolve the innermost OPTIONS object for a Force (FPoint) symbol. At runtime the
   * OPTIONS payload can be nested (`de.OPTIONS.OPTIONS`) because UEISymbol stores the
   * drawEssentials it was initialised with as `OPTIONS`, and plan loads put the real
   * milsymbol options one level deeper. Descend until there's no further `.OPTIONS`.
   */
  private resolveOptions(de: Record<string, any>): Record<string, any> {
    let o = de?.OPTIONS;
    let guard = 0;
    while (o && typeof o.OPTIONS === 'object' && o.OPTIONS !== null && guard++ < 6) {
      o = o.OPTIONS;
    }
    return o && typeof o === 'object' ? (o as Record<string, any>) : {};
  }

  /** Return the first argument that is neither null/undefined nor an empty/blank string. */
  /** Read a flat graphic attribute as symbol data, skipping record bookkeeping. */
  private attrValue(attrs: Record<string, any>, key: string): any {
    return RESERVED_GRAPHIC_ATTRS.has(key) ? undefined : attrs[key];
  }

  private firstFilled(...vals: any[]): any {
    for (const v of vals) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
    return '';
  }

  /** Resolve a raw SYM_GEO_TYPE / SymGeoType string to one of the four canonical kinds. */
  private geomKindOf(value?: string): GeoKind | '' {
    const v = String(value || '').toLowerCase();
    if (v === 'fpoint') return 'FPoint';
    if (v === 'point') return 'Point';
    if (v === 'line' || v === 'polyline') return 'Line';
    if (v === 'area' || v === 'polygon') return 'Area';
    return '';
  }

  /** Best-effort geometry kind from the graphic when SYM_GEO_TYPE is missing. */
  private geomTypeOf(graphic: Graphic): string {
    const t = (graphic?.geometry as any)?.type;
    if (t === 'polyline') return 'Line';
    if (t === 'polygon') return 'Area';
    if (t === 'point') return 'Point';
    return '';
  }

  private geomLabel(kind: GeoKind | '' | undefined): string {
    switch (kind) {
      case 'Point':  return 'Point';
      case 'FPoint': return 'Force Point';
      case 'Line':   return 'Line';
      case 'Area':   return 'Area';
      default:       return '—';
    }
  }

  /**
   * Plain JSON clone — for amplifier/draw/label/extra/cim fields only. Never use
   * on ArcGIS geometry.
   *
   * Carries a `seen` set of the objects on the current recursion path so a
   * circular reference (e.g. a stray `SCOPE` renderer back-reference or an
   * ArcGIS geometry that slipped into the payload) is cut instead of overflowing
   * the stack. Add-before / delete-after means shared-but-acyclic references
   * (a DAG) still clone fully — only true back-edges are dropped.
   */
  private jsonClone<T>(value: T, seen?: Set<unknown>, depth = 0): T {
    if (value === null || typeof value !== 'object') return value;
    if (depth > 200) return undefined as any; // pathological depth — bail rather than overflow
    // Live SDK objects are references, not data. Every ArcGIS Accessor subclass
    // (View, Map, Layer, Graphic, Geometry, Symbol, ...) carries declaredClass,
    // and their graphs reach the view — cloning one is unbounded, not merely
    // wasteful. Geometry that must survive goes through cloneGeometry() instead.
    if (typeof (value as any).declaredClass === 'string') return undefined as any;
    if (typeof Node !== 'undefined' && value instanceof Node) return undefined as any;
    const path = seen ?? new Set<unknown>();
    if (path.has(value)) return undefined as any; // circular — cut this branch
    path.add(value);
    let out: any;
    if (Array.isArray(value)) {
      out = value.map((v) => this.jsonClone(v, path, depth + 1));
    } else {
      out = {};
      for (const k of Object.keys(value as any)) {
        const v = (value as any)[k];
        if (typeof v === 'function') continue;
        out[k] = this.jsonClone(v, path, depth + 1);
      }
    }
    path.delete(value);
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
    if (type === 'number') {
      if (t === '') return undefined;
      const n = Number(t);
      return Number.isFinite(n) ? n : undefined;
    }
    if (t === '') return '';
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
