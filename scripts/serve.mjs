// Local server for the lab (and later the gallery). Serves the project folder and
// accepts PUT /grid/grid.json so the lab can save grid settings. No dependencies.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 5190;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const between = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;
function validGrid(o) {
  return o && o.page && between(o.page.width, 100, 5000) && between(o.page.height, 100, 5000)
    && [4, 6, 8, 12].includes(o.columns) && [8, 10, 12].includes(o.baseline)
    && between(o.margin, 0, 200) && between(o.gutter, 0, 100)
    && Number.isInteger(o.linesPerModule) && between(o.linesPerModule, 1, 20)
    && Array.isArray(o.fonts?.pairings) && o.fonts.pairings.some(p => p.id === o.fonts.active);
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  if (req.method === 'PUT' && path === '/grid/grid.json') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let data;
    try { data = JSON.parse(body); } catch { res.writeHead(400).end('Not JSON'); return; }
    if (!validGrid(data)) { res.writeHead(422).end('Grid settings out of range'); return; }
    await writeFile(join(root, 'grid/grid.json'), JSON.stringify(data, null, 2) + '\n');
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root) || file.split(sep).includes('_source')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Poster Grid: http://localhost:${PORT}/  ·  lab: http://localhost:${PORT}/lab/`));
