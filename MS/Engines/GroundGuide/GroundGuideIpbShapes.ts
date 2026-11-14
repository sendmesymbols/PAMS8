/**
 * GroundGuideIpbShapes.ts
 *
 * The IPB coding (GroundGuideIpb.ts) as outlines, for Create on Map (IPB_Plan.md §6.8, Phase 3): each NO-GO or SLOW-GO
 * patch of the area read becomes one ring that the No Go Area (25120203) or Slow Go Area (25120202) symbol is drawn on.
 * Pure: no DOM, no view, no I/O, so it runs in Node (`node tools/ipb-test/shapes.mjs`).
 *
 *   1. The class's cells inside the frame (the area read); bridges and fords are passages, never SLOW-GO areas.
 *   2. Patches a cell apart are joined (closing: one cell out, one cell in), so a village broken by a lane is one area.
 *   3. 8-connected patches smaller than `minAreaM2` are left out (too small for the level read), the rest are kept
 *      largest first up to `maxAreas`.
 *   4. Each patch's outer boundary is traced along the cell edges (where two cells only touch at a corner, they stay one
 *      patch) and simplified (Douglas-Peucker, `tolM`, raised until it has at most `maxVerts` corners). Holes (an island
 *      of GO in a lake) are not drawn: the outline is the patch's outer edge.
 */

import { IPB, WHY, type IpbCoding } from './GroundGuideIpb';
import { simplifyLine, type IpbFrame } from './GroundGuideIpbCorridors';

export interface IpbArea {
  /** Outline, coding cells (corners of cells), not closed, clockwise on screen (y down). */
  ring: Array<[number, number]>;
  areaM2: number;
  /** The criteria that coded its cells (WHY bits, OR'ed). */
  why: number;
}

export interface IpbAreaOpts {
  cls: 'nogo' | 'slow';
  /** Only cells inside this frame (the area read); the whole coding when left out. */
  frame?: IpbFrame;
  minAreaM2: number;
  /** Simplification tolerance, metres (default 0.8 of a cell). */
  tolM?: number;
  maxAreas?: number;
  maxVerts?: number;
}

