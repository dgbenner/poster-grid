// A new version of a poster from Dan's feedback. Called by the local server
// (POST /api/revise); needs the Anthropic key, so it never runs on the published site.
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './http.mjs';
import { IDEAS, colorCandidates } from './poster.mjs';
import { designBrief, reviseBrief } from './designer.mjs';
import { openRenderer } from './renderer.mjs';
import { loadContext, loadSeries, runDesign, versionRecord, logRun } from './pipeline.mjs';
import { addVersion, imagesUsedFor, listPosters, loadPoster, loadVersion } from './store.mjs';

export async function revise({ id, version = null, feedback, onProgress = () => {} }) {
  const ctx = await loadContext();
  const meta = await loadPoster(id);
  const from = version ?? meta.published;
  const current = await loadVersion(id, from);
  // A series sets the starting style; feedback can step outside it ("Try a serif title"),
  // so a revision may use any font pairing. The colour limit still holds.
  const series = { ...(await loadSeries(meta.series)), fonts: ctx.gridCfg.fonts.pairings.map(p => p.id) };
  const enrich = ctx.all.find(e => e.id === meta.pin_id);
  const pin = ctx.pins.find(p => p.id === meta.pin_id);
  const ideas = series.ideas.includes('all') ? Object.keys(IDEAS) : series.ideas;
  const total = (await listPosters()).filter(p => p.series === meta.series).length;

  const brief = await designBrief({ enrich, gridCfg: ctx.gridCfg, allowedIdeas: ideas, candidates: colorCandidates(enrich), series, usedImages: await imagesUsedFor(enrich.id) });
  const first = await reviseBrief({ brief, current, png: await readFile(join(ROOT, current.image)), feedback });

  const tmpDir = join(ROOT, 'posters/.attempts');
  await mkdir(tmpDir, { recursive: true });
  const renderer = await openRenderer();
  try {
    const result = await runDesign({ enrich, pin, gridCfg: ctx.gridCfg, all: ctx.all, number: meta.number, total, ideas, series, renderer, tmpDir, first, feedback, retries: 1, log: onProgress });
    const record = versionRecord({ result, enrich, series, number: meta.number, feedback });
    const v = await addVersion(id, record, result.best.png, { feedback, from });
    await appendFile(join(ROOT, 'data/feedback.jsonl'), JSON.stringify({ at: new Date().toISOString(), poster_id: id, from_version: from, version: v, feedback }) + '\n');
    await logRun({ result, enrich, kind: 'revise', id, version: v });
    return { version: v, status: result.status, mean: result.best.crit?.mean ?? null, followed: result.best.crit?.scores?.followed ?? null };
  } finally {
    await renderer.close();
  }
}
