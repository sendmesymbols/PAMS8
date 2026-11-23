/**
 * PlanGroundProbe.ts — the terrain bundle for the Deployment Mgr's Build tab: answers PlanFit's `PlanGround` reads.
 *
 * It is the Movement Guide's bundle reader (MovementGuideProbe: tile cache and worker, sight engine) with an instance
 * of its own, so the Build tab works whether the Movement Guide or Ground Guide is on or off. Approaches come from the
 * pure OCOKA engine's `findAvenue` on the reader's grid round the plan, for tracked vehicles.
 *
 * Nothing is created until `configure()`, and the Build tab only calls it while `features.planBuilder` and
 * `planBuilder.useTerrain` are on (claude_rules.md: a switched-off feature never looks for the bundle). A missing
 * bundle is one log line and the tab stays in geometry mode.
 */
import { MovementGuideProbe } from '../MovementGuide/MovementGuideProbe';
import { findAvenue, avenueMask, avenueOverlap, pxToMerc, type OcokaGrid } from '../GroundGuide/GroundGuideOcoka';
import type { GroundAvenue, PlanGround } from './PlanFit';
import type { SmallProbe } from './PlanSmallOps';
import type { XY } from './PlanSolve';

const ORIGIN = Math.PI * 6378137;

export class PlanGroundProbe implements PlanGround {
  private _probe: MovementGuideProbe;
  private _ready = false;
  private _pending = false;
  private _avCache = new Map<string, GroundAvenue[] | null>();

  constructor(onChange: () => void) {
    this._probe = new MovementGuideProbe(() => { this._avCache.clear(); onChange(); });
  }

  get ready(): boolean { return this._ready; }

  /** Open the bundle. Resolves false (and keeps nothing) when it is not there. */
  async configure(base: string, opts: { cacheTiles: number; useWorker: boolean }): Promise<boolean> {
    this._ready = false;
    try {
      this._ready = await this._probe.configure(base, opts);
    } catch {
      this._ready = false;
    }
    return this._ready;
  }

  destroy(): void {
    this._ready = false;
    this._avCache.clear();
    this._probe.destroy();
  }

  /** Start a read: pending flags collected from here on. */
  begin(): void { this._probe.takePending(); this._pending = false; }
  pending(): boolean { this._pending = this._pending || this._probe.takePending(); return this._pending; }

  cls(x: number, y: number): number | null { return this._ready ? this._probe.cls(x, y) : null; }
  elev(x: number, y: number): number { return this._ready ? this._probe.elev(x, y) : NaN; }
  label(c: number): string { return this._probe.classLabel(c); }
  dataLine(): string { return this._probe.dataLine(); }

  going(profile: 'dismounted' | 'tracked' | 'gun') {
    // a profile the bundle's rules lack is read as the nearest it has (a gun is towed or tracked: the tracked going; tracked
    // falls back to foot), never as all GO
    const P = (this._probe.rules as any)?.profiles ?? {};
    const p = P[profile] ?? (profile === 'gun' ? P.tracked : undefined) ?? (profile !== 'dismounted' ? P.dismounted : undefined) ?? {};
    return { nogo: new Set<number>(p.nogo ?? []), caution: new Set<number>(p.caution ?? []) };
  }

  /** The Movement Guide reader itself, for the ambush, patrol and recce (PlanSmallOps): its roads, features, raster reads. */
  mov(): SmallProbe | null { return this._ready ? (this._probe as unknown as SmallProbe) : null; }

  sight(ox: number, oy: number, eyeM: number, tx: number, ty: number, targetM: number): number | null {
    return this._ready ? this._probe.sight(ox, oy, eyeM, tx, ty, targetM) : null;
  }

