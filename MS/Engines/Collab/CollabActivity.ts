/**
 * CollabActivity.ts
 *
 * Who did what, into the existing Engine Log panel.
 *
 * The map already shows you the RESULT of a peer's work; what it never showed is
 * that they did it. In a planning cell that matters twice: during the session
 * ("who moved the boundary?") and afterwards, because the Engine Log is the
 * nearest thing to an after-action record the app has.
 *
 * No new panel. `EngineLogger` already carries this engine's join/leave lines, so
 * activity lands in the same place people are already looking, and the whole
 * feature is one subscription plus a coalescer.
 *
 * Coalescing is the point. A single drag publishes several `g.up` ops, and a
 * multi-select nudge publishes one per graphic — logged raw that is thirty lines
 * for one gesture, which buries everything else in the panel. Ops are therefore
 * bucketed per actor and per kind over COALESCE_MS and summarised: "Maj Ali moved
 * 3 symbols".
 */

import EngineLogger from '../../Support/EngineLogger';
import { cerr } from './CollabDebug';
import type CollabSession from './CollabSession';
import type { CollabMsg } from './CollabTypes';

const ENGINE_NAME = 'Collab Activity';
/**
 * Bucketing window. Long enough to swallow one human gesture (a drag, a
 * multi-select nudge, a rename), short enough that the log still reads as a live
 * feed rather than a digest.
 */
const COALESCE_MS = 1500;

type Kind = 'add' | 'edit' | 'del' | 'slide' | 'slideDel' | 'reorder' | 'overlay';

interface Bucket {
  actor: string;
  kind: Kind;
  count: number;
  /** Name of the single object involved — dropped once count > 1. */
  label: string;
}

export default class CollabActivity {
  private _offMsg: Array<() => void> = [];
  private _pending = new Map<string, Bucket>();
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _enabled = true;
  /**
   * Graphic ids already reported. A `g.up` is an "add" the first time we hear
   * about an id and an "edit" afterwards — asking MapSync whether the graphic
   * exists yet would be wrong, because remote ops are applied from a deferred
   * queue and may not have landed when this runs.
   */
  private _known = new Set<string>();

  constructor(private readonly session: CollabSession) {}

  public start(opts?: { enabled?: boolean }): void {
    if (typeof opts?.enabled === 'boolean') this._enabled = opts.enabled;
    const on = (t: Parameters<CollabSession['on']>[0], fn: (m: CollabMsg) => void) => {
      this._offMsg.push(this.session.on(t, fn));
    };
    on('g.up', (m) => {
      const id = m.d?.sym?.id;
      if (!id) return;
      const fresh = !this._known.has(id);
      if (fresh) this._known.add(id);
      this._note(m.from, fresh ? 'add' : 'edit', CollabActivity._symbolLabel(m.d?.sym));
    });
    on('g.del', (m) => {
      if (m.d?.id) this._known.delete(m.d.id);
      this._note(m.from, 'del', 'a symbol');
    });
    on('slide.up', (m) => this._note(m.from, 'slide', CollabActivity._slideLabel(m.d?.slide)));
    on('slide.del', (m) => this._note(m.from, 'slideDel', 'a slide'));
    on('slide.order', (m) => this._note(m.from, 'reorder', 'the deck'));
    on('ov.up', (m) => this._note(m.from, 'overlay', 'a slide object'));
    on('ov.del', (m) => this._note(m.from, 'overlay', 'a slide object'));
  }

  public setOptions(opts: { enabled?: boolean }): void {
    if (typeof opts.enabled !== 'boolean') return;
    this._enabled = opts.enabled;
    if (!this._enabled) {
      this._pending.clear();
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }
  }

  public destroy(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._offMsg.forEach((off) => off());
    this._offMsg = [];
    this._pending.clear();
    this._known.clear();
  }

  private _note(from: string, kind: Kind, label: string): void {
    if (!this._enabled) return;
    const actor = this.session.nameOf(from);
    const key = `${from}|${kind}`;
    const bucket = this._pending.get(key);
    if (bucket) {
      bucket.count++;
      bucket.label = ''; // more than one object — the summary drops the name
    } else {
      this._pending.set(key, { actor, kind, count: 1, label });
    }
    if (!this._timer) {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._flush();
      }, COALESCE_MS);
    }
  }

  private _flush(): void {
    const buckets = Array.from(this._pending.values());
    this._pending.clear();
    for (const b of buckets) {
      try {
        EngineLogger.success(ENGINE_NAME, CollabActivity._sentence(b));
      } catch (err) {
        cerr('could not log activity', err);
      }
    }
  }

  private static _sentence(b: Bucket): string {
    const one = b.count === 1;
    const n = `${b.count}`;
    switch (b.kind) {
      case 'add':
        return one ? `${b.actor} added ${b.label}` : `${b.actor} added ${n} symbols`;
      case 'edit':
        return one ? `${b.actor} edited ${b.label}` : `${b.actor} edited ${n} symbols`;
      case 'del':
        return one ? `${b.actor} deleted a symbol` : `${b.actor} deleted ${n} symbols`;
      case 'slide':
        return one ? `${b.actor} updated ${b.label}` : `${b.actor} updated ${n} slides`;
      case 'slideDel':
        return one ? `${b.actor} deleted a slide` : `${b.actor} deleted ${n} slides`;
      case 'reorder':
        return `${b.actor} reordered the deck`;
      default:
        return one
          ? `${b.actor} edited a slide object`
          : `${b.actor} edited ${n} slide objects`;
    }
  }

  /**
   * Best available name for a serialised symbol. A unit designation is what a
   * planner would call it ("B/1-7"); failing that the symbol's own name from
   * drawEssentials.SYM_NAME. Never throws on a malformed payload — this is a log
   * line, not a decision.
   */
  private static _symbolLabel(sym: any): string {
    const desig = sym?.amplifier?.UNIQUE_DESIG;
    if (typeof desig === 'string' && desig.trim()) return desig.trim().slice(0, 40);
    const name = sym?.drawEssentials?.SYM_NAME;
    if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 40);
    return 'a symbol';
  }

  private static _slideLabel(slide: any): string {
    const title = slide?.title ?? slide?.name;
    if (typeof title === 'string' && title.trim()) return `slide “${title.trim().slice(0, 40)}”`;
    return 'a slide';
  }
}
