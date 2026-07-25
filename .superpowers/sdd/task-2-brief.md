### Task 2: Pure arrow path-builder functions (`OverlayFabric.ts`)

**Files:**
- Modify: `MS/Engines/Briefing/OverlayFabric.ts` (add new exports; nothing wired up to drawing yet)

**Interfaces:**
- Produces: `export type ArrowType = 'sharp' | 'curved' | 'elbow'`; `export function buildArrowPath(points: Array<{x,y}>, arrowType: ArrowType): { d: string; endAngleRad: number }`

- [ ] **Step 1: Add the builders**

Insert after the `dashProps` function (after line 77, before `export interface ShapeStyle`):
```ts
export type ArrowType = 'sharp' | 'curved' | 'elbow';

const ELBOW_FILLET_PX = 12;

function pathN(v: number): number {
  return Number(v.toFixed(2));
}

export function buildSharpArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  let d = `M ${pathN(points[0].x)} ${pathN(points[0].y)}`;
  for (let i = 1; i < points.length; i++) d += ` L ${pathN(points[i].x)} ${pathN(points[i].y)}`;
  const p2 = points[points.length - 1];
  const p1 = points[points.length - 2];
  return { d, endAngleRad: Math.atan2(p2.y - p1.y, p2.x - p1.x) };
}

export function buildCurvedArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  let d = `M ${pathN(points[0].x)} ${pathN(points[0].y)}`;
  let lastCp2 = points[0];
  let lastEnd = points[0];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const cp1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const cp2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${pathN(cp1.x)} ${pathN(cp1.y)} ${pathN(cp2.x)} ${pathN(cp2.y)} ${pathN(p2.x)} ${pathN(p2.y)}`;
    lastCp2 = cp2;
    lastEnd = p2;
  }
  return { d, endAngleRad: Math.atan2(lastEnd.y - lastCp2.y, lastEnd.x - lastCp2.x) };
}

export function buildElbowArrowPath(
  points: Array<{ x: number; y: number }>,
): { d: string; endAngleRad: number } {
  if (points.length < 2) return { d: '', endAngleRad: 0 };
  const ortho: Array<{ x: number; y: number }> = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(b.x - a.x) > 0.5 && Math.abs(b.y - a.y) > 0.5) {
      ortho.push({ x: b.x, y: a.y });
    }
    ortho.push(b);
  }
  let d = `M ${pathN(ortho[0].x)} ${pathN(ortho[0].y)}`;
  for (let i = 1; i < ortho.length - 1; i++) {
    const prev = ortho[i - 1];
    const cur = ortho[i];
    const next = ortho[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
    const r = Math.min(ELBOW_FILLET_PX, inLen / 2, outLen / 2);
    const inX = cur.x - ((cur.x - prev.x) / inLen) * r;
    const inY = cur.y - ((cur.y - prev.y) / inLen) * r;
    const outX = cur.x + ((next.x - cur.x) / outLen) * r;
    const outY = cur.y + ((next.y - cur.y) / outLen) * r;
    d += ` L ${pathN(inX)} ${pathN(inY)} Q ${pathN(cur.x)} ${pathN(cur.y)} ${pathN(outX)} ${pathN(outY)}`;
  }
  const last = ortho[ortho.length - 1];
  const secondLast = ortho[ortho.length - 2];
  d += ` L ${pathN(last.x)} ${pathN(last.y)}`;
  return { d, endAngleRad: Math.atan2(last.y - secondLast.y, last.x - secondLast.x) };
}

export function buildArrowPath(
  points: Array<{ x: number; y: number }>,
  arrowType: ArrowType,
): { d: string; endAngleRad: number } {
  if (arrowType === 'curved') return buildCurvedArrowPath(points);
  if (arrowType === 'elbow') return buildElbowArrowPath(points);
  return buildSharpArrowPath(points);
}

if (import.meta.env.DEV) {
  const sharp = buildSharpArrowPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  console.assert(sharp.d === 'M 0 0 L 10 0', `sharp path mismatch: ${sharp.d}`);
  console.assert(Math.abs(sharp.endAngleRad) < 1e-6, `sharp angle mismatch: ${sharp.endAngleRad}`);

  const curved = buildCurvedArrowPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 10 }]);
  console.assert(curved.d.startsWith('M 0 0 C'), `curved path mismatch: ${curved.d}`);

  const elbow = buildElbowArrowPath([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  console.assert(
    elbow.d === 'M 0 0 L 5 0 Q 10 0 10 5 L 10 10',
    `elbow path mismatch: ${elbow.d}`,
  );
}
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/OverlayFabric.ts`
Expected: no new errors.

- [ ] **Step 3: Verify the smoke assertions in the browser**

Have the user run `npm run dev` (or confirm it's already running), open the Briefing editor on any slide (this loads `OverlayFabric.ts`), open the browser devtools console, and confirm there is **no** `Assertion failed` message. If one appears, the printed mismatch shows the actual `d` string — fix the builder before proceeding.

- [ ] **Step 4: Remove the smoke-test block**

Delete the `if (import.meta.env.DEV) { ... }` block added in Step 1 (the three builder functions and `buildArrowPath` stay).

- [ ] **Checkpoint:** three path builders + dispatcher exist and were verified once; smoke-test code removed. Do not commit.

---

