/**
 * CollabPresence.ts
 *
 * Everything you SEE about other people: cursors, fading mouse trails,
 * in-progress drawing previews, and lock badges.
 *
 * Split across two surfaces on purpose:
 *
 *   DOM overlay      Cursor arrow + name chip, absolutely positioned inside the
 *                    view container and re-projected from a geographic point
 *                    every frame. Crisp at any zoom, costs no graphics, and
 *                    cannot be picked up by hit-testing, selection, or export.
 *
 *   GraphicsLayer    Trails, previews, and lock badges, which are geographic by
 *                    nature. The layer id is deliberately NOT in
 *                    SYMBOL_LAYER_IDS, so save/load, GeoJSON export, declutter,
 *                    selection and the context menu all skip it with no
 *                    exclusion code anywhere.
 *
 * One rAF pass repaints whatever is dirty. Nothing runs while the room is empty.
 */

import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import type GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import type MapView from '@arcgis/core/views/MapView';
import type SceneView from '@arcgis/core/views/SceneView';

import GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
import { mergeDefined } from './CollabDebug';
import type { ClientId, ViewportPayload } from './CollabTypes';
import type { RemoteLock } from './CollabLocks';

/** Presence overlay layer. Intentionally outside SYMBOL_LAYER_IDS. */
export const COLLAB_LAYER_ID = 'CollabPresenceLayer';

const STYLE_ID = 'ms-collab-style';
/** Drop a peer's cursor after this long without an update. */
const CURSOR_STALE_MS = 8000;
/** Drop a preview that stopped updating (peer cancelled or crashed mid-draw). */
const PREVIEW_STALE_MS = 4000;
/** Minimum gap between graphics-layer rebuilds (~20 fps). */
const LAYER_PAINT_MS = 50;
/**
 * Housekeeping tick. Expiring a stale cursor or preview needs no map movement
 * and no inbound message, so something has to poll for it — but at 1 Hz, not at
 * the frame rate.
 */
const SWEEP_MS = 1000;
/**
 * How long a resolved lock anchor is trusted. Long enough that a repaint storm
 * during a map drag costs one lookup instead of dozens, short enough that a
 * padlock follows its symbol promptly after the holder commits a move.
 */
const ANCHOR_TTL_MS = 500;
/**
 * How long a "look here" ping stays on screen. Long enough to say "that one" out
 * loud and be understood, short enough that a busy discussion does not leave the
 * map covered in stale markers.
 */
const PING_MS = 4000;
/** Ring size in points, start → end. Screen-constant, so it reads the same at any zoom. */
const PING_MIN_PX = 9;
const PING_MAX_PX = 46;
/** Drop a peer's viewport rectangle after this long without a heartbeat. */
const VIEWPORT_STALE_MS = 4000;

interface PeerCursor {
  id: ClientId;
  name: string;
  color: string;
  lon: number;
  lat: number;
  drawing: boolean;
  updatedAt: number;
  /** Most recent positions, oldest first — the trail. */
  trail: Array<[number, number]>;
  el?: HTMLDivElement;
}

interface PeerPreview {
  pid: string;
  owner: ClientId;
  color: string;
  kind: 'point' | 'polyline' | 'polygon';
  pts: Array<[number, number]>;
  label?: string;
  updatedAt: number;
}

/** A "look here" marker, decaying from `at`. */
interface PeerPing {
  owner: ClientId;
  name: string;
  color: string;
  lon: number;
  lat: number;
  at: number;
}

/** Where a peer is looking, as a WGS84 box. */
interface PeerViewport {
  owner: ClientId;
  name: string;
  color: string;
  box: ViewportPayload;
  at: number;
}

export interface PresenceOptions {
  showCursors: boolean;
  showTrails: boolean;
  trailLength: number;
  showPreviews: boolean;
  showLocks: boolean;
  showPings: boolean;
  showViewports: boolean;
}

export default class CollabPresence {
  private _view: MapView | SceneView | null = null;
  private _layer: GraphicsLayer | null = null;
  private _root: HTMLDivElement | null = null;

