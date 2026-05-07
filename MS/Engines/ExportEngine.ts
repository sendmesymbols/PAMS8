import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polygon from '@arcgis/core/geometry/Polygon';
import Polyline from '@arcgis/core/geometry/Polyline';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils';
import PictureMarkerSymbol from '@arcgis/core/symbols/PictureMarkerSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';

import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import DrawEssentials from '../Support/DrawEssentials';
import Amplifier from '../Support/Amplifier';
import AnnotationEngine from './AnnotationEngine';
import { LAYER_NAMES } from './SymbolEngine';

const LAYERS = [
  LAYER_NAMES.TACT,
  LAYER_NAMES.TACT_PT,
  LAYER_NAMES.FORCE,
  'milSymbols',
];

export default class ExportEngine {
  private _layerManager: GraphicsLayerManager;

  constructor(getLayerManager: () => GraphicsLayerManager) {
    this._layerManager = getLayerManager();
  }

  private _serializePoint(pt: any): object | null {
    if (!pt) return null;
    return {
      x: pt.x,
      y: pt.y,
      spatialReference: pt.spatialReference?.toJSON?.() ?? pt.spatialReference,
    };
  }

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

  public saveSymbolToJSON(graphic: Graphic): object {
    const de: any = graphic.attributes?.drawEssentials;
    const amplifier: any = de?.AMPLIFIER;
    const sp = (pt: any) => this._serializePoint(pt);

    const ctrlPts = de?.CTRL_PTS ? de.CTRL_PTS.map(sp) : undefined;
    const baseLnPts = de?.BASE_LN_PTS
      ? {
          startPt: sp(de.BASE_LN_PTS.startPt),
          midPt: sp(de.BASE_LN_PTS.midPt),
          endPt: sp(de.BASE_LN_PTS.endPt),
        }
      : undefined;

    let geom: object | undefined;
    if (de?.GEOM) {
      geom = sp(de.GEOM) ?? undefined;
    } else if (!ctrlPts && !baseLnPts && graphic.geometry?.type === 'point') {
      geom = sp(graphic.geometry) ?? undefined;
    }

    const deJson: any = { ...de };
    delete deJson.SCOPE;
    delete deJson.AMPLIFIER;
    delete deJson.CTRL_PTS;
    delete deJson.BASE_LN_PTS;
    delete deJson.GEOM;
    if (ctrlPts) deJson.CTRL_PTS = ctrlPts;
    if (baseLnPts) deJson.BASE_LN_PTS = baseLnPts;
    if (geom) deJson.GEOM = geom;

    return {
      pams8Version: '2.0',
      type: 'pams8-symbol',
      layerId: graphic.layer?.id ?? this._layerManager.getSymbolLayer().id,
      id: graphic.attributes?.id,
      sidc: amplifier?.SIDC || de?.SIDC,
      amplifier: amplifier ? { ...amplifier } : {},
      drawEssentials: deJson,
    };
  }

