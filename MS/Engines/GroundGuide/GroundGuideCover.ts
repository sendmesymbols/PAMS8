/**
 * GroundGuideCover.ts
 *
 * C (Cover, Camouflage & Concealment) for the Ground Guide: what the ground at and round a point gives against
 * direct fire, indirect fire, ground observation and aerial observation. Pure: no DOM, no tiles; the engine passes a
 * pixel reader in.
 *
 * Data (terrain bundle v2, built by tools/terrain-pipeline):
 *   class layer + rules.json grotbc.coverSplit.byClass[class] = [direct, indirect, ground, aerial], each 0 none,
 *     1 poor, 2 fair, 3 good: what each kind of ground gives. A STARTING PROPOSAL for the rule owner to correct.
 *   bank layer + rules.json grotbc.banks: land along rivers and canals, kind = value >> 2, band = value & 3
 *     (0 within 30 m, 1 within 75 m, 2 within 150 m); each kind gives its own four-way cover and may be a deployment
 *     line (the owner, 2026-11-04: river and canal banks give ground troops cover and make deployment lines).
 *   cc layer: one cover and one concealment value per pixel (concealment = value >> 4, cover = value & 15, 0-3), from
 *     the classes and the vegetation density: the local detail the class split cannot carry.
 *
 * The four levels at a point are the class split, raised by a bank within 75 m. The cc values are shown beside them
 * as the density of the AREA round the point, never mixed in (decided 2026-11-05, safety first):
 *   - cc concealment comes from the NCGDB vegetation-symbol density per km2 (classify.py cover_layers), so it describes
 *     the area, not the spot: a road or track through trees reads Good although the road itself is open. Raising the
 *     levels to it would tell a planner a vehicle on an open road is hidden: the error that gets people killed.
 *   - Capping the levels by it is wrong too: cc does not know bunds or banks, so it would undo the owner's rules.
 *   So the levels never go up on the area's say-so. When the area is better than the spot, `around` says so and points
 *   to the nearest Fair or better; on a road, track or railway it adds that a canopy may screen it from the air, to be
 *   checked on the ground.
 *
 * Underground and enclosed cover (added 2026-11-06): the nearest cave, bunker, trench, road or railway tunnel from the
 * feature tiles (`shelters`), named beside the levels. They are points on the map, so they never change the levels.
 */

export type CoverLevel = 0 | 1 | 2 | 3;
export type CoverField = 'direct' | 'indirect' | 'ground' | 'aerial';
export const COVER_FIELDS: readonly CoverField[] = ['direct', 'indirect', 'ground', 'aerial'];
export const COVER_WORD: Record<CoverLevel, string> = { 0: 'None', 1: 'Poor', 2: 'Fair', 3: 'Good' };
/** What each field protects against, as the card labels it. */
export const COVER_FIELD_LABEL: Record<CoverField, string> = {
  direct: 'Direct Fire',
  indirect: 'Indirect Fire',
  ground: 'Gr Obsn',
  aerial: 'Aerial Obsn',
};
/** The two kinds: the first two fields are cover (protection), the last two concealment (not being seen). */
export const COVER_KIND: Record<CoverField, 'Cover' | 'Concealment'> = {
  direct: 'Cover',
  indirect: 'Cover',
  ground: 'Concealment',
  aerial: 'Concealment',
};

/**
 * The field each mode needs most, highlighted on the card when `cover.focus` is on. A proposal for the rule owner:
 * troops on foot want cover from direct fire; vehicles want to be hidden from ground observation; guns, AD and
 * signals sites want to be hidden from the air. Landing sites, rail and vessels have none (open ground is the point).
 */
export const COVER_FOCUS: Record<string, CoverField | null> = {
  dismounted: 'direct',
  generic: 'direct',
  wheeled: 'ground',
  tracked: 'ground',
  roadbound: 'ground',
  pack: 'ground',
  oversnow: 'ground',
  amphibious: 'ground',
  gun: 'aerial',
  ad: 'aerial',
  signals: 'aerial',
  hls: null,
  rail: null,
  vessel: null,
  exempt: null,
};

