// the performance budget from section 8.3 of the design: a million events
// read and turned into cards in under 8 seconds. run with ATTIC_SCALE=1.
// this machine is a cloud container, not a mid-range laptop, so the numbers
// are printed as well as checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { leanHistory } from '../gen/lean.js';

const on = process.env.ATTIC_SCALE === '1';
const history = n => new File(leanHistory(n), 'Streaming_History_Audio_2024-2025.json');

async function run(n) {
  const f = history(n);
  const t0 = performance.now();
  const { results } = await readAll([f], { timeZone: 'Europe/Amsterdam' });
  const t1 = performance.now();
  const { cards } = makeYear(results, { year: 2025, timeZone: 'Europe/Amsterdam', now: Date.UTC(2026, 9, 29) });
  const t2 = performance.now();
  return { events: results.spotify.store.length, mb: Math.round(f.size / 1048576), read: Math.round(t1 - t0), cards: Math.round(t2 - t1), total: Math.round(t2 - t0), count: cards.length };
}

test('a million plays in under 8 seconds', { skip: !on && 'set ATTIC_SCALE=1', timeout: 300000 }, async () => {
  const r = await run(1_000_000);
  console.log(`budget: ${r.events} events, ${r.mb} mb. read ${r.read} ms, cards ${r.cards} ms, total ${r.total} ms`);
  assert.equal(r.events, 1_000_000);
  assert.ok(r.count > 10);
  assert.ok(r.total < 8000, `${r.total} ms`);
});

test('two million plays, for the record', { skip: !on && 'set ATTIC_SCALE=1', timeout: 600000 }, async () => {
  const r = await run(2_000_000);
  console.log(`scale: ${r.events} events, ${r.mb} mb. read ${r.read} ms, cards ${r.cards} ms, total ${r.total} ms`);
  assert.equal(r.events, 2_000_000);
});
