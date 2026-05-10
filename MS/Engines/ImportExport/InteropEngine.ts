import type DrawEssentials from '../../Support/DrawEssentials';
import type Amplifier from '../../Support/Amplifier';
import EngineLogger from '../../Support/EngineLogger';
import ImportExportEngine from '../ImportExportEngine';

type NeedsInitHandler = (
  de: DrawEssentials,
  amplifier: Amplifier,
  id: string,
) => void;

class InteropEngine {
  private static _instance: InteropEngine | null = null;
  private _importExportEngine: ImportExportEngine | null = null;
  private _onNeedsInit: NeedsInitHandler | null = null;
  private static readonly ENGINE_NAME = 'Interop Engine';

  private constructor() {}

  public static getInstance(): InteropEngine {
    if (!InteropEngine._instance) {
      InteropEngine._instance = new InteropEngine();
    }
    return InteropEngine._instance;
  }

  public start(
    importExportEngine: ImportExportEngine,
    onNeedsInit: NeedsInitHandler,
  ): void {
    this._importExportEngine = importExportEngine;
    this._onNeedsInit = onNeedsInit;
    EngineLogger.success(InteropEngine.ENGINE_NAME, 'Plan interop initialized');
  }

  public savePlanToFile(filename?: string): void {
    if (!this._importExportEngine) {
      EngineLogger.error(InteropEngine.ENGINE_NAME, 'Save plan failed: engine not initialized');
      return;
    }

    EngineLogger.nextStep(InteropEngine.ENGINE_NAME, 'Saving plan to file');
    try {
      this._importExportEngine.savePlanToFile(filename);
      EngineLogger.success(InteropEngine.ENGINE_NAME, 'Plan save flow started');
    } catch (err) {
      EngineLogger.error(
        InteropEngine.ENGINE_NAME,
        `Save plan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  public loadPlanFromFile(): void {
    if (!this._importExportEngine) {
      EngineLogger.error(InteropEngine.ENGINE_NAME, 'Load plan failed: engine not initialized');
      return;
    }

    EngineLogger.nextStep(InteropEngine.ENGINE_NAME, 'Loading plan from file');
    try {
      this._importExportEngine.loadPlanFromFile((de, amplifier, id) => {
        this._onNeedsInit?.(de, amplifier, id);
      });
      EngineLogger.success(InteropEngine.ENGINE_NAME, 'Plan load flow started');
    } catch (err) {
      EngineLogger.error(
        InteropEngine.ENGINE_NAME,
        `Load plan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export default InteropEngine;