  public loadSymbolFromJSON(data: any): Graphic | null {
    try {
      const deData = data.drawEssentials || {};

      const ctrlPtsRaw = deData.CTRL_PTS ?? deData._CTRL_PTS;
      const baseLnPtsRaw = deData.BASE_LN_PTS ?? deData._BASE_LN_PTS;
      const geomRaw = deData.GEOM;

      const hasDrawData = ctrlPtsRaw?.length > 0 || !!baseLnPtsRaw || !!geomRaw;

      if (hasDrawData) {
        const de = new DrawEssentials();
        const {
          CTRL_PTS: _c1,
          _CTRL_PTS: _c2,
          BASE_LN_PTS: _b1,
          _BASE_LN_PTS: _b2,
          GEOM: _g,
          ...rest
        } = deData;
        Object.assign(de, rest);

        if (ctrlPtsRaw) {
          (de as any).CTRL_PTS = (ctrlPtsRaw as any[])
            .map((p: any) =>
              p
                ? new Point({
                    x: p.x,
                    y: p.y,
                    spatialReference: p.spatialReference,
                  })
                : null,
            )
            .filter(Boolean);
        }
        if (baseLnPtsRaw) {
          (de as any).BASE_LN_PTS = {
            startPt: baseLnPtsRaw.startPt
              ? new Point(baseLnPtsRaw.startPt)
              : undefined,
            midPt: baseLnPtsRaw.midPt
              ? new Point(baseLnPtsRaw.midPt)
              : undefined,
            endPt: baseLnPtsRaw.endPt
              ? new Point(baseLnPtsRaw.endPt)
              : undefined,
          };
        }
        if (geomRaw) {
          (de as any).GEOM = new Point({
            x: geomRaw.x,
            y: geomRaw.y,
            spatialReference: geomRaw.spatialReference,
          });
        }

        const amplifier = new Amplifier();
        if (data.amplifier) Object.assign(amplifier, data.amplifier);
        if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;

        return { type: 'needsInit', de, amplifier, id: data.id } as any;
      }

      let geometry: any;
      if (data.geometry && data.geometryType) {
        if (data.geometryType === 'point') geometry = new Point(data.geometry);
        else if (data.geometryType === 'polyline')
          geometry = new Polyline(data.geometry);
        else if (data.geometryType === 'polygon')
          geometry = new Polygon(data.geometry);
      }

      let symbol: any;
      if (data.symbol && data.symbolType) {
        if (data.symbolType === 'picture-marker')
          symbol = new PictureMarkerSymbol(data.symbol);
        else if (data.symbolType === 'simple-line')
          symbol = new SimpleLineSymbol(data.symbol);
        else if (data.symbolType === 'simple-fill')
          symbol = new SimpleFillSymbol(data.symbol);
        else if (data.symbolType === 'simple-marker')
          symbol = new SimpleMarkerSymbol(data.symbol);
      }

      const amplifier = new Amplifier();
      if (data.amplifier) Object.assign(amplifier, data.amplifier);
      if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;

      const de = new DrawEssentials();
      if (data.drawEssentials) {
        const {
          _CTRL_PTS,
          _BASE_LN_PTS,
          CTRL_PTS,
          BASE_LN_PTS,
          GEOM,
          ...rest
        } = data.drawEssentials;
        Object.assign(de, rest);
      }
      (de as any).AMPLIFIER = amplifier;

      const id = data.id || this.generateUUID();
      const graphic = new Graphic({
        geometry,
        symbol,
        attributes: {
          id,
          type: data.graphicType || 'symbol',
          drawEssentials: de,
        },
      });
      const layer =
        this._layerManager.getOrCreateLayer(data.layerId) ??
        this._layerManager.getSymbolLayer();
      layer.add(graphic);

      const annotationLayer = this._layerManager.getOrCreateLayer(
        LAYER_NAMES.ANNOTATION_LAYER,
      );
      if (geometry && amplifier.SIDC) {
        AnnotationEngine.annotate(
          annotationLayer,
          geometry,
          amplifier,
          de,
          id,
          12,
          (de as any).ISFHAND || 0,
          {},
          {},
        );
      }
      return graphic;
    } catch (e) {
      console.error('[SaveLoad] loadSymbolFromJSON failed:', e);
      return null;
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  public exportLayerToJSON(): object[] {
    const result: object[] = [];
    for (const layerId of LAYERS) {
      const layer = this._layerManager.getOrCreateLayer(layerId) as any;
      if (!layer?.graphics) continue;
      (layer.graphics as any).forEach((g: Graphic) => {
        try {
          result.push(this.saveSymbolToJSON(g));
        } catch {
          /* skip */
        }
      });
    }
    return result;
  }

  public importLayerFromJSON(data: object[]): void {
    data.forEach((item) => this.loadSymbolFromJSON(item as any));
    console.info(`[SaveLoad] Imported ${data.length} symbols`);
  }

  public saveToFile(filename?: string): void {
    const data = this.exportLayerToJSON();
    this._downloadJSON(data, filename ?? `pams8_symbols_${Date.now()}.json`);
    console.info(`[SaveLoad] Exported ${data.length} symbols`);
  }

  public saveSymbolToFile(graphic: Graphic): void {
    const data = this.saveSymbolToJSON(graphic);
    this._downloadJSON(data, `pams8_symbol_${Date.now()}.json`);
  }

  public loadFromFile(onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, id: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = JSON.parse(evt.target?.result as string);
          if (parsed?.type === 'FeatureCollection') {
            this.importFromGeoJSON(parsed);
          } else if (parsed?.type === 'pams8-template') {
            const de = new DrawEssentials();
            if (parsed.drawEssentials) {
              const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = parsed.drawEssentials;
              Object.assign(de, rest);
            }
            const amplifier = new Amplifier();
            if (parsed.amplifier) Object.assign(amplifier, parsed.amplifier);
            if (parsed.sidc && !amplifier.SIDC) amplifier.SIDC = parsed.sidc;
            onNeedsInit?.(de, amplifier, parsed.name || 'template');
          } else if (Array.isArray(parsed)) {
            this.importLayerFromJSON(parsed);
          } else {
            const result = this.loadSymbolFromJSON(parsed);
            if (result && (result as any).type === 'needsInit') {
              onNeedsInit?.(
                (result as any).de,
                (result as any).amplifier,
                (result as any).id,
              );
            }
          }
        } catch (err) {
          console.error('[SaveLoad] Failed to parse file:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  public saveTemplateToFile(graphic: Graphic): void {
    const de: any = graphic.attributes?.drawEssentials;
    const amplifier = de?.AMPLIFIER;
    const name = window.prompt('Template name:');
    if (!name?.trim()) return;

    const deClean: any = { ...de };
    delete deClean.AMPLIFIER;
    delete deClean.SCOPE;
    delete deClean.CTRL_PTS;
    delete deClean.BASE_LN_PTS;
    delete deClean.GEOM;

    const template = {
      pams8Version: '1.0',
      type: 'pams8-template',
      name: name.trim(),
      sidc: amplifier?.SIDC || de?.SIDC,
      amplifier: amplifier ? { ...amplifier } : {},
      drawEssentials: deClean,
    };

    this._downloadJSON(
      template,
      `pams8_template_${name.trim().replace(/\s+/g, '_')}_${Date.now()}.json`,
    );
    console.info(`[Templates] Template "${name.trim()}" saved to file`);
  }

  public loadTemplateFromFile(onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, name: string) => void): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = JSON.parse(evt.target?.result as string);
          const de = new DrawEssentials();
          if (data.drawEssentials) {
            const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = data.drawEssentials;
            Object.assign(de, rest);
          }
          const amplifier = new Amplifier();
          if (data.amplifier) Object.assign(amplifier, data.amplifier);
          if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;
          onNeedsInit?.(de, amplifier, data.name || 'template');
        } catch (err) {
          console.error('[Templates] Failed to load template file:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  public applyTemplateData(data: any, onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, name: string) => void): void {
    const de = new DrawEssentials();
    if (data.drawEssentials) {
      const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = data.drawEssentials;
      Object.assign(de, rest);
    }
    const amplifier = new Amplifier();
    if (data.amplifier) Object.assign(amplifier, data.amplifier);
    if (data.sidc && !amplifier.SIDC) amplifier.SIDC = data.sidc;
    onNeedsInit?.(de, amplifier, data.name || 'template');
    console.info(`[Templates] Loaded template "${data.name || '(unnamed)'}"`);
  }

  public exportToGeoJSON(): object {
    const features: any[] = [];
    const sp = (pt: any) => this._serializePoint(pt);

    for (const layerId of LAYERS) {
      const layer = this._layerManager.getOrCreateLayer(layerId) as any;
      if (!layer?.graphics) continue;

      (layer.graphics as any).forEach((g: Graphic) => {
        try {
          const de: any = g.attributes?.drawEssentials;
          const amplifier = de?.AMPLIFIER;

          let geom: any = g.geometry;
          const wkid = geom?.spatialReference?.wkid;
          if (geom && (wkid === 102100 || wkid === 3857)) {
            geom = webMercatorUtils.webMercatorToGeographic(geom);
          }

          let geoJsonGeom: any = null;
          if (geom?.type === 'point') {
            const pt = geom as Point;
            geoJsonGeom = {
              type: 'Point',
              coordinates: [pt.longitude ?? pt.x, pt.latitude ?? pt.y],
            };
          } else if (geom?.type === 'polyline') {
            geoJsonGeom = {
              type: 'MultiLineString',
              coordinates: (geom as any).paths ?? [],
            };
          } else if (geom?.type === 'polygon') {
            geoJsonGeom = {
              type: 'Polygon',
              coordinates: (geom as any).rings ?? [],
            };
          }

          if (!geoJsonGeom) return;

          const ctrlPts = de?.CTRL_PTS ? de.CTRL_PTS.map(sp) : undefined;
          const baseLnPts = de?.BASE_LN_PTS
            ? {
                startPt: sp(de.BASE_LN_PTS.startPt),
                midPt: sp(de.BASE_LN_PTS.midPt),
                endPt: sp(de.BASE_LN_PTS.endPt),
              }
            : undefined;
          const deGeom = de?.GEOM
            ? sp(de.GEOM)
            : !ctrlPts && !baseLnPts && g.geometry?.type === 'point'
              ? sp(g.geometry)
              : undefined;

          const deJson: any = { ...de };
          delete deJson.AMPLIFIER;
          delete deJson.SCOPE;
          delete deJson.CTRL_PTS;
          delete deJson.BASE_LN_PTS;
          delete deJson.GEOM;
          if (ctrlPts) deJson.CTRL_PTS = ctrlPts;
          if (baseLnPts) deJson.BASE_LN_PTS = baseLnPts;
          if (deGeom) deJson.GEOM = deGeom;

          features.push({
            type: 'Feature',
            geometry: geoJsonGeom,
            properties: {
              pams8: true,
              id: g.attributes?.id,
              layerId,
              sidc: amplifier?.SIDC || de?.SIDC,
              amplifier: amplifier ? { ...amplifier } : {},
              drawEssentials: deJson,
            },
          });
        } catch (e) {
          console.warn('[GeoJSON] Skipping graphic:', e);
        }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  public importFromGeoJSON(geojson: any): void {
    if (
      geojson?.type !== 'FeatureCollection' ||
      !Array.isArray(geojson.features)
    ) {
      console.error('[GeoJSON] Expected a GeoJSON FeatureCollection');
      return;
    }

    let count = 0;
    for (const feature of geojson.features) {
      try {
        const props = feature.properties ?? {};
        if (!props.pams8) continue;

        const deData = props.drawEssentials ?? {};
        const ctrlPtsRaw = deData.CTRL_PTS;
        const baseLnPtsRaw = deData.BASE_LN_PTS;
        const geomRaw = deData.GEOM;
        const geoGeom = feature.geometry;

        const de = new DrawEssentials();
        const { CTRL_PTS, BASE_LN_PTS, GEOM, ...rest } = deData;
        Object.assign(de, rest);

        if (ctrlPtsRaw?.length > 0) {
          (de as any).CTRL_PTS = (ctrlPtsRaw as any[])
            .map((p: any) =>
              p
                ? new Point({
                    x: p.x,
                    y: p.y,
                    spatialReference: p.spatialReference,
                  })
                : null,
            )
            .filter(Boolean);
        }
        if (baseLnPtsRaw) {
          (de as any).BASE_LN_PTS = {
            startPt: baseLnPtsRaw.startPt
              ? new Point(baseLnPtsRaw.startPt)
              : undefined,
            midPt: baseLnPtsRaw.midPt
              ? new Point(baseLnPtsRaw.midPt)
              : undefined,
            endPt: baseLnPtsRaw.endPt
              ? new Point(baseLnPtsRaw.endPt)
              : undefined,
          };
        }
        if (geomRaw) {
          (de as any).GEOM = new Point({
            x: geomRaw.x,
            y: geomRaw.y,
            spatialReference: geomRaw.spatialReference,
          });
        } else if (!ctrlPtsRaw && !baseLnPtsRaw && geoGeom?.type === 'Point') {
          (de as any).GEOM = new Point({
            longitude: geoGeom.coordinates[0],
            latitude: geoGeom.coordinates[1],
            spatialReference: { wkid: 4326 },
          });
        }

        const amplifier = new Amplifier();
        if (props.amplifier) Object.assign(amplifier, props.amplifier);
        if (props.sidc && !amplifier.SIDC) amplifier.SIDC = props.sidc;

        count++;
      } catch (e) {
        console.warn('[GeoJSON] Failed to import feature:', e);
      }
    }
    console.info(`[GeoJSON] Imported ${count} symbols`);
  }

  public saveToGeoJSONFile(filename?: string): void {
    const data = this.exportToGeoJSON();
    this._downloadJSON(data, filename ?? `pams8_geojson_${Date.now()}.geojson`);
    console.info('[GeoJSON] Exported GeoJSON file');
  }

  public loadFromGeoJSONFile(): void {
    this.loadFromFile();
  }
}