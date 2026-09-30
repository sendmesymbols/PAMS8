// Minimal static server for previewing the built docs: node tools/serveDocs.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist/MS/Docs');
const port = Number(process.argv[2]) || 6550;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(req.url.split('?')[0]));
    if (p.endsWith('\\') || p.endsWith('/')) p = join(p, 'index.html');
    const file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('Not found'); }
}).listen(port, () => console.log(`Docs at http://localhost:${port}/`));
