// shared checks for cards: the numbers against the truth, and the words
// against the house rules.

import assert from 'node:assert/strict';
import { checkText } from '../../scripts/house-rules.mjs';
import { redact, leaks } from '../../site/src/core/redact.js';

/** deep equal, with a little room for floating point ratios */
export function assertClose(actual, expected, path = 'values') {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', `${path}: expected a number, got ${JSON.stringify(actual)}`);
    if (Number.isInteger(expected)) assert.equal(actual, expected, path);
    else assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${path}: ${actual} is not ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    assert.equal(actual, expected, path);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected a list`);
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((e, i) => assertClose(actual[i], e, `${path}[${i}]`));
    return;
  }
  assert.ok(actual && typeof actual === 'object', `${path}: expected an object`);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${path}: keys`);
  for (const k of Object.keys(expected)) assertClose(actual[k], expected[k], `${path}.${k}`);
}

/** every card's values match the truth, and no card is missing or extra */
export function assertTruth(cards, truth, label = '') {
  const got = Object.fromEntries(cards.map(c => [c.id, c.values]));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(truth).sort(), `${label} card ids`);
  for (const id of Object.keys(truth)) assertClose(got[id], truth[id], `${label} ${id}`);
}

const TEXT_FIELDS = ['title', 'big', 'caption', 'detail'];

/** the house rules for every card, and the hidden-names face for sensitive ones */
export function assertCardWords(cards) {
  for (const c of cards) {
    assert.ok(c.title && c.big && c.caption, `${c.id} has a title, a big line and a caption`);
    const hidden = redact(c);
    for (const f of TEXT_FIELDS) {
      const masked = c.masked[f];
      // with names hidden, what is left is our own words: lowercase and calm
      assert.doesNotMatch(masked, /[A-Z]/, `${c.id} ${f} is lowercase: "${masked}"`);
      assert.deepEqual(checkText(masked, { site: true }), [], `${c.id} ${f} follows the house rules: "${masked}"`);
    }
    assert.doesNotMatch(c.masked.share.text, /[A-Z]/, `${c.id} share text`);
    if (c.sensitive) {
      assert.ok(c.names.length > 0, `${c.id} lists its names`);
      assert.ok(!leaks(hidden, c.names), `${c.id} shows no names when they are hidden`);
    } else {
      assert.deepEqual(c.names, [], `${c.id} has no names`);
    }
  }
}
