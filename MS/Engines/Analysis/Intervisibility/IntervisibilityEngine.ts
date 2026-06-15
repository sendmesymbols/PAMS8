import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Extent from "@arcgis/core/geometry/Extent";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import TextSymbol from "@arcgis/core/symbols/TextSymbol";
import Color from "@arcgis/core/Color";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import { ElevationUtils } from "../../../Support/Elevation/ElevationUtils";
import { castTerrainRay } from "../los-engine";
import EngineLogger from "../../../Support/EngineLogger";

interface OPNode {
  label: string;
  lon: number;
  lat: number;
  groundZ: number;
}

export interface IntervisibilityResult {
  labels: string[];
  /** visible[i][j] = node i can see node j (directional). */
  visible: boolean[][];
  /** Count of mutual links per node (both directions visible). */
  connectivity: number[];
}

/**
 * Intervisibility matrix / mutual-LOS network. Given a set of points (OPs /
 * selected symbols) it computes the N×N "who sees whom" terrain line-of-sight
 * table, draws the mutual-visibility network on the map (green = mutual,
 * amber-dashed = one-way), and renders the matrix + per-OP connectivity in a
 * panel so a well-connected OP set can be picked. Reuses the LOS engine's
 * castTerrainRay and the shared ElevationUtils sampler.
 */
export default class IntervisibilityEngine {
  private static readonly MAX_NODES = 14;
  private static readonly LAYER_ID = "intervisibility-network";
  private static readonly PANEL_ID = "intervisibilityPanel";

  private _layer: GraphicsLayer | null = null;

  constructor(private _getView: () => MapView | SceneView | null) {}

