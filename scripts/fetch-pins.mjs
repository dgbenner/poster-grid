// Downloads the Waypoints pins into data/pins.json. Read-only: this project never
// writes to the Waypoints repo.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, UA } from './lib/http.mjs';

export const PINS_URL = 'https://raw.githubusercontent.com/dgbenner/waypoints/main/data.json';

const res = await fetch(PINS_URL, { headers: { 'user-agent': UA } });
if (!res.ok) throw new Error(`${res.status} fetching pins`);
const text = await res.text();
const pins = JSON.parse(text);
if (!Array.isArray(pins) || !pins.every(p => p.id && typeof p.lat === 'number' && typeof p.lng === 'number')) {
  throw new Error('pins file is not the expected shape');
}

await mkdir(join(ROOT, 'data'), { recursive: true });
await writeFile(join(ROOT, 'data/pins.json'), JSON.stringify(pins, null, 2) + '\n');
await writeFile(join(ROOT, 'data/pins.meta.json'), JSON.stringify({
  source: PINS_URL,
  fetchedAt: new Date().toISOString(),
  count: pins.length,
  sha256: createHash('sha256').update(text).digest('hex'),
}, null, 2) + '\n');
console.log(`${pins.length} pins → data/pins.json`);
