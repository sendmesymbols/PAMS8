/**
 * GroundGuidePopulation.ts
 *
 * Reads the terrain bundle's population grid (bundle v2 `population/population.json` + `population.bin`, written by
 * the pipeline's population.py) for the Ground Guide: how many people live round a point (B in GROTBC, civil
 * considerations). The grid is WorldPop's 2026 estimate on 30" (~1 km) cells: people per cell, males 15-49,
 * children under 15, people 65 and over, and the 2020 unconstrained density. Estimates modelled from buildings,
 * not a census; every reading says so.
 *
 * Same rule as the tile cache: `around()` is synchronous and reads only what is in memory (the whole grid, ~33 MB,
 * fetched once in the background by `load()`); it returns null until the grid has arrived. Readings are cached per
 * cell, so following the cursor across one cell costs nothing.
 */

import type {
  MercXY,
  GroundGuidePopulationClass,
  GroundGuidePopulationPlace,
  GroundGuidePopulationReading,
  GroundGuideProfile,
} from './GroundGuideTypes';

/** The six density classes, people per km² (ground-guide-population-options.html section 2). Colours are the B family. */
export const POPULATION_CLASSES: readonly GroundGuidePopulationClass[] = [
  { key: 'empty', label: 'Empty', min: 0, color: '#3a3d42', dark: true },
  { key: 'sparse', label: 'Sparse', min: 1, color: '#5a524b', dark: true },
  { key: 'rural', label: 'Rural', min: 50, color: '#7d7168', dark: true },
  { key: 'denseRural', label: 'Dense Rural', min: 250, color: '#a5978a', dark: false },
  { key: 'town', label: 'Town', min: 1000, color: '#cdbca7', dark: false },
  { key: 'urban', label: 'Urban', min: 5000, color: '#f0e2c8', dark: false },
];

/** The class of a density (people per km²). */
export function populationClass(perKm2: number): GroundGuidePopulationClass {
  let c = POPULATION_CLASSES[0];
  for (const x of POPULATION_CLASSES) if (perKm2 >= x.min) c = x;
  return c;
}

/**
 * Civil flag per unit type: people within `km` from which the card raises it, and why it matters. Advisory only.
 * A unit type that is not listed never gets the flag.
 */
export const POPULATION_FLAGS: Partial<Record<GroundGuideProfile, { km: number; min: number; message: string }>> = {
  gun: { km: 1, min: 200, message: 'Civilians within 1 km: collateral risk, and counter-battery fire falls among them' },
  ad: { km: 1, min: 200, message: 'Civilians within 1 km: debris and counter-fire risk, and the site will be seen' },
  hls: { km: 1, min: 50, message: 'People within 1 km: crowds, loose objects and early warning of the landing' },
  signals: { km: 2, min: 500, message: 'People within 2 km: the site will be seen and reported' },
  tracked: { km: 1, min: 2000, message: 'Busy ground within 1 km: villages to pass through and crowded tracks' },
  wheeled: { km: 1, min: 2000, message: 'Busy ground within 1 km: villages to pass through and crowded tracks' },
  roadbound: { km: 1, min: 5000, message: 'Town on the route within 1 km: traffic and a chokepoint' },
};

const RINGS_KM = [1, 2, 3, 5, 10] as const;
const BANDS_KM: ReadonlyArray<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 7], [7, 10]];
const MAX_KM = 10;
const GRID_SIZE = 11;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const EARTH_R = 6378137;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

/** Province names on the bundle's places (NCGDB / GeoNames spellings) → the province table's GADM 3.6 names. */
const PROVINCE_ALIASES: Record<string, string> = {
  punjab: 'Punjab',
  'punjab-i': 'Punjab',
  sindh: 'Sind',
  sind: 'Sind',
  'khyber pakhtunkhwa': 'N.W.F.P.',
  kpk: 'N.W.F.P.',
  'n.w.f.p.': 'N.W.F.P.',
  balochistan: 'Baluchistan',
  baluchistan: 'Baluchistan',
  fata: 'F.A.T.A.',
  'f.a.t.a.': 'F.A.T.A.',
  ajk: 'Azad Kashmir',
  'azad kashmir': 'Azad Kashmir',
  'azad jammu and kashmir': 'Azad Kashmir',
  islamabad: 'F.C.T.',
  ict: 'F.C.T.',
  'f.c.t.': 'F.C.T.',
  'gilgit-baltistan': 'Northern Areas',
  'gilgit baltistan': 'Northern Areas',
  'northern areas': 'Northern Areas',
};

interface PopulationHeader {
  format: string;
  bounds: [number, number, number, number];
  cell: number;
  cols: number;
  rows: number;
  nodata: number;
  layers: Array<{ id: string; scale: number; source?: string; dataDate?: string; released?: string }>;
  file?: string;
  year?: number;
  provinces?: { rows?: Array<{ name: string; density: number; pwdA: number }> };
}

