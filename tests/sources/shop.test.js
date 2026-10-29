import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { steamFixture, licencesHtml, amazonFixture, SHOP } from '../gen/shop.js';
import { steamDate } from '../../site/src/sources/steam.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const st = steamFixture(), am = amazonFixture();

test('steam dates, both ways round', () => {
  assert.equal(steamDate('5 Jan, 2025'), Date.UTC(2025, 0, 5, 12));
  assert.equal(steamDate('Jan 5, 2025'), Date.UTC(2025, 0, 5, 12));
  assert.ok(Number.isNaN(steamDate('soon')));
});

test('steam: the licences page gives the truth, in any time zone and either date order', async () => {
  for (const zip of [st.zip, null]) {
    const inputs = zip ? [file('steam.zip', zip)] : [file('licenses.html', licencesHtml(st.items, { us: true }))];
    const { results } = await readAll(inputs);
    assert.deepEqual(Object.keys(results), ['steam']);
    for (const year of SHOP.years) {
      const { cards } = makeYear(results, { year, timeZone: 'Pacific/Kiritimati', now: st.now });
      assertTruth(cards, st.truth[year], `steam ${year}`);
      assertCardWords(cards);
    }
  }
});

test('amazon: orders, money per currency, and never an address or payment detail', async () => {
  const { results, notes } = await readAll([file('amazon.zip', am.zip)]);
  assert.deepEqual(Object.keys(results), ['amazon']);
  assert.ok(notes.some(n => n.code === 'cancelled'));
  assert.doesNotMatch(results.amazon.store.strings.list.join('\n'), /Private Street|Visa|gift note|example\.org/);
  for (const year of SHOP.years) {
    const { cards } = makeYear(results, { year, timeZone: am.zone, now: am.now });
    assertTruth(cards, am.truth[year], `amazon ${year}`);
    assertCardWords(cards);
    const flags = Object.fromEntries(cards.map(c => [c.id, c.sensitive]));
    assert.equal(flags['amazon.biggest'], true);
    assert.equal(flags['amazon.spent'], false);
  }
});

test('amazon: the same export twice counts once', async () => {
  const { results } = await readAll([file('a.zip', am.zip), file('b.zip', am.zip)]);
  assertTruth(makeYear(results, { year: 2025, timeZone: am.zone, now: am.now }).cards, am.truth[2025]);
});
