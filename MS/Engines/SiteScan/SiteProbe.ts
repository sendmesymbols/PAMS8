/**
 * SiteProbe.ts
 *
 * The terrain bundle for the site finders (Gun Deployment, Admin Area): answers SiteScan's `SiteProbe` reads from
 * tiles already in memory, never waiting. It is the Movement Guide's bundle reader (MovementGuideProbe: tile cache and
 * worker, features, road network, population) with an instance of its own per finder, plus the climate grid (the
 * month's rain at the place) and the OCOKA surface blockers (what stands on the ground: trees, crops, buildings), so
 * each finder works whether the Ground Guide or Movement Guide is on or off and tears down on its own.
 *
 * Nothing is created until `configure()`, and a finder calls it only while its own switch is on (claude_rules.md: a
 * switched-off feature never looks for the bundle). A missing bundle resolves false: one log line, the panel says so.
 */

import { MovementGuideProbe } from '../MovementGuide/MovementGuideProbe';
import { ClimateGrid } from '../GroundGuide/GroundGuideGoing';
import { sightTables, type SightTables } from '../GroundGuide/GroundGuideOcoka';
import { OCOKA_DOCTRINE } from '../GroundGuide/GroundGuideOcokaRead';
import { WindLoader, windAt } from '../GroundGuide/GroundGuideWind';
import type { SiteFeature, SiteProbe, SiteRoad, SiteWind } from './SiteScan';
import { mercToLngLat } from './SiteScan';

export class SiteBundle implements SiteProbe {
  private _probe: MovementGuideProbe;
  private _ready = false;
  private _climate: ClimateGrid | null = null;
  private _wind: WindLoader | null = null;
  private _tables: { key: string; t: SightTables } | null = null;
  private _onChange: () => void;

  constructor(onChange: () => void) {
    this._onChange = onChange;
    this._probe = new MovementGuideProbe(() => this._onChange());
  }

  get ready(): boolean {
    return this._ready;
  }
  get rules(): any {
    return this._probe.rules;
  }
  get manifest(): any {
    return this._probe.manifest;
  }
  /** Bumped whenever data arrives. */
  get tick(): number {
    return this._probe.tick;
  }

  /** Open the bundle. Resolves false (and keeps nothing) when it is not there. */
  async configure(base: string, opts: { cacheTiles: number; useWorker: boolean }): Promise<boolean> {
    this._ready = false;
    this._climate = null;
    this._wind = null;
    try {
      this._ready = await this._probe.configure(base, opts);
    } catch {
      this._ready = false;
    }
    if (this._ready) {
      const c = (this._probe.manifest as any)?.grotbc?.climate;
      if (c?.index && c?.data) this._climate = new ClimateGrid(`${base}/${c.index}`, `${base}/${c.data}`, () => this._onChange());
      // the wind grid (ERA5 normal), fetched on the first windAt
      const w = (this._probe.manifest as any)?.grotbc?.wind;
      if (typeof w?.index === 'string' && typeof w?.data === 'string') this._wind = new WindLoader(`${base}/${w.index}`, `${base}/${w.data}`, () => this._onChange());
    }
    return this._ready;
  }

  destroy(): void {
    this._ready = false;
    this._climate = null;
    this._wind = null;
    this._probe.destroy();
  }

  /** Start a read: pending flags collected from here on. */
  begin(): void {
    this._probe.takePending();
  }
  /** True when a read since `begin()` met a tile or reader still on its way. */
  pending(): boolean {
    return this._probe.takePending();
  }

  dataLine(): string {
    return this._probe.dataLine();
  }
  classLabel(c: number): string {
    return this._probe.classLabel(c);
  }

  cls(x: number, y: number): number | null {
    return this._ready ? this._probe.cls(x, y) : null;
  }
  elev(x: number, y: number): number {
    return this._ready ? this._probe.elev(x, y) : NaN;
  }
  layer(key: string, x: number, y: number): number | null {
    return this._ready ? this._probe.layerAt(key, x, y) : null;
  }
  dist(profile: string, x: number, y: number): number | null {
    return this._ready ? this._probe.distAt(profile, x, y) : null;
  }
  roads(x: number, y: number, radiusM: number): SiteRoad[] {
    return this._ready ? this._probe.roads(x, y, radiusM) : [];
  }
  features(x: number, y: number, radiusM: number, kinds: ReadonlySet<string>): SiteFeature[] {
    return this._ready ? this._probe.features(x, y, radiusM, kinds) : [];
  }
  people(x: number, y: number): number | null {
    return this._ready ? this._probe.people(x, y) : null;
  }
  sight(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null {
    return this._ready ? this._probe.sight(ox, oy, eyeM, tx, ty, targetM) : null;
  }

  /** The climate grid is still on its way (a null `precAt` may only mean "not loaded yet"). */
  get climateLoading(): boolean {
    const s = this._climate?.state;
    return s === 'idle' || s === 'loading';
  }

  /** Twelve monthly rain normals (mm) at a Web Mercator point; null while loading or without the climate grid. */
  precAt(x: number, y: number): number[] | null {
    if (!this._climate) return null;
    const [lng, lat] = mercToLngLat(x, y);
    return this._climate.precAt(lng, lat);
  }

  /** The wind grid is still on its way (a null `windAt` may only mean "not loaded yet"). */
  get windLoading(): boolean {
    const s = this._wind?.state;
    return s === 'idle' || s === 'loading';
  }

  /**
   * The month's usual wind at a Web Mercator point (GroundGuideWind.windAt with no steadiness cut: the finder judges the
   * steadiness by its own doctrine figure); null while loading or without the wind grid.
   */
  windAt(x: number, y: number, month: number): SiteWind | null {
    const g = this._wind?.get() ?? null;
    if (!g) return null;
    const [lng, lat] = mercToLngLat(x, y);
    const r = windAt(g, lng, lat, month, 5, { steadyMin: 0, steadyWord: 0.6, lightKt: 3, turnDeg: 90 });
    if (!r) return null;
    return { fromDeg: r.all.fromDeg, steady: r.all.steady, meanMs: r.all.meanMs, dayFromDeg: r.day.fromDeg, nightFromDeg: r.night.fromDeg, dataDate: r.dataDate };
  }

  /**
   * Metres standing above the elevation at a point in a month (trees, tall crops, buildings), from the OCOKA surface
   * blockers: counted only where the class is mostly covered by them (chance per 30 m cell 0.3 or more), so a crest is
   * not raised by a lone tree. The elevation is the GLO-30 surface model, which already carries part of the canopy.
   */
  standing(x: number, y: number, month: number): number {
    if (!this._ready) return 0;
    const key = String(month);
    if (this._tables?.key !== key) this._tables = { key, t: sightTables(OCOKA_DOCTRINE, month, this._probe.resM || 30) };
    const T = this._tables.t;
    let h = 0;
    const c = this._probe.cls(x, y);
    if (c !== null && T.q[c] >= 0.3) h = T.h[c];
    const b = this._probe.layerAt('bld', x, y);
    if (b !== null && b !== 255 && (b & 63) && T.bldQ[b & 63] >= 0.3) h = Math.max(h, T.bldH[b >> 6] ?? 0);
    return h;
  }
}

export default SiteBundle;
