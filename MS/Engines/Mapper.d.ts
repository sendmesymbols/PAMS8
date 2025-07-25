import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
type ViewType = MapView | SceneView;
interface ISymbolConstructor {
    new (view: ViewType, isLine?: boolean): any;
}
export default class Mapper {
    symName: string;
    constructor(symName?: string);
    setSymName(symName: string): void;
    getInstance(): ISymbolConstructor;
}
export {};
