import Graphic from '@arcgis/core/Graphic';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';

import GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
import Amplifier from '../../Support/Amplifier';
import DrawEssentials from '../../Support/DrawEssentials';
import symbolData from '../../Data/Symbols.json';
// The same milsymbol renderer the briefing tools use, for the live Force-symbol
// preview. It caches by SIDC + size + amplifiers, so re-rendering on every
// keystroke costs a map lookup once the combination has been seen.
import { renderMilSym } from '../Briefing/MilSymFactory';

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
// SIDC lookup tables (MIL-STD-2525D)
//
// Labels are deliberately plain language. The two-digit code each option used to
// carry in its label ("18 — Brigade", "15 — Land Equipment") is what the SIDC
// stores, not something an operator should have to read or match — the digits
// still live in `value`, so the generated SIDC is byte-for-byte the same.

type Option = { value: string; label: string };

/** Position 2 — reality / exercise / simulation. */
const SIDC_CONTEXT: Option[] = [
  { value: '0', label: 'Real world' },
  { value: '1', label: 'Exercise' },
  { value: '2', label: 'Simulation' },
];

/**
 * Position 3 — standard identity, ordered by how often it gets picked rather
 * than by code value so the everyday three sit at the top of the list.
 */
const SIDC_IDENTITY: Option[] = [
  { value: '3', label: 'Friendly' },
  { value: '6', label: 'Hostile' },
  { value: '4', label: 'Neutral' },
  { value: '1', label: 'Unknown' },
  { value: '2', label: 'Assumed friend' },
  { value: '5', label: 'Suspect' },
  { value: '0', label: 'Pending' },
];

/** Positions 4–5 — symbol set. */
const SIDC_SET: Option[] = [
  { value: '10', label: 'Land unit' },
  { value: '15', label: 'Land equipment' },
  { value: '20', label: 'Land installation' },
  { value: '11', label: 'Land civilian unit / organisation' },
  { value: '27', label: 'Dismounted individual' },
  { value: '25', label: 'Control measure' },
  { value: '01', label: 'Air' },
  { value: '02', label: 'Air missile' },
  { value: '05', label: 'Space' },
  { value: '06', label: 'Space missile' },
  { value: '30', label: 'Sea surface' },
  { value: '35', label: 'Sea subsurface' },
  { value: '36', label: 'Mine warfare' },
  { value: '40', label: 'Activity / event' },
  { value: '50', label: 'Cyberspace' },
  { value: '00', label: 'Unknown' },
];

/** Position 6 — operational status / condition. */
const SIDC_STATUS: Option[] = [
  { value: '0', label: 'Present' },
  { value: '1', label: 'Planned / anticipated' },
  { value: '2', label: 'Fully capable' },
  { value: '3', label: 'Damaged' },
  { value: '4', label: 'Destroyed' },
  { value: '5', label: 'Full to capacity' },
];

/** Position 7 — headquarters / task force / feint. */
const SIDC_HQTF: Option[] = [
  { value: '0', label: 'Normal unit' },
  { value: '2', label: 'Headquarters' },
  { value: '4', label: 'Task force' },
  { value: '6', label: 'Task force headquarters' },
  { value: '1', label: 'Feint / dummy' },
  { value: '3', label: 'Feint / dummy headquarters' },
  { value: '5', label: 'Feint / dummy task force' },
  { value: '7', label: 'Feint / dummy task force HQ' },
];

/** Positions 8–9 — echelon / size amplifier. */
const SIDC_ECHELON: Option[] = [
  { value: '00', label: 'None' },
  { value: '11', label: 'Team / crew' },
  { value: '12', label: 'Squad' },
  { value: '13', label: 'Section' },
  { value: '14', label: 'Platoon / detachment' },
  { value: '15', label: 'Company / battery / troop' },
  { value: '16', label: 'Battalion / squadron' },
  { value: '17', label: 'Regiment / group' },
  { value: '18', label: 'Brigade' },
  { value: '21', label: 'Division' },
  { value: '22', label: 'Corps / MEF' },
  { value: '23', label: 'Army' },
  { value: '24', label: 'Army group / front' },
  { value: '25', label: 'Region / theatre' },
  { value: '26', label: 'Command' },
];

/**
 * Country amplifier picker. The stored value stays the ISO 3166-1 / GENC
 * three-letter code — what MIL-STD-2525D puts in the Country field and what the
 * label renderer draws — while the list shows the country name, so nobody has to
 * remember that Germany is DEU. A code already on a symbol that isn't in this
 * list is preserved and offered back as a custom entry (see `countryField`).
 */