/**
 * How the card shows C. Every style is kept so the owner can compare them live (ground-guide-cover-options.html
 * shows them side by side); `off` shows nothing.
 *  - lines:   C1, four lines (direct, indirect, ground, aerial) with a four-step meter and what gives each
 *  - grid:    C2, a 2 x 2 grid: Cover (direct, indirect) beside Concealment (ground, aerial), tiles shaded by level
 *  - summary: C3, one line: "Cover Poor · Concealment Good" with the weakest field and where better is
 *  - icons:   C4, a shield (cover) and an eye (concealment), each filled by level, with the ground that gives them
 *  - nearest: C5, for each field without Fair or better here, the nearest place that has it (distance, direction)
 *  - rose:    C6, eight wedges round the position shaded by the best cover in that direction, for the mode's need
 *  - block:   C7, the full C block: four lines, the local density, the bank, the nearest and the rose
 */
export type CoverCardStyle = 'off' | 'lines' | 'grid' | 'summary' | 'icons' | 'nearest' | 'rose' | 'block';
export const COVER_CARD_STYLES: readonly CoverCardStyle[] = ['off', 'lines', 'grid', 'summary', 'icons', 'nearest', 'rose', 'block'];
/** Where C sits: last, in GROTBC order (after B), or right after Why (after T when T is there too). */
export type CoverWhere = 'grotbc' | 'afterWhy';
export const COVER_WHERE: readonly CoverWhere[] = ['grotbc', 'afterWhy'];

export interface GroundGuideCoverOptions {
  /** Read the cover data at all (card, Brief and the API). */
  enabled: boolean;
  /** Card style (`off` = no C section on the card; the Brief still has it). */
  card: CoverCardStyle;
  where: CoverWhere;
  /** How far the card looks for better cover (nearest and rose), metres. */
  radiusM: number;
  /** Mark the field the mode needs most (COVER_FOCUS). */
  focus: boolean;
}

/** rules.json `grotbc.coverSplit` and `grotbc.banks`, as the bundle ships them. */
export interface CoverRules {
  coverSplit?: { fields?: string[]; byClass?: Record<string, number[]> };
  banks?: {
    bandsM?: number[];
    kinds?: Record<string, { label: string; cover?: number[]; deploy?: boolean }>;
    note?: string;
  };
  layers?: Record<string, Record<string, unknown>>;
}

export interface CoverNearest {
  level: CoverLevel;
  /** What gives it there (class or bank label). */
  label: string;
  distanceM: number;
  compass: string;
  bearingDeg: number;
}

export interface CoverSector {
  bearingDeg: number;
  compass: string;
  /** Best level of the rose's field within the radius in this direction. */
  level: CoverLevel;
  /** Distance to the nearest Fair or better in this direction; null when there is none. */
  nearM: number | null;
}

/** Classes that are cleared lines through other ground: railway (28) and roads (34-38). */
const CLEARED_LINE = new Set([28, 34, 35, 36, 37, 38]);

/** The area round the point conceals better than the spot itself (cc concealment above the spot's best concealment). */
export interface CoverAround {
  /** The area's concealment (cc layer). */
  concealment: CoverLevel;
  /** The nearest Fair or better concealment (ground or aerial), when the search found one. */
  nearest: CoverNearest | null;
  /** The spot is a road, track or railway: a canopy may screen it from the air (not in the data; check on the ground). */
  clearedLine: boolean;
}

/** What C adds to a verdict while drawing. */
/** A mapped cave, bunker, trench or tunnel near the point (features; not part of the four levels). */
export interface CoverShelter {
  label: string;
  name: string | null;
  distanceM: number;
  compass: string;
}

