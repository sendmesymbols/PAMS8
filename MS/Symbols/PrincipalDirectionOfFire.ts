import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import Amplifier from '../Support/Amplifier';
import DrawEssentials from '../Support/DrawEssentials';
import SymbolEvents from '../Support/SymbolEvents';

export interface PrincipalDirectionOfFireOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Draws two independently placed arrows from a common origin.
 */
export class PrincipalDirectionOfFire {
  private view: MapView | SceneView;
  private symbolLayer: GraphicsLayer;
  private amplifier: Amplifier;
  private events: SymbolEvents;

  public declaredClass = 'MilitarySymbology.Symbols.PrincipalDirectionOfFire';
  public SID = '140500';
  public symName = 'Principal Direction of Fire';
  public symGeometricType = 'Line';

  private _lineSym: SimpleLineSymbol | SimpleFillSymbol | null = null;
  private _points: Point[] = [];
  private tempGraphic: Graphic | null = null;
  private clickHandler: any = null;
  private mouseMoveHandler: any = null;

  constructor(view: MapView | SceneView, _isLine: boolean = false) {
    this.view = view;
    const layerManager = GraphicsLayerManager.getInstance(view);
    this.symbolLayer = layerManager.getOrCreateLayer(LAYER_NAMES.TACT);
    this.amplifier = new Amplifier();
    this.events = new SymbolEvents(view, 'PrincipalDirectionOfFire');
    layerManager.initializeLayers();
  }

  public init(
    options: PrincipalDirectionOfFireOptions,
    marker: SimpleLineSymbol | SimpleFillSymbol,
  ): void {
    this._lineSym = marker.clone();

    if (options.CTRL_PTS && options.GEOM) {
      const geometry =
        options.GEOM instanceof Polyline
          ? options.GEOM
          : new Polyline({
              paths: options.GEOM as any,
              spatialReference: this.view.spatialReference,
            });
      this.__drawEnd(
        geometry,
        this.createDrawEssentials(options.CTRL_PTS.slice()),
      );
      return;
    }

    if (options.CTRL_PTS) {
      const points = options.CTRL_PTS.slice();
      const geometry = this.createSymbol(points);
      if (geometry) {
        this.__drawEnd(geometry, this.createDrawEssentials(points));
      }
      return;
    }

    this.startInteractiveDrawing();
  }

  private startInteractiveDrawing(): void {
    if (!this._lineSym) return;

    this.tempGraphic = new Graphic({
      geometry: null,
      symbol: this._lineSym,
    });
    this.symbolLayer.add(this.tempGraphic);

    this.clickHandler = this.view.on('click', (event) => {
      this._onClickHandler(event);
    });
    this.mouseMoveHandler = this.view.on('pointer-move', (event) => {
      this._onMouseMoveHandler(event);
    });
  }

  private _onClickHandler(clickEvent: any): void {
    const point = this.toPoint(clickEvent);
    if (!point) return;

    this._points.push(point);
    this.events.emit('onDrawClick', { currentPts: this._points });

    if (this._points.length === 3) {
      const geometry = this.createSymbol(this._points);
      if (geometry) {
        this.__drawEnd(
          geometry,
          this.createDrawEssentials(this._points.slice()),
        );
      }
      this._clear();
      this._removeEvents();
    }
  }

