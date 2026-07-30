/**
 * CollabTypes.test.ts — run with: node MS/Engines/Collab/CollabTypes.test.ts
 * House style follows SlideLinks.test.ts: plain console assertions, non-zero
 * exit on failure. No test framework in this repo.
 *
 * Covers the hybrid logical clock, which is the whole of conflict resolution:
 * if the ordering here is wrong, two workstations disagree about which edit
 * won and the maps silently diverge.
 */
import {
  colorForClient,
  hlcCompare,
  hlcNewer,
  hlcRecv,
  hlcSend,
  isPersistent,
  isValidPayload,
  MAX_NAME_LEN,
  newHlcState,
  PEER_PALETTE,
  pickSnapshotProvider,
  podiumHolderAt,
  sanitizeUser,
  shouldApplyRemoteView,
  shouldBroadcastLocalView,
  viewTargetFor,
  type BatonState,
  type HLC,
} from './CollabTypes.ts';

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

const h = (ms: number, c: number, id: string): HLC => ({ ms, c, id });

console.log('hlcCompare — total ordering');
check('later ms wins', hlcCompare(h(2, 0, 'a'), h(1, 9, 'z')), 1);
check('earlier ms loses', hlcCompare(h(1, 9, 'z'), h(2, 0, 'a')), -1);
check('same ms → counter decides', hlcCompare(h(5, 2, 'a'), h(5, 1, 'z')), 1);
check('same ms + counter → client id decides', hlcCompare(h(5, 1, 'a'), h(5, 1, 'b')), -1);
check('identical stamps are equal', hlcCompare(h(5, 1, 'a'), h(5, 1, 'a')), 0);
check('missing current loses to anything', hlcCompare(h(1, 0, 'a'), undefined), 1);
check('missing candidate loses', hlcCompare(undefined, h(1, 0, 'a')), -1);
check('both missing are equal', hlcCompare(undefined, undefined), 0);

// Symmetry matters: every peer must reach the same verdict independently, so
// compare(a,b) and compare(b,a) must always be exact opposites.
console.log('hlcCompare — antisymmetry');
const pairs: Array<[HLC, HLC]> = [
  [h(1, 0, 'a'), h(1, 0, 'b')],
  [h(1, 1, 'b'), h(1, 0, 'a')],
  [h(9, 0, 'z'), h(1, 0, 'a')],
];
check(
  'compare(a,b) === -compare(b,a)',
  pairs.map(([a, b]) => hlcCompare(a, b) === -hlcCompare(b, a)),
  [true, true, true],
);

console.log('hlcNewer — the LWW gate');
check('newer is accepted', hlcNewer(h(2, 0, 'a'), h(1, 0, 'a')), true);
check('same stamp is rejected (idempotent replay)', hlcNewer(h(2, 0, 'a'), h(2, 0, 'a')), false);
check('older is rejected (out-of-order delivery)', hlcNewer(h(1, 0, 'a'), h(2, 0, 'a')), false);
check('first write always accepted', hlcNewer(h(1, 0, 'a'), undefined), true);

console.log('hlcSend — monotonic per client');
{
  const st = newHlcState();
  const a = hlcSend(st, 'me');
  const b = hlcSend(st, 'me');
  const c = hlcSend(st, 'me');
  check('each stamp beats the previous', [hlcCompare(b, a), hlcCompare(c, b)], [1, 1]);
  check('carries the client id', c.id, 'me');
}

console.log('hlcSend — survives a stalled clock');
{
  // Two ops inside the same millisecond must still order: this is the case a
  // bare Date.now() gets wrong.
  const st = newHlcState();
  st.ms = Date.now() + 60_000; // clock already ahead (or ours ran backwards)
  const a = hlcSend(st, 'me');
  const b = hlcSend(st, 'me');
  check('counter advances instead of ms', [b.ms === a.ms, b.c > a.c], [true, true]);
  check('still strictly increasing', hlcCompare(b, a), 1);
}

