import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import MapView from "@arcgis/core/views/MapView";


// Define interface for PlotPoint options
interface PlotPointOptions {
    symbol?: SimpleMarkerSymbol;
}

// Define the PlotPoint class
class PlotPoint {
    private view: MapView;
    private symbol: SimpleMarkerSymbol;

    constructor(view: MapView, options: PlotPointOptions = {}) {
        this.view = view; // MapView to plot on
        console.log("-----")
        this.symbol = options.symbol || new SimpleMarkerSymbol({
            color: [226, 119, 40],  // Default Orange color
            outline: {
                color: [255, 255, 255],  // White outline
                width: 2
            }
        });
    }

    // Method to plot a single point at the map center
    public plotAtCenter(): void {
        const center = this.view.center;

        if (center) {
            const point = new Point({
                longitude: center.longitude,
                latitude: center.latitude,
                spatialReference: SpatialReference.WGS84
            });

            const graphic = new Graphic({
                geometry: point,
                symbol: this.symbol
            });

            this.view.graphics.add(graphic);
        } else {
            console.error("Map center is not available.");
        }
    }

    // Method to plot a point at a given latitude and longitude
    public plotAtLocation(latitude: number, longitude: number): void {
        const point = new Point({
            latitude,
            longitude,
            spatialReference: SpatialReference.WGS84
        });

        const graphic = new Graphic({
            geometry: point,
            symbol: this.symbol
        });

        this.view.graphics.add(graphic);
    }

    // Method to change the symbol (color/outline) dynamically
    public changeSymbol(symbol: SimpleMarkerSymbol): void {
        this.symbol = symbol;
    }

    // Method to clear all graphics from the map
    public clearGraphics(): void {
        this.view.graphics.removeAll();
    }
}

export default PlotPoint;

