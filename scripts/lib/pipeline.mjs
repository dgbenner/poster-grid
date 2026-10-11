// The design loop shared by new posters and new versions: design (model), checks (code),
// critic (model), retry. Rendering happens here too, so every attempt is checked as drawn.
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './http.mjs';
import { buildSpec, checkSpec, colorCandidates, describeLayout, imagesUsed, photoCredit } from './poster.mjs';
import { MODEL, critique, designer, factText } from './designer.mjs';

export const PASS = 7;
const FIX_ROUNDS = 2;

export async function loadContext() {
  const gridCfg = JSON.parse(await readFile(join(ROOT, 'grid/grid.json'), 'utf8'));
  const pins = JSON.parse(await readFile(join(ROOT, 'data/pins.json'), 'utf8'));
  const all = await Promise.all((await readdir(join(ROOT, 'data/enrich'))).filter(f => f.endsWith('.json'))
    .map(async f => JSON.parse(await readFile(join(ROOT, 'data/enrich', f), 'utf8'))));
  return { gridCfg, pins, all };
}

export async function loadSeries(slug) {
  const s = JSON.parse(await readFile(join(ROOT, 'series', `${slug}.json`), 'utf8'));
  return { ...s, fonts: [].concat(s.fonts), maxColors: Math.min(3, s.maxColors ?? 3) };
}

const scoreLine = c => Object.entries(c.scores).map(([k, v]) => `${k} ${v}`).join(', ');

// Renders a design; when the photo credits don't fit their footer cell, renders again
// with the credits moved to the footer's last line.
async function renderDesign({ design, ctx, png }) {
  let spec = buildSpec({ ...ctx, design });
  let out = await ctx.renderer.render(spec, png);
  if (out.report['footer-5']?.overflow) {
    spec = buildSpec({ ...ctx, design, creditsLine: true });
    out = await ctx.renderer.render(spec, png);
  }
  return { spec, ...out };
}

// Runs the loop. `first` is the opening brief; `feedback` (Dan's words) adds the
// "followed" score and makes passing need 7 on it too.
export async function runDesign({ enrich, pin, gridCfg, all, number, total, ideas, series, renderer, tmpDir, first, feedback = null, retries = 2, log = console.log }) {
  const started = Date.now();
  const usage = { tokens_in: 0, tokens_out: 0 };
  const candidates = colorCandidates(enrich);
  const facts = factText(enrich);
  const ctx = { gridCfg, enrich, pin, allEnrich: all, number, total, series: series.name, renderer };
  const d = designer({ usage });
  const attempts = [];
  log({ stage: 'design', attempt: 1, msg: 'Designing' });
  let design = await d.first(first);

  const passes = c => c && c.mean >= PASS && (!feedback || c.scores.followed >= PASS);
  for (let attempt = 0; attempt <= retries; attempt++) {
    let spec, report, problems, png;
    for (let fix = 0; ; fix++) {
      ({ spec, report, png } = await renderDesign({ design, ctx, png: join(tmpDir, `${pin.id}-${attempt}-${fix}.png`) }));
      problems = checkSpec(spec, { design, enrich, report, factText: facts, candidates, maxColors: series.maxColors });
      if (!ideas.includes(design.idea)) problems.push({ check: 'idea', msg: `idea ${design.idea} is not allowed here; use one of ${ideas.join(', ')}` });
      if (!series.fonts.includes(design.pairing)) problems.push({ check: 'pairing', msg: `pairing ${design.pairing} is not in series ${series.name}; use one of ${series.fonts.join(', ')}` });
      log({ stage: 'checks', attempt: attempt + 1, msg: `${design.idea}, ${problems.length ? `${problems.length} check${problems.length > 1 ? 's' : ''} failed` : 'checks pass'}${fix ? ` (fix ${fix})` : ''}` });
      if (!problems.length || fix >= FIX_ROUNDS) break;
      design = await d.revise(`Code checks failed:\n${problems.map(p => `- [${p.check}] ${p.msg}`).join('\n')}\n\nFix these and return the whole design again.`);
    }

    let crit = null;
    if (!problems.length) {
      log({ stage: 'critic', attempt: attempt + 1, msg: 'Critic scoring' });
      crit = await critique({ png, gridCfg, layout: describeLayout(spec), design, usage, feedback });
      const vals = Object.values(crit.scores);
      crit.mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
      log({ stage: 'critic', attempt: attempt + 1, msg: `critic ${crit.mean} (${scoreLine(crit)})` });
    }
    attempts.push({ design, spec, problems, crit, png });
    if (passes(crit) || attempt === retries) break;
    log({ stage: 'design', attempt: attempt + 2, msg: 'Retrying' });
    design = await d.revise(crit
      ? `The critic scored this ${crit.mean} (${scoreLine(crit)}); it needs ${PASS}${feedback ? `, and ${PASS} on followed` : ''}. Notes:\n${crit.notes.map(n => `- ${n}`).join('\n')}\n\n${feedback ? `Keep following Dan's feedback: "${feedback}". ` : 'Go back to the idea. Keep it or choose another allowed idea, then redo copy and layout. '}Return the whole design.`
      : `The design still fails code checks:\n${problems.map(p => `- [${p.check}] ${p.msg}`).join('\n')}\n\nStart a fresh layout that avoids these problems. Return the whole design.`);
  }

  const passing = attempts.filter(a => a.crit && !a.problems.length);
  const rank = a => a.crit.mean + (feedback ? a.crit.scores.followed : 0);
  const best = passing.sort((a, b) => rank(b) - rank(a))[0] || attempts[attempts.length - 1];
  const status = !best.problems.length && passes(best.crit) ? 'pass' : best.problems.length ? 'failed-checks' : 'below-bar';
  return { best, attempts, status, candidates, usage, ms: Date.now() - started };
}

// The saved form of one version.
export function versionRecord({ result, enrich, series, number, feedback = null }) {
  const { best, attempts, status, candidates } = result;
  const used = imagesUsed(best.design).map(i => enrich.images[i]).filter(Boolean);
  return {
    pin_id: enrich.id, number, series: series.slug, created_at: new Date().toISOString(), model: MODEL, status, feedback,
    idea: { key: best.design.idea, sentence: best.design.idea_sentence },
    title: best.design.poster_title,
    place: enrich.place,
    pairing: best.design.pairing, paper: best.design.paper,
    colors: best.design.colors, color_candidates: candidates,
    copy: best.spec.elements.filter(e => e.text && !e.frame).map(e => ({ element: e.name, text: e.text })),
    facts_used: best.design.facts_used,
    photos: used.map(im => ({ ...im, credit: photoCredit(im) })),
    images_used: used.map(im => im.file),
    elements: best.design.elements,
    critic: best.crit,
    checks: best.problems,
    attempts: attempts.map(a => ({ idea: a.design.idea, mean: a.crit?.mean ?? null, scores: a.crit?.scores ?? null, problems: a.problems.length })),
    render: best.spec,
  };
}

export const logRun = ({ result, enrich, kind = 'poster', id = null, version = null }) => appendFile(join(ROOT, 'runs.jsonl'), JSON.stringify({
  at: new Date().toISOString(), kind, poster_id: id, version, pin_id: enrich.id, idea: result.best.design.idea,
  retries: result.attempts.length - 1, scores: result.best.crit?.scores ?? null,
  tokens_in: result.usage.tokens_in, tokens_out: result.usage.tokens_out, ms: result.ms,
}) + '\n');