const COUNTRIES: Option[] = [
  { value: 'AFG', label: 'Afghanistan' },
  { value: 'ALB', label: 'Albania' },
  { value: 'DZA', label: 'Algeria' },
  { value: 'AND', label: 'Andorra' },
  { value: 'AGO', label: 'Angola' },
  { value: 'ARG', label: 'Argentina' },
  { value: 'ARM', label: 'Armenia' },
  { value: 'AUS', label: 'Australia' },
  { value: 'AUT', label: 'Austria' },
  { value: 'AZE', label: 'Azerbaijan' },
  { value: 'BHS', label: 'Bahamas' },
  { value: 'BHR', label: 'Bahrain' },
  { value: 'BGD', label: 'Bangladesh' },
  { value: 'BRB', label: 'Barbados' },
  { value: 'BLR', label: 'Belarus' },
  { value: 'BEL', label: 'Belgium' },
  { value: 'BLZ', label: 'Belize' },
  { value: 'BEN', label: 'Benin' },
  { value: 'BTN', label: 'Bhutan' },
  { value: 'BOL', label: 'Bolivia' },
  { value: 'BIH', label: 'Bosnia and Herzegovina' },
  { value: 'BWA', label: 'Botswana' },
  { value: 'BRA', label: 'Brazil' },
  { value: 'BRN', label: 'Brunei' },
  { value: 'BGR', label: 'Bulgaria' },
  { value: 'BFA', label: 'Burkina Faso' },
  { value: 'BDI', label: 'Burundi' },
  { value: 'CPV', label: 'Cabo Verde' },
  { value: 'KHM', label: 'Cambodia' },
  { value: 'CMR', label: 'Cameroon' },
  { value: 'CAN', label: 'Canada' },
  { value: 'CAF', label: 'Central African Republic' },
  { value: 'TCD', label: 'Chad' },
  { value: 'CHL', label: 'Chile' },
  { value: 'CHN', label: 'China' },
  { value: 'COL', label: 'Colombia' },
  { value: 'COM', label: 'Comoros' },
  { value: 'COG', label: 'Congo (Republic)' },
  { value: 'COD', label: 'Congo (DRC)' },
  { value: 'CRI', label: 'Costa Rica' },
  { value: 'CIV', label: 'Cote d Ivoire' },
  { value: 'HRV', label: 'Croatia' },
  { value: 'CUB', label: 'Cuba' },
  { value: 'CYP', label: 'Cyprus' },
  { value: 'CZE', label: 'Czechia' },
  { value: 'DNK', label: 'Denmark' },
  { value: 'DJI', label: 'Djibouti' },
  { value: 'DMA', label: 'Dominica' },
  { value: 'DOM', label: 'Dominican Republic' },
  { value: 'ECU', label: 'Ecuador' },
  { value: 'EGY', label: 'Egypt' },
  { value: 'SLV', label: 'El Salvador' },
  { value: 'GNQ', label: 'Equatorial Guinea' },
  { value: 'ERI', label: 'Eritrea' },
  { value: 'EST', label: 'Estonia' },
  { value: 'SWZ', label: 'Eswatini' },
  { value: 'ETH', label: 'Ethiopia' },
  { value: 'FJI', label: 'Fiji' },
  { value: 'FIN', label: 'Finland' },
  { value: 'FRA', label: 'France' },
  { value: 'GAB', label: 'Gabon' },
  { value: 'GMB', label: 'Gambia' },
  { value: 'GEO', label: 'Georgia' },
  { value: 'DEU', label: 'Germany' },
  { value: 'GHA', label: 'Ghana' },
  { value: 'GRC', label: 'Greece' },
  { value: 'GRD', label: 'Grenada' },
  { value: 'GTM', label: 'Guatemala' },
  { value: 'GIN', label: 'Guinea' },
  { value: 'GNB', label: 'Guinea-Bissau' },
  { value: 'GUY', label: 'Guyana' },
  { value: 'HTI', label: 'Haiti' },
  { value: 'HND', label: 'Honduras' },
  { value: 'HUN', label: 'Hungary' },
  { value: 'ISL', label: 'Iceland' },
  { value: 'IND', label: 'India' },
  { value: 'IDN', label: 'Indonesia' },
  { value: 'IRN', label: 'Iran' },
  { value: 'IRQ', label: 'Iraq' },
  { value: 'IRL', label: 'Ireland' },
  { value: 'ISR', label: 'Israel' },
  { value: 'ITA', label: 'Italy' },
  { value: 'JAM', label: 'Jamaica' },
  { value: 'JPN', label: 'Japan' },
  { value: 'JOR', label: 'Jordan' },
  { value: 'KAZ', label: 'Kazakhstan' },
  { value: 'KEN', label: 'Kenya' },
  { value: 'KIR', label: 'Kiribati' },
  { value: 'PRK', label: 'Korea, North' },
  { value: 'KOR', label: 'Korea, South' },
  { value: 'KWT', label: 'Kuwait' },
  { value: 'KGZ', label: 'Kyrgyzstan' },
  { value: 'LAO', label: 'Laos' },
  { value: 'LVA', label: 'Latvia' },
  { value: 'LBN', label: 'Lebanon' },
  { value: 'LSO', label: 'Lesotho' },
  { value: 'LBR', label: 'Liberia' },
  { value: 'LBY', label: 'Libya' },
  { value: 'LIE', label: 'Liechtenstein' },
  { value: 'LTU', label: 'Lithuania' },
  { value: 'LUX', label: 'Luxembourg' },
  { value: 'MDG', label: 'Madagascar' },
  { value: 'MWI', label: 'Malawi' },
  { value: 'MYS', label: 'Malaysia' },
  { value: 'MDV', label: 'Maldives' },
  { value: 'MLI', label: 'Mali' },
  { value: 'MLT', label: 'Malta' },
  { value: 'MHL', label: 'Marshall Islands' },
  { value: 'MRT', label: 'Mauritania' },
  { value: 'MUS', label: 'Mauritius' },
  { value: 'MEX', label: 'Mexico' },
  { value: 'FSM', label: 'Micronesia' },
  { value: 'MDA', label: 'Moldova' },
  { value: 'MCO', label: 'Monaco' },
  { value: 'MNG', label: 'Mongolia' },
  { value: 'MNE', label: 'Montenegro' },
  { value: 'MAR', label: 'Morocco' },
  { value: 'MOZ', label: 'Mozambique' },
  { value: 'MMR', label: 'Myanmar' },
  { value: 'NAM', label: 'Namibia' },
  { value: 'NRU', label: 'Nauru' },
  { value: 'NPL', label: 'Nepal' },
  { value: 'NLD', label: 'Netherlands' },
  { value: 'NZL', label: 'New Zealand' },
  { value: 'NIC', label: 'Nicaragua' },
  { value: 'NER', label: 'Niger' },
  { value: 'NGA', label: 'Nigeria' },
  { value: 'MKD', label: 'North Macedonia' },
  { value: 'NOR', label: 'Norway' },
  { value: 'OMN', label: 'Oman' },
  { value: 'PAK', label: 'Pakistan' },
  { value: 'PLW', label: 'Palau' },
  { value: 'PSE', label: 'Palestine' },
  { value: 'PAN', label: 'Panama' },
  { value: 'PNG', label: 'Papua New Guinea' },
  { value: 'PRY', label: 'Paraguay' },
  { value: 'PER', label: 'Peru' },
  { value: 'PHL', label: 'Philippines' },
  { value: 'POL', label: 'Poland' },
  { value: 'PRT', label: 'Portugal' },
  { value: 'QAT', label: 'Qatar' },
  { value: 'ROU', label: 'Romania' },
  { value: 'RUS', label: 'Russia' },
  { value: 'RWA', label: 'Rwanda' },
  { value: 'KNA', label: 'Saint Kitts and Nevis' },
  { value: 'LCA', label: 'Saint Lucia' },
  { value: 'VCT', label: 'Saint Vincent and the Grenadines' },
  { value: 'WSM', label: 'Samoa' },
  { value: 'SMR', label: 'San Marino' },
  { value: 'STP', label: 'Sao Tome and Principe' },
  { value: 'SAU', label: 'Saudi Arabia' },
  { value: 'SEN', label: 'Senegal' },
  { value: 'SRB', label: 'Serbia' },
  { value: 'SYC', label: 'Seychelles' },
  { value: 'SLE', label: 'Sierra Leone' },
  { value: 'SGP', label: 'Singapore' },
  { value: 'SVK', label: 'Slovakia' },
  { value: 'SVN', label: 'Slovenia' },
  { value: 'SLB', label: 'Solomon Islands' },
  { value: 'SOM', label: 'Somalia' },
  { value: 'ZAF', label: 'South Africa' },
  { value: 'SSD', label: 'South Sudan' },
  { value: 'ESP', label: 'Spain' },
  { value: 'LKA', label: 'Sri Lanka' },
  { value: 'SDN', label: 'Sudan' },
  { value: 'SUR', label: 'Suriname' },
  { value: 'SWE', label: 'Sweden' },
  { value: 'CHE', label: 'Switzerland' },
  { value: 'SYR', label: 'Syria' },
  { value: 'TWN', label: 'Taiwan' },
  { value: 'TJK', label: 'Tajikistan' },
  { value: 'TZA', label: 'Tanzania' },
  { value: 'THA', label: 'Thailand' },
  { value: 'TLS', label: 'Timor-Leste' },
  { value: 'TGO', label: 'Togo' },
  { value: 'TON', label: 'Tonga' },
  { value: 'TTO', label: 'Trinidad and Tobago' },
  { value: 'TUN', label: 'Tunisia' },
  { value: 'TUR', label: 'Turkiye' },
  { value: 'TKM', label: 'Turkmenistan' },
  { value: 'TUV', label: 'Tuvalu' },
  { value: 'UGA', label: 'Uganda' },
  { value: 'UKR', label: 'Ukraine' },
  { value: 'ARE', label: 'United Arab Emirates' },
  { value: 'GBR', label: 'United Kingdom' },
  { value: 'USA', label: 'United States' },
  { value: 'URY', label: 'Uruguay' },
  { value: 'UZB', label: 'Uzbekistan' },
  { value: 'VUT', label: 'Vanuatu' },
  { value: 'VAT', label: 'Vatican City' },
  { value: 'VEN', label: 'Venezuela' },
  { value: 'VNM', label: 'Vietnam' },
  { value: 'YEM', label: 'Yemen' },
  { value: 'ZMB', label: 'Zambia' },
  { value: 'ZWE', label: 'Zimbabwe' },
];

// ──────────────────────────────────────────────────────────────────────────────
// Editable field tables

type FieldType =
  | 'number'
  | 'text'
  | 'bool'
  | 'color'
  | 'select'
  /** Date + time picker that reads / writes a MIL-STD date-time group string. */
  | 'dtg'
  /** Country-name picker that stores a three-letter country code. */
  | 'country';

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
  /** Stepper bounds — also the span of the paired slider. */
  min?: number;
  max?: number;
  step?: number;
  /** Show a slider alongside the stepper, for values with a natural range. */
  slider?: boolean;
  /** Suffix shown after the stepper (°, …). */
  unit?: string;
  /** Choices for a `select` field. */
  choices?: Option[];
  /** Greyed example shown in the empty input. */
  placeholder?: string;
  /** One line of plain-language help under the input. */
  hint?: string;
}

