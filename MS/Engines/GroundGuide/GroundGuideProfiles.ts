/**
 * GroundGuideProfiles.ts
 *
 * SIDC → mobility profile. The defaults here are MIL-STD-2525D knowledge
 * (which symbol sets are land-bound at all, which land units are on foot vs.
 * tracked); a bundle's rules.json may override any entry through
 * `profileOverrides` because "is this unit wheeled?" is a doctrine decision.
 */

import type { GroundGuideProfile, TerrainRules } from './GroundGuideTypes';

const PROFILES: ReadonlySet<string> = new Set<GroundGuideProfile>([
  'dismounted',
  'wheeled',
  'tracked',
  'vessel',
  'generic',
  'gun',
  'ad',
  'hls',
  'signals',
  'amphibious',
  'pack',
  'oversnow',
  'roadbound',
  'rail',
  'exempt',
]);

/** 2525D symbol set (SIDC positions 5–6) → default profile. */
const SYMBOL_SET_DEFAULTS: Record<string, GroundGuideProfile> = {
  '01': 'exempt', // Air
  '02': 'exempt', // Air missile
  '05': 'exempt', // Space
  '06': 'exempt', // Space missile
  '10': 'wheeled', // Land unit
  '11': 'wheeled', // Land civilian unit / organisation
  '15': 'wheeled', // Land equipment
  '20': 'generic', // Land installation
  '25': 'generic', // Control measure
  '27': 'dismounted', // Dismounted individual
  '30': 'vessel', // Sea surface
  '35': 'vessel', // Sea subsurface
  '36': 'vessel', // Mine warfare
  '40': 'exempt', // Activities
  '50': 'exempt', // Signals intelligence — space
  '51': 'exempt', // Signals intelligence — air
  '52': 'exempt', // Signals intelligence — land
  '53': 'exempt', // Signals intelligence — surface
  '54': 'exempt', // Signals intelligence — subsurface
  '60': 'exempt', // Cyberspace
};

/**
 * `symbolSet:entityPrefix` → profile. Prefixes are matched longest-first
 * against the 6-digit entity code (positions 11–16), so a 4-digit key covers
 * every subtype beneath it. Land-unit codes follow 2525D table "Land Unit".
 */
const ENTITY_DEFAULTS: Record<string, GroundGuideProfile> = {
  '10:1205': 'tracked', // Armour
  '10:1211': 'dismounted', // Infantry (mechanised/motorised subtypes: override in rules.json)
  '10:1206': 'exempt', // Aviation rotary wing
  '10:1207': 'exempt', // Aviation composite
  '10:1208': 'exempt', // Aviation fixed wing
  '10:1203': 'generic', // Amphibious
  // Land equipment that runs on tracks (A vehicles and tracked C plant; Symbols.json VehCat / Mover agree).
  '15:120103': 'tracked', // APC (Talha / M113 / Saad)
  '15:120104': 'tracked', // APC ambulance
  '15:1202': 'tracked', // Tank, light / medium / heavy
  '15:1203': 'tracked', // Armoured recovery vehicle
  '15:130902': 'tracked', // Mine clearing (roller / plough on a tank)
  '15:1311': 'tracked', // Engineer dozer
};

/**
 * The mobility amplifier of a land equipment SIDC (positions 9-10) -> profile. It describes the one symbol, so it
 * comes before the built-in entity defaults (a howitzer marked tracked is an SP gun); the bundle's own entity
 * overrides still come first. Wheeled and tracked together is judged as wheeled, the stricter of the two.
 */
const MOBILITY_DEFAULTS: Record<string, GroundGuideProfile> = {
  '31': 'wheeled', // Wheeled, limited cross-country
  '32': 'wheeled', // Wheeled, cross-country
  '33': 'tracked', // Tracked
  '34': 'wheeled', // Wheeled and tracked combination
  '35': 'gun', // Towed
  '36': 'rail', // Rail
  '37': 'pack', // Pack animals
  '41': 'oversnow', // Over snow (prime mover)
  '42': 'oversnow', // Sled
  '51': 'vessel', // Barge
  '52': 'amphibious', // Amphibious
};

export function isGroundGuideProfile(v: unknown): v is GroundGuideProfile {
  return typeof v === 'string' && PROFILES.has(v);
}

/** Strip whitespace; return the 20-digit code or null when unusable. */
export function normaliseSidc(sidc: string | null | undefined): string | null {
  if (!sidc) return null;
  const s = String(sidc).replace(/\s+/g, '');
  return s.length >= 16 && /^\d+$/.test(s) ? s : null;
}

/**
 * Resolve the profile for a SIDC. Order: bundle entity override → the SIDC's
 * mobility amplifier (land equipment) → built-in entity default → bundle
 * symbol-set override → built-in symbol-set default → `generic`. Unparseable
 * SIDCs are `generic` too (a land graphic with no identity still should not
 * sit in a lake).
 */
export function resolveProfile(
  sidc: string | null | undefined,
  rules?: TerrainRules | null,
): GroundGuideProfile {
  const s = normaliseSidc(sidc);
  if (!s) return 'generic';
  const set = s.substring(4, 6);
  const entity = s.substring(10, 16);
  const ov = rules?.profileOverrides;

  // A bundle may name a mode of its own in its overrides, as long as it defines that mode.
  const pick = (table: Record<string, string> | undefined, key: string): GroundGuideProfile | null => {
    const v = table?.[key];
    return isGroundGuideProfile(v) || (typeof v === 'string' && !!rules?.profiles?.[v]) ? (v as GroundGuideProfile) : null;
  };

  const prefixes: string[] = [];
  for (let len = Math.min(6, entity.length); len >= 2; len--) prefixes.push(`${set}:${entity.substring(0, len)}`);
  for (const key of prefixes) {
    const hit = pick(ov?.entities, key);
    if (hit) return hit;
  }
  if (set === '15') {
    const mob = pick(MOBILITY_DEFAULTS, s.substring(8, 10));
    if (mob) return mob;
  }
  for (const key of prefixes) {
    const hit = pick(ENTITY_DEFAULTS, key);
    if (hit) return hit;
  }
  return pick(ov?.symbolSets, set) ?? SYMBOL_SET_DEFAULTS[set] ?? 'generic';
}
