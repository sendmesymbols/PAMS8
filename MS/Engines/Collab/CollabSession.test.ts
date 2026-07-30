/**
 * CollabSession.test.ts — run with: node MS/Engines/Collab/CollabSession.test.ts
 * House style follows CollabTypes.test.ts: plain console assertions, non-zero
 * exit on failure. No test framework in this repo.
 *
 * Covers the parts of the session where being wrong is SILENT — the failures that
 * present as "collaboration doesn't work" with nothing in the console:
 *
 *   the roster protocol      a hello volley that does not terminate floods the
 *                            room; one that terminates too early leaves a
 *                            one-way roster where each side sees the other as
 *                            anonymous forever.
 *   rediscovery              a peer pruned while its tab was backgrounded keeps
 *                            sending ops but is absent from the roster, so its
 *                            cursor is unnamed and the online count is wrong.
 *   the payload gate         a malformed op reaching a handler half-applies it.
 *   `to` addressing          a snapshot offer delivered to the whole room is a
 *                            large, pointless broadcast.
 *   the last-write-wins gate if this ordering is wrong the maps diverge.
 *
 * Runs headless via `SessionOptions.transportFactory`, which exists for exactly
 * this: the real path needs EventSource and fetch.
 */
import EngineLogger from '../../Support/EngineLogger.ts';
import CollabSession from './CollabSession.ts';
import type { CollabTransport, TransportStatus } from './CollabTransport.ts';
import { PROTOCOL_VERSION, type CollabMsg, type CollabMsgType, type HLC } from './CollabTypes.ts';

// EngineLogger dispatches a CustomEvent on `document`, which does not exist here.
// Disabling it is the supported way to keep it quiet — see EngineLogger.setEnabled.
EngineLogger.setEnabled(false);

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

/** A transport that records what was sent and lets a test inject arrivals. */
class FakeTransport implements CollabTransport {
  public readonly kind = 'broadcast' as const;
  public sent: CollabMsg[] = [];
  private _onMsg: ((m: CollabMsg) => void) | null = null;
  private _onStatus: ((s: TransportStatus, d?: string) => void) | null = null;

  public connect(): void {
    this._onStatus?.('open');
  }
  public send(msg: CollabMsg): void {
    this.sent.push(msg);
  }
  public onMessage(cb: (m: CollabMsg) => void): void {
    this._onMsg = cb;
  }
  public onStatus(cb: (s: TransportStatus, d?: string) => void): void {
    this._onStatus = cb;
  }
  public close(): void {
    this._onStatus?.('closed');
  }

  /** Test helper — simulate a message arriving from the relay. */
  public deliver(m: Partial<CollabMsg> & { t: CollabMsgType; from: string }): void {
    this._onMsg?.({ v: PROTOCOL_VERSION, ...m } as CollabMsg);
  }
  /** Sent messages of one type. */
  public of(t: CollabMsgType): CollabMsg[] {
    return this.sent.filter((m) => m.t === t);
  }
}

function makeSession(userName = 'Tester') {
  const fake = new FakeTransport();
  const session = new CollabSession({
    room: 'test',
    transport: 'broadcast',
    relayUrl: '',
    userName,
    transportFactory: () => fake,
  });
  session.connect();
  return { session, fake };
}

const hello = (from: string, name: string, reply = false) => ({
  t: 'hello' as CollabMsgType,
  from,
  d: { user: { id: from, name, color: '#ff7ac6' }, reply },
});

// ── Joining ─────────────────────────────────────────────────────────────────

console.log('connect — announces itself');
{
  const { session, fake } = makeSession('Maj Ali');
  check('a hello is sent on open', fake.of('hello').length, 1);
  check('it carries our name', fake.of('hello')[0].d.user.name, 'Maj Ali');
  check('unsolicited, so peers answer it', fake.of('hello')[0].d.reply, false);
  check('the room starts empty', session.peerCount, 0);
  session.disconnect();
}

