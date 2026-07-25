### Task 1: Data model — `arrowType` field

**Files:**
- Modify: `MS/Engines/Briefing/BriefingTypes.ts:73-84`

**Interfaces:**
- Produces: `SlideOverlay.arrowType?: 'sharp' | 'curved' | 'elbow'`

- [ ] **Step 1: Add the field and update the `points` doc comment**

Replace:
```ts
  /** line/arrow: [start, end]; freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
```
with:
```ts
  /** line: [start, end]; arrow: 2+ points (bend points in between); freehand: sampled polyline. Normalized. */
  points?: Array<{ x: number; y: number }>;
```
and immediately after the `strokeDash` field (currently `strokeDash?: 'dashed' | 'dotted';`) add:
```ts
  /** arrow only. Absent = 'sharp' (today's straight 2-point look). */
  arrowType?: 'sharp' | 'curved' | 'elbow';
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit MS/Engines/Briefing/BriefingTypes.ts` (per this repo's tsc-baseline note, `npx tsc` is a stub — use the binary directly)
Expected: no new errors referencing `BriefingTypes.ts`.

- [ ] **Checkpoint:** field exists, no compile errors. Do not commit.

---

