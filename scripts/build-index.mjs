// Writes posters/index.json, the list the viewer reads: each poster's published version,
// plus a summary of every version. Run after making posters (the pipeline and the local
// server do this themselves).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';
import { listPosters, loadVersion } from './lib/store.mjs';

export async function buildIndex() {
  const series = {};
  const list = [];
  for (const meta of await listPosters()) {
    if (meta.hidden || meta.published == null) continue;
    const p = await loadVersion(meta.id, meta.published);
    if (!series[meta.series]) {
      try { series[meta.series] = JSON.parse(await readFile(join(ROOT, 'series', `${meta.series}.json`), 'utf8')).name; } catch { series[meta.series] = meta.series; }
    }
    list.push({
      id: meta.id, number: meta.number, series: meta.series, version: meta.published,
      versions: meta.versions,
      title: p.title, status: p.status,
      place: { town: p.place.town, county: p.place.county, borough: p.place.borough, country: p.place.country },
      idea: p.idea, pairing: p.pairing, paper: p.paper,
      // Posters made before colour roles had a single accent.
      colors: p.colors?.length ? p.colors : p.accent ? [{ hex: p.accent, role: 'accent' }] : [],
      critic: p.critic ? { scores: p.critic.scores, mean: p.critic.mean, notes: p.critic.notes, summary: p.critic.summary } : null,
      attempts: p.attempts,
      copy: p.copy, facts_used: p.facts_used,
      photos: (p.photos || (p.photo ? [p.photo] : [])).map(x => ({ credit: x.credit, source: x.source, kind: x.kind })),
      image: p.image, created_at: p.created_at,
    });
  }
  const totals = {};
  for (const p of list) totals[p.series] = (totals[p.series] || 0) + 1;
  await writeFile(join(ROOT, 'posters/index.json'), JSON.stringify({ total: list.length, series, totals, posters: list }, null, 2) + '\n');
  return list.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${await buildIndex()} posters → posters/index.json`);
}
