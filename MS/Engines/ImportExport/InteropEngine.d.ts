import type DrawEssentials from '../../Support/DrawEssentials';
import type Amplifier from '../../Support/Amplifier';
import ImportExportEngine from '../ImportExportEngine';
type NeedsInitHandler = (de: DrawEssentials, amplifier: Amplifier, id: string) => void;
declare class InteropEngine {
    private static _instance;
    private _importExportEngine;
    private _onNeedsInit;
    private static readonly ENGINE_NAME;
    private constructor();
    static getInstance(): InteropEngine;
    start(importExportEngine: ImportExportEngine, onNeedsInit: NeedsInitHandler): void;
    savePlanToFile(filename?: string): void;
    loadPlanFromFile(): void;
}
export default InteropEngine;
