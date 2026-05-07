import Graphic from '@arcgis/core/Graphic';
import GraphicsLayerManager from '../Managers/GraphicsLayerManager';
import DrawEssentials from '../Support/DrawEssentials';
import Amplifier from '../Support/Amplifier';
export default class TemplateEngine {
    private _layerManager;
    private _textSize;
    private _labelOptions;
    constructor(getLayerManager: () => GraphicsLayerManager, textSize?: number, labelOptions?: any);
    updateOptions(textSize?: number, labelOptions?: any): void;
    private _loadTemplatesStore;
    saveAsTemplate(name: string, graphic: Graphic): void;
    applyTemplate(name: string, graphic: Graphic): void;
    listTemplates(): string[];
    deleteTemplate(name: string): void;
    saveTemplateToFile(graphic: Graphic): void;
    loadTemplateFromFile(onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, name: string) => void): void;
    applyTemplateData(data: any, onNeedsInit?: (de: DrawEssentials, amplifier: Amplifier, name: string) => void): void;
}
