// Writes posters/index.json, the list the viewer reads: each poster's published version,
// plus a summary of every version. Run after making posters (the pipeline and the local
// server do this themselves).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';
import { listPosters, loadVersion } from './lib/store.mjs';

const seriesNames = {};
async function seriesName(slug) {
  if (!seriesNames[slug]) {
    try { seriesNames[slug] = JSON.parse(await readFile(join(ROOT, 'series', `${slug}.json`), 'utf8')).name; } catch { seriesNames[slug] = slug; }
  }
  return seriesNames[slug];
}

export async function buildIndex() {
  const series = {};
  const list = [];
  const everything = await listPosters();
  for (const meta of everything) {
    if (meta.hidden || meta.published == null) continue;
    const p = await loadVersion(meta.id, meta.published);
    series[meta.series] = await seriesName(meta.series);
    // The same place's posters in other series (shown or hidden), for comparing and
    // swapping in. Versions already swapped into this poster are not repeated.
    const swapped = new Set(meta.versions.map(x => x.from).filter(Boolean));
    const related = [];
    for (const o of everything.filter(o => o.pin_id === meta.pin_id && o.id !== meta.id)) {
      const versions = o.versions.filter(x => !swapped.has(`${o.id} v${x.v}`));
      if (versions.length) related.push({ id: o.id, series: o.series, seriesName: await seriesName(o.series), number: o.number, hidden: !!o.hidden, versions });
    }
    list.push({
      id: meta.id, number: meta.number, series: meta.series, version: meta.published,
      versions: meta.versions, related,
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
