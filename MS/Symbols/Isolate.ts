import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
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
import BaseLine from '../Support/BaseLine.ts';
import GeoTools from '../Support/GeoTools.ts';
import Shapes from '../Support/Shapes.ts';

export interface ContainOptions {
  CTRL_PTS?: Point[];
  BASE_LN_PTS?: { startPt: Point; endPt: Point };
  GEOM?: Polyline;
  TEETH_SIZE?: number;
  TEETH_GAP?: number;
  [key: string]: any;
}

export class Isolate {
  private view: MapView | SceneView;
  private layerManager: GraphicsLayerManager;
  private symbolLayer: GraphicsLayer;
  private isLine: boolean;

  public declaredClass: string = 'MilitarySymbology.Symbols.Isolate';
  public SID: string = '341500';
  public symName: string = 'Isolate';
  public symGeometricType: string = 'Area';

  private _lineSym: SimpleLineSymbol | null = null;
  private _points: Point[] = [];
  private _baseLinePts: any = {};
  private _geometryType: string | null = null;
  private amplifier: Amplifier;

  private _teethSize: number = 2;
  private _teethGap: number = 5;

  private isDrawing: boolean = false;
  private tempGraphic: Graphic | null = null;
  private baseLineComplete: boolean = false;

  private clickHandler: any = null;
  private doubleClickHandler: any = null;
  private mouseMoveHandler: any = null;
  private baseLineEndHandler: any = null;
  private baseLineProgressHandler: any = null;
  private baseLineClickHandler: any = null;

  private eventListeners: Map<string, Function[]> = new Map();

  constructor(view: MapView | SceneView, isLine: boolean = false) {
    this.view = view;
    this.isLine = isLine;
    this.layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = this.layerManager.getOrCreateLayer(LAYER_NAMES.FORCE);
    this.amplifier = new Amplifier();
    this.layerManager.initializeLayers();
    this.tempGraphic = new Graphic();
  }

