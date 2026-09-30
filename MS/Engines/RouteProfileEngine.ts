import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Polygon from "@arcgis/core/geometry/Polygon";
import Extent from "@arcgis/core/geometry/Extent";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import { ElevationUtils } from "../Support/Elevation/ElevationUtils";
import EngineLogger from "../Support/EngineLogger";

interface ProfileSample {
  /** Cumulative geodesic distance from the route start, metres. */
  distM: number;
  /** Terrain elevation at this sample, metres. */
  elevM: number;
  /** Slope of the segment ending at this sample, percent (signed). */
  slopePct: number;
  /** Map location of this sample (used to mirror chart hover onto the map). */
  x: number;
  y: number;
}

interface ProfileStats {
  lengthM: number;
  minElev: number;
  maxElev: number;
  gain: number;        // total ascent (m)
  loss: number;        // total descent (m)
  maxSlopePct: number; // max absolute slope (%)
}

interface ProfileResult {
  samples: ProfileSample[];
  stats: ProfileStats;
}

/**
 * Measured-route elevation profile. Samples terrain elevation along a polyline
 * route (the active map's ground / DEM) and renders a distance-vs-elevation
 * cross-section in a floating panel, highlighting steep (obstacle) segments.
 * Works wherever an ArcGIS elevation sampler is available (3D SceneView always;
 * 2D MapView when the map has a ground elevation layer).
 */
export default class RouteProfileEngine {
  private static readonly MAX_SAMPLES = 200;
  private static readonly MIN_STEP_M = 5;
  /** Segments at or above this absolute slope are flagged as obstacles. */
  private static readonly STEEP_PCT = 25;
  private static readonly PANEL_ID = "routeProfilePanel";

  /** Map-side marker mirroring the chart hover position. */
  private _hoverMarker: Graphic | null = null;
  private _hoverView: MapView | SceneView | null = null;

  constructor(private _getView: () => MapView | SceneView | null) {}

  /** Build + show the elevation profile for a polyline graphic or geometry. */
  public async showProfile(input: Graphic | Polyline | Polygon): Promise<void> {
    const view = this._getView();
    if (!view) return;

    const raw = (input instanceof Graphic ? input.geometry : input) as Polyline | Polygon | null;
    let geom: Polyline | null = null;
    if (raw?.type === "polyline") {
      geom = raw;
    } else if (raw?.type === "polygon" && raw.rings?.length) {
      // Profile the outer boundary (first ring, already closed) as a route.
      geom = new Polyline({ paths: [raw.rings[0]], spatialReference: raw.spatialReference });
    }
    if (!geom) {
      EngineLogger.nextStep("Route Profile", "Select a route (polyline) or area (polygon) to profile its elevation.");
      return;
    }

    const lengthM = geometryEngine.geodesicLength(geom, "meters");
    if (!(lengthM > 0)) {
      EngineLogger.nextStep("Route Profile", "Route has zero length — nothing to profile.");
      return;
    }

    let result: ProfileResult;
    try {
      result = await this._buildProfile(view, geom, lengthM);
    } catch (err) {
      EngineLogger.nextStep(
        "Route Profile",
        "No terrain elevation source is available on the active view.",
      );
      return;
    }
    if (result.samples.length < 2) {
      EngineLogger.nextStep("Route Profile", "Not enough elevation samples along the route.");
      return;
    }

    this._render(result, view, geom.spatialReference);
    EngineLogger.success(
      "Route Profile",
      `Profiled ${(lengthM / 1000).toFixed(2)} km — +${Math.round(result.stats.gain)} / ` +
        `-${Math.round(result.stats.loss)} m, max slope ${result.stats.maxSlopePct.toFixed(0)}%`,
    );
  }

  /** Remove the profile panel. */
  public clearProfile(): void {
    this._clearHoverMarker();
    document.getElementById(RouteProfileEngine.PANEL_ID)?.remove();
  }

  // ─── Profile computation ────────────────────────────────────────────────

