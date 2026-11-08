// vite.config.ts
import { fileURLToPath } from "url";
import { createReadStream, existsSync, stat } from "fs";
import { dirname, extname, resolve, sep } from "path";
import { defineConfig } from "file:///D:/Projects/PAMS8/node_modules/vite/dist/node/index.js";
import dts from "file:///D:/Projects/PAMS8/node_modules/vite-plugin-dts/dist/index.mjs";
import terser from "file:///D:/Projects/PAMS8/node_modules/@rollup/plugin-terser/dist/es/index.js";

// tools/collabRelay.js
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///D:/Projects/PAMS8/tools/collabRelay.js";
var MAX_BODY_BYTES = 8 * 1024 * 1024;
var KEEPALIVE_MS = 2e4;
var MAX_CLIENTS_PER_ROOM = 16;
var rooms = /* @__PURE__ */ new Map();
function roomOf(name) {
  let r = rooms.get(name);
  if (!r) {
    r = /* @__PURE__ */ new Map();
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
    res.write(`data: ${payload}

`);
    return true;
  } catch {
    return false;
  }
}
function writeComment(res, text) {
  try {
    res.write(`: ${text}

`);
    return true;
  } catch {
    return false;
  }
}
function tokenMatches(expected, given) {
  if (!expected) return true;
  const a = String(expected);
  const b = String(given || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
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
  return new Promise((resolve2, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store"
  });
  res.end(text);
}
function createCollabRelay(options = {}) {
  const basePath = (options.basePath || "/collab").replace(/\/+$/, "");
  const token = options.token || process.env.COLLAB_TOKEN || "";
  return function collabRelayMiddleware(req, res, next) {
    const rawUrl = req.url || "";
    if (!rawUrl.startsWith(basePath + "/")) return next?.();
    const url = new URL(rawUrl, "http://localhost");
    const route = url.pathname.slice(basePath.length);
    const roomName = url.searchParams.get("room") || "default";
    const clientId = url.searchParams.get("client") || "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (route === "/health") {
      let clients = 0;
      for (const room of rooms.values()) clients += room.size;
      return json(res, 200, { ok: true, rooms: rooms.size, clients, auth: token ? "token" : "open" });
    }
    if (!tokenMatches(token, url.searchParams.get("t"))) {
      return json(res, 401, { error: "bad or missing token" });
    }
    if (route === "/stream" && req.method === "GET") {
      if (!clientId) return json(res, 400, { error: "client required" });
      const room = roomOf(roomName);
      if (room.size >= MAX_CLIENTS_PER_ROOM && !room.has(clientId)) {
        return json(res, 503, { error: "room full" });
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Defeats response buffering in nginx and friends, which would
        // otherwise hold events until the buffer filled.
        "X-Accel-Buffering": "no"
      });
      res.flushHeaders?.();
      res.write(": connected\n\n");
      const previous = room.get(clientId);
      if (previous && previous !== res) {
        try {
          previous.end();
        } catch {
        }
      }
      room.set(clientId, res);
      const keepalive = setInterval(() => {
        if (!writeComment(res, "keepalive")) {
          clearInterval(keepalive);
          dropClient(roomName, clientId);
        }
      }, KEEPALIVE_MS);
      const cleanup = () => {
        clearInterval(keepalive);
        if (rooms.get(roomName)?.get(clientId) === res) dropClient(roomName, clientId);
      };
      req.on("close", cleanup);
      req.on("error", cleanup);
      return;
    }
    if (route === "/send" && req.method === "POST") {
      readBody(req).then((text) => {
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          return json(res, 400, { error: "invalid json" });
        }
        const list = Array.isArray(parsed) ? parsed : [parsed];
        if (!list.length) return json(res, 204, {});
        const broadcast = [];
        const directed = /* @__PURE__ */ new Map();
        for (const msg of list) {
          if (!msg || typeof msg !== "object") continue;
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
      }).catch((err) => json(res, 413, { error: String(err?.message || err) }));
      return;
    }
    return json(res, 404, { error: "unknown collab route" });
  };
}
function collabRelayPlugin(options = {}) {
  return {
    name: "pams8-collab-relay",
    configureServer(server) {
      server.middlewares.use(createCollabRelay(options));
      server.config.logger.info("  \u279C  collab relay:  /collab/stream (SSE fan-out)");
    },
    // Also present for `vite preview`, so a built harness can be shared.
    configurePreviewServer(server) {
      server.middlewares.use(createCollabRelay(options));
    }
  };
}
var isEntryPoint = !!process.argv[1] && __vite_injected_original_import_meta_url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg > -1 ? Number(process.argv[portArg + 1]) || 6600 : 6600;
  const relay = createCollabRelay();
  createServer(
    (req, res) => relay(req, res, () => {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("collab relay: use /collab/stream or /collab/send\n");
    })
  ).listen(port, "0.0.0.0", () => {
    console.log(`[collab-relay] listening on http://0.0.0.0:${port}/collab`);
  });
}

