// Writes posters/index.json, the list the viewer reads. Run after making posters
// (make-posters does this itself).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';

export async function buildIndex() {
  const files = (await readdir(join(ROOT, 'posters'))).filter(f => f.endsWith('.json') && f !== 'index.json');
  const posters = await Promise.all(files.map(async f => JSON.parse(await readFile(join(ROOT, 'posters', f), 'utf8'))));
  const list = posters.sort((a, b) => b.number - a.number).map(p => ({
    id: p.id, number: p.number, title: p.title, status: p.status,
    place: { town: p.place.town, county: p.place.county, borough: p.place.borough, country: p.place.country },
    idea: p.idea, pairing: p.pairing, paper: p.paper, accent: p.accent,
    critic: p.critic ? { scores: p.critic.scores, mean: p.critic.mean, notes: p.critic.notes, summary: p.critic.summary } : null,
    attempts: p.attempts,
    copy: p.copy, facts_used: p.facts_used,
    photo: p.photo ? { credit: p.photo.credit, source: p.photo.source, kind: p.photo.kind } : null,
    image: p.image, created_at: p.created_at,
  }));
  await writeFile(join(ROOT, 'posters/index.json'), JSON.stringify({ total: list.length, posters: list }, null, 2) + '\n');
  return list.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${await buildIndex()} posters → posters/index.json`);
}
