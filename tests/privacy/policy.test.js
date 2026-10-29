// the policy: the header vercel sends, and the meta tag in every page, say
// the same thing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSP, META_CSP, HEADERS } from '../../scripts/policy.mjs';
import { render, OUT } from '../../scripts/build-vercel.mjs';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const pages = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === 'vendor' ? [] : pages(p)) : n.endsWith('.html') ? [p] : [];
});

test('the policy is the one in the design', () => {
  assert.equal(CSP, "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  assert.equal(HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(HEADERS['X-Content-Type-Options'], 'nosniff');
  assert.equal(HEADERS['Cross-Origin-Opener-Policy'], 'same-origin');
  for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) assert.ok(HEADERS['Permissions-Policy'].includes(`${feature}=()`), feature);
});

test('vercel.json carries exactly these headers', () => {
  assert.equal(readFileSync(OUT, 'utf8'), render(), 'run: node scripts/build-vercel.mjs');
  const v = JSON.parse(readFileSync(OUT, 'utf8'));
  const sent = Object.fromEntries(v.headers[0].headers.map(h => [h.key, h.value]));
  assert.deepEqual(sent, HEADERS);
  assert.equal(v.outputDirectory, 'site');
  assert.equal(v.headers[0].source, '/(.*)');
});

test('every page has the same policy in a meta tag, minus frame-ancestors', () => {
  const found = pages(SITE);
  assert.ok(found.length >= 2);
  for (const p of found) {
    const html = readFileSync(p, 'utf8');
    const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(m, `${p} has a policy`);
    assert.equal(m[1], META_CSP, p);
    assert.equal(m[1] + "; frame-ancestors 'none'", CSP);
    assert.ok(html.includes('<meta name="referrer" content="no-referrer">'), `${p} referrer`);
  }
});