// vite.config.ts
var __vite_injected_original_import_meta_url2 = "file:///D:/Projects/PAMS8/vite.config.ts";
var __filename = fileURLToPath(__vite_injected_original_import_meta_url2);
var __dirname = dirname(__filename);
function terrainBundleDev() {
  const publicDir = resolve(__dirname, "public/terrain-bundle");
  const outDir = resolve(__dirname, "MS/Data/terrain-bundle");
  const types = {
    ".json": "application/json",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8"
  };
  return {
    name: "pams8-terrain-bundle-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/terrain-bundle", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = resolve(outDir, "." + rel);
        if (file !== outDir && !file.startsWith(outDir + sep)) return next();
        if (existsSync(resolve(publicDir, "." + rel))) return next();
        stat(file, (err, st) => {
          if (err || !st.isFile()) return next();
          res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
          res.setHeader("Content-Length", st.size);
          createReadStream(file).pipe(res);
        });
      });
    }
  };
}
var vite_config_default = defineConfig(({ mode }) => {
  const useDist = mode === "dist";
  return {
    resolve: {
      // Harness library imports use the `@lib/...` specifier; remap it per mode.
      alias: { "@lib": resolve(__dirname, useDist ? "dist/MS" : "MS") },
      // dist emits `*.min.js`; allow extensionless `@lib/...` specifiers to resolve it.
      extensions: useDist ? [".min.js", ".mjs", ".js", ".ts", ".json"] : [".mjs", ".js", ".ts", ".json"]
    },
    build: {
      target: "esnext",
      lib: {
        entry: resolve(__dirname, "MS/Engines/SymbolEngine.ts"),
        formats: ["es"]
      },
      outDir: "dist/MS",
      emptyOutDir: true,
      rollupOptions: {
        input: [
          resolve(__dirname, "MS/Engines/SymbolEngine.ts"),
          resolve(__dirname, "MS/ThirdParty/MilSymbols/UEITypes.ts")
        ],
        output: {
          preserveModules: true,
          preserveModulesRoot: "MS",
          entryFileNames: "[name].min.js"
        },
        external: [
          /^@arcgis\//
        ],
        plugins: [
          terser({
            compress: {
              passes: 3,
              // Multiple passes over the code for deeper optimization
              // Strip debug chatter but KEEP console.warn/error — the shipped
              // library must still be able to report failures to host apps
              // (drop_console: true silenced those too).
              pure_funcs: ["console.log", "console.debug", "console.info", "console.trace"],
              drop_debugger: true,
              // Remove debugger statements
              pure_getters: true,
              // Treat getter functions as pure for better optimization
              unsafe: true,
              // Enable potentially unsafe optimizations
              unsafe_comps: true,
              // Optimize comparisons (e.g., 'a' == 'b' can be simplified)
              unsafe_math: true,
              // Perform aggressive math optimizations
              unsafe_proto: true,
              // Optimize prototype chain manipulation
              unsafe_regexp: true,
              // Enable unsafe regex optimizations
              booleans: true,
              // Simplify boolean expressions
              loops: true,
              // Optimize loops aggressively
              dead_code: true,
              // Remove dead code (code that's never executed)
              keep_fargs: false,
              // Remove unused function arguments
              reduce_vars: true,
              // Reduce variable references (for better compression)
              toplevel: true
              // Perform top-level optimizations
            },
            mangle: {
              toplevel: true
              // Mangle top-level variable names (chunk-local, safe)
              // Property mangling REMOVED. With preserveModules,
              // @rollup/plugin-terser minifies each chunk with an independent
              // name table, so `_`-prefixed methods/props shared across modules
              // (e.g. GeoTools._2PtLen / _vertexAngle / _ptCollectionLen, called
              // from MainAttack, PhaseLine, …) got DIFFERENT mangled names in the
              // caller vs the definition → "not a function" at runtime, swallowed by
              // try/catch + drop_console → symbols silently failed to draw in dist.
              // Property mangling is incompatible with code-splitting; do not re-add.
            },
            format: {
              comments: false,
              // Remove all comments
              beautify: false,
              // Ensure no beautification for compact output
              max_line_len: 32e3,
              // Prevent line breaking
              indent_level: 0
              // Remove unnecessary indentation
            }
          })
        ]
      },
      minify: false
      // handled by terser plugin instead
    },
    server: {
      host: "0.0.0.0",
      // Different port per mode so source (:6547) and dist (:6548) can run together.
      // PORT env override lets multiple concurrent dev-tool sessions each get an
      // auto-assigned free port instead of colliding on the fixed default.
      port: Number(process.env.PORT) || (useDist ? 6548 : 6547),
      // Vite's watcher crawls the whole project root. The Ground Guide's terrain bundle is ~390k
      // static tiles and the terrain pipeline's work/ and .venv/ hold GBs of rasters and packages;
      // watching them stalls the server at ~2.5 GB and they are never modules.
      watch: {
        ignored: [
          "**/public/terrain-bundle/**",
          "**/MS/Data/terrain-bundle/**",
          "**/tools/terrain-pipeline/out/**",
          "**/tools/terrain-pipeline/work/**",
          "**/tools/terrain-pipeline/.venv/**"
        ]
      },
      proxy: {
        // Road-network ArcGIS Server (RoadNetwork MapServer + NAServer).
        // A DIFFERENT box from the `/arcgis` basemap server below, so it
        // keeps its own prefix. Same constraints though — no CORS headers
        // and a self-signed cert — hence the same-origin proxy with
        // `secure:false`. The rewrite strips only the `/roadnet` prefix, so
        // `/roadnet/arcgis/rest/...` reaches the server as `/arcgis/rest/...`.
        // GeoCore (this repo's companion routing server, an ArcGIS NAServer with military
        // travel modes). Point roadNetwork.naServerUrl at
        // `/geocore/arcgis/rest/services/roads/NAServer` to use it; GEOCORE_URL picks another host.
        "/geocore": {
          target: process.env.GEOCORE_URL || "http://localhost:8738",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/geocore/, "")
        },
        "/roadnet": {
          target: "https://192.168.0.15:6443",
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/roadnet/, "")
        },
        // Local ArcGIS Server (Pakistan MapServer). It ships no CORS headers
        // and uses a self-signed cert, so the browser cannot fetch it directly.
        // Proxy it same-origin through Vite instead: `secure:false` accepts the
        // self-signed cert, and the `/arcgis` prefix maps 1:1 to the target so
        // no path rewrite is needed. main.ts points the layer at `/arcgis/...`.
        "/arcgis": {
          target: "https://localhost:6443",
          changeOrigin: true,
          secure: false
        }
      }
    },
    plugins: [
      collabRelayPlugin(),
      terrainBundleDev(),
      dts({
        entryRoot: "MS",
        outDir: "dist/MS",
        tsconfigPath: "tsconfig.build.json"
      })
    ]
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAidG9vbHMvY29sbGFiUmVsYXkuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxQcm9qZWN0c1xcXFxQQU1TOFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRDpcXFxcUHJvamVjdHNcXFxcUEFNUzhcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0Q6L1Byb2plY3RzL1BBTVM4L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gJ3VybCc7XHJcbmltcG9ydCB7IGNyZWF0ZVJlYWRTdHJlYW0sIGV4aXN0c1N5bmMsIHN0YXQgfSBmcm9tICdmcyc7XHJcbmltcG9ydCB7IGRpcm5hbWUsIGV4dG5hbWUsIHJlc29sdmUsIHNlcCB9IGZyb20gJ3BhdGgnO1xyXG5pbXBvcnQgeyBkZWZpbmVDb25maWcsIHR5cGUgUGx1Z2luIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCBkdHMgZnJvbSAndml0ZS1wbHVnaW4tZHRzJztcclxuaW1wb3J0IHRlcnNlciBmcm9tICdAcm9sbHVwL3BsdWdpbi10ZXJzZXInO1xyXG4vLyBDb2xsYWJvcmF0aW9uIGZhbi1vdXQgcmVsYXkuIEJ1aWxkLXRpbWUgdG9vbGluZywgc28gaXQgbGl2ZXMgaW4gdG9vbHMvIHJhdGhlclxyXG4vLyB0aGFuIGluIE1TLyBcdTIwMTQgTVMvIHN0YXlzIHB1cmVseSBjbGllbnQtc2lkZSBsaWJyYXJ5IGNvZGUgYW5kIG5vIHNlcnZlciBmaWxlXHJcbi8vIGxlYWtzIGludG8gZGlzdC8uIE1vdW50aW5nIGl0IGhlcmUgaXMgd2hhdCBrZWVwcyBjb2xsYWJvcmF0aW9uIGZyZWUgb2YgYSBzZWNvbmRcclxuLy8gcHJvY2VzczsgdGhlIGFsdGVybmF0aXZlIGlzIGBucG0gcnVuIHJlbGF5YCBwbHVzIGEgYGNvbGxhYi5yZWxheVVybGAgc2V0dGluZy5cclxuLy8gRGVsZXRlIHRoaXMgaW1wb3J0IGFuZCB0aGUgcGx1Z2luIGVudHJ5IGJlbG93IHRvIHVucGx1ZyB0aGUgc2VydmVyIHNpZGUuXHJcbmltcG9ydCB7IGNvbGxhYlJlbGF5UGx1Z2luIH0gZnJvbSAnLi90b29scy9jb2xsYWJSZWxheS5qcyc7XHJcblxyXG5jb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xyXG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKF9fZmlsZW5hbWUpO1xyXG5cclxuLy8gRGV2LW9ubHk6IHNlcnZlIHRoZSBHcm91bmQgR3VpZGUncyB0ZXJyYWluIGJ1bmRsZSBhdCAvdGVycmFpbi1idW5kbGUgc3RyYWlnaHQgZnJvbSBNUy9EYXRhL3RlcnJhaW4tYnVuZGxlXHJcbi8vICh3aGVyZSB0aGUgcGlwZWxpbmUgd3JpdGVzIGl0KSB1bmxlc3MgdGhlIHJlcXVlc3RlZCBmaWxlIGV4aXN0cyB1bmRlciBwdWJsaWMvdGVycmFpbi1idW5kbGUuIFRoZSByZWFsIGJ1bmRsZSBpc1xyXG4vLyB+MzkwayB0aWxlcywgYW5kIFZpdGUgaW5kZXhlcyBldmVyeXRoaW5nIHVuZGVyIHB1YmxpYy8gKGFuZCB3YXRjaGVzIGl0KSwgd2hpY2ggZXhoYXVzdHMgbWVtb3J5IGFuZCBoYW5ncyB0aGVcclxuLy8gc2VydmVyOyB0aGUgc21hbGwgc3ludGhldGljIGJ1bmRsZSAobm9kZSB0b29scy90ZXJyYWluLXN5bnRoLm1qcykgc3RpbGwgZ29lcyBpbiBwdWJsaWMvIGFzIGJlZm9yZSBhbmQgd2lucyB3aGVuXHJcbi8vIHByZXNlbnQuIFRoYXQgaXMgZGVjaWRlZCBwZXIgcmVxdWVzdCwgbm90IG9uY2UgYXQgc3RhcnR1cDogYSBzZXJ2ZXIgc3RhcnRlZCB3aGlsZSBhIHN5bnRoZXRpYyBidW5kbGUgaGFwcGVuZWQgdG9cclxuLy8gYmUgaW4gcHVibGljLyB1c2VkIHRvIGhhdmUgbm8gcm91dGUgdG8gdGhlIHJlYWwgb25lIGF0IGFsbCwgZXZlbiBhZnRlciB0aGUgc3ludGhldGljIGZvbGRlciB3YXMgZGVsZXRlZC5cclxuZnVuY3Rpb24gdGVycmFpbkJ1bmRsZURldigpOiBQbHVnaW4ge1xyXG4gICAgY29uc3QgcHVibGljRGlyID0gcmVzb2x2ZShfX2Rpcm5hbWUsICdwdWJsaWMvdGVycmFpbi1idW5kbGUnKTtcclxuICAgIGNvbnN0IG91dERpciA9IHJlc29sdmUoX19kaXJuYW1lLCAnTVMvRGF0YS90ZXJyYWluLWJ1bmRsZScpO1xyXG4gICAgY29uc3QgdHlwZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XHJcbiAgICAgICAgJy5qc29uJzogJ2FwcGxpY2F0aW9uL2pzb24nLCAnLnBuZyc6ICdpbWFnZS9wbmcnLCAnLnR4dCc6ICd0ZXh0L3BsYWluOyBjaGFyc2V0PXV0Zi04JyxcclxuICAgIH07XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIG5hbWU6ICdwYW1zOC10ZXJyYWluLWJ1bmRsZS1kZXYnLFxyXG4gICAgICAgIGFwcGx5OiAnc2VydmUnLFxyXG4gICAgICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcclxuICAgICAgICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZSgnL3RlcnJhaW4tYnVuZGxlJywgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCByZWwgPSBkZWNvZGVVUklDb21wb25lbnQoKHJlcS51cmwgPz8gJy8nKS5zcGxpdCgnPycpWzBdKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZpbGUgPSByZXNvbHZlKG91dERpciwgJy4nICsgcmVsKTtcclxuICAgICAgICAgICAgICAgIGlmIChmaWxlICE9PSBvdXREaXIgJiYgIWZpbGUuc3RhcnRzV2l0aChvdXREaXIgKyBzZXApKSByZXR1cm4gbmV4dCgpO1xyXG4gICAgICAgICAgICAgICAgLy8gQSBmaWxlIG9mIHRoZSBzYW1lIG5hbWUgdW5kZXIgcHVibGljLyAodGhlIHN5bnRoZXRpYyBkZXYgYnVuZGxlKSBpcyBsZWZ0IHRvIFZpdGUncyBvd24gc3RhdGljIHNlcnZpbmcuXHJcbiAgICAgICAgICAgICAgICBpZiAoZXhpc3RzU3luYyhyZXNvbHZlKHB1YmxpY0RpciwgJy4nICsgcmVsKSkpIHJldHVybiBuZXh0KCk7XHJcbiAgICAgICAgICAgICAgICBzdGF0KGZpbGUsIChlcnIsIHN0KSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGVyciB8fCAhc3QuaXNGaWxlKCkpIHJldHVybiBuZXh0KCk7ICAgLy8gbWlzc2luZyB0aWxlID0gbm8gY292ZXJhZ2U7IHRoZSBjbGllbnQgdHJlYXRzIGEgbm9uLWltYWdlIGFzIHN1Y2hcclxuICAgICAgICAgICAgICAgICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCB0eXBlc1tleHRuYW1lKGZpbGUpXSA/PyAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmVzLnNldEhlYWRlcignQ29udGVudC1MZW5ndGgnLCBzdC5zaXplKTtcclxuICAgICAgICAgICAgICAgICAgICBjcmVhdGVSZWFkU3RyZWFtKGZpbGUpLnBpcGUocmVzKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9LFxyXG4gICAgfTtcclxufVxyXG5cclxuLy8gYG5wbSBydW4gZGV2YCAgICAgICAgXHUyMTkyIHNlcnZlcyB0aGUgaGFybmVzcyBhZ2FpbnN0IHRoZSBNUy8gVHlwZVNjcmlwdCBzb3VyY2UuXHJcbi8vIGBucG0gcnVuIGRldjpkaXN0YCAgIFx1MjE5MiBydW5zIHdpdGggYC0tbW9kZSBkaXN0YDsgdGhlIGBAbGliYCBhbGlhcyBpcyByZXBvaW50ZWQgYXRcclxuLy8gICB0aGUgYnVpbHQgZGlzdC9NUy8qLm1pbi5qcyBzbyB0aGUgU0FNRSBoYXJuZXNzIGV4ZXJjaXNlcyB0aGUgc2hpcHBlZCBvdXRwdXRcclxuLy8gICAoY2F0Y2hlcyB0ZXJzZXIgYF9gLXByb3BlcnR5IG1hbmdsaW5nLCB0cmVlLXNoYWtpbmcsIG1pc3NpbmctZXhwb3J0IGRpdmVyZ2VuY2VzKS5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKCh7IG1vZGUgfSkgPT4ge1xyXG4gICAgY29uc3QgdXNlRGlzdCA9IG1vZGUgPT09ICdkaXN0JztcclxuICAgIHJldHVybiB7XHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgLy8gSGFybmVzcyBsaWJyYXJ5IGltcG9ydHMgdXNlIHRoZSBgQGxpYi8uLi5gIHNwZWNpZmllcjsgcmVtYXAgaXQgcGVyIG1vZGUuXHJcbiAgICAgICAgYWxpYXM6IHsgJ0BsaWInOiByZXNvbHZlKF9fZGlybmFtZSwgdXNlRGlzdCA/ICdkaXN0L01TJyA6ICdNUycpIH0sXHJcbiAgICAgICAgLy8gZGlzdCBlbWl0cyBgKi5taW4uanNgOyBhbGxvdyBleHRlbnNpb25sZXNzIGBAbGliLy4uLmAgc3BlY2lmaWVycyB0byByZXNvbHZlIGl0LlxyXG4gICAgICAgIGV4dGVuc2lvbnM6IHVzZURpc3RcclxuICAgICAgICAgICAgPyBbJy5taW4uanMnLCAnLm1qcycsICcuanMnLCAnLnRzJywgJy5qc29uJ11cclxuICAgICAgICAgICAgOiBbJy5tanMnLCAnLmpzJywgJy50cycsICcuanNvbiddLFxyXG4gICAgfSxcclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgICAgdGFyZ2V0OiAnZXNuZXh0JyxcclxuICAgICAgICBsaWI6IHtcclxuICAgICAgICAgICAgZW50cnk6IHJlc29sdmUoX19kaXJuYW1lLCAnTVMvRW5naW5lcy9TeW1ib2xFbmdpbmUudHMnKSxcclxuICAgICAgICAgICAgZm9ybWF0czogWydlcyddLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgb3V0RGlyOiAnZGlzdC9NUycsXHJcbiAgICAgICAgZW1wdHlPdXREaXI6IHRydWUsXHJcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgICAgICBpbnB1dDogW1xyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsICdNUy9FbmdpbmVzL1N5bWJvbEVuZ2luZS50cycpLFxyXG4gICAgICAgICAgICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsICdNUy9UaGlyZFBhcnR5L01pbFN5bWJvbHMvVUVJVHlwZXMudHMnKSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICAgICAgICBwcmVzZXJ2ZU1vZHVsZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgICBwcmVzZXJ2ZU1vZHVsZXNSb290OiAnTVMnLFxyXG4gICAgICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdbbmFtZV0ubWluLmpzJyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgZXh0ZXJuYWw6IFtcclxuICAgICAgICAgICAgICAgIC9eQGFyY2dpc1xcLy8sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICAgIHBsdWdpbnM6IFtcclxuICAgICAgICAgICAgICAgIHRlcnNlcih7XHJcbiAgICAgICAgICAgICAgICAgICAgY29tcHJlc3M6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFzc2VzOiAzLCAgICAgICAgICAgICAgIC8vIE11bHRpcGxlIHBhc3NlcyBvdmVyIHRoZSBjb2RlIGZvciBkZWVwZXIgb3B0aW1pemF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFN0cmlwIGRlYnVnIGNoYXR0ZXIgYnV0IEtFRVAgY29uc29sZS53YXJuL2Vycm9yIFx1MjAxNCB0aGUgc2hpcHBlZFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBsaWJyYXJ5IG11c3Qgc3RpbGwgYmUgYWJsZSB0byByZXBvcnQgZmFpbHVyZXMgdG8gaG9zdCBhcHBzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIChkcm9wX2NvbnNvbGU6IHRydWUgc2lsZW5jZWQgdGhvc2UgdG9vKS5cclxuICAgICAgICAgICAgICAgICAgICAgICAgcHVyZV9mdW5jczogWydjb25zb2xlLmxvZycsICdjb25zb2xlLmRlYnVnJywgJ2NvbnNvbGUuaW5mbycsICdjb25zb2xlLnRyYWNlJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRyb3BfZGVidWdnZXI6IHRydWUsICAgICAvLyBSZW1vdmUgZGVidWdnZXIgc3RhdGVtZW50c1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwdXJlX2dldHRlcnM6IHRydWUsICAgICAgLy8gVHJlYXQgZ2V0dGVyIGZ1bmN0aW9ucyBhcyBwdXJlIGZvciBiZXR0ZXIgb3B0aW1pemF0aW9uXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVuc2FmZTogdHJ1ZSwgICAgICAgICAgICAvLyBFbmFibGUgcG90ZW50aWFsbHkgdW5zYWZlIG9wdGltaXphdGlvbnNcclxuICAgICAgICAgICAgICAgICAgICAgICAgdW5zYWZlX2NvbXBzOiB0cnVlLCAgICAgIC8vIE9wdGltaXplIGNvbXBhcmlzb25zIChlLmcuLCAnYScgPT0gJ2InIGNhbiBiZSBzaW1wbGlmaWVkKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1bnNhZmVfbWF0aDogdHJ1ZSwgICAgICAgLy8gUGVyZm9ybSBhZ2dyZXNzaXZlIG1hdGggb3B0aW1pemF0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB1bnNhZmVfcHJvdG86IHRydWUsICAgICAgLy8gT3B0aW1pemUgcHJvdG90eXBlIGNoYWluIG1hbmlwdWxhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICB1bnNhZmVfcmVnZXhwOiB0cnVlLCAgICAgLy8gRW5hYmxlIHVuc2FmZSByZWdleCBvcHRpbWl6YXRpb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJvb2xlYW5zOiB0cnVlLCAgICAgICAgICAvLyBTaW1wbGlmeSBib29sZWFuIGV4cHJlc3Npb25zXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxvb3BzOiB0cnVlLCAgICAgICAgICAgICAvLyBPcHRpbWl6ZSBsb29wcyBhZ2dyZXNzaXZlbHlcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVhZF9jb2RlOiB0cnVlLCAgICAgICAgIC8vIFJlbW92ZSBkZWFkIGNvZGUgKGNvZGUgdGhhdCdzIG5ldmVyIGV4ZWN1dGVkKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBrZWVwX2ZhcmdzOiBmYWxzZSwgICAgICAgLy8gUmVtb3ZlIHVudXNlZCBmdW5jdGlvbiBhcmd1bWVudHNcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmVkdWNlX3ZhcnM6IHRydWUsICAgICAgIC8vIFJlZHVjZSB2YXJpYWJsZSByZWZlcmVuY2VzIChmb3IgYmV0dGVyIGNvbXByZXNzaW9uKVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0b3BsZXZlbDogdHJ1ZSAgICAgICAgICAgLy8gUGVyZm9ybSB0b3AtbGV2ZWwgb3B0aW1pemF0aW9uc1xyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgbWFuZ2xlOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvcGxldmVsOiB0cnVlLCAgICAgICAgICAvLyBNYW5nbGUgdG9wLWxldmVsIHZhcmlhYmxlIG5hbWVzIChjaHVuay1sb2NhbCwgc2FmZSlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gUHJvcGVydHkgbWFuZ2xpbmcgUkVNT1ZFRC4gV2l0aCBwcmVzZXJ2ZU1vZHVsZXMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEByb2xsdXAvcGx1Z2luLXRlcnNlciBtaW5pZmllcyBlYWNoIGNodW5rIHdpdGggYW4gaW5kZXBlbmRlbnRcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gbmFtZSB0YWJsZSwgc28gYF9gLXByZWZpeGVkIG1ldGhvZHMvcHJvcHMgc2hhcmVkIGFjcm9zcyBtb2R1bGVzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIChlLmcuIEdlb1Rvb2xzLl8yUHRMZW4gLyBfdmVydGV4QW5nbGUgLyBfcHRDb2xsZWN0aW9uTGVuLCBjYWxsZWRcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gZnJvbSBNYWluQXR0YWNrLCBQaGFzZUxpbmUsIFx1MjAyNikgZ290IERJRkZFUkVOVCBtYW5nbGVkIG5hbWVzIGluIHRoZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjYWxsZXIgdnMgdGhlIGRlZmluaXRpb24gXHUyMTkyIFwibm90IGEgZnVuY3Rpb25cIiBhdCBydW50aW1lLCBzd2FsbG93ZWQgYnlcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gdHJ5L2NhdGNoICsgZHJvcF9jb25zb2xlIFx1MjE5MiBzeW1ib2xzIHNpbGVudGx5IGZhaWxlZCB0byBkcmF3IGluIGRpc3QuXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFByb3BlcnR5IG1hbmdsaW5nIGlzIGluY29tcGF0aWJsZSB3aXRoIGNvZGUtc3BsaXR0aW5nOyBkbyBub3QgcmUtYWRkLlxyXG4gICAgICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICAgICAgZm9ybWF0OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbW1lbnRzOiBmYWxzZSwgICAgICAgICAvLyBSZW1vdmUgYWxsIGNvbW1lbnRzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlYXV0aWZ5OiBmYWxzZSwgICAgICAgICAvLyBFbnN1cmUgbm8gYmVhdXRpZmljYXRpb24gZm9yIGNvbXBhY3Qgb3V0cHV0XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1heF9saW5lX2xlbjogMzIwMDAsICAgICAvLyBQcmV2ZW50IGxpbmUgYnJlYWtpbmdcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZW50X2xldmVsOiAwICAgICAgICAgIC8vIFJlbW92ZSB1bm5lY2Vzc2FyeSBpbmRlbnRhdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBtaW5pZnk6IGZhbHNlLCAvLyBoYW5kbGVkIGJ5IHRlcnNlciBwbHVnaW4gaW5zdGVhZFxyXG4gICAgfSxcclxuICAgIHNlcnZlcjoge1xyXG4gICAgICAgIGhvc3Q6IFwiMC4wLjAuMFwiLFxyXG4gICAgICAgIC8vIERpZmZlcmVudCBwb3J0IHBlciBtb2RlIHNvIHNvdXJjZSAoOjY1NDcpIGFuZCBkaXN0ICg6NjU0OCkgY2FuIHJ1biB0b2dldGhlci5cclxuICAgICAgICAvLyBQT1JUIGVudiBvdmVycmlkZSBsZXRzIG11bHRpcGxlIGNvbmN1cnJlbnQgZGV2LXRvb2wgc2Vzc2lvbnMgZWFjaCBnZXQgYW5cclxuICAgICAgICAvLyBhdXRvLWFzc2lnbmVkIGZyZWUgcG9ydCBpbnN0ZWFkIG9mIGNvbGxpZGluZyBvbiB0aGUgZml4ZWQgZGVmYXVsdC5cclxuICAgICAgICBwb3J0OiBOdW1iZXIocHJvY2Vzcy5lbnYuUE9SVCkgfHwgKHVzZURpc3QgPyA2NTQ4IDogNjU0NyksXHJcbiAgICAgICAgLy8gVml0ZSdzIHdhdGNoZXIgY3Jhd2xzIHRoZSB3aG9sZSBwcm9qZWN0IHJvb3QuIFRoZSBHcm91bmQgR3VpZGUncyB0ZXJyYWluIGJ1bmRsZSBpcyB+Mzkwa1xyXG4gICAgICAgIC8vIHN0YXRpYyB0aWxlcyBhbmQgdGhlIHRlcnJhaW4gcGlwZWxpbmUncyB3b3JrLyBhbmQgLnZlbnYvIGhvbGQgR0JzIG9mIHJhc3RlcnMgYW5kIHBhY2thZ2VzO1xyXG4gICAgICAgIC8vIHdhdGNoaW5nIHRoZW0gc3RhbGxzIHRoZSBzZXJ2ZXIgYXQgfjIuNSBHQiBhbmQgdGhleSBhcmUgbmV2ZXIgbW9kdWxlcy5cclxuICAgICAgICB3YXRjaDoge1xyXG4gICAgICAgICAgICBpZ25vcmVkOiBbXHJcbiAgICAgICAgICAgICAgICAnKiovcHVibGljL3RlcnJhaW4tYnVuZGxlLyoqJyxcclxuICAgICAgICAgICAgICAgICcqKi9NUy9EYXRhL3RlcnJhaW4tYnVuZGxlLyoqJyxcclxuICAgICAgICAgICAgICAgICcqKi90b29scy90ZXJyYWluLXBpcGVsaW5lL291dC8qKicsXHJcbiAgICAgICAgICAgICAgICAnKiovdG9vbHMvdGVycmFpbi1waXBlbGluZS93b3JrLyoqJyxcclxuICAgICAgICAgICAgICAgICcqKi90b29scy90ZXJyYWluLXBpcGVsaW5lLy52ZW52LyoqJyxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHByb3h5OiB7XHJcbiAgICAgICAgICAgIC8vIFJvYWQtbmV0d29yayBBcmNHSVMgU2VydmVyIChSb2FkTmV0d29yayBNYXBTZXJ2ZXIgKyBOQVNlcnZlcikuXHJcbiAgICAgICAgICAgIC8vIEEgRElGRkVSRU5UIGJveCBmcm9tIHRoZSBgL2FyY2dpc2AgYmFzZW1hcCBzZXJ2ZXIgYmVsb3csIHNvIGl0XHJcbiAgICAgICAgICAgIC8vIGtlZXBzIGl0cyBvd24gcHJlZml4LiBTYW1lIGNvbnN0cmFpbnRzIHRob3VnaCBcdTIwMTQgbm8gQ09SUyBoZWFkZXJzXHJcbiAgICAgICAgICAgIC8vIGFuZCBhIHNlbGYtc2lnbmVkIGNlcnQgXHUyMDE0IGhlbmNlIHRoZSBzYW1lLW9yaWdpbiBwcm94eSB3aXRoXHJcbiAgICAgICAgICAgIC8vIGBzZWN1cmU6ZmFsc2VgLiBUaGUgcmV3cml0ZSBzdHJpcHMgb25seSB0aGUgYC9yb2FkbmV0YCBwcmVmaXgsIHNvXHJcbiAgICAgICAgICAgIC8vIGAvcm9hZG5ldC9hcmNnaXMvcmVzdC8uLi5gIHJlYWNoZXMgdGhlIHNlcnZlciBhcyBgL2FyY2dpcy9yZXN0Ly4uLmAuXHJcbiAgICAgICAgICAgIC8vIEdlb0NvcmUgKHRoaXMgcmVwbydzIGNvbXBhbmlvbiByb3V0aW5nIHNlcnZlciwgYW4gQXJjR0lTIE5BU2VydmVyIHdpdGggbWlsaXRhcnlcclxuICAgICAgICAgICAgLy8gdHJhdmVsIG1vZGVzKS4gUG9pbnQgcm9hZE5ldHdvcmsubmFTZXJ2ZXJVcmwgYXRcclxuICAgICAgICAgICAgLy8gYC9nZW9jb3JlL2FyY2dpcy9yZXN0L3NlcnZpY2VzL3JvYWRzL05BU2VydmVyYCB0byB1c2UgaXQ7IEdFT0NPUkVfVVJMIHBpY2tzIGFub3RoZXIgaG9zdC5cclxuICAgICAgICAgICAgJy9nZW9jb3JlJzoge1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiBwcm9jZXNzLmVudi5HRU9DT1JFX1VSTCB8fCAnaHR0cDovL2xvY2FsaG9zdDo4NzM4JyxcclxuICAgICAgICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHJld3JpdGU6IChwKSA9PiBwLnJlcGxhY2UoL15cXC9nZW9jb3JlLywgJycpLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAnL3JvYWRuZXQnOiB7XHJcbiAgICAgICAgICAgICAgICB0YXJnZXQ6ICdodHRwczovLzE5Mi4xNjguMC4xNTo2NDQzJyxcclxuICAgICAgICAgICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIHNlY3VyZTogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICByZXdyaXRlOiAocCkgPT4gcC5yZXBsYWNlKC9eXFwvcm9hZG5ldC8sICcnKSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgLy8gTG9jYWwgQXJjR0lTIFNlcnZlciAoUGFraXN0YW4gTWFwU2VydmVyKS4gSXQgc2hpcHMgbm8gQ09SUyBoZWFkZXJzXHJcbiAgICAgICAgICAgIC8vIGFuZCB1c2VzIGEgc2VsZi1zaWduZWQgY2VydCwgc28gdGhlIGJyb3dzZXIgY2Fubm90IGZldGNoIGl0IGRpcmVjdGx5LlxyXG4gICAgICAgICAgICAvLyBQcm94eSBpdCBzYW1lLW9yaWdpbiB0aHJvdWdoIFZpdGUgaW5zdGVhZDogYHNlY3VyZTpmYWxzZWAgYWNjZXB0cyB0aGVcclxuICAgICAgICAgICAgLy8gc2VsZi1zaWduZWQgY2VydCwgYW5kIHRoZSBgL2FyY2dpc2AgcHJlZml4IG1hcHMgMToxIHRvIHRoZSB0YXJnZXQgc29cclxuICAgICAgICAgICAgLy8gbm8gcGF0aCByZXdyaXRlIGlzIG5lZWRlZC4gbWFpbi50cyBwb2ludHMgdGhlIGxheWVyIGF0IGAvYXJjZ2lzLy4uLmAuXHJcbiAgICAgICAgICAgICcvYXJjZ2lzJzoge1xyXG4gICAgICAgICAgICAgICAgdGFyZ2V0OiAnaHR0cHM6Ly9sb2NhbGhvc3Q6NjQ0MycsXHJcbiAgICAgICAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgICAgICAgICBzZWN1cmU6IGZhbHNlLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgcGx1Z2luczogW1xyXG4gICAgICAgIGNvbGxhYlJlbGF5UGx1Z2luKCksXHJcbiAgICAgICAgdGVycmFpbkJ1bmRsZURldigpLFxyXG4gICAgICAgIGR0cyh7XHJcbiAgICAgICAgICAgIGVudHJ5Um9vdDogJ01TJyxcclxuICAgICAgICAgICAgb3V0RGlyOiAnZGlzdC9NUycsXHJcbiAgICAgICAgICAgIHRzY29uZmlnUGF0aDogJ3RzY29uZmlnLmJ1aWxkLmpzb24nLFxyXG4gICAgICAgIH0pLFxyXG4gICAgXSxcclxuICAgIH07XHJcbn0pO1xyXG5cclxuXHJcbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRDpcXFxcUHJvamVjdHNcXFxcUEFNUzhcXFxcdG9vbHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkQ6XFxcXFByb2plY3RzXFxcXFBBTVM4XFxcXHRvb2xzXFxcXGNvbGxhYlJlbGF5LmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9Qcm9qZWN0cy9QQU1TOC90b29scy9jb2xsYWJSZWxheS5qc1wiOy8qKlxyXG4gKiBjb2xsYWJSZWxheS5qc1xyXG4gKlxyXG4gKiBUaGUgb25seSBzZXJ2ZXItc2lkZSBjb2RlIHRoZSBDb2xsYWIgZW5naW5lIG5lZWRzOiBhIHN0YXRlbGVzcyBmYW4tb3V0IHJlbGF5LlxyXG4gKiB+MTUwIGxpbmVzLCBubyBucG0gZGVwZW5kZW5jaWVzIChub2RlOmh0dHAgb25seSksIG5vIGRhdGFiYXNlLCBubyBwZXJzaXN0ZW5jZS5cclxuICogSXQgbmV2ZXIgaW5zcGVjdHMgb3Igc3RvcmVzIGEgbWVzc2FnZSBcdTIwMTQgaXQgZm9yd2FyZHMgZWFjaCBvbmUgdG8gdGhlIG90aGVyXHJcbiAqIG1lbWJlcnMgb2YgdGhlIHNhbWUgcm9vbSBhbmQgZm9yZ2V0cyBpdC5cclxuICpcclxuICogV2h5IFNTRSArIFBPU1QgcmF0aGVyIHRoYW4gV2ViU29ja2V0OiBhIFdlYlNvY2tldCBzZXJ2ZXIgbmVlZHMgZWl0aGVyIGFcclxuICogZGVwZW5kZW5jeSAoYHdzYCkgb3IgYSBoYW5kLXJvbGxlZCBmcmFtZSBwYXJzZXIsIHdoaWxlIFNTRSBkb3duc3RyZWFtICsgUE9TVFxyXG4gKiB1cHN0cmVhbSBpcyBwbGFpbiBIVFRQIHRoYXQgbW91bnRzIGFzIG9yZGluYXJ5IG1pZGRsZXdhcmUuIFRoYXQgbWVhbnMgaXQgcmlkZXNcclxuICogaW5zaWRlIHRoZSBWaXRlIGRldiBzZXJ2ZXIgaW4gZGV2ZWxvcG1lbnQgXHUyMDE0IG5vIHNlY29uZCBwcm9jZXNzIHRvIHN0YXJ0IFx1MjAxNCBhbmRcclxuICogdGhlIGlkZW50aWNhbCBtaWRkbGV3YXJlIG1vdW50cyBvbiB3aGF0ZXZlciBzZXJ2ZXMgZGlzdC8gaW4gcHJvZHVjdGlvbi4gT24gYVxyXG4gKiBMQU4gdGhlIHJvdW5kIHRyaXAgaXMgYSBmZXcgbWlsbGlzZWNvbmRzLCBjb21mb3J0YWJseSBlbm91Z2ggZm9yIDIwIEh6IGN1cnNvcnMuXHJcbiAqXHJcbiAqIFRocmVlIHdheXMgdG8gcnVuIGl0OlxyXG4gKlxyXG4gKiAgIDEuIFZpdGUgZGV2IChub3RoaW5nIHRvIGRvIFx1MjAxNCBhbHJlYWR5IHdpcmVkIGluIHZpdGUuY29uZmlnLnRzKTpcclxuICogICAgICAgIG5wbSBydW4gZGV2ICAgICAgICAgICAgXHUyMTkyIGh0dHA6Ly88aG9zdD46NjU0N1xyXG4gKlxyXG4gKiAgIDIuIFN0YW5kYWxvbmUgXHUyMDE0IGZvciBhIHByb2R1Y3Rpb24gaG9zdCwgb3IgaWYgeW91IHdvdWxkIHJhdGhlciB2aXRlLmNvbmZpZy50c1xyXG4gKiAgICAgIGtuZXcgbm90aGluZyBhYm91dCB0aGlzIGZpbGUgKGRlbGV0ZSB0aGUgcGx1Z2luIGVudHJ5IHRoZXJlKTpcclxuICogICAgICAgIG5wbSBydW4gcmVsYXkgICAgICAgICAgXHUyMTkyIGh0dHA6Ly88aG9zdD46NjYwMFxyXG4gKiAgICAgIHRoZW4gcG9pbnQgU2V0dGluZ3MuanNvbiBcdTIxOTIgY29sbGFiLnJlbGF5VXJsIGF0IGh0dHA6Ly88aG9zdD46NjYwMFxyXG4gKlxyXG4gKiAgIDMuIE1vdW50ZWQgaW4geW91ciBvd24gTm9kZS9FeHByZXNzL0Nvbm5lY3Qgc2VydmVyOlxyXG4gKiAgICAgICAgaW1wb3J0IHsgY3JlYXRlQ29sbGFiUmVsYXkgfSBmcm9tICcuL3Rvb2xzL2NvbGxhYlJlbGF5LmpzJztcclxuICogICAgICAgIGFwcC51c2UoY3JlYXRlQ29sbGFiUmVsYXkoKSk7XHJcbiAqXHJcbiAqIEVuZHBvaW50czpcclxuICogICBHRVQgIC9jb2xsYWIvc3RyZWFtP3Jvb209PHI+JmNsaWVudD08aWQ+ICAgU1NFOyBvbmUgb3BlbiBjb25uZWN0aW9uIHBlciBjbGllbnRcclxuICogICBQT1NUIC9jb2xsYWIvc2VuZD9yb29tPTxyPiZjbGllbnQ9PGlkPiAgICAgSlNPTiBtZXNzYWdlLCBvciBhbiBhcnJheSBvZiB0aGVtXHJcbiAqICAgR0VUICAvY29sbGFiL2hlYWx0aCAgICAgICAgICAgICAgICAgICAgICAgIHsgcm9vbXMsIGNsaWVudHMgfVxyXG4gKi9cclxuXHJcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciB9IGZyb20gJ25vZGU6aHR0cCc7XHJcbmltcG9ydCB7IHBhdGhUb0ZpbGVVUkwgfSBmcm9tICdub2RlOnVybCc7XHJcblxyXG4vKiogUmVqZWN0IGFuIHVwc3RyZWFtIGJvZHkgbGFyZ2VyIHRoYW4gdGhpcyAoc25hcHNob3RzIGNhcnJ5IHNsaWRlIHRodW1ibmFpbHMpLiAqL1xyXG5jb25zdCBNQVhfQk9EWV9CWVRFUyA9IDggKiAxMDI0ICogMTAyNDtcclxuLyoqIFNTRSBjb21tZW50IGludGVydmFsIFx1MjAxNCBrZWVwcyBpbnRlcm1lZGlhdGUgcHJveGllcyBmcm9tIGNsb3NpbmcgYW4gaWRsZSBzdHJlYW0uICovXHJcbmNvbnN0IEtFRVBBTElWRV9NUyA9IDIwMDAwO1xyXG4vKipcclxuICogSGFyZCBjYXAgcGVyIHJvb20uXHJcbiAqXHJcbiAqIFNpemVkIHRvIHdoYXQgdGhlIGZhbi1vdXQgY2FuIGFjdHVhbGx5IGNhcnJ5IHJhdGhlciB0aGFuIHRvIGEgcm91bmQgbnVtYmVyLlxyXG4gKiBDdXJzb3IgdHJhZmZpYyBpcyB0aGUgZG9taW5hbnQgdm9sdW1lIGFuZCBldmVyeSBtZXNzYWdlIGlzIHdyaXR0ZW4gb25jZSBwZXJcclxuICogb3RoZXIgbWVtYmVyLCBzbyBjb3N0IGdyb3dzIHdpdGggdGhlIFNRVUFSRSBvZiB0aGUgcm9vbTogMTYgcGVlcnMgYXQgMjAgSHogaXNcclxuICogYWxyZWFkeSB+NCw4MDAgU1NFIHdyaXRlcyBhIHNlY29uZC4gVGhlIHByZXZpb3VzIDY0IGltcGxpZWQgfjgwLDAwMC9zLCB3aGljaFxyXG4gKiBubyBzaW5nbGUtcHJvY2VzcyByZWxheSBpcyBnb2luZyB0byBkZWxpdmVyIFx1MjAxNCBiZXR0ZXIgdG8gcmVmdXNlIHRoZSAxN3RoIGNsaWVudFxyXG4gKiB3aXRoIGEgY2xlYXIgNTAzIHRoYW4gdG8gcXVpZXRseSBkZWdyYWRlIGV2ZXJ5Ym9keS5cclxuICovXHJcbmNvbnN0IE1BWF9DTElFTlRTX1BFUl9ST09NID0gMTY7XHJcblxyXG4vKipcclxuICogcm9vbSAtPiBNYXA8Y2xpZW50SWQsIFNlcnZlclJlc3BvbnNlPlxyXG4gKiBUaGUgZW50aXJlIHN0YXRlIG9mIHRoZSByZWxheS4gTG9zdCBvbiByZXN0YXJ0LCB3aGljaCBjb3N0cyBub3RoaW5nOiBjbGllbnRzXHJcbiAqIHJlY29ubmVjdCBhbmQgY2F0Y2ggdXAgZnJvbSBhIHBlZXIuXHJcbiAqL1xyXG5jb25zdCByb29tcyA9IG5ldyBNYXAoKTtcclxuXHJcbmZ1bmN0aW9uIHJvb21PZihuYW1lKSB7XHJcbiAgbGV0IHIgPSByb29tcy5nZXQobmFtZSk7XHJcbiAgaWYgKCFyKSB7XHJcbiAgICByID0gbmV3IE1hcCgpO1xyXG4gICAgcm9vbXMuc2V0KG5hbWUsIHIpO1xyXG4gIH1cclxuICByZXR1cm4gcjtcclxufVxyXG5cclxuZnVuY3Rpb24gZHJvcENsaWVudChyb29tTmFtZSwgY2xpZW50SWQpIHtcclxuICBjb25zdCByb29tID0gcm9vbXMuZ2V0KHJvb21OYW1lKTtcclxuICBpZiAoIXJvb20pIHJldHVybjtcclxuICByb29tLmRlbGV0ZShjbGllbnRJZCk7XHJcbiAgaWYgKCFyb29tLnNpemUpIHJvb21zLmRlbGV0ZShyb29tTmFtZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHdyaXRlU3NlKHJlcywgcGF5bG9hZCkge1xyXG4gIHRyeSB7XHJcbiAgICByZXMud3JpdGUoYGRhdGE6ICR7cGF5bG9hZH1cXG5cXG5gKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEFuIFNTRSBjb21tZW50LiBVc2VkIGZvciB0aGUga2VlcGFsaXZlLCB3aGljaCBvbmx5IG5lZWRzIGJ5dGVzIG9uIHRoZSB3aXJlIHRvXHJcbiAqIHN0b3AgYW4gaWRsZSBjb25uZWN0aW9uIGJlaW5nIGNsb3NlZCBcdTIwMTQgRXZlbnRTb3VyY2UgaWdub3JlcyBjb21tZW50cyBlbnRpcmVseS5cclxuICpcclxuICogUHJldmlvdXNseSB0aGUga2VlcGFsaXZlIHdhcyBhIHJlYWwgYHt2OiAxLCB0OiAncGluZyd9YCBtZXNzYWdlLCB3aGljaCBxdWlldGx5XHJcbiAqIGNvdXBsZWQgdGhpcyBmaWxlIHRvIHRoZSBjbGllbnQncyBwcm90b2NvbCB2ZXJzaW9uOiB0aGUgbW9tZW50IHRoZSBjbGllbnQgbW92ZWRcclxuICogdG8gdjIgZXZlcnkga2VlcGFsaXZlIGJlY2FtZSBhbiBcImluY29tcGF0aWJsZSBwZWVyXCIgbWVzc2FnZSBpdCBoYWQgdG8gZGlzY2FyZC5cclxuICogQSBjb21tZW50IGhhcyBubyB2ZXJzaW9uIHRvIGdldCB3cm9uZy5cclxuICovXHJcbmZ1bmN0aW9uIHdyaXRlQ29tbWVudChyZXMsIHRleHQpIHtcclxuICB0cnkge1xyXG4gICAgcmVzLndyaXRlKGA6ICR7dGV4dH1cXG5cXG5gKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIENvbnN0YW50LWlzaCB0aW1lIHN0cmluZyBjb21wYXJlLCBzbyBhIHdyb25nIHRva2VuIGNhbm5vdCBiZSBuYXJyb3dlZCBkb3duIGJ5XHJcbiAqIHRpbWluZy4gTm90IGEgc3Ryb25nIGd1YXJhbnRlZSBpbiBKUywgYnV0IHRoZSBjb3N0IGlzIG9uZSBsaW5lIGFuZCB0aGVcclxuICogYWx0ZXJuYXRpdmUgbGVha3MgdGhlIGFuc3dlciBvbmUgY2hhcmFjdGVyIGF0IGEgdGltZS5cclxuICovXHJcbmZ1bmN0aW9uIHRva2VuTWF0Y2hlcyhleHBlY3RlZCwgZ2l2ZW4pIHtcclxuICBpZiAoIWV4cGVjdGVkKSByZXR1cm4gdHJ1ZTsgLy8gdW5hdXRoZW50aWNhdGVkIGJ5IGRlZmF1bHQgXHUyMDE0IHRoZSBkb2N1bWVudGVkIHBvc3R1cmVcclxuICBjb25zdCBhID0gU3RyaW5nKGV4cGVjdGVkKTtcclxuICBjb25zdCBiID0gU3RyaW5nKGdpdmVuIHx8ICcnKTtcclxuICBpZiAoYS5sZW5ndGggIT09IGIubGVuZ3RoKSByZXR1cm4gZmFsc2U7XHJcbiAgbGV0IGRpZmYgPSAwO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkrKykgZGlmZiB8PSBhLmNoYXJDb2RlQXQoaSkgXiBiLmNoYXJDb2RlQXQoaSk7XHJcbiAgcmV0dXJuIGRpZmYgPT09IDA7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBGb3J3YXJkIGBwYXlsb2FkYCAoYWxyZWFkeS1zZXJpYWxpc2VkIEpTT04pIHRvIGV2ZXJ5IGNsaWVudCBpbiB0aGUgcm9vbSBleGNlcHRcclxuICogdGhlIHNlbmRlci4gQSBtZXNzYWdlIGNhcnJ5aW5nIGB0b2AgaXMgZGVsaXZlcmVkIHRvIHRoYXQgb25lIGNsaWVudCBvbmx5IFx1MjAxNFxyXG4gKiB0aGF0IGlzIGhvdyBhIHNuYXBzaG90IHJlYWNoZXMgYSBzaW5nbGUgbGF0ZSBqb2luZXIgaW5zdGVhZCBvZiB0aGUgd2hvbGUgcm9vbS5cclxuICovXHJcbmZ1bmN0aW9uIGZhbk91dChyb29tTmFtZSwgc2VuZGVySWQsIHBheWxvYWQsIGRpcmVjdGVkVG8pIHtcclxuICBjb25zdCByb29tID0gcm9vbXMuZ2V0KHJvb21OYW1lKTtcclxuICBpZiAoIXJvb20pIHJldHVybiAwO1xyXG4gIGxldCBzZW50ID0gMDtcclxuICBmb3IgKGNvbnN0IFtjbGllbnRJZCwgcmVzXSBvZiByb29tKSB7XHJcbiAgICBpZiAoY2xpZW50SWQgPT09IHNlbmRlcklkKSBjb250aW51ZTtcclxuICAgIGlmIChkaXJlY3RlZFRvICYmIGNsaWVudElkICE9PSBkaXJlY3RlZFRvKSBjb250aW51ZTtcclxuICAgIGlmICh3cml0ZVNzZShyZXMsIHBheWxvYWQpKSBzZW50Kys7XHJcbiAgICBlbHNlIGRyb3BDbGllbnQocm9vbU5hbWUsIGNsaWVudElkKTtcclxuICB9XHJcbiAgcmV0dXJuIHNlbnQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlYWRCb2R5KHJlcSkge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICBsZXQgc2l6ZSA9IDA7XHJcbiAgICBjb25zdCBjaHVua3MgPSBbXTtcclxuICAgIHJlcS5vbignZGF0YScsIChjaHVuaykgPT4ge1xyXG4gICAgICBzaXplICs9IGNodW5rLmxlbmd0aDtcclxuICAgICAgaWYgKHNpemUgPiBNQVhfQk9EWV9CWVRFUykge1xyXG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoJ3BheWxvYWQgdG9vIGxhcmdlJykpO1xyXG4gICAgICAgIHJlcS5kZXN0cm95KCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcclxuICAgIH0pO1xyXG4gICAgcmVxLm9uKCdlbmQnLCAoKSA9PiByZXNvbHZlKEJ1ZmZlci5jb25jYXQoY2h1bmtzKS50b1N0cmluZygndXRmOCcpKSk7XHJcbiAgICByZXEub24oJ2Vycm9yJywgcmVqZWN0KTtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24ganNvbihyZXMsIGNvZGUsIGJvZHkpIHtcclxuICBjb25zdCB0ZXh0ID0gSlNPTi5zdHJpbmdpZnkoYm9keSk7XHJcbiAgcmVzLndyaXRlSGVhZChjb2RlLCB7XHJcbiAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgJ0NvbnRlbnQtTGVuZ3RoJzogQnVmZmVyLmJ5dGVMZW5ndGgodGV4dCksXHJcbiAgICAnQ2FjaGUtQ29udHJvbCc6ICduby1zdG9yZScsXHJcbiAgfSk7XHJcbiAgcmVzLmVuZCh0ZXh0KTtcclxufVxyXG5cclxuLyoqXHJcbiAqIENvbm5lY3Qtc3R5bGUgbWlkZGxld2FyZTogYChyZXEsIHJlcywgbmV4dClgLiBBbnl0aGluZyBvdXRzaWRlIGBiYXNlUGF0aGAgaXNcclxuICogcGFzc2VkIHN0cmFpZ2h0IHRocm91Z2gsIHNvIG1vdW50aW5nIHRoaXMgaXMgc2lkZS1lZmZlY3QgZnJlZS5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVDb2xsYWJSZWxheShvcHRpb25zID0ge30pIHtcclxuICBjb25zdCBiYXNlUGF0aCA9IChvcHRpb25zLmJhc2VQYXRoIHx8ICcvY29sbGFiJykucmVwbGFjZSgvXFwvKyQvLCAnJyk7XHJcbiAgLyoqXHJcbiAgICogT3B0aW9uYWwgc2hhcmVkIHNlY3JldC4gVW5zZXQgYnkgZGVmYXVsdCwgd2hpY2gga2VlcHMgdGhlIHJlbGF5IGV4YWN0bHkgYXNcclxuICAgKiBkb2N1bWVudGVkOiB1bmF1dGhlbnRpY2F0ZWQsIGZvciBhbiBpc29sYXRlZCBMQU4uIFNldHRpbmcgaXQgaXMgZGVmZW5jZSBpblxyXG4gICAqIGRlcHRoLCBub3QgYSBzZWN1cml0eSBib3VuZGFyeSBcdTIwMTQgdGhlIHRva2VuIHRyYXZlbHMgaW4gYSBxdWVyeSBzdHJpbmcsIHNvIGl0IGlzXHJcbiAgICogdmlzaWJsZSB0byBhbnl0aGluZyB0aGF0IGNhbiBzZWUgdGhlIFVSTC4gSXQgcmFpc2VzIHRoZSBiYXIgZnJvbSBcImFueW9uZSB3aG9cclxuICAgKiBjYW4gcmVhY2ggdGhlIHBvcnRcIiB0byBcImFueW9uZSB3aG8gd2FzIHRvbGQgdGhlIHRva2VuXCIuXHJcbiAgICovXHJcbiAgY29uc3QgdG9rZW4gPSBvcHRpb25zLnRva2VuIHx8IHByb2Nlc3MuZW52LkNPTExBQl9UT0tFTiB8fCAnJztcclxuXHJcbiAgcmV0dXJuIGZ1bmN0aW9uIGNvbGxhYlJlbGF5TWlkZGxld2FyZShyZXEsIHJlcywgbmV4dCkge1xyXG4gICAgY29uc3QgcmF3VXJsID0gcmVxLnVybCB8fCAnJztcclxuICAgIGlmICghcmF3VXJsLnN0YXJ0c1dpdGgoYmFzZVBhdGggKyAnLycpKSByZXR1cm4gbmV4dD8uKCk7XHJcblxyXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyYXdVcmwsICdodHRwOi8vbG9jYWxob3N0Jyk7XHJcbiAgICBjb25zdCByb3V0ZSA9IHVybC5wYXRobmFtZS5zbGljZShiYXNlUGF0aC5sZW5ndGgpO1xyXG4gICAgY29uc3Qgcm9vbU5hbWUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgncm9vbScpIHx8ICdkZWZhdWx0JztcclxuICAgIGNvbnN0IGNsaWVudElkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ2NsaWVudCcpIHx8ICcnO1xyXG5cclxuICAgIC8vIFNhbWUtb3JpZ2luIGluIG5vcm1hbCB1c2U7IHBlcm1pc3NpdmUgc28gYSBzZXBhcmF0ZWx5LWhvc3RlZCByZWxheSB3b3Jrc1xyXG4gICAgLy8gd2l0aG91dCBleHRyYSBjb25maWd1cmF0aW9uLiBUaGUgcmVsYXkgY2FycmllcyBubyBjcmVkZW50aWFscyBhbmQgc3RvcmVzXHJcbiAgICAvLyBub3RoaW5nLCBzbyB0aGVyZSBpcyBubyBjcm9zcy1vcmlnaW4gc3RhdGUgdG8gcHJvdGVjdC5cclxuICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJyk7XHJcbiAgICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJywgJ0NvbnRlbnQtVHlwZScpO1xyXG5cclxuICAgIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcclxuICAgICAgcmVzLndyaXRlSGVhZCgyMDQpO1xyXG4gICAgICByZXMuZW5kKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBIZWFsdGggc3RheXMgb3BlbjogaXQgcmVwb3J0cyB0d28gY291bnRzIGFuZCBubyByb29tIG5hbWVzLCBhbmQgaXQgaXMgd2hhdFxyXG4gICAgLy8gYW4gb3BlcmF0b3IgY3VybHMgdG8gZmluZCBvdXQgd2hldGhlciB0aGUgcmVsYXkgaXMgdXAgYXQgYWxsLlxyXG4gICAgaWYgKHJvdXRlID09PSAnL2hlYWx0aCcpIHtcclxuICAgICAgbGV0IGNsaWVudHMgPSAwO1xyXG4gICAgICBmb3IgKGNvbnN0IHJvb20gb2Ygcm9vbXMudmFsdWVzKCkpIGNsaWVudHMgKz0gcm9vbS5zaXplO1xyXG4gICAgICByZXR1cm4ganNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgcm9vbXM6IHJvb21zLnNpemUsIGNsaWVudHMsIGF1dGg6IHRva2VuID8gJ3Rva2VuJyA6ICdvcGVuJyB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXRva2VuTWF0Y2hlcyh0b2tlbiwgdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3QnKSkpIHtcclxuICAgICAgcmV0dXJuIGpzb24ocmVzLCA0MDEsIHsgZXJyb3I6ICdiYWQgb3IgbWlzc2luZyB0b2tlbicgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJvdXRlID09PSAnL3N0cmVhbScgJiYgcmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcclxuICAgICAgaWYgKCFjbGllbnRJZCkgcmV0dXJuIGpzb24ocmVzLCA0MDAsIHsgZXJyb3I6ICdjbGllbnQgcmVxdWlyZWQnIH0pO1xyXG4gICAgICBjb25zdCByb29tID0gcm9vbU9mKHJvb21OYW1lKTtcclxuICAgICAgaWYgKHJvb20uc2l6ZSA+PSBNQVhfQ0xJRU5UU19QRVJfUk9PTSAmJiAhcm9vbS5oYXMoY2xpZW50SWQpKSB7XHJcbiAgICAgICAgcmV0dXJuIGpzb24ocmVzLCA1MDMsIHsgZXJyb3I6ICdyb29tIGZ1bGwnIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXMud3JpdGVIZWFkKDIwMCwge1xyXG4gICAgICAgICdDb250ZW50LVR5cGUnOiAndGV4dC9ldmVudC1zdHJlYW0nLFxyXG4gICAgICAgICdDYWNoZS1Db250cm9sJzogJ25vLWNhY2hlLCBuby10cmFuc2Zvcm0nLFxyXG4gICAgICAgIENvbm5lY3Rpb246ICdrZWVwLWFsaXZlJyxcclxuICAgICAgICAvLyBEZWZlYXRzIHJlc3BvbnNlIGJ1ZmZlcmluZyBpbiBuZ2lueCBhbmQgZnJpZW5kcywgd2hpY2ggd291bGRcclxuICAgICAgICAvLyBvdGhlcndpc2UgaG9sZCBldmVudHMgdW50aWwgdGhlIGJ1ZmZlciBmaWxsZWQuXHJcbiAgICAgICAgJ1gtQWNjZWwtQnVmZmVyaW5nJzogJ25vJyxcclxuICAgICAgfSk7XHJcbiAgICAgIHJlcy5mbHVzaEhlYWRlcnM/LigpO1xyXG4gICAgICByZXMud3JpdGUoJzogY29ubmVjdGVkXFxuXFxuJyk7XHJcblxyXG4gICAgICAvLyBBIHJlY29ubmVjdCBmcm9tIHRoZSBzYW1lIGNsaWVudCByZXBsYWNlcyBpdHMgcHJldmlvdXMgc3RyZWFtLlxyXG4gICAgICBjb25zdCBwcmV2aW91cyA9IHJvb20uZ2V0KGNsaWVudElkKTtcclxuICAgICAgaWYgKHByZXZpb3VzICYmIHByZXZpb3VzICE9PSByZXMpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgcHJldmlvdXMuZW5kKCk7XHJcbiAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAvKiBhbHJlYWR5IGdvbmUgKi9cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgcm9vbS5zZXQoY2xpZW50SWQsIHJlcyk7XHJcblxyXG4gICAgICBjb25zdCBrZWVwYWxpdmUgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgaWYgKCF3cml0ZUNvbW1lbnQocmVzLCAna2VlcGFsaXZlJykpIHtcclxuICAgICAgICAgIGNsZWFySW50ZXJ2YWwoa2VlcGFsaXZlKTtcclxuICAgICAgICAgIGRyb3BDbGllbnQocm9vbU5hbWUsIGNsaWVudElkKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0sIEtFRVBBTElWRV9NUyk7XHJcblxyXG4gICAgICBjb25zdCBjbGVhbnVwID0gKCkgPT4ge1xyXG4gICAgICAgIGNsZWFySW50ZXJ2YWwoa2VlcGFsaXZlKTtcclxuICAgICAgICBpZiAocm9vbXMuZ2V0KHJvb21OYW1lKT8uZ2V0KGNsaWVudElkKSA9PT0gcmVzKSBkcm9wQ2xpZW50KHJvb21OYW1lLCBjbGllbnRJZCk7XHJcbiAgICAgIH07XHJcbiAgICAgIHJlcS5vbignY2xvc2UnLCBjbGVhbnVwKTtcclxuICAgICAgcmVxLm9uKCdlcnJvcicsIGNsZWFudXApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJvdXRlID09PSAnL3NlbmQnICYmIHJlcS5tZXRob2QgPT09ICdQT1NUJykge1xyXG4gICAgICByZWFkQm9keShyZXEpXHJcbiAgICAgICAgLnRoZW4oKHRleHQpID0+IHtcclxuICAgICAgICAgIGxldCBwYXJzZWQ7XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHRleHQpO1xyXG4gICAgICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgICAgIHJldHVybiBqc29uKHJlcywgNDAwLCB7IGVycm9yOiAnaW52YWxpZCBqc29uJyB9KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGNvbnN0IGxpc3QgPSBBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQgOiBbcGFyc2VkXTtcclxuICAgICAgICAgIGlmICghbGlzdC5sZW5ndGgpIHJldHVybiBqc29uKHJlcywgMjA0LCB7fSk7XHJcblxyXG4gICAgICAgICAgLy8gR3JvdXAgYnkgcmVjaXBpZW50IHNvIGEgYmF0Y2ggbWl4aW5nIGJyb2FkY2FzdCBhbmQgZGlyZWN0ZWRcclxuICAgICAgICAgIC8vIG1lc3NhZ2VzIHN0aWxsIHJlYWNoZXMgZXhhY3RseSB0aGUgcmlnaHQgY2xpZW50cy5cclxuICAgICAgICAgIGNvbnN0IGJyb2FkY2FzdCA9IFtdO1xyXG4gICAgICAgICAgY29uc3QgZGlyZWN0ZWQgPSBuZXcgTWFwKCk7XHJcbiAgICAgICAgICBmb3IgKGNvbnN0IG1zZyBvZiBsaXN0KSB7XHJcbiAgICAgICAgICAgIGlmICghbXNnIHx8IHR5cGVvZiBtc2cgIT09ICdvYmplY3QnKSBjb250aW51ZTtcclxuICAgICAgICAgICAgaWYgKG1zZy50bykge1xyXG4gICAgICAgICAgICAgIGNvbnN0IGJ1Y2tldCA9IGRpcmVjdGVkLmdldChtc2cudG8pID8/IFtdO1xyXG4gICAgICAgICAgICAgIGJ1Y2tldC5wdXNoKG1zZyk7XHJcbiAgICAgICAgICAgICAgZGlyZWN0ZWQuc2V0KG1zZy50bywgYnVja2V0KTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICBicm9hZGNhc3QucHVzaChtc2cpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgbGV0IHNlbnQgPSAwO1xyXG4gICAgICAgICAgaWYgKGJyb2FkY2FzdC5sZW5ndGgpIHtcclxuICAgICAgICAgICAgc2VudCArPSBmYW5PdXQocm9vbU5hbWUsIGNsaWVudElkLCBKU09OLnN0cmluZ2lmeShicm9hZGNhc3QpLCBudWxsKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGZvciAoY29uc3QgW3RvLCBtc2dzXSBvZiBkaXJlY3RlZCkge1xyXG4gICAgICAgICAgICBzZW50ICs9IGZhbk91dChyb29tTmFtZSwgY2xpZW50SWQsIEpTT04uc3RyaW5naWZ5KG1zZ3MpLCB0byk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4ganNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgZGVsaXZlcmVkOiBzZW50IH0pO1xyXG4gICAgICAgIH0pXHJcbiAgICAgICAgLmNhdGNoKChlcnIpID0+IGpzb24ocmVzLCA0MTMsIHsgZXJyb3I6IFN0cmluZyhlcnI/Lm1lc3NhZ2UgfHwgZXJyKSB9KSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4ganNvbihyZXMsIDQwNCwgeyBlcnJvcjogJ3Vua25vd24gY29sbGFiIHJvdXRlJyB9KTtcclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogVml0ZSBwbHVnaW4gXHUyMDE0IG1vdW50cyB0aGUgcmVsYXkgaW5zaWRlIHRoZSBkZXYgc2VydmVyLCBzbyBgbnBtIHJ1biBkZXZgIGlzIHRoZVxyXG4gKiB3aG9sZSBzZXR1cCBvbiBhIExBTiAodGhlIGRldiBzZXJ2ZXIgYWxyZWFkeSBiaW5kcyAwLjAuMC4wKS5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjb2xsYWJSZWxheVBsdWdpbihvcHRpb25zID0ge30pIHtcclxuICByZXR1cm4ge1xyXG4gICAgbmFtZTogJ3BhbXM4LWNvbGxhYi1yZWxheScsXHJcbiAgICBjb25maWd1cmVTZXJ2ZXIoc2VydmVyKSB7XHJcbiAgICAgIHNlcnZlci5taWRkbGV3YXJlcy51c2UoY3JlYXRlQ29sbGFiUmVsYXkob3B0aW9ucykpO1xyXG4gICAgICBzZXJ2ZXIuY29uZmlnLmxvZ2dlci5pbmZvKCcgIFx1Mjc5QyAgY29sbGFiIHJlbGF5OiAgL2NvbGxhYi9zdHJlYW0gKFNTRSBmYW4tb3V0KScpO1xyXG4gICAgfSxcclxuICAgIC8vIEFsc28gcHJlc2VudCBmb3IgYHZpdGUgcHJldmlld2AsIHNvIGEgYnVpbHQgaGFybmVzcyBjYW4gYmUgc2hhcmVkLlxyXG4gICAgY29uZmlndXJlUHJldmlld1NlcnZlcihzZXJ2ZXIpIHtcclxuICAgICAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZShjcmVhdGVDb2xsYWJSZWxheShvcHRpb25zKSk7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIFx1MjUwMFx1MjUwMCBTdGFuZGFsb25lIG1vZGUgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcbi8vIFJ1bnMgb25seSB3aGVuIHRoaXMgZmlsZSBpcyB0aGUgZW50cnkgcG9pbnQgKGBub2RlIGNvbGxhYlJlbGF5LmpzYCksIG5ldmVyXHJcbi8vIHdoZW4gaXQgaXMgaW1wb3J0ZWQgYnkgdml0ZS5jb25maWcudHMuIHBhdGhUb0ZpbGVVUkwgaGFuZGxlcyBXaW5kb3dzIGRyaXZlXHJcbi8vIGxldHRlcnMsIHdoaWNoIGEgaGFuZC1idWlsdCBgZmlsZTovL2Agc3RyaW5nIGRvZXMgbm90LlxyXG5jb25zdCBpc0VudHJ5UG9pbnQgPVxyXG4gICEhcHJvY2Vzcy5hcmd2WzFdICYmIGltcG9ydC5tZXRhLnVybCA9PT0gcGF0aFRvRmlsZVVSTChwcm9jZXNzLmFyZ3ZbMV0pLmhyZWY7XHJcblxyXG5pZiAoaXNFbnRyeVBvaW50KSB7XHJcbiAgY29uc3QgcG9ydEFyZyA9IHByb2Nlc3MuYXJndi5pbmRleE9mKCctLXBvcnQnKTtcclxuICBjb25zdCBwb3J0ID0gcG9ydEFyZyA+IC0xID8gTnVtYmVyKHByb2Nlc3MuYXJndltwb3J0QXJnICsgMV0pIHx8IDY2MDAgOiA2NjAwO1xyXG4gIGNvbnN0IHJlbGF5ID0gY3JlYXRlQ29sbGFiUmVsYXkoKTtcclxuICBjcmVhdGVTZXJ2ZXIoKHJlcSwgcmVzKSA9PlxyXG4gICAgcmVsYXkocmVxLCByZXMsICgpID0+IHtcclxuICAgICAgcmVzLndyaXRlSGVhZCg0MDQsIHsgJ0NvbnRlbnQtVHlwZSc6ICd0ZXh0L3BsYWluJyB9KTtcclxuICAgICAgcmVzLmVuZCgnY29sbGFiIHJlbGF5OiB1c2UgL2NvbGxhYi9zdHJlYW0gb3IgL2NvbGxhYi9zZW5kXFxuJyk7XHJcbiAgICB9KSxcclxuICApLmxpc3Rlbihwb3J0LCAnMC4wLjAuMCcsICgpID0+IHtcclxuICAgIGNvbnNvbGUubG9nKGBbY29sbGFiLXJlbGF5XSBsaXN0ZW5pbmcgb24gaHR0cDovLzAuMC4wLjA6JHtwb3J0fS9jb2xsYWJgKTtcclxu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