/** The part of a reading that depends only on the grid cell (cached while the cursor stays in it). */
type CellReading = Omit<GroundGuidePopulationReading, 'lngLat' | 'places' | 'pending' | 'province'>;

/** A source of named places round a point (GroundGuideFeatures.placesNear). */
export type PlacesSource = (at: MercXY, radiusM: number) => { list: GroundGuidePopulationPlace[]; pending: boolean };

export class GroundGuidePopulation {
  private _hdr: PopulationHeader | null = null;
  /** Layer id → raw uint16 values; `_val` divides by the layer's scale and drops no-data. */
  private _layers = new Map<string, Uint16Array>();
  private _scale = new Map<string, number>();
  private _loading: Promise<boolean> | null = null;
  private _failed = false;
  private _destroyed = false;
  private _cacheKey = '';
  private _cached: CellReading | null = null;

  constructor(
    private _base: string,
    private _meta: { index: string; data: string },
    private _onReady: () => void,
  ) {}

  /** The grid is in memory. */
  get ready(): boolean {
    return this._hdr !== null && this._layers.has('pop');
  }

  /** Grid header (bounds, cell size, layer list with source dates), once loaded. */
  get header(): Readonly<PopulationHeader> | null {
    return this._hdr;
  }

  /** Fetch the grid in the background (once). Resolves true when it is in memory. */
  load(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    if (this._failed) return Promise.resolve(false);
    if (!this._loading) this._loading = this._load();
    return this._loading;
  }

  destroy(): void {
    this._destroyed = true;
    this._layers.clear();
    this._hdr = null;
    this._cached = null;
  }

  /**
   * People round a point (WGS84), or null while the grid is loading or outside it. `places` adds the named places
   * within 10 km and the province comparison; without it those come back empty.
   */
  around(lng: number, lat: number, radiusKm: number, places?: PlacesSource): GroundGuidePopulationReading | null {
    const h = this._hdr;
    if (!h || !this.ready) return null;
    const [w, s, e, n] = h.bounds;
    if (lng < w || lng > e || lat < s || lat > n) return null;
    const r0 = Math.floor((n - lat) / h.cell);
    const c0 = Math.floor((lng - w) / h.cell);
    const key = `${r0}|${c0}|${radiusKm}`;
    if (key !== this._cacheKey || !this._cached) {
      this._cached = this._compute(r0, c0, lat, radiusKm);
      this._cacheKey = key;
    }
    const base = this._cached;
    let list: GroundGuidePopulationPlace[] = [];
    let pending = false;
    if (places) {
      const at: MercXY = [(lng * Math.PI * EARTH_R) / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * EARTH_R];
      ({ list, pending } = places(at, MAX_KM * 1000));
    }
    return { ...base, lngLat: [lng, lat], places: list, pending, province: this._province(list) };
  }

  /** People per km² of one grid cell (null = no data), for the map layer. `row`/`col` in grid cells. */
  cellDensity(row: number, col: number): number | null {
    const h = this._hdr;
    const pop = this._layers.get('pop');
    if (!h || !pop || row < 0 || col < 0 || row >= h.rows || col >= h.cols) return null;
    const v = pop[row * h.cols + col];
    if (v === h.nodata) return null;
    const lat = h.bounds[3] - (row + 0.5) * h.cell;
    return v / (this._scale.get('pop') ?? 1) / this._cellAreaKm2(lat);
  }

  private _cellAreaKm2(lat: number): number {
    const c = this._hdr!.cell;
    return c * KM_PER_DEG_LAT * c * KM_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
  }

  private _val(id: string, i: number): number {
    const a = this._layers.get(id);
    if (!a) return 0;
    const v = a[i];
    return v === this._hdr!.nodata ? 0 : v / (this._scale.get(id) ?? 1);
  }

