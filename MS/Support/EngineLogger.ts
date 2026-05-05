/**
 * EngineLogger.ts
 * Centralized log emitter for all MS engines.
 *
 * Engines call EngineLogger.success / .error / .nextStep with their name and
 * a plain-English message.  The logger fires a single "engine-log" CustomEvent
 * on document — the client application (index.html / main.ts) decides how to
 * render it.
 *
 * Controlled via Settings.json → logging.enabled (toggled by SymbolEngine on
 * startup and whenever the setting changes at runtime).
 *
 * Event payload (EngineLogEntry):
 *   engine    – e.g. "Proximity Engine"
 *   type      – "success" | "error" | "next-step"
 *   message   – raw message text
 *   formatted – "[Proximity Engine: message]"
 *   timestamp – Date of emission
 */

export type LogType = 'success' | 'error' | 'next-step';

export interface EngineLogEntry {
  engine: string;
  type: LogType;
  message: string;
  formatted: string;
  timestamp: Date;
}

class EngineLogger {
  private static _enabled: boolean = true;

  static setEnabled(enabled: boolean): void {
    EngineLogger._enabled = enabled;
  }

  static get isEnabled(): boolean {
    return EngineLogger._enabled;
  }

  static log(engine: string, type: LogType, message: string): void {
    if (!EngineLogger._enabled) return;
    const formatted = `[${engine}: ${message}]`;
    const entry: EngineLogEntry = { engine, type, message, formatted, timestamp: new Date() };
    document.dispatchEvent(new CustomEvent('engine-log', { detail: entry, bubbles: true }));
  }

  static success(engine: string, message: string): void {
    EngineLogger.log(engine, 'success', message);
  }

  static error(engine: string, message: string): void {
    EngineLogger.log(engine, 'error', message);
  }

  static nextStep(engine: string, message: string): void {
    EngineLogger.log(engine, 'next-step', message);
  }
}

export default EngineLogger;