export interface GroundGuideCover {
  style: CoverCardStyle;
  where: CoverWhere;
  /** The field the mode needs most, or null (`cover.focus` off, or the mode has none). */
  focus: CoverField | null;
  /** The four levels at the point, and what gives each. */
  levels: Record<CoverField, CoverLevel>;
  from: Record<CoverField, string | null>;
  /** The ground class at the point (label). */
  classLabel: string | null;
  /** The cc layer at the point: the local density. Null when the bundle has no cc layer or no data here. */
  local: { cover: CoverLevel; concealment: CoverLevel } | null;
  /** Set when the area round the point conceals better than the spot: the levels are NOT raised (see the file header). */
  around: CoverAround | null;
  /** A river or canal bank at the point (within 75 m). */
  bank: { label: string; deploy: boolean; withinM: number } | null;
  /** Per field: the nearest Fair or better within the radius, when the point itself has less. */
  nearest: Record<CoverField, CoverNearest | null>;
  /** The field the rose shades (the focus, else direct fire), and its eight sectors. */
  roseField: CoverField;
  sectors: CoverSector[];
  radiusM: number;
  /** A tile was still loading: the figures may change. */
  pending: boolean;
  /** The data is a proposal and a model: say so on the card. */
  note: string | null;
  /** Underground and enclosed cover nearby (caves, bunkers, trenches, tunnels), nearest first, one per kind. */
  shelters: CoverShelter[];
  /** How far `shelters` looked, m (0 when the bundle has no feature tiles). */
  shelterRadiusM: number;
  /**
   * The lie of the ground (added 2026-11-06): the landform at the point (`landform` layer) and the nearest closed
   * depression (features, kind 165, `dp` depth) within 2 km, where troops can get into dead ground. Not in the levels.
   */
  form: { landform: string | null; depression: { distanceM: number; compass: string; depthM: number | null } | null } | null;
  /** Building density and height at the point (`bld` layer): built-up cover the class alone does not grade. Not in the levels. */
  built: { density: string; height: string | null } | null;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function lvl(n: unknown): CoverLevel {
  const v = Math.round(Number(n));
  return (v >= 3 ? 3 : v <= 0 || !Number.isFinite(v) ? 0 : v) as CoverLevel;
}

/** The cc layer value: concealment = v >> 4, cover = v & 15. Null for nodata (255) or nothing loaded. */
export function decodeCc(v: number | null | undefined): { cover: CoverLevel; concealment: CoverLevel } | null {
  if (v === null || v === undefined || v === 255) return null;
  return { cover: lvl(v & 15), concealment: lvl(v >> 4) };
}

/** The bank layer value: kind = v >> 2, band = v & 3. Null for no bank (0), nodata (255) or nothing loaded. */
export function decodeBank(v: number | null | undefined): { kind: number; band: number } | null {
  if (v === null || v === undefined || v === 0 || v === 255) return null;
  return { kind: v >> 2, band: v & 3 };
}

/** The four levels the ground at one pixel gives, and what gives each. */
export function coverAt(
  rules: CoverRules | null | undefined,
  cls: number | null | undefined,
  bankV: number | null | undefined,
  classLabel: (c: number) => string,
): { levels: CoverLevel[]; from: Array<string | null>; bank: { label: string; deploy: boolean; withinM: number } | null } {
  const levels: CoverLevel[] = [0, 0, 0, 0];
  const from: Array<string | null> = [null, null, null, null];
  if (cls !== null && cls !== undefined && cls !== 255) {
    const split = rules?.coverSplit?.byClass?.[String(cls)];
    if (split) {
      const label = classLabel(cls);
      for (let i = 0; i < 4; i++) {
        levels[i] = lvl(split[i]);
        if (levels[i] > 0) from[i] = label;
      }
    }
  }
  let bank: { label: string; deploy: boolean; withinM: number } | null = null;
  const b = decodeBank(bankV);
  const kind = b ? rules?.banks?.kinds?.[String(b.kind)] : undefined;
  // Bands 0 and 1 (within 30 / 75 m) count as being on the bank; band 2 (150 m) is only "near water".
  if (b && kind && b.band <= 1) {
    const withinM = rules?.banks?.bandsM?.[b.band] ?? (b.band === 0 ? 30 : 75);
    bank = { label: kind.label, deploy: kind.deploy === true, withinM };
    const bc = kind.cover ?? [];
    for (let i = 0; i < 4; i++) {
      const v = lvl(bc[i]);
      if (v > levels[i]) {
        levels[i] = v;
        from[i] = kind.label;
      }
    }
  }
  return { levels, from, bank };
}

function rec<T>(f: (k: CoverField, i: number) => T): Record<CoverField, T> {
  return { direct: f('direct', 0), indirect: f('indirect', 1), ground: f('ground', 2), aerial: f('aerial', 3) };
}

/**
 * Read C at a point and round it. `read(layer, mx, my)` is the engine's synchronous pixel reader (undefined while a
 * tile loads, null for no data); `pxM` is the ground size of one pixel at the reading zoom.
 */
export function readCover(args: {
  rules: CoverRules | null | undefined;
  opts: GroundGuideCoverOptions;
  profile: string;
  at: [number, number];
  cosLat: number;
  pxM: number;
  layers: { cls: string; cc: string | null; bank: string | null };
  read: (layer: string, mx: number, my: number) => number | null | undefined;
  classLabel: (c: number) => string;
  pending: () => boolean;
  /** Look round the point (nearest and rose): the card style or the open Brief needs it. */
  scan: boolean;
  /** Mapped caves, bunkers, trenches and tunnels near the point (the engine reads the feature tiles), and how far it looked. */
  shelters?: { list: CoverShelter[]; radiusM: number } | null;
  /** The landform and the nearest depression, and the building density and height at the point (the engine reads them). */
  form?: GroundGuideCover['form'];
  built?: GroundGuideCover['built'];
}): GroundGuideCover {
  const { rules, opts, at, cosLat, layers, read, classLabel } = args;
  const cls = read(layers.cls, at[0], at[1]);
  const here = coverAt(rules, cls, layers.bank ? read(layers.bank, at[0], at[1]) : null, classLabel);
  const local = layers.cc ? decodeCc(read(layers.cc, at[0], at[1])) : null;
  const focus = opts.focus ? (COVER_FOCUS[args.profile] ?? null) : null;
  const roseField: CoverField = focus ?? 'direct';
  const roseIdx = COVER_FIELDS.indexOf(roseField);

  const nearest = rec<CoverNearest | null>(() => null);
  const sectors: CoverSector[] = COMPASS8.map((compass, i) => ({ bearingDeg: i * 45, compass, level: 0 as CoverLevel, nearM: null }));
  if (args.scan) {
    // One pass over a square of samples out to the radius: about one sample per pixel, never more than 61 x 61.
    const R = Math.max(50, opts.radiusM);
    const n = Math.min(30, Math.max(3, Math.ceil(R / Math.max(1, args.pxM))));
    const stepG = R / n;
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        if (i === 0 && j === 0) continue;
        const gx = i * stepG;
        const gy = j * stepG;
        const d = Math.hypot(gx, gy);
        if (d > R) continue;
        const mx = at[0] + gx / cosLat;
        const my = at[1] + gy / cosLat;
        const c = read(layers.cls, mx, my);
        if (c === undefined || c === null) continue;
        const s = coverAt(rules, c, layers.bank ? read(layers.bank, mx, my) : null, classLabel);
        const brg = ((Math.atan2(gx, gy) * 180) / Math.PI + 360) % 360;
        const sec = sectors[Math.round(brg / 45) % 8];
        const lv = s.levels[roseIdx];
        if (lv > sec.level) sec.level = lv;
        if (lv >= 2 && (sec.nearM === null || d < sec.nearM)) sec.nearM = d;
        for (let k = 0; k < 4; k++) {
          const f = COVER_FIELDS[k];
          if (here.levels[k] >= 2 || s.levels[k] < 2) continue;
          const cur = nearest[f];
          if (!cur || d < cur.distanceM || (d === cur.distanceM && s.levels[k] > cur.level)) {
            nearest[f] = { level: s.levels[k], label: s.from[k] ?? classLabel(c), distanceM: d, compass: COMPASS8[Math.round(brg / 45) % 8], bearingDeg: brg };
          }
        }
      }
    }
  }

  // The area conceals better than the spot: say so, and where, but never raise the levels (file header).
  let around: CoverAround | null = null;
  const spotConceal = Math.max(here.levels[2], here.levels[3]);
  if (local && local.concealment >= 2 && local.concealment > spotConceal) {
    const g = nearest.ground;
    const a = nearest.aerial;
    const pickN = g && a ? (a.level > g.level || (a.level === g.level && a.distanceM < g.distanceM) ? a : g) : (g ?? a);
    around = { concealment: local.concealment, nearest: pickN, clearedLine: cls !== null && cls !== undefined && CLEARED_LINE.has(cls) };
  }

  return {
    style: opts.card,
    where: opts.where,
    focus,
    levels: rec((_, i) => here.levels[i]),
    from: rec((_, i) => here.from[i]),
    classLabel: cls !== null && cls !== undefined && cls !== 255 ? classLabel(cls) : null,
    local,
    around,
    bank: here.bank,
    nearest,
    roseField,
    sectors,
    radiusM: opts.radiusM,
    pending: args.pending(),
    note: rules?.coverSplit ? 'Proposal' : null,
    shelters: args.shelters?.list ?? [],
    shelterRadiusM: args.shelters?.radiusM ?? 0,
    form: args.form ?? null,
    built: args.built ?? null,
  };
}

