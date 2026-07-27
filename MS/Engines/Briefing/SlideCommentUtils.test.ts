/**
 * SlideCommentUtils.test.ts — run with: node MS/Engines/Briefing/SlideCommentUtils.test.ts
 * House style follows MS/Engines/ImportExport/Plan.test.ts: plain console
 * assertions, non-zero exit on failure. No test framework in this repo.
 */
import {
  commentUuid,
  openCount,
  projectAnchor,
  pruneComments,
  relTime,
  threadCount,
} from './SlideCommentUtils.ts';
import type { SlideComment } from './BriefingTypes.ts';

let passed = 0;
let failed = 0;
/** Fixed timestamp — nothing here may depend on the wall clock. */
const t = '2026-07-26T12:00:00.000Z';

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}

console.log('projectAnchor');
// Identity viewport: normalized × canvas size, nothing else.
check(
  'identity vpt',
  projectAnchor(0.5, 0.25, { w: 800, h: 400 }, [1, 0, 0, 1, 0, 0]),
  { left: 400, top: 100 },
);
// 2× zoom about the origin doubles both axes.
check(
  '2x zoom',
  projectAnchor(0.5, 0.5, { w: 800, h: 400 }, [2, 0, 0, 2, 0, 0]),
  { left: 800, top: 400 },
);
// Pan translates after scaling.
check(
  'zoom + pan',
  projectAnchor(0.5, 0.5, { w: 800, h: 400 }, [2, 0, 0, 2, -100, -50]),
  { left: 700, top: 350 },
);
// A missing/short transform must not produce NaN.
check(
  'missing vpt falls back to identity',
  projectAnchor(0.25, 0.5, { w: 800, h: 400 }, []),
  { left: 200, top: 200 },
);

console.log('relTime');
const t0 = Date.parse('2026-07-26T12:00:00.000Z');
check('under 45s', relTime('2026-07-26T11:59:30.000Z', t0), 'just now');
check('minutes', relTime('2026-07-26T11:30:00.000Z', t0), '30m ago');
check('hours', relTime('2026-07-26T09:00:00.000Z', t0), '3h ago');
check('days', relTime('2026-07-24T12:00:00.000Z', t0), '2d ago');
check('unparseable', relTime('not-a-date', t0), 'just now');

console.log('pruneComments');
const comments: SlideComment[] = [
  { id: 'c1', author: 'A', text: 'on live overlay', at: t, overlayId: 'ov-live' },
  { id: 'c2', author: 'A', text: 'on dead overlay', at: t, overlayId: 'ov-gone' },
  { id: 'c3', author: 'A', text: 'point', at: t, x: 0.5, y: 0.5 },
  { id: 'c4', author: 'A', text: 'slide', at: t },
];
const pruned = pruneComments(comments, new Set(['ov-live']));
check('live overlay anchor kept', pruned[0].overlayId, 'ov-live');
check('dead overlay anchor dropped', pruned[1].overlayId, undefined);
check('dead overlay thread survives as slide-level', pruned[1].text, 'on dead overlay');
check('point anchor untouched', [pruned[2].x, pruned[2].y], [0.5, 0.5]);
check('nothing removed', pruned.length, 4);
check('input not mutated', comments[1].overlayId, 'ov-gone');

console.log('threadCount / openCount');
check('opener only', threadCount({ id: 'x', author: 'A', text: 't', at: t }), 1);
check(
  'opener + 2 replies',
  threadCount({
    id: 'x',
    author: 'A',
    text: 't',
    at: t,
    replies: [
      { id: 'r1', author: 'B', text: 'r', at: t },
      { id: 'r2', author: 'B', text: 'r', at: t },
    ],
  }),
  3,
);
check('openCount ignores resolved', openCount([
  { id: 'a', author: 'A', text: 't', at: t },
  { id: 'b', author: 'A', text: 't', at: t, resolved: true },
]), 1);
check('openCount of undefined', openCount(undefined), 0);

console.log('commentUuid');
check('uuid shape', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(commentUuid()), true);
check('uuids differ', commentUuid() === commentUuid(), false);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
