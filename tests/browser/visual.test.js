// visual tests: every card of a fixed made-up year, drawn as a saved image,
// and a few cards on the page at desktop and phone widths, light and dark,
// compared with stored images within a small tolerance.
// fonts differ from machine to machine, so this runs only when asked:
//   ATTIC_VISUAL=1 npm run test:browser        compare
//   ATTIC_VISUAL=update npm run test:browser   store new images

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/serve.mjs';
import { playwright, skipBrowser } from '../lib/browser.js';
import { decodePng, diff } from '../lib/png.js';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture } from '../gen/spotify.js';
import { netflixFixture, viewingCsv } from '../gen/netflix.js';
import { youtubeFixture } from '../gen/youtube.js';
import { chatgptFixture } from '../gen/chat.js';
import { browserFixture } from '../gen/browser.js';
import { loadSql } from '../lib/sqljs.js';
import { file } from '../gen/zipwriter.js';

const MODE = process.env.ATTIC_VISUAL;
const skip = skipBrowser || (!MODE && 'set ATTIC_VISUAL=1 to compare, or ATTIC_VISUAL=update to store');
const BASE = fileURLToPath(new URL('../visual/baseline/', import.meta.url));
const TOLERANCE = 0.01;
let browser, server, url, dir;

before(async () => {
  if (skip) return;
  ({ server, url } = await serve());
  browser = await playwright().chromium.launch();
  mkdirSync(BASE, { recursive: true });
  dir = join(process.env.ATTIC_TMP || tmpdir(), `attic-visual-${process.pid}`);
  mkdirSync(dir, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

function check(name, png, problems) {
  const path = join(BASE, `${name}.png`);
  if (MODE === 'update' || !existsSync(path)) {
    writeFileSync(path, png);
    return;
  }
  const d = diff(decodePng(readFileSync(path)), decodePng(png));
  if (d > TOLERANCE) {
    writeFileSync(join(dir, `${name}.new.png`), png);
    problems.push(`${name}: ${(d * 100).toFixed(2)}% of pixels differ`);
  }
}

async function deck() {
  const nf = netflixFixture();
  const { results } = await readAll([
    file('s.zip', spotifyFixture().zip), file('ViewingActivity.csv', viewingCsv(nf.items.filter(v => v.profile === 'Sam'))),
    file('y.zip', youtubeFixture().zip), file('c.zip', chatgptFixture().zip), file('h.zip', (await browserFixture()).zip),
  ], { env: { sqlite: loadSql } });
  const { cards, final } = makeYear(results, { year: 2025, timeZone: 'Europe/Amsterdam', now: Date.UTC(2026, 9, 29) });
  return [...cards, final];
}

test('every card, drawn as a saved image, looks as it did', { skip, timeout: 300000 }, async () => {
  const cards = await deck();
  const page = await browser.newPage({ colorScheme: 'light' });
  await page.goto(url);
  const problems = [];
  for (const c of cards) {
    const data = await page.evaluate(async c => {
      const { drawCard, readPalette } = await import('./src/render/card.js');
      const big = document.createElement('canvas');
      drawCard(big, c, { names: false, palette: readPalette(c.source) });
      const small = document.createElement('canvas');
      small.width = 270;
      small.height = 338;
      small.getContext('2d').drawImage(big, 0, 0, 270, 338);
      return small.toDataURL('image/png').split(',')[1];
    }, c);
    check(`image-${c.id.replace(/[^a-z0-9]+/gi, '-')}`, Buffer.from(data, 'base64'), problems);
  }
  assert.deepEqual(problems, []);
});

test('cards on the page look as they did, desktop and phone, light and dark', { skip, timeout: 300000 }, async () => {
  const problems = [];
  for (const [label, viewport, scheme] of [['desktop-light', { width: 1280, height: 860 }, 'light'], ['phone-dark', { width: 360, height: 740 }, 'dark'], ['desktop-dark', { width: 1280, height: 860 }, 'dark'], ['phone-light', { width: 360, height: 740 }, 'light']]) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(url);
    await page.click('#example');
    await page.waitForSelector('#found:not([hidden])', { timeout: 60000 });
    await page.selectOption('#zone', 'Europe/Amsterdam');
    await page.click('#make');
    await page.waitForSelector('#deck:not([hidden]) .card');
    const total = await page.$eval('#deck-count', el => Number(el.textContent.split(' of ')[1]));
    const wanted = label.startsWith('desktop-light') ? [1, 2, 5, 6, 7, total] : [1, 2, 6, total];
    for (let i = 1; i <= total; i++) {
      if (wanted.includes(i)) check(`page-${label}-${String(i).padStart(2, '0')}`, await page.locator('.card').screenshot(), problems);
      if (i < total) await page.keyboard.press('ArrowRight');
    }
    await ctx.close();
  }
  assert.deepEqual(problems, []);
});
