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
    Description?: string;
    Parameters?: Array<Record<string, any>>;
    Tools?: Array<Record<string, any>>;
    [key: string]: any;
};
export interface MorphixEditedState {
    sidc: string;
    symbolKey: string;
    symbolDefinition: SymbolDefinition;
    amplifier: Amplifier;
    drawEssentials: DrawEssentials;
    attributes: Record<string, any>;
}
interface MorphixCallbacks {
    applyEdit: (graphic: Graphic, editedState: MorphixEditedState) => Graphic | null;
}
declare class MorphixEngine {
    private callbacks;
    private root;
    private state;
    private originalSnapshot;
    private symbolFilter;
    private focusInfo;
    private keydownHandler;
    initialize(view: ViewLike, layerManager: GraphicsLayerManager, callbacks: MorphixCallbacks): void;
    open(graphic: Graphic): void;
    destroy(): void;
    private ensureRoot;
    private buildState;
    private serialize;
    private parseSnapshot;
    private render;
    private renderHeader;
    private renderSection;
    private renderIdentitySection;
    private renderSidcSection;
    private renderSymbolSwapSection;
    private renderAmplifierSection;
    private renderDrawSection;
    private renderParameters;
    private renderLabelSection;
    private renderExtraSection;
    private renderCimSection;
    private renderJsonSection;
    private renderFooter;
    private textField;
    private boolField;
    private colorField;
    private wire;
    private onInput;
    private onAction;
    private onKeyDown;
    private setSidcRange;
    private applySymbolKey;
    private applySidc;
    private validate;
    private save;
    private close;
    private snapshotFocus;
    private restoreFocus;
    private normalizeSidc;
    private getSymbolKey;
    private geomFamilyOf;
    private geomLabel;
    /** Plain JSON clone — for amplifier/draw/label/extra/cim fields only. Never use on ArcGIS geometry. */
    private jsonClone;
    /** Preserve ArcGIS geometry instances by calling their .clone() when available. */
    private cloneGeometry;
    private coerce;
    private esc;
    private rgbToHex;
    private hexToRgb;
}
export default MorphixEngine;
