/**
 * SlideLinks.test.ts — run with: node MS/Engines/Briefing/SlideLinks.test.ts
 * House style follows SlideCommentUtils.test.ts: plain console assertions,
 * non-zero exit on failure. No test framework in this repo.
 */
import {
  isSafeLinkUrl,
  isUsableLink,
  jumpFromPptAction,
  normalizeLinkUrl,
  linkAtPoint,
  linkLabel,
  linkTooltip,
  normalizeLink,
  PPT_JUMP_ACTIONS,
  pruneLinks,
  resolveJumpForExport,
  resolveLink,
} from './SlideLinks.ts';
import type { Slide, SlideOverlay } from './BriefingTypes.ts';

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

/** A 4-slide briefing: s0 … s3. */
const slide = (id: string, title: string): Slide =>
  ({ id, title, view: { capturedIn: '2d' }, visibleLayers: {}, transitionMs: 0 }) as Slide;
const deck: Slide[] = [
  slide('s0', 'Situation'),
  slide('s1', 'Mission'),
  slide('s2', ''),
  slide('s3', 'Sustainment'),
];

console.log('isUsableLink');
check('slide target', isUsableLink({ slideId: 's1' }), true);
check('jump target', isUsableLink({ jump: 'next' }), true);
check('neither', isUsableLink({ tooltip: 'x' }), false);
check('undefined', isUsableLink(undefined), false);

console.log('resolveLink — fixed slide');
check('hits its slide', resolveLink({ slideId: 's2' }, deck, 0), { index: 2 });
check('index is independent of current', resolveLink({ slideId: 's0' }, deck, 3), { index: 0 });
check('missing slide → null', resolveLink({ slideId: 'gone' }, deck, 0), null);
check('empty deck → null', resolveLink({ slideId: 's0' }, [], 0), null);

console.log('resolveLink — relative jumps');
check('next', resolveLink({ jump: 'next' }, deck, 1), { index: 2 });
check('next off the end → null', resolveLink({ jump: 'next' }, deck, 3), null);
check('prev', resolveLink({ jump: 'prev' }, deck, 1), { index: 0 });
check('prev off the front → null', resolveLink({ jump: 'prev' }, deck, 0), null);
check('first', resolveLink({ jump: 'first' }, deck, 2), { index: 0 });
check('last', resolveLink({ jump: 'last' }, deck, 0), { index: 3 });
check('endShow', resolveLink({ jump: 'endShow' }, deck, 0), 'endShow');

console.log('resolveLink — lastViewed');
check('with history', resolveLink({ jump: 'lastViewed' }, deck, 3, 1), { index: 1 });
check('no history → null', resolveLink({ jump: 'lastViewed' }, deck, 3, null), null);
check('history out of range → null', resolveLink({ jump: 'lastViewed' }, deck, 0, 9), null);
// 0 is a legitimate history index and must not be read as "no history".
check('history index 0', resolveLink({ jump: 'lastViewed' }, deck, 2, 0), { index: 0 });

console.log('resolveJumpForExport');
check('next resolves', resolveJumpForExport({ jump: 'next' }, 4, 1), 2);
check('prev resolves', resolveJumpForExport({ jump: 'prev' }, 4, 1), 0);
check('first resolves', resolveJumpForExport({ jump: 'first' }, 4, 2), 0);
check('last resolves', resolveJumpForExport({ jump: 'last' }, 4, 0), 3);
check('next off the end → null', resolveJumpForExport({ jump: 'next' }, 4, 3), null);
check('lastViewed has no fixed form', resolveJumpForExport({ jump: 'lastViewed' }, 4, 1), null);
check('endShow has no fixed form', resolveJumpForExport({ jump: 'endShow' }, 4, 1), null);
check('a fixed link is not a jump', resolveJumpForExport({ slideId: 's1' }, 4, 1), null);

// ── Hidden slides ──
// A relative jump must land where PLAYBACK lands, so hidden slides are stepped
// over — otherwise a "Next slide" link drops the briefer onto a slide the deck
// deliberately skips. A fixed link still hits its target: pointing a link AT a
// hidden slide is a deliberate act.
const hiddenDeck: Slide[] = [
  slide('h0', 'Situation'),
  { ...slide('h1', 'Skipped'), hidden: true },
  { ...slide('h2', 'Also skipped'), hidden: true },
  slide('h3', 'Sustainment'),
];
const isHidden = (i: number): boolean => !!hiddenDeck[i]?.hidden;

