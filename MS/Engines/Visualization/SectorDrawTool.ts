import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import Graphic from "@arcgis/core/Graphic";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import * as geometryEngine from "@arcgis/core/geometry/geometryEngine";
import { GeoTools } from "../../Support/GeoTools";
import type VisualizationEngine from "./VisualizationEngine";

type Phase = "idle" | "range" | "sweep";

/**
 * Interactive threat-sector draw: center -> drag to set range + start edge (click)
 * -> sweep to set end edge (click). Escape / right-click cancels. The sweep is
 * accumulated from pointer motion so the user can draw a narrow or reflex wedge
 * and cross North cleanly; the result is mapped onto VisualizationEngine.showSector's
 * clockwise (azStart->azEnd) convention.
 */
export default class SectorDrawTool {
  private _phase: Phase = "idle";
  private _center: Point | null = null;
  private _rangeKm = 0;
  private _azStart = 0;
  private _sweep = 0;          // signed accumulated degrees; + = clockwise
  private _lastAz = 0;
  private _handles: Array<{ remove(): void }> = [];
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private _getView: () => MapView | SceneView | null,
    private _viz: VisualizationEngine,
  ) {}

  begin(center?: Point | Graphic): void {
    const view = this._getView();
    if (!view) return;
    this.cancel();
    if (center) {
      const pt = ("geometry" in center ? center.geometry : center) as Point | null;
      if (pt && pt.type === "point") { this._center = pt; }
    }
    this._phase = "range"; // center set on first click if not seeded

    this._handles.push(view.on("pointer-move", (e: any) => this._onMove(e)));
    this._handles.push(view.on("click", (e: any) => this._onClick(e)));
    this._handles.push(view.on("pointer-down", (e: any) => { if (e.button === 2) { e.stopPropagation(); this.cancel(); } }));
    this._keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") this.cancel(); };
    document.addEventListener("keydown", this._keyHandler);
  }

  cancel(): void {
    this._phase = "idle";
    this._center = null;
    this._rangeKm = 0;
    this._sweep = 0;
    this._handles.forEach(h => h.remove());
    this._handles = [];
    if (this._keyHandler) { document.removeEventListener("keydown", this._keyHandler); this._keyHandler = null; }
    this._viz.clearSectorPreview();
  }

  onViewChanged(_view: MapView | SceneView): void { this.cancel(); }

  private _mapPt(e: any): Point | null {
    const view = this._getView();
    if (!view) return null;
    const p = view.toMap({ x: e.x, y: e.y });
    return p && p.type === "point" ? (p as Point) : null;
  }

  private _rangeKmTo(pt: Point): number {
    if (!this._center) return 0;
    const line = new Polyline({
      paths: [[[this._center.longitude as number, this._center.latitude as number],
               [pt.longitude as number, pt.latitude as number]]],
      spatialReference: { wkid: 4326 },
    });
    return geometryEngine.geodesicLength(line, "kilometers");
  }

  private _onMove(e: any): void {
    const pt = this._mapPt(e);
    if (!pt || !this._center) return;
    if (this._phase === "range") {
      this._rangeKm = this._rangeKmTo(pt);
      const az = GeoTools.bearing(this._center, pt);
      this._viz.renderSectorPreview(this._center, this._rangeKm, az, az + 1);
    } else if (this._phase === "sweep") {
      const az = GeoTools.bearing(this._center, pt);
      const d = ((az - this._lastAz + 540) % 360) - 180; // shortest signed step
      this._sweep += d;
      this._lastAz = az;
      const { start, end } = this._clockwise(this._azStart, this._sweep);
      this._viz.renderSectorPreview(this._center, this._rangeKm, start, end);
    }
  }

  private _onClick(e: any): void {
    const pt = this._mapPt(e);
    if (!pt) return;
    if (this._phase === "range") {
      if (!this._center) { this._center = pt; return; } // first click sets center if not seeded
      this._rangeKm = this._rangeKmTo(pt);
      this._azStart = GeoTools.bearing(this._center, pt);
      this._lastAz = this._azStart;
      this._sweep = 0;
      this._phase = "sweep";
    } else if (this._phase === "sweep") {
      if (!this._center) return;
      const { start, end } = this._clockwise(this._azStart, this._sweep);
      this._viz.clearSectorPreview();
      this._viz.showSector(this._center, { rangeKm: this._rangeKm, azStartDeg: start, azEndDeg: end });
      this.cancel();
    }
  }

  /** Map a signed sweep about azStart onto a clockwise (start->end) pair. */
  private _clockwise(azStart: number, sweep: number): { start: number; end: number } {
    const norm = (a: number) => ((a % 360) + 360) % 360;
    if (sweep >= 0) return { start: norm(azStart), end: norm(azStart + sweep) };
    return { start: norm(azStart + sweep), end: norm(azStart) };
  }
}