console.log('the hello volley terminates');
{
  const { session, fake } = makeSession();
  const before = fake.of('hello').length;
  // An unsolicited hello must be answered, so the sender learns our name…
  fake.deliver(hello('aaa', 'Capt Roy'));
  check('an unsolicited hello is answered', fake.of('hello').length, before + 1);
  check('and the answer is marked as one', fake.of('hello').at(-1)?.d.reply, true);
  // …but an answer must NOT be answered, or two peers volley forever.
  const after = fake.of('hello').length;
  fake.deliver(hello('bbb', 'Sgt Khan', true));
  check('a reply is never answered back', fake.of('hello').length, after);
  check('both peers are in the roster', session.peerCount, 2);
  check('and are named', session.nameOf('aaa'), 'Capt Roy');
  session.disconnect();
}

/**
 * The re-introduction path. Browsers throttle timers in hidden tabs to about once
 * a minute, so a peer that alt-tabs away stops heartbeating and everyone prunes
 * it — while its ops keep arriving, because handlers are keyed by type and not by
 * roster membership. Without this it stayed missing from the online count with an
 * unnamed cursor, permanently.
 */
console.log('rediscovery — a peer heard from but not known');
{
  const { session, fake } = makeSession();
  const before = fake.of('hello').length;
  fake.deliver({ t: 'cursor', from: 'zzz', d: { lon: 1, lat: 2 } });
  check('the stranger is added at once', session.peerCount, 1);
  check('provisionally, under a placeholder name', session.nameOf('zzz'), 'zzz');
  check('and is asked to introduce itself', fake.of('hello').length, before + 1);
  check('with an unsolicited hello, so it answers', fake.of('hello').at(-1)?.d.reply, false);
  // Its real hello upgrades the entry rather than duplicating it.
  fake.deliver(hello('zzz', 'Lt Shah'));
  check('the real name replaces the placeholder', session.nameOf('zzz'), 'Lt Shah');
  check('still one peer', session.peerCount, 1);
  session.disconnect();
}

console.log('rediscovery is not triggered by our own echo');
{
  const { session, fake } = makeSession();
  const before = fake.of('hello').length;
  fake.deliver({ t: 'cursor', from: session.me.id, d: { lon: 1, lat: 2 } });
  check('we never become our own peer', session.peerCount, 0);
  check('and no hello is sent', fake.of('hello').length, before);
  session.disconnect();
}

console.log('bye — a clean exit');
{
  const { session, fake } = makeSession();
  fake.deliver(hello('aaa', 'Capt Roy'));
  let byeSeen = 0;
  session.on('bye', () => byeSeen++);
  fake.deliver({ t: 'bye', from: 'aaa' });
  check('the peer is gone', session.peerCount, 0);
  check('and handlers were told', byeSeen, 1);
  session.disconnect();
}

// ── The payload gate ────────────────────────────────────────────────────────

console.log('malformed ops never reach a handler');
{
  const { session, fake } = makeSession();
  let delivered = 0;
  session.on('g.up', () => delivered++);
  fake.deliver({ t: 'g.up', from: 'aaa', d: { sym: {} } }); // no id
  check('a symbol with no id is dropped', delivered, 0);
  fake.deliver({ t: 'g.up', from: 'aaa', d: {} });
  check('an empty payload is dropped', delivered, 0);
  fake.deliver({ t: 'g.up', from: 'aaa', d: { sym: { id: 'g1' } } });
  check('a well-formed op is delivered', delivered, 1);
  session.disconnect();
}

console.log('addressed messages go to their recipient only');
{
  const { session, fake } = makeSession();
  let mine = 0;
  session.on('snap.off', () => mine++);
  fake.deliver({ t: 'snap.off', from: 'aaa', to: 'somebody-else', d: { graphics: [] } });
  check('a message for another peer is ignored', mine, 0);
  fake.deliver({ t: 'snap.off', from: 'aaa', to: session.me.id, d: { graphics: [] } });
  check('one addressed to us is delivered', mine, 1);
  fake.deliver({ t: 'snap.off', from: 'aaa', d: { graphics: [] } });
  check('an unaddressed one is delivered too', mine, 2);
  session.disconnect();
}

console.log('sendTo addresses exactly one peer');
{
  const { session, fake } = makeSession();
  session.sendTo('aaa', 'snap.req', {});
  check('the recipient is stamped on the message', fake.of('snap.req')[0]?.to, 'aaa');
  session.disconnect();
}

// ── The last-write-wins gate ────────────────────────────────────────────────

