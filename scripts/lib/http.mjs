// Cached, throttled HTTP for the data scripts. Every API response is kept in data/cache
// so reruns are cheap and polite to the services.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const UA = 'poster-grid/0.1 (personal, non-commercial; https://github.com/dgbenner/waypoints)';

const lanes = new Map();   // host -> { last, gap }
const GAPS = {
  'nominatim.openstreetmap.org': 1100,
  'en.wikipedia.org': 300,
  'commons.wikimedia.org': 300,
  'upload.wikimedia.org': 300,
};

async function throttle(host) {
  const gap = GAPS[host] ?? 120;
  const lane = lanes.get(host) || { next: 0 };
  lanes.set(host, lane);
  const now = Date.now();
  const at = Math.max(now, lane.next);
  lane.next = at + gap;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

export async function getJSON(url, { cache = true } = {}) {
  const key = createHash('sha1').update(url).digest('hex');
  const host = new URL(url).host;
  const file = join(ROOT, 'data/cache', host, key + '.json');
  if (cache) {
    try { return JSON.parse(await readFile(file, 'utf8')).body; } catch {}
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle(host);
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (res.status === 404) { await store(file, url, null); return null; }
    if (res.status === 429 || res.status >= 500) { await backoff(res, attempt); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const body = await res.json();
    await store(file, url, body);
    return body;
  }
  throw new Error(`gave up on ${url}`);
}

// Waits as long as the server asks (Retry-After), or backs off exponentially.
function backoff(res, attempt) {
  const after = Number(res.headers.get('retry-after'));
  const ms = after > 0 ? after * 1000 : 1500 * 2 ** attempt;
  return new Promise(r => setTimeout(r, Math.min(ms, 60000)));
}

async function store(file, url, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ url, at: new Date().toISOString(), body }));
}

export async function download(url, file) {
  try { await readFile(file); return true; } catch {}
  const host = new URL(url).host;
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle(host);
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.status === 429 || res.status >= 500) { await backoff(res, attempt); continue; }
    if (!res.ok) return false;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    return true;
  }
  return false;
}
