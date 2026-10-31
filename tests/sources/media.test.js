import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { letterboxdFixture, goodreadsFixture, goodreadsCsv, MEDIA } from '../gen/media.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const lb = letterboxdFixture(), gr = goodreadsFixture();

for (const [label, fx, id] of [['letterboxd', lb, 'letterboxd'], ['goodreads', gr, 'goodreads']]) {
  test(`${label}: the cards match the truth, whatever the time zone`, async () => {
    const { results } = await readAll([file(`${label}.zip`, fx.zip)]);
    assert.deepEqual(Object.keys(results), [id]);
    for (const year of MEDIA.years) {
      for (const timeZone of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
        const { cards } = makeYear(results, { year, timeZone, now: fx.now });
        assertTruth(cards, fx.truth[year], `${label} ${year} ${timeZone}`);
        assertCardWords(cards);
      }
    }
  });
  test(`${label}: the same export twice counts once`, async () => {
    const { results } = await readAll([file('a.zip', fx.zip), file('b.zip', fx.zip)]);
    assertTruth(makeYear(results, { year: 2025, timeZone: 'UTC', now: fx.now }).cards, fx.truth[2025]);
  });
}

test('goodreads: reviews and private notes are never read, undated books are noted', async () => {
  const { results, notes } = await readAll([file('goodreads_library_export.csv', goodreadsCsv(gr.items, { bom: true }))]);
  assert.doesNotMatch(results.goodreads.store.strings.list.join('\n'), /loved it|private note/);
  assert.ok(notes.some(n => n.code === 'undated' && /6 books/.test(n.message)));
});

test('a goodreads file with the wrong columns says what it has', async () => {
  const { notes } = await readAll([file('goodreads_library_export.csv', 'Title,Author,Date Read,Exclusive Shelf\n')]);
  assert.deepEqual(notes, []);
  const r2 = await readAll([file('goodreads_library_export.csv', 'Name,Writer\nx,y\n')]);
  assert.equal(r2.notes[0].code, 'unknown');
});
