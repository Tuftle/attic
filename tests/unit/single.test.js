import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { build, transform } from '../../scripts/build-single.mjs';

const { html, policy } = build();
const sha = s => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

test('the single file allows its own inline code by hash, and nothing else', () => {
  const page = html.match(/<script>([\s\S]*?)<\/script>\n<\/body>/)[1];
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(policy.includes(`script-src ${sha(page)} 'wasm-unsafe-eval'`));
  assert.ok(policy.includes(`style-src ${sha(style)}`));
  assert.ok(policy.includes("connect-src 'none'"));
  assert.ok(policy.includes('worker-src blob:'));
  assert.ok(!policy.includes("'unsafe-inline'"));
  assert.ok(html.includes(`content="${policy}"`));
  assert.equal((html.match(/<script>/g) || []).length, 1, 'one inline script');
});

test('both bundles are valid javascript and load nothing', () => {
  const worker = html.match(/<script type="text\/plain" id="attic-worker">([\s\S]*?)<\/script>/)[1];
  const page = html.match(/<script>([\s\S]*?)<\/script>\n<\/body>/)[1];
  new vm.Script(worker);
  new vm.Script(page);
  for (const js of [worker, page]) {
    assert.doesNotMatch(js, /^\s*(import|export)\s/m);
    assert.doesNotMatch(js, /\bimport\s*\(/, 'no dynamic import left');
  }
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/g, '');
  const links = [...markup.matchAll(/\s(src|href)="([^"]*)"/g)].map(m => m[2]);
  assert.ok(links.length > 10);
  for (const l of links) assert.match(l, /^(data:|#|\.\/$|https:\/\/(www\.spotify\.com|www\.netflix\.com|takeout\.google\.com|chatgpt\.com|claude\.ai)\/)/, `the page links only to the services and to itself: ${l}`);
});

test('the bundler refuses forms it does not know', () => {
  assert.throws(() => transform('src/x.js', "import a, { b } from './y.js';"), /cannot bundle/);
  assert.throws(() => transform('src/x.js', "export * from './y.js';"), /cannot bundle/);
  assert.throws(() => transform('src/x.js', "import x from 'somewhere';"), /only relative imports/);
  const ok = transform('src/x.js', "import { a, b as c } from './y.js';\nexport const d = a + c;\nexport { d as e };\nexport default d;");
  assert.deepEqual(ok.deps, ['src/y.js']);
  assert.match(ok.body, /__exports\.e = d;/);
});
