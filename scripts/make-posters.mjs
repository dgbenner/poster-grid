// The poster pipeline. Per poster: idea, copy and layout (model), checks (code),
// critic (model), render (code). Below 7, or failing checks, it goes back to the idea,
// up to 2 retries. Each poster belongs to a series (series/<slug>.json), which sets its
// font pairings, colour limit and ideas.
//
//   node scripts/make-posters.mjs                    10 English pins, series Original
//   node scripts/make-posters.mjs --series serif     make or extend the Serif series
//   node scripts/make-posters.mjs --count 20         how many to make
//   node scripts/make-posters.mjs --pins a,b         these pins, in this order
//   node scripts/make-posters.mjs --skip a,b         leave these pins out of the selection
//   node scripts/make-posters.mjs --redo 2,4         a new, published version of these numbers
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';

process.loadEnvFile(join(ROOT, '.env.local'));
const { IDEAS, colorCandidates } = await import('./lib/poster.mjs');
const { designBrief } = await import('./lib/designer.mjs');
const { openRenderer } = await import('./lib/renderer.mjs');
const { loadContext, loadSeries, runDesign, versionRecord, logRun } = await import('./lib/pipeline.mjs');
const { listPosters, loadPoster, loadVersion, createPoster, addVersion, imagesUsedFor } = await import('./lib/store.mjs');
const { buildIndex } = await import('./build-index.mjs');

const args = process.argv.slice(2);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const TMP = join(ROOT, 'posters/.attempts');

// ---------- Selection ----------

// A series' first run: 10 English pins over at least 5 counties, at least 3 in London.
// Later runs: English pins without a poster in this series, each county at most twice in
// the series, so a run widens the map before it repeats a county.
const MAX_PER_COUNTY = 2;

function selectPins(all, count, posters) {
  const score = e => (e.facts.pin ? 3 : 0) + (e.facts.town ? 1 : 0) + Math.min(e.images.length, 5) + Math.min(e.nearby.within5km.length, 3);
  const done = new Set(posters.map(p => p.pin_id));
  const names = new Set(posters.map(p => all.find(e => e.id === p.pin_id)?.facts.pin?.title).filter(Boolean));
  const eligible = all
    .filter(e => e.place.country === 'England' && e.images.length >= 2 && (e.facts.pin || e.facts.town))
    .filter(e => !done.has(e.id) && !(e.facts.pin && names.has(e.facts.pin.title)))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const picked = [];
  const perCounty = {};
  for (const p of posters) {
    const county = all.find(e => e.id === p.pin_id)?.place.county;
    perCounty[county] = (perCounty[county] || 0) + 1;
  }
  const take = e => { picked.push(e); names.add(e.facts.pin?.title); perCounty[e.place.county] = (perCounty[e.place.county] || 0) + 1; };

  if (!posters.length) {
    const boroughs = new Set();
    for (const e of eligible.filter(e => e.place.county === 'Greater London')) {
      if (picked.length === 3) break;
      if (!boroughs.has(e.place.borough)) { boroughs.add(e.place.borough); take(e); }
    }
  }
  // First pass: counties not yet in the series; second pass: up to the cap.
  for (const limit of [1, MAX_PER_COUNTY]) {
    for (const e of eligible) {
      if (picked.length >= count) break;
      if (picked.includes(e) || (e.facts.pin && names.has(e.facts.pin.title))) continue;
      if ((perCounty[e.place.county] || 0) >= limit) continue;
      take(e);
    }
  }
  // Order so the same county never appears twice in a row.
  const out = [];
  const rest = [...picked];
  while (rest.length) {
    const i = rest.findIndex(e => e.place.county !== out[out.length - 1]?.place.county);
    out.push(...rest.splice(i < 0 ? 0 : i, 1));
  }
  return out.slice(0, count);
}

// Ideas: never the same as either neighbour, all four across a run, and only those the
// series allows. Any allowed idea not yet used that this pin can support comes first.
function allowedIdeas({ neighbours, used, enrich, series }) {
  const pool = series.ideas.includes('all') ? Object.keys(IDEAS) : series.ideas.filter(k => IDEAS[k]);
  let ok = pool.filter(k => !neighbours.includes(k));
  const hasNearby = enrich.nearby.within5km.length + enrich.nearby.sameCounty.length >= 2;
  if (!hasNearby) ok = ok.filter(k => k !== 'nearby');
  if (!ok.length) ok = pool;
  const unused = ok.filter(k => !used.has(k));
  return unused.length ? unused : ok;
}

const posterId = (series, number, pinId) => `${series.slug === 'original' ? '' : series.slug + '-'}${String(number).padStart(3, '0')}-${pinId}`;
const progress = e => console.log(`    ${e.msg}`);

// ---------- Make ----------