  private _cursors = new Map<ClientId, PeerCursor>();
  private _previews = new Map<string, PeerPreview>();
  /** Live pings, keyed by owner — one at a time per person, newest replaces. */
  private _pings = new Map<ClientId, PeerPing>();
  private _viewports = new Map<ClientId, PeerViewport>();
  private _locks: RemoteLock[] = [];
  private _findGraphic: ((id: string) => Graphic | null) | null = null;
  private _colorOf: ((id: ClientId) => string) | null = null;
  /** Resolved lock anchors, with the time each was resolved. See ANCHOR_TTL_MS. */
  private _anchors = new Map<string, { pt: Point | null; at: number }>();

  private _raf: number | null = null;
  private _sweep: ReturnType<typeof setInterval> | null = null;
  private _layerTimer: ReturnType<typeof setTimeout> | null = null;
  private _viewWatch: { remove(): void } | null = null;
  /** Last geographic repaint. Cursors follow every frame; the layer does not. */
  private _lastLayerPaint = 0;
  private _opts: PresenceOptions = {
    showCursors: true,
    showTrails: true,
    trailLength: 8,
    showPreviews: true,
    showLocks: true,
    showPings: true,
    showViewports: false,
  };

  public start(
    view: MapView | SceneView,
    resolvers: {
      findGraphic: (id: string) => Graphic | null;
      /** Peer colour by client id — must not depend on that peer having a cursor. */
      colorOf: (id: ClientId) => string;
    },
    opts?: Partial<PresenceOptions>,
  ): void {
    this._view = view;
    this._findGraphic = resolvers.findGraphic;
    this._colorOf = resolvers.colorOf;
    if (opts) this.setOptions(opts);
    CollabPresence._injectStyle();
    this._layer = GraphicsLayerManager.getInstance(view).getOrCreateLayer(COLLAB_LAYER_ID);
    this._mountRoot();
    this._attachViewWatch();
    this._sweep ??= setInterval(() => this._kick(), SWEEP_MS);
    this._kick();
  }

  public onViewChanged(view: MapView | SceneView): void {
    this._teardownRoot();
    this._detachViewWatch();
    this._view = view;
    this._layer = GraphicsLayerManager.getInstance(view).getOrCreateLayer(COLLAB_LAYER_ID);
    this._mountRoot();
    this._attachViewWatch();
    // Cursor elements belonged to the old container — rebuild on next frame.
    this._cursors.forEach((c) => (c.el = undefined));
    this._anchors.clear();
    this._kick();
  }

  /**
   * Repaint when the map moves.
   *
   * Presence positions are geographic, so they need re-projecting whenever the
   * viewpoint changes — which is why _paint() used to re-arm itself
   * unconditionally while anything was on screen. That made one peer holding a
   * selection enough to pin the app at 60 fps indefinitely (a lock is refreshed
   * every ttlMs/2, so `_locks` never empties), rebuilding the whole presence
   * layer 20 times a second over a completely static map. Watching `viewpoint`
   * covers pan, zoom, rotation and 3D camera moves on both view types, and costs
   * nothing when the map is still.
   */
  private _attachViewWatch(): void {
    const view = this._view;
    if (!view) return;
    this._viewWatch = reactiveUtils.watch(
      () => view.viewpoint,
      () => this._kick(),
    );
  }

  private _detachViewWatch(): void {
    this._viewWatch?.remove();
    this._viewWatch = null;
  }

  /**
   * mergeDefined, not spread: a key present-but-undefined would otherwise
   * overwrite its default with undefined and silently switch that overlay off —
   * the same trap CollabEngine and MapSync already guard against.
   */
  public setOptions(opts: Partial<PresenceOptions>): void {
    this._opts = mergeDefined(this._opts, opts);
    this._kick();
  }

  public destroy(): void {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    if (this._sweep) {
      clearInterval(this._sweep);
      this._sweep = null;
    }
    if (this._layerTimer) {
      clearTimeout(this._layerTimer);
      this._layerTimer = null;
    }
    this._detachViewWatch();
    this._anchors.clear();
    this._teardownRoot();
    this._layer?.removeAll();
    // Leave the (now empty) layer in place: recreating it on re-enable is free
    // and removing it would fight any other view holding the same instance.
    this._cursors.clear();
    this._previews.clear();
    this._pings.clear();
    this._viewports.clear();
    this._locks = [];
    this._view = null;
    this._layer = null;
  }

