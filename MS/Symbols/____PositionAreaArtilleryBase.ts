import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import { wordStrokes, wordWidth } from "../Support/StrokeFont.ts";
import { ____TacticalSymbolBase, TacticalSymbolConfig, TacticalSymbolOptions } from "./____TacticalSymbolBase.ts";

/**
 * Position Area for Artillery (PAA), MIL-STD-2525D 25 2405xx: the gun area. As the 2525D template draws it, the
 * outline carries "PAA" four times, each set into a gap in the outline: centred on the top and bottom sides and on the
 * left and right sides (upper middle for the rectangle, the middle for the circle), the word always upright.
 *
 * Two clicks: the rectangle's opposite corners, or the circle's centre and a point on its edge. Like Battle Position,
 * the area is drawn as a polyline (the outline with its gaps), so it reloads from saved paths through the base class.
 */
export abstract class ____PositionAreaArtilleryBase extends ____TacticalSymbolBase {
    protected constructor(view: MapView | SceneView, isLine: boolean, config: TacticalSymbolConfig) {
        super(view, isLine, config);
    }

    protected abstract shape(): 'rect' | 'circle';

    public init(options: TacticalSymbolOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    /** Both shapes are fully given by two clicks. */
    protected override shouldFinishAfterClick(): boolean {
        return this._points.length >= 2 || super.shouldFinishAfterClick();
    }

    /** Two quick clicks may come with no mouse move between them, so no preview geometry was built yet: build it from
     *  the clicks, else the base would finish the draw with nothing to place. */
    protected override cleanUp(): void {
        if (this.tempGraphic && !this.tempGraphic.geometry && this._points.length >= 2) {
            const de = new DrawEssentials();
            (de as any).CTRL_PTS = this._points.slice();
            (de as any).DRAW_TYPE = this._drawType;
            const g = this.createSymbol(de);
            if (g) this.tempGraphic.geometry = g;
        }
        super.cleanUp();
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length < 2) throw new Error("controlPoints not found");
            const a = pts[0], b = pts[pts.length - 1];
            const sr = this.view.spatialReference;
            const result = new Polyline({ spatialReference: sr });
            const word = "PAA";
            if (this.shape() === 'rect') {
                const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
                const w = x1 - x0, h = y1 - y0;
                if (!(w > 0 && h > 0)) return null;
                const dr = Math.min(w, h) / 18;                              // a word about a sixth of the box wide, as 2525D
                const gw = wordWidth(word, dr) / 2 + dr * 0.8;               // half gap along a top / bottom side
                const gh = dr * 1.6;                                         // half gap along a left / right side
                const cx = (x0 + x1) / 2, sideY = y1 - h * 0.35;             // side labels: upper middle, as 2525D
                // outline, broken where the four words sit
                result.addPath([[cx - gw, y1], [x0, y1], [x0, sideY + gh]]);
                result.addPath([[x0, sideY - gh], [x0, y0], [cx - gw, y0]]);
                result.addPath([[cx + gw, y0], [x1, y0], [x1, sideY - gh]]);
                result.addPath([[x1, sideY + gh], [x1, y1], [cx + gw, y1]]);
                for (const [x, y] of [[cx, y1], [cx, y0], [x0, sideY], [x1, sideY]]) this.addWord(result, word, x, y, dr, sr);
            } else {
                const r = Math.hypot(b.x - a.x, b.y - a.y);
                if (!(r > 0)) return null;
                const dr = r / 9;
                const gw = wordWidth(word, dr) / 2 + dr * 0.8, gh = dr * 1.6;
                // walk the circle and lift the pen inside the four label windows
                const steps = 144;
                let run: number[][] = [];
                const flush = () => { if (run.length >= 2) result.addPath(run); run = []; };
                for (let i = 0; i <= steps; i++) {
                    const t = (i / steps) * 2 * Math.PI;
                    const dx = r * Math.cos(t), dy = r * Math.sin(t);
                    const inGap = (Math.abs(dx) < gw && Math.abs(dy) > r * 0.5) || (Math.abs(dy) < gh && Math.abs(dx) > r * 0.5);
                    if (inGap) flush(); else run.push([a.x + dx, a.y + dy]);
                }
                flush();
                for (const [x, y] of [[a.x, a.y + r], [a.x, a.y - r], [a.x - r, a.y], [a.x + r, a.y]]) this.addWord(result, word, x, y, dr, sr);
            }
            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    private addWord(result: Polyline, word: string, x: number, y: number, dr: number, sr: any): void {
        for (const s of wordStrokes(word, x, y, dr, sr)) if (s.length >= 2) result.addPath(s.map((p) => [p.x, p.y]));
    }
}

export default ____PositionAreaArtilleryBase;
