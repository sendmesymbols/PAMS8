import Graphic from '@arcgis/core/Graphic';

import EditEngine from './EditEngine.ts';
import AnnotationEngine from './AnnotationEngine.ts';
import GraphicsLayerManager, {
  LAYER_NAMES,
} from '../Managers/GraphicsLayerManager';
import EngineLogger from '../Support/EngineLogger';
import settingsData from '../Data/Settings.json';

export interface UndoEntry {
  label: string;
  undo: () => void;
  redo: () => void;
}

export interface UndoRedoDeps {
  layerManager: GraphicsLayerManager;
  editEngine: EditEngine;
  getLabelOptions: () => any;
}

interface PreEditSnapshot {
  geometry: any;
  ctrlPts: any;
  baseLnPts: any;
  _graphic: Graphic;
  _label: string;
  _additionalSnapshots: Array<{
    graphic: Graphic;
    geometry: any;
    ctrlPts: any;
    baseLnPts: any;
  }>;
}

/**
 * Owns the undo/redo stacks, the pre-edit snapshot mechanism, and the
 * EditEngine wiring that captures geometry changes as undo entries.
 * Extracted from SymbolEngine — SymbolEngine retains thin delegates for
 * _pushUndo / undo / redo / undoCount / redoCount / nextUndoLabel / nextRedoLabel
 * so external call sites are unchanged.
 */
export default class UndoRedoManager {
  /**
   * Cap on undo depth. The stack only ever grew (entries leave only via undo()
   * → redo stack, or clear()), and each entry's undo/redo closures pin Graphic
   * instances + cloned geometry / CTRL_PTS / BASE_LN_PTS — so without a cap a
   * long editing session leaks memory proportional to the number of operations.
   */
  private static readonly MAX_UNDO_DEPTH = 100;

  private _undoStack: UndoEntry[] = [];
  private _redoStack: UndoEntry[] = [];
  private _preEditSnapshot: PreEditSnapshot | null = null;

  constructor(private readonly deps: UndoRedoDeps) {
    this.wireEditEngineUndo();
  }

  /** Push an undo entry and clear the redo stack. */
  public push(entry: UndoEntry): void {
    // Evict the oldest entry when at capacity so its captured graphics/geometry
    // clones become GC-able — bounds memory over a long editing session.
    if (this._undoStack.length >= UndoRedoManager.MAX_UNDO_DEPTH) {
      this._undoStack.shift();
    }
    this._undoStack.push(entry);
    this._redoStack = [];
  }

  /** Undo the last operation. */
  public undo(): void {
    const entry = this._undoStack.pop();
    if (!entry) return;
    entry.undo();
    this._redoStack.push(entry);
    EngineLogger.success('Symbol Engine', `Undo — ${entry.label}`);
    console.info(`[Undo] ${entry.label}`);
  }

  /** Redo the last undone operation. */
  public redo(): void {
    const entry = this._redoStack.pop();
    if (!entry) return;
    entry.redo();
    this._undoStack.push(entry);
    EngineLogger.success('Symbol Engine', `Redo — ${entry.label}`);
    console.info(`[Redo] ${entry.label}`);
  }

  public get undoCount(): number {
    return this._undoStack.length;
  }

  public get redoCount(): number {
    return this._redoStack.length;
  }

  public get nextUndoLabel(): string | null {
    return this._undoStack.length > 0
      ? this._undoStack[this._undoStack.length - 1].label
      : null;
  }

  /**
   * Clear both stacks and the pre-edit snapshot — used by clearAllGraphics.
   *
   * The stack arrays hold closures that reference Graphic instances via
   * `undo`/`redo` lambdas; dropping the arrays releases those references for
   * GC. We also null `_preEditSnapshot`, which otherwise pins the most
   * recently-edited graphic (including any `additionalGraphics`) until the
   * next edit operation completes.
   */
  public clear(): void {
    this._undoStack = [];
    this._redoStack = [];
    this._preEditSnapshot = null;
  }

  public get nextRedoLabel(): string | null {
    return this._redoStack.length > 0
      ? this._redoStack[this._redoStack.length - 1].label
      : null;
  }

