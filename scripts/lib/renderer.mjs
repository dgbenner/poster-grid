// Renders poster specs to PNG with Playwright, through the local server so fonts,
// grid code and images load exactly as they do in the gallery.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from './http.mjs';

const PORT = 5197;

export async function openRenderer() {
  const server = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://localhost:${PORT}/render/poster.html`); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  // Installed Chrome, so Playwright needs no browser download.
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2.5 });
  await page.goto(`http://localhost:${PORT}/render/poster.html`);
  await page.waitForFunction(() => window.posterReady === true);

  return {
    async render(spec, pngPath) {
      const report = await page.evaluate(s => window.renderPoster(s), spec);
      await page.evaluate(() => document.fonts.ready);
      const buf = await page.locator('#poster').screenshot({ path: pngPath, type: 'png' });
      return { report, png: buf };
    },
    async close() {
      await browser.close();
      server.kill();
    },
  };
}
