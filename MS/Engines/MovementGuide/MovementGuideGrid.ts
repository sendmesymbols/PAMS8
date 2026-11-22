/**
 * MovementGuideGrid.ts
 *
 * The 1:50k sheets' grid for bearings. Bearings worked out on the map are true (Web Mercator is conformal); a route card
 * gives grid bearings, and the compass is set from them with the sheet's grid-magnetic angle. The Survey of Pakistan
 * sheets carry the Indian grid (Kalianpur, Lambert conformal conic with one standard parallel), whose grid north lies
 * sin(lat0) x (lon - lon0) east of true north: about 3.4° at Lahore, so a true bearing called grid puts the compass about
 * 60 m off in a km.
 *
 * The zones and the line between them come from the bundle's sheets.json `grid` (zone I lat0 32.5 / lon0 68, zone IIa
 * lat0 26 / lon0 74, `boundary` the zone line); the grid is only given on a 1:50k sheet (`50k` boxes), elsewhere null and
 * the engines fall back to the UTM grid (PlatoonGuideRead `plConvergence`). The same reading as the Platoon Guide's probe
 * (PlatoonGuideProbe.gridConvergence), kept here so the Movement Guide's probe (and the Deployment Mgr's small ops, which
 * read it) give the same grid. Pure: no DOM, no fetch; Node runs it (tools/movement-test/plans.mjs).
 */

const D2R = Math.PI / 180;

/** sheets.json `grid`: Lambert zones with their origins, and the line between zone I and IIa (lon / lat pairs). */
export interface SheetGrid {
  name?: string;
  zones: Array<{ id: string; lat0: number; lon0: number }>;
  boundary?: number[][];
}
/** A 1:50k sheet as sheets.json lists it: [number, west, south, east, north] in degrees. */
export type SheetBox = [string, number, number, number, number];

/** The latitude of the zone line at a longitude (sheets.json `grid.boundary`, lon / lat pairs), null off its ends. */
export function zoneLineLat(b: number[][] | undefined, lon: number): number | null {
  for (let i = 0; b && i + 1 < b.length; i++) {
    const [x0, y0] = b[i];
    const [x1, y1] = b[i + 1];
    if ((lon >= x0 && lon <= x1) || (lon >= x1 && lon <= x0)) return x1 === x0 ? y0 : y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
  }
  return null;
}

/** The zone a place is in: zone I north of the zone line, IIa south of it (28.5° N when the line does not reach). */
export function sheetZone(g: SheetGrid, lng: number, lat: number): { id: string; lat0: number; lon0: number } | null {
  if (!g?.zones?.length) return null;
  const bl = zoneLineLat(g.boundary, lng);
  const id = bl === null ? (lat >= 28.5 ? 'I' : 'IIa') : lat >= bl ? 'I' : 'IIa';
  const z = g.zones.find((q) => q.id === id) ?? g.zones[0];
  return Number.isFinite(z?.lat0) && Number.isFinite(z?.lon0) ? z : null;
}

/** How far grid north lies east of true north in a zone, degrees (Lambert, one parallel: sin(lat0) x (lon - lon0)). */
export function lambertConvergence(lat0: number, lon0: number, lng: number): number {
  return Math.sin(lat0 * D2R) * (lng - lon0);
}

/**
 * The sheets' grid read from sheets.json: `convergence(lng, lat)` gives how far grid north lies east of true north and
 * the grid's name ("Indian grid zone I"), null off the 1:50k sheets or when the file has no grid.
 */
export class SheetGridReader {
  private _grid: SheetGrid | null = null;
  private _sheets: SheetBox[] | null = null;
  /** The sheet the last place fell on (a route's legs fall on the same few sheets). */
  private _last: SheetBox | null = null;

  /** Take sheets.json (its `50k` list and `grid`); anything else clears it. */
  load(json: unknown): void {
    const j = (json && typeof json === 'object' ? json : {}) as Record<string, any>;
    this._sheets = Array.isArray(j['50k']) ? (j['50k'] as SheetBox[]) : null;
    this._grid = Array.isArray(j.grid?.zones) && j.grid.zones.length ? (j.grid as SheetGrid) : null;
    this._last = null;
  }
  clear(): void {
    this.load(null);
  }
  get ready(): boolean {
    return this._grid !== null && this._sheets !== null;
  }
  /** The 1:50k sheet a place is on, null off them. */
  sheetAt(lng: number, lat: number): string | null {
    const inBox = (s: SheetBox) => lng >= s[1] && lng < s[3] && lat >= s[2] && lat < s[4];
    if (this._last && inBox(this._last)) return this._last[0];
    for (const s of this._sheets ?? []) {
      if (inBox(s)) {
        this._last = s;
        return s[0];
      }
    }
    return null;
  }
  convergence(lng: number, lat: number): { deg: number; name: string } | null {
    const g = this._grid;
    if (!g || !this.sheetAt(lng, lat)) return null;
    const z = sheetZone(g, lng, lat);
    return z ? { deg: lambertConvergence(z.lat0, z.lon0, lng), name: `Indian grid zone ${z.id}` } : null;
  }
}