  // ── Inbound state ─────────────────────────────────────────────────────────

  public updateCursor(
    id: ClientId,
    name: string,
    color: string,
    lon: number,
    lat: number,
    drawing: boolean,
  ): void {
    let c = this._cursors.get(id);
    if (!c) {
      c = { id, name, color, lon, lat, drawing, updatedAt: 0, trail: [] };
      this._cursors.set(id, c);
    }
    c.name = name;
    c.color = color;
    c.lon = lon;
    c.lat = lat;
    c.drawing = drawing;
    c.updatedAt = Date.now();
    c.trail.push([lon, lat]);
    const cap = Math.max(2, this._opts.trailLength);
    if (c.trail.length > cap) c.trail.splice(0, c.trail.length - cap);
    this._kick();
  }

  public removePeer(id: ClientId): void {
    const c = this._cursors.get(id);
    c?.el?.remove();
    this._cursors.delete(id);
    for (const [pid, p] of this._previews) if (p.owner === id) this._previews.delete(pid);
    this._pings.delete(id);
    this._viewports.delete(id);
    this._kick();
  }

  public setPreview(
    owner: ClientId,
    color: string,
    pid: string,
    kind: 'point' | 'polyline' | 'polygon',
    pts: Array<[number, number]>,
    label?: string,
  ): void {
    this._previews.set(pid, { pid, owner, color, kind, pts, label, updatedAt: Date.now() });
    this._kick();
  }

  public clearPreview(pid: string): void {
    if (this._previews.delete(pid)) this._kick();
  }

  /**
   * "Look here." One live ping per person: a second ping replaces the first
   * rather than stacking, because the gesture means "this one, now".
   */
  public addPing(id: ClientId, name: string, color: string, lon: number, lat: number): void {
    this._pings.set(id, { owner: id, name, color, lon, lat, at: Date.now() });
    this._kick();
  }

  public setViewport(id: ClientId, name: string, color: string, box: ViewportPayload): void {
    this._viewports.set(id, { owner: id, name, color, box, at: Date.now() });
    this._kick();
  }

  public setLocks(locks: RemoteLock[]): void {
    this._locks = locks;
    // Forget anchors for anything no longer locked, so the cache tracks the lock
    // set rather than growing for the life of the session.
    if (this._anchors.size) {
      const live = new Set(locks.map((l) => l.id));
      for (const id of this._anchors.keys()) if (!live.has(id)) this._anchors.delete(id);
    }
    this._kick();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /**
   * Request one repaint on the next frame. Coalescing many state changes into a
   * single frame is the whole job here — it deliberately does NOT re-arm itself,
   * so a quiet room and a still map cost nothing between the 1 Hz sweep ticks.
   */
  private _kick(): void {
    if (this._raf !== null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._paint();
    });
  }

  private _paint(): void {
    if (!this._view || !this._layer) return;
    this._expire();
    // The DOM cursor is a transform on an existing element — cheap enough to
    // follow the map at full frame rate. The graphics layer rebuilds real
    // Graphic objects, so it repaints at LAYER_PAINT_MS instead; at 60 fps with
    // several peers that difference is hundreds of allocations a second.
    this._paintCursors();
    const since = Date.now() - this._lastLayerPaint;
    if (since >= LAYER_PAINT_MS) {
      this._lastLayerPaint = Date.now();
      this._paintLayer();
    } else if (!this._layerTimer) {
      // Inside the cooldown. Come back exactly when it ends, so a trail update or
      // an expiry that landed here still reaches the screen promptly instead of
      // waiting for the next unrelated repaint.
      this._layerTimer = setTimeout(() => {
        this._layerTimer = null;
        this._kick();
      }, LAYER_PAINT_MS - since);
    }
    // A ping is the only thing here that animates without any input, so it is
    // the only thing that asks for the next frame. `_expire` empties the map
    // after PING_MS and the loop stops on its own.
    if (this._pings.size && !this._layerTimer) this._kick();
  }

