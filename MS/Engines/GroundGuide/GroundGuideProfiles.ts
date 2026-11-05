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
 * Resolve the profile for a SIDC. Order: bundle entity override → bundle
 * symbol-set override → built-in entity default → built-in symbol-set default
 * → `generic`. Unparseable SIDCs are `generic` too (a land graphic with no
 * identity still should not sit in a lake).
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

  for (let len = Math.min(6, entity.length); len >= 2; len--) {
    const key = `${set}:${entity.substring(0, len)}`;
    const hit = pick(ov?.entities, key) ?? pick(ENTITY_DEFAULTS, key);
    if (hit) return hit;
  }
  return pick(ov?.symbolSets, set) ?? SYMBOL_SET_DEFAULTS[set] ?? 'generic';
}
