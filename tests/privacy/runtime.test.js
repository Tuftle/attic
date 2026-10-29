// the runtime privacy tests, in a real browser. run: npm run test:browser
// 1. the served page makes no request at all after files are dropped,
//    while it reads every kind of export, saves images and copies text.
// 2. a saved image with names hidden shows no trace of the names.
// 3. the single file works from disk, with no connection.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { serve } from '../../scripts/serve.mjs';
import { build } from '../../scripts/build-single.mjs';
import { playwright, skipBrowser, watch } from '../lib/browser.js';
import { spotifyFixture } from '../gen/spotify.js';
import { netflixFixture } from '../gen/netflix.js';
import { youtubeFixture } from '../gen/youtube.js';
import { chatgptFixture, claudeFixture } from '../gen/chat.js';
import { browserFixture } from '../gen/browser.js';
import { letterboxdFixture, goodreadsFixture } from '../gen/media.js';
import { discordFixture } from '../gen/discord.js';
import { stravaFixture } from '../gen/strava.js';
import { appleFixture } from '../gen/apple.js';
import { steamFixture, amazonFixture } from '../gen/shop.js';

let browser, server, url, dir;
const opts = { skip: skipBrowser, timeout: 240000 };

before(async () => {
  if (skipBrowser) return;
  ({ server, url } = await serve());
  browser = await playwright().chromium.launch();
  dir = join(process.env.ATTIC_TMP || tmpdir(), `attic-runtime-${process.pid}`);
  mkdirSync(dir, { recursive: true });
});
after(async () => {
  await browser?.close();
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function open(page, target) {
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(target);
  await page.waitForSelector('#landing:not([hidden])');
  await page.waitForLoadState('networkidle');
}

test('no request leaves the page after files are dropped', opts, async () => {
  const fixtures = { 'my_spotify_data.zip': spotifyFixture().zip, 'netflix-report.zip': netflixFixture().zip, 'takeout.zip': youtubeFixture().zip, 'chatgpt.zip': chatgptFixture().zip, 'claude.zip': claudeFixture().zip, 'history.zip': (await browserFixture()).zip,
    'letterboxd.zip': letterboxdFixture().zip, 'goodreads.zip': goodreadsFixture().zip, 'package.zip': discordFixture().zip, 'strava.zip': stravaFixture().zip,
    'apple.zip': appleFixture().zip, 'steam.zip': steamFixture().zip, 'amazon.zip': amazonFixture().zip };
  const paths = Object.entries(fixtures).map(([name, bytes]) => { const p = join(dir, name); writeFileSync(p, bytes); return p; });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const log = watch(page);
  const workerRequests = [];
  page.on('worker', w => w.on('console', () => {}));
  ctx.on('request', r => workerRequests.push(r.url()));
  await open(page, url);
  const loaded = log.requests.length;
  const loadedAll = workerRequests.length;

  await page.setInputFiles('#file-input', paths);
  await page.waitForSelector('#found:not([hidden])', { timeout: 120000 });
  const rows = await page.$$eval('#found-rows .found-name', els => els.map(e => e.textContent));
  assert.deepEqual(rows.sort(), ['amazon', 'apple music', 'chatgpt', 'claude', 'discord', 'goodreads', 'letterboxd', 'netflix', 'spotify', 'steam', 'strava', 'your browser', 'youtube'], 'every source was read, browser history through sql.js in the worker');
  await page.selectOption('#year', '2025');
  await page.click('#make');
  await page.waitForSelector('#deck:not([hidden]) .card');
  const total = await page.$eval('#deck-count', el => Number(el.textContent.split(' of ')[1]));
  assert.ok(total > 90, `${total} cards`);
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#card-save')]);
  assert.match(dl.suggestedFilename(), /^attic-2025-06-.*\.png$/);
  await page.click('#deck-keep');
  const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#save-all')]);
  assert.equal(zip.suggestedFilename(), 'attic-2025.zip');
  await page.click('#copy-text');
  await page.click('#proof-open');
  assert.equal(await page.$eval('#proof-count', el => el.textContent), '0');

  const after = log.requests.slice(loaded).filter(r => !/^(blob|data):/.test(r.url));
  const afterAll = workerRequests.slice(loadedAll).filter(u => !/^(blob|data):/.test(u));
  assert.deepEqual(after, [], 'no request from the page');
  assert.deepEqual(afterAll, [], 'no request from the page or its worker');
  assert.deepEqual(await page.evaluate(() => window.__violations), []);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

test('a saved image with names hidden has no trace of the names', opts, async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await open(page, url);
  const result = await page.evaluate(async () => {
    const { drawCard, readPalette } = await import('./src/render/card.js');
    const { card } = await import('./src/core/cards.js');
    const { name, words } = await import('./src/core/templates.js');
    const make = artist => card({
      id: 'spotify.top-artists', source: 'spotify', title: 'top artists', big: name(artist),
      caption: words('your most played artist, {who}.', { who: name(artist) }),
      visual: { type: 'bars', items: [{ label: name(artist), value: 10, display: '10 hours' }, { label: name('Second Band'), value: 5, display: '5 hours' }] },
    });
    const palette = readPalette('spotify');
    const pixels = (c, names) => {
      const canvas = document.createElement('canvas');
      const { regions } = drawCard(canvas, c, { names, palette });
      const ctx = canvas.getContext('2d');
      return { data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data), regions };
    };
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const a = make('Velvet Harbour'), b = make('Quiet Lanterns');
    const hiddenA = pixels(a, false), hiddenB = pixels(b, false), shownA = pixels(a, true), shownB = pixels(b, true);
    return {
      hiddenSame: same(hiddenA.data, hiddenB.data),
      shownSame: same(shownA.data, shownB.data),
      hiddenDiffersFromShown: !same(hiddenA.data, shownA.data),
      region: hiddenA.regions.big,
    };
  });
  assert.equal(result.hiddenSame, true, 'two different artists give the same hidden image, pixel for pixel');
  assert.equal(result.shownSame, false, 'with names on, the artist shows');
  assert.equal(result.hiddenDiffersFromShown, true);
  assert.ok(result.region.w > 0 && result.region.h > 0);
  await ctx.close();
});

test('the single file works from disk, with no connection', opts, async () => {
  const { html } = build();
  const file = join(dir, 'attic.html');
  writeFileSync(file, html);
  const ctx = await browser.newContext({ offline: true });
  const page = await ctx.newPage();
  const log = watch(page);
  await open(page, pathToFileURL(file).href);
  await page.click('a[href="#guides"]');
  assert.equal(await page.isVisible('#guides'), true, 'the guides are inside the file');
  await page.click('a[href="#"]');
  await page.click('#example');
  await page.waitForSelector('#found:not([hidden])', { timeout: 120000 });
  await page.click('#make');
  await page.waitForSelector('#deck:not([hidden]) .card');
  const total = await page.$eval('#deck-count', el => Number(el.textContent.split(' of ')[1]));
  assert.ok(total > 20, `${total} cards`);
  const external = log.requests.filter(r => !/^(blob|data|file):/.test(r.url));
  assert.deepEqual(external, []);
  assert.deepEqual(await page.evaluate(() => window.__violations), []);
  assert.deepEqual(log.errors, []);
  await ctx.close();
});

