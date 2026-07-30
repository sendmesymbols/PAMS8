/**
 * collabRelay.js
 *
 * The only server-side code the Collab engine needs: a stateless fan-out relay.
 * ~150 lines, no npm dependencies (node:http only), no database, no persistence.
 * It never inspects or stores a message — it forwards each one to the other
 * members of the same room and forgets it.
 *
 * Why SSE + POST rather than WebSocket: a WebSocket server needs either a
 * dependency (`ws`) or a hand-rolled frame parser, while SSE downstream + POST
 * upstream is plain HTTP that mounts as ordinary middleware. That means it rides
 * inside the Vite dev server in development — no second process to start — and
 * the identical middleware mounts on whatever serves dist/ in production. On a
 * LAN the round trip is a few milliseconds, comfortably enough for 20 Hz cursors.
 *
 * Three ways to run it:
 *
 *   1. Vite dev (nothing to do — already wired in vite.config.ts):
 *        npm run dev            → http://<host>:6547
 *
 *   2. Standalone — for a production host, or if you would rather vite.config.ts
 *      knew nothing about this file (delete the plugin entry there):
 *        npm run relay          → http://<host>:6600
 *      then point Settings.json → collab.relayUrl at http://<host>:6600
 *
 *   3. Mounted in your own Node/Express/Connect server:
 *        import { createCollabRelay } from './tools/collabRelay.js';
 *        app.use(createCollabRelay());
 *
 * Endpoints:
 *   GET  /collab/stream?room=<r>&client=<id>   SSE; one open connection per client
 *   POST /collab/send?room=<r>&client=<id>     JSON message, or an array of them
 *   GET  /collab/health                        { rooms, clients }
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** Reject an upstream body larger than this (snapshots carry slide thumbnails). */
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** SSE comment interval — keeps intermediate proxies from closing an idle stream. */
const KEEPALIVE_MS = 20000;
/**
 * Hard cap per room.
 *
 * Sized to what the fan-out can actually carry rather than to a round number.
 * Cursor traffic is the dominant volume and every message is written once per
 * other member, so cost grows with the SQUARE of the room: 16 peers at 20 Hz is
 * already ~4,800 SSE writes a second. The previous 64 implied ~80,000/s, which
 * no single-process relay is going to deliver — better to refuse the 17th client
 * with a clear 503 than to quietly degrade everybody.
 */
const MAX_CLIENTS_PER_ROOM = 16;

/**
 * room -> Map<clientId, ServerResponse>
 * The entire state of the relay. Lost on restart, which costs nothing: clients
 * reconnect and catch up from a peer.
 */
const rooms = new Map();

function roomOf(name) {
  let r = rooms.get(name);
  if (!r) {
    r = new Map();
    rooms.set(name, r);
  }
  return r;
}

function dropClient(roomName, clientId) {
  const room = rooms.get(roomName);
  if (!room) return;
  room.delete(clientId);
  if (!room.size) rooms.delete(roomName);
}

