/**
 * CollabSnapshot.test.ts - run with: node MS/Engines/Collab/CollabSnapshot.test.ts
 * Plain console assertions, matching the other collaboration tests.
 *
 * Covers late-joiner snapshot completion. The bug this protects against is
 * quiet divergence: receiving the snapshot head used to stop retries before the
 * map-symbol chunks arrived, so a dropped chunk looked like a successful catch-up.
 */
import EngineLogger from '../../Support/EngineLogger.ts';
import CollabSnapshot from './CollabSnapshot.ts';
import { PROTOCOL_VERSION, type CollabMsg, type CollabMsgType } from './CollabTypes.ts';

EngineLogger.setEnabled(false);

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok ${name}`);
    passed++;
  } else {
    console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`);
    failed++;
  }
}

function fakeSession(peerIds: string[] = ['aaa']) {
  const handlers = new Map<CollabMsgType, Array<(m: CollabMsg) => void>>();
  const sent: Array<{ to: string; t: CollabMsgType; d: any }> = [];
  return {
    sent,
    get peerIds() {
      return peerIds;
    },
    get peerCount() {
      return peerIds.length;
    },
    on(t: CollabMsgType, h: (m: CollabMsg) => void) {
      const list = handlers.get(t) ?? [];
      list.push(h);
      handlers.set(t, list);
      return () => {
        const next = (handlers.get(t) ?? []).filter((x) => x !== h);
        handlers.set(t, next);
      };
    },
    onRoster() {
      return () => {
        /* no-op */
      };
    },
    sendTo(to: string, t: CollabMsgType, d: any) {
      sent.push({ to, t, d });
    },
    nameOf: (id: string) => `name-${id}`,
    deliver(t: CollabMsgType, from: string, d: any) {
      const msg: CollabMsg = { v: PROTOCOL_VERSION, t, from, d };
      handlers.get(t)?.forEach((h) => h(msg));
    },
  };
}

function fakeMap() {
  const ids = new Set<string>();
  const applied: string[] = [];
  return {
    applied,
    findGraphic(id: string) {
      return ids.has(id) ? { attributes: { id } } : null;
    },
    applySymbol(sym: any) {
      ids.add(sym.id);
      applied.push(sym.id);
      return { attributes: { id: sym.id } };
    },
    collectSnapshot() {
      return [];
    },
  };
}

console.log('snapshot completion waits for declared graphic chunks');
{
  const s = fakeSession();
  const map = fakeMap();
  const snap = new CollabSnapshot(s as any, map as any, null, null);
  snap.start();

  check('requests the chosen provider', s.sent.map((m) => `${m.t}:${m.to}`), ['snap.req:aaa']);
  s.deliver('snap.off', 'aaa', { graphics: [], deck: null, gTotal: 1, dkTotal: 0 });
  check('head alone is not caught up', (snap as any)._caughtUp, false);
  check('head alone applies no symbols', map.applied, []);

  s.deliver('snap.off', 'aaa', {
    graphics: [],
    deck: null,
    g: { seq: 0, symbols: [{ id: 'g1' }] },
  });
  check('chunk completes the snapshot', (snap as any)._caughtUp, true);
  check('graphic chunk applied once', map.applied, ['g1']);
  snap.destroy();
}

console.log('snapshot chunks may arrive before the head');
{
  const s = fakeSession();
  const map = fakeMap();
  const snap = new CollabSnapshot(s as any, map as any, null, null);
  snap.start();

  s.deliver('snap.off', 'aaa', {
    graphics: [],
    deck: null,
    g: { seq: 0, symbols: [{ id: 'g2' }] },
  });
  check('pre-head chunk does not complete', (snap as any)._caughtUp, false);
  check('pre-head chunk is buffered/applied', map.applied, ['g2']);

  s.deliver('snap.off', 'aaa', { graphics: [], deck: null, gTotal: 1, dkTotal: 0 });
  check('head completes after earlier chunk', (snap as any)._caughtUp, true);
  snap.destroy();
}

console.log('legacy empty offers still complete');
{
  const s = fakeSession();
  const map = fakeMap();
  const snap = new CollabSnapshot(s as any, map as any, null, null);
  snap.start();

  s.deliver('snap.off', 'aaa', { graphics: [], deck: null });
  check('legacy empty answer means caught up', (snap as any)._caughtUp, true);
  snap.destroy();
}

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