  private _expire(): void {
    const now = Date.now();
    for (const [id, c] of this._cursors) {
      if (now - c.updatedAt > CURSOR_STALE_MS) {
        c.el?.remove();
        this._cursors.delete(id);
      }
    }
    for (const [pid, p] of this._previews) {
      if (now - p.updatedAt > PREVIEW_STALE_MS) this._previews.delete(pid);
    }
    for (const [id, p] of this._pings) if (now - p.at > PING_MS) this._pings.delete(id);
    for (const [id, v] of this._viewports) {
      if (now - v.at > VIEWPORT_STALE_MS) this._viewports.delete(id);
    }
  }

  private _paintCursors(): void {
    const root = this._root;
    if (!root) return;
    if (!this._opts.showCursors) {
      root.replaceChildren();
      this._cursors.forEach((c) => (c.el = undefined));
      return;
    }
    for (const c of this._cursors.values()) {
      const screen = this._toScreen(c.lon, c.lat);
      if (!c.el) {
        c.el = CollabPresence._buildCursorEl();
        root.appendChild(c.el);
      }
      if (!screen) {
        c.el.style.display = 'none';
        continue;
      }
      c.el.style.display = '';
      c.el.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
      c.el.style.setProperty('--ms-collab-color', c.color);
      c.el.classList.toggle('ms-collab-drawing', c.drawing);
      const chip = c.el.querySelector('.ms-collab-chip') as HTMLElement | null;
      if (chip && chip.textContent !== c.name) chip.textContent = c.name;
    }
  }

  private _paintLayer(): void {
    const layer = this._layer;
    if (!layer) return;
    const graphics: Graphic[] = [];

    if (this._opts.showTrails) {
      for (const c of this._cursors.values()) {
        if (c.trail.length < 2) continue;
        graphics.push(
          new Graphic({
            geometry: new Polyline({
              paths: [c.trail.map(([lon, lat]) => [lon, lat])],
              spatialReference: { wkid: 4326 },
            }),
            symbol: {
              type: 'simple-line',
              color: CollabPresence._rgba(c.color, 0.55),
              width: 2,
              cap: 'round',
              join: 'round',
            } as any,
          }),
        );
      }
    }

    if (this._opts.showPreviews) {
      for (const p of this._previews.values()) {
        const g = this._previewGraphic(p);
        if (g) graphics.push(g);
      }
    }

    if (this._opts.showLocks) {
      for (const l of this._locks) {
        const g = this._lockGraphic(l);
        if (g) graphics.push(g);
      }
    }

    if (this._opts.showViewports) {
      for (const v of this._viewports.values()) {
        // A rectangle drawn round your own screen edge tells you nothing, so a
        // peer looking at substantially the same place as you is not drawn.
        if (this._viewportMatchesMine(v.box)) continue;
        graphics.push(...CollabPresence._viewportGraphics(v));
      }
    }

    if (this._opts.showPings) {
      const now = Date.now();
      for (const p of this._pings.values()) graphics.push(...CollabPresence._pingGraphics(p, now));
    }

    // Wholesale replace: presence is a handful of graphics and diffing them
    // costs more than rebuilding. Nothing to do at all when the layer is already
    // empty and stays empty — the common case on the housekeeping tick.
    if (!graphics.length && !layer.graphics?.length) return;
    layer.removeAll();
    if (graphics.length) layer.addMany(graphics);
  }

