// Local server for the viewer and the lab. Serves the project folder, accepts
// PUT /grid/grid.json from the lab, and runs the two local-only poster actions:
//   POST /api/revise   { id, version, feedback }  makes a new version; streams progress
//   POST /api/publish  { id, version }            chooses the version the site shows
//   POST /api/swap     { id, source, version }    puts another series' version in this slot
// Those need the Anthropic key in .env.local, so they exist only here, never on Pages.
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

let revising = null;   // one revision at a time: they share the renderer's port

async function readJSON(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || '{}');
}

async function api(req, res, path) {
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  let body;
  try { body = await readJSON(req); } catch { return send(400, { error: 'Not JSON' }); }
  if (!/^[a-z0-9-]+$/.test(body.id || '')) return send(400, { error: 'Bad poster id' });
  const { buildIndex } = await import('./build-index.mjs');

  if (path === '/api/publish') {
    try {
      const { publish } = await import('./lib/store.mjs');
      await publish(body.id, Number(body.version));
      await buildIndex();
      return send(200, { ok: true, published: Number(body.version) });
    } catch (err) { return send(400, { error: err.message }); }
  }

  if (path === '/api/swap') {
    if (!/^[a-z0-9-]+$/.test(body.source || '')) return send(400, { error: 'Bad source id' });
    if (revising) return send(409, { error: `Busy with ${revising}` });
    revising = body.id;
    try {
      const { swapIn } = await import('./lib/swap.mjs');
      const { openRenderer } = await import('./lib/renderer.mjs');
      const renderer = await openRenderer();
      try {
        const version = await swapIn({ source: body.source, version: body.version, target: body.id, renderer });
        await buildIndex();
        return send(200, { ok: true, version });
      } finally {
        await renderer.close();
      }
    } catch (err) {
      return send(400, { error: err.message });
    } finally {
      revising = null;
    }
  }

  if (path === '/api/revise') {
    const feedback = String(body.feedback || '').trim();
    if (!feedback) return send(400, { error: 'Say what should change' });
    if (revising) return send(409, { error: `Already making a version of ${revising}` });
    try { process.loadEnvFile(join(root, '.env.local')); } catch { return send(500, { error: 'No .env.local with ANTHROPIC_API_KEY' }); }
    // Progress streams as one JSON object per line; the last line has done or error.
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
    const line = o => res.write(JSON.stringify(o) + '\n');
    revising = body.id;
    try {
      const { revise } = await import('./lib/revise.mjs');
      const uploads = Array.isArray(body.images) ? body.images.filter(x => typeof x?.data === 'string').slice(0, 4) : [];
      const out = await revise({ id: body.id, version: body.version ? Number(body.version) : null, feedback, uploads, onProgress: line });
      await buildIndex();
      line({ done: true, ...out });
    } catch (err) {
      line({ error: err.message });
    } finally {
      revising = null;
      res.end();
    }
    return;
  }
  send(404, { error: 'Unknown action' });
}

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
  if (req.method === 'POST' && path.startsWith('/api/')) return api(req, res, path);
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
