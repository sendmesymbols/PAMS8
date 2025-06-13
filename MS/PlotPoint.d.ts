import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import MapView from "@arcgis/core/views/MapView";
interface PlotPointOptions {
    symbol?: SimpleMarkerSymbol;
}
declare class PlotPoint {
    private view;
    private symbol;
    constructor(view: MapView, options?: PlotPointOptions);
    plotAtCenter(): void;
    plotAtLocation(latitude: number, longitude: number): void;
    changeSymbol(symbol: SimpleMarkerSymbol): void;
    clearGraphics(): void;
}
export default PlotPoint;