  public init(options: ContainOptions, marker: SimpleLineSymbol): void {
    this._lineSym = marker.clone();
    this._teethSize = GeoTools.setDefault(options, 'TEETH_SIZE', 2);
    this._teethGap = GeoTools.setDefault(options, 'TEETH_GAP', 5);

    if (
      options.hasOwnProperty('CTRL_PTS') &&
      options.hasOwnProperty('BASE_LN_PTS') &&
      options.hasOwnProperty('GEOM') &&
      options.GEOM !== null
    ) {
      if (options.GEOM && this.tempGraphic) {
        try {
          this.tempGraphic.geometry =
            options.GEOM instanceof Polyline
              ? options.GEOM
              : new Polyline({
                  paths: options.GEOM as any,
                  spatialReference: this.view.spatialReference,
                });
        } catch (error) {
          console.error(
            this.symName,
            'Failed to create Polyline geometry:',
            error,
          );
        }
      }
      const drawEss = this.createDrawEssentials(
        options.CTRL_PTS!.slice(),
        options.BASE_LN_PTS!,
        this._teethSize,
      );
      if (this.tempGraphic && this.tempGraphic.geometry) {
        this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEss);
      }
      this._clear();
    } else if (options.hasOwnProperty('CTRL_PTS')) {
      if (options.hasOwnProperty('BASE_LN_PTS')) {
        const drawEss = this.createDrawEssentials(
          options.CTRL_PTS!.slice(),
          options.BASE_LN_PTS!,
          this._teethSize,
        );
        const geometry = this.createSymbol(drawEss);
        if (geometry && this.tempGraphic) {
          this.tempGraphic.geometry = geometry;
          this.__drawEnd(geometry, drawEss);
          this._clear();
        }
      } else {
        throw new Error(
          'Control Points and Baseline or Distance is required to create symbol non-interactively',
        );
      }
    } else {
      this.startBaseLineDrawing();
    }
  }

  private startBaseLineDrawing(): void {
    const baseLine = new BaseLine(this.view, this._lineSym!);

    this.baseLineClickHandler = baseLine.on('onBaseLineClick', (evt: any) => {
      this.baseLineClick(evt);
    });

    this.baseLineProgressHandler = baseLine.on(
      'onBaseLineProgress',
      (evt: any) => {
        this.baseLineDrawProgress(evt);
      },
    );

    this.baseLineEndHandler = baseLine.on('drawEnd', (evt: any) => {
      this.baseLineDrawEnd(evt);
    });

    baseLine.init();
  }

  private baseLineClick(evt: any): void {
    this.emit('onDrawClick', {
      currentPts: evt.currentGeometry,
      isBaseLine: true,
    });
  }

  private baseLineDrawProgress(evt: any): void {
    const localDrawEssentials: any = {};
    localDrawEssentials.CTRL_PTS = evt.currentGeometry;
    const pl = new Polyline({ spatialReference: this.view.spatialReference });
    pl.addPath(evt.currentGeometry);
    this.emit('onDrawProgress', {
      currentGeometry: pl,
      currentDrawEssentials: localDrawEssentials,
      currentMarker: evt.currentMarker,
      isBaseLine: true,
    });
  }

  private baseLineDrawEnd(evt: any): void {
    if (this.baseLineEndHandler) {
      this.baseLineEndHandler.remove();
      this.baseLineEndHandler = null;
    }

    this.tempGraphic = new Graphic({
      geometry: evt.geometry,
      symbol: this._lineSym,
    });
    this.symbolLayer.add(this.tempGraphic);

    this._baseLinePts = (evt.geometry as any)._baseLine;
    this.baseLineComplete = true;
    this.setupControlPointHandlers();

    this.emit('onBaseLineDrawEnd', {
      currentPts: (evt.geometry as any).controlPoints,
    });
  }

  private setupControlPointHandlers(): void {
    this.mouseMoveHandler = this.view.on('pointer-move', (event) => {
      this._onMouseMoveHandler(event);
    });
    this.clickHandler = this.view.on('click', (event) => {
      this._onClickHandler(event);
    });
    this.doubleClickHandler = this.view.on('double-click', (event) => {
      this._onDoubleClickHandler(event);
    });
  }

  private _onClickHandler(clickEvent: any): void {
    const mapPoint = this.view.toMap(clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });
    this._points.push(point);
    this.emit('onDrawClick', { currentPts: this._points });

    if (this.isLine === true && this._points.length === 1) {
      this.emit('onDrawClick', { currentPts: this._points });
      this.cleanUp();
    }
  }

  private _onDoubleClickHandler(clickEvent: any): void {
    const mapPoint = this.view.toMap(clickEvent);
    if (!mapPoint) return;

    const point = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });
    this._points.push(point);
    this.cleanUp();
  }

  private _onMouseMoveHandler(inputEvent: any): void {
    if (!this.baseLineComplete || !this.tempGraphic) return;

    const mapPoint = this.view.toMap(inputEvent);
    if (!mapPoint) return;

    const candidatePoint = new Point({
      x: mapPoint.x,
      y: mapPoint.y,
      spatialReference: this.view.spatialReference,
    });
    const drawEssentials = this.createDrawEssentials(
      this._points.concat([candidatePoint]),
      this._baseLinePts,
      this._teethSize,
    );
    const geometry = this.createSymbol(drawEssentials);

    if (geometry) {
      this.tempGraphic.geometry = geometry;
      this.emit('onDrawProgress', {
        currentGeometry: geometry,
        currentDrawEssentials: drawEssentials,
        currentMarker: this._lineSym,
      });
    }
  }

  private createDrawEssentials(
    ctrlPts: Point[],
    baseLinePts: any,
    teethSize: number,
  ): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    (drawEssentials as any).BASE_LN_PTS = baseLinePts;
    (drawEssentials as any).TEETH_SIZE = teethSize;
    return drawEssentials;
  }

  private CreateCircleSegmentFromThreePoints(
    circle: { radius: number; center: { x: number; y: number } },
    pt1: any,
    pt2: any,
    pt3: any,
    numberOfPts: number,
    view: any,
  ): { geometry: Polyline; lastPoint: Point; backPoint: Point } {
    const center = circle.center;
    const radius = circle.radius;
    const path: Point[] = [];

    pt1.x -= center.x;
    pt1.y -= center.y;
    pt2.x -= center.x;
    pt2.y -= center.y;
    pt3.x -= center.x;
    pt3.y -= center.y;

    let anglePt1 = Math.atan2(pt1.y, pt1.x);
    let anglePt2 = Math.atan2(pt2.y, pt2.x);
    let anglePt3 = Math.atan2(pt3.y, pt3.x);

    anglePt1 = anglePt1 < 0 ? 2 * Math.PI + anglePt1 : anglePt1;
    anglePt2 = anglePt2 < 0 ? 2 * Math.PI + anglePt2 : anglePt2;
    anglePt3 = anglePt3 < 0 ? 2 * Math.PI + anglePt3 : anglePt3;

    const startAngle = Math.min(anglePt1, anglePt2);
    const endAngle = Math.max(anglePt1, anglePt2);
    let swipeAngle = endAngle - startAngle;

    if (anglePt3 < startAngle || anglePt3 > endAngle) {
      swipeAngle -= 2 * Math.PI;
    }

    const angle = swipeAngle / numberOfPts;

    for (let i = 0; i <= numberOfPts; i++) {
      const screenPt = {
        x: radius * Math.cos(startAngle + i * angle) + center.x,
        y: radius * Math.sin(startAngle + i * angle) + center.y,
      };
      const mapPt = view.toMap(screenPt);
      path.push(mapPt);
    }

    const result = new Polyline({ spatialReference: view.spatialReference });
    result.addPath(path.map((p) => [p.x, p.y]));

    return {
      geometry: result,
      lastPoint: path[numberOfPts],
      backPoint: path[numberOfPts - 5],
    };
  }

  private createSymbol(drawEssentials: DrawEssentials): Polyline | null {
    try {
      const spatialReference = this.view.spatialReference;
      const pts: Point[] = (drawEssentials as any).CTRL_PTS;
      if (!pts || pts.length === 0) throw new Error('controlPoints not found');

      let startingPt: Point | null =
        (drawEssentials as any).BASE_LN_PTS?.startPt || null;
      let endPt: Point | null =
        (drawEssentials as any).BASE_LN_PTS?.endPt || null;

      if (!startingPt || !endPt) {
        if (pts.length >= 2) {
          startingPt = pts[0];
          endPt = pts[1];
        } else {
          throw new Error(
            'First Parameter of the Function is an Array with Start and End Point',
          );
        }
      }

      const result = new Polyline({ spatialReference });
      const candidatePoint: Point =
        pts.length > 2 ? pts[pts.length - 1] : endPt;

      const stScr = (this.view as any).toScreen(startingPt);
      const endScr = (this.view as any).toScreen(endPt);
      const candScr = (this.view as any).toScreen(candidatePoint);
      if (!stScr || !endScr || !candScr) return null;

      const circle = GeoTools.circleFromThreeScreenPoints(
        stScr,
        endScr,
        candScr,
      );

      if (!circle || circle.radius <= 0) {
        result.addPath([
          [startingPt.x, startingPt.y],
          [endPt.x, endPt.y],
        ]);
        return result;
      }

      const circleSeg = this.CreateCircleSegmentFromThreePoints(
        circle,
        stScr,
        endScr,
        candScr,
        60,
        this.view,
      );
      const paths = circleSeg.geometry.paths?.[0] as number[][];
      if (!paths || paths.length === 0) return null;

      const firstArc = paths.slice(0, 25);
      const secondArc = paths.slice(35, 60);
      if (firstArc.length >= 2) result.addPath(firstArc);
      if (secondArc.length >= 2) result.addPath(secondArc);

      if (paths[30] && paths[25] && paths[35]) {
        const cPoint = new Point({
          x: paths[30][0],
          y: paths[30][1],
          spatialReference,
        });
        const firstPoint = new Point({
          x: paths[25][0],
          y: paths[25][1],
          spatialReference,
        });
        const secondPoint = new Point({
          x: paths[35][0],
          y: paths[35][1],
          spatialReference,
        });
        const baseLineLen = GeoTools._2PtLen(firstPoint, secondPoint);
        let cLenLimit = baseLineLen / 5;
        if (cLenLimit > baseLineLen / 3.6) cLenLimit = baseLineLen / 3.6;
        const iPts: Point[] =
          (Shapes as any).createI(
            cPoint.x,
            cPoint.y,
            cLenLimit,
            spatialReference,
          ) || [];
        if (iPts.length) result.addPath(iPts.map((p) => [p.x, p.y]));
      }

      if (endPt && circleSeg.lastPoint && circleSeg.backPoint) {
        const cPoint = new Point({
          x: paths[30][0],
          y: paths[30][1],
          spatialReference,
        });
        const length = GeoTools._2PtLen(endPt, cPoint) / 10;
        let angle = GeoTools.twoPtsAngle(
          circleSeg.backPoint,
          circleSeg.lastPoint,
        );

        let innerAngle = angle < Math.PI ? angle + 2.35619 : angle - 2.35619;
        const innerWing = [
          endPt.x + length * Math.cos(innerAngle),
          endPt.y + length * Math.sin(innerAngle),
        ];
        result.addPath([innerWing, [endPt.x, endPt.y]]);

        angle = GeoTools.twoPtsAngle(circleSeg.backPoint, circleSeg.lastPoint);
        let outerAngle = angle > Math.PI ? angle + 2.35619 : angle - 2.35619;
        const outerWing = [
          endPt.x + length * Math.cos(outerAngle),
          endPt.y + length * Math.sin(outerAngle),
        ];
        result.addPath([outerWing, [endPt.x, endPt.y]]);
      }

      const ext = result.extent;
      const centerPt = ext?.center;
      if (centerPt) {
        const center = new Point({
          x: centerPt.x,
          y: centerPt.y,
          spatialReference,
        });
        const cPoint = new Point({
          x: paths[30][0],
          y: paths[30][1],
          spatialReference,
        });
        const length = GeoTools._2PtLen(endPt!, cPoint) / 10;
        const teethSize =
          length *
          GeoTools.setDefault(
            drawEssentials as any,
            'TEETH_SIZE',
            this._teethSize,
          );

        const firstPairs = [
          [1, 7],
          [9, 15],
          [17, 23],
        ];
        for (const [a, b] of firstPairs) {
          if (firstArc[a] && firstArc[b]) {
            const s = new Point({
              x: firstArc[a][0],
              y: firstArc[a][1],
              spatialReference,
            });
            const e = new Point({
              x: firstArc[b][0],
              y: firstArc[b][1],
              spatialReference,
            });
            result.addPath(this.createTeeth3(s, e, center, teethSize));
          }
        }

        const secondPairs = [
          [1, 7],
          [9, 15],
          [17, 23],
        ];
        for (const [a, b] of secondPairs) {
          if (secondArc[a] && secondArc[b]) {
            const s = new Point({
              x: secondArc[a][0],
              y: secondArc[a][1],
              spatialReference,
            });
            const e = new Point({
              x: secondArc[b][0],
              y: secondArc[b][1],
              spatialReference,
            });
            result.addPath(this.createTeeth3(s, e, center, teethSize));
          }
        }
      }

      return result;
    } catch (e) {
      console.log(
        this.constructor.name + ' Cannot create Symbol due to invalid geometry',
      );
      return null;
    }
  }

  private createTeeth3(
    startPt: Point,
    endPt: Point,
    centerPt: Point,
    teethSize: number,
  ): number[][] {
    const mid = GeoTools.getMidPoint(startPt, endPt);
    const angle = GeoTools.twoPtsAngle(centerPt, mid);
    const midTowardCenter: [number, number] = [
      -1 * teethSize * Math.cos(angle) + mid.x,
      -1 * teethSize * Math.sin(angle) + mid.y,
    ];
    return [[startPt.x, startPt.y], midTowardCenter, [endPt.x, endPt.y]];
  }

  public getBaseLinePts(): any {
    return this._baseLinePts;
  }

  private cleanUp(): void {
    if (this._points.length === 0) return;

    const drawEssentials = this.createDrawEssentials(
      this._points.slice(),
      this._baseLinePts,
      this._teethSize,
    );

    if (this.tempGraphic && this.tempGraphic.geometry) {
      this.__drawEnd(this.tempGraphic.geometry as Polyline, drawEssentials);
    }

    this._clear();
    this._removeEvents();
  }

  private __drawEnd(
    drawGeometry: Polyline,
    drawEssentials: DrawEssentials,
  ): void {
    if (drawGeometry) {
      const spatialRef = this.view.spatialReference;
      let geographicGeometry = drawGeometry;

      if (spatialRef && spatialRef.isWebMercator) {
        // Geographic conversion
      } else if (spatialRef && spatialRef.wkid === 4326) {
        geographicGeometry = drawGeometry.clone();
      }

      this.__onDrawEnd(drawGeometry, geographicGeometry, drawEssentials);
    }
  }

  private __onDrawEnd(
    geometry: Polyline,
    geoGeometry: Polyline,
    drawEssParam: DrawEssentials,
  ): void {
    this.emit('onDrawEnd', {
      geometry: geometry,
      geographicGeometry: geoGeometry,
      drawEssentials: drawEssParam,
      marker: this._lineSym,
    });
  }

  private _clear(): void {
    if (this.tempGraphic && this.symbolLayer) {
      this.symbolLayer.remove(this.tempGraphic);
    }
    this.tempGraphic = null;
    this._points = [];
    this._baseLinePts = {};
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
    if (this.baseLineEndHandler) {
      this.baseLineEndHandler.remove();
      this.baseLineEndHandler = null;
    }
    if (this.baseLineProgressHandler) {
      this.baseLineProgressHandler.remove();
      this.baseLineProgressHandler = null;
    }
    if (this.baseLineClickHandler) {
      this.baseLineClickHandler.remove();
      this.baseLineClickHandler = null;
    }
  }

  public deactivate(): void {
    this._clear();
    this._removeEvents();
    this._geometryType = null;
    this.isDrawing = false;
    this.baseLineComplete = false;
  }

  private emit(eventName: string, data: any): void {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach((listener) => listener(data));
    }
    this.emitGlobalEvent(eventName, data);
  }

  private emitGlobalEvent(eventName: string, data: any): void {
    const customEvent = new CustomEvent(eventName, {
      detail: {
        symbolType: this.constructor.name,
        eventName: eventName,
        ...data,
      },
      bubbles: true,
      cancelable: true,
    });

    if (this.view && this.view.container) {
      this.view.container.dispatchEvent(customEvent);
    } else {
      document.dispatchEvent(customEvent);
    }
  }

  public on(eventName: string, callback: Function): void {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);
  }

  public off(eventName: string, callback?: Function): void {
    if (!callback) {
      this.eventListeners.delete(eventName);
    } else {
      const listeners = this.eventListeners.get(eventName);
      if (listeners) {
        const index = listeners.indexOf(callback);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    }
  }

  public getSymbolLayer(): GraphicsLayer {
    return this.symbolLayer;
  }

  public clearSymbols(): void {
    this.symbolLayer.removeAll();
  }
}

export default Isolate;
