import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, DATA, OUT } from '../../scripts/build-guides.mjs';
import { META_CSP } from '../../scripts/policy.mjs';

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const html = readFileSync(OUT, 'utf8');

test('every v1 source has a guide', () => {
  const sources = new Set(data.guides.map(g => g.source));
  for (const s of ['spotify', 'netflix', 'youtube', 'chatgpt', 'claude', 'browser']) assert.ok(sources.has(s), s);
  for (const b of ['firefox', 'wren', 'chrome', 'edge', 'brave']) assert.ok(data.guides.some(g => g.id === b), b);
});

test('each guide has where, how long, the file and steps', () => {
  const ids = new Set();
  for (const g of data.guides) {
    assert.match(g.id, /^[a-z]+$/);
    assert.ok(!ids.has(g.id), 'unique ' + g.id);
    ids.add(g.id);
    assert.ok(g.where && g.where.text, g.id + ' where');
    assert.ok(g.where.url === null || /^https:\/\//.test(g.where.url), g.id + ' url');
    assert.ok(g.wait && g.file, g.id);
    assert.ok(Array.isArray(g.steps) && g.steps.length >= 2, g.id + ' steps');
    assert.ok(Array.isArray(g.tips), g.id + ' tips');
    assert.ok(g.checked === null || /^\d{4}-\d{2}-\d{2}$/.test(g.checked), g.id + ' checked');
  }
});

test('the committed page matches the data', () => {
  assert.equal(html, render(data), 'run: node scripts/build-guides.mjs');
});

test('the page needs no javascript and has no inline style', () => {
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /\sstyle=/i);
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});

test('the page carries the policy and the dark reader lock', () => {
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${META_CSP}">`));
  assert.ok(html.includes('<meta name="darkreader-lock">'));
});

test('visible copy is lowercase, apart from code', () => {
  const body = html.slice(html.indexOf('<body>'));
  const text = body
    .replace(/<code>[\s\S]*?<\/code>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
  const caps = text.match(/[A-Z][^\s]*/g) || [];
  assert.deepEqual(caps, []);
});