const fs = (
  group: FieldGroup,
  key: string,
  label: string,
  type: FieldType = 'text',
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({ group, key, label, type, ...extra });

/** Reinforced / reduced is a fixed set of markers, not free text. */
const REINFORCED_CHOICES: Option[] = [
  { value: '', label: 'Neither' },
  { value: '+', label: 'Reinforced (+)' },
  { value: '-', label: 'Reduced (-)' },
  { value: '+-', label: 'Reinforced and reduced (+-)' },
];

/**
 * Amplifier fields AnnotationEngine actually draws beside the symbol — the label
 * block it builds only ever reads these seven keys.
 */
const AMPLIFIER_FIELDS_DRAWN: FieldSpec[] = [
  fs('amplifier', 'UNIQUE_DESIG', 'Unit / designation', 'text', { placeholder: 'e.g. B / 1-7' }),
  fs('amplifier', 'HIGHER_FORM', 'Higher formation', 'text', { placeholder: 'e.g. 1 Bn' }),
  fs('amplifier', 'STAFF_COM', 'Staff comments', 'text'),
  fs('amplifier', 'ADDL_INFO', 'Additional info', 'text'),
  fs('amplifier', 'TARGET_DESIGNATOR', 'Target designator', 'text'),
  fs('amplifier', 'DTG', 'Date / time', 'dtg', { hint: 'Drawn above the symbol.' }),
  fs('amplifier', 'EDTG', 'End date / time', 'dtg', { hint: 'Drawn below the symbol.' }),
];

/** Kept with the symbol and carried into exports, but never drawn on the map. */
const AMPLIFIER_FIELDS_STORED: FieldSpec[] = [
  fs('amplifier', 'TYPE', 'Type', 'text'),
  fs('amplifier', 'QUANTITY', 'Quantity', 'number', { min: 0, step: 1 }),
  fs('amplifier', 'COUNTRY', 'Country', 'country'),
  fs('amplifier', 'LOC', 'Location', 'text'),
  fs('amplifier', 'ALTITUDE_DEPTH', 'Altitude / depth', 'text'),
  fs('amplifier', 'DISTANCE', 'Distance', 'text'),
  fs('amplifier', 'AZIMUTH', 'Azimuth', 'number', { min: 0, max: 360, step: 1, unit: '°' }),
];

/** Object-form amplifier fields used by Point / Line / Area symbols. */
const AMPLIFIER_FIELDS: FieldSpec[] = [
  ...AMPLIFIER_FIELDS_DRAWN,
  ...AMPLIFIER_FIELDS_STORED,
];

/**
 * milsymbol amplifier fields for Force (FPoint) symbols. These live inside the
 * symbol's OPTIONS object — the renderer (UEISymbol) reads them from there, so
 * editing the flat amplifier would have no visible effect. Every key below is one
 * UEISymbol forwards on to milsymbol; the two it does not (`roa`, `msn`) used to
 * be offered here and drew nothing, so they are off the form. Values already
 * stored under them still survive an edit — buildState clones the whole OPTIONS
 * payload, not just the keys the form knows about.
 */
const FPOINT_FIELDS_MAIN: FieldSpec[] = [
  fs('options', 'uniqueDesignation', 'Unit / designation', 'text', { placeholder: 'e.g. A Coy' }),
  fs('options', 'higherFormation', 'Higher formation', 'text', { placeholder: 'e.g. 1 Bn' }),
  fs('options', 'type', 'Type', 'text', { placeholder: 'e.g. M1A2' }),
  fs('options', 'quantity', 'Quantity', 'number', { min: 0, step: 1 }),
  fs('options', 'reinforcedReduced', 'Reinforced / reduced', 'select', { choices: REINFORCED_CHOICES }),
  fs('options', 'staffComments', 'Staff comments', 'text'),
  fs('options', 'additionalInformation', 'Additional info', 'text'),
  fs('options', 'dtg', 'Date / time', 'dtg'),
  fs('options', 'location', 'Location', 'text'),
  fs('options', 'direction', 'Direction', 'number', { min: 0, max: 360, step: 1, unit: '°' }),
  fs('options', 'speed', 'Speed', 'text'),
  fs('options', 'altitudeDepth', 'Altitude / depth', 'text'),
];

const FPOINT_FIELDS_MORE: FieldSpec[] = [
  fs('options', 'combatEffectiveness', 'Combat effectiveness', 'text'),
  fs('options', 'evaluationRating', 'Evaluation rating', 'text'),
  fs('options', 'commonIdentifier', 'Common identifier', 'text'),
  fs('options', 'specialHeadquarters', 'Special headquarters', 'text'),
  fs('options', 'signatureEquipment', 'Signature equipment', 'text'),
  fs('options', 'platformType', 'Platform type', 'text'),
  fs('options', 'equipmentTeardownTime', 'Teardown time', 'text'),
  fs('options', 'iffSif', 'IFF / SIF', 'text'),
  fs('options', 'sigint', 'SIGINT', 'text'),
  fs('options', 'hostile', 'Hostile marker', 'text'),
];

const FPOINT_OPTION_FIELDS: FieldSpec[] = [...FPOINT_FIELDS_MAIN, ...FPOINT_FIELDS_MORE];

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
  ALTITUDE_DEPTH: 'altitudeDepth',
};
const OPT_TO_FLAT: Record<string, string> = Object.fromEntries(
  Object.entries(FLAT_TO_OPT).map(([k, v]) => [v, k]),
);

// ── Appearance ────────────────────────────────────────────────────────────────
// The handful of controls on the Look tab that an operator actually reaches for.
// Everything else that used to sit in "Draw Settings" is fine-tuning and has
// moved to Advanced.

const OPACITY_FIELD = fs('drawEssentials', 'opacity', 'Opacity', 'number', {
  min: 0,
  max: 1,
  step: 0.05,
  slider: true,
});

const ROTATION_FIELD = fs('drawEssentials', 'ANGLE', 'Rotation', 'number', {
  min: 0,
  max: 360,
  step: 1,
  slider: true,
  unit: '°',
});

const LINE_WIDTH_FIELD = fs('extraSettings', 'lineWidth', 'Line width', 'number', {
  min: 0.5,
  max: 12,
  step: 0.5,
  slider: true,
});

const LOOK_FIELDS_POINT: FieldSpec[] = [
  fs('drawEssentials', 'SIZE', 'Size', 'number', {
    min: 0,
    max: 200,
    step: 1,
    slider: true,
    hint: 'Leave at 0 to keep this symbol’s own default size.',
  }),
  ROTATION_FIELD,
  OPACITY_FIELD,
];

// FPoint "Size" is read from extraSettings.size by the milsymbol renderer;
// rotation / opacity are read from the top-level drawEssentials.
const LOOK_FIELDS_FPOINT: FieldSpec[] = [
  fs('extraSettings', 'size', 'Size', 'number', { min: 10, max: 200, step: 1, slider: true }),
  ROTATION_FIELD,
  OPACITY_FIELD,
];

const LOOK_FIELDS_LINE: FieldSpec[] = [LINE_WIDTH_FIELD, OPACITY_FIELD];
const LOOK_FIELDS_AREA: FieldSpec[] = [LINE_WIDTH_FIELD, OPACITY_FIELD];

// ── Advanced ──────────────────────────────────────────────────────────────────

const FREEHAND_FIELDS: FieldSpec[] = [
  fs('drawEssentials', 'ISFHAND', 'Freehand stroke', 'bool'),
  fs('drawEssentials', 'FRHNDSZ', 'Freehand size', 'number', { min: 0, step: 1 }),
  fs('drawEssentials', 'FRHNDWDTH', 'Freehand width', 'number', { min: 0, step: 0.5 }),
];

const DRAW_TYPE_FIELD = fs('drawEssentials', 'DRAW_TYPE', 'Draw type', 'number', {
  min: 0,
  step: 1,
  hint: 'Variant index defined by this symbol’s own class.',
});

const ADV_FIELDS_POINT: FieldSpec[] = [
  fs('drawEssentials', 'OFFSET', 'Offset', 'text'),
  ...FREEHAND_FIELDS,
];

const ADV_FIELDS_FPOINT: FieldSpec[] = [];

