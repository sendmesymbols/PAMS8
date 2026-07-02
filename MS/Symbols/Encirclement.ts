import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import DrawEssentials from '../Support/DrawEssentials';
import Amplifier from '../Support/Amplifier';
import Shapes from '../Support/Shapes.ts';
import DrawSeam from '../Support/DrawSeam';

import SymbolEvents from '../Support/SymbolEvents';
export interface EncirclementOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polygon | number[][][];
  DRAW_TYPE?: number;

  [key: string]: any;
}

/**
 * Encirclement area with outward triangular teeth.
 * Supports multiple drawing types: Bezier curve (1), Polygon (2), Rectangle (3)
 */
export class Encirclement {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  // Symbol properties
  public declaredClass = 'MilitarySymbology.Symbols.Encirclement';
  private SID: string = '151801';
  private symName: string = 'Encirclement';
  private symGeometricType: string = 'Area';
  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _drawType: number = 1;
  private amplifier: Amplifier;

  // Drawing state
  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;

  // Event handlers
  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;

  // Event emitter
  private events: SymbolEvents;

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, 'Encirclement');

    // Initialize layers if not already done
    this.layerManager.initializeLayers();

    // Initialize temporary graphic
    this.tempGraphic = new Graphic();
  }

  /**
   * Initialize the area of operations drawing
   */
  public init(options: EncirclementOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();
    this._drawType = options.DRAW_TYPE || 1;

    if (
      options.hasOwnProperty('CTRL_PTS') &&
      options.hasOwnProperty('GEOM') &&
      options.GEOM !== null
    ) {
      // Immediate placement with both control points and geometry
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry =
            options.GEOM instanceof Polygon
              ? options.GEOM.clone()
              : new Polygon({
                  rings: options.GEOM,
                  spatialReference: this.view.spatialReference,
                });
        } catch (error) {
          console.error(
            this.symName,
            'Failed to create Polygon geometry:',
            error,
          );
        }
      }

      const drawEss = this.createDrawEssentials(
        options.CTRL_PTS!.slice(),
        options.DRAW_TYPE || 1,
      );
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEss);
      }
      this._clear();
    } else if (options.hasOwnProperty('CTRL_PTS')) {
      // Immediate placement with control points only
      const drawEss = this.createDrawEssentials(
        options.CTRL_PTS!.slice(),
        options.DRAW_TYPE || 1,
      );
      const geometry = this.createSymbol(drawEss);
      if (geometry && this.tempGraphic) {
        this.tempGraphic.geometry = geometry;
        this.__drawEnd(geometry, drawEss);
        this._clear();
      }
    } else {
      // Interactive drawing mode
      this.startInteractiveDrawing();
    }
  }

  /**
   * Start interactive drawing mode
   */
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

  /**
   * Set up mouse event handlers for interactive drawing
   */
  private setupEventHandlers(): void {
    // Click handler
    this.clickHandler = this.view.on('click', (event) => {
      this._onClickHandler(event);
    });

    // Double click handler
    this.doubleClickHandler = this.view.on('double-click', (event) => {
      this._onDoubleClickHandler(event);
    });
  }

  /**
   * Handle click events
   */
  private _onClickHandler(clickEvent: any): void {
    const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });

    this._points.push(point);

    if (this._points.length === 1) {
      // First click - set up mouse move handler
      this.mouseMoveHandler = this.view.on('pointer-move', (event) => {
        this._onMouseMoveHandler(event);
      });
    }

    this.events.emit('onDrawClick', { currentPts: this._points });

    // For single line mode, finish after first click
    if (this.isLine === true && this._points.length === 1) {
      this.events.emit('onDrawClick', { currentPts: this._points });
      this.cleanUp();
    }

    // For rectangle draw type, finish after 2 points
    if (this._drawType === 3 && this._points.length === 2) {
      this.events.emit('onDrawClick', { currentPts: this._points });
      this.cleanUp();
    }
  }

  /**
   * Handle double click events
   */
  private _onDoubleClickHandler(clickEvent: any): void {
    const mapPoint = DrawSeam.resolvePoint(this.view, clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });

    this._points.push(point);
    this.cleanUp();
  }

  /**
   * Handle mouse move events
   */
  private _onMouseMoveHandler(inputEvent: any): void {
    if (!this.isDrawing || !this.tempGraphic) return;

    const mapPoint = DrawSeam.resolvePoint(this.view, inputEvent);
    if (!mapPoint) return;

    const candidatePoint = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });

    const drawEssentials = new DrawEssentials();
    (drawEssentials as any).CTRL_PTS = this._points.concat([candidatePoint]);
    (drawEssentials as any).DRAW_TYPE = this._drawType;

    const geometry = this.createSymbol(drawEssentials);
    if (geometry) {
      this.tempGraphic.geometry = geometry;
      this.events.emit('onDrawProgress', {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym,
      });
    }
  }

  /**
   * Create DrawEssentials object
   */
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

    // Store additional properties
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).DRAW_TYPE = drawType;

    return drawEssentials;
  }

  /**
   * Create symbol geometry from DrawEssentials
   */
  private createSymbol(drawEssentials: DrawEssentials): Polygon | null {
    try {
      let pts: Point[];

      if ((drawEssentials as any).CTRL_PTS) {
        pts = (drawEssentials as any).CTRL_PTS;
      } else {
        throw new Error('controlPoints not found');
      }

      const lastPoint = pts[pts.length - 1];
      const firstPoint = pts[0];
      const drawType = (drawEssentials as any).DRAW_TYPE || 1;

      let result: Polygon | Polyline | null = null;

      switch (drawType) {
        case 1:
          result = Shapes.createSymbolByBCurve(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        case 2:
          result = Shapes.createSymbolByPolygon(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        case 3:
          result = Shapes.createSymbolByRect(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
          break;
        default:
          result = Shapes.createSymbolByPolygon(
            pts,
            firstPoint,
            lastPoint,
            drawEssentials,
            this.view.spatialReference,
          );
      }

      if (!result) {
        return null;
      }

      const polygon =
        result.type === 'polyline'
          ? new Polygon({
              rings: (result as Polyline).paths,
              spatialReference: this.view.spatialReference,
            })
          : (result as Polygon);

      return this.addTriangularTeeth(polygon);
    } catch (e) {
      /* invalid geometry mid-draw is expected; ignore */
      return null;
    }
  }

  /**
   * Adds ten outward triangles while preserving the main closed area ring.
   */
  private addTriangularTeeth(result: Polygon): Polygon {
    const sourceRing = result.rings[0] || [];
    const ring = this.normalizeRing(sourceRing);
    if (ring.length < 3) return result;

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

    const extent = result.extent;
    if (!extent || perimeter === 0) return result;

    const center = extent.center;
    const toothCount = 10;
    const toothPeriod = perimeter / toothCount;
    const toothDepth = Math.min(
      Math.min(extent.width, extent.height) * 0.28,
      toothPeriod * 0.72,
    );

    for (let i = 0; i < toothCount; i++) {
      const centerDistance = i * toothPeriod;
      const start = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        centerDistance - toothPeriod * 0.22,
      );
      const baseMid = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        centerDistance,
      );
      const end = this.pointAtDistance(
        ring,
        segmentLengths,
        cumulativeLengths,
        centerDistance + toothPeriod * 0.22,
      );
      const normal = this.outwardNormal(baseMid, center);
      const apex = [
        baseMid[0] + normal.x * toothDepth,
        baseMid[1] + normal.y * toothDepth,
      ];

      result.addRing([start, apex, end, start]);
    }

    return result;
  }

  private normalizeRing(source: number[][]): number[][] {
    const ring = source
      .filter((point) => point && point.length >= 2)
      .map((point) => [point[0], point[1]]);

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
    const normalizedDistance = ((distance % perimeter) + perimeter) % perimeter;
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
    point: number[],
    center: Point,
  ): { x: number; y: number } {
    const dx = point[0] - center.x;
    const dy = point[1] - center.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? { x: 0, y: 0 } : { x: dx / length, y: dy / length };
  }

  private samePoint(first: number[], second: number[]): boolean {
    return first[0] === second[0] && first[1] === second[1];
  }

  /**
   * Clean up drawing state and finalize
   */
  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.slice(),
      this._drawType,
    );

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polygon, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

  /**
   * Handle draw end
   */
  private __drawEnd(
    drawGeometry: Polygon,
    drawEssentials: DrawEssentials,
  ): void {
    if (drawGeometry) {
      const spatialRef = this.view.spatialReference;
      let geographicGeometry = drawGeometry;

      if (spatialRef && spatialRef.isWebMercator) {
        // Geographic conversion would go here if needed
      } else if (spatialRef && spatialRef.wkid === 4326) {
        geographicGeometry = drawGeometry.clone();
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  /**
   * Final draw end handler
   */
  private __onDrawEnd(
    geometry: Polygon,
    geoGeometry: Polygon,
    drawEssParam: DrawEssentials,
  ): void {
    this.events.emit('onDrawEnd', {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym,
    });
  }

  /**
   * Clear graphics and state
   */
  private _clear(): void {
    if (this.tempGraphic && this.symbolLayer) {
      this.symbolLayer.remove(this.tempGraphic);
    }

    this.tempGraphic = null;
    this._points = [];
  }

  /**
   * Remove event handlers
   */
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

  /**
   * Deactivate the drawing tool
   */
  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this.isDrawing = false;
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

export default Encirclement;
