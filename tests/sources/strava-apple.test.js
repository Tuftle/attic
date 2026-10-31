import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { stravaFixture, STRAVA } from '../gen/strava.js';
import { appleFixture, playActivityCsv } from '../gen/apple.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const st = stravaFixture(), ap = appleFixture();

test('strava: the cards match the truth, and names and notes are never read', async () => {
  const { results, notes } = await readAll([file('export.zip', st.zip)]);
  assert.deepEqual(Object.keys(results), ['strava']);
  assert.deepEqual(notes, []);
  assert.doesNotMatch(results.strava.store.strings.list.join('\n'), /river|private|nobody/);
  for (const year of STRAVA.years) {
    const { cards } = makeYear(results, { year, timeZone: st.zone, now: st.now });
    assertTruth(cards, st.truth[year], `strava ${year}`);
    assertCardWords(cards);
    assert.ok(cards.every(c => !c.sensitive));
  }
});

test('apple music: the same plays give the same deck as spotify would', async () => {
  const { results } = await readAll([file('apple.zip', ap.zip)]);
  assert.deepEqual(Object.keys(results), ['apple']);
  assert.doesNotMatch(results.apple.store.strings.list.join('\n'), /192\.0\.2/);
  for (const year of [2025, 2026]) {
    const { cards } = makeYear(results, { year, timeZone: ap.zone, now: ap.now });
    assertTruth(cards, ap.truth[year], `apple ${year}`);
    assertCardWords(cards);
  }
});

test('apple music: no artist names and only daily tracks still make a deck', async () => {
  const plays = ap.items.slice(0, 3000).map(p => ({ ...p, artist: '' }));
  const { results } = await readAll([file('Apple Music Play Activity.csv', playActivityCsv(plays))]);
  const { cards } = makeYear(results, { year: 2024, timeZone: ap.zone, now: ap.now });
  assert.ok(!cards.some(c => c.id === 'apple.top-artists'));
  assertCardWords(cards);
  assert.doesNotMatch(cards.map(c => c.caption + c.detail).join(' '), /by \./);
  const daily = 'Country,Track Identifier,Media type,Date Played,Hours,Play Duration Milliseconds,Source Type,Play Count,Skip Count,Track Description\nNL,1,AUDIO,20250304,"9, 10",600000,IPHONE,3,0,Some Band - A Song\nNL,2,AUDIO,20250305,10,200000,IPHONE,1,0,Other Band - Another\n';
  const r2 = await readAll([file('Apple Music - Play History Daily Tracks.csv', daily)]);
  const d = makeYear(r2.results, { year: 2025, timeZone: 'Asia/Tokyo', now: ap.now });
  assert.equal(d.cards.find(c => c.id === 'apple.hours').values.plays, 4);
  assert.ok(!d.cards.some(c => ['apple.clock', 'apple.night', 'apple.session'].includes(c.id)), 'no hours of the day');
  assert.ok(r2.notes.some(n => n.code === 'daily'));
});
