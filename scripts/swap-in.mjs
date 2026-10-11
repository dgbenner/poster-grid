// Puts another poster's design into an existing poster's slot (see lib/swap.mjs).
//
//   node scripts/swap-in.mjs <source-id>[@v] <target-id> [...more pairs]
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './lib/http.mjs';
import { swapIn } from './lib/swap.mjs';
import { openRenderer } from './lib/renderer.mjs';
import { buildIndex } from './build-index.mjs';

const args = process.argv.slice(2);
await mkdir(join(ROOT, 'posters/.attempts'), { recursive: true });
const renderer = await openRenderer();
try {
  for (let i = 0; i < args.length; i += 2) {
    const [source, version] = args[i].split('@');
    const nv = await swapIn({ source, version, target: args[i + 1], renderer });
    console.log(`${source} → ${args[i + 1]} v${nv} (published)`);
  }
} finally {
  await renderer.close();
}
console.log(`${await buildIndex()} posters → posters/index.json`);
