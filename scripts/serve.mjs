// a small static server for site/, with the same headers vercel.json
// gives the real site. for trying the page locally and for the browser
// tests. never deployed.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEADERS } from './policy.mjs';

export const SITE = fileURLToPath(new URL('../site/', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

export function serve({ port = 0, root = SITE, headers = HEADERS } = {}) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) throw new Error('outside');
      const s = await stat(file).catch(() => null);
      const target = s && s.isDirectory() ? join(file, 'index.html') : file;
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': TYPES[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...headers });
      res.end('not found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await serve({ port: Number(process.env.PORT || 4173) });
  console.log(`attic is at ${url}`);
}
