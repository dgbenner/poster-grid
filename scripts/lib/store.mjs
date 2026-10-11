// Poster storage. Each poster is a folder:
//   posters/<id>/poster.json   number, series, pin, which version is published, version list
//   posters/<id>/v<n>.json     one version: idea, design, critic, checks, render spec
//   posters/<id>/v<n>.png      that version rendered
// Versions are only ever added, never overwritten.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './http.mjs';

const DIR = join(ROOT, 'posters');
const json = async f => JSON.parse(await readFile(f, 'utf8'));
const write = (f, d) => writeFile(f, JSON.stringify(d, null, 2) + '\n');

export async function listPosters() {
  const out = [];
  for (const name of await readdir(DIR)) {
    try {
      if ((await stat(join(DIR, name))).isDirectory()) out.push(await json(join(DIR, name, 'poster.json')));
    } catch {}
  }
  return out.sort((a, b) => a.series.localeCompare(b.series) || a.number - b.number);
}

export const loadPoster = id => json(join(DIR, id, 'poster.json'));
export const loadVersion = (id, v) => json(join(DIR, id, `v${v}.json`));
export const savePoster = meta => write(join(DIR, meta.id, 'poster.json'), meta);

export async function createPoster({ id, number, series, pin_id }) {
  await mkdir(join(DIR, id), { recursive: true });
  const meta = { id, number, series, pin_id, published: null, versions: [] };
  await savePoster(meta);
  return meta;
}

// Adds a version. The first version of a poster is published automatically; later ones
// only when asked (publish: true), so a new version never replaces a chosen one silently.
export async function addVersion(id, record, png, { feedback = null, from = null, publish = false } = {}) {
  const meta = await loadPoster(id);
  const v = Math.max(0, ...meta.versions.map(x => x.v)) + 1;
  const image = `posters/${id}/v${v}.png`;
  await writeFile(join(ROOT, image), png);
  await write(join(DIR, id, `v${v}.json`), { ...record, version: v, image });
  meta.versions.push({
    v, created_at: new Date().toISOString(), feedback, from,
    mean: record.critic?.mean ?? null, followed: record.critic?.scores?.followed ?? null, status: record.status,
  });
  if (publish || meta.published == null) meta.published = v;
  await savePoster(meta);
  return v;
}

export async function publish(id, v) {
  const meta = await loadPoster(id);
  if (!meta.versions.some(x => x.v === v)) throw new Error(`poster ${id} has no version ${v}`);
  meta.published = v;
  await savePoster(meta);
  return meta;
}

// Images of a place already used by any poster or version, in any series.
export async function imagesUsedFor(pinId) {
  const used = new Set();
  for (const meta of (await listPosters()).filter(m => m.pin_id === pinId)) {
    for (const { v } of meta.versions) {
      const rec = await loadVersion(meta.id, v);
      for (const f of rec.images_used || []) used.add(f);
    }
  }
  return used;
}