  /**
   * Snapshot a graphic's geometry, CTRL_PTS and BASE_LN_PTS just before an
   * edit operation begins. Called from SymbolEngine right before activating
   * EditEngine on a graphic.
   */
  public capturePreEditSnapshot(
    graphic: Graphic,
    additionalGraphics: Graphic[],
    operationLabel: string,
  ): void {
    const de = graphic.attributes?.drawEssentials;
    this._preEditSnapshot = {
      geometry: graphic.geometry?.clone(),
      ctrlPts: de?.CTRL_PTS
        ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
        : null,
      baseLnPts: de?.BASE_LN_PTS
        ? JSON.parse(JSON.stringify(de.BASE_LN_PTS))
        : null,
      _graphic: graphic,
      _label: operationLabel,
      _additionalSnapshots: additionalGraphics.map((g) => {
        const ade = g.attributes?.drawEssentials;
        return {
          graphic: g,
          geometry: g.geometry?.clone(),
          ctrlPts: ade?.CTRL_PTS
            ? ade.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
            : null,
          baseLnPts: ade?.BASE_LN_PTS
            ? JSON.parse(JSON.stringify(ade.BASE_LN_PTS))
            : null,
        };
      }),
    };
  }

  /**
   * Re-wire the EditEngine listener — invoke after a view switch causes
   * SymbolEngine to construct a new EditEngine.
   */
  public rewireEditEngine(editEngine: EditEngine): void {
    (this.deps as any).editEngine = editEngine;
    this.wireEditEngineUndo();
  }

  private wireEditEngineUndo(): void {
    this.deps.editEngine.on(
      'changeInSymbol',
      ({ graphic }: { graphic: Graphic }) => {
        const snap = this._preEditSnapshot;
        if (!snap || snap._graphic !== graphic) return;

        const label = snap._label ?? 'Edit';
        const annotationLayer = this.deps.layerManager.getOrCreateLayer(
          LAYER_NAMES.ANNOTATION_LAYER,
        );

        const primaryStates = this.buildGraphicUndoState(graphic, snap);

        const additionalPrev = snap._additionalSnapshots ?? [];
        const additionalNext = additionalPrev.map((s) =>
          this.buildGraphicUndoState(s.graphic, s),
        );

        const labelOpts = this.deps.getLabelOptions() ?? {};
        const applyGraphicState = (
          g: Graphic,
          geom: any,
          ctrlPts: any,
          baseLnPts: any,
        ) => {
          const de = g.attributes?.drawEssentials;
          g.geometry = geom;
          if (de && ctrlPts) de.CTRL_PTS = ctrlPts;
          if (de && baseLnPts) de.BASE_LN_PTS = baseLnPts;
          const gid = g.attributes?.id;
          if (gid) {
            AnnotationEngine.deAnnotate(annotationLayer, gid);
            if (de?.AMPLIFIER) {
              AnnotationEngine.annotate(
                annotationLayer,
                geom,
                de.AMPLIFIER,
                de,
                gid,
                settingsData.textSize,
                de.ISFHAND || 0,
                labelOpts,
                {},
              );
            }
          }
        };

        this.push({
          label,
          undo: () => {
            applyGraphicState(
              graphic,
              primaryStates.prev.geometry,
              primaryStates.prev.ctrlPts,
              primaryStates.prev.baseLnPts,
            );
            additionalPrev.forEach((s) =>
              applyGraphicState(s.graphic, s.geometry, s.ctrlPts, s.baseLnPts),
            );
          },
          redo: () => {
            applyGraphicState(
              graphic,
              primaryStates.next.geometry,
              primaryStates.next.ctrlPts,
              primaryStates.next.baseLnPts,
            );
            additionalNext.forEach((s: any) =>
              applyGraphicState(s.graphic, s.geometry, s.ctrlPts, s.baseLnPts),
            );
          },
        });

        this._preEditSnapshot = null;
      },
    );
  }

  private buildGraphicUndoState(
    graphic: Graphic,
    prevSnap: { geometry: any; ctrlPts: any; baseLnPts: any },
  ) {
    const de = graphic.attributes?.drawEssentials;
    return {
      prev: {
        geometry: prevSnap.geometry,
        ctrlPts: prevSnap.ctrlPts,
        baseLnPts: prevSnap.baseLnPts,
      },
      next: {
        geometry: graphic.geometry?.clone(),
        ctrlPts: de?.CTRL_PTS
          ? de.CTRL_PTS.map((p: any) => p.clone?.() ?? p)
          : null,
        baseLnPts: de?.BASE_LN_PTS
          ? JSON.parse(JSON.stringify(de.BASE_LN_PTS))
          : null,
      },
    };
  }
}