const ADV_FIELDS_LINE: FieldSpec[] = [
  DRAW_TYPE_FIELD,
  fs('drawEssentials', 'ARROWHEAD_RATIO', 'Arrowhead ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'BK_LN_DIST_RATIO', 'Back line distance ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'BK_LN_ANGL_RATIO', 'Back line angle ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'FRNT_LN_DIST_RATIO', 'Front line distance ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'FRNT_LN_ANGL_RATIO', 'Front line angle ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'FLAP_DIST_RATIO', 'Flap distance ratio', 'number', { min: 0, step: 0.1 }),
  fs('drawEssentials', 'FLAP_ANGLE', 'Flap angle', 'number', { min: 0, max: 360, step: 1, unit: '°' }),
  ...FREEHAND_FIELDS,
];

const ADV_FIELDS_AREA: FieldSpec[] = [DRAW_TYPE_FIELD, ...FREEHAND_FIELDS];

/**
 * extraSettings leftovers worth exposing. `size` and `lineWidth` are already on
 * the Look tab for the families that use them, and `opacity` is the same value
 * the Look tab's Opacity writes (SymbolEngine reads extraSettings.opacity in
 * preference to the drawEssentials copy — see applyStyleMirror), so offering it
 * twice would only invite the two copies to disagree.
 */
const EXTRA_ADV_FIELDS: FieldSpec[] = [
  fs('extraSettings', 'textSize', 'Marker text size', 'number', { min: 6, max: 72, step: 1 }),
];

// Cross-platform, 3D-safe font families (kept in sync with TextStyleSettingsManifest).
const FONT_FAMILIES: Option[] = [
  'Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Georgia', 'Trebuchet MS',
].map((f) => ({ value: f, label: f }));

const LABEL_FIELDS: FieldSpec[] = [
  fs('labelOptions', 'fontFamily', 'Font', 'select', { choices: FONT_FAMILIES }),
  fs('labelOptions', 'textSize', 'Text size', 'number', { min: 6, max: 72, step: 1, slider: true }),
  fs('labelOptions', 'color', 'Text colour', 'color'),
  fs('labelOptions', 'haloColor', 'Outline colour', 'color'),
  fs('labelOptions', 'haloColorSize', 'Outline thickness', 'number', { min: 0, max: 10, step: 0.5, slider: true }),
];

const LABEL_STYLE_TOGGLES: FieldSpec[] = [
  fs('labelOptions', 'bold', 'Bold', 'bool'),
  fs('labelOptions', 'italic', 'Italic', 'bool'),
  fs('labelOptions', 'uLine', 'Underline', 'bool'),
  fs('labelOptions', 'oLine', 'Overline', 'bool'),
  fs('labelOptions', 'tLine', 'Strikethrough', 'bool'),
];

// ──────────────────────────────────────────────────────────────────────────────
// Modal chrome
//
// Scoped to #morphix-root and injected once, so the editor stays self-contained:
// it borrows the shared design tokens and .ms-* form classes from Widgets.css but
// owns its own layout (tab strip, preview card, steppers, disclosures).

/** Which pane of the editor is showing. */
type TabId = 'symbol' | 'labels' | 'look' | 'advanced';

const MORPHIX_CSS = `
#morphix-root .mx-modal {
  position: absolute;
  top: 4vh; left: 50%;
  transform: translateX(-50%);
  width: min(860px, calc(100vw - 32px));
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--ms-bg);
  border: 1px solid var(--ms-border);
  border-radius: var(--ms-radius);
  box-shadow: var(--ms-shadow);
  font-size: var(--ms-fs);
}
#morphix-root .mx-body {
  flex: 1;
  overflow-y: auto;
  padding: 2px 0 14px;
}
#morphix-root .mx-body::-webkit-scrollbar { width: 9px; }
#morphix-root .mx-body::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.14);
  border-radius: 5px;
}

/* Tab strip */
#morphix-root .mx-tabs {
  display: flex;
  gap: 2px;
  padding: 0 10px;
  background: var(--ms-bg-header);
  border-bottom: 1px solid var(--ms-divider);
}
#morphix-root .mx-tab {
  appearance: none;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--ms-text-dim);
  font-family: inherit;
  font-size: var(--ms-fs-sm);
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 10px 14px 8px;
  cursor: pointer;
  transition: var(--ms-transition);
}
#morphix-root .mx-tab:hover { color: var(--ms-text); }
#morphix-root .mx-tab.active {
  color: var(--ms-accent);
  border-bottom-color: var(--ms-accent);
}

/* Section header with its Reset affordance */
#morphix-root .mx-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 12px;
}
#morphix-root .ms-btn.mx-mini {
  padding: 3px 9px;
  font-size: var(--ms-fs-xs);
}

/* Preview card */
#morphix-root .mx-preview-card {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 12px 12px 2px;
  padding: 12px 14px;
  background: var(--ms-bg-subtle);
  border: 1px solid var(--ms-divider);
  border-radius: var(--ms-radius-sm);
}
#morphix-root .mx-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  flex: 0 0 76px;
  color: var(--ms-accent-secondary);
}
#morphix-root .mx-preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
#morphix-root .mx-preview-glyph { opacity: 0.75; }
#morphix-root .mx-preview-meta { min-width: 0; }
#morphix-root .mx-preview-name {
  font-size: var(--ms-fs-lg);
  font-weight: 600;
  color: var(--ms-text);
  line-height: 1.35;
}
#morphix-root .mx-preview-sub {
  font-size: var(--ms-fs-xs);
  color: var(--ms-text-dim);
  line-height: 1.5;
  margin-top: 2px;
}

/* Grids, notes, hints */
#morphix-root .ms-grid.mx-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 720px) {
  #morphix-root .ms-grid.mx-grid-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
#morphix-root .mx-note {
  padding: 0 12px 9px;
  font-size: var(--ms-fs-xs);
  color: var(--ms-text-dim);
  line-height: 1.6;
}
#morphix-root .mx-hint {
  font-size: var(--ms-fs-xs);
  color: var(--ms-text-dim);
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#morphix-root .mx-hint.warn { color: var(--ms-warning); }

/* Steppers and sliders */
#morphix-root .mx-num {
  display: flex;
  align-items: center;
  gap: 6px;
}
#morphix-root .mx-num .ms-input { flex: 1; min-width: 0; }
#morphix-root .mx-unit {
  font-size: var(--ms-fs-xs);
  color: var(--ms-text-dim);
  flex: 0 0 auto;
}
#morphix-root .mx-range {
  width: 100%;
  height: 4px;
  margin: 2px 0 0;
  accent-color: var(--ms-accent);
  cursor: pointer;
}
#morphix-root .mx-color {
  height: 30px;
  padding: 2px;
  cursor: pointer;
}

/* Date-time group */
#morphix-root .mx-dtg {
  display: flex;
  align-items: center;
  gap: 5px;
}
#morphix-root .mx-dtg .ms-input {
  flex: 1;
  min-width: 0;
  font-family: var(--ms-font-mono);
}

/* Checkbox row */
#morphix-root .mx-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 0 12px 10px;
}
#morphix-root .mx-check {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--ms-fs);
  color: var(--ms-text);
  cursor: pointer;
}
#morphix-root .mx-check input[type="checkbox"] {
  accent-color: var(--ms-accent);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

/* Disclosure */
#morphix-root .mx-details {
  margin: 0 12px 10px;
  border: 1px solid var(--ms-divider);
  border-radius: var(--ms-radius-sm);
  background: rgba(0, 0, 0, 0.12);
}
#morphix-root .mx-details > summary {
  padding: 8px 11px;
  font-size: var(--ms-fs-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ms-text-label);
  cursor: pointer;
  list-style: none;
}
#morphix-root .mx-details > summary::-webkit-details-marker { display: none; }
#morphix-root .mx-details > summary::before {
  content: '▸';
  display: inline-block;
  width: 12px;
  color: var(--ms-accent);
}
#morphix-root .mx-details[open] > summary::before { content: '▾'; }
#morphix-root .mx-details[open] > summary { border-bottom: 1px solid var(--ms-divider); }
#morphix-root .mx-details .ms-grid { padding-top: 9px; }

/* Footer */
#morphix-root .mx-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  background: var(--ms-bg-header);
  border-top: 1px solid var(--ms-divider);
}
#morphix-root .mx-footer-msg {
  flex: 1;
  min-width: 0;
  font-size: var(--ms-fs-xs);
  color: var(--ms-text-dim);
  line-height: 1.5;
}
#morphix-root .mx-footer-msg.bad { color: var(--ms-danger); }
#morphix-root .mx-footer-msg.warn { color: var(--ms-warning); }
#morphix-root .mx-footer-btns { display: flex; gap: 6px; }
`;

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
  /** Which pane is showing. Survives value edits and re-renders, resets on close. */
  private activeTab: TabId = 'symbol';
  /** Ids of the disclosures the user has opened — see `disclosure()`. */
  private openGroups = new Set<string>();
  /** True while the footer is asking whether to throw away unsaved edits. */
  private confirmDiscard = false;

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
    this.activeTab = 'symbol';
    this.confirmDiscard = false;
    this.openGroups.clear();
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
    this.ensureStyle();
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

  /** Inject the editor's own stylesheet once. Idempotent — keyed off its element id. */
  private ensureStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('morphix-style')) return;
    const style = document.createElement('style');
    style.id = 'morphix-style';
    style.textContent = MORPHIX_CSS;
    document.head.appendChild(style);
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
    this.ensureStyle();
    this.root.style.display = 'block';

    const s = this.state;
    const def = SYMBOLS[s.symbolKey];
    const errors = this.validate(s);
    const isValid = errors.length === 0;
    const dirty = this.isDirty();

    const tabs = this.tabs();
    if (!tabs.some((t) => t.id === this.activeTab)) this.activeTab = tabs[0].id;

    this.root.innerHTML = `
      <div data-action="dismiss" style="position:absolute;inset:0;"></div>
      <section class="mx-modal" role="dialog" aria-modal="true" aria-label="Edit symbol">
        ${this.renderHeader(def)}
        ${this.renderTabStrip(tabs)}
        <div class="mx-body">${this.renderTabPanel(def)}</div>
        ${this.renderFooter(errors, isValid, dirty)}
      </section>
    `;

    this.wire();
    this.restoreFocus();
  }

  /**
   * Update only the parts of the modal that depend on field values — the footer
   * status / Save button enabled-state and the live preview — WITHOUT rebuilding
   * the form. This keeps the editable inputs (and the Save button) alive and
   * focused, so a value edit followed immediately by a Save click doesn't destroy
   * the button mid-click. Used for plain value / bool / colour edits; structural
   * changes (SIDC, symbol swap, tab switch, reset) still go through render().
   */
  private refreshDynamic(): void {
    if (!this.root || !this.state) return;
    const errors = this.validate(this.state);
    const isValid = errors.length === 0;
    const dirty = this.isDirty();

    const saveBtn = this.root.querySelector(
      '[data-action="save"]',
    ) as HTMLButtonElement | null;
    if (saveBtn) saveBtn.disabled = !(isValid && dirty);

    const msg = this.root.querySelector('[data-mx="footer-msg"]') as HTMLElement | null;
    if (msg) {
      msg.textContent = isValid ? this.statusText(dirty) : errors.join(' · ');
      msg.className = isValid ? 'mx-footer-msg' : 'mx-footer-msg bad';
    }

    const preview = this.root.querySelector('[data-mx="preview"]') as HTMLElement | null;
    if (preview) preview.innerHTML = this.previewMarkup();
  }

  private statusText(dirty: boolean): string {
    return dirty ? 'Unsaved changes.' : 'Nothing changed yet.';
  }

  private isDirty(): boolean {
    if (!this.state) return false;
    return JSON.stringify(this.serialize(this.state)) !== this.originalSnapshot;
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────

  private renderHeader(def?: SymbolDefinition): string {
    const s = this.state!;
    const name = def?.Name || s.drawEssentials.SYM_NAME || 'Symbol';
    return `
      <div class="ms-header" style="cursor:default;">
        <div class="ms-header-icon">MX</div>
        <div class="ms-header-title">${this.esc(name)}</div>
        <span class="ms-status-lbl">${this.esc(this.geomLabel(s.kind))}</span>
        <button class="ms-header-btn" type="button" data-action="dismiss" title="Close (Esc)">×</button>
      </div>
    `;
  }

  private tabs(): Array<{ id: TabId; label: string }> {
    return [
      { id: 'symbol', label: 'Symbol' },
      { id: 'labels', label: 'Labels' },
      { id: 'look', label: 'Look' },
      { id: 'advanced', label: 'Advanced' },
    ];
  }

  private renderTabStrip(tabs: Array<{ id: TabId; label: string }>): string {
    return `
      <div class="mx-tabs" role="tablist">
        ${tabs
          .map(
            (t) => `
          <button type="button" role="tab" class="mx-tab${t.id === this.activeTab ? ' active' : ''}"
                  aria-selected="${t.id === this.activeTab}"
                  data-action="tab" data-tab="${this.esc(t.id)}">${this.esc(t.label)}</button>`,
          )
          .join('')}
      </div>
    `;
  }

  private renderTabPanel(def?: SymbolDefinition): string {
    switch (this.activeTab) {
      case 'labels':   return this.renderLabelsTab();
      case 'look':     return this.renderLookTab();
      case 'advanced': return this.renderAdvancedTab();
      default:         return this.renderSymbolTab(def);
    }
  }

  private renderFooter(errors: string[], isValid: boolean, dirty: boolean): string {
    if (this.confirmDiscard) {
      return `
        <div class="mx-footer">
          <div class="mx-footer-msg warn">Close without saving? Your edits to this symbol will be lost.</div>
          <div class="mx-footer-btns">
            <button type="button" class="ms-btn" data-action="keep-editing">Keep editing</button>
            <button type="button" class="ms-btn danger" data-action="discard">Discard</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="mx-footer">
        <div class="mx-footer-msg${isValid ? '' : ' bad'}" data-mx="footer-msg">
          ${isValid ? this.esc(this.statusText(dirty)) : errors.map((e) => this.esc(e)).join(' · ')}
        </div>
        <div class="mx-footer-btns">
          <button type="button" class="ms-btn" data-action="dismiss">Cancel</button>
          <button type="button" class="ms-btn primary" data-action="save" ${isValid && dirty ? '' : 'disabled'}>Save</button>
        </div>
      </div>
    `;
  }

  // ── Tab: Symbol ─────────────────────────────────────────────────────────────

  private renderSymbolTab(def?: SymbolDefinition): string {
    const s = this.state!;
    const padded = s.sidc.padEnd(20, '0');
    const seg = (start: number, end: number) => padded.slice(start, end);

    return `
      ${this.renderPreviewCard(def)}
      ${this.sectionHead('Who and what')}
      <div class="ms-grid mx-grid-3">
        ${this.sidcCombo('Affiliation', 'sidc-identity', seg(3, 4), SIDC_IDENTITY)}
        ${this.sidcCombo('Size / echelon', 'sidc-echelon', seg(8, 10), SIDC_ECHELON)}
        ${this.sidcCombo('Role', 'sidc-hqtf', seg(7, 8), SIDC_HQTF)}
        ${this.sidcCombo('Status', 'sidc-status', seg(6, 7), SIDC_STATUS)}
        ${this.sidcCombo('Category', 'sidc-set', seg(4, 6), SIDC_SET)}
        ${this.sidcCombo('Scenario', 'sidc-context', seg(2, 3), SIDC_CONTEXT)}
      </div>
      ${this.renderSymbolSwap(def)}
    `;
  }

  /**
   * Live symbol preview. Force symbols go through the same milsymbol renderer the
   * map uses, so a designation typed on the Labels tab shows up here immediately;
   * the other families have no off-map renderer, so they get a geometry glyph and
   * their catalogue name instead.
   */
  private renderPreviewCard(def?: SymbolDefinition): string {
    const s = this.state!;
    return `
      <div class="mx-preview-card">
        <div class="mx-preview" data-mx="preview">${this.previewMarkup()}</div>
        <div class="mx-preview-meta">
          <div class="mx-preview-name">${this.esc(def?.Name || s.drawEssentials.SYM_NAME || 'Symbol')}</div>
          <div class="mx-preview-sub">${this.esc(this.geomLabel(s.kind))}${
            def?.Description ? ' · ' + this.esc(def.Description) : ''
          }</div>
        </div>
      </div>
    `;
  }

  private previewMarkup(): string {
    const s = this.state!;
    if (s.kind === 'FPoint') {
      try {
        const render = renderMilSym(s.sidc, s.options as Record<string, string>, 108);
        if (render) {
          return `<img class="mx-preview-img" alt="Symbol preview" src="${render.canvas.toDataURL()}">`;
        }
      } catch {
        // A hand-edited or future SIDC milsymbol rejects — fall through to the glyph.
      }
    }
    return `<div class="mx-preview-glyph">${this.kindGlyph(s.kind)}</div>`;
  }

  private kindGlyph(kind: GeoKind | ''): string {
    const open = '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">';
    switch (kind) {
      case 'Line':
        return `${open}<path d="M6 46 L22 22 L40 38 L58 14"/><circle cx="6" cy="46" r="4" fill="currentColor" stroke="none"/><circle cx="58" cy="14" r="4" fill="currentColor" stroke="none"/></svg>`;
      case 'Area':
        return `${open}<path d="M10 22 L34 8 L56 26 L46 52 L16 48 Z" fill="currentColor" fill-opacity="0.15"/></svg>`;
      default:
        return `${open}<circle cx="32" cy="32" r="10" fill="currentColor" fill-opacity="0.2"/><path d="M32 6v10M32 48v10M6 32h10M48 32h10"/></svg>`;
    }
  }

  private sidcCombo(label: string, kind: string, value: string, options: Option[]): string {
    const known = options.some((o) => o.value === value);
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(label)}</span>
        <select class="ms-select" data-kind="${this.esc(kind)}">
          ${options
            .map(
              (o) =>
                `<option value="${this.esc(o.value)}" ${o.value === value ? 'selected' : ''}>${this.esc(o.label)}</option>`,
            )
            .join('')}
          ${known ? '' : `<option value="${this.esc(value)}" selected>Other (${this.esc(value)})</option>`}
        </select>
      </div>
    `;
  }

  private renderSymbolSwap(def?: SymbolDefinition): string {
    const s = this.state!;

    // Lines and areas use a fixed SymbolEngine class — swapping changes rendering
    // wholesale. Restrict the picker to the point families, like milsymbol.net.
    if (s.kind !== 'Point' && s.kind !== 'FPoint') {
      return `
        ${this.sectionHead('Symbol type')}
        <div class="mx-note">
          A ${this.esc(this.geomLabel(s.kind).toLowerCase())} graphic keeps the type it was drawn as.
          Change its affiliation, size or status above, or delete it and draw the type you want.
        </div>
      `;
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
      .map(
        ([k, d]) =>
          `<option value="${this.esc(k)}" ${k === s.symbolKey ? 'selected' : ''}>${this.esc(d.Name || k)}</option>`,
      )
      .join('');

    const count = filtered.length === 1 ? '1 match' : `${filtered.length} matches`;
    const more = filtered.length > limit ? ` · showing first ${limit}` : '';

    return `
      ${this.sectionHead('Symbol type')}
      <div class="ms-grid">
        <div class="ms-field">
          <span class="ms-label">Search</span>
          <input class="ms-input" type="search" placeholder="Type to filter, e.g. tank"
                 value="${this.esc(this.symbolFilter)}" data-kind="symbol-filter">
        </div>
        <div class="ms-field">
          <span class="ms-label">Symbol</span>
          <select class="ms-select" data-kind="symbol-key" size="1">${options}</select>
          <span class="mx-hint">${this.esc(count + more)}</span>
        </div>
      </div>
      ${def?.Description ? `<div class="mx-note">${this.esc(def.Description)}</div>` : ''}
    `;
  }

  // ── Tab: Labels ─────────────────────────────────────────────────────────────

  private renderLabelsTab(): string {
    const s = this.state!;
    const isFPoint = s.kind === 'FPoint';
    const values = isFPoint ? s.options : s.amplifier;
    const main = isFPoint ? FPOINT_FIELDS_MAIN : AMPLIFIER_FIELDS_DRAWN;
    const more = isFPoint ? FPOINT_FIELDS_MORE : AMPLIFIER_FIELDS_STORED;

    return `
      ${this.sectionHead('Text on this symbol', 'reset-amplifiers')}
      <div class="mx-note">Leave a box empty to keep that label off the map.</div>
      <div class="ms-grid mx-grid-3">
        ${main.map((f) => this.field(f, values[f.key])).join('')}
      </div>
      ${this.disclosure(
        'labels-more',
        isFPoint ? 'More amplifiers' : 'Extra details (stored, not drawn)',
        `<div class="ms-grid mx-grid-3">
           ${more.map((f) => this.field(f, values[f.key])).join('')}
         </div>`,
      )}
    `;
  }

  // ── Tab: Look ───────────────────────────────────────────────────────────────

  private renderLookTab(): string {
    const s = this.state!;
    const look = this.lookFieldsFor(s.kind);

    return `
      ${this.sectionHead('Size and opacity', 'reset-draw')}
      <div class="ms-grid mx-grid-3">
        ${look.map((f) => this.field(f, this.groupValue(s, f.group)[f.key])).join('')}
      </div>
      ${this.sectionHead('Label appearance', 'reset-labels')}
      <div class="ms-grid mx-grid-3">
        ${LABEL_FIELDS.map((f) => this.field(f, s.labelOptions[f.key])).join('')}
      </div>
      <div class="mx-toggles">
        ${LABEL_STYLE_TOGGLES.map((f) => this.boolField(f, s.labelOptions[f.key])).join('')}
      </div>
    `;
  }

  // ── Tab: Advanced ───────────────────────────────────────────────────────────

  private renderAdvancedTab(): string {
    const s = this.state!;
    const adv = this.advFieldsFor(s.kind);
    const cimKeys = Object.keys(s.cim);

    const shapeBlock = adv.length
      ? `<div class="ms-grid mx-grid-3">
           ${adv.map((f) => this.field(f, this.groupValue(s, f.group)[f.key])).join('')}
         </div>`
      : `<div class="mx-note">This symbol family has no shape controls to tune.</div>`;

    return `
      ${this.sectionHead('Fine tuning', 'reset-draw')}
      <div class="mx-note">
        These feed the symbol's drawing maths. Most plans never need them — the defaults
        come from the symbol's own class.
      </div>
      ${shapeBlock}
      <div class="ms-grid mx-grid-3">
        ${EXTRA_ADV_FIELDS.map((f) => this.field(f, s.extraSettings[f.key])).join('')}
      </div>
      ${
        cimKeys.length
          ? `${this.sectionHead('Fill pattern')}
             <div class="ms-grid mx-grid-3">
               ${cimKeys.map((k) => this.field(fs('cim', k, k, 'text'), s.cim[k])).join('')}
             </div>`
          : ''
      }
    `;
  }

  private lookFieldsFor(kind: GeoKind | ''): FieldSpec[] {
    switch (kind) {
      case 'FPoint': return LOOK_FIELDS_FPOINT;
      case 'Line':   return LOOK_FIELDS_LINE;
      case 'Area':   return LOOK_FIELDS_AREA;
      default:       return LOOK_FIELDS_POINT;
    }
  }

  private advFieldsFor(kind: GeoKind | ''): FieldSpec[] {
    switch (kind) {
      case 'FPoint': return ADV_FIELDS_FPOINT;
      case 'Line':   return ADV_FIELDS_LINE;
      case 'Area':   return ADV_FIELDS_AREA;
      default:       return ADV_FIELDS_POINT;
    }
  }

  private groupValue(s: EditableState, group: FieldGroup): Record<string, any> {
    return (s as any)[group] as Record<string, any>;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Layout helpers

  private sectionHead(title: string, resetAction?: string): string {
    const reset = resetAction
      ? `<button type="button" class="ms-btn mx-mini" data-action="${this.esc(resetAction)}"
                 title="Put this section back the way it was">Reset</button>`
      : '';
    return `
      <div class="mx-section">
        <div class="ms-section-title">${this.esc(title)}</div>
        ${reset}
      </div>
    `;
  }

  /**
   * Collapsible group. Open/closed state lives on the engine rather than on the
   * DOM node so a re-render (tab switch, SIDC edit) doesn't snap it shut again.
   */
  private disclosure(id: string, title: string, body: string): string {
    const open = this.openGroups.has(id);
    return `
      <details class="mx-details" data-mx-group="${this.esc(id)}" ${open ? 'open' : ''}>
        <summary>${this.esc(title)}</summary>
        ${body}
      </details>
    `;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Field builders

  private field(spec: FieldSpec, value: any): string {
    switch (spec.type) {
      case 'bool':    return this.boolField(spec, value);
      case 'color':   return this.colorField(spec, value);
      case 'select':  return this.selectField(spec, value);
      case 'number':  return this.numberField(spec, value);
      case 'dtg':     return this.dtgField(spec, value);
      case 'country': return this.countryField(spec, value);
      default:        return this.textField(spec, value);
    }
  }

  /** `data-` attributes every editable control carries so onInput can route it. */
  private dataAttrs(spec: FieldSpec, kind: string): string {
    return `data-kind="${this.esc(kind)}" data-group="${this.esc(spec.group)}" data-key="${this.esc(spec.key)}" data-type="${this.esc(spec.type)}"`;
  }

  private hintMarkup(spec: FieldSpec): string {
    return spec.hint ? `<span class="mx-hint">${this.esc(spec.hint)}</span>` : '';
  }

  private textField(spec: FieldSpec, value: any): string {
    const v =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <input class="ms-input" type="text" ${this.dataAttrs(spec, 'value')}
               ${spec.placeholder ? `placeholder="${this.esc(spec.placeholder)}"` : ''}
               value="${this.esc(v)}">
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  /**
   * Numeric stepper — a real `type="number"` input with arrows and bounds, plus an
   * optional slider for values with a natural range (rotation, opacity, size). Both
   * controls carry the same group/key, and `syncSiblings` keeps them in step.
   */
  private numberField(spec: FieldSpec, value: any): string {
    const num = value === null || value === undefined || value === '' ? '' : String(value);
    const bounds = [
      spec.min !== undefined ? `min="${spec.min}"` : '',
      spec.max !== undefined ? `max="${spec.max}"` : '',
      `step="${spec.step ?? 1}"`,
    ].join(' ');

    const slider =
      spec.slider && spec.min !== undefined && spec.max !== undefined
        ? `<input class="mx-range" type="range" ${bounds}
                  value="${this.esc(num === '' ? String(spec.min) : num)}"
                  ${this.dataAttrs(spec, 'value')}>`
        : '';

    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <div class="mx-num">
          <input class="ms-input" type="number" ${bounds} ${this.dataAttrs(spec, 'value')}
                 value="${this.esc(num)}">
          ${spec.unit ? `<span class="mx-unit">${this.esc(spec.unit)}</span>` : ''}
        </div>
        ${slider}
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  private boolField(spec: FieldSpec, value: any): string {
    const checked = !!value && value !== 0 && value !== '0' && value !== '';
    return `
      <label class="mx-check">
        <input type="checkbox" ${this.dataAttrs(spec, 'value-bool')} ${checked ? 'checked' : ''}>
        <span>${this.esc(spec.label)}</span>
      </label>
    `;
  }

  private colorField(spec: FieldSpec, value: any): string {
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <input class="ms-input mx-color" type="color" ${this.dataAttrs(spec, 'value-color')}
               value="${this.esc(this.rgbToHex(value))}">
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  private selectField(spec: FieldSpec, value: any): string {
    const current = value == null ? '' : String(value);
    const choices = spec.choices || [];
    const known = choices.some((o) => o.value === current);
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <select class="ms-select" ${this.dataAttrs(spec, 'value-select')}>
          ${choices
            .map(
              (o) =>
                `<option value="${this.esc(o.value)}" ${o.value === current ? 'selected' : ''}>${this.esc(o.label)}</option>`,
            )
            .join('')}
          ${known ? '' : `<option value="${this.esc(current)}" selected>${this.esc(current)}</option>`}
        </select>
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  /**
   * Country picker. Shows names, stores the three-letter code. A code already on
   * the symbol that isn't in COUNTRIES stays selected as its own entry rather
   * than being silently swapped for the first country in the list.
   */
  private countryField(spec: FieldSpec, value: any): string {
    const current = value == null ? '' : String(value).trim();
    const known = COUNTRIES.some((c) => c.value === current);
    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <select class="ms-select" ${this.dataAttrs(spec, 'value-select')}>
          <option value="" ${current === '' ? 'selected' : ''}>Not set</option>
          ${current !== '' && !known
            ? `<option value="${this.esc(current)}" selected>${this.esc(current)}</option>`
            : ''}
          ${COUNTRIES.map(
            (c) =>
              `<option value="${this.esc(c.value)}" ${c.value === current ? 'selected' : ''}>${this.esc(
                `${c.label} (${c.value})`,
              )}</option>`,
          ).join('')}
        </select>
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  /**
   * Date-time group field. The symbol stores a MIL-STD DTG string
   * (`191430ZAUG26`) because that's what the label renderer draws, but nobody
   * should have to type one — this offers a native date + time picker and does the
   * conversion both ways. A value that isn't a parseable DTG (free text from an
   * import, say) is left alone and shown underneath, so picking a date replaces it
   * deliberately rather than the field quietly dropping it.
   */
  private dtgField(spec: FieldSpec, value: any): string {
    const raw = value == null ? '' : String(value).trim();
    const local = this.dtgToLocal(raw);
    const unparsed = raw !== '' && local === '';

    return `
      <div class="ms-field">
        <span class="ms-label">${this.esc(spec.label)}</span>
        <div class="mx-dtg">
          <input class="ms-input" type="datetime-local" value="${this.esc(local)}"
                 ${this.dataAttrs(spec, 'value-dtg')}>
          <button type="button" class="ms-btn mx-mini" title="Set to now"
                  data-action="dtg-now" data-group="${this.esc(spec.group)}" data-key="${this.esc(spec.key)}">Now</button>
          <button type="button" class="ms-btn mx-mini" title="Clear"
                  data-action="dtg-clear" data-group="${this.esc(spec.group)}" data-key="${this.esc(spec.key)}">Clear</button>
        </div>
        <span class="mx-hint${unparsed ? ' warn' : ''}" data-mx="dtg-hint:${this.esc(spec.group)}:${this.esc(spec.key)}">${this.esc(
          this.dtgHint(raw, unparsed),
        )}</span>
        ${this.hintMarkup(spec)}
      </div>
    `;
  }

  private dtgHint(raw: string, unparsed: boolean): string {
    if (raw === '') return 'Not set';
    return unparsed ? `Currently "${raw}" — pick a date to replace it` : raw;
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
    // Remember which disclosures the user opened so a re-render doesn't shut them.
    this.root.querySelectorAll('details[data-mx-group]').forEach((el) => {
      el.addEventListener('toggle', () => {
        const id = (el as HTMLElement).dataset.mxGroup;
        if (!id) return;
        if ((el as HTMLDetailsElement).open) this.openGroups.add(id);
        else this.openGroups.delete(id);
      });
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

      // SIDC digit positions, 0-indexed: 0–1 version, 2 context, 3 standard
      // identity, 4–5 symbol set, 6 status, 7 HQ/TF/dummy, 8–9 echelon. The
      // version pair and the two trailing modifier pairs aren't edited here —
      // version is fixed by the standard, and the modifiers are entity-specific
      // codes nobody types from memory.
      case 'sidc-context':  this.setSidcRange(2,  3,  t.value); this.render(); return;
      case 'sidc-identity': this.setSidcRange(3,  4,  t.value); this.render(); return;
      case 'sidc-set':      this.setSidcRange(4,  6,  t.value); this.render(); return;
      case 'sidc-status':   this.setSidcRange(6,  7,  t.value); this.render(); return;
      case 'sidc-hqtf':     this.setSidcRange(7,  8,  t.value); this.render(); return;
      case 'sidc-echelon':  this.setSidcRange(8,  10, t.value); this.render(); return;

      case 'value': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        const type = (t.dataset.type as FieldType) || 'text';
        const coerced = this.coerce(t.value, type);
        if (!(type === 'number' && coerced === undefined)) {
          this.setValue(group, key, coerced);
        }
        // A stepper and its slider are two inputs over one value — push the new
        // number into whichever of the pair the user didn't touch.
        this.syncSiblings(t);
        this.refreshDynamic();
        return;
      }

      case 'value-bool': {
        this.setValue(t.dataset.group!, t.dataset.key!, t.checked ? 1 : 0);
        this.refreshDynamic();
        return;
      }

      case 'value-color': {
        this.setValue(t.dataset.group!, t.dataset.key!, this.hexToRgb(t.value));
        this.refreshDynamic();
        return;
      }

      case 'value-select': {
        this.setValue(t.dataset.group!, t.dataset.key!, t.value);
        this.refreshDynamic();
        return;
      }

      case 'value-dtg': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        this.setValue(group, key, this.localToDtg(t.value, this.groupValue(this.state, group as FieldGroup)[key]));
        this.updateDtgHint(group, key);
        this.refreshDynamic();
        return;
      }
    }
  }

  /** Write one field and take care of the bookkeeping every write needs. */
  private setValue(group: string, key: string, value: any): void {
    if (!this.state) return;
    (this.state as any)[group][key] = value;
    this.claimGroup(group);
    this.applyStyleMirror(group, key, value);
  }

  /**
   * The form is seeded with DrawEssentials class defaults when the symbol has no
   * labelOptions / extraSettings of its own. Once the user edits a field in one
   * of those groups the values become intentional, so the symbol now owns them
   * and they are written back on save. See EditableState.owns.
   */
  private claimGroup(group: string): void {
    if (!this.state) return;
    if (group !== 'labelOptions' && group !== 'extraSettings') return;

    // Claiming extraSettings makes it authoritative: SymbolEngine reads
    // extraSettings.opacity (and, for the point families, extraSettings.size) in
    // preference to the drawEssentials copies. Seed those from what the symbol is
    // showing right now, or nudging Line width would silently snap a half-
    // transparent graphic back to the class default of fully opaque.
    if (group === 'extraSettings' && !this.state.owns.extraSettings) {
      const de = this.state.drawEssentials;
      if (de.opacity != null) this.state.extraSettings.opacity = de.opacity;
      if (this.state.kind === 'Point' && Number(de.SIZE) > 0) {
        this.state.extraSettings.size = Number(de.SIZE);
      }
    }

    this.state.owns[group] = true;
  }

  /**
   * Keep the duplicated style values in step. SymbolEngine lets
   * extraSettings.opacity / .size override the drawEssentials copies whenever the
   * symbol carries an extraSettings object, so an Opacity edit that only wrote
   * drawEssentials would appear to do nothing on such a symbol.
   */
  private applyStyleMirror(group: string, key: string, value: any): void {
    const s = this.state;
    if (!s || group !== 'drawEssentials' || !s.owns.extraSettings) return;
    if (key === 'opacity') s.extraSettings.opacity = value;
    if (key === 'SIZE' && s.kind === 'Point' && Number(value) > 0) {
      s.extraSettings.size = Number(value);
    }
  }

  /**
   * Copy a freshly typed number into the other input bound to the same field —
   * the stepper/slider pairs, and any value that legitimately appears on two tabs.
   */
  private syncSiblings(source: HTMLInputElement): void {
    const { group, key } = source.dataset;
    if (!this.root || !group || !key) return;
    this.root
      .querySelectorAll(`[data-group="${group}"][data-key="${key}"]`)
      .forEach((el) => {
        if (el !== source) (el as HTMLInputElement).value = source.value;
      });
  }

  /** Refresh the DTG string shown beneath a date-time picker after an edit. */
  private updateDtgHint(group: string, key: string): void {
    if (!this.root || !this.state) return;
    const hint = this.root.querySelector(
      `[data-mx="dtg-hint:${group}:${key}"]`,
    ) as HTMLElement | null;
    if (!hint) return;
    const raw = String(this.groupValue(this.state, group as FieldGroup)[key] ?? '');
    hint.textContent = this.dtgHint(raw, false);
    hint.className = 'mx-hint';
  }

  private onAction(event: Event): void {
    const t = event.currentTarget as HTMLElement;
    const action = t.dataset.action;
    if (!action || !this.state) return;
    event.preventDefault();

    switch (action) {
      // Closing with unsaved edits asks first — the backdrop covers the whole
      // screen, so a stray click used to throw the work away without a word.
      case 'dismiss':
        if (this.isDirty()) {
          this.confirmDiscard = true;
          break;
        }
        this.close();
        return;
      case 'discard':
        this.close();
        return;
      case 'keep-editing':
        this.confirmDiscard = false;
        break;
      case 'save':
        this.save();
        return;
      case 'tab':
        this.activeTab = (t.dataset.tab as TabId) || 'symbol';
        break;
      case 'dtg-now': {
        const group = t.dataset.group!;
        const key = t.dataset.key!;
        const prev = this.groupValue(this.state, group as FieldGroup)[key];
        this.setValue(group, key, this.localToDtg(this.nowAsLocal(), prev));
        break;
      }
      case 'dtg-clear':
        this.setValue(t.dataset.group!, t.dataset.key!, '');
        break;
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
    }
    this.render();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (!this.state) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.isDirty() && !this.confirmDiscard) {
        this.confirmDiscard = true;
        this.render();
      } else {
        this.close();
      }
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
    // Line and Area count as ONE vector family here: the symbol-swap picker is disabled
    // for both (so symbolKey — hence newKind — never changes for them), they re-render
    // through the identical pipeline, and getMarker() treats them the same. Some symbol
    // classes stamp a SYM_GEO_TYPE that disagrees with their Symbols.json entry (e.g. an
    // Ambush polyline once tagged "Area" while its entry said "Line"); collapsing the two
    // stops that stale-data disagreement from blocking every edit of such a symbol.
    const vectorFamily = (k: GeoKind | '') => (k === 'Line' || k === 'Area' ? 'vector' : k);
    const newKind = this.geomKindOf(SYMBOLS[s.symbolKey]?.SymGeoType);
    if (newKind && s.kind && vectorFamily(newKind) !== vectorFamily(s.kind)) {
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
    this.confirmDiscard = false;
    this.activeTab = 'symbol';
    this.openGroups.clear();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Date-time groups
  //
  // Symbols store a MIL-STD date-time group — `191430ZAUG26`, i.e.
  // day / hour / minute / zone letter / month / two-digit year — because that is
  // what AnnotationEngine draws verbatim beside the symbol. The editor offers a
  // native date + time picker instead and converts at the boundary, so the format
  // on disk is unchanged and nobody has to type it.

  private static readonly DTG_MONTHS = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
  ];

  private static readonly DTG_RE = /^(\d{2})(\d{2})(\d{2})([A-Z])([A-Z]{3})(\d{2})$/i;

  /**
   * DTG string → the `YYYY-MM-DDTHH:MM` a datetime-local input wants. Returns ''
   * for anything that isn't a well-formed DTG (free text from an import, a partial
   * value someone typed by hand), which is the signal to leave that value alone.
   */
  private dtgToLocal(raw: string): string {
    const m = MorphixEngine.DTG_RE.exec(String(raw || '').trim());
    if (!m) return '';
    const [, dd, hh, mm, , mon, yy] = m;
    const monthIndex = MorphixEngine.DTG_MONTHS.indexOf(mon.toUpperCase());
    if (monthIndex < 0) return '';
    const day = Number(dd);
    const hour = Number(hh);
    const minute = Number(mm);
    if (day < 1 || day > 31 || hour > 23 || minute > 59) return '';
    const month = String(monthIndex + 1).padStart(2, '0');
    return `20${yy}-${month}-${dd}T${hh}:${mm}`;
  }

  /**
   * `YYYY-MM-DDTHH:MM` → DTG string. The zone letter of the value being replaced
   * is carried over (a symbol logged in local zone B stays in B); anything else
   * gets Zulu. An empty picker clears the field.
   */
  private localToDtg(local: string, previous?: any): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(local || '').trim());
    if (!m) return '';
    const [, year, month, day, hour, minute] = m;
    const prior = MorphixEngine.DTG_RE.exec(String(previous || '').trim());
    const zone = prior ? prior[4].toUpperCase() : 'Z';
    const mon = MorphixEngine.DTG_MONTHS[Number(month) - 1] || 'JAN';
    return `${day}${hour}${minute}${zone}${mon}${year.slice(2)}`;
  }

  /** Now, in the `YYYY-MM-DDTHH:MM` shape localToDtg parses. */
  private nowAsLocal(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
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
