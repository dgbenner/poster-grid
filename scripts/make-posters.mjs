// The poster pipeline. Per poster: idea, copy and layout (model), checks (code),
// critic (model), render (code). Below 7, or failing checks, it goes back to the idea,
// up to 2 retries.
//
//   node scripts/make-posters.mjs                10 English pins, chosen by code
//   node scripts/make-posters.mjs --pins a,b     these pins, in this order
//   node scripts/make-posters.mjs --count 1      just the first of the selection
//   node scripts/make-posters.mjs --redo 2,4     remake these poster numbers in place
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';

process.loadEnvFile(join(ROOT, '.env.local'));
const { IDEAS, accentOptions, buildSpec, checkSpec, describeLayout, photoCredit } = await import('./lib/poster.mjs');
const { MODEL, designer, designBrief, critique, factText } = await import('./lib/designer.mjs');
const { openRenderer } = await import('./lib/renderer.mjs');

const args = process.argv.slice(2);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const PASS = 7;
const RETRIES = 2;
const FIX_ROUNDS = 2;

// ---------- Selection ----------

// 10 English pins over at least 5 counties, at least 3 in London. Prefers pins with an
// article for the place, more photos and more neighbours.
function selectPins(all, count) {
  const score = e => (e.facts.pin ? 3 : 0) + (e.facts.town ? 1 : 0) + Math.min(e.images.length, 5) + Math.min(e.nearby.within5km.length, 3);
  const eligible = all
    .filter(e => e.place.country === 'England' && e.images.length >= 2 && (e.facts.pin || e.facts.town))
    .sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const picked = [];
  const boroughs = new Set();
  for (const e of eligible.filter(e => e.place.county === 'Greater London')) {
    if (picked.length === 3) break;
    if (!boroughs.has(e.place.borough)) { boroughs.add(e.place.borough); picked.push(e); }
  }
  const counties = new Set(['Greater London']);
  const names = new Set(picked.map(e => e.facts.pin?.title));
  for (const e of eligible) {
    if (picked.length >= count) break;
    if (counties.has(e.place.county) || names.has(e.facts.pin?.title)) continue;
    counties.add(e.place.county);
    names.add(e.facts.pin?.title);
    picked.push(e);
  }
  // Alternate London and elsewhere so the run reads as a journey, not a block.
  const london = picked.filter(e => e.place.county === 'Greater London');
  const rest = picked.filter(e => e.place.county !== 'Greater London');
  const out = [];
  while (london.length || rest.length) {
    if (rest.length) out.push(rest.shift());
    if (london.length && out.length % 3 === 2) out.push(london.shift());
    if (!rest.length) out.push(...london.splice(0));
  }
  return out.slice(0, count);
}

// Ideas: never the same as either neighbour, and all four appear across the run. Any
// idea not yet used that this pin can support comes first, so coverage never depends
// on the last few pins.
function allowedIdeas({ neighbours, used, enrich }) {
  let ok = Object.keys(IDEAS).filter(k => !neighbours.includes(k));
  const hasNearby = enrich.nearby.within5km.length + enrich.nearby.sameCounty.length >= 2;
  if (!hasNearby) ok = ok.filter(k => k !== 'nearby');
  const unused = ok.filter(k => !used.has(k));
  return unused.length ? unused : ok;
}

// ---------- One poster ----------

