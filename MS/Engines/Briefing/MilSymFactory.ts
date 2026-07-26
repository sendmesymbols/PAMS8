/**
 * MilSymFactory.ts
 *
 * Renders MIL-STD-2525D markers for the slide editor, and owns the small
 * amount of SIDC arithmetic the briefing needs.
 *
 * milsymbol.js is a script-tag global (`window.MS`) — never import it. The one
 * call that matters is the same one MS/Symbols/UEISymbol.ts makes:
 *
 *     new window.MS.symbol(sidc, { size, ...amplifiers }).getMarker().asCanvas()
 *
 * Nothing about that is map-specific, which is what lets a briefing overlay
 * reuse the library in its raw form.
 *
 * A milsym overlay persists a SIDC, never a bitmap. Every render regenerates
 * from it, so briefing files stay small and the PPTX exporter can re-render the
 * same symbol at 4× for print without the editor knowing anything about it.
 */

import LRUCache from '../../Cache/LRUCache';

// ── SIDC field vocabulary ────────────────────────────────────────────────────

/**
 * 2525D SIDC layout (20 chars), and which slot each control owns:
 *
 *   1–2   version           '10'
 *   3     context           '0' (reality)
 *   4     standard identity affiliation
 *   5–6   symbol set        Symbols.json key[0..2]
 *   7     status            present / planned
 *   8     HQ / TF / dummy
 *   9–10  amplifier         echelon
 *   11–16 entity            Symbols.json key[2..8]
 *   17–20 modifiers         '0000'
 */
export interface MilSymState {
  /** Standard-identity digit (position 4). */
  affiliation: string;
  /** Status digit (position 7). */
  status: string;
  /** HQ / task force / dummy digit (position 8). */
  hqTfDummy: string;
  /** Echelon / mobility pair (positions 9–10); '00' = none. */
  echelon: string;
  /** Symbol set (positions 5–6). */
  symbolSet: string;
  /** Entity / type / subtype (positions 11–16). */
  entity: string;
}

export interface SidcOption {
  value: string;
  label: string;
}

export const AFFILIATIONS: SidcOption[] = [
  { value: '3', label: 'Friend' },
  { value: '6', label: 'Hostile' },
  { value: '4', label: 'Neutral' },
  { value: '1', label: 'Unknown' },
  { value: '2', label: 'Assumed Friend' },
  { value: '5', label: 'Suspect' },
  { value: '0', label: 'Pending' },
];

export const STATUSES: SidcOption[] = [
  { value: '0', label: 'Present' },
  { value: '1', label: 'Planned' },
];

export const HQ_TF_DUMMY: SidcOption[] = [
  { value: '0', label: 'None' },
  { value: '1', label: 'Feint / Dummy' },
  { value: '2', label: 'Headquarters' },
  { value: '3', label: 'Feint + HQ' },
  { value: '4', label: 'Task Force' },
  { value: '5', label: 'Feint + TF' },
  { value: '6', label: 'TF + HQ' },
  { value: '7', label: 'Feint + TF + HQ' },
];

export const ECHELONS: SidcOption[] = [
  { value: '00', label: 'None' },
  { value: '11', label: 'Team / Crew' },
  { value: '12', label: 'Squad' },
  { value: '13', label: 'Section' },
  { value: '14', label: 'Platoon / Detachment' },
  { value: '15', label: 'Company / Battery / Troop' },
  { value: '16', label: 'Battalion / Squadron' },
  { value: '17', label: 'Regiment / Group' },
  { value: '18', label: 'Brigade' },
  { value: '21', label: 'Division' },
  { value: '22', label: 'Corps / MEF' },
  { value: '23', label: 'Army' },
  { value: '24', label: 'Army Group / Front' },
  { value: '25', label: 'Region / Theater' },
  { value: '26', label: 'Command' },
];

export const DEFAULT_MILSYM_STATE: MilSymState = {
  affiliation: '3',
  status: '0',
  hqTfDummy: '0',
  echelon: '00',
  symbolSet: '10',
  entity: '000000',
};

/**
 * The milsymbol text amplifiers, grouped for the editor's sub-panel. Mirrors
 * AMPLIFIER_FIELDS in MS/Symbols/UEISymbol.ts — the same option names milsymbol
 * itself reads — reordered here into something a person can scan.
 */
export const AMPLIFIER_GROUPS: Array<{
  label: string;
  fields: Array<{ key: string; label: string }>;
}> = [
  {
    label: 'Identity',
    fields: [
      { key: 'uniqueDesignation', label: 'Unique designation' },
      { key: 'higherFormation', label: 'Higher formation' },
      { key: 'additionalInformation', label: 'Additional info' },
      { key: 'type', label: 'Type' },
      { key: 'commonIdentifier', label: 'Common identifier' },
      { key: 'specialHeadquarters', label: 'Special HQ' },
      { key: 'staffComments', label: 'Staff comments' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'reinforcedReduced', label: 'Reinforced / reduced' },
      { key: 'evaluationRating', label: 'Evaluation rating' },
      { key: 'combatEffectiveness', label: 'Combat effectiveness' },
      { key: 'signatureEquipment', label: 'Signature equipment' },
      { key: 'hostile', label: 'Hostile' },
      { key: 'iffSif', label: 'IFF / SIF' },
      { key: 'sigint', label: 'SIGINT' },
    ],
  },
  {
    label: 'Movement',
    fields: [
      { key: 'direction', label: 'Direction' },
      { key: 'speed', label: 'Speed' },
      { key: 'altitudeDepth', label: 'Altitude / depth' },
      { key: 'location', label: 'Location' },
      { key: 'platformType', label: 'Platform type' },
      { key: 'auxiliaryEquipmentIndicator', label: 'Auxiliary equipment' },
    ],
  },
  {
    label: 'Time',
    fields: [
      { key: 'dtg', label: 'DTG' },
      { key: 'equipmentTeardownTime', label: 'Teardown time' },
    ],
  },
];

