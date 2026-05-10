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

import Graphic from '@arcgis/core/Graphic';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';

import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../../Managers/GraphicsLayerManager';
import EngineLogger from '../../Support/EngineLogger';
import Plan from './Plan.ts';
import symbolData from '../../Data/Symbols.json';

type LoadSymbolCallback = (data: {
  id: string;
  sidc: string;
  amplifier: any;
  drawEssentials: any;
}) => void;

class SerializationEngine {
  // ── Singleton ────────────────────────────────────────────────────────────
  private static _instance: SerializationEngine | null = null;
  private static readonly ENGINE_NAME = 'Serialization Engine';

  private _layerManager: GraphicsLayerManager | null = null;
  private _onLoadSymbol: LoadSymbolCallback | null = null;

  private constructor() {}

  public static getInstance(): SerializationEngine {
    if (!SerializationEngine._instance) {
      SerializationEngine._instance = new SerializationEngine();
    }
    return SerializationEngine._instance;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  public start(
    layerManager: GraphicsLayerManager,
    onLoadSymbol: LoadSymbolCallback,
  ): void {
    this._layerManager = layerManager;
    this._onLoadSymbol = onLoadSymbol;
    EngineLogger.success(SerializationEngine.ENGINE_NAME, 'Plan serialization initialized');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Download all graphics as a Plan JSON file. */
  public savePlanToFile(filename?: string): void {
    if (!this._layerManager) {
      EngineLogger.error(SerializationEngine.ENGINE_NAME, 'Save plan failed: engine not initialized');
      return;
    }

    EngineLogger.nextStep(SerializationEngine.ENGINE_NAME, 'Saving plan to file');
    try {
      const planId = Date.now();
      const plan = new Plan(Plan.createDefaultObject(planId));
      const layerIds = [
        LAYER_NAMES.TACT,
        LAYER_NAMES.TACT_PT,
        LAYER_NAMES.FORCE,
        'milSymbols',
      ];
      let overlaySeq = 1;
      let totalSymbols = 0;

      for (const layerId of layerIds) {
        const layer = this._layerManager.getOrCreateLayer(layerId) as any;
        if (!layer?.graphics?.length) continue;

        const overlayId = this._generateUUID();
        const symbols: ReturnType<typeof Plan.createSymbol>[] = [];

        (layer.graphics as any).forEach((g: Graphic) => {
          try {
            const drawEssObj = this._buildPlanDrawEss(g);
            if (!drawEssObj) return;
            const symbolId = g.attributes?.id || this._generateUUID();
            symbols.push(
              Plan.createSymbol(planId, overlayId, symbolId, JSON.stringify(drawEssObj)),
            );
          } catch (err) {
            EngineLogger.error(
              SerializationEngine.ENGINE_NAME,
              `Could not serialize graphic: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        });

        if (!symbols.length) continue;
        totalSymbols += symbols.length;

        plan.addOverlay(
          Plan.createOverlay(
            planId,
            overlayId,
            (layer?.title ?? layerId).trim(),
            overlaySeq++,
            symbols,
          ),
        );
      }

      this._downloadJSON(plan.toJSON(), filename ?? `pams8_plan_${Date.now()}.json`);
      EngineLogger.success(
        SerializationEngine.ENGINE_NAME,
        `Plan saved — ${totalSymbols} symbols across ${overlaySeq - 1} overlays`,
      );
    } catch (err) {
      EngineLogger.error(
        SerializationEngine.ENGINE_NAME,
        `Save plan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Open a Plan JSON file and restore all symbols from it. */
  public loadPlanFromFile(): void {
    if (!this._onLoadSymbol) {
      EngineLogger.error(SerializationEngine.ENGINE_NAME, 'Load plan failed: engine not initialized');
      return;
    }

    EngineLogger.nextStep(SerializationEngine.ENGINE_NAME, 'Loading plan from file');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target?.result as string);
          if (!Plan.isPlanDocument(parsed)) {
            EngineLogger.error(
              SerializationEngine.ENGINE_NAME,
              'File does not appear to be a valid Plan document',
            );
            return;
          }
          let loaded = 0;
          for (const overlay of parsed.poObj.plnOrdrOverlay) {
            for (const sym of overlay.plnOrdrSymbolSet) {
              if (sym.isDelete === 'Y') continue;
              this._loadPlanSymbol(sym.drawEss, sym.plnOrdrSymbolPK.plnOrdrSymbolId);
              loaded++;
            }
          }
          EngineLogger.success(
            SerializationEngine.ENGINE_NAME,
            `Loaded ${loaded} symbols from plan`,
          );
        } catch (err) {
          EngineLogger.error(
            SerializationEngine.ENGINE_NAME,
            `Failed to parse plan file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ── Private — Plan loading ────────────────────────────────────────────────

  /**
   * Patch a PlanPoint ({type, x, y, sp:"WGS1SP"}) so that loadSymbolFromJSON's
   * `new Point({x, y, spatialReference})` receives an explicit WGS84 reference.
   */
  private _patchPlanPoint(p: any): any {
    if (!p || p.sp !== 'WGS1SP') return p;
    return { x: p.x, y: p.y, spatialReference: { wkid: 4326 } };
  }

  /**
   * Convert a Plan drawEss JSON string back into the format expected by loadSymbolFromJSON.
   * PlanPoints tagged with sp:"WGS1SP" get an explicit 4326 spatialReference.
   */
  private _loadPlanSymbol(drawEssRaw: string, symbolId: string): void {
    let drawEssObj: any;
    try {
      drawEssObj = JSON.parse(drawEssRaw);
    } catch {
      EngineLogger.error(
        SerializationEngine.ENGINE_NAME,
        `Could not parse drawEss for symbol ${symbolId}`,
      );
      return;
    }

    const normalizedDrawEss = Plan.normalizeDrawEssForRuntime(drawEssObj);
    const amplifier = normalizedDrawEss?.AMPLIFIER ?? {};
    if (normalizedDrawEss?.SIDC && !amplifier.SIDC) amplifier.SIDC = normalizedDrawEss.SIDC;

    const de: any = { ...normalizedDrawEss };

    if (de.GEOM?.sp === 'WGS1SP') {
      de.GEOM = this._patchPlanPoint(de.GEOM);
    }
    if (Array.isArray(de.CTRL_PTS)) {
      de.CTRL_PTS = de.CTRL_PTS.map((p: any) => this._patchPlanPoint(p));
    }
    if (de.BASE_LN_PTS) {
      de.BASE_LN_PTS = {
        startPt: this._patchPlanPoint(de.BASE_LN_PTS.startPt),
        midPt:   this._patchPlanPoint(de.BASE_LN_PTS.midPt),
        endPt:   this._patchPlanPoint(de.BASE_LN_PTS.endPt),
      };
    }
    if (de.OPTIONS?.GEOM?.sp === 'WGS1SP') {
      de.OPTIONS = { ...de.OPTIONS, GEOM: this._patchPlanPoint(de.OPTIONS.GEOM) };
    }

    this._onLoadSymbol!({
      id: symbolId,
      sidc: amplifier?.SIDC || normalizedDrawEss?.SIDC,
      amplifier,
      drawEssentials: de,
    });
  }

  // ── Private — Plan saving helpers ────────────────────────────────────────

  /**
   * Dispatch to the correct drawEss serializer based on the graphic's SYM_GEO_TYPE.
   * Returns null for graphics that cannot be represented in plan format.
   */
  private _buildPlanDrawEss(graphic: Graphic): Record<string, any> | null {
    const rawDe: any = graphic.attributes?.drawEssentials;
    if (!rawDe) return null;
    const amplifier: any = rawDe?.AMPLIFIER ?? {};
    const geoType: string = rawDe?.SYM_GEO_TYPE ?? '';

    if (geoType === 'FPoint') {
      return this._buildFPointPlanDrawEss(this._enrichDe(rawDe, graphic), amplifier);
    }
    if (geoType === 'Area' || geoType === 'Line') {
      return this._buildAreaLinePlanDrawEss(rawDe, amplifier);
    }
    if (geoType === 'Point') {
      return this._buildPointPlanDrawEss(this._enrichDe(rawDe, graphic), amplifier);
    }
    // Fallback: infer type from geometry shape
    if (rawDe.CTRL_PTS?.length > 0) {
      return this._buildAreaLinePlanDrawEss(rawDe, amplifier);
    }
    if (rawDe.GEOM || graphic.geometry?.type === 'point') {
      const hasUEI = rawDe.UEI === '1' || amplifier?.SIDC?.length > 10;
      const enriched = this._enrichDe(rawDe, graphic);
      if (hasUEI) return this._buildFPointPlanDrawEss(enriched, amplifier);
      return this._buildPointPlanDrawEss(enriched, amplifier);
    }
    return null;
  }

  /**
   * Build drawEss JSON for UEI / milsymbol (FPoint) graphics.
   * OPTIONS uses de.OPTIONS when available (converting any nested GEOM to PlanPoint),
   * or builds the milsymbol options structure from amplifier/de fields.
   */
  private _buildFPointPlanDrawEss(de: any, amplifier: any): Record<string, any> {
    const geom = this._toPlanPoint(de?.GEOM);
    const sidc: string = amplifier?.SIDC || de?.SIDC || '';

    let options: Record<string, any>;
    const existingOpts = de?.OPTIONS;
    if (existingOpts && typeof existingOpts === 'object' &&
        (existingOpts.size !== undefined || existingOpts.symType !== undefined ||
         existingOpts.uniqueDesignation !== undefined || existingOpts.SIDC !== undefined)) {
      options = { ...existingOpts };
      if (options.GEOM && options.GEOM.x != null) {
        options.GEOM = this._toPlanPoint(options.GEOM) ?? options.GEOM;
      }
    } else {
      options = {
        alphaNum: 100,
        size: String(de?.SIZE ?? 25),
        ANGLE: de?.ANGLE ?? 0,
        symType: 'FPoint',
        SIDC: sidc,
        uniqueDesignation:    amplifier?.UNIQUE_DESIG    ?? ' ',
        uniqueDesignationID:  amplifier?.UNIQUE_DESIG_ID ?? '',
        higherFormation:      amplifier?.HIGHER_FORM      ?? '',
        hfid:                 amplifier?.hfid             ?? '',
        staffComments:        amplifier?.STAFF_COM        ?? '',
        additionalInformation: amplifier?.ADDL_INFO       ?? '',
        ECHELON:  de?.ECHELON ?? '00',
        opacity:  de?.opacity ?? 1,
        labelOptions: de?.labelOptions ?? {},
      };
      if (geom) options.GEOM = geom;
    }

    return {
      SYM_GEO_TYPE: 'FPoint',
      SID:      de?.SID      ?? '',
      SYM_NAME: de?.SYM_NAME ?? '',
      OPTIONS:  options,
      GEOM:     geom,
      AMPLIFIER: {},
      UEI:  '1',
      SIDC: sidc,
      labelOptions: de?.labelOptions ?? {},
      opacity: de?.opacity ?? 1,
    };
  }

  /** Build drawEss JSON for Area / Line graphics (including those with BASE_LN_PTS). */
  private _buildAreaLinePlanDrawEss(de: any, amplifier: any): Record<string, any> {
    const geoType: string = de?.SYM_GEO_TYPE ?? 'Area';
    const ctrlPts = (de?.CTRL_PTS as any[])?.map((p: any) => this._toPlanPoint(p)).filter(Boolean) ?? [];
    const sidc: string = amplifier?.SIDC || de?.SIDC || '';
    const result: Record<string, any> = {
      SYM_GEO_TYPE: geoType,
      SID:      de?.SID      ?? '',
      SYM_NAME: de?.SYM_NAME ?? '',
      CTRL_PTS: ctrlPts,
      AMPLIFIER: this._serializeAmplifierForPlan(amplifier),
    };

    const optionals = [
      'DRAW_TYPE', 'ECHELON', 'FACE_GAP',
      'ISFHAND', 'FRHNDSZ', 'FRHNDWDTH',
      'drawExtendType',
    ];
    for (const k of optionals) {
      if (de?.[k] !== undefined) result[k] = de[k];
    }

    if (de?.HEAD_RATIO !== undefined) {
      const hr = de.HEAD_RATIO;
      result.HEAD_RATIO = typeof hr === 'string' ? hr : `${hr}`;
    }
    if (de?.TAIL_FACTOR !== undefined) {
      const tf = de.TAIL_FACTOR;
      result.TAIL_FACTOR = typeof tf === 'string' ? tf : `${tf}`;
    }

    result.SIDC = sidc;
    result.labelOptions = de?.labelOptions ?? {};
    result.opacity = de?.opacity ?? 1;

    if (de?.BASE_LN_PTS) {
      const blp = de.BASE_LN_PTS;
      result.BASE_LN_PTS = {
        startPt: this._toPlanPoint(blp.startPt),
        midPt:   this._toPlanPoint(blp.midPt),
        endPt:   this._toPlanPoint(blp.endPt),
      };
      if (de.BK_LN_DIST_RATIO  !== undefined) result.BK_LN_DIST_RATIO   = de.BK_LN_DIST_RATIO;
      if (de.BK_LN_ANGL_RATIO  !== undefined) result.BK_LN_ANGL_RATIO   = de.BK_LN_ANGL_RATIO;
      if (de.FRNT_LN_ANGL_RATIO !== undefined) result.FRNT_LN_ANGL_RATIO = de.FRNT_LN_ANGL_RATIO;
      if (de.drawExtendType !== undefined) result.drawExtendType = de.drawExtendType;
    }

    return result;
  }

  /** Build drawEss JSON for TacticalPoint (SYM_GEO_TYPE "Point") graphics. */
  private _buildPointPlanDrawEss(de: any, amplifier: any): Record<string, any> {
    const geom = this._toPlanPoint(de?.GEOM);
    const sidc: string = amplifier?.SIDC || de?.SIDC || '';
    const result: Record<string, any> = {
      SYM_GEO_TYPE: 'Point',
      SID:      de?.SID      ?? '',
      SYM_NAME: de?.SYM_NAME ?? '',
    };

    if (de?.SIZE  !== undefined) result.SIZE  = de.SIZE;
    if (de?.ANGLE !== undefined) result.ANGLE = de.ANGLE;

    result.GEOM = geom;
    result.AMPLIFIER = this._serializeAmplifierForPlan(amplifier);

    if (de?.ISFHAND !== undefined) result.ISFHAND = de.ISFHAND;

    result.SIDC = sidc;
    result.labelOptions = de?.labelOptions ?? {};

    if (de?.FRHNDSZ  !== undefined) result.FRHNDSZ  = de.FRHNDSZ;
    if (de?.FRHNDWDTH !== undefined) result.FRHNDWDTH = de.FRHNDWDTH;

    result.opacity = de?.opacity ?? 1;

    return result;
  }

  /**
   * Enrich a DrawEssentials object with data that UEI/milsymbol symbol classes may
   * not store explicitly in drawEssentials but is derivable from the graphic:
   * - GEOM: falls back to graphic.geometry (milsymbol symbols store position there)
   * - SID:  derived from SIDC chars 11-16 when absent (maps to Symbols.json key)
   * - SYM_NAME: looked up in symbolData by SID when absent
   */
  private _enrichDe(de: any, graphic: Graphic): any {
    let out = de;

    if (!out.GEOM && graphic.geometry?.type === 'point') {
      out = { ...out, GEOM: graphic.geometry };
    }

    const sidc: string = out.SIDC || out.AMPLIFIER?.SIDC || '';
    if ((!out.SID || !out.SYM_NAME) && sidc.length >= 16) {
      const sid = sidc.substring(10, 16);
      const entry = (symbolData as any)[sid];
      if (!out.SID)      out = { ...out, SID: sid };
      if (!out.SYM_NAME && entry?.Name) out = { ...out, SYM_NAME: entry.Name };
    }

    return out;
  }

  /**
   * Convert an ArcGIS Point (or plain {x,y}) to the Plan PlanPoint format.
   * Web Mercator coordinates (wkid 102100 / 3857) are converted to WGS84 geographic
   * degrees so the Plan file is consumable by the legacy system (sp:"WGS1SP").
   */
  private _toPlanPoint(pt: any): { type: 'point'; x: number; y: number; sp: string } | null {
    if (!pt || pt.x == null || pt.y == null) return null;
    let x: number = pt.x;
    let y: number = pt.y;
    const wkid = pt.spatialReference?.wkid ?? pt.spatialReference?.latestWkid;
    if (wkid === 102100 || wkid === 3857) {
      [x, y] = webMercatorUtils.xyToLngLat(x, y);
    }
    return { type: 'point', x, y, sp: 'WGS1SP' };
  }

  /**
   * Build the AMPLIFIER block for Area / Line / TacticalPoint symbols.
   * Always emits all 9 required legacy fields with correct defaults.
   * SIDC is intentionally excluded — it lives at the top level of drawEss.
   */
  private _serializeAmplifierForPlan(amplifier: any): Record<string, any> {
    const amp: Record<string, any> = {
      UNIQUE_DESIG:          amplifier?.UNIQUE_DESIG          ?? ' ',
      UNIQUE_DESIG_ID:       amplifier?.UNIQUE_DESIG_ID       ?? '',
      HIGHER_FORM:           amplifier?.HIGHER_FORM            ?? '',
      hfid:                  amplifier?.hfid                   ?? '',
      STAFF_COM:             amplifier?.STAFF_COM              ?? '',
      ADDL_INFO:             amplifier?.ADDL_INFO              ?? '',
      MULTI_LINE_LABEL_TEXT: amplifier?.MULTI_LINE_LABEL_TEXT  ?? '',
      MULTI_LINE_LABEL_COLOR: amplifier?.MULTI_LINE_LABEL_COLOR ?? '#000000',
      MULTI_LINE_LABEL_ALIGN: amplifier?.MULTI_LINE_LABEL_ALIGN ?? 'center',
    };
    if (amplifier?.DTG)              amp.DTG              = amplifier.DTG;
    if (amplifier?.DTGTO)            amp.DTGTO            = amplifier.DTGTO;
    if (amplifier?.TARGET_DESIGNATOR) amp.TARGET_DESIGNATOR = amplifier.TARGET_DESIGNATOR;
    return amp;
  }

  // ── Private — Utilities ──────────────────────────────────────────────────

  private _downloadJSON(data: any, filename: string): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private _generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export default SerializationEngine;
