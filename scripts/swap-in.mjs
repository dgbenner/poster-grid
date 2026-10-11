// Puts another poster's design into an existing poster's slot: the design becomes a new,
// published version of the target, redrawn with the target's header (number / total,
// no series tag). The source poster is hidden; nothing is deleted.
//
//   node scripts/swap-in.mjs <source-id>[@v] <target-id> [...more pairs]
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';
import { addVersion, listPosters, loadPoster, loadVersion, savePoster } from './lib/store.mjs';
import { openRenderer } from './lib/renderer.mjs';
import { buildIndex } from './build-index.mjs';

const args = process.argv.slice(2);
const renderer = await openRenderer();
try {
  for (let i = 0; i < args.length; i += 2) {
    const [srcId, srcV] = args[i].split('@');
    const target = await loadPoster(args[i + 1]);
    const src = await loadPoster(srcId);
    const v = Number(srcV) || src.published;
    const rec = await loadVersion(srcId, v);
    const total = (await listPosters()).filter(p => p.series === target.series).length;
    const render = structuredClone(rec.render);
    render.elements.find(e => e.id === 'header-1').text = 'WAYPOINTS';
    render.elements.find(e => e.id === 'header-4').text = `${String(target.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
    const tmp = join(ROOT, 'posters/.attempts', `swap-${target.id}.png`);
    const { png } = await renderer.render(render, tmp);
    const nv = await addVersion(target.id, { ...rec, number: target.number, render, swapped_from: `${srcId} v${v}` }, png, { publish: true, from: `${srcId} v${v}` });
    // The target shows again if it was hidden; the source is hidden.
    const t = await loadPoster(target.id);
    delete t.hidden; delete t.hidden_note;
    await savePoster(t);
    const s = await loadPoster(srcId);
    await savePoster({ ...s, hidden: true, hidden_note: `Swapped into ${target.id} as v${nv}. Delete these two lines to show it again.` });
    console.log(`${srcId} v${v} → ${target.id} v${nv} (published)`);
  }
} finally {
  await renderer.close();
}
console.log(`${await buildIndex()} posters → posters/index.json`);
