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

export interface SearchReconnaissanceAreaOptions {
  CTRL_PTS?: Point[];
  GEOM?: Polyline;
  [key: string]: any;
}

/**
 * Search / Reconnaissance Area.
 * Two arrows flanking out from a common base point. Each arm has a single clean
 * "jag" (lateral notch, inspired by the Screen stem-kink) and is capped by an open
 * arrowhead. The whole symbol is a single Polyline geometry (V body + 2 arrowheads).
 */
export class SearchReconnaissanceArea {
  private view: MapView | SceneView;
  private symbolLayer: GraphicsLayer;
  private amplifier: Amplifier;
  private events: SymbolEvents;

  public declaredClass = 'MilitarySymbology.Symbols.SearchReconnaissanceArea';
  public SID = '152200';
  public symName = 'Search Reconnaissance Area';
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
    this.events = new SymbolEvents(view, 'SearchReconnaissanceArea');
    layerManager.initializeLayers();
  }

  public init(
    options: SearchReconnaissanceAreaOptions,
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

    const arm1 = this.buildArm(origin, firstTip, secondTip);
    if (!arm1) return null;

    const result = new Polyline({
      spatialReference: this.view.spatialReference,
    });

    if (secondTip) {
      const arm2 = this.buildArm(origin, secondTip, firstTip);
      if (arm2) {
        // Single continuous V body: firstTip down through its jag to the base,
        // then back up through the second arm's jag to secondTip.
        result.addPath([
          [firstTip.x, firstTip.y],
          arm1.jagOuter,
          arm1.jagInner,
          [origin.x, origin.y],
          arm2.jagInner,
          arm2.jagOuter,
          [secondTip.x, secondTip.y],
        ]);
        result.addPath(arm1.arrowHead);
        result.addPath(arm2.arrowHead);
        return result;
      }
    }

    // Single-arm preview (before the second tip is placed).
    result.addPath([
      [origin.x, origin.y],
      arm1.jagInner,
      arm1.jagOuter,
      [firstTip.x, firstTip.y],
    ]);
    result.addPath(arm1.arrowHead);
    return result;
  }

  /**
   * Build one flanking arm: a base->tip line broken by a single lateral jag, with the
   * jag stepping outward (away from the other arm) and an arrowhead at the tip.
   */
  private buildArm(
    origin: Point,
    tip: Point,
    otherTip: Point | undefined,
  ): { jagInner: number[]; jagOuter: number[]; arrowHead: number[][] } | null {
    const dx = tip.x - origin.x;
    const dy = tip.y - origin.y;
    const armLength = Math.hypot(dx, dy);
    if (armLength === 0) return null;

    const ux = dx / armLength;
    const uy = dy / armLength;

    // Perpendicular; flip so the jag points away from the other arm (outward).
    let px = -uy;
    let py = ux;
    if (otherTip) {
      const midX = (origin.x + tip.x) / 2;
      const midY = (origin.y + tip.y) / 2;
      const dotOther = (otherTip.x - midX) * px + (otherTip.y - midY) * py;
      if (dotOther > 0) {
        px = -px;
        py = -py;
      }
    }

    const jagAt = 0.45; // fraction along the arm where the notch sits
    const jagWidth = armLength * 0.09; // lateral step

    const jagInner = [
      origin.x + ux * armLength * jagAt,
      origin.y + uy * armLength * jagAt,
    ];
    const jagOuter = [jagInner[0] + px * jagWidth, jagInner[1] + py * jagWidth];

    const arrowHead = this.createArrowHead(
      jagOuter[0],
      jagOuter[1],
      tip,
      armLength * 0.15,
    );

    return { jagInner, jagOuter, arrowHead };
  }

  private createArrowHead(
    fromX: number,
    fromY: number,
    tip: Point,
    length: number,
  ): number[][] {
    const angle = Math.atan2(tip.y - fromY, tip.x - fromX);
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

export default SearchReconnaissanceArea;
