import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import Amplifier from '../Support/Amplifier';
import DrawEssentials from '../Support/DrawEssentials';
import Shapes from '../Support/Shapes.ts';
import SymbolEvents from '../Support/SymbolEvents';

export interface FortifiedAreaOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polygon | number[][][];
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * Draws a fortified area as one closed polygon with outward rectangular teeth.
 */
export class FortifiedArea {
  public declaredClass = 'MilitarySymbology.Symbols.FortifiedArea';
  public SID = '151000';
  public symName = 'Fortified Area';
  public symGeometricType = 'Area';

  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;
  private amplifier: Amplifier;
  private events: SymbolEvents;

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _drawType = 1;
  private tempGraphic: Graphic | null = null;
  private isDrawing = false;

  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, 'FortifiedArea');

    this.layerManager.initializeLayers();
    this.tempGraphic = new Graphic();
  }

  public init(options: FortifiedAreaOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();
    this._drawType = options.DRAW_TYPE || 1;

    if (options.CTRL_PTS && options.GEOM) {
      const geometry =
        options.GEOM instanceof Polygon
          ? options.GEOM.clone()
          : new Polygon({
              rings: options.GEOM,
              spatialReference: this.view.spatialReference,
            });
      this.__drawEnd(
        geometry,
        this.createDrawEssentials(options.CTRL_PTS.slice(), this._drawType),
      );
      this._clear();
    } else if (options.CTRL_PTS) {
      const drawEssentials = this.createDrawEssentials(
        options.CTRL_PTS.slice(),
        this._drawType,
      );
      const geometry = this.createSymbol(drawEssentials);
      if (geometry) {
        this.__drawEnd(geometry, drawEssentials);
      }
      this._clear();
    } else {
      this.startInteractiveDrawing();
    }
  }

  private startInteractiveDrawing(): void {
    if (!this._lineSym) return;

    this.isDrawing = true;
    this.tempGraphic = new Graphic({
      geometry: null,
      symbol: this._lineSym,
    });
    this.symbolLayer.add(this.tempGraphic);
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.clickHandler = this.view.on('click', (event) =>
      this._onClickHandler(event),
    );
    this.doubleClickHandler = this.view.on('double-click', (event) =>
      this._onDoubleClickHandler(event),
    );
  }

  private _onClickHandler(clickEvent: any): void {
    const point = this.toPoint(clickEvent);
    if (!point) return;

    this._points.push(point);
    if (this._points.length === 1) {
      this.mouseMoveHandler = this.view.on('pointer-move', (event) =>
        this._onMouseMoveHandler(event),
      );
    }

    this.events.emit('onDrawClick', { currentPts: this._points });

    if (this.isLine && this._points.length === 1) {
      this.cleanUp();
    } else if (this._drawType === 3 && this._points.length === 2) {
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(clickEvent: any): void {
    const point = this.toPoint(clickEvent);
    if (!point) return;

    this._points.push(point);
    this.cleanUp();
  }

  private _onMouseMoveHandler(inputEvent: any): void {
    if (!this.isDrawing || !this.tempGraphic) return;

    const candidatePoint = this.toPoint(inputEvent);
    if (!candidatePoint) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.concat([candidatePoint]),
      this._drawType,
    );
    const geometry = this.createSymbol(drawEssentials);
    if (!geometry) return;

    this.tempGraphic.geometry = geometry;
    this.events.emit('onDrawProgress', {
      currentGeometry: geometry,
      currentDrawEssentials: drawEssentials,
      currentMarker: this._lineSym,
    });
  }

  private toPoint(event: any): Point | null {
    const mapPoint = this.view.toMap(event);
    if (!mapPoint) return null;

    return new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });
  }

  private createDrawEssentials(
    ctrlPts: Point[],
    drawType: number,
  ): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).DRAW_TYPE = drawType;
    return drawEssentials;
  }

  private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
    try {
      const pts = (drawEssentials as any).CTRL_PTS as Point[] | undefined;
      if (!pts || pts.length < 2) return null;

      const firstPoint = pts[0];
      const lastPoint = pts[pts.length - 1];
      const drawType = (drawEssentials as any).DRAW_TYPE || 1;
      let boundary: Polygon | Polyline;

      switch (drawType) {
        case 1:
          boundary = Shapes.createSymbolByBCurve(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        case 2:
          boundary = Shapes.createSymbolByPolygon(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        case 3:
          boundary = Shapes.createSymbolByRect(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        default:
          boundary = Shapes.createSymbolByPolygon(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
      }

      return this.createFortifiedBoundary(boundary);
    } catch (error) {
      console.error(
        this.symName,
        'Cannot create symbol due to invalid geometry',
        error,
      );
      return null;
    }
  }

  /**
   * Converts the base boundary into one crenellated polygon ring.
   */
  private createFortifiedBoundary(boundary: Polygon | Polyline): Polygon {
    const source =
      boundary.type === 'polygon'
        ? (boundary as Polygon).rings[0]
        : (boundary as Polyline).paths[0];
    const ring = this.normalizeRing(source || []);
    const result = new Polygon({
      spatialReference: this.view.spatialReference,
    });

    if (ring.length < 3) {
      if (ring.length > 0) result.addRing(this.closeRing(ring));
      return result;
    }

    const segmentLengths: number[] = [];
    const cumulativeLengths: number[] = [0];
    let perimeter = 0;

    for (let i = 0; i < ring.length; i++) {
      const next = (i + 1) % ring.length;
      const length = Math.hypot(
        ring[next][0] - ring[i][0],
        ring[next][1] - ring[i][1],
      );
      segmentLengths.push(length);
      perimeter += length;
      cumulativeLengths.push(perimeter);
    }

    const xs = ring.map((point) => point[0]);
    const ys = ring.map((point) => point[1]);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    const shortSide = Math.min(width, height);

    if (perimeter === 0 || shortSide === 0) {
      result.addRing(this.closeRing(ring));
      return result;
    }

    const center = {
      x: xs.reduce((sum, value) => sum + value, 0) / xs.length,
      y: ys.reduce((sum, value) => sum + value, 0) / ys.length,
    };
    const toothCount = Math.max(
      8,
      Math.min(28, Math.round(perimeter / (shortSide * 0.3))),
    );
    const toothPeriod = perimeter / toothCount;
    const toothDepth = Math.min(shortSide * 0.12, toothPeriod * 0.55);
    const fortifiedRing: number[][] = [];

    for (let i = 0; i < toothCount; i++) {
      const startDistance = i * toothPeriod;
      const toothStartDistance = startDistance + toothPeriod * 0.24;
      const toothEndDistance = startDistance + toothPeriod * 0.76;
      const endDistance = (i + 1) * toothPeriod;
      const start = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        startDistance,
      );
      const toothStart = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        toothStartDistance,
      );
      const toothEnd = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        toothEndDistance,
      );
      const end = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        endDistance,
      );
      const normal = this.outwardNormal(toothStart, toothEnd, center);

      this.pushUnique(fortifiedRing, start);
      this.pushUnique(fortifiedRing, toothStart);
      this.pushUnique(fortifiedRing, [
        toothStart[0] + normal.x * toothDepth,
        toothStart[1] + normal.y * toothDepth,
      ]);
      this.pushUnique(fortifiedRing, [
        toothEnd[0] + normal.x * toothDepth,
        toothEnd[1] + normal.y * toothDepth,
      ]);
      this.pushUnique(fortifiedRing, toothEnd);
      this.pushUnique(fortifiedRing, end);
    }

    result.addRing(this.closeRing(fortifiedRing));
    return result;
  }

  private normalizeRing(source: number[][]): number[][] {
    const ring: number[][] = [];
    for (const point of source) {
      if (point && point.length >= 2) {
        this.pushUnique(ring, [point[0], point[1]]);
      }
    }

    if (ring.length > 1 && this.samePoint(ring[0], ring[ring.length - 1])) {
      ring.pop();
    }
    return ring;
  }

  private pointAtDistance(
    ring: number[][],
    segmentLengths: number[],
    cumulativeLengths: number[],
    distance: number,
  ): number[] {
    const perimeter = cumulativeLengths[cumulativeLengths.length - 1];
    const normalizedDistance =
      distance >= perimeter ? 0 : Math.max(0, distance);
    let segmentIndex = segmentLengths.length - 1;

    for (let i = 0; i < segmentLengths.length; i++) {
      if (normalizedDistance <= cumulativeLengths[i + 1]) {
        segmentIndex = i;
        break;
      }
    }

    const start = ring[segmentIndex];
    const end = ring[(segmentIndex + 1) % ring.length];
    const segmentLength = segmentLengths[segmentIndex];
    const ratio =
      segmentLength === 0
        ? 0
        : (normalizedDistance - cumulativeLengths[segmentIndex]) /
          segmentLength;

    return [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ];
  }

  private outwardNormal(
    start: number[],
    end: number[],
    center: { x: number; y: number },
  ): { x: number; y: number } {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return { x: 0, y: 0 };

    let x = -dy / length;
    let y = dx / length;
    const midX = (start[0] + end[0]) / 2;
    const midY = (start[1] + end[1]) / 2;

    if ((midX - center.x) * x + (midY - center.y) * y < 0) {
      x = -x;
      y = -y;
    }
    return { x, y };
  }

  private closeRing(ring: number[][]): number[][] {
    if (ring.length > 0 && !this.samePoint(ring[0], ring[ring.length - 1])) {
      ring.push([ring[0][0], ring[0][1]]);
    }
    return ring;
  }

  private pushUnique(points: number[][], point: number[]): void {
    if (
      points.length === 0 ||
      !this.samePoint(points[points.length - 1], point)
    ) {
      points.push(point);
    }
  }

  private samePoint(first: number[], second: number[]): boolean {
    return first[0] === second[0] && first[1] === second[1];
  }

  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.slice(),
      this._drawType,
    );
    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.__drawEnd(geometry, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

  private __drawEnd(
    drawGeometry: Polygon,
    drawEssentials: DrawEssentials,
  ): void {
    const spatialReference = this.view.spatialReference;
    const geographicGeometry =
      spatialReference?.wkid === 4326 ? drawGeometry.clone() : drawGeometry;

    this.events.emit('onDrawEnd', {
      geometry: drawGeometry,
      geographicGeometry,
      drawEssentials,
      marker: this._lineSym,
    });
  }

  private _clear(): void {
    if (this.tempGraphic) {
      this.symbolLayer.remove(this.tempGraphic);
    }
    this.tempGraphic = null;
    this._points = [];
    this.isDrawing = false;
  }

  private _removeEvents(): void {
    if (this.clickHandler) {
      this.clickHandler.remove();
      this.clickHandler = null;
    }
    if (this.doubleClickHandler) {
      this.doubleClickHandler.remove();
      this.doubleClickHandler = null;
    }
    if (this.mouseMoveHandler) {
      this.mouseMoveHandler.remove();
      this.mouseMoveHandler = null;
    }
  }

  public deactivate(): void {
    this._clear();
    this._removeEvents();
  }

  public on(eventName: string, callback: (data: any) => void): void {
    this.events.on(eventName, callback);
  }

  public off(eventName: string, callback?: (data: any) => void): void {
    this.events.off(eventName, callback);
  }

  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default FortifiedArea;