async function makePoster({ enrich, pin, gridCfg, all, number, total, ideas, renderer, tmpDir }) {
  const started = Date.now();
  const usage = { tokens_in: 0, tokens_out: 0 };
  const accents = accentOptions(enrich);
  const facts = factText(enrich);
  const d = designer({ usage });
  const attempts = [];
  let design = await d.first(await designBrief({ enrich, pin, gridCfg, allowedIdeas: ideas, accents }));

  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let spec, report, problems, png;
    for (let fix = 0; ; fix++) {
      spec = buildSpec({ design, gridCfg, enrich, pin, allEnrich: all, number, total });
      const pngPath = join(tmpDir, `${pin.id}-${attempt}-${fix}.png`);
      ({ report, png } = await renderer.render(spec, pngPath));
      problems = checkSpec(spec, { design, enrich, report, factText: facts });
      if (!ideas.includes(design.idea)) problems.push({ check: 'idea', msg: `idea ${design.idea} is not allowed here; use one of ${ideas.join(', ')}` });
      const acc = accents.find(a => a.hex.toUpperCase() === design.accent.toUpperCase());
      if (!acc) problems.push({ check: 'accent', msg: `accent ${design.accent} is not one of the options` });
      else if (acc[design.paper] < 4.5) problems.push({ check: 'accent', msg: `accent ${design.accent} is ${acc[design.paper]}:1 on ${design.paper} paper; needs 4.5` });
      if (!gridCfg.fonts.pairings.some(p => p.id === design.pairing)) problems.push({ check: 'pairing', msg: `pairing ${design.pairing} does not exist` });
      console.log(`    attempt ${attempt + 1}${fix ? ` fix ${fix}` : ''}: ${design.idea}, ${problems.length ? `${problems.length} check${problems.length > 1 ? 's' : ''} failed` : 'checks pass'}`);
      if (!problems.length || fix >= FIX_ROUNDS) break;
      design = await d.revise(`Code checks failed:\n${problems.map(p => `- [${p.check}] ${p.msg}`).join('\n')}\n\nFix these and return the whole design again.`);
    }

    const layout = describeLayout(spec);
    let crit = null;
    if (!problems.length) {
      crit = await critique({ png, gridCfg, layout, design, usage });
      console.log(`    critic: ${crit.mean} (${Object.entries(crit.scores).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    }
    attempts.push({ design, spec, problems, crit, png });
    if (crit && crit.mean >= PASS) break;
    if (attempt === RETRIES) break;
    design = await d.revise(crit
      ? `The critic scored this ${crit.mean} (${Object.entries(crit.scores).map(([k, v]) => `${k} ${v}`).join(', ')}); it needs ${PASS}. Notes:\n${crit.notes.map(n => `- ${n}`).join('\n')}\n\nGo back to the idea. Keep it or choose another allowed idea, then redo copy and layout. Return the whole design.`
      : `The design still fails code checks:\n${problems.map(p => `- [${p.check}] ${p.msg}`).join('\n')}\n\nGo back to the idea and start a fresh layout that avoids these problems. Return the whole design.`);
  }

  const passing = attempts.filter(a => a.crit && !a.problems.length);
  const best = passing.sort((a, b) => b.crit.mean - a.crit.mean)[0] || attempts[attempts.length - 1];
  return {
    best,
    attempts,
    log: { retries: attempts.length - 1, ms: Date.now() - started, ...usage },
    status: best.crit && best.crit.mean >= PASS && !best.problems.length ? 'pass' : best.problems.length ? 'failed-checks' : 'below-bar',
  };
}

// ---------- Run ----------

async function main() {
  const gridCfg = JSON.parse(await readFile(join(ROOT, 'grid/grid.json'), 'utf8'));
  const pins = JSON.parse(await readFile(join(ROOT, 'data/pins.json'), 'utf8'));
  const all = await Promise.all((await readdir(join(ROOT, 'data/enrich'))).filter(f => f.endsWith('.json'))
    .map(async f => JSON.parse(await readFile(join(ROOT, 'data/enrich', f), 'utf8'))));
  await mkdir(join(ROOT, 'posters/img'), { recursive: true });
  const tmpDir = join(ROOT, 'posters/.attempts');
  await mkdir(tmpDir, { recursive: true });
  const existing = (await readdir(join(ROOT, 'posters'))).filter(f => f.endsWith('.json'));

  if (opt('--redo')) return redo({ gridCfg, pins, all, numbers: opt('--redo').split(',').map(Number) });

  const only = opt('--pins')?.split(',');
  let chosen = only ? only.map(id => all.find(e => e.id === id)).filter(Boolean) : selectPins(all, 10);
  if (opt('--count')) chosen = chosen.slice(0, Number(opt('--count')));
  const total = existing.length + chosen.length;
  console.log(`making ${chosen.length} posters with ${MODEL}: ${chosen.map(e => `${e.id} (${e.place.county})`).join(', ')}`);

  const renderer = await openRenderer();
  const used = new Set();
  let previous = null;
  try {
    for (const [i, enrich] of chosen.entries()) {
      const number = existing.length + i + 1;
      const pin = pins.find(p => p.id === enrich.id);
      const ideas = allowedIdeas({ neighbours: [previous], used, enrich });
      console.log(`\n${String(number).padStart(2, '0')} ${enrich.id} · ${enrich.place.county} · ideas ${ideas.join(', ')}`);
      const saved = await makeAndSave({ enrich, pin, gridCfg, all, number, total, ideas, renderer, tmpDir });
      if (!saved) continue;
      used.add(saved.idea);
      previous = saved.idea;
    }
  } finally {
    await renderer.close();
  }
}

// Remakes posters in place: same number and pin, ideas chosen around their neighbours.
async function redo({ gridCfg, pins, all, numbers }) {
  const tmpDir = join(ROOT, 'posters/.attempts');
  await mkdir(tmpDir, { recursive: true });
  const renderer = await openRenderer();
  try {
    for (const number of numbers) {
      const files = (await readdir(join(ROOT, 'posters'))).filter(f => f.endsWith('.json'));
      const posters = await Promise.all(files.map(async f => JSON.parse(await readFile(join(ROOT, 'posters', f), 'utf8'))));
      const target = posters.find(p => p.number === number);
      if (!target) { console.log(`no poster ${number}`); continue; }
      const enrich = all.find(e => e.id === target.pin_id);
      const pin = pins.find(p => p.id === target.pin_id);
      const neighbours = posters.filter(p => Math.abs(p.number - number) === 1).map(p => p.idea.key);
      const used = new Set(posters.filter(p => p.number !== number).map(p => p.idea.key));
      const ideas = allowedIdeas({ neighbours, used, enrich });
      console.log(`\nredo ${String(number).padStart(2, '0')} ${enrich.id} · ideas ${ideas.join(', ')}`);
      await makeAndSave({ enrich, pin, gridCfg, all, number, total: posters.length, ideas, renderer, tmpDir });
    }
  } finally {
    await renderer.close();
  }
}

async function makeAndSave({ enrich, pin, gridCfg, all, number, total, ideas, renderer, tmpDir }) {
      let result;
      try {
        result = await makePoster({ enrich, pin, gridCfg, all, number, total, ideas, renderer, tmpDir });
      } catch (err) {
        console.log(`    FAILED: ${err.message}`);
        return null;
      }
      const { best, attempts, log, status } = result;
      const id = `${String(number).padStart(3, '0')}-${enrich.id}`;
      const photo = best.spec.elements.find(e => e.kind === 'photo');
      await writeFile(join(ROOT, 'posters/img', id + '.png'), best.png);
      await writeFile(join(ROOT, 'posters', id + '.json'), JSON.stringify({
        id, number, pin_id: enrich.id, created_at: new Date().toISOString(), model: MODEL, status,
        idea: { key: best.design.idea, sentence: best.design.idea_sentence },
        title: best.design.poster_title,
        place: enrich.place,
        pairing: best.design.pairing, paper: best.design.paper, accent: best.design.accent,
        copy: best.spec.elements.filter(e => e.text && !e.frame).map(e => ({ element: e.name, text: e.text })),
        facts_used: best.design.facts_used,
        photo: photo ? { ...enrich.images[photo.image], credit: photoCredit(enrich.images[photo.image]) } : null,
        elements: best.design.elements,
        critic: best.crit,
        checks: best.problems,
        attempts: attempts.map(a => ({ idea: a.design.idea, mean: a.crit?.mean ?? null, scores: a.crit?.scores ?? null, problems: a.problems.length })),
        render: best.spec,
        image: `posters/img/${id}.png`,
      }, null, 2) + '\n');
      await appendFile(join(ROOT, 'runs.jsonl'), JSON.stringify({
        at: new Date().toISOString(), pin_id: enrich.id, idea: best.design.idea, retries: log.retries,
        scores: best.crit?.scores ?? null, tokens_in: log.tokens_in, tokens_out: log.tokens_out, ms: log.ms,
      }) + '\n');
      console.log(`    saved ${id} · ${status} · ${best.crit?.mean ?? '—'} · ${log.tokens_in} in / ${log.tokens_out} out · ${Math.round(log.ms / 1000)} s`);
      return { idea: best.design.idea };
}

main();