  private _compute(r0: number, c0: number, lat: number, radiusKm: number): CellReading {
    const h = this._hdr!;
    const cell = h.cell;
    const kx = KM_PER_DEG_LON * Math.cos((lat * Math.PI) / 180) * cell; // km per cell east-west
    const ky = KM_PER_DEG_LAT * cell;
    const reach = Math.max(MAX_KM, radiusKm);
    const dr = Math.ceil(reach / ky) + 1;
    const dc = Math.ceil(reach / Math.max(kx, 0.05)) + 1;
    const ringPeople = RINGS_KM.map(() => 0);
    const bandPeople = BANDS_KM.map(() => 0);
    const sectors = [0, 0, 0, 0, 0, 0, 0, 0];
    const ages = { males15_49: 0, under15: 0, over65: 0 };
    const hasAges = this._layers.has('males15_49') && this._layers.has('under15') && this._layers.has('over65');
    let within = 0;
    const half = Math.floor(GRID_SIZE / 2);
    const grid: number[] = new Array(GRID_SIZE * GRID_SIZE).fill(-1);
    const area = this._cellAreaKm2(lat);
    for (let r = r0 - dr; r <= r0 + dr; r++) {
      if (r < 0 || r >= h.rows) continue;
      for (let c = c0 - dc; c <= c0 + dc; c++) {
        if (c < 0 || c >= h.cols) continue;
        const i = r * h.cols + c;
        const raw = this._layers.get('pop')![i];
        const gr = r - r0 + half;
        const gc = c - c0 + half;
        if (gr >= 0 && gr < GRID_SIZE && gc >= 0 && gc < GRID_SIZE) grid[gr * GRID_SIZE + gc] = raw === h.nodata ? -1 : this._val('pop', i) / area;
        if (raw === h.nodata || raw === 0) continue;
        const p = this._val('pop', i);
        // From the centre of the point's cell (readings are cached per cell, so they must not depend on where in it).
        const dx = (c - c0) * kx; // km east
        const dy = (r0 - r) * ky; // km north
        const d = Math.hypot(dx, dy);
        RINGS_KM.forEach((k, j) => {
          if (d <= k) ringPeople[j] += p;
        });
        BANDS_KM.forEach(([a, b], j) => {
          if (d >= a && d < b) bandPeople[j] += p;
        });
        if (d <= radiusKm) {
          within += p;
          if (d > 0.01) sectors[Math.round((((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360) / 45) % 8] += p;
          else for (let k = 0; k < 8; k++) sectors[k] += p / 8;
          if (hasAges) {
            ages.males15_49 += this._val('males15_49', i);
            ages.under15 += this._val('under15', i);
            ages.over65 += this._val('over65', i);
          }
        }
      }
    }
    const perKm2 = within / (Math.PI * radiusKm * radiusKm);
    const d20 = this._layers.has('density_2020') ? this._val('density_2020', r0 * h.cols + c0) : null;
    const popLayer = h.layers.find((l) => l.id === 'pop');
    return {
      radiusKm,
      rings: RINGS_KM.map((km, j) => ({ km, people: ringPeople[j] })),
      people: within,
      perKm2,
      cls: populationClass(perKm2),
      ages: hasAges ? ages : null,
      bands: BANDS_KM.map(([a, b], j) => ({ fromKm: a, toKm: b, perKm2: bandPeople[j] / (Math.PI * (b * b - a * a)) })),
      sectors,
      grid: { size: GRID_SIZE, cellKm: (kx + ky) / 2, perKm2: grid },
      density2020: d20,
      source: {
        label: `WorldPop ${h.year ?? ''} Estimate`.replace('  ', ' '),
        dataDate: popLayer?.dataDate ?? null,
        released: popLayer?.released ?? null,
      },
    };
  }

  /** The province of the nearest place that names one, with its 2020 average and typical-resident density. */
  private _province(places: GroundGuidePopulationPlace[]): GroundGuidePopulationReading['province'] {
    const rows = this._hdr?.provinces?.rows;
    if (!rows?.length) return null;
    for (const p of places) {
      if (!p.province) continue;
      const name = PROVINCE_ALIASES[p.province.trim().toLowerCase()] ?? p.province;
      const row = rows.find((r) => r.name.toLowerCase() === name.toLowerCase());
      if (row) return { name: displayProvince(row.name), perKm2: row.density, typicalPerKm2: row.pwdA };
      return null; // the nearest named province is not in the table (outside Pakistan): no comparison
    }
    return null;
  }

  private async _load(): Promise<boolean> {
    try {
      const hr = await fetch(`${this._base}/${this._meta.index}`);
      if (!hr.ok) throw new Error(`population header HTTP ${hr.status}`);
      const hdr = (await hr.json()) as PopulationHeader;
      if (hdr?.format !== 'pams-population-grid') throw new Error('population.json is not a pams-population-grid');
      const r = await fetch(`${this._base}/${this._meta.data}`);
      if (!r.ok) throw new Error(`population grid HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const n = hdr.rows * hdr.cols;
      if (buf.byteLength < hdr.layers.length * n * 2) throw new Error('population grid is shorter than its header says');
      if (this._destroyed) return false;
      // Little-endian uint16, layers one after another; every browser this runs on is little-endian.
      hdr.layers.forEach((l, i) => {
        this._layers.set(l.id, new Uint16Array(buf, i * n * 2, n));
        this._scale.set(l.id, l.scale || 1);
      });
      this._hdr = hdr;
      this._onReady();
      return true;
    } catch {
      this._failed = !this._destroyed;
      this._loading = null;
      return false;
    }
  }
}

/** GADM 3.6 names as people now say them. */
function displayProvince(name: string): string {
  return ({ 'N.W.F.P.': 'Khyber Pakhtunkhwa', Sind: 'Sindh', Baluchistan: 'Balochistan', 'F.A.T.A.': 'FATA', 'F.C.T.': 'Islamabad', 'Northern Areas': 'Gilgit-Baltistan' } as Record<string, string>)[name] ?? name;
}

/** Compass point for a bearing. */
export function compassOf(bearingDeg: number): string {
  return COMPASS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];
}