  private async _buildProfile(
    view: MapView | SceneView,
    line: Polyline,
    lengthM: number,
  ): Promise<ProfileResult> {
    const step = Math.max(lengthM / RouteProfileEngine.MAX_SAMPLES, RouteProfileEngine.MIN_STEP_M);
    const dense = (geometryEngine.geodesicDensify(line, step, "meters") as Polyline) ?? line;

    // Flatten path vertices into an ordered Point list (drop duplicate path joins).
    const pts: Point[] = [];
    for (let p = 0; p < dense.paths.length; p++) {
      const path = dense.paths[p];
      for (let v = 0; v < path.length; v++) {
        if (p > 0 && v === 0) continue; // join vertex already added as prev path's last
        const gp = dense.getPoint(p, v);
        if (gp) pts.push(gp);
      }
    }
    if (pts.length < 2) return { samples: [], stats: this._emptyStats(lengthM) };

    const ext = (line.extent ?? dense.extent)?.clone().expand(1.1) as Extent;
    const sampler = await ElevationUtils.createSampler(view, ext, { noDataValue: NaN });

    const samples: ProfileSample[] = [];
    let cumDist = 0;
    let prev: Point | null = null;
    let prevZ = 0;
    let minElev = Infinity, maxElev = -Infinity, gain = 0, loss = 0, maxSlope = 0;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      let z = ElevationUtils.queryPointElevation(sampler, pt);
      if (Number.isNaN(z)) z = prev ? prevZ : 0; // hold last good value over DEM gaps

      let slopePct = 0;
      if (prev) {
        this._scratch.paths = [[
          [prev.longitude as number, prev.latitude as number],
          [pt.longitude as number, pt.latitude as number],
        ]];
        const segM = geometryEngine.geodesicLength(this._scratch, "meters");
        cumDist += segM;
        const dz = z - prevZ;
        if (dz > 0) gain += dz; else loss += -dz;
        if (segM > 0.001) {
          slopePct = (dz / segM) * 100;
          if (Math.abs(slopePct) > maxSlope) maxSlope = Math.abs(slopePct);
        }
      }

      if (z < minElev) minElev = z;
      if (z > maxElev) maxElev = z;
      samples.push({ distM: cumDist, elevM: z, slopePct, x: pt.x, y: pt.y });

      prev = pt;
      prevZ = z;
    }

