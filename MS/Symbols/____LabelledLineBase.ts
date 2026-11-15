import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import MapView from "@arcgis/core/views/MapView";
import SceneView from "@arcgis/core/views/SceneView";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
import DrawEssentials from "../Support/DrawEssentials";
import GeoTools from "../Support/GeoTools.ts";
import Shapes from "../Support/Shapes.ts";
import { wordStrokes, wordWidth } from "../Support/StrokeFont.ts";
import { ____TacticalSymbolBase, TacticalSymbolConfig, TacticalSymbolOptions } from "./____TacticalSymbolBase.ts";

/** Where a line symbol writes its name, after the MIL-STD-2525D template drawings (DISA artwork, Esri JMSML). */
export interface LineLettering {
    /** The word. */
    word: string;
    /**
     * 'beyond': past both ends, level with the line's extension (FEBA, as Phase Line's "PL").
     * 'aboveEnds': above the line just inside each end, along it (LOA).
     * 'belowMiddle': once, under the middle of the line (FPF).
     */
    place: 'beyond' | 'aboveEnds' | 'belowMiddle';
    /** Ticks square to the line at both ends, on both sides (FPF). */
    endTicks?: boolean;
}

/**
 * Base for 2525D control-measure lines that carry their name as part of the graphic. A straight line through the
 * clicks (DRAW_TYPE 1) or a curve through them (DRAW_TYPE 2, the Bezier through CTRL_PTS that Phase Line uses).
 * The lettering is geometry (StrokeFont), so it scales with the line and draws the same in 2D and 3D; words stay
 * upright whichever way the line was drawn. A subclass gives its identity and its lettering.
 */
export abstract class ____LabelledLineBase extends ____TacticalSymbolBase {
    protected constructor(view: MapView | SceneView, isLine: boolean, config: TacticalSymbolConfig) {
        super(view, isLine, config);
    }

    protected abstract lettering(): LineLettering;

    public init(options: TacticalSymbolOptions, marker: SimpleLineSymbol | SimpleFillSymbol): void {
        this._lineSym = marker;
        this._drawType = GeoTools.setDefault(options, "DRAW_TYPE", this._drawType);
        this.initFromOptions(options);
    }

    public createSymbol(drawEssentials: DrawEssentials): Polyline | null {
        try {
            const pts: Point[] | undefined = (drawEssentials as any).CTRL_PTS;
            if (!pts || pts.length < 2) throw new Error("controlPoints not found");
            const sr = this.view.spatialReference;
            const result = new Polyline({ spatialReference: sr });
            const path: number[][] = ((drawEssentials as any).DRAW_TYPE || 1) === 2 && pts.length > 2
                ? Shapes.CreateBezierPathPCOnly(pts.map((p) => ({ x: p.x, y: p.y })), 100).map((p: any) => [p.x, p.y])
                : pts.map((p) => [p.x, p.y]);
            result.addPath(path);
            this.decorate(result, path, sr);
            return result;
        } catch (e) {
            /* invalid geometry mid-draw is expected; ignore */
            return null;
        }
    }

    private decorate(result: Polyline, path: number[][], sr: any): void {
        let length = 0;
        for (let i = 1; i < path.length; i++) length += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        if (!(length > 0)) return;
        const chord = Math.hypot(path[path.length - 1][0] - path[0][0], path[path.length - 1][1] - path[0][1]);
        const L = this.lettering();
        const add = (strokes: Point[][]) => { for (const s of strokes) if (s.length >= 2) result.addPath(s.map((p) => [p.x, p.y])); };
        /** Angle to write along a direction so the word reads left to right, and the "up" side of that word. */
        const upright = (dir: number) => Math.cos(dir) < 0 ? { ang: dir + Math.PI, up: dir - Math.PI / 2 } : { ang: dir, up: dir + Math.PI / 2 };
        const n = path.length;
        const ends: { tip: number[]; inward: number }[] = [
            { tip: path[0], inward: Math.atan2(path[1][1] - path[0][1], path[1][0] - path[0][0]) },
            { tip: path[n - 1], inward: Math.atan2(path[n - 2][1] - path[n - 1][1], path[n - 2][0] - path[n - 1][0]) },
        ];

        if (L.place === 'beyond') {
            // Phase Line's PL marker size: half letter height = chord / 40
            const dr = Math.max(chord / 40, length / 60);
            const off = dr + wordWidth(L.word, dr) / 2;
            for (const e of ends) {
                const out = e.inward + Math.PI;
                add(wordStrokes(L.word, e.tip[0] + off * Math.cos(out), e.tip[1] + off * Math.sin(out), dr, sr));
            }
        } else if (L.place === 'aboveEnds') {
            // 2525D LOA: the word starts just inside each end, its baseline about one letter height above the line
            const dr = Math.max(chord / 40, length / 60);
            const along = dr * 0.5 + wordWidth(L.word, dr) / 2;
            for (const e of ends) {
                const { ang, up } = upright(e.inward);
                const cx = e.tip[0] + along * Math.cos(e.inward) + dr * 3.2 * Math.cos(up);
                const cy = e.tip[1] + along * Math.sin(e.inward) + dr * 3.2 * Math.sin(up);
                add(wordStrokes(L.word, cx, cy, dr, sr, ang));
            }
        } else {
            // 2525D FPF: the word once, centred under the middle of the line
            const dr = Math.max(chord / 40, length / 24);
            let goal = length / 2, at = path[0], dir = 0;
            for (let i = 1; i < n; i++) {
                const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
                dir = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]);
                if (goal <= seg) { at = [path[i - 1][0] + goal * Math.cos(dir), path[i - 1][1] + goal * Math.sin(dir)]; break; }
                goal -= seg;
            }
            const { ang, up } = upright(dir);
            const off = -dr * 2.4;                                            // below = against the word's up side
            add(wordStrokes(L.word, at[0] + off * Math.cos(up), at[1] + off * Math.sin(up), dr, sr, ang));
            if (L.endTicks) {
                // 2525D FPF: ticks square to the line at both ends, as far each side as the word is tall and a third more
                const half = dr * 2.7;
                for (const e of ends) {
                    const a = e.inward + Math.PI / 2;
                    result.addPath([[e.tip[0] - half * Math.cos(a), e.tip[1] - half * Math.sin(a)], [e.tip[0] + half * Math.cos(a), e.tip[1] + half * Math.sin(a)]]);
                }
            }
        }
    }
}

export default ____LabelledLineBase;
