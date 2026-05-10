/**
 * SerializationEngine.ts
 *
 * Singleton responsible for all Plan file serialization and deserialization.
 * Owns savePlanToFile / loadPlanFromFile and every private helper that supports
 * them (geometry conversion, amplifier normalization, drawEss builders, etc.).
 *
 * Inspired by InteropEngine — uses EngineLogger for all log output.
 *
 * Initialize via:
 *   SerializationEngine.getInstance().start(layerManager, loadSymbolCallback);
 *
 * Then call via:
 *   engine.serializationEngine.savePlanToFile();
 *   engine.serializationEngine.loadPlanFromFile();
 */
import GraphicsLayerManager from '../../Managers/GraphicsLayerManager';
type LoadSymbolCallback = (data: {
    id: string;
    sidc: string;
    amplifier: any;
    drawEssentials: any;
}) => void;
declare class SerializationEngine {
    private static _instance;
    private static readonly ENGINE_NAME;
    private _layerManager;
    private _onLoadSymbol;
    private constructor();
    static getInstance(): SerializationEngine;
    start(layerManager: GraphicsLayerManager, onLoadSymbol: LoadSymbolCallback): void;
    /** Download all graphics as a Plan JSON file. */
    savePlanToFile(filename?: string): void;
    /** Open a Plan JSON file and restore all symbols from it. */
    loadPlanFromFile(): void;
    /**
     * Patch a PlanPoint ({type, x, y, sp:"WGS1SP"}) so that loadSymbolFromJSON's
     * `new Point({x, y, spatialReference})` receives an explicit WGS84 reference.
     */
    private _patchPlanPoint;
    /**
     * Convert a Plan drawEss JSON string back into the format expected by loadSymbolFromJSON.
     * PlanPoints tagged with sp:"WGS1SP" get an explicit 4326 spatialReference.
     */
    private _loadPlanSymbol;
    /**
     * Dispatch to the correct drawEss serializer based on the graphic's SYM_GEO_TYPE.
     * Returns null for graphics that cannot be represented in plan format.
     */
    private _buildPlanDrawEss;
    /**
     * Build drawEss JSON for UEI / milsymbol (FPoint) graphics.
     * OPTIONS uses de.OPTIONS when available (converting any nested GEOM to PlanPoint),
     * or builds the milsymbol options structure from amplifier/de fields.
     */
    private _buildFPointPlanDrawEss;
    /** Build drawEss JSON for Area / Line graphics (including those with BASE_LN_PTS). */
    private _buildAreaLinePlanDrawEss;
    /** Build drawEss JSON for TacticalPoint (SYM_GEO_TYPE "Point") graphics. */
    private _buildPointPlanDrawEss;
    /**
     * Enrich a DrawEssentials object with data that UEI/milsymbol symbol classes may
     * not store explicitly in drawEssentials but is derivable from the graphic:
     * - GEOM: falls back to graphic.geometry (milsymbol symbols store position there)
     * - SID:  derived from SIDC chars 11-16 when absent (maps to Symbols.json key)
     * - SYM_NAME: looked up in symbolData by SID when absent
     */
    private _enrichDe;
    /**
     * Convert an ArcGIS Point (or plain {x,y}) to the Plan PlanPoint format.
     * Web Mercator coordinates (wkid 102100 / 3857) are converted to WGS84 geographic
     * degrees so the Plan file is consumable by the legacy system (sp:"WGS1SP").
     */
    private _toPlanPoint;
    /**
     * Build the AMPLIFIER block for Area / Line / TacticalPoint symbols.
     * Always emits all 9 required legacy fields with correct defaults.
     * SIDC is intentionally excluded — it lives at the top level of drawEss.
     */
    private _serializeAmplifierForPlan;
    private _downloadJSON;
    private _generateUUID;
}
export default SerializationEngine;
