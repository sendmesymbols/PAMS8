import Graphic from '@arcgis/core/Graphic';
import MapView from '@arcgis/core/views/MapView';
import SceneView from '@arcgis/core/views/SceneView';
import GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
import Amplifier from '../../Support/Amplifier';
import DrawEssentials from '../../Support/DrawEssentials';
type ViewLike = MapView | SceneView;
type SymbolDefinition = {
    Class?: string;
    Name?: string;
    SymGeoType?: string;
    Parameters?: Array<Record<string, any>>;
    Tools?: Array<Record<string, any>>;
    [key: string]: any;
};
interface MorphixCallbacks {
    applyEdit: (graphic: Graphic, editedState: MorphixEditedState) => Graphic | null;
}
export interface MorphixEditedState {
    sidc: string;
    symbolKey: string;
    symbolDefinition: SymbolDefinition;
    amplifier: Amplifier;
    drawEssentials: DrawEssentials;
    attributes: Record<string, any>;
}
declare class MorphixEngine {
    private callbacks;
    private root;
    private state;
    private styleElement;
    private keydownHandler;
    initialize(view: ViewLike, layerManager: GraphicsLayerManager, callbacks: MorphixCallbacks): void;
    open(graphic: Graphic): void;
    destroy(): void;
    private createState;
    private render;
    private renderSummary;
    private renderSymbolSwap;
    private renderSidc;
    private renderAmplifiers;
    private renderDrawSettings;
    private renderLabelSettings;
    private renderPreview;
    private renderAdvancedJson;
    private renderParameters;
    private renderValueInput;
    private handleInput;
    private handleAction;
    private handleKeyDown;
    private save;
    private applySymbolSearch;
    private applySymbolKey;
    private applySidc;
    private validateState;
    private close;
    private ensureRoot;
    private ensureStyles;
    private normalizeSidc;
    private getSymbolKey;
    private geometryFamily;
    private displayGeometryFamily;
    private pickExistingKeys;
    private pickExtraKeys;
    private coerceValue;
    private cloneValue;
    private prepareJson;
    private escape;
}
export default MorphixEngine;