/** Plain-text lines for the Ground Brief's Copy as Text and for hosts. */
export function coverText(c: GroundGuideCover, fmt: (m: number) => string): string[] {
  const out: string[] = [];
  for (const f of COVER_FIELDS) {
    const from = c.from[f];
    const n = c.nearest[f];
    let s = `${COVER_KIND[f]} from ${COVER_FIELD_LABEL[f]}: ${COVER_WORD[c.levels[f]]}${from ? ` (${from})` : ''}`;
    if (n) s += `; ${COVER_WORD[n.level]} ${fmt(n.distanceM)} ${n.compass} (${n.label})`;
    out.push(s);
  }
  if (c.local) out.push(`Area round it (vegetation density, not this spot): Cover ${COVER_WORD[c.local.cover]}, Concealment ${COVER_WORD[c.local.concealment]}`);
  if (c.around) {
    const n = c.around.nearest;
    out.push(`This spot conceals less than the area round it${n ? `: ${COVER_WORD[n.level]} concealment ${fmt(n.distanceM)} ${n.compass} (${n.label})` : ''}`);
    if (c.around.clearedLine) out.push('On a road, track or railway: a tree canopy may screen it from the air. Not in the data: check on the ground.');
  }
  if (c.bank) out.push(`${c.bank.label} within ${c.bank.withinM} m${c.bank.deploy ? ': a deployment line' : ''}`);
  const sh = shelterText(c, fmt);
  if (sh) out.push(`Underground / enclosed: ${sh}`);
  const fm = formText(c, fmt);
  if (fm) out.push(`Lie of the Gr: ${fm}`);
  if (c.built) out.push(`Bldgs here: ${builtText(c)}`);
  return out;
}