/** Every amplifier key, flat — used to filter unknown keys off a loaded overlay. */
export const AMPLIFIER_KEYS: readonly string[] = AMPLIFIER_GROUPS.flatMap((g) =>
  g.fields.map((f) => f.key),
);

// ── SIDC assembly ────────────────────────────────────────────────────────────

function pad(v: string | undefined, len: number, fill = '0'): string {
  return String(v ?? '').padStart(len, fill).slice(-len);
}

/** Assemble a full 20-character SIDC from picker / style-bar state. */
export function buildSidc(state: MilSymState): string {
  return (
    '10' +
    '0' +
    pad(state.affiliation, 1) +
    pad(state.symbolSet, 2) +
    pad(state.status, 1) +
    pad(state.hqTfDummy, 1) +
    pad(state.echelon, 2) +
    pad(state.entity, 6) +
    '0000'
  );
}

/** The inverse — lets the style bar populate its controls from a saved overlay. */
export function parseSidcToState(sidc: string | undefined): MilSymState {
  const s = String(sidc ?? '').padEnd(20, '0');
  if (s.length < 20) return { ...DEFAULT_MILSYM_STATE };
  return {
    affiliation: s[3],
    symbolSet: s.substring(4, 6),
    status: s[6],
    hqTfDummy: s[7],
    echelon: s.substring(8, 10),
    entity: s.substring(10, 16),
  };
}

/**
 * A Symbols.json catalogue key is `symbolSet(2) + entity(6)` — positions 5–6
 * and 11–16 of a SIDC (see SymbolEngine's `symbolData[symSet + reqSID]`
 * lookup). Everything else comes from `over`.
 */
export function sidcFromKey(symKey: string, over: Partial<MilSymState> = {}): string {
  const key = pad(symKey, 8);
  return buildSidc({
    ...DEFAULT_MILSYM_STATE,
    ...over,
    symbolSet: key.substring(0, 2),
    entity: key.substring(2, 8),
  });
}

/** The catalogue key implied by a SIDC — the inverse of `sidcFromKey`. */
export function keyFromSidc(sidc: string | undefined): string {
  const st = parseSidcToState(sidc);
  return st.symbolSet + st.entity;
}

// ── Rendering ────────────────────────────────────────────────────────────────

export interface MilSymRender {
  canvas: HTMLCanvasElement;
  /** Intrinsic pixel size of `canvas` — the caller scales to its own box. */
  width: number;
  height: number;
}

/**
 * Rendered markers, keyed by sidc + amplifiers + size bucket. Capped because
 * each value pins a canvas: the picker alone can touch hundreds of distinct
 * symbols while the user scrolls.
 */
const RENDER_CACHE = new LRUCache<string, MilSymRender>(400);

/**
 * Sizes are bucketed to the next power of two so a resize drag re-uses one
 * render instead of thrashing the cache on every mouse move. The canvas is
 * always at least as large as asked for, and fabric scales it down to the
 * exact box — scaling down stays sharp, scaling up would not.
 */
function sizeBucket(px: number): number {
  const clamped = Math.max(16, Math.min(2048, Math.round(px) || 64));
  return Math.pow(2, Math.ceil(Math.log2(clamped)));
}

/** False when milsymbol.js hasn't loaded — the picker hides itself in that case. */
export function isMilSymAvailable(): boolean {
  return typeof (window as any).MS?.symbol === 'function';
}

/** Drop empty amplifier values so they neither render nor persist. */
export function cleanAmplifiers(
  opts: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of AMPLIFIER_KEYS) {
    const v = opts?.[key];
    if (v != null && String(v).trim() !== '') out[key] = String(v);
  }
  return out;
}

/**
 * Render a marker to a canvas. Returns null when milsymbol is unavailable or
 * the SIDC is unusable — callers draw a placeholder rather than throwing.
 *
 * `pxHeight` is a target, not a contract: milsymbol sizes from its own base
 * geometry and amplifier text widens the result asymmetrically, so the caller
 * must read `width`/`height` back rather than assuming a square.
 */
export function renderMilSym(
  sidc: string,
  symOptions: Record<string, string> | undefined,
  pxHeight: number,
): MilSymRender | null {
  if (!isMilSymAvailable() || !sidc) return null;
  const amplifiers = cleanAmplifiers(symOptions);
  const size = sizeBucket(pxHeight);
  const cacheKey = `${sidc}|${size}|${JSON.stringify(amplifiers)}`;
  const hit = RENDER_CACHE.get(cacheKey);
  if (hit) return hit;

  try {
    const marker = new (window as any).MS.symbol(sidc, { size, ...amplifiers }).getMarker();
    const canvas: HTMLCanvasElement = marker.asCanvas();
    if (!canvas?.width || !canvas?.height) return null;
    const out: MilSymRender = { canvas, width: canvas.width, height: canvas.height };
    RENDER_CACHE.set(cacheKey, out);
    return out;
  } catch {
    // A hand-edited or future SIDC that milsymbol rejects — treat as unusable.
    return null;
  }
}

/** Aspect ratio (w / h) of a rendered marker; 1 when it can't be rendered. */
export function milSymAspect(
  sidc: string,
  symOptions: Record<string, string> | undefined,
  pxHeight = 128,
): number {
  const r = renderMilSym(sidc, symOptions, pxHeight);
  return r && r.height ? r.width / r.height : 1;
}