    return {
      samples,
      stats: { lengthM: cumDist || lengthM, minElev, maxElev, gain, loss, maxSlopePct: maxSlope },
    };
  }

  private readonly _scratch = new Polyline({ paths: [[[0, 0], [0, 0]]], spatialReference: { wkid: 4326 } });

  private _emptyStats(lengthM: number): ProfileStats {
    return { lengthM, minElev: 0, maxElev: 0, gain: 0, loss: 0, maxSlopePct: 0 };
  }

  // ─── Rendering (self-contained SVG panel) ────────────────────────────────

  private _clearHoverMarker(): void {
    if (this._hoverMarker) this._hoverView?.graphics.remove(this._hoverMarker);
    this._hoverMarker = null;
    this._hoverView = null;
  }

  private _showHoverMarker(view: MapView | SceneView, x: number, y: number, sr: any): void {
    const geometry = new Point({ x, y, spatialReference: sr });
    if (this._hoverMarker && this._hoverView === view) {
      this._hoverMarker.geometry = geometry;
      return;
    }
    this._clearHoverMarker();
    this._hoverMarker = new Graphic({
      geometry,
      symbol: new SimpleMarkerSymbol({
        style: "circle",
        size: 12,
        color: [255, 200, 0, 0.95],
        outline: { color: [14, 22, 32, 1], width: 2 },
      }),
    });
    this._hoverView = view;
    view.graphics.add(this._hoverMarker);
  }

  private _render(result: ProfileResult, view: MapView | SceneView, sr: any): void {
    this._clearHoverMarker();
    const { samples, stats } = result;
    const W = 520, H = 200, PAD_L = 48, PAD_R = 12, PAD_T = 14, PAD_B = 26;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const maxDist = stats.lengthM || samples[samples.length - 1].distM || 1;
    const eMin = stats.minElev;
    const eMax = stats.maxElev;
    const eSpan = Math.max(eMax - eMin, 1);

    const x = (d: number) => PAD_L + (d / maxDist) * plotW;
    const y = (e: number) => PAD_T + plotH - ((e - eMin) / eSpan) * plotH;

    // Elevation line + filled area.
    const linePts = samples.map(s => `${x(s.distM).toFixed(1)},${y(s.elevM).toFixed(1)}`);
    const areaPath =
      `M ${x(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)} ` +
      `L ${linePts.join(" L ")} ` +
      `L ${x(maxDist).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;
    const linePath = `M ${linePts.join(" L ")}`;

    // Steep (obstacle) segments as red overlays.
    const steep: string[] = [];
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i].slopePct) >= RouteProfileEngine.STEEP_PCT) {
        const a = samples[i - 1], b = samples[i];
        steep.push(
          `<line x1="${x(a.distM).toFixed(1)}" y1="${y(a.elevM).toFixed(1)}" ` +
            `x2="${x(b.distM).toFixed(1)}" y2="${y(b.elevM).toFixed(1)}" ` +
            `style="stroke:var(--ms-danger, #ff4d4d)" stroke-width="3" />`,
        );
      }
    }

    const yTicks = [eMin, eMin + eSpan / 2, eMax]
      .map(e => `<text x="${PAD_L - 6}" y="${(y(e) + 3).toFixed(1)}" text-anchor="end" ` +
        `style="fill:color-mix(in srgb, var(--ms-text, #cdd9e5) 65%, transparent)" font-size="10">${Math.round(e)}</text>` +
        `<line x1="${PAD_L}" y1="${y(e).toFixed(1)}" x2="${W - PAD_R}" y2="${y(e).toFixed(1)}" ` +
        `style="stroke:var(--ms-divider, #2a3a4a)" stroke-width="0.5" />`)
      .join("");
    const xTicks = [0, maxDist / 2, maxDist]
      .map(d => `<text x="${x(d).toFixed(1)}" y="${H - 8}" text-anchor="middle" ` +
        `style="fill:color-mix(in srgb, var(--ms-text, #cdd9e5) 65%, transparent)" font-size="10">${(d / 1000).toFixed(2)}</text>`)
      .join("");

    const svg =
      `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">` +
      `<defs><linearGradient id="rpFill" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" style="stop-color:var(--ms-accent, #3da9fc)" stop-opacity="0.45"/>` +
      `<stop offset="100%" style="stop-color:var(--ms-accent, #3da9fc)" stop-opacity="0.05"/></linearGradient></defs>` +
      yTicks +
      `<path d="${areaPath}" fill="url(#rpFill)" stroke="none" />` +
      `<path d="${linePath}" fill="none" style="stroke:var(--ms-accent, #3da9fc)" stroke-width="1.5" />` +
      steep.join("") +
      xTicks +
      `<text x="${PAD_L}" y="${PAD_T - 3}" style="fill:color-mix(in srgb, var(--ms-text, #cdd9e5) 45%, transparent)" font-size="9">elev (m)</text>` +
      `<text x="${W - PAD_R}" y="${H - 8}" text-anchor="end" style="fill:color-mix(in srgb, var(--ms-text, #cdd9e5) 45%, transparent)" font-size="9">dist (km)</text>` +
      `<g id="rpHover" style="display:none;pointer-events:none">` +
      `<line id="rpHoverLine" x1="0" x2="0" y1="${PAD_T}" y2="${PAD_T + plotH}" stroke="#ffc800" stroke-width="1" stroke-dasharray="3 3"/>` +
      `<circle id="rpHoverDot" r="4" fill="#ffc800" style="stroke:var(--ms-bg, #0e1620)" stroke-width="1.5"/>` +
      `<text id="rpHoverText" y="${PAD_T + 8}" style="fill:var(--ms-text, #ffe08a)" font-size="10"></text></g>` +
      `<rect id="rpHit" x="${PAD_L}" y="${PAD_T}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair"/>` +
      `</svg>`;

    const header =
      `<div style="display:flex;justify-content:space-between;align-items:center;` +
      `padding:6px 10px;border-bottom:1px solid var(--ms-divider, #243240)">` +
      `<span style="font-weight:600;color:var(--ms-text, #e6eef5)">Route Elevation Profile</span>` +
      `<span id="rpClose" style="cursor:pointer;color:color-mix(in srgb, var(--ms-text, #cdd9e5) 65%, transparent);font-size:14px;padding:0 4px">✕</span>` +
      `</div>`;

    const statsRow =
      `<div style="display:flex;gap:14px;padding:6px 10px;color:var(--ms-text, #cdd9e5);font-size:11px;` +
      `border-top:1px solid var(--ms-divider, #243240)">` +
      `<span>Length <b>${(stats.lengthM / 1000).toFixed(2)} km</b></span>` +
      `<span style="color:var(--ms-success, #5fd068)">▲ ${Math.round(stats.gain)} m</span>` +
      `<span style="color:var(--ms-danger, #ff8c8c)">▼ ${Math.round(stats.loss)} m</span>` +
      `<span>Range <b>${Math.round(stats.minElev)}–${Math.round(stats.maxElev)} m</b></span>` +
      `<span>Max slope <b style="color:${stats.maxSlopePct >= RouteProfileEngine.STEEP_PCT ? "var(--ms-danger, #ff6b6b)" : "var(--ms-text, #cdd9e5)"}">` +
      `${stats.maxSlopePct.toFixed(0)}%</b></span>` +
      `</div>`;

    let panel = document.getElementById(RouteProfileEngine.PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = RouteProfileEngine.PANEL_ID;
      panel.style.cssText =
        "position:fixed;right:16px;bottom:16px;z-index:9999;width:520px;" +
        "background:var(--ms-bg, #0e1620);border:1px solid var(--ms-border, #243240);border-radius:8px;" +
        "box-shadow:0 8px 28px rgba(0,0,0,0.5);font-family:var(--ms-font, system-ui, sans-serif);" +
        "color:var(--ms-text, #e6eef5);overflow:hidden";
      document.body.appendChild(panel);
    }
    panel.innerHTML = header + svg + statsRow;
    panel.querySelector<HTMLElement>("#rpClose")?.addEventListener("click", () => this.clearProfile());

    // Chart hover -> crosshair in the panel + moving marker on the map.
    const svgEl = panel.querySelector<SVGSVGElement>("svg");
    const hover = panel.querySelector<SVGGElement>("#rpHover");
    const hLine = panel.querySelector<SVGLineElement>("#rpHoverLine");
    const hDot = panel.querySelector<SVGCircleElement>("#rpHoverDot");
    const hText = panel.querySelector<SVGTextElement>("#rpHoverText");
    const hit = panel.querySelector<SVGRectElement>("#rpHit");
    if (!svgEl || !hover || !hLine || !hDot || !hText || !hit) return;

    hit.addEventListener("mousemove", (ev: MouseEvent) => {
      const rect = svgEl.getBoundingClientRect();
      const px = ((ev.clientX - rect.left) / rect.width) * W;
      const d = Math.min(Math.max(((px - PAD_L) / plotW) * maxDist, 0), maxDist);

      // Find the segment containing d and interpolate location + elevation.
      let i = 1;
      while (i < samples.length - 1 && samples[i].distM < d) i++;
      const a = samples[i - 1], b = samples[i];
      const span = b.distM - a.distM;
      const t = span > 0 ? Math.min(Math.max((d - a.distM) / span, 0), 1) : 0;
      const elev = a.elevM + (b.elevM - a.elevM) * t;

      hover.style.display = "";
      hLine.setAttribute("x1", String(x(d)));
      hLine.setAttribute("x2", String(x(d)));
      hDot.setAttribute("cx", String(x(d)));
      hDot.setAttribute("cy", String(y(elev)));
      const onRight = x(d) > W / 2;
      hText.setAttribute("x", String(x(d) + (onRight ? -6 : 6)));
      hText.setAttribute("text-anchor", onRight ? "end" : "start");
      hText.textContent = `${(d / 1000).toFixed(2)} km · ${Math.round(elev)} m · ${b.slopePct.toFixed(0)}%`;

      this._showHoverMarker(view, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, sr);
    });
    hit.addEventListener("mouseleave", () => {
      hover.style.display = "none";
      this._clearHoverMarker();
    });
  }
}
