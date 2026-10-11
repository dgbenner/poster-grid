// One-off: moves posters/<id>.json + posters/img/<id>.png into posters/<id>/v1.*,
// as version 1 of series "original".
import { mkdir, readFile, readdir, rename, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';

const DIR = join(ROOT, 'posters');
for (const f of (await readdir(DIR)).filter(f => f.endsWith('.json') && f !== 'index.json')) {
  const rec = JSON.parse(await readFile(join(DIR, f), 'utf8'));
  const id = rec.id;
  await mkdir(join(DIR, id), { recursive: true });
  await rename(join(ROOT, rec.image), join(DIR, id, 'v1.png'));
  const images_used = rec.photo?.file ? [rec.photo.file] : [];
  const { hidden, hidden_note, ...rest } = rec;
  await writeFile(join(DIR, id, 'v1.json'), JSON.stringify({ ...rest, series: 'original', version: 1, image: `posters/${id}/v1.png`, images_used }, null, 2) + '\n');
  await writeFile(join(DIR, id, 'poster.json'), JSON.stringify({
    id, number: rec.number, series: 'original', pin_id: rec.pin_id, published: 1,
    ...(hidden ? { hidden, hidden_note } : {}),
    versions: [{ v: 1, created_at: rec.created_at, feedback: null, from: null, mean: rec.critic?.mean ?? null, followed: null, status: rec.status }],
  }, null, 2) + '\n');
  await rename(join(DIR, f), join(DIR, id, '.migrated-from.json')).catch(() => {});
  console.log('migrated', id);
}
try { await rmdir(join(DIR, 'img')); } catch {}
