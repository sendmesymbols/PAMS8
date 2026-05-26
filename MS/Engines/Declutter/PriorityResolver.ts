import Graphic from "@arcgis/core/Graphic";
import { getEchelonCode, getIdentityCode } from "./echelon";

/**
 * Echelon code → numeric weight. Higher = more important (kept visible
 * longer, hidden last during clutter resolution).
 *
 * Supports both 2525D 2-digit codes ("11"–"24") and 2525C single-char
 * codes (A–N) — both map onto the same ladder.
 *
 *   Team/Crew         1   |   Brigade        8
 *   Squad             2   |   Division       9
 *   Section           3   |   Corps         10
 *   Platoon           4   |   Army          11
 *   Company           5   |   Army Group    12
 *   Battalion         6   |   Region        13
 *   Regiment/Group    7   |   Command       14
 */
const ECHELON_WEIGHT: Record<string, number> = {
  "00": 0,
  "11": 1,  "12": 2,  "13": 3,  "14": 4,  "15": 5,
  "16": 6,  "17": 7,  "18": 8,  "19": 9,  "20": 10,
  "21": 11, "22": 12, "23": 13, "24": 14,
  "A": 1, "B": 2, "C": 3, "D": 4, "E": 5,
  "F": 6, "G": 7, "H": 8, "I": 9, "J": 10,
  "K": 11, "L": 12, "M": 13, "N": 14,
};

/**
 * Standard identity (affiliation) → multiplier.
 * Hostile is slightly amplified so threats survive declutter longer.
 */
const IDENTITY_WEIGHT: Record<string, number> = {
  "0": 0.8,   // pending
  "1": 0.8,   // unknown
  "2": 1.0,   // assumed friend
  "3": 1.0,   // friend
  "4": 0.9,   // neutral
  "5": 1.05,  // suspect
  "6": 1.1,   // hostile
};

/** Window during which a freshly-drawn symbol gets a recency boost. */
const RECENCY_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export interface PriorityComponents {
  echelon: number;
  identity: number;
  manual: number;
  recency: number;
  total: number;
}

/** Compute every component — useful for debugging and UI badges. */
export function scoreGraphic(g: Graphic, now: number = Date.now()): PriorityComponents {
  const attrs = g.attributes ?? {};
  const de = attrs.drawEssentials;

  const echCode = getEchelonCode(g).toUpperCase();
  const echelon = ECHELON_WEIGHT[echCode] ?? 0;

  const identityCode = getIdentityCode(g);
  const identity = IDENTITY_WEIGHT[identityCode] ?? 1.0;

  const manual = Number(attrs.priority ?? de?.priority ?? 0) || 0;

  const createdAt = Number(attrs.createdAt ?? de?.createdAt ?? 0);
  let recency = 0;
  if (createdAt > 0) {
    const ageMs = now - createdAt;
    if (ageMs >= 0 && ageMs < RECENCY_WINDOW_MS) {
      recency = 1 - ageMs / RECENCY_WINDOW_MS;
    }
  }

  const total = echelon * identity + manual + recency;
  return { echelon, identity, manual, recency, total };
}

/** Total score only — preferred hot-path entry point. */
export function priorityOf(g: Graphic, now: number = Date.now()): number {
  return scoreGraphic(g, now).total;
}

/** Highest possible total (Command × hostile + reasonable manual). For normalization. */
export const PRIORITY_MAX = 14 * 1.1 + 10 + 1;
