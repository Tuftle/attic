// a walk through every view with the example year, at desktop and phone
// widths, in light and dark. screenshots go to tests/out/walkthrough/.
// run: node tests/visual/walkthrough.mjs

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '../../scripts/serve.mjs';
import { playwright, watch } from '../lib/browser.js';

const OUT = fileURLToPath(new URL('../out/walkthrough/', import.meta.url));

export async function walk({ only } = {}) {
  const pw = playwright();
  if (!pw) throw new Error('playwright is not installed');
  mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await pw.chromium.launch();
  const shots = [];
  const problems = [];
  try {
    for (const [label, viewport] of [['desktop', { width: 1280, height: 860 }], ['phone', { width: 360, height: 740 }]]) {
      for (const scheme of ['light', 'dark']) {
        if (only && only !== `${label}-${scheme}`) continue;
        const ctx = await browser.newContext({ viewport, colorScheme: scheme, reducedMotion: 'reduce', deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const log = watch(page);
        await page.addInitScript(() => {
          window.__violations = [];
          document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
        });
        await page.goto(url);
        const shot = async name => {
          const path = `${OUT}${label}-${scheme}-${name}.png`;
          await page.screenshot({ path });
          shots.push(path);
        };
        await page.waitForSelector('#landing:not([hidden])');
        await shot('1-landing');
        await page.click('#example');
        await page.waitForSelector('#found:not([hidden])', { timeout: 60000 });
        await shot('2-found');
        await page.click('#make');
        await page.waitForSelector('#deck:not([hidden]) .card', { timeout: 60000 });
        const count = await page.$eval('#deck-count', el => Number(el.textContent.split(' of ')[1]));
        for (let i = 0; i < count; i++) {
          if (i < 4 || i % 6 === 0 || i === count - 1) await shot(`3-card-${String(i + 1).padStart(2, '0')}`);
          if (i < count - 1) await page.keyboard.press('ArrowRight');
        }
        if (label === 'desktop') {
          // saved images: a card with names, hidden and shown, and the last card as a story
          await page.keyboard.press('Home');
          await page.keyboard.press('ArrowRight');
          const save = async name => {
            const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#card-save')]);
            const path = `${OUT}${label}-${scheme}-${name}.png`;
            await dl.saveAs(path);
            shots.push(path);
          };
          await save('5-image-names-hidden');
          await page.click('#card-names');
          await save('5-image-names-shown');
          await page.keyboard.press('End');
          await page.click('#deck-keep');
          await page.check('input[name="size"][value="story"]');
          await page.click('#keep-back');
          await save('5-image-story');
          await page.click('#deck-keep');
          await page.check('input[name="size"][value="card"]');
          await page.click('#keep-back');
        }
        await page.click('#deck-keep');
        await page.waitForSelector('#keep:not([hidden])');
        await shot('4-keep');
        await page.click('#proof-open').catch(() => {});
        const violations = await page.evaluate(() => window.__violations);
        problems.push(...log.errors.map(e => `${label}-${scheme} error: ${e}`), ...violations.map(v => `${label}-${scheme} policy: ${v}`));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { shots, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { shots, problems } = await walk({ only: process.argv[2] });
  console.log(`${shots.length} screenshots in tests/out/walkthrough/`);
  for (const p of problems) console.log(p);
  if (problems.length) process.exit(1);
}
