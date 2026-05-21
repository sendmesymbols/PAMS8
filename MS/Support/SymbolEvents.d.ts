import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
export type SymbolEventListener = (data: any) => void;
export declare class SymbolEvents {
    private view;
    private symbolType;
    private listeners;
    constructor(view: MapView | SceneView, symbolType: string);
    emit(eventName: string, data?: any): void;
    on(eventName: string, callback: SymbolEventListener): void;
    off(eventName: string, callback?: SymbolEventListener): void;
    clear(): void;
}
export default SymbolEvents;
