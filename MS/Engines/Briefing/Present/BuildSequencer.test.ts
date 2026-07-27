/**
 * BuildSequencer.test.ts — run with: node MS/Engines/Briefing/Present/BuildSequencer.test.ts
 * House style follows MS/Engines/Briefing/SlideCommentUtils.test.ts: plain
 * console assertions, non-zero exit on failure. No test framework in this repo.
 */
import { buildModeOf, buildTargetIds, groupSteps, revealedIds } from './BuildSequencer.ts';
import type { BuildStep, BuildTrigger, Slide } from '../BriefingTypes.ts';

let passed = 0;
let failed = 0;

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

const step = (
  graphicId: string,
  delayMs: number,
  durationMs: number,
  trigger?: BuildTrigger,
): BuildStep => ({ graphicId, effect: 'appear', delayMs, durationMs, trigger });

const slide = (builds: BuildStep[], buildMode?: 'auto' | 'click'): Slide =>
  ({
    id: 's',
    title: 'S',
    view: { capturedIn: '2d' },
    visibleLayers: {},
    transitionMs: 1000,
    builds,
    buildMode,
  }) as Slide;

/** Compact shape for comparisons: [[ [id, at], … ], …] plus each group's length. */
const shape = (slideIn: Slide) =>
  groupSteps(slideIn).map((g) => ({
    steps: g.steps.map((s) => [s.step.graphicId, s.at]),
    durationMs: g.durationMs,
  }));

console.log('buildModeOf');
check('absent → auto', buildModeOf(slide([])), 'auto');
check('explicit auto', buildModeOf(slide([], 'auto')), 'auto');
check('explicit click', buildModeOf(slide([], 'click')), 'click');
check('null slide → auto', buildModeOf(null), 'auto');

console.log('groupSteps — empty');
check('no builds', groupSteps(slide([])), []);
check('undefined slide', groupSteps(undefined), []);

console.log('groupSteps — auto mode keeps one absolute-delay group');
check(
  'three staggered steps collapse to one group',
  shape(slide([step('a', 0, 500), step('b', 300, 500), step('c', 900, 200)])),
  [
    {
      steps: [
        ['a', 0],
        ['b', 300],
        ['c', 900],
      ],
      durationMs: 1100,
    },
  ],
);
check(
  'auto mode ignores triggers entirely',
  shape(
    slide([step('a', 0, 100, 'click'), step('b', 250, 100, 'click'), step('c', 400, 100, 'click')]),
  ),
  [
    {
      steps: [
        ['a', 0],
        ['b', 250],
        ['c', 400],
      ],
      durationMs: 500,
    },
  ],
);

console.log('groupSteps — click mode');
check(
  'absent trigger means one group per step',
  shape(slide([step('a', 0, 300), step('b', 0, 300), step('c', 0, 300)], 'click')),
  [
    { steps: [['a', 0]], durationMs: 300 },
    { steps: [['b', 0]], durationMs: 300 },
    { steps: [['c', 0]], durationMs: 300 },
  ],
);
check(
  'withPrev rides along at its own delay',
  shape(
    slide([step('a', 0, 400), step('b', 100, 400, 'withPrev'), step('c', 0, 200, 'click')], 'click'),
  ),
  [
    {
      steps: [
        ['a', 0],
        ['b', 100],
      ],
      durationMs: 500,
    },
    { steps: [['c', 0]], durationMs: 200 },
  ],
);
check(
  'afterPrev chains off the previous step end',
  shape(
    slide(
      [step('a', 0, 400), step('b', 50, 300, 'afterPrev'), step('c', 0, 100, 'afterPrev')],
      'click',
    ),
  ),
  [
    {
      steps: [
        ['a', 0],
        ['b', 450], // 0 + 400 end, + 50 delay
        ['c', 750], // 450 + 300 end, + 0 delay
      ],
      durationMs: 850,
    },
  ],
);
check(
  'a leading withPrev still opens the first group',
  shape(slide([step('a', 0, 200, 'withPrev'), step('b', 0, 200, 'click')], 'click')),
  [
    { steps: [['a', 0]], durationMs: 200 },
    { steps: [['b', 0]], durationMs: 200 },
  ],
);
check(
  'a new click group resets the afterPrev clock',
  shape(
    slide(
      [step('a', 0, 900), step('b', 0, 100, 'click'), step('c', 0, 100, 'afterPrev')],
      'click',
    ),
  ),
  [
    { steps: [['a', 0]], durationMs: 900 },
    {
      steps: [
        ['b', 0],
        ['c', 100], // chains off b, NOT off a's 900ms end
      ],
      durationMs: 200,
    },
  ],
);
check(
  'negative delay/duration clamp to zero',
  shape(slide([step('a', -50, -10)], 'click')),
  [{ steps: [['a', 0]], durationMs: 0 }],
);

console.log('buildTargetIds');
check(
  'dedupes repeated targets',
  buildTargetIds(slide([step('a', 0, 0), step('b', 0, 0), step('a', 0, 0)])),
  ['a', 'b'],
);
check('no builds', buildTargetIds(slide([])), []);
check('undefined slide', buildTargetIds(undefined), []);

console.log('revealedIds');
{
  const groups = groupSteps(
    slide([step('a', 0, 100), step('b', 0, 100, 'withPrev'), step('c', 0, 100, 'click')], 'click'),
  );
  check('zero groups revealed', [...revealedIds(groups, 0)], []);
  check('first group revealed', [...revealedIds(groups, 1)], ['a', 'b']);
  check('all revealed', [...revealedIds(groups, 2)], ['a', 'b', 'c']);
  check('past the end clamps', [...revealedIds(groups, 99)], ['a', 'b', 'c']);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
