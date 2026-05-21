import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";

export type SymbolEventListener = (data: any) => void;

export class SymbolEvents {
    private listeners: Map<string, SymbolEventListener[]> = new Map();

    constructor(
        private view: MapView | SceneView,
        private symbolType: string
    ) {}

    emit(eventName: string, data: any = {}): void {
        const listeners = this.listeners.get(eventName);
        if (listeners) {
            listeners.forEach(listener => listener(data));
        }

        const customEvent = new CustomEvent(eventName, {
            detail: {
                symbolType: this.symbolType,
                eventName,
                ...data
            },
            bubbles: true,
            cancelable: true
        });

        if (this.view && this.view.container) {
            this.view.container.dispatchEvent(customEvent);
        } else {
            document.dispatchEvent(customEvent);
        }
    }

    on(eventName: string, callback: SymbolEventListener): void {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, []);
        }
        this.listeners.get(eventName)!.push(callback);
    }

    off(eventName: string, callback?: SymbolEventListener): void {
        if (!callback) {
            this.listeners.delete(eventName);
            return;
        }
        const listeners = this.listeners.get(eventName);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index > -1) {
                listeners.splice(index, 1);
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}

export default SymbolEvents;
