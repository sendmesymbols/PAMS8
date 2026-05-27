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
/**
 * The four geometry families a symbol can belong to, mirroring the
 * `SYM_GEO_TYPE` written into every symbol's drawEssentials:
 *   - `Point`  → Tactical point (TacticalPoint) — edited via flat SIZE/ANGLE fields.
 *   - `FPoint` → Force / UEI (milsymbol) — edited via the nested OPTIONS object.
 *   - `Line`   → Polyline tactical graphic.
 *   - `Area`   → Polygon tactical graphic.
 */
export type GeoKind = 'Point' | 'FPoint' | 'Line' | 'Area';
export interface MorphixEditedState {
    sidc: string;
    symbolKey: string;
    symbolDefinition: SymbolDefinition;
    amplifier: Amplifier;
    drawEssentials: DrawEssentials;
    attributes: Record<string, any>;
}
/**
 * Partial patch a host program supplies to {@link MorphixEngine.update} (and,
 * via the library entry point, `symbolEngine.updateSymbol`). Each member is
 * shallow-merged onto the symbol's current state, so only the fields you want
 * to change need to be present. The patch is geometry-preserving — the symbol's
 * GEOM / CTRL_PTS are never touched.
 */
export interface MorphixSymbolPatch {
    /** Replace the 20-digit SIDC. Re-derives SID / echelon / symbol name. */
    sidc?: string;
    /** Merge into the amplifier fields (UNIQUE_DESIG, DTG, …) of Point/Line/Area symbols. */
    amplifier?: Record<string, any>;
    /** Merge into drawEssentials top-level fields (SIZE, ANGLE, DRAW_TYPE, ratios, opacity, …). */
    drawEssentials?: Record<string, any>;
    /** FPoint only: merge into the milsymbol OPTIONS object (uniqueDesignation, higherFormation, …). */
    options?: Record<string, any>;
    /** Merge into label styling options (textSize, color, bold, …). */
    labelOptions?: Record<string, any>;
    /** Merge into extraSettings (lineWidth, size, textSize, opacity). For FPoint, `size` drives the marker size. */
    extraSettings?: Record<string, any>;
    /** Merge into the CIM cartographic info model. */
    cim?: Record<string, any>;
}
/** Read-only view of a symbol's editable state, returned by {@link MorphixEngine.getSymbolState}. */
export interface MorphixSymbolSnapshot {
    kind: GeoKind | '';
    sidc: string;
    symbolKey: string;
    symbolName: string;
    amplifier: Record<string, any>;
    drawEssentials: Record<string, any>;
    options: Record<string, any>;
    labelOptions: Record<string, any>;
    extraSettings: Record<string, any>;
    cim: Record<string, any>;
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
    /**
     * Apply a partial patch to a symbol and re-render it through the same pipeline
     * the interactive editor uses. Geometry is preserved untouched. Returns the
     * newly created Graphic, or null if the edit could not be applied.
     *
     * @example
     * symbolEngine.updateSymbol(graphic, {
     *   sidc: '10031000151211000000',
     *   options: { uniqueDesignation: 'A Coy', higherFormation: '1 Bn' }, // FPoint
     *   extraSettings: { size: 40 },
     * });
     */
    update(graphic: Graphic, patch: MorphixSymbolPatch): Graphic | null;
    /** Read a symbol's current editable state without opening the editor. */
    getSymbolState(graphic: Graphic): MorphixSymbolSnapshot;
    /** Merge a patch onto a working state. Shared by update() and (indirectly) the modal. */
    private applyPatch;
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
    private drawFieldsFor;
    private groupValue;
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
    /**
     * Apply a SIDC to a state (defaults to the open modal's state). Re-derives the
     * symbol key, SID, echelon, name and geometry kind, and keeps the SIDC mirrored
     * across amplifier / options / drawEssentials.
     */
    private applySidc;
    private validate;
    /**
     * Build the {@link MorphixEditedState} consumed by SymbolEngine.applyMorphixEdit.
     * Shared by the modal Save button and the programmatic {@link update} API so both
     * paths produce identical, geometry-correct results.
     */
    private buildEditedState;
    private save;
    private close;
    private snapshotFocus;
    private restoreFocus;
    private normalizeSidc;
    private getSymbolKey;
    /**
     * Resolve the innermost OPTIONS object for a Force (FPoint) symbol. At runtime the
     * OPTIONS payload can be nested (`de.OPTIONS.OPTIONS`) because UEISymbol stores the
     * drawEssentials it was initialised with as `OPTIONS`, and plan loads put the real
     * milsymbol options one level deeper. Descend until there's no further `.OPTIONS`.
     */
    private resolveOptions;
    /** Return the first argument that is neither null/undefined nor an empty/blank string. */
    private firstFilled;
    /** Resolve a raw SYM_GEO_TYPE / SymGeoType string to one of the four canonical kinds. */
    private geomKindOf;
    /** Best-effort geometry kind from the graphic when SYM_GEO_TYPE is missing. */
    private geomTypeOf;
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