  /** Up to three least-cost approaches for the mover from `from` to `to` (each further one kept only if it is a different way). */
  avenues(from: XY, to: XY, frontageM: number, profile: 'dismounted' | 'tracked' = 'tracked'): GroundAvenue[] | null {
    if (!this._ready) return null;
    const key = `${Math.round(from.x / 200)}|${Math.round(from.y / 200)}|${Math.round(to.x / 200)}|${Math.round(to.y / 200)}|${frontageM}|${profile}`;
    if (this._avCache.has(key)) return this._avCache.get(key)!;
    const g = this._probe.gridAt(to.x, to.y);
    if (!g) return null;
    if (g.pending) { this._pending = true; return null; }
    const world = (2 * ORIGIN) / (g.ts * 2 ** g.z);
    const gx = (x: number) => (x + ORIGIN) / world - g.px0;
    const gy = (y: number) => (ORIGIN - y) / world - g.py0;
    let sx = gx(from.x), sy = gy(from.y);
    const tx = gx(to.x), ty = gy(to.y);
    // a start beyond the grid is drawn in along the line until it is inside (the grid is about 25 km across)
    const inside = (x: number, y: number) => x >= 2 && y >= 2 && x < g.w - 2 && y < g.h - 2;
    for (let t = 0; t < 1 && !inside(sx, sy); t += 0.02) { sx = gx(from.x + (to.x - from.x) * t); sy = gy(from.y + (to.y - from.y) * t); }
    if (!inside(sx, sy) || !inside(tx, ty)) { this._avCache.set(key, []); return []; }
    const rules: any = this._probe.rules ?? {};
    const prof = rules.profiles?.[profile] ?? {};
    const going = { nogo: new Uint8Array(256), caution: new Uint8Array(256) };
    for (const c of prof.nogo ?? []) going.nogo[c] = 1;
    for (const c of prof.caution ?? []) going.caution[c] = 1;
    const o = { going, frontageM };
    const first = findAvenue(g, sx, sy, tx, ty, o);
    const out: GroundAvenue[] = [];
    if (first.reached) {
      out.push(this._toGround(g, first));
      const mask = avenueMask(g, first, Math.max(frontageM, 250) / g.res);
      const second = findAvenue(g, sx, sy, tx, ty, { ...o, avoid: mask, avoidCost: 4 });
      if (second.reached && avenueOverlap(g, second, mask) < 0.6 && second.cost <= 2.2 * first.cost) {
        out.push(this._toGround(g, second));
        // a third, away from both: a wide front can have three (the case for three up)
        const mask2 = avenueMask(g, second, Math.max(frontageM, 250) / g.res);
        for (let i = 0; i < mask.length; i++) mask2[i] = mask2[i] | mask[i];
        const third = findAvenue(g, sx, sy, tx, ty, { ...o, avoid: mask2, avoidCost: 4 });
        if (third.reached && avenueOverlap(g, third, mask2) < 0.6 && third.cost <= 2.5 * first.cost) out.push(this._toGround(g, third));
      }
    }
    this._avCache.set(key, out);
    while (this._avCache.size > 20) this._avCache.delete(this._avCache.keys().next().value as string);
    return out;
  }

  private _toGround(g: OcokaGrid, a: ReturnType<typeof findAvenue>): GroundAvenue {
    const path: XY[] = [];
    const n = a.path.length / 2;
    for (let k = 0; k < n; k++) {
      if (k % 2 && k !== n - 1) continue;
      const [x, y] = pxToMerc(a.path[k * 2] + g.px0, a.path[k * 2 + 1] + g.py0, g.z, g.ts);
      path.push({ x, y });
    }
    const crossing = /bridge|ford|ferry|crossing/i;
    return {
      path, lengthM: a.lengthM, goPct: a.goPct, minWidthM: a.minWidthM,
      chokes: a.chokes.map((c) => {
        const [x, y] = pxToMerc(c.x + g.px0, c.y + g.py0, g.z, g.ts);
        const own = this.label(c.cellClass);
        return { at: { x, y }, widthM: c.widthM, label: crossing.test(own) ? own : c.nogoClass ? `Gap in ${this.label(c.nogoClass)}` : 'Narrow Gr' };
      }),
    };
  }
}

export default PlanGroundProbe;