console.log('hlcRecv — our next op sorts after what we saw');
{
  const st = newHlcState();
  const remote = h(Date.now() + 30_000, 7, 'peer'); // peer's clock is ahead
  hlcRecv(st, remote);
  const mine = hlcSend(st, 'me');
  check('local op beats the remote it followed', hlcCompare(mine, remote), 1);
}
{
  const st = newHlcState();
  hlcRecv(st, undefined); // ephemeral message, no stamp
  check('undefined stamp is a no-op', st, newHlcState());
}
{
  // Causality across three peers: A → B → C must stay ordered on C.
  const stB = newHlcState();
  const stC = newHlcState();
  const fromA = h(Date.now() + 10_000, 0, 'A');
  hlcRecv(stB, fromA);
  const fromB = hlcSend(stB, 'B');
  hlcRecv(stC, fromB);
  const fromC = hlcSend(stC, 'C');
  check(
    'A < B < C',
    [hlcCompare(fromB, fromA), hlcCompare(fromC, fromB)],
    [1, 1],
  );
}

console.log('isPersistent — routing');
check('graphic upsert is persistent', isPersistent('g.up'), true);
check('overlay delete is persistent', isPersistent('ov.del'), true);
check('slide order is persistent', isPersistent('slide.order'), true);
check('cursor is ephemeral', isPersistent('cursor'), false);
check('preview is ephemeral', isPersistent('preview'), false);
check('lock is ephemeral', isPersistent('lock'), false);
check('snapshot offer is ephemeral (never replayed)', isPersistent('snap.off'), false);

console.log('colorForClient — stable per peer');
check('same id → same colour', colorForClient('abc123') === colorForClient('abc123'), true);
check('colour comes from the palette', PEER_PALETTE.includes(colorForClient('xyz789')), true);
check(
  'empty id still yields a colour',
  PEER_PALETTE.includes(colorForClient('')),
  true,
);

// The requester picks its provider, so exactly one peer answers. The previous
// joinedAt comparison recorded "when we first heard you" rather than "when you
// joined", which made two peers in a three-peer room both answer.
console.log('pickSnapshotProvider — one answer, no clock involved');
check('lowest id wins', pickSnapshotProvider(['m', 'a', 'z']), 'a');
check('order of the roster is irrelevant', pickSnapshotProvider(['z', 'a', 'm']), 'a');
check('single peer is the provider', pickSnapshotProvider(['only']), 'only');
check('nobody to ask', pickSnapshotProvider([]), null);
check('blank ids are skipped', pickSnapshotProvider(['', 'b']), 'b');
check(
  'every peer picks the same provider from the same roster',
  ['b', 'c', 'd'].map(() => pickSnapshotProvider(['d', 'b', 'c'])),
  ['b', 'b', 'b'],
);

// `color` is interpolated into a style attribute on the roster chip, so a peer
// must not be able to put arbitrary CSS there.
console.log('sanitizeUser — a peer cannot inject CSS or a novel-length name');
check('a real hex colour survives', sanitizeUser({ id: 'p1', name: 'Ali', color: '#ff7ac6' })?.color, '#ff7ac6');
check(
  'a CSS payload is replaced by the derived colour',
  sanitizeUser({ id: 'p1', name: 'Ali', color: 'red;position:fixed;inset:0' })?.color,
  colorForClient('p1'),
);
check(
  'a colour without the hash is rejected',
  sanitizeUser({ id: 'p1', color: 'ff7ac6' })?.color,
  colorForClient('p1'),
);
check(
  'name is capped',
  sanitizeUser({ id: 'p1', name: 'x'.repeat(500) })?.name.length,
  MAX_NAME_LEN,
);
check('a missing name gets a placeholder', sanitizeUser({ id: 'abcdef' })?.name, 'User-abcd');
check('no id means no peer', sanitizeUser({ name: 'nobody' }), null);
check('a non-object is rejected', sanitizeUser(undefined), null);

// One gate, so a malformed op is dropped rather than half-applied — an
// Object.assign of junk into a slide, or nonsense fed to loadSymbolFromJSON.
console.log('isValidPayload — shape gate');
check('a graphic upsert needs an id', isValidPayload('g.up', { sym: { id: 'g1' } }), true);
check('…and is rejected without one', isValidPayload('g.up', { sym: {} }), false);
check('a cursor needs finite coordinates', isValidPayload('cursor', { lon: 1, lat: 2 }), true);
check('NaN coordinates are rejected', isValidPayload('cursor', { lon: NaN, lat: 2 }), false);
check('a missing payload is rejected', isValidPayload('cursor', undefined), false);
check('a lock needs at least one id', isValidPayload('lock', { ids: ['a'] }), true);
check('an empty lock is rejected', isValidPayload('lock', { ids: [] }), false);
check('non-string ids are rejected', isValidPayload('lock', { ids: [1, 2] }), false);
check('a slide upsert needs a slide id', isValidPayload('slide.up', { slide: { id: 's1' } }), true);
check('an overlay op needs both ids', isValidPayload('ov.up', { slideId: 's1', ov: { id: 'o1' } }), true);
check('…and fails on either alone', isValidPayload('ov.up', { slideId: 's1' }), false);
check('ping carries nothing', isValidPayload('ping', undefined), true);
check('a snapshot offer may be deck-only', isValidPayload('snap.off', { deck: {} }), true);
check('an empty graphics array is still a valid chunk', isValidPayload('snap.off', { graphics: [] }), true);