function writeSse(res, payload) {
  try {
    res.write(`data: ${payload}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * An SSE comment. Used for the keepalive, which only needs bytes on the wire to
 * stop an idle connection being closed — EventSource ignores comments entirely.
 *
 * Previously the keepalive was a real `{v: 1, t: 'ping'}` message, which quietly
 * coupled this file to the client's protocol version: the moment the client moved
 * to v2 every keepalive became an "incompatible peer" message it had to discard.
 * A comment has no version to get wrong.
 */
function writeComment(res, text) {
  try {
    res.write(`: ${text}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Constant-ish time string compare, so a wrong token cannot be narrowed down by
 * timing. Not a strong guarantee in JS, but the cost is one line and the
 * alternative leaks the answer one character at a time.
 */
function tokenMatches(expected, given) {
  if (!expected) return true; // unauthenticated by default — the documented posture
  const a = String(expected);
  const b = String(given || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Forward `payload` (already-serialised JSON) to every client in the room except
 * the sender. A message carrying `to` is delivered to that one client only —
 * that is how a snapshot reaches a single late joiner instead of the whole room.
 */
function fanOut(roomName, senderId, payload, directedTo) {
  const room = rooms.get(roomName);
  if (!room) return 0;
  let sent = 0;
  for (const [clientId, res] of room) {
    if (clientId === senderId) continue;
    if (directedTo && clientId !== directedTo) continue;
    if (writeSse(res, payload)) sent++;
    else dropClient(roomName, clientId);
  }
  return sent;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/**
 * Connect-style middleware: `(req, res, next)`. Anything outside `basePath` is
 * passed straight through, so mounting this is side-effect free.
 */
export function createCollabRelay(options = {}) {
  const basePath = (options.basePath || '/collab').replace(/\/+$/, '');
  /**
   * Optional shared secret. Unset by default, which keeps the relay exactly as
   * documented: unauthenticated, for an isolated LAN. Setting it is defence in
   * depth, not a security boundary — the token travels in a query string, so it is
   * visible to anything that can see the URL. It raises the bar from "anyone who
   * can reach the port" to "anyone who was told the token".
   */
  const token = options.token || process.env.COLLAB_TOKEN || '';

  return function collabRelayMiddleware(req, res, next) {
    const rawUrl = req.url || '';
    if (!rawUrl.startsWith(basePath + '/')) return next?.();

    const url = new URL(rawUrl, 'http://localhost');
    const route = url.pathname.slice(basePath.length);
    const roomName = url.searchParams.get('room') || 'default';
    const clientId = url.searchParams.get('client') || '';

    // Same-origin in normal use; permissive so a separately-hosted relay works
    // without extra configuration. The relay carries no credentials and stores
    // nothing, so there is no cross-origin state to protect.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health stays open: it reports two counts and no room names, and it is what
    // an operator curls to find out whether the relay is up at all.
    if (route === '/health') {
      let clients = 0;
      for (const room of rooms.values()) clients += room.size;
      return json(res, 200, { ok: true, rooms: rooms.size, clients, auth: token ? 'token' : 'open' });
    }

    if (!tokenMatches(token, url.searchParams.get('t'))) {
      return json(res, 401, { error: 'bad or missing token' });
    }

    if (route === '/stream' && req.method === 'GET') {
      if (!clientId) return json(res, 400, { error: 'client required' });
      const room = roomOf(roomName);
      if (room.size >= MAX_CLIENTS_PER_ROOM && !room.has(clientId)) {
        return json(res, 503, { error: 'room full' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Defeats response buffering in nginx and friends, which would
        // otherwise hold events until the buffer filled.
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.write(': connected\n\n');

      // A reconnect from the same client replaces its previous stream.
      const previous = room.get(clientId);
      if (previous && previous !== res) {
        try {
          previous.end();
        } catch {
          /* already gone */
        }
      }
      room.set(clientId, res);

      const keepalive = setInterval(() => {
        if (!writeComment(res, 'keepalive')) {
          clearInterval(keepalive);
          dropClient(roomName, clientId);
        }
      }, KEEPALIVE_MS);

      const cleanup = () => {
        clearInterval(keepalive);
        if (rooms.get(roomName)?.get(clientId) === res) dropClient(roomName, clientId);
      };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return;
    }

    if (route === '/send' && req.method === 'POST') {
      readBody(req)
        .then((text) => {
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            return json(res, 400, { error: 'invalid json' });
          }
          const list = Array.isArray(parsed) ? parsed : [parsed];
          if (!list.length) return json(res, 204, {});

          // Group by recipient so a batch mixing broadcast and directed
          // messages still reaches exactly the right clients.
          const broadcast = [];
          const directed = new Map();
          for (const msg of list) {
            if (!msg || typeof msg !== 'object') continue;
            if (msg.to) {
              const bucket = directed.get(msg.to) ?? [];
              bucket.push(msg);
              directed.set(msg.to, bucket);
            } else {
              broadcast.push(msg);
            }
          }

          let sent = 0;
          if (broadcast.length) {
            sent += fanOut(roomName, clientId, JSON.stringify(broadcast), null);
          }
          for (const [to, msgs] of directed) {
            sent += fanOut(roomName, clientId, JSON.stringify(msgs), to);
          }
          return json(res, 200, { ok: true, delivered: sent });
        })
        .catch((err) => json(res, 413, { error: String(err?.message || err) }));
      return;
    }

    return json(res, 404, { error: 'unknown collab route' });
  };
}

/**
 * Vite plugin — mounts the relay inside the dev server, so `npm run dev` is the
 * whole setup on a LAN (the dev server already binds 0.0.0.0).
 */
export function collabRelayPlugin(options = {}) {
  return {
    name: 'pams8-collab-relay',
    configureServer(server) {
      server.middlewares.use(createCollabRelay(options));
      server.config.logger.info('  ➜  collab relay:  /collab/stream (SSE fan-out)');
    },
    // Also present for `vite preview`, so a built harness can be shared.
    configurePreviewServer(server) {
      server.middlewares.use(createCollabRelay(options));
    },
  };
}

// ── Standalone mode ─────────────────────────────────────────────────────────
// Runs only when this file is the entry point (`node collabRelay.js`), never
// when it is imported by vite.config.ts. pathToFileURL handles Windows drive
// letters, which a hand-built `file://` string does not.
const isEntryPoint =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) || 6600 : 6600;
  const relay = createCollabRelay();
  createServer((req, res) =>
    relay(req, res, () => {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('collab relay: use /collab/stream or /collab/send\n');
    }),
  ).listen(port, '0.0.0.0', () => {
    console.log(`[collab-relay] listening on http://0.0.0.0:${port}/collab`);
  });
}