/** "Valley floor · depression 420 m N, 16 m deep"; null when neither is known. */
export function formText(c: GroundGuideCover, fmt: (m: number) => string): string | null {
  const f = c.form;
  if (!f) return null;
  const d = f.depression;
  const parts = [f.landform, d ? `depression ${fmt(d.distanceM)} ${d.compass}${d.depthM ? `, ${d.depthM} m deep` : ''}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** "Medium (300-1,000 / km2) · Medium (6 to 12 m, 2 to 4 storeys)". */
export function builtText(c: GroundGuideCover): string {
  return [c.built?.density, c.built?.height].filter(Boolean).join(' · ');
}

/** "Bunker 1.2 km NE · Trench 2.4 km N", or "none mapped within 5 km"; null when the bundle has no feature tiles. */
export function shelterText(c: GroundGuideCover, fmt: (m: number) => string): string | null {
  const list = c.shelters ?? [];
  if (list.length) return list.map((x) => `${x.name ? `${x.name} (${x.label})` : x.label} ${fmt(x.distanceM)} ${x.compass}`).join(' · ');
  return c.shelterRadiusM > 0 ? `none mapped within ${fmt(c.shelterRadiusM)}` : null;
}

/** Re-render key for the card. */
export function coverKey(c: GroundGuideCover | null | undefined): string {
  if (!c) return '';
  const lv = COVER_FIELDS.map((f) => c.levels[f]).join('');
  const nr = COVER_FIELDS.map((f) => {
    const n = c.nearest[f];
    return n ? `${n.level}${Math.round(n.distanceM / 25)}${n.compass}` : '-';
  }).join(',');
  const rose = c.sectors.map((s) => s.level).join('');
  const ar = c.around ? `a${c.around.concealment}${c.around.clearedLine ? 'r' : ''}` : '';
  const sh = (c.shelters ?? []).map((x) => `${x.label}${Math.round(x.distanceM / 50)}${x.compass}`).join(',') + (c.form ? `${c.form.landform ?? ''}${c.form.depression ? Math.round(c.form.depression.distanceM / 50) : ''}` : '') + (c.built?.density ?? '');
  return `${c.style}${c.where}${c.focus ?? ''}${lv}${nr}${rose}${c.local ? c.local.cover * 4 + c.local.concealment : 'x'}${ar}${c.bank?.label ?? ''}${sh}${c.pending ? 'p' : ''}`;
}