// Shared view. The property that matters: at most ONE peer drives at a time, and
// two peers who move in the same instant must agree on which of them it is —
// otherwise they drag each other's map back and forth indefinitely.
console.log('viewTargetFor — 2D/3D degrades instead of fighting');
{
  const from3d = { lon: 10, lat: 20, scale: 5000, tilt: 62, heading: 15, vt: '3d' as const };
  const from2d = { lon: 10, lat: 20, scale: 5000, vt: '2d' as const };
  check('3D → 3D keeps the camera', viewTargetFor(from3d, '3d'), {
    center: [10, 20],
    scale: 5000,
    tilt: 62,
    heading: 15,
  });
  check('3D → 2D drops tilt and heading', viewTargetFor(from3d, '2d'), {
    center: [10, 20],
    scale: 5000,
  });
  check('2D → 3D leaves our camera alone', viewTargetFor(from2d, '3d'), {
    center: [10, 20],
    scale: 5000,
  });
  check('2D → 2D is centre and scale', viewTargetFor(from2d, '2d'), {
    center: [10, 20],
    scale: 5000,
  });
}

console.log('view baton — exactly one driver');
{
  const free: BatonState = { owner: null, until: 0 };
  const heldByPeer: BatonState = { owner: 'peer', until: 1000 };
  const heldByMe: BatonState = { owner: 'me', until: 1000 };
  const lapsed: BatonState = { owner: 'peer', until: 500 };

  check(
    'an idle room applies anything',
    shouldApplyRemoteView({ following: null, from: 'peer', myId: 'me', baton: free, now: 100 }),
    true,
  );
  check(
    'the baton holder keeps driving',
    shouldApplyRemoteView({ following: null, from: 'peer', myId: 'me', baton: heldByPeer, now: 100 }),
    true,
  );
  check(
    'a third peer cannot interrupt the holder',
    shouldApplyRemoteView({ following: null, from: 'other', myId: 'me', baton: heldByPeer, now: 100 }),
    false,
  );
  check(
    'a lapsed baton lets anyone take over',
    shouldApplyRemoteView({ following: null, from: 'other', myId: 'me', baton: lapsed, now: 600 }),
    true,
  );
  check(
    'we defend our own baton against a higher id',
    shouldApplyRemoteView({ following: null, from: 'zz', myId: 'me', baton: heldByMe, now: 100 }),
    false,
  );
  check(
    'but yield to a lower id (deterministic tie-break)',
    shouldApplyRemoteView({ following: null, from: 'aa', myId: 'me', baton: heldByMe, now: 100 }),
    true,
  );

  // Two peers moving in the same instant: each holds its own baton and evaluates
  // the other. Exactly one must yield, or they oscillate forever.
  const aYields = shouldApplyRemoteView({
    following: null,
    from: 'zz',
    myId: 'aa',
    baton: { owner: 'aa', until: 1000 },
    now: 100,
  });
  const zYields = shouldApplyRemoteView({
    following: null,
    from: 'aa',
    myId: 'zz',
    baton: { owner: 'zz', until: 1000 },
    now: 100,
  });
  check('a simultaneous clash has exactly one winner', [aYields, zYields], [false, true]);

  check(
    'following overrides the baton entirely',
    shouldApplyRemoteView({
      following: 'lead',
      from: 'lead',
      myId: 'me',
      baton: heldByPeer,
      now: 100,
    }),
    true,
  );
  check(
    'and ignores everybody else',
    shouldApplyRemoteView({ following: 'lead', from: 'peer', myId: 'me', baton: free, now: 100 }),
    false,
  );
}

