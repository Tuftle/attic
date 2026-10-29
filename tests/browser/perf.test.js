// the performance budget in the browser: a million plays read in the worker
// while the page stays responsive (no main thread task over 50 ms).
// run: ATTIC_SCALE=1 npm run test:browser

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../../scripts/serve.mjs';
import { playwright, skipBrowser } from '../lib/browser.js';
import { leanHistory } from '../gen/lean.js';

const skip = skipBrowser || (process.env.ATTIC_SCALE !== '1' && 'set ATTIC_SCALE=1 as well');
let browser, server, url, dir;

before(async () => {
  if (skip) return;
  ({ server, url } = await serve());
  browser = await playwright().chromium.launch();
  dir = join(process.env.ATTIC_TMP || tmpdir(), `attic-perf-${process.pid}`);
  mkdirSync(dir, { recursive: true });
});
after(async () => { await browser?.close(); server?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

test('a million plays in the worker, and the page never blocks for more than 50 ms', { skip, timeout: 300000 }, async () => {
  const path = join(dir, 'Streaming_History_Audio_2024-2025.json');
  const out = createWriteStream(path);
  for (const part of leanHistory(1_000_000)) if (!out.write(part)) await once(out, 'drain');
  out.end();
  await once(out, 'finish');
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { window.__long.length = 0; });
  const t0 = Date.now();
  await page.setInputFiles('#file-input', [path]);
  await page.waitForSelector('#found:not([hidden])', { timeout: 120000 });
  const read = Date.now() - t0;
  await page.selectOption('#year', '2025');
  const t1 = Date.now();
  await page.click('#make');
  await page.waitForSelector('#deck:not([hidden]) .card', { timeout: 60000 });
  const made = Date.now() - t1;
  const long = await page.evaluate(() => window.__long);
  console.log(`browser: read ${read} ms, cards ${made} ms, main thread tasks over 50 ms: ${JSON.stringify(long)}`);
  assert.ok(read + made < 8000, `${read + made} ms`);
  assert.ok(long.every(d => d <= 50), `long tasks: ${long.join(', ')}`);
});