  /** Compute + visualise the intervisibility matrix for the given points. */
  public async analyze(
    inputs: Array<Graphic | Point>,
    opts?: { observerHeightM?: number },
  ): Promise<IntervisibilityResult | null> {
    const view = this._getView();
    if (!view) return null;

    let nodes = this._resolveNodes(inputs);
    if (nodes.length < 2) {
      EngineLogger.nextStep("Intervisibility", "Select at least 2 point symbols / OPs to compare.");
      return null;
    }
    if (nodes.length > IntervisibilityEngine.MAX_NODES) {
      const dropped = nodes.length - IntervisibilityEngine.MAX_NODES;
      EngineLogger.nextStep(
        "Intervisibility",
        `Capped at ${IntervisibilityEngine.MAX_NODES} OPs — ${dropped} dropped (reduce the selection for full coverage).`,
      );
      nodes = nodes.slice(0, IntervisibilityEngine.MAX_NODES);
    }

    const h = opts?.observerHeightM ?? 2;

    let sampler;
    try {
      const ext = this._extentOf(nodes);
      sampler = await ElevationUtils.createSampler(view, ext, { noDataValue: NaN });
    } catch {
      EngineLogger.nextStep("Intervisibility", "No terrain elevation source on the active view.");
      return null;
    }

    // Ground elevation per node (eye height added per ray).
    for (const n of nodes) {
      const z = ElevationUtils.queryPointElevation(sampler, new Point({ longitude: n.lon, latitude: n.lat, spatialReference: { wkid: 4326 } }));
      n.groundZ = Number.isNaN(z) ? 0 : z;
    }

    const N = nodes.length;
    const visible: boolean[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => false));

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const observer = { longitude: nodes[i].lon, latitude: nodes[i].lat };
        const target = { lon: nodes[j].lon, lat: nodes[j].lat, z: nodes[j].groundZ + h };
        const r = castTerrainRay(sampler, observer, target, { stepDistM: 30, observerHeightM: h });
        visible[i][j] = !!r?.visible;
      }
    }

    const connectivity = nodes.map((_n, i) => {
      let c = 0;
      for (let j = 0; j < N; j++) if (i !== j && visible[i][j] && visible[j][i]) c++;
      return c;
    });

    const result: IntervisibilityResult = {
      labels: nodes.map(n => n.label),
      visible,
      connectivity,
    };

    this._drawNetwork(view, nodes, visible);
    this._renderPanel(result);

    const links = connectivity.reduce((a, b) => a + b, 0) / 2;
    EngineLogger.success(
      "Intervisibility",
      `${N} OPs — ${links} mutual link${links !== 1 ? "s" : ""}; best connected: ${result.labels[this._argmax(connectivity)]}`,
    );
    return result;
  }

  /** Remove the network overlay and matrix panel. */
  public clear(): void {
    this._layer?.removeAll();
    document.getElementById(IntervisibilityEngine.PANEL_ID)?.remove();
  }

  public onViewChanged(_view: MapView | SceneView): void {
    if (this._layer) {
      const map = this._getView()?.map as any;
      if (map && this._layer) map.remove(this._layer);
      this._layer = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private _resolveNodes(inputs: Array<Graphic | Point>): OPNode[] {
    const nodes: OPNode[] = [];
    inputs.forEach((input, idx) => {
      const geom = (input instanceof Graphic ? input.geometry : input) as Point | null;
      if (!geom || geom.type !== "point") return;
      const lon = geom.longitude as number;
      const lat = geom.latitude as number;
      if (lon == null || lat == null || Number.isNaN(lon) || Number.isNaN(lat)) return;
      const desig =
        input instanceof Graphic
          ? (input.attributes?.amplifier?.UNIQUE_DESIG ?? input.attributes?.UNIQUE_DESIG)
          : undefined;
      nodes.push({ label: desig ? String(desig) : `OP${idx + 1}`, lon, lat, groundZ: 0 });
    });
    return nodes;
  }

  private _extentOf(nodes: OPNode[]): Extent {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    nodes.forEach(n => {
      if (n.lon < xmin) xmin = n.lon;
      if (n.lon > xmax) xmax = n.lon;
      if (n.lat < ymin) ymin = n.lat;
      if (n.lat > ymax) ymax = n.lat;
    });
    const padX = Math.max((xmax - xmin) * 0.15, 0.01);
    const padY = Math.max((ymax - ymin) * 0.15, 0.01);
    return new Extent({
      xmin: xmin - padX, ymin: ymin - padY, xmax: xmax + padX, ymax: ymax + padY,
      spatialReference: { wkid: 4326 },
    });
  }

  private _argmax(arr: number[]): number {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
    return best;
  }

  private _ensureLayer(view: MapView | SceneView): GraphicsLayer {
    if (!this._layer) {
      this._layer = new GraphicsLayer({ id: IntervisibilityEngine.LAYER_ID, listMode: "hide" });
      (view.map as any).add(this._layer);
    }
    return this._layer;
  }

  private _drawNetwork(view: MapView | SceneView, nodes: OPNode[], visible: boolean[][]): void {
    const layer = this._ensureLayer(view);
    layer.removeAll();
    const N = nodes.length;

    const mutualSym = new SimpleLineSymbol({ color: new Color([80, 220, 120, 0.9]), width: 2, style: "solid" });
    const onewaySym = new SimpleLineSymbol({ color: new Color([255, 180, 40, 0.7]), width: 1.25, style: "dash" });

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const both = visible[i][j] && visible[j][i];
        const either = visible[i][j] || visible[j][i];
        if (!either) continue;
        const line = new Polyline({
          paths: [[[nodes[i].lon, nodes[i].lat], [nodes[j].lon, nodes[j].lat]]],
          spatialReference: { wkid: 4326 },
        });
        layer.add(new Graphic({ geometry: line, symbol: both ? mutualSym : onewaySym }));
      }
    }

    // Node markers + labels on top.
    nodes.forEach(n => {
      const pt = new Point({ longitude: n.lon, latitude: n.lat, spatialReference: { wkid: 4326 } });
      layer.add(new Graphic({
        geometry: pt,
        symbol: new SimpleMarkerSymbol({
          style: "circle",
          color: new Color([20, 30, 45, 0.9]),
          size: 11,
          outline: { color: [255, 255, 255, 0.95], width: 1.5 },
        }),
      }));
      layer.add(new Graphic({
        geometry: pt,
        symbol: new TextSymbol({
          text: n.label,
          color: new Color([255, 255, 255, 1]),
          haloColor: new Color([0, 0, 0, 0.85]),
          haloSize: 1.5,
          font: { size: 10, weight: "bold" },
          yoffset: 12,
        }),
      }));
    });
  }

  private _renderPanel(result: IntervisibilityResult): void {
    const { labels, visible, connectivity } = result;
    const best = this._argmax(connectivity);

    const head =
      `<tr><th style="padding:3px 6px;color:#6e8398;font-weight:600">sees →</th>` +
      labels.map((l, j) =>
        `<th style="padding:3px 6px;color:${j === best ? "#5fd068" : "#9fb3c8"};font-size:11px">${this._esc(l)}</th>`,
      ).join("") +
      `<th style="padding:3px 6px;color:#9fb3c8;font-size:11px;border-left:1px solid #243240">links</th></tr>`;

    const rows = labels.map((rl, i) => {
      const cells = labels.map((_cl, j) => {
        if (i === j) return `<td style="text-align:center;color:#3a4a5a">–</td>`;
        const v = visible[i][j];
        const mutual = v && visible[j][i];
        const glyph = v ? (mutual ? "●" : "◐") : "·";
        const color = v ? (mutual ? "#5fd068" : "#ffb428") : "#46586a";
        return `<td style="text-align:center;color:${color};font-size:13px" title="${this._esc(rl)} → ${this._esc(labels[j])}: ${v ? "visible" : "blocked"}">${glyph}</td>`;
      }).join("");
      return `<tr><th style="padding:3px 6px;text-align:right;color:${i === best ? "#5fd068" : "#cdd9e5"};font-size:11px">${this._esc(rl)}</th>` +
        cells +
        `<td style="text-align:center;font-weight:700;color:${i === best ? "#5fd068" : "#cdd9e5"};border-left:1px solid #243240">${connectivity[i]}</td></tr>`;
    }).join("");

    const header =
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid #243240">` +
      `<span style="font-weight:600;color:#e6eef5">Intervisibility Matrix</span>` +
      `<span id="ivClose" style="cursor:pointer;color:#9fb3c8;font-size:14px;padding:0 4px">✕</span></div>`;

    const legend =
      `<div style="padding:5px 10px;color:#9fb3c8;font-size:10px;border-top:1px solid #243240">` +
      `<span style="color:#5fd068">●</span> mutual&nbsp;&nbsp;` +
      `<span style="color:#ffb428">◐</span> one-way&nbsp;&nbsp;` +
      `<span style="color:#46586a">·</span> blocked&nbsp;&nbsp;•&nbsp; best connected: ` +
      `<b style="color:#5fd068">${this._esc(labels[best])}</b> (${connectivity[best]})</div>`;

    let panel = document.getElementById(IntervisibilityEngine.PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = IntervisibilityEngine.PANEL_ID;
      panel.style.cssText =
        "position:fixed;left:16px;bottom:16px;z-index:9999;max-width:80vw;overflow:auto;" +
        "background:#0e1620;border:1px solid #243240;border-radius:8px;" +
        "box-shadow:0 8px 28px rgba(0,0,0,0.5);font-family:system-ui,Segoe UI,sans-serif;color:#e6eef5";
      document.body.appendChild(panel);
    }
    panel.innerHTML =
      header +
      `<table style="border-collapse:collapse;margin:8px 10px">${head}${rows}</table>` +
      legend;
    panel.querySelector<HTMLElement>("#ivClose")?.addEventListener("click", () => this.clear());
  }

  private _esc(s: string): string {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  }
}
