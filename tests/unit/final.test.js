import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBest, finalCard, rank } from '../../site/src/core/final.js';

const c = (id, source, value, change = null, extra = {}) => ({ id, source, stat: { label: id, display: String(value), value, change }, ...extra });

test('the biggest change comes first, then the biggest number', () => {
  const cards = [c('a', 's1', 100, 0.1), c('b', 's2', 5, -0.6), c('d', 's3', 1e6), c('e', 's4', 10)];
  assert.deepEqual(rank(cards).map(x => x.id), ['b', 'a', 'd', 'e']);
});

test('one per source first, then the best of the rest, four at most', () => {
  const cards = [c('a1', 'a', 10, 0.9), c('a2', 'a', 10, 0.8), c('a3', 'a', 10, 0.7), c('b1', 'b', 10, 0.1), c('c1', 'c', 10)];
  assert.deepEqual(pickBest(cards).map(x => x.id), ['a1', 'b1', 'c1', 'a2']);
  assert.deepEqual(pickBest(cards.slice(0, 1)).map(x => x.id), ['a1']);
});

test('cards that wait for the visitor never make the last card', () => {
  assert.deepEqual(pickBest([c('w', 'x', 9e9, 5, { optIn: true }), c('ok', 'y', 1)]).map(x => x.id), ['ok']);
});

test('the last card has no names and says what each number is', () => {
  const f = finalCard([c('a', 's1', 100, 0.25), c('b', 's2', 7)], { year: 2025 });
  assert.equal(f.sensitive, false);
  assert.equal(f.visual.type, 'stats');
  assert.deepEqual(f.visual.items.map(i => i.note), ['25% more than last year', '']);
  assert.equal(finalCard([], { year: 2025 }), null);
});
