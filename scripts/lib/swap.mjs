// Puts another poster's version into a poster's slot: it becomes a new, published version
// of the target, redrawn with the target's header (number / total, no series tag). The
// source poster is hidden; nothing is deleted.
import { join } from 'node:path';
import { ROOT } from './http.mjs';
import { addVersion, listPosters, loadPoster, loadVersion, savePoster } from './store.mjs';

export async function swapIn({ source, version = null, target, renderer }) {
  const t = await loadPoster(target);
  const s = await loadPoster(source);
  const v = Number(version) || s.published;
  const rec = await loadVersion(source, v);
  const total = (await listPosters()).filter(p => p.series === t.series).length;
  const render = structuredClone(rec.render);
  render.elements.find(e => e.id === 'header-1').text = 'WAYPOINTS';
  render.elements.find(e => e.id === 'header-4').text = `${String(t.number).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  const { png } = await renderer.render(render, join(ROOT, 'posters/.attempts', `swap-${target}.png`));
  const nv = await addVersion(target, { ...rec, number: t.number, render, swapped_from: `${source} v${v}` }, png, { publish: true, from: `${source} v${v}` });
  const fresh = await loadPoster(target);
  delete fresh.hidden; delete fresh.hidden_note;
  await savePoster(fresh);
  await savePoster({ ...s, hidden: true, hidden_note: `Swapped into ${target} as v${nv}. Delete these two lines to show it again.` });
  return nv;
}
