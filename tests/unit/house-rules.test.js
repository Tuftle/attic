import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkText, checkRepo, BUZZWORDS } from '../../scripts/house-rules.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const rules = (text, opts) => checkText(text, opts).map(p => p.rule);

test('catches an em dash', () => {
  assert.deepEqual(rules('one \u{2014} two'), ['em dash']);
});

test('catches emojis and flags, not the copyright sign', () => {
  assert.deepEqual(rules('nice \u{1f389}'), ['emoji']);
  assert.deepEqual(rules('\u{2764}\u{fe0f}'), ['emoji', 'emoji']);
  assert.deepEqual(rules('\u{1f1f3}\u{1f1f1}'), ['emoji', 'emoji']);
  assert.deepEqual(rules('\u{a9} 2026 tuftle'), []);
});

test('catches every buzzword, whole words only', () => {
  for (const word of BUZZWORDS) {
    assert.deepEqual(rules(`a ${word} thing`), ['buzzword'], word);
    assert.deepEqual(rules(`a ${word.toUpperCase()} thing`), ['buzzword'], word);
  }
  // a word that only contains one is fine
  assert.deepEqual(rules('paradigmatic'.slice(0, 8) + 'atic'), []);
});

test('the word wrapped only matters in the site', () => {
  const word = 'wr' + 'apped';
  assert.deepEqual(rules(`your year ${word}`, { path: 'site/index.html' }), ['the word wrapped']);
  assert.deepEqual(rules(`your year ${word}`, { path: 'scripts/x.mjs' }), []);
  assert.deepEqual(rules(`un${word}`, { path: 'site/index.html' }), []);
});

test('reports line and column', () => {
  const [p] = checkText('a\nbb \u{2014}');
  assert.equal(p.line, 2);
  assert.equal(p.col, 4);
});

test('plain calm text passes', () => {
  assert.deepEqual(rules('your year, from your own data. nothing is uploaded.', { site: true }), []);
});

test('the whole repository follows the house rules', () => {
  const problems = checkRepo(root);
  assert.deepEqual(problems.map(p => `${p.file}:${p.line} ${p.rule}`), []);
});
