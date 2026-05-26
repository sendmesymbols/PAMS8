import Graphic from "@arcgis/core/Graphic";
export interface PriorityComponents {
    echelon: number;
    identity: number;
    manual: number;
    recency: number;
    total: number;
}
/** Compute every component — useful for debugging and UI badges. */
export declare function scoreGraphic(g: Graphic, now?: number): PriorityComponents;
/** Total score only — preferred hot-path entry point. */
export declare function priorityOf(g: Graphic, now?: number): number;
/** Highest possible total (Command × hostile + reasonable manual). For normalization. */
export declare const PRIORITY_MAX: number;