console.log('resolveLink — hidden slides');
check('next steps over a RUN of hidden', resolveLink({ jump: 'next' }, hiddenDeck, 0), { index: 3 });
check('prev steps over a run of hidden', resolveLink({ jump: 'prev' }, hiddenDeck, 3), { index: 0 });
check('next from inside a hidden run', resolveLink({ jump: 'next' }, hiddenDeck, 1), { index: 3 });
check('prev from inside a hidden run', resolveLink({ jump: 'prev' }, hiddenDeck, 2), { index: 0 });
check(
  'first skips a hidden opener',
  resolveLink({ jump: 'first' }, [{ ...slide('x', 'x'), hidden: true }, slide('y', 'y')], 1),
  { index: 1 },
);
check(
  'last skips a hidden closer',
  resolveLink({ jump: 'last' }, [slide('y', 'y'), { ...slide('x', 'x'), hidden: true }], 0),
  { index: 0 },
);
check(
  'all hidden → null',
  resolveLink({ jump: 'next' }, [{ ...slide('x', 'x'), hidden: true }], 0),
  null,
);
check('a fixed link still reaches a hidden slide', resolveLink({ slideId: 'h1' }, hiddenDeck, 0), {
  index: 1,
});
// lastViewed names a slide the briefer demonstrably DID view — hidden or not.
check('lastViewed is exempt', resolveLink({ jump: 'lastViewed' }, hiddenDeck, 3, 1), { index: 1 });

console.log('resolveJumpForExport — hidden slides');
check('next skips hidden', resolveJumpForExport({ jump: 'next' }, 4, 0, isHidden), 3);
check('last skips hidden', resolveJumpForExport({ jump: 'last' }, 3, 0, isHidden), 0);
check('no predicate = nothing hidden', resolveJumpForExport({ jump: 'next' }, 4, 0), 1);

console.log('jumpFromPptAction — round-trips with PPT_JUMP_ACTIONS');
for (const [jump, token] of Object.entries(PPT_JUMP_ACTIONS)) {
  check(`${jump} ↔ ${token}`, jumpFromPptAction(`ppaction://hlinkshowjump?jump=${token}`), jump);
}
check('case-insensitive', jumpFromPptAction('ppaction://hlinkshowjump?jump=NextSlide'), 'next');
check('slide jump is not a show jump', jumpFromPptAction('ppaction://hlinksldjump'), null);
check('unknown token', jumpFromPptAction('ppaction://hlinkshowjump?jump=sideways'), null);
check('null action', jumpFromPptAction(null), null);

console.log('normalizeLink');
check('slide target kept', normalizeLink({ slideId: 's1' }), { slideId: 's1' });
check('tooltip trimmed', normalizeLink({ jump: 'next', tooltip: '  Go  ' }), {
  jump: 'next',
  tooltip: 'Go',
});
check('blank tooltip dropped', normalizeLink({ jump: 'next', tooltip: '   ' }), { jump: 'next' });
check('slideId wins over jump', normalizeLink({ slideId: 's1', jump: 'next' }), { slideId: 's1' });
check('unknown jump rejected', normalizeLink({ jump: 'sideways' }), null);
check('no target rejected', normalizeLink({ tooltip: 'x' }), null);
check('non-object rejected', normalizeLink('s1'), null);
check('extra fields stripped', normalizeLink({ slideId: 's1', evil: 1 }), { slideId: 's1' });
check(
  'unknown slide id rejected when a set is supplied',
  normalizeLink({ slideId: 'gone' }, new Set(['s0'])),
  null,
);

console.log('linkLabel / linkTooltip');
check('numbered title', linkLabel({ slideId: 's1' }, deck), '2. Mission');
check('untitled slide', linkLabel({ slideId: 's2' }, deck), '3. Untitled');
check('jump label', linkLabel({ jump: 'lastViewed' }, deck), 'Last slide viewed');
check('dangling', linkLabel({ slideId: 'gone' }, deck), 'Missing slide');
check('no link', linkLabel(undefined, deck), 'No link');
check('tooltip prefers the author text', linkTooltip({ slideId: 's1', tooltip: 'Back' }, deck), 'Back');
check('tooltip falls back to the target', linkTooltip({ slideId: 's1' }, deck), '2. Mission');

console.log('pruneLinks');
const ov = (id: string, link: unknown): SlideOverlay =>
  ({ id, kind: 'rect', x: 0, y: 0, w: 0.1, h: 0.1, link }) as SlideOverlay;