  private _previewGraphic(p: PeerPreview): Graphic | null {
    if (!p.pts.length) return null;
    const color = CollabPresence._rgba(p.color, 0.9);
    if (p.kind === 'point' || p.pts.length === 1) {
      const [lon, lat] = p.pts[0];
      return new Graphic({
        geometry: new Point({ longitude: lon, latitude: lat, spatialReference: { wkid: 4326 } }),
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          size: 10,
          color: CollabPresence._rgba(p.color, 0.35),
          outline: { color, width: 1.5 },
        } as any,
      });
    }
    const path = p.pts.map(([lon, lat]) => [lon, lat]);
    // Close a polygon preview visually without pretending it is a polygon yet —
    // an unfinished ring should not read as a committed area.
    if (p.kind === 'polygon' && p.pts.length > 2) path.push(path[0]);
    return new Graphic({
      geometry: new Polyline({ paths: [path], spatialReference: { wkid: 4326 } }),
      symbol: {
        type: 'simple-line',
        color,
        width: 2,
        style: 'short-dash',
        cap: 'round',
      } as any,
    });
  }

  private _lockGraphic(l: RemoteLock): Graphic | null {
    const anchor = this._anchorOfLock(l);
    if (!anchor) return null;
    // Resolved from the session, not from `_cursors`: a peer only has a cursor
    // entry once it has moved the mouse over the map (and it expires after
    // CURSOR_STALE_MS of stillness), so reading the colour from there gave a
    // white padlock for anyone who selected something without moving.
    const color = this._colorOf?.(l.owner) ?? '#ffffff';
    return new Graphic({
      geometry: anchor,
      symbol: {
        type: 'text',
        text: '🔒',
        color: CollabPresence._rgba(color, 1),
        haloColor: [0, 0, 0, 0.75],
        haloSize: 1.2,
        font: { size: 11 },
        yoffset: 10,
      } as any,
    });
  }

  /**
   * Two markers plus a name: an expanding ring that eases outward and fades, and
   * a solid dot that stays put so the exact spot is unambiguous once the ring has
   * gone. Sizes are in points, not map units, so a ping reads identically at any
   * zoom — the gesture means "this spot on screen", not "this area on the ground".
   */
  private static _pingGraphics(p: PeerPing, now: number): Graphic[] {
    const t = Math.max(0, Math.min(1, (now - p.at) / PING_MS));
    const geometry = new Point({
      longitude: p.lon,
      latitude: p.lat,
      spatialReference: { wkid: 4326 },
    });
    // Ease-out: the ring leaps outward then settles, which reads as an alert
    // rather than a slow bloom.
    const eased = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;
    const out: Graphic[] = [
      new Graphic({
        geometry,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          size: PING_MIN_PX + (PING_MAX_PX - PING_MIN_PX) * eased,
          color: [0, 0, 0, 0],
          outline: { color: CollabPresence._rgba(p.color, 0.9 * fade), width: 2 },
        } as any,
      }),
      new Graphic({
        geometry,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          size: 7,
          color: CollabPresence._rgba(p.color, 0.95 * fade),
          outline: { color: [0, 0, 0, 0.6 * fade], width: 1 },
        } as any,
      }),
    ];
    // The name is dropped before the marker is, so the label does not linger as
    // an unreadable ghost over the map.
    if (t < 0.75) {
      out.push(
        new Graphic({
          geometry,
          symbol: {
            type: 'text',
            text: p.name,
            color: CollabPresence._rgba(p.color, fade),
            haloColor: [0, 0, 0, 0.75 * fade],
            haloSize: 1.2,
            font: { size: 10, weight: 'bold' },
            yoffset: -16,
          } as any,
        }),
      );
    }
    return out;
  }

  /** A peer's extent as a dashed rectangle, named at its top-left corner. */
  private static _viewportGraphics(v: PeerViewport): Graphic[] {
    const { xmin, ymin, xmax, ymax } = v.box;
    if (!(xmax > xmin) || !(ymax > ymin)) return [];
    return [
      new Graphic({
        geometry: new Polygon({
          rings: [
            [
              [xmin, ymin],
              [xmin, ymax],
              [xmax, ymax],
              [xmax, ymin],
              [xmin, ymin],
            ],
          ],
          spatialReference: { wkid: 4326 },
        }),
        symbol: {
          type: 'simple-fill',
          color: [0, 0, 0, 0], // outline only — a fill would obscure the map
          outline: { color: CollabPresence._rgba(v.color, 0.6), width: 1.5, style: 'dash' },
        } as any,
      }),
      new Graphic({
        geometry: new Point({ longitude: xmin, latitude: ymax, spatialReference: { wkid: 4326 } }),
        symbol: {
          type: 'text',
          text: v.name,
          color: CollabPresence._rgba(v.color, 0.95),
          haloColor: [0, 0, 0, 0.7],
          haloSize: 1,
          font: { size: 9 },
          horizontalAlignment: 'left',
          verticalAlignment: 'bottom',
          xoffset: 3,
          yoffset: 3,
        } as any,
      }),
    ];
  }

  /**
   * Our own extent in WGS84, or null in a projection we cannot convert. Public
   * because MapSync broadcasts it — the conversion lives here so there is one
   * copy of it.
   */
  public myViewport(): ViewportPayload | null {
    const raw: any = (this._view as any)?.extent;
    if (!raw) return null;
    let e: any = raw;
    if (e.spatialReference?.isWebMercator) {
      try {
        e = webMercatorUtils.webMercatorToGeographic(e);
      } catch {
        return null;
      }
    }
    const box = { xmin: e?.xmin, ymin: e?.ymin, xmax: e?.xmax, ymax: e?.ymax };
    if (!Object.values(box).every((n) => Number.isFinite(n))) return null;
    return box as ViewportPayload;
  }

  /**
   * True when a peer is looking at substantially the same place as us, in which
   * case their rectangle would just trace our own viewport border and tell us
   * nothing. Compares scale in octaves so the test is zoom-independent.
   */
  private _viewportMatchesMine(box: ViewportPayload): boolean {
    const mine = this.myViewport();
    if (!mine) return false;
    const mw = mine.xmax - mine.xmin;
    const mh = mine.ymax - mine.ymin;
    const bw = box.xmax - box.xmin;
    const bh = box.ymax - box.ymin;
    if (!(mw > 0) || !(mh > 0) || !(bw > 0) || !(bh > 0)) return false;
    if (Math.abs(Math.log2(bw / mw)) > 0.3 || Math.abs(Math.log2(bh / mh)) > 0.3) return false;
    const dx = Math.abs((box.xmin + box.xmax) / 2 - (mine.xmin + mine.xmax) / 2);
    const dy = Math.abs((box.ymin + box.ymax) / 2 - (mine.ymin + mine.ymax) / 2);
    return dx < mw * 0.2 && dy < mh * 0.2;
  }

  /**
   * Where a padlock sits, cached for ANCHOR_TTL_MS.
   *
   * `_findGraphic` scans every symbol layer, so resolving it per lock per repaint
   * was O(locks × graphics) at the repaint rate — the expensive half of the old
   * treadmill on a large plan.
   */
  private _anchorOfLock(l: RemoteLock): Point | null {
    const now = Date.now();
    const hit = this._anchors.get(l.id);
    if (hit && now - hit.at < ANCHOR_TTL_MS) return hit.pt;
    const pt = CollabPresence._anchorOf(this._findGraphic?.(l.id));
    this._anchors.set(l.id, { pt, at: now });
    return pt;
  }

  /** Centre of a graphic, whatever its geometry type. */
  private static _anchorOf(g: Graphic | null | undefined): Point | null {
    const geom: any = g?.geometry;
    if (!geom) return null;
    if (geom.type === 'point') return geom as Point;
    const ext = geom.extent;
    return ext?.center ?? null;
  }

  private _toScreen(lon: number, lat: number): { x: number; y: number } | null {
    const view = this._view;
    if (!view) return null;
    let pt: Point | null = new Point({
      longitude: lon,
      latitude: lat,
      spatialReference: { wkid: 4326 },
    });
    const sr: any = view.spatialReference;
    // toScreen does not project for us — hand it a point in the view's SR.
    if (sr?.isWebMercator) {
      pt = webMercatorUtils.geographicToWebMercator(pt) as Point;
    } else if (sr && !sr.isWGS84) {
      return null; // exotic projection — skip rather than mis-place the cursor
    }
    if (!pt) return null;
    try {
      const s = view.toScreen(pt);
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
      // Off-screen (or behind the camera in 3D) — hide instead of clamping.
      if (s.x < -40 || s.y < -40 || s.x > view.width + 40 || s.y > view.height + 40) return null;
      return { x: s.x, y: s.y };
    } catch {
      return null;
    }
  }

  // ── DOM plumbing ──────────────────────────────────────────────────────────

  private _mountRoot(): void {
    const container = this._view?.container as HTMLElement | undefined;
    if (!container) return;
    const root = document.createElement('div');
    root.className = 'ms-collab-layer';
    container.appendChild(root);
    this._root = root;
  }

  private _teardownRoot(): void {
    this._root?.remove();
    this._root = null;
    this._cursors.forEach((c) => (c.el = undefined));
  }

  private static _buildCursorEl(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'ms-collab-cursor';
    el.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
      '<path d="M1 1 L1 12 L4.2 8.9 L6.4 14 L8.6 13 L6.4 8 L11 8 Z"/>' +
      '</svg><span class="ms-collab-chip"></span>';
    return el;
  }

  /** '#rrggbb' → [r,g,b,a] for ArcGIS symbol colours. */
  private static _rgba(hex: string, a: number): [number, number, number, number] {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return [255, 255, 255, a];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), a];
  }

  private static _injectStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.ms-collab-layer{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.ms-collab-cursor{position:absolute;top:0;left:0;will-change:transform;pointer-events:none;
  --ms-collab-color:#7ae2ff}
.ms-collab-cursor svg{position:absolute;top:0;left:0;overflow:visible}
.ms-collab-cursor svg path{fill:var(--ms-collab-color);stroke:rgba(0,0,0,.65);stroke-width:1.1;
  paint-order:stroke fill}
.ms-collab-cursor .ms-collab-chip{position:absolute;left:14px;top:12px;white-space:nowrap;
  font:600 10px/1.5 var(--ms-menu-font,system-ui);letter-spacing:.02em;color:#0b0e12;
  background:var(--ms-collab-color);border-radius:3px;padding:1px 5px;
  box-shadow:0 1px 3px rgba(0,0,0,.5)}
.ms-collab-cursor.ms-collab-drawing svg path{animation:ms-collab-pulse 1s ease-in-out infinite}
@keyframes ms-collab-pulse{0%,100%{opacity:1}50%{opacity:.45}}
/**
 * Toast. Themed through ThemeManager's custom properties like every other panel;
 * it previously hardcoded a dark palette and carried a 3px accent stripe down its
 * left edge, which read as decoration rather than as the warning it is. The
 * warning now lives in the text colour, where it means something.
 */
.ms-collab-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:10000;
  font:500 var(--ms-fs-xs,11.5px)/1.6 var(--ms-menu-font,system-ui);color:var(--ms-text,#f2f5f8);
  background:var(--ms-bg,rgba(18,22,28,.94));border:1px solid var(--ms-border,rgba(255,255,255,.16));
  border-radius:calc(var(--ms-radius,9px) - 3px);padding:6px 13px;
  box-shadow:var(--ms-shadow,0 6px 20px rgba(0,0,0,.45));backdrop-filter:blur(14px);
  pointer-events:none}
`;
    document.head.appendChild(style);
  }

  private static _toastEl: HTMLDivElement | null = null;
  private static _toastTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Small self-contained toast — the engine owns no shared UI utility.
   *
   * One reused element: every toast is positioned identically, so appending a
   * fresh one per message stacked them directly on top of each other and left
   * two refused selections in quick succession illegible.
   */
  public static toast(message: string): void {
    CollabPresence._injectStyle();
    let el = CollabPresence._toastEl;
    if (!el || !el.isConnected) {
      el = document.createElement('div');
      el.className = 'ms-collab-toast';
      // Every toast here reports something that just happened to the user's own
      // action — a refused selection, a podium handover. Announced politely so it
      // is not silently visual-only, and 'status' rather than 'alert' so it waits
      // its turn instead of cutting across whatever is being read.
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
      CollabPresence._toastEl = el;
    }
    el.textContent = message;
    if (CollabPresence._toastTimer) clearTimeout(CollabPresence._toastTimer);
    CollabPresence._toastTimer = setTimeout(() => {
      CollabPresence._toastEl?.remove();
      CollabPresence._toastEl = null;
      CollabPresence._toastTimer = null;
    }, 2600);
  }
}
