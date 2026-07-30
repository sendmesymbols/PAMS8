import {
  mountSettingsWidget,
  type SettingsWidgetHandle,
} from '../../Support/SettingsWidget';
import CommandPalette from '../../Support/CommandPalette';
import EngineLogger from '../../Support/EngineLogger';
import { collabSettingsManifest } from './CollabSettingsManifest';

const ENGINE_NAME = 'Collab Engine';

/**
 * Reached through `window.collabEngine` at RUN time rather than imported, the same
 * way ChartCommands reaches the analysis engines: registering these actions must
 * not pull the whole collaboration engine into the bundle for someone who never
 * turns it on, and a disabled engine should degrade to a log line.
 */
function collab(): any {
  return (window as any).collabEngine ?? null;
}

function withEngine(what: string, fn: (engine: any) => void): void {
  const engine = collab();
  if (!engine?.isEnabled) {
    EngineLogger.error(
      ENGINE_NAME,
      `Cannot ${what} — collaboration is off. Turn on features.collab first.`,
    );
    return;
  }
  try {
    fn(engine);
  } catch (err) {
    EngineLogger.error(ENGINE_NAME, `Could not ${what}: ${String(err)}`);
  }
}

export function openCollabSettings(
  opts: { anchor?: { x?: number; y?: number }; focusGroup?: string } = {},
): SettingsWidgetHandle {
  return mountSettingsWidget({
    id: 'collab-settings',
    title: 'Collaboration',
    icon: '👥',
    manifest: collabSettingsManifest,
    anchor: opts.anchor,
    focusGroup: opts.focusGroup,
  });
}

if (typeof window !== 'undefined') {
  (window as any).openCollabSettings = openCollabSettings;
}

CommandPalette.registerWidget({
  id: 'collab',
  label: 'Collaboration',
  category: 'Tools',
  icon: '👥',
  hint: 'Work on one map and deck together — shared symbols, slides, cursors and drawing previews',
  keywords: [
    'collab',
    'collaborate',
    'multi user',
    'share',
    'live',
    'team',
    'realtime',
    'cursor',
    'presence',
    'room',
  ],
  opener: () => openCollabSettings(),
});

CommandPalette.registerActions([
  {
    id: 'collab.podium',
    label: 'Brief the room (take the podium)',
    hint: 'Everyone follows your slides, builds and mark-up. Run again to hand it back.',
    keywords: ['brief', 'briefing', 'present', 'podium', 'presenter', 'slides', 'drive', 'lead'],
    run: () =>
      withEngine('take the podium', (e) => {
        if (e.presentSync?.isBriefer) e.releasePodium();
        else e.takePodium();
      }),
  },
  {
    id: 'collab.rejoin',
    label: 'Rejoin the briefing',
    hint: 'Snap back to the briefer’s slide after looking around on your own',
    keywords: ['rejoin', 'follow', 'briefing', 'catch up', 'back', 'presenter'],
    run: () =>
      withEngine('rejoin the briefing', (e) => {
        if (!e.presentSync?.briefer) {
          EngineLogger.error(ENGINE_NAME, 'Nobody is briefing the room');
          return;
        }
        e.presentSync.rejoin();
      }),
  },
  {
    id: 'collab.ping',
    label: 'Ping a location for the room',
    hint: 'Then click the map — drops a marker everyone sees for a few seconds',
    keywords: ['ping', 'look here', 'point', 'attention', 'marker', 'show', 'highlight'],
    run: () => withEngine('ping a location', (e) => e.armPing()),
  },
  {
    id: 'collab.ping.centre',
    label: 'Ping the centre of my view',
    hint: 'Pings without needing a click — useful when you have just navigated somewhere',
    keywords: ['ping', 'centre', 'center', 'view', 'here', 'attention'],
    run: () => withEngine('ping the view centre', (e) => e.pingHere()),
  },
  {
    id: 'collab.chat',
    label: 'Room chat',
    hint: 'Open or close the text channel for this room',
    keywords: ['chat', 'message', 'text', 'talk', 'say', 'room'],
    run: () => withEngine('open chat', (e) => e.chat?.toggle()),
  },
  {
    id: 'collab.resync',
    label: 'Resync — fetch anything I am missing',
    hint: 'Asks a peer for the room state again. Recovers missing objects, not stale ones.',
    keywords: ['resync', 'sync', 'refresh', 'catch up', 'missing', 'diverged', 'repair'],
    run: () => withEngine('resync', (e) => e.resync()),
  },
  {
    id: 'collab.diagnose',
    label: 'Diagnose collaboration',
    hint: 'Prints the state of every link in the chain to the console',
    keywords: ['diagnose', 'debug', 'health', 'troubleshoot', 'why', 'broken', 'status'],
    run: () => {
      const engine = collab();
      if (!engine) {
        EngineLogger.error(ENGINE_NAME, 'Collaboration has never been loaded in this session');
        return;
      }
      // Logged as a table rather than routed through EngineLogger: it is a dozen
      // fields meant to be read side by side, not a one-line status message.
      console.table(engine.diagnose());
      EngineLogger.success(ENGINE_NAME, 'Collaboration diagnostics printed to the console');
    },
  },
]);

export default openCollabSettings;