const pruneDeck: Slide[] = [
  { ...slide('s0', 'A'), overlays: [ov('o1', { slideId: 's1' }), ov('o2', { slideId: 'gone' })] },
  { ...slide('s1', 'B'), overlays: [ov('o3', { jump: 'next' }), ov('o4', { tooltip: 'x' })] },
];
check('dropped count', pruneLinks(pruneDeck), 2);
check('live target kept', pruneDeck[0].overlays![0].link, { slideId: 's1' });
check('dangling target removed', 'link' in pruneDeck[0].overlays![1], false);
check('jump kept', pruneDeck[1].overlays![0].link, { jump: 'next' });
check('targetless removed', 'link' in pruneDeck[1].overlays![1], false);
check('overlays themselves survive', [pruneDeck[0].overlays!.length, pruneDeck[1].overlays!.length], [2, 2]);

console.log('linkAtPoint');
const hitOverlays: SlideOverlay[] = [
  { id: 'under', kind: 'rect', x: 0.1, y: 0.1, w: 0.4, h: 0.4, link: { slideId: 's1' } } as SlideOverlay,
  { id: 'over', kind: 'rect', x: 0.2, y: 0.2, w: 0.4, h: 0.4, link: { jump: 'next' } } as SlideOverlay,
  { id: 'plain', kind: 'rect', x: 0.7, y: 0.7, w: 0.2, h: 0.2 } as SlideOverlay,
];
check('inside one box', linkAtPoint(hitOverlays, 0.15, 0.15)?.id, 'under');
// Paint order: the LAST overlay is on top, so an overlap resolves to it.
check('overlap picks the topmost', linkAtPoint(hitOverlays, 0.3, 0.3)?.id, 'over');
check('unlinked overlay is not a target', linkAtPoint(hitOverlays, 0.75, 0.75), null);
check('outside everything', linkAtPoint(hitOverlays, 0.95, 0.05), null);
check('on the edge counts', linkAtPoint(hitOverlays, 0.1, 0.1)?.id, 'under');
check('no overlays', linkAtPoint(undefined, 0.5, 0.5), null);
// A box dragged right-to-left persists a negative w/h; the hit test must cope.
const flipped: SlideOverlay[] = [
  { id: 'neg', kind: 'rect', x: 0.5, y: 0.5, w: -0.2, h: -0.2, link: { jump: 'first' } } as SlideOverlay,
];
check('negative extents normalize', linkAtPoint(flipped, 0.4, 0.4)?.id, 'neg');

console.log('external URL links');
check('http is usable', isUsableLink({ url: 'https://example.com' }), true);
check('resolves to a url', resolveLink({ url: 'https://example.com/a' }, deck, 0), {
  url: 'https://example.com/a',
});
// An external link means the same thing in a deck of none — it needs no slide.
check('resolves with an empty deck', resolveLink({ url: 'https://example.com' }, [], 0), {
  url: 'https://example.com',
});
check('labelled by its url', linkLabel({ url: 'https://example.com' }, deck), 'https://example.com');
check('tooltip prefers author text over the url',
  linkTooltip({ url: 'https://example.com', tooltip: 'Ops order' }, deck), 'Ops order');

console.log('URL scheme allowlist');
check('https allowed', isSafeLinkUrl('https://example.com'), true);
check('http allowed', isSafeLinkUrl('http://example.com'), true);
check('mailto allowed', isSafeLinkUrl('mailto:ops@example.com'), true);
check('javascript refused', isSafeLinkUrl('javascript:alert(1)'), false);
check('data refused', isSafeLinkUrl('data:text/html,<script>'), false);
check('file refused', isSafeLinkUrl('file:///etc/passwd'), false);
// Relative strings have no scheme to check, so they are not absolute URLs.
check('relative refused', isSafeLinkUrl('/ops/plan'), false);
check('empty refused', isSafeLinkUrl(''), false);

console.log('normalizeLinkUrl');
check('bare host gains https', normalizeLinkUrl('example.com/ops'), 'https://example.com/ops');
check('scheme is left alone', normalizeLinkUrl('http://example.com'), 'http://example.com');
// The https:// prefix is only added when there is NO scheme, so a refused
// scheme can never be upgraded into an accepted one.
check('javascript is not upgraded', normalizeLinkUrl('javascript:alert(1)'), null);
check('whitespace trimmed', normalizeLinkUrl('  https://example.com  '), 'https://example.com');
check('empty → null', normalizeLinkUrl('   '), null);

console.log('normalizeLink — urls');
check('keeps a good url', normalizeLink({ url: 'https://example.com' }), {
  url: 'https://example.com',
});
check('drops a bad scheme entirely', normalizeLink({ url: 'javascript:alert(1)' }), null);
// url is checked first and wins, so a document carrying both is unambiguous.
check('url beats slideId', normalizeLink({ url: 'https://example.com', slideId: 's1' }), {
  url: 'https://example.com',
});
check('url keeps its tooltip', normalizeLink({ url: 'example.com', tooltip: ' Ops ' }), {
  url: 'https://example.com',
  tooltip: 'Ops',
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
