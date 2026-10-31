import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture, accountFiles, extendedFiles, zipOf, spotifyTruth, SPOTIFY } from '../gen/spotify.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const fx = spotifyFixture();
const ctx = year => ({ year, timeZone: fx.zone, now: fx.now });

test('the cards match the truth for a finished and an unfinished year', async () => {
  const { results, notes } = await readAll([file('my_spotify_data.zip', fx.zip)]);
  assert.ok(results.spotify, 'spotify was found');
  assert.deepEqual(notes.filter(n => n.code !== 'unnamed'), []);
  for (const year of SPOTIFY.years) {
    const { cards, notes: cn } = makeYear(results, ctx(year));
    assert.deepEqual(cn, []);
    assertTruth(cards, fx.truth[year], String(year));
    assertCardWords(cards);
  }
});

test('the found row describes the export', async () => {
  const { found } = await readAll([file('my_spotify_data.zip', fx.zip)], { timeZone: fx.zone });
  const row = found.rows[0];
  assert.equal(row.id, 'spotify');
  assert.equal(row.files, 4);
  assert.equal(row.range, 'january 2024 to october 2026');
  assert.deepEqual(found.years, [2024, 2025, 2026]);
});

test('loose files work as well as the zip', async () => {
  const loose = Object.entries(fx.files).map(([p, d]) => file(p.split('/').pop(), d));
  const { results } = await readAll(loose);
  assertTruth(makeYear(results, ctx(2025)).cards, fx.truth[2025]);
});

test('the account data variant is read too', async () => {
  const items = fx.items.filter(it => it.t >= Date.UTC(2025, 9, 1));
  const { results } = await readAll([file('my_spotify_data.zip', zipOf(accountFiles(items)))]);
  const { cards } = makeYear(results, ctx(2026));
  const hours = cards.find(c => c.id === 'spotify.hours');
  const want = spotifyTruth(items, 2026)['spotify.hours'];
  assert.equal(hours.values.plays, want.plays);
  assert.equal(hours.values.ms, want.ms);
  assert.ok(!cards.some(c => c.id === 'spotify.top-album'), 'no albums in account data');
  assert.ok(!cards.some(c => c.id === 'spotify.skips'), 'no skips in account data');
});

test('the extended history wins where both variants overlap', async () => {
  const both = { ...fx.files, ...accountFiles(fx.items.filter(it => it.t >= Date.UTC(2025, 11, 1))) };
  const { results, notes } = await readAll([file('both.zip', zipOf(both))]);
  assertTruth(makeYear(results, ctx(2025)).cards, fx.truth[2025]);
  assert.ok(notes.some(n => n.code === 'overlap'));
});

test('two overlapping zips equal the single export', async () => {
  const early = extendedFiles(fx.items.filter(it => it.t < Date.UTC(2025, 8, 1)));
  const late = extendedFiles(fx.items.filter(it => it.t >= Date.UTC(2025, 2, 1)), 'files-late');
  const { results } = await readAll([file('a.zip', zipOf(early)), file('b.zip', zipOf(late))]);
  for (const year of SPOTIFY.years) assertTruth(makeYear(results, ctx(year)).cards, fx.truth[year]);
});