/** Douglas-Peucker on a closed ring (not repeated at the end): split at the corner farthest from the first. */
export function simplifyRing(ring: Array<[number, number]>, tol: number): Array<[number, number]> {
  const n = ring.length;
  if (n <= 4) return ring.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > fd) ((fd = d), (far = i));
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/** The NO-GO (or SLOW-GO) patches of a coding as outlines. */
export function ipbAreas(c: IpbCoding, o: IpbAreaOpts): IpbArea[] {
  const { w, h, res } = c;
  const want = o.cls === 'nogo' ? IPB.NOGO : IPB.SLOW;
  // 1. The class's cells inside the frame.
  let inFrame: ((x: number, y: number) => boolean) | null = null;
  if (o.frame) {
    const f = o.frame;
    const th = (f.axisDeg * Math.PI) / 180;
    const Fx = Math.sin(th), Fy = -Math.cos(th), Rx = Math.cos(th), Ry = Math.sin(th);
    inFrame = (x, y) => {
      const dx = (x + 0.5 - f.sx) * res, dy = (y + 0.5 - f.sy) * res;
      const a = dx * Fx + dy * Fy, q = dx * Rx + dy * Ry;
      return a >= 0 && a <= f.lengthM && Math.abs(q) <= f.widthM / 2;
    };
  }
  let m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = y * w + x;
      if (c.code[q] !== want || (c.why[q] & WHY.CROSSING) !== 0) continue;
      if (inFrame && !inFrame(x, y)) continue;
      m[q] = 1;
    }
  // 2. Closing: one cell out, then one cell in (8 neighbours), kept inside the frame.
  const grow = (src: Uint8Array, val: number): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++)
          for (let dx = -1; dx <= 1 && !hit; dx++) {
            const xx = x + dx, yy = y + dy;
            const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx];
            if (v === val) hit = true;
          }
        out[y * w + x] = val === 1 ? (hit ? 1 : 0) : hit ? 0 : 1;
      }
    return out;
  };
  const closed = grow(grow(m, 1), 0);
  for (let q = 0; q < w * h; q++) if (closed[q] && !m[q] && (!inFrame || inFrame(q % w, Math.floor(q / w)))) m[q] = 1;
  // 3. 8-connected patches, large enough.
  const comp = new Int32Array(w * h).fill(-1);
  const patches: Array<{ cells: number[]; why: number }> = [];
  const minCells = Math.max(1, Math.ceil(o.minAreaM2 / (res * res)));
  const stack: number[] = [];
  for (let q0 = 0; q0 < w * h; q0++) {
    if (!m[q0] || comp[q0] >= 0) continue;
    const id = patches.length;
    const cells: number[] = [];
    let why = 0;
    comp[q0] = id;
    stack.push(q0);
    while (stack.length) {
      const q = stack.pop()!;
      cells.push(q);
      why |= c.why[q];
      const x = q % w, y = (q - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const qq = yy * w + xx;
          if (m[qq] && comp[qq] < 0) {
            comp[qq] = id;
            stack.push(qq);
          }
        }
    }
    patches.push({ cells: cells.length >= minCells ? cells : [], why });
  }
  const kept = patches.map((p, id) => ({ ...p, id })).filter((p) => p.cells.length).sort((a, b) => b.cells.length - a.cells.length).slice(0, o.maxAreas ?? 120);
  // 4. Outer boundary of each patch along cell edges, simplified.
  const tol0 = (o.tolM ?? 0.8 * res) / res;
  const maxVerts = o.maxVerts ?? 80;
  const out: IpbArea[] = [];
  for (const p of kept) {
    const inP = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && comp[y * w + x] === p.id;
    // Directed edges, interior on the right (clockwise on screen, y down); keyed by their start corner.
    const edges = new Map<number, number[]>();
    const W1 = w + 1;
    const add = (x0: number, y0: number, x1: number, y1: number): void => {
      const k = y0 * W1 + x0;
      const list = edges.get(k);
      const e = y1 * W1 + x1;
      if (list) list.push(e);
      else edges.set(k, [e]);
    };
    for (const q of p.cells) {
      const x = q % w, y = (q - x) / w;
      if (!inP(x, y - 1)) add(x, y, x + 1, y);
      if (!inP(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inP(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inP(x - 1, y)) add(x, y + 1, x, y);
    }
    // Follow them into rings; at a corner where two ways leave, turn left first (cells touching at a corner stay one).
    let best: Array<[number, number]> | null = null, bestA = 0;
    for (;;) {
      let startK = -1;
      for (const [k, list] of edges) if (list.length) {
        startK = k;
        break;
      }
      if (startK < 0) break;
      const ring: Array<[number, number]> = [];
      let cur = startK;
      let nxt = edges.get(cur)!.pop()!;
      let dx = (nxt % W1) - (cur % W1), dy = Math.floor(nxt / W1) - Math.floor(cur / W1);
      ring.push([cur % W1, Math.floor(cur / W1)]);
      for (let guard = 0; guard < 4 * p.cells.length + 8; guard++) {
        cur = nxt;
        if (cur === startK) break;
        ring.push([cur % W1, Math.floor(cur / W1)]);
        const list = edges.get(cur);
        if (!list || !list.length) break;
        let pick = 0;
        if (list.length > 1) {
          const rank = (e: number): number => {
            const ex = (e % W1) - (cur % W1), ey = Math.floor(e / W1) - Math.floor(cur / W1);
            if (ex === dy && ey === -dx) return 0; // left
            if (ex === dx && ey === dy) return 1; // straight
            return 2; // right
          };
          let br = 9;
          list.forEach((e, i) => {
            const r = rank(e);
            if (r < br) ((br = r), (pick = i));
          });
        }
        nxt = list.splice(pick, 1)[0];
        dx = (nxt % W1) - (cur % W1);
        dy = Math.floor(nxt / W1) - Math.floor(cur / W1);
      }
      let a2 = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
        a2 += x0 * y1 - x1 * y0;
      }
      if (Math.abs(a2) > bestA) ((bestA = Math.abs(a2)), (best = ring));
    }
    if (!best || best.length < 4) continue;
    let tol = tol0;
    let simp = simplifyRing(best, tol);
    while (simp.length > maxVerts && tol < 50) {
      tol *= 1.5;
      simp = simplifyRing(best, tol);
    }
    if (simp.length < 3) continue;
    out.push({ ring: simp, areaM2: p.cells.length * res * res, why: p.why });
  }
  return out;
}
