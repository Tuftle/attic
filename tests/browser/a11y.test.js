// accessibility in a real browser: axe on every view, light and dark, a
// keyboard-only pass through the deck, and no sideways scrolling at 360 px.
// run: npm run test:browser (needs playwright, and npm install for axe-core)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { serve } from '../../scripts/serve.mjs';
import { playwright, skipBrowser } from '../lib/browser.js';

const require = createRequire(import.meta.url);
const axePath = (() => { try { return require.resolve('axe-core/axe.min.js'); } catch { return null; } })();
const skip = skipBrowser || (!axePath && 'run npm install for axe-core');
let browser, server, url;

before(async () => {
  if (skip) return;
  ({ server, url } = await serve());
  browser = await playwright().chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function axe(page, label) {
  await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map(n => n.target.join(' ')) }));
  });
  return res.map(v => `${label}: ${v.id} (${v.impact}) ${v.nodes.join(', ')}`);
}

async function toDeck(page) {
  await page.click('#example');
  await page.waitForSelector('#found:not([hidden])', { timeout: 60000 });
}

for (const scheme of ['light', 'dark']) {
  test(`axe finds nothing on any view, ${scheme}`, { skip, timeout: 180000 }, async () => {
    // axe is put into the page by the test, so this one page skips the policy
    const ctx = await browser.newContext({ bypassCSP: true, colorScheme: scheme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const problems = [];
    await page.goto(url);
    problems.push(...await axe(page, 'landing'));
    await toDeck(page);
    problems.push(...await axe(page, 'found'));
    await page.click('#make');
    await page.waitForSelector('#deck:not([hidden]) .card');
    for (let i = 0; i < 4; i++) {
      problems.push(...await axe(page, `card ${i + 1}`));
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('End');
    problems.push(...await axe(page, 'last card'));
    await page.click('#deck-keep');
    problems.push(...await axe(page, 'keep'));
    await page.click('#proof-open');
    problems.push(...await axe(page, 'proof'));
    await page.goto(url + 'guides/');
    problems.push(...await axe(page, 'guides'));
    assert.deepEqual(problems, []);
    await ctx.close();
  });
}

test('the whole deck works from the keyboard, with focus always visible', { skip, timeout: 180000 }, async () => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForSelector('#landing:not([hidden])');
  const focusIs = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  const outline = () => page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  let tabs = 0;
  while ((await focusIs()) !== 'example' && tabs < 15) { await page.keyboard.press('Tab'); tabs++; }
  assert.equal(await focusIs(), 'example', 'the example button can be reached by tab');
  assert.notEqual(await outline(), 'none', 'focus is visible');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#found:not([hidden])', { timeout: 60000 });
  assert.equal(await focusIs(), 'found-title', 'focus moves to the new view');
  tabs = 0;
  while ((await focusIs()) !== 'make' && tabs < 40) { await page.keyboard.press('Tab'); tabs++; }
  assert.equal(await focusIs(), 'make');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#deck:not([hidden]) .card');
  const at = () => page.$eval('#deck-count', el => el.textContent);
  assert.equal(await at(), '1 of ' + (await at()).split(' of ')[1]);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.match(await at(), /^3 of /);
  await page.keyboard.press('ArrowLeft');
  assert.match(await at(), /^2 of /);
  await page.keyboard.press('End');
  const total = (await at()).split(' of ')[1];
  assert.equal(await at(), `${total} of ${total}`);
  await page.keyboard.press('Home');
  assert.match(await at(), /^1 of /);
  const live = await page.$eval('#deck-live', el => el.textContent);
  assert.ok(live.length > 10, 'screen readers hear the card');
  tabs = 0;
  while ((await focusIs()) !== 'card-save' && tabs < 20) { await page.keyboard.press('Tab'); tabs++; }
  assert.equal(await focusIs(), 'card-save');
  assert.notEqual(await outline(), 'none');
  await ctx.close();
});

test('at 360 px wide nothing scrolls sideways, and motion stays off when asked', { skip, timeout: 180000 }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 700 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.goto(url);
  assert.ok(await wide() <= 360, `landing ${await wide()}`);
  await toDeck(page);
  assert.ok(await wide() <= 360, `found ${await wide()}`);
  await page.click('#make');
  await page.waitForSelector('#deck:not([hidden]) .card');
  for (let i = 0; i < 12; i++) {
    assert.ok(await wide() <= 360, `card ${i + 1}: ${await wide()}`);
    await page.keyboard.press('ArrowRight');
  }
  assert.equal(await page.$eval('.card', el => getComputedStyle(el).transitionDuration), '0s');
  await page.goto(url + 'guides/');
  assert.ok(await wide() <= 360, `guides ${await wide()}`);
  await ctx.close();
});