async function make({ enrich, pin, ctx, number, total, ideas, series, renderer, publish = false, existingId = null }) {
  const usedImages = await imagesUsedFor(enrich.id);
  const candidates = colorCandidates(enrich);
  const first = await designBrief({ enrich, gridCfg: ctx.gridCfg, allowedIdeas: ideas, candidates, series, usedImages });
  let result;
  try {
    result = await runDesign({ enrich, pin, gridCfg: ctx.gridCfg, all: ctx.all, number, total, ideas, series, renderer, tmpDir: TMP, first, log: progress });
  } catch (err) {
    console.log(`    FAILED: ${err.message}`);
    return null;
  }
  const id = existingId || posterId(series, number, enrich.id);
  if (!existingId) await createPoster({ id, number, series: series.slug, pin_id: enrich.id });
  const record = versionRecord({ result, enrich, series, number });
  const v = await addVersion(id, record, result.best.png, { publish, from: existingId ? 'redo' : null });
  await logRun({ result, enrich, id, version: v });
  const { tokens_in, tokens_out } = result.usage;
  console.log(`    saved ${id} v${v} · ${result.status} · ${result.best.crit?.mean ?? '—'} · ${tokens_in} in / ${tokens_out} out · ${Math.round(result.ms / 1000)} s`);
  return { idea: result.best.design.idea };
}

async function run() {
  const ctx = await loadContext();
  const series = await loadSeries(opt('--series') || 'original');
  await mkdir(TMP, { recursive: true });
  const renderer = await openRenderer();
  try {
    if (opt('--redo')) return await redo({ ctx, series, renderer, numbers: opt('--redo').split(',').map(Number) });

    const posters = (await listPosters()).filter(p => p.series === series.slug);
    const skip = new Set(opt('--skip')?.split(',') || []);
    const only = opt('--pins')?.split(',');
    const chosen = only ? only.map(id => ctx.all.find(e => e.id === id)).filter(Boolean)
      : selectPins(ctx.all.filter(e => !skip.has(e.id)), Number(opt('--count')) || 10, posters);
    const total = posters.length + chosen.length;
    console.log(`series ${series.name}: making ${chosen.length} posters: ${chosen.map(e => `${e.id} (${e.place.county})`).join(', ')}`);

    // Each run covers the series' ideas itself, and never repeats the idea of the poster before.
    const used = new Set();
    const last = posters.sort((a, b) => b.number - a.number)[0];
    let previous = last ? (await loadVersion(last.id, last.published)).idea.key : null;
    for (const [i, enrich] of chosen.entries()) {
      const number = posters.length + i + 1;
      const pin = ctx.pins.find(p => p.id === enrich.id);
      const ideas = allowedIdeas({ neighbours: [previous], used, enrich, series });
      console.log(`\n${String(number).padStart(2, '0')} ${enrich.id} · ${enrich.place.county} · ideas ${ideas.join(', ')}`);
      const saved = await make({ enrich, pin, ctx, number, total, ideas, series, renderer });
      if (!saved) continue;
      used.add(saved.idea);
      previous = saved.idea;
    }
    await renumber(renderer, series);
  } finally {
    await renderer.close();
  }
}

// A new version of each numbered poster in the series, published in place of the old.
async function redo({ ctx, series, renderer, numbers }) {
  for (const number of numbers) {
    const posters = (await listPosters()).filter(p => p.series === series.slug);
    const target = posters.find(p => p.number === number);
    if (!target) { console.log(`no poster ${number} in ${series.name}`); continue; }
    const enrich = ctx.all.find(e => e.id === target.pin_id);
    const pin = ctx.pins.find(p => p.id === target.pin_id);
    const neighbours = [];
    for (const p of posters.filter(p => Math.abs(p.number - number) === 1)) neighbours.push((await loadVersion(p.id, p.published)).idea.key);
    const ideas = allowedIdeas({ neighbours, used: new Set(), enrich, series });
    console.log(`\nredo ${String(number).padStart(2, '0')} ${enrich.id} · ideas ${ideas.join(', ')}`);
    await make({ enrich, pin, ctx, number, total: posters.length, ideas, series, renderer, publish: true, existingId: target.id });
  }
}

// Brings every version's "NN / total" header up to its series' total and redraws its PNG
// from the saved render spec. No model calls.
export async function renumber(renderer, series) {
  const posters = (await listPosters()).filter(p => p.series === series.slug);
  const total = posters.length;
  for (const meta of posters) {
    for (const { v } of meta.versions) {
      const file = join(ROOT, 'posters', meta.id, `v${v}.json`);
      const rec = JSON.parse(await readFile(file, 'utf8'));
      const head = rec.render.elements.find(e => e.id === 'header-4');
      const tag = series.slug === 'original' ? '' : `${series.name.toUpperCase()} · `;
      const want = `${tag}${String(meta.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      if (!head || head.text === want) continue;
      head.text = want;
      await renderer.render(rec.render, join(ROOT, rec.image));
      await writeFile(file, JSON.stringify(rec, null, 2) + '\n');
      console.log(`    renumbered ${meta.id} v${v} → ${want}`);
    }
  }
}

run().then(() => buildIndex()).then(n => n && console.log(`${n} posters → posters/index.json`));
