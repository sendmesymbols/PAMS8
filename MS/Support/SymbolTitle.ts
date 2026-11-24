/**
 * SymbolTitle — the name a planner would call a symbol, built from what it carries:
 *
 *   unique designation (T)  +  catalog name (Symbols.json Name)  +  echelon (SIDC)
 *
 *   "16"  + "Inf"  + 21 (Div)            → "16 Inf Div"
 *   "22"  + "Armr" + 16 (Bn / Sqn level) → "22 Armr Regt"   (armour / arty / recce say Regt, Sqn / Bty, Tp)
 *   "A"   + "Battle Posn" + 15 (Coy)     → "Battle Posn A (Coy)"
 *
 * Units (2525D symbol sets 10 / 11) read designation first, the way a unit is named
 * ("16 Inf Div"); everything else reads name first ("Battle Posn A", "Obj Tiger").
 * The HQ / Task Force / Dummy amplifier (SIDC digit 8) marks the title too
 * ("HQ 16 Inf Div"). The side (standard identity, SIDC digit 4) goes in `sub`, worded
 * Own / En.
 *
 * Pure: no ArcGIS, no DOM, so it is used by the selection pop-up and can be by any
 * other list or log line (`node tools/symbol-title-test/run.mjs` checks it).
 */

/** 2525D echelon code (SIDC digits 9-10, first digit 1 or 2) → short form. */
export const ECHELON_SHORT: Readonly<Record<string, string>> = {
  '11': 'Team',
  '12': 'Sqd',
  '13': 'Sec',
  '14': 'Pl',
  '15': 'Coy',
  '16': 'Bn',
  '17': 'Regt',
  '18': 'Bde',
  '21': 'Div',
  '22': 'Corps',
  '23': 'Army',
  '24': 'Army Gp',
  '25': 'Theatre',
  '26': 'Comd',
};

/**
 * Arms organised on the regimental system (as in the Pakistan Army: an armoured or
 * artillery Regt is a Bn-level unit of Sqns / Btys and Tps). Keyed by the first four
 * digits of the land-unit entity code (2525D symbol set 10).
 */
const REGIMENTAL_ARMS: Readonly<Record<string, 'sqn' | 'bty'>> = {
  '1205': 'sqn', // Armour
  '1213': 'sqn', // Recce / Cavalry / Scout
  '1216': 'sqn', // Recce Unit (catalog name for 2525D Surveillance)
  '1301': 'bty', // Air Defence
  '1303': 'bty', // Field Artillery
};

const REGIMENTAL_WORDS: Readonly<Record<'sqn' | 'bty', Record<string, string>>> = {
  sqn: { '14': 'Tp', '15': 'Sqn', '16': 'Regt', '17': 'Regt' },
  bty: { '14': 'Tp', '15': 'Bty', '16': 'Regt', '17': 'Regt' },
};

/** Standard identity (SIDC digit 4) → side, worded Own / En. */
const SIDES: Readonly<Record<string, { side: SymbolSide; label: string }>> = {
  '0': { side: 'unknown', label: 'Pending' },
  '1': { side: 'unknown', label: 'Unknown' },
  '2': { side: 'own', label: 'Assumed Own' },
  '3': { side: 'own', label: 'Own' },
  '4': { side: 'neutral', label: 'Neutral' },
  '5': { side: 'en', label: 'Suspect' },
  '6': { side: 'en', label: 'En' },
};

/** Catalog name prefixes that say nothing on their own ("Land Unit - Recce/..."). */
const GENERIC_BASES = new Set(['land unit']);

export type SymbolSide = 'own' | 'en' | 'neutral' | 'unknown';

export interface SymbolTitleInput {
  /** 20-digit 2525D SIDC. Anything else still gives a title, without echelon or side. */
  sidc?: string | null;
  /** Catalog name (Symbols.json `Name`, e.g. "Inf", "Inf - MIB", "Battle Posn"). */
  name?: string | null;
  /** Unique designation the user typed (amplifier T). */
  desig?: string | null;
  /** Higher formation (amplifier M). */
  higher?: string | null;
  /** Echelon code to use when the SIDC carries none (drawEssentials.ECHELON). */
  echelon?: string | null;
}

export interface SymbolTitle {
  /** "HQ 16 Inf Div", "22 Armr Regt", "Battle Posn A (Coy)". */
  title: string;
  /** Second line: side, planned, higher formation ("En · of 1 Corps"). May be ''. */
  sub: string;
  side: SymbolSide | null;
  /** Short echelon word used in the title, or null. */
  echelon: string | null;
  /** True when the title came from a designation the user typed. */
  hasDesig: boolean;
}

const clean = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : typeof s === 'number' ? String(s) : '';

/** Echelon word for a SIDC, worded for the unit's arm. Null when it carries none. */
export function echelonWord(sidc: string, fallback?: string | null): string | null {
  const is2525D = /^\d{20}/.test(sidc);
  let code = is2525D ? sidc.slice(8, 10) : '';
  if (!/^[12]\d$/.test(code)) code = clean(fallback);
  if (!/^[12]\d$/.test(code)) return null;
  if (is2525D && sidc.slice(4, 6) === '10') {
    const arm = REGIMENTAL_ARMS[sidc.slice(10, 14)];
    const word = arm ? REGIMENTAL_WORDS[arm][code] : undefined;
    if (word) return word;
  }
  return ECHELON_SHORT[code] ?? null;
}

/** The name a planner would call this symbol. Never throws; always returns a title. */
export function symbolTitle(input: SymbolTitleInput): SymbolTitle {
  const sidc = clean(input.sidc);
  const is2525D = /^\d{20}/.test(sidc);
  const set = is2525D ? sidc.slice(4, 6) : '';
  const isUnit = set === '10' || set === '11';
  const desig = clean(input.desig);
  const name = clean(input.name) || 'Symbol';
  const ech = echelonWord(sidc, input.echelon);

  // "Inf - MIB" → base "Inf", qualifier "MIB"; a generic base gives way to its qualifier.
  const parts = name.split(/\s+-\s+/).map(clean).filter(Boolean);
  let base = parts[0] ?? name;
  let qual = parts.slice(1).join(' - ');
  if (qual && GENERIC_BASES.has(base.toLowerCase())) {
    base = qual;
    qual = '';
  }

  let title: string;
  if (isUnit) {
    title = [desig, base, ech].filter(Boolean).join(' ') + (qual ? ` (${qual})` : '');
  } else {
    title = [name, desig].filter(Boolean).join(' ') + (ech ? ` (${ech})` : '');
  }

  // HQ / Task Force / Dummy (SIDC digit 8) on units, equipment and installations.
  if (is2525D && (isUnit || set === '15' || set === '20')) {
    const h = sidc.charAt(7);
    const hq = h === '2' || h === '3' || h === '6' || h === '7';
    const tf = h === '4' || h === '5' || h === '6' || h === '7';
    const dummy = h === '1' || h === '3' || h === '5' || h === '7';
    if (hq) title = `HQ ${title}`;
    if (tf) title += ' (TF)';
    if (dummy) title += ' (Dummy)';
  }

  const sideInfo = is2525D ? SIDES[sidc.charAt(3)] : undefined;
  const sub: string[] = [];
  if (sideInfo) sub.push(sideInfo.label);
  if (is2525D && sidc.charAt(6) === '1') sub.push('Planned');
  const higher = clean(input.higher);
  if (higher) sub.push(`of ${higher}`);

  return {
    title,
    sub: sub.join(' · '),
    side: sideInfo?.side ?? null,
    echelon: ech,
    hasDesig: !!desig,
  };
}