  private _onMouseMoveHandler(inputEvent: any): void {
    if (
      this._points.length === 0 ||
      this._points.length >= 3 ||
      !this.tempGraphic
    )
      return;

    const candidatePoint = this.toPoint(inputEvent);
    if (!candidatePoint) return;

    const points = this._points.concat(candidatePoint);
    const geometry = this.createSymbol(points);
    if (!geometry) return;

    const drawEssentials = this.createDrawEssentials(points);
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

  private createSymbol(points: Point[]): Polyline | null {
    if (points.length < 2) return null;

    const origin = points[0];
    const firstTip = points[1];
    const secondTip = points[2];
    const firstArmDx = firstTip.x - origin.x;
    const firstArmDy = firstTip.y - origin.y;
    const firstArmLength = Math.hypot(firstArmDx, firstArmDy);
    if (firstArmLength === 0) return null;

    const firstArmAngle = Math.atan2(firstArmDy, firstArmDx);
    const innerLineStartRatio = 0.1;
    const innerLineEndRatio = 0.82;
    const innerLineOffset = firstArmLength * 0.035;
    const firstPerpendicular = {
      x: -Math.sin(firstArmAngle),
      y: Math.cos(firstArmAngle),
    };
    const firstMidPoint = {
      x: (origin.x + firstTip.x) / 2,
      y: (origin.y + firstTip.y) / 2,
    };
    const towardInterior =
      !secondTip ||
      (secondTip.x - firstMidPoint.x) * firstPerpendicular.x +
        (secondTip.y - firstMidPoint.y) * firstPerpendicular.y >=
        0
        ? 1
        : -1;
    const innerOffsetX =
      firstPerpendicular.x * innerLineOffset * towardInterior;
    const innerOffsetY =
      firstPerpendicular.y * innerLineOffset * towardInterior;
    const innerLineStart = [
      origin.x + firstArmDx * innerLineStartRatio + innerOffsetX,
      origin.y + firstArmDy * innerLineStartRatio + innerOffsetY,
    ];
    const innerLineEnd = [
      origin.x + firstArmDx * innerLineEndRatio + innerOffsetX,
      origin.y + firstArmDy * innerLineEndRatio + innerOffsetY,
    ];
    const middleLineStart = [
      origin.x + firstArmDx * innerLineStartRatio + innerOffsetX / 2,
      origin.y + firstArmDy * innerLineStartRatio + innerOffsetY / 2,
    ];
    const middleLineEnd = [
      origin.x + firstArmDx * innerLineEndRatio + innerOffsetX / 2,
      origin.y + firstArmDy * innerLineEndRatio + innerOffsetY / 2,
    ];

    const result = new Polyline({
      spatialReference: this.view.spatialReference,
    });
    result.addPath([
      [origin.x, origin.y],
      [firstTip.x, firstTip.y],
    ]);
    result.addPath([middleLineStart, middleLineEnd]);
    result.addPath([innerLineStart, innerLineEnd]);
    result.addPath(
      this.createArrowHead(origin, firstTip, firstArmLength * 0.15),
    );

    if (secondTip) {
      const secondArmLength = Math.hypot(
        secondTip.x - origin.x,
        secondTip.y - origin.y,
      );
      if (secondArmLength > 0) {
        result.addPath([
          [origin.x, origin.y],
          [secondTip.x, secondTip.y],
        ]);
        result.addPath(
          this.createArrowHead(origin, secondTip, secondArmLength * 0.15),
        );
      }
    }

    return result;
  }

  private createArrowHead(
    shaftStart: Point,
    tip: Point,
    length: number,
  ): number[][] {
    const angle = Math.atan2(tip.y - shaftStart.y, tip.x - shaftStart.x);
    const spread = Math.PI / 6;

    return [
      [
        tip.x - length * Math.cos(angle - spread),
        tip.y - length * Math.sin(angle - spread),
      ],
      [tip.x, tip.y],
      [
        tip.x - length * Math.cos(angle + spread),
        tip.y - length * Math.sin(angle + spread),
      ],
    ];
  }

  private createDrawEssentials(ctrlPts: Point[]): DrawEssentials {
    const drawEssentials = new DrawEssentials();
    drawEssentials.SYM_GEO_TYPE = this.symGeometricType;
    drawEssentials.SID = this.SID;
    drawEssentials.SYM_NAME = this.symName;
    drawEssentials.GEOM = null;
    drawEssentials.AMPLIFIER = this.amplifier.toString();
    (drawEssentials as any).SCOPE = this;
    (drawEssentials as any).CTRL_PTS = ctrlPts;
    return drawEssentials;
  }

  private __drawEnd(geometry: Polyline, drawEssentials: DrawEssentials): void {
    const geographicGeometry =
      this.view.spatialReference?.wkid === 4326 ? geometry.clone() : geometry;

    this.events.emit('onDrawEnd', {
      geometry,
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
  }

  private _removeEvents(): void {
    this.clickHandler?.remove();
    this.mouseMoveHandler?.remove();
    this.clickHandler = null;
    this.mouseMoveHandler = null;
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

export default PrincipalDirectionOfFire;