console.log('accept — ordering, not arrival, decides');
{
  const { session } = makeSession();
  const ts = (ms: number, c = 0, id = 'aaa'): HLC => ({ ms, c, id });
  check('a first op is accepted', session.accept('g:1', ts(10)), true);
  check('an older op is refused', session.accept('g:1', ts(5)), false);
  check('a newer op is accepted', session.accept('g:1', ts(20)), true);
  // Idempotence is what makes the transport's replay queue safe: a replayed op
  // carries its ORIGINAL stamp, so re-delivery must lose rather than reapply.
  check('the same stamp twice is refused', session.accept('g:1', ts(20)), false);
  check('a different entity is independent', session.accept('g:2', ts(1)), true);
  session.disconnect();
}

console.log('our own sends claim the stamp, so a stale remote cannot undo them');
{
  const { session, fake } = makeSession();
  session.send('g.up', { sym: { id: 'g9' } }, 'g:g9');
  const ours = fake.of('g.up')[0]?.ts as HLC | undefined;
  check('the op was stamped', typeof ours?.ms, 'number');
  check('stamped by us', ours?.id, session.me.id);
  check('an older remote op for it is refused', session.accept('g:g9', { ms: 1, c: 0, id: 'aaa' }), false);
  session.disconnect();
}

console.log('ephemeral messages carry no stamp');
{
  const { session, fake } = makeSession();
  session.send('cursor', { lon: 1, lat: 2 });
  session.send('look', { lon: 1, lat: 2 });
  check('a cursor is unstamped', fake.of('cursor')[0]?.ts, undefined);
  check('a look-here is unstamped', fake.of('look')[0]?.ts, undefined);
  session.disconnect();
}

console.log('podium claims ride the persistent gate');
{
  const { session, fake } = makeSession();
  session.send('podium', { take: true }, 'podium');
  check('the claim is stamped', typeof (fake.of('podium')[0]?.ts as HLC)?.ms, 'number');
  // Having claimed it ourselves, a claim stamped earlier must lose — which is what
  // stops a late-arriving older claim from taking the room back.
  check('an older rival claim loses', session.accept('podium', { ms: 1, c: 0, id: 'aaa' }), false);
  session.disconnect();
}

// ── Identity ────────────────────────────────────────────────────────────────

console.log('identity');
{
  const { session } = makeSession('   Maj   Ali   ');
  check('the name is trimmed', session.me.name, 'Maj   Ali');
  check('a colour is assigned', /^#[0-9a-f]{6}$/i.test(session.me.color), true);
  check('an id is assigned', session.me.id.length > 0, true);
  session.disconnect();
}

console.log('setUserName re-announces');
{
  const { session, fake } = makeSession('Old');
  const before = fake.of('hello').length;
  session.setUserName('New Name');
  check('the name changed', session.me.name, 'New Name');
  check('and was announced', fake.of('hello').length, before + 1);
  const same = fake.of('hello').length;
  session.setUserName('New Name');
  check('setting the same name announces nothing', fake.of('hello').length, same);
  session.setUserName('   ');
  check('a blank name is refused', session.me.name, 'New Name');
  session.disconnect();
}

console.log('a peer name from the wire is sanitised before it reaches the roster');
{
  const { session, fake } = makeSession();
  fake.deliver({
    t: 'hello',
    from: 'evil',
    // A CSS-injection colour, which must not survive to a style attribute.
    d: { user: { id: 'evil', name: 'x'.repeat(200), color: 'red;position:fixed;inset:0' } },
  });
  check('the name is length-capped', session.nameOf('evil').length, 32);
  check('the colour falls back to a real one', /^#[0-9a-f]{6}$/i.test(session.colorOf('evil')), true);
  session.disconnect();
}

console.log('disconnect');
{
  const { session, fake } = makeSession();
  fake.deliver(hello('aaa', 'Capt Roy'));
  session.disconnect();
  check('a bye is sent', fake.of('bye').length, 1);
  check('the roster is cleared', session.peerCount, 0);
  // Sends after teardown must not throw — heartbeats racing a disconnect are
  // ordinary, and an exception here would surface as a broken UI action.
  session.send('cursor', { lon: 1, lat: 2 });
  check('sending after disconnect is safe', true, true);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