console.log('view broadcast — suppressed while somebody else drives');
{
  const free: BatonState = { owner: null, until: 0 };
  check(
    'free to broadcast in an idle room',
    shouldBroadcastLocalView({ following: null, myId: 'me', baton: free, now: 100 }),
    true,
  );
  check(
    'suppressed while a peer holds the baton',
    shouldBroadcastLocalView({
      following: null,
      myId: 'me',
      baton: { owner: 'peer', until: 1000 },
      now: 100,
    }),
    false,
  );
  check(
    'free again once it lapses',
    shouldBroadcastLocalView({
      following: null,
      myId: 'me',
      baton: { owner: 'peer', until: 500 },
      now: 600,
    }),
    true,
  );
  check(
    'our own baton does not block us',
    shouldBroadcastLocalView({
      following: null,
      myId: 'me',
      baton: { owner: 'me', until: 1000 },
      now: 100,
    }),
    true,
  );
  check(
    'a passenger never steers',
    shouldBroadcastLocalView({ following: 'lead', myId: 'me', baton: free, now: 100 }),
    false,
  );
}

console.log('isValidPayload — shared view');
check('a viewpoint needs centre, scale and type', isValidPayload('view', { lon: 1, lat: 2, scale: 5000, vt: '2d' }), true);
check('a zero scale is rejected', isValidPayload('view', { lon: 1, lat: 2, scale: 0, vt: '2d' }), false);
check('an unknown view type is rejected', isValidPayload('view', { lon: 1, lat: 2, scale: 100, vt: 'vr' }), false);
check('a missing scale is rejected', isValidPayload('view', { lon: 1, lat: 2, vt: '3d' }), false);
check('the viewpoint stays ephemeral', isPersistent('view'), false);

// ── Added with shared briefing, pings, viewports and chat (protocol v2) ──────

console.log('pickSnapshotProvider — retry ladder');
check('lowest id is asked first', pickSnapshotProvider(['m', 'c', 'z']), 'c');
check(
  'an asked peer is skipped',
  pickSnapshotProvider(['m', 'c', 'z'], new Set(['c'])),
  'm',
);
check(
  'and the next after that',
  pickSnapshotProvider(['m', 'c', 'z'], new Set(['c', 'm'])),
  'z',
);
// The exhausted case is what stops the ladder: with nobody left to ask, the
// caller must give up and say so rather than loop.
check(
  'everybody asked → nobody left',
  pickSnapshotProvider(['m', 'c'], new Set(['c', 'm'])),
  null,
);
check('an empty roster has no provider', pickSnapshotProvider([]), null);
check('blank ids are ignored', pickSnapshotProvider(['', 'q']), 'q');

console.log('podiumHolderAt — the claim expires');
check('a live claim stands', podiumHolderAt({ holder: 'ali', until: 200 }, 100), 'ali');
check('a lapsed claim vacates', podiumHolderAt({ holder: 'ali', until: 100 }, 200), null);
// Exactly at the boundary the claim is already gone — `now < until` is the test,
// so expiry is never ambiguous for two peers whose clocks agree.
check('the boundary is exclusive', podiumHolderAt({ holder: 'ali', until: 100 }, 100), null);
check('a vacant podium has no holder', podiumHolderAt({ holder: null, until: 1e9 }, 100), null);

/**
 * The podium goes through the LWW gate rather than being arbitrated, because
 * arbitration does not converge — see PERSISTENT_TYPES. This asserts the wiring
 * that makes that true, since nothing else would notice if it changed.
 */
console.log('podium ordering — the LWW gate is the arbitration');
check('podium is persistent', isPersistent('podium'), true);
check('a later claim beats an earlier one', hlcNewer(h(2, 0, 'z'), h(1, 0, 'a')), true);
check('a stale claim loses', hlcNewer(h(1, 0, 'a'), h(2, 0, 'z')), false);
check(
  'simultaneous claims resolve by id, identically for everyone',
  hlcNewer(h(5, 1, 'b'), h(5, 1, 'a')),
  true,
);
check('a claim never beats itself', hlcNewer(h(5, 1, 'a'), h(5, 1, 'a')), false);

