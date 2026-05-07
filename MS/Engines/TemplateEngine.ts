import Graphic from '@arcgis/core/Graphic';

import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import DrawEssentials from '../Support/DrawEssentials';
import Amplifier from '../Support/Amplifier';
import AnnotationEngine from './AnnotationEngine';
import { LAYER_NAMES } from './SymbolEngine';

const TEMPLATES_KEY = 'pams8_templates';

export default class TemplateEngine {
  private _layerManager: GraphicsLayerManager;
  private _textSize: number = 12;
  private _labelOptions: any = {};

  constructor(
    getLayerManager: () => GraphicsLayerManager,
    textSize?: number,
    labelOptions?: any,
  ) {
    this._layerManager = getLayerManager();
    if (textSize !== undefined) this._textSize = textSize;
    if (labelOptions) this._labelOptions = labelOptions;
  }

  public updateOptions(textSize?: number, labelOptions?: any): void {
    if (textSize !== undefined) this._textSize = textSize;
    if (labelOptions) this._labelOptions = labelOptions;
  }

  private _loadTemplatesStore(): Record<string, any> {
    try {
      return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}');
    } catch {
      return {};
    }
  }

  public saveAsTemplate(name: string, graphic: Graphic): void {
    const de: any = graphic.attributes?.drawEssentials;
    const templates = this._loadTemplatesStore();
    templates[name] = {
      name,
      size: de?.SIZE,
      amplifier: de?.AMPLIFIER ? { ...de.AMPLIFIER } : {},
    };
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
    console.info(`[Templates] Saved template: "${name}"`);
  }

  public applyTemplate(name: string, graphic: Graphic): void {
    const t = this._loadTemplatesStore()[name];
    if (!t) {
      console.warn(`[Templates] Not found: "${name}"`);
      return;
    }

    const de: any = graphic.attributes?.drawEssentials;
    if (!de) return;

    if (t.size !== undefined) de.SIZE = t.size;

    const amplifier = new Amplifier();
    Object.assign(amplifier, t.amplifier);
    de.AMPLIFIER = amplifier;

    const id = graphic.attributes?.id;
    const annotationLayer = this._layerManager.getOrCreateLayer(
      LAYER_NAMES.ANNOTATION_LAYER,
    );
    if (id) {
      AnnotationEngine.deAnnotate(annotationLayer, id);
      if (amplifier.SIDC) {
        AnnotationEngine.annotate(
          annotationLayer,
          graphic.geometry,
          amplifier,
          de,
          id,
          this._textSize,
          de.ISFHAND || 0,
          this._labelOptions,
          {},
        );
      }
    }
    console.info(`[Templates] Applied template: "${name}"`);
  }

  public listTemplates(): string[] {
    return Object.keys(this._loadTemplatesStore());
  }

  public deleteTemplate(name: string): void {
    const templates = this._loadTemplatesStore();
    delete templates[name];
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
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

    const json = JSON.stringify(template, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pams8_template_${name.trim().replace(/\s+/g, '_')}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    this.saveAsTemplate(name.trim(), graphic);
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

          if (data.name) {
            const store = this._loadTemplatesStore();
            store[data.name] = data;
            localStorage.setItem(TEMPLATES_KEY, JSON.stringify(store));
          }

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

    if (data.name) {
      const store = this._loadTemplatesStore();
      store[data.name] = data;
      localStorage.setItem(TEMPLATES_KEY, JSON.stringify(store));
    }

    onNeedsInit?.(de, amplifier, data.name || 'template');
    console.info(`[Templates] Loaded template "${data.name || '(unnamed)'}"`);
  }
}