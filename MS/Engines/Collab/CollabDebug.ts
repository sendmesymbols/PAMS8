/**
 * CollabDebug.ts
 *
 * Opt-in tracing for the Collab engine, toggled by Settings.json →
 * `collab.debug` (or `window.collabDebug(true)` at runtime).
 *
 * Collaboration fails quietly by nature: a message that is never sent looks
 * exactly like a message that is never received, and both look like "nothing
 * happens". This prints one line at every decision point — observers attached,
 * change detected, op published, op received, op applied — so a single reload
 * says where the chain stops instead of requiring a guess.
 */

let DEBUG = false;

export function setCollabDebug(on: boolean): void {
  DEBUG = !!on;
  if (DEBUG) console.info('[collab] debug tracing ON');
}

/** Trace a step. Args are only evaluated by the caller, so keep them cheap. */
export function clog(...args: unknown[]): void {
  if (DEBUG) console.log('[collab]', ...args);
}

/**
 * Report a genuine failure. Goes to the console unconditionally — the Engine Log
 * panel is gated by `logging.enabled`, and a swallowed sync error is the one
 * thing that must never be invisible.
 */
export function cerr(context: string, err: unknown): void {
  console.error(`[collab] ${context}:`, err);
}

/**
 * Merge partial options WITHOUT letting an explicit `undefined` overwrite a
 * default. `{...{sync:true}, ...{sync:undefined}}` yields `sync: undefined`,
 * which is falsy — that silently disables a feature whose setting merely failed
 * to load, and is exactly the class of bug this guards against.
 */
export function mergeDefined<T extends object>(base: T, patch?: Partial<T>): T {
  if (!patch) return base;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

if (typeof window !== 'undefined') {
  (window as any).collabDebug = setCollabDebug;
}
