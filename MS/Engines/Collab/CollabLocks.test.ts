/**
 * CollabLocks.test.ts — run with: node MS/Engines/Collab/CollabLocks.test.ts
 * House style follows SlideLinks.test.ts: plain console assertions, non-zero
 * exit on failure. No test framework in this repo.
 *
 * Covers lock arbitration. The property that matters: when two peers claim the
 * same object in the same instant, every peer must independently reach the SAME
 * verdict about who holds it — otherwise both users believe they own the object
 * and edit it simultaneously, which is precisely what locks exist to prevent.
 */
import CollabLocks from './CollabLocks.ts';
import { PROTOCOL_VERSION, type CollabMsg, type CollabMsgType } from './CollabTypes.ts';

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

/**
 * Minimal stand-in for CollabSession: records what was sent and lets the test
 * inject inbound messages. CollabLocks only ever imports the session as a type,
 * so nothing real needs constructing.
 */
function fakeSession(myId: string) {
  const handlers = new Map<CollabMsgType, Array<(m: CollabMsg) => void>>();
  const sent: Array<{ t: CollabMsgType; d: any }> = [];
  return {
    me: { id: myId, name: myId, color: '#fff' },
    sent,
    on(t: CollabMsgType, h: (m: CollabMsg) => void) {
      const list = handlers.get(t) ?? [];
      list.push(h);
      handlers.set(t, list);
      return () => {
        /* no-op */
      };
    },
    send(t: CollabMsgType, d: any) {
      sent.push({ t, d });
    },
    nameOf: (id: string) => `name-${id}`,
    colorOf: () => '#abcdef',
    /** Deliver an inbound message as if it arrived from the relay. */
    deliver(t: CollabMsgType, from: string, d: any) {
      const msg: CollabMsg = { v: PROTOCOL_VERSION, t, from, d };
      handlers.get(t)?.forEach((h) => h(msg));
    },
  };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log('claim / release');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });

    locks.claim(['g1', 'g2'], 'map');
    check('broadcasts one claim for both ids', s.sent.map((m) => m.t), ['lock']);
    check('claim carries the ids', s.sent[0].d.ids, ['g1', 'g2']);
    check('held locally', [locks.heldByMe('g1'), locks.heldByMe('g2')], [true, true]);

    // Re-selecting a subset must release what left the selection.
    s.sent.length = 0;
    locks.claim(['g1'], 'map');
    check('releases the dropped id', s.sent.map((m) => m.t), ['unlock']);
    check('unlock names only g2', s.sent[0].d.ids, ['g2']);
    check('g1 still held', locks.heldByMe('g1'), true);

    s.sent.length = 0;
    locks.claim([], 'map');
    check('empty selection releases everything', s.sent[0].d.ids, ['g1']);
    check('nothing held', locks.heldByMe('g1'), false);
    locks.destroy();
  }

  console.log('remote locks block editing');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });

    s.deliver('lock', 'peer', { ids: ['x1'], scope: 'map', ttlMs: 10000 });
    check('locked by other', locks.lockedByOther('x1'), true);
    check('owner is reported for the toast', locks.ownerOf('x1')?.name, 'name-peer');
    check('untouched object is free', locks.lockedByOther('x2'), false);
    check('remoteLocks lists it once', locks.remoteLocks().map((l) => l.id), ['x1']);

    s.deliver('unlock', 'peer', { ids: ['x1'] });
    check('released on unlock', locks.lockedByOther('x1'), false);

    // A peer must not be able to release someone else's lock.
    s.deliver('lock', 'peerA', { ids: ['x3'], scope: 'map', ttlMs: 10000 });
    s.deliver('unlock', 'peerB', { ids: ['x3'] });
    check('a third party cannot unlock it', locks.lockedByOther('x3'), true);

    // Nor should a departure leave the object stuck.
    s.deliver('bye', 'peerA', undefined);
    check('owner leaving frees it', locks.lockedByOther('x3'), false);
    locks.destroy();
  }

  console.log('our own claim never blocks us');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });
    locks.claim(['g9'], 'map');
    // Echo of our own claim (belt-and-braces: the relay does not echo).
    s.deliver('lock', 'me', { ids: ['g9'], scope: 'map', ttlMs: 10000 });
    check('not locked against ourselves', locks.lockedByOther('g9'), false);
    check('no owner badge for our own lock', locks.ownerOf('g9'), null);
    check('excluded from remoteLocks', locks.remoteLocks().length, 0);
    locks.destroy();
  }

  console.log('concurrent claims resolve identically everywhere');
  {
    // 'aaa' and 'zzz' claim the same object at the same moment. The rule is
    // "lower client id wins", applied by every peer to the messages it sees.
    const asA = fakeSession('aaa');
    const locksA = new CollabLocks(asA as any);
    locksA.start({ ttlMs: 10000 });
    locksA.claim(['contested'], 'map');
    asA.deliver('lock', 'zzz', { ids: ['contested'], scope: 'map', ttlMs: 10000 });
    check('lower id keeps its own claim', locksA.heldByMe('contested'), true);
    check('and is not blocked', locksA.lockedByOther('contested'), false);

    const asZ = fakeSession('zzz');
    const locksZ = new CollabLocks(asZ as any);
    locksZ.start({ ttlMs: 10000 });
    locksZ.claim(['contested'], 'map');
    asZ.deliver('lock', 'aaa', { ids: ['contested'], scope: 'map', ttlMs: 10000 });
    check('higher id yields its claim', locksZ.heldByMe('contested'), false);
    check('and is now blocked', locksZ.lockedByOther('contested'), true);

    // The verdict agrees on both sides — nobody thinks they share the object.
    check(
      'exactly one owner across the pair',
      [locksA.lockedByOther('contested'), locksZ.lockedByOther('contested')],
      [false, true],
    );

    // A later claim by the loser must not steal it back.
    asA.deliver('lock', 'zzz', { ids: ['contested'], scope: 'map', ttlMs: 10000 });
    check('loser cannot reclaim', locksA.heldByMe('contested'), true);
    locksA.destroy();
    locksZ.destroy();
  }

  console.log('locks expire when their holder goes quiet');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 2000 });
    s.deliver('lock', 'ghost', { ids: ['stale'], scope: 'map', ttlMs: 2000 });
    check('held while fresh', locks.lockedByOther('stale'), true);
    await sleep(2150); // TTL is clamped to a 2s floor
    check('free once the TTL lapses', locks.lockedByOther('stale'), false);
    check('and gone from remoteLocks', locks.remoteLocks().length, 0);
    locks.destroy();
  }

  console.log('disabling locks makes everything editable');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000, enabled: false });
    s.deliver('lock', 'peer', { ids: ['y1'], scope: 'map', ttlMs: 10000 });
    check('remote lock ignored', locks.lockedByOther('y1'), false);
    locks.claim(['y2'], 'map');
    check('no claim is broadcast', s.sent.length, 0);

    locks.setOptions({ enabled: true });
    s.deliver('lock', 'peer', { ids: ['y3'], scope: 'map', ttlMs: 10000 });
    check('re-enabling restores enforcement', locks.lockedByOther('y3'), true);
    locks.destroy();
  }

  // A refresh used to default to scope 'map', silently rewriting every slide
  // lock the first time it fired.
  console.log('a refresh re-broadcasts each id under its original scope');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 2000 }); // refresh fires at ttl/2 = 1s
    locks.claim(['obj1'], 'slide');
    s.sent.length = 0;
    await sleep(1150);
    const refresh = s.sent.filter((m) => m.t === 'lock');
    check('the claim was refreshed', refresh.length > 0, true);
    check('still scoped to the slide', refresh[0]?.d?.scope, 'slide');
    locks.destroy();
  }

  /**
   * The map and the open slide are two independent selection surfaces sharing one
   * CollabLocks. An unscoped drop meant clicking a symbol released the slide
   * objects you were mid-edit on (and clearing the slide canvas released your map
   * symbols) — silently handing them to whichever peer had been locked out.
   */
  console.log('a claim in one scope leaves the other scope alone');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });

    locks.claim(['obj1'], 'slide');
    locks.claim(['g1'], 'map');
    check('both scopes held at once', [locks.heldByMe('obj1'), locks.heldByMe('g1')], [true, true]);

    // Clearing the map selection must not touch the slide object.
    s.sent.length = 0;
    locks.claim([], 'map');
    check('only the map id is released', s.sent.map((m) => m.d?.ids), [['g1']]);
    check('the slide object is still held', locks.heldByMe('obj1'), true);

    // …and the same in the other direction.
    locks.claim(['g2'], 'map');
    s.sent.length = 0;
    locks.claim([], 'slide');
    check('only the slide id is released', s.sent.map((m) => m.d?.ids), [['obj1']]);
    check('the map symbol is still held', locks.heldByMe('g2'), true);

    // releaseAll stays unscoped — teardown means everything.
    s.sent.length = 0;
    locks.claim(['obj2'], 'slide');
    s.sent.length = 0;
    locks.releaseAll();
    check(
      'releaseAll drops both scopes',
      (s.sent.find((m) => m.t === 'unlock')?.d?.ids as string[])?.slice().sort(),
      ['g2', 'obj2'],
    );
    locks.destroy();
  }

  console.log('remoteLocks can be narrowed to one scope');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });
    s.deliver('lock', 'peer', { ids: ['m1'], scope: 'map', ttlMs: 10000 });
    s.deliver('lock', 'peer', { ids: ['s1'], scope: 'slide', ttlMs: 10000 });
    check('unfiltered returns both', locks.remoteLocks().length, 2);
    check('map only', locks.remoteLocks('map').map((l) => l.id), ['m1']);
    check('slide only', locks.remoteLocks('slide').map((l) => l.id), ['s1']);
    locks.destroy();
  }

  // The refresh period is derived from the TTL, so changing the TTL has to
  // rebuild the interval or claims lapse between ticks.
  console.log('lowering the TTL at runtime speeds the refresh up with it');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 20000 }); // would refresh every 10s
    locks.claim(['g1'], 'map');
    locks.setOptions({ ttlMs: 2000 }); // now every 1s
    s.sent.length = 0;
    await sleep(1150);
    check('refreshed on the new cadence', s.sent.some((m) => m.t === 'lock'), true);
    check('and advertises the new TTL', s.sent.find((m) => m.t === 'lock')?.d?.ttlMs, 2000);
    locks.destroy();
  }

  console.log('destroy releases what we hold');
  {
    const s = fakeSession('me');
    const locks = new CollabLocks(s as any);
    locks.start({ ttlMs: 10000 });
    locks.claim(['g1'], 'map');
    s.sent.length = 0;
    locks.destroy();
    check('sends a final unlock', s.sent.map((m) => m.t), ['unlock']);
    check('for the ids we held', s.sent[0].d.ids, ['g1']);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
