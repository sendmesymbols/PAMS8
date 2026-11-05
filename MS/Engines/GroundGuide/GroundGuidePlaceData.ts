/**
 * GroundGuidePlaceData.ts
 *
 * The terrain bundle's whole-country files, loaded once in the background when a section needs them, then read
 * synchronously (hot-path rule: no I/O on mouse-move):
 *   admin.geojson       province / district / tehsil polygons (B: where the point is). The `corps_aor` layer is
 *                       marked sensitive in the bundle and is never read here.
 *   boundaries.geojson  international boundaries and the Line of Control (B: distance to the border). Province lines
 *                       are left out.
 *   sheets.json         1:50k / 1:250k map sheet numbers (B: the sheet for orders).
 *   routes.json         named roads: from, to, length, MSR, load class range, recorded condition and closures (R).
 * Each file is optional; a missing one simply leaves its line off.
 */

const R_EARTH = 6371008.8;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

type Ring = number[][];
interface AdminPoly {
  layer: 'province' | 'district' | 'tehsil';
  name: string;
  bbox: [number, number, number, number];
  rings: Ring[][]; // polygons -> rings -> points
}
interface BorderLine {
  kind: string;
  name: string | null;
  bbox: [number, number, number, number];
  lines: number[][][];
}

export interface PlaceAdmin {
  province: string | null;
  district: string | null;
  tehsil: string | null;
}

export interface PlaceBorder {
  /** "Line of Control", "Pakistan-India", ... as the bundle names it. */
  kind: string;
  distanceKm: number;
  compass: string;
}

export interface PlaceSheet {
  s50k: string | null;
  s250k: string | null;
}

export interface PlaceRoute {
  name: string;
  number: string | null;
  from: string | null;
  to: string | null;
  km: number | null;
  msr: boolean;
  load: [number, number] | null;
  closed: string | null;
  condition: string | null;
}

function bboxOf(coords: number[][][]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const line of coords) {
    for (const [x, y] of line) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false; // a hole
  return true;
}

/** Distance (m) and bearing from a lon / lat to the nearest point of a line, on a local flat projection. */
function nearestOnLine(lon: number, lat: number, line: number[][]): { d: number; brg: number } {
  const kx = (Math.PI / 180) * R_EARTH * Math.cos((lat * Math.PI) / 180);
  const ky = (Math.PI / 180) * R_EARTH;
  let best = { d: Infinity, brg: 0 };
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = (line[i][0] - lon) * kx;
    const ay = (line[i][1] - lat) * ky;
    const bx = (line[i + 1][0] - lon) * kx;
    const by = (line[i + 1][1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const d = Math.hypot(qx, qy);
    if (d < best.d) best = { d, brg: ((Math.atan2(qx, qy) * 180) / Math.PI + 360) % 360 };
  }
  return best;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** "RAWALPINDI" -> "Rawalpindi"; names already in mixed case are kept. */
function tidy(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_m, a: string, c: string) => a + c.toUpperCase()) : s;
}

export class GroundGuidePlaceData {
  private _admin: AdminPoly[] | null = null;
  private _borders: BorderLine[] | null = null;
  private _sheets: { s50k: Array<[string, number, number, number, number]>; s250k: Array<[string, number, number, number, number]> } | null = null;
  private _routes: Map<string, PlaceRoute> | null = null;
  private _loading = new Set<string>();
  private _failed = new Set<string>();

  constructor(
    private readonly _base: string,
    private readonly _onReady: () => void,
  ) {}

  /** Start loading what `want` names (once); true when every named file is in memory or has failed. */
  ensure(want: { admin?: boolean; borders?: boolean; sheets?: boolean; routes?: boolean }): boolean {
    let ready = true;
    const go = (key: string, loaded: boolean, load: () => Promise<void>) => {
      if (loaded || this._failed.has(key)) return;
      ready = false;
      if (this._loading.has(key)) return;
      this._loading.add(key);
      load()
        .catch(() => this._failed.add(key))
        .finally(() => {
          this._loading.delete(key);
          this._onReady();
        });
    };
    if (want.admin) go('admin', !!this._admin, () => this._loadAdmin());
    if (want.borders) go('borders', !!this._borders, () => this._loadBorders());
    if (want.sheets) go('sheets', !!this._sheets, () => this._loadSheets());
    if (want.routes) go('routes', !!this._routes, () => this._loadRoutes());
    return ready;
  }

  /** Province, district and tehsil at a point (null fields when outside, or the file is not loaded yet). */
  adminAt(lon: number, lat: number): PlaceAdmin | null {
    if (!this._admin) return null;
    const out: PlaceAdmin = { province: null, district: null, tehsil: null };
    for (const p of this._admin) {
      const [w, s, e, n] = p.bbox;
      if (lon < w || lon > e || lat < s || lat > n || out[p.layer]) continue;
      if (p.rings.some((rings) => inPolygon(lon, lat, rings))) out[p.layer] = p.name;
    }
    return out.province || out.district || out.tehsil ? out : null;
  }