console.log('isValidPayload — the v2 message types');
check('a podium op needs a boolean', isValidPayload('podium', { take: true }), true);
check('…and rejects anything else', isValidPayload('podium', { take: 'yes' }), false);
check(
  'a position needs a slide, a build and a mode',
  isValidPayload('pres', { slideId: 's1', build: 0, active: true }),
  true,
);
check('a position without a slide id is rejected', isValidPayload('pres', { build: 0, active: true }), false);
check(
  'a non-numeric build is rejected',
  isValidPayload('pres', { slideId: 's1', build: 'two', active: true }),
  false,
);
check('a pen stroke needs points', isValidPayload('ink', { k: 'pen', sid: 's1', pts: [[0, 0]] }), true);
check('a clear needs none', isValidPayload('ink', { k: 'clear', sid: 's1' }), true);
check('an unknown tool is rejected', isValidPayload('ink', { k: 'brush', sid: 's1', pts: [] }), false);
check('a look-here needs a coordinate', isValidPayload('look', { lon: 1, lat: 2 }), true);
check('a look-here without a latitude is rejected', isValidPayload('look', { lon: 1 }), false);
/**
 * Guards the collision this test caught: 'ping' is the session heartbeat, which
 * `_receive` handles and returns early on. An attention marker named 'ping' was
 * silently undeliverable — every one of them stopped at the heartbeat branch.
 */
check('the heartbeat still validates as before', isValidPayload('ping', undefined), true);
check('and the two are different types', isPersistent('look') === isPersistent('ping'), true);
check('a chat line needs text', isValidPayload('chat', { text: 'hi' }), true);
check('an empty chat line is rejected', isValidPayload('chat', { text: '' }), false);
// `at` carries the sender's stamp so every peer keys the line identically, but it
// stays OPTIONAL: an older v2 peer omits it and must not have its chat rejected.
check('a stamped chat line is valid', isValidPayload('chat', { text: 'hi', at: 1 }), true);
check('an unstamped chat line is still valid', isValidPayload('chat', { text: 'hi' }), true);
check('a viewport needs four edges', isValidPayload('vp', { xmin: 0, ymin: 0, xmax: 1, ymax: 1 }), true);
check('a three-edged viewport is rejected', isValidPayload('vp', { xmin: 0, ymin: 0, xmax: 1 }), false);
/**
 * The empty snapshot offer has to validate. It is how a provider says "you are
 * already up to date" — and the whole point of answering rather than staying
 * silent is that silence is indistinguishable from a dead peer.
 */
check('an empty offer is a valid answer', isValidPayload('snap.off', { graphics: [], deck: null }), true);
check(
  'a deck chunk is a valid offer',
  isValidPayload('snap.off', { dk: { seq: 0, slides: [] } }),
  true,
);
check('a chat-only offer is valid', isValidPayload('snap.off', { chat: [] }), true);
check('an offer with nothing at all is rejected', isValidPayload('snap.off', {}), false);

console.log('these stay ephemeral — none may go through the LWW gate');
for (const t of ['pres', 'ink', 'look', 'chat', 'vp'] as const) {
  check(`${t} is ephemeral`, isPersistent(t), false);
}

console.log('viewTargetFor — rotation crosses only between two 2D views');
check(
  '2D → 2D carries rotation',
  viewTargetFor({ lon: 1, lat: 2, scale: 1000, vt: '2d', rotation: 30 }, '2d'),
  { center: [1, 2], scale: 1000, rotation: 30 },
);
// A SceneView has no `rotation`; forcing one would be meaningless, and flattening
// a 3D camera to match a 2D sender would take away a camera the user chose.
check(
  '2D → 3D drops it',
  viewTargetFor({ lon: 1, lat: 2, scale: 1000, vt: '2d', rotation: 30 }, '3d'),
  { center: [1, 2], scale: 1000 },
);
check(
  '3D → 2D has none to give',
  viewTargetFor({ lon: 1, lat: 2, scale: 1000, vt: '3d', tilt: 45, heading: 90 }, '2d'),
  { center: [1, 2], scale: 1000 },
);
check(
  'tilt and heading still cross 3D → 3D',
  viewTargetFor({ lon: 1, lat: 2, scale: 1000, vt: '3d', tilt: 45, heading: 90 }, '3d'),
  { center: [1, 2], scale: 1000, tilt: 45, heading: 90 },
);
check(
  'a non-finite rotation is ignored',
  viewTargetFor({ lon: 1, lat: 2, scale: 1000, vt: '2d', rotation: NaN }, '2d'),
  { center: [1, 2], scale: 1000 },
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