  /** The nearest international boundary or Line of Control within `maxKm`. */
  borderNear(lon: number, lat: number, maxKm = 150): PlaceBorder | null {
    if (!this._borders) return null;
    const pad = maxKm / 90; // degrees, generous at these latitudes
    let best: PlaceBorder | null = null;
    for (const b of this._borders) {
      const [w, s, e, n] = b.bbox;
      if (lon < w - pad || lon > e + pad || lat < s - pad || lat > n + pad) continue;
      for (const line of b.lines) {
        const r = nearestOnLine(lon, lat, line);
        const km = r.d / 1000;
        if (km <= maxKm && (!best || km < best.distanceKm)) best = { kind: b.kind, distanceKm: km, compass: COMPASS[Math.round(r.brg / 45) % 8] };
      }
    }
    return best;
  }

  sheetAt(lon: number, lat: number): PlaceSheet | null {
    if (!this._sheets) return null;
    const find = (list: Array<[string, number, number, number, number]>) => list.find(([, w, s, e, n]) => lon >= w && lon < e && lat >= s && lat < n)?.[0] ?? null;
    const s50k = find(this._sheets.s50k);
    const s250k = find(this._sheets.s250k);
    return s50k || s250k ? { s50k, s250k } : null;
  }

  /** A named road by its number ("N-5") or name, as routes.json records it. */
  route(numberOrName: string | null | undefined): PlaceRoute | null {
    if (!this._routes || !numberOrName) return null;
    return this._routes.get(numberOrName.trim().toUpperCase()) ?? null;
  }

  private async _json(file: string): Promise<any> {
    const r = await fetch(`${this._base}/${file}`);
    if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
    return r.json();
  }

  private async _loadAdmin(): Promise<void> {
    const gj = await this._json('admin.geojson');
    const out: AdminPoly[] = [];
    for (const f of gj?.features ?? []) {
      const layer = f?.properties?.layer;
      if (layer !== 'province' && layer !== 'district' && layer !== 'tehsil') continue; // corps_aor is sensitive: never read
      const g = f.geometry;
      const polys: Ring[][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
      if (!polys.length) continue;
      out.push({ layer, name: tidy(f.properties.name) ?? '', bbox: bboxOf(polys.map((p) => p[0])), rings: polys });
    }
    // Tehsils first so the smallest area wins when names overlap; each layer is filled once per point.
    this._admin = out;
  }

  private async _loadBorders(): Promise<void> {
    const gj = await this._json('boundaries.geojson');
    const out: BorderLine[] = [];
    for (const f of gj?.features ?? []) {
      const kind = str(f?.properties?.kind);
      if (!kind) continue;
      // International lines, the LoC and the LAC only: province and "political" lines are internal, and corps
      // operational lines are sensitive.
      const k = kind.toLowerCase();
      if (k.startsWith('province') || k.startsWith('corps') || k.startsWith('political')) continue;
      const g = f.geometry;
      const lines: number[][][] = g?.type === 'LineString' ? [g.coordinates] : g?.type === 'MultiLineString' ? g.coordinates : [];
      if (!lines.length) continue;
      out.push({ kind, name: str(f.properties.name), bbox: bboxOf(lines), lines });
    }
    this._borders = out;
  }

  private async _loadSheets(): Promise<void> {
    const js = await this._json('sheets.json');
    this._sheets = { s50k: js?.['50k'] ?? [], s250k: js?.['250k'] ?? [] };
  }

  private async _loadRoutes(): Promise<void> {
    const js = await this._json('routes.json');
    const map = new Map<string, PlaceRoute>();
    for (const r of js?.roads ?? []) {
      const number = str(r.no);
      const segs: string[] = Array.isArray(r.segs) ? r.segs.map(str).filter((x: string | null): x is string => !!x) : [];
      const name = tidy(r.name) ?? segs.find((s) => s !== number) ?? number ?? str(r.id) ?? '';
      const load = Array.isArray(r.load) && r.load.length === 2 && r.load.every((x: unknown) => typeof x === 'number') ? (r.load as [number, number]) : null;
      const closed = Array.isArray(r.closed) ? r.closed.filter(Boolean).join(', ') || null : str(r.closed);
      const condition = Array.isArray(r.cond) ? r.cond.filter(Boolean).join(', ') || null : str(r.cond);
      const entry: PlaceRoute = { name, number, from: tidy(r.from), to: tidy(r.to), km: typeof r.km === 'number' ? r.km : null, msr: r.msr === true || r.msr === 1, load, closed, condition };
      for (const key of [number, str(r.id), str(r.name), ...segs]) if (key && !map.has(key.toUpperCase())) map.set(key.toUpperCase(), entry);
    }
    this._routes = map;
  }
}
