import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { netflixFixture, netflixTruth, viewingCsv, netflixZip, NETFLIX } from '../gen/netflix.js';
import { splitTitle, parseDuration } from '../../site/src/sources/netflix.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const fx = netflixFixture();
const ctx = year => ({ year, timeZone: fx.zone, now: fx.now });

test('titles split into show, season and episode, or stay a film', () => {
  assert.deepEqual(splitTitle('The Owls: Season 2: Copper Tides'), { show: 'The Owls', season: 'Season 2', episode: 'Copper Tides', film: false });
  assert.deepEqual(splitTitle('Wild Hills: Limited Series: Episode 3'), { show: 'Wild Hills', season: 'Limited Series', episode: 'Episode 3', film: false });
  assert.deepEqual(splitTitle('Quiz: Episode 4'), { show: 'Quiz', season: '', episode: 'Episode 4', film: false });
  assert.equal(splitTitle('Mission: The Return').film, true);
  assert.equal(splitTitle('A Plain Film').film, true);
  assert.equal(splitTitle('Show: Part 1: Ep: With Colon').episode, 'Ep: With Colon');
});

test('durations', () => {
  assert.equal(parseDuration('01:02:03'), 3723000);
  assert.equal(parseDuration('02:03'), 123000);
  assert.ok(Number.isNaN(parseDuration('soon')));
});

test('the cards match the truth for both profiles, both years', async () => {
  const { results, notes } = await readAll([file('netflix-report.zip', fx.zip)]);
  assert.ok(results.netflix);
  assert.ok(notes.some(n => n.code === 'trailers'));
  assert.ok(notes.some(n => n.code === 'short'));
  for (const year of NETFLIX.years) {
    const { cards, notes: cn } = makeYear(results, ctx(year));
    assert.deepEqual(cn, []);
    assertTruth(cards, fx.truth[year], String(year));
    assertCardWords(cards);
    assert.ok(cards.some(c => c.id.endsWith('@2')), 'a deck for the second profile');
    assert.ok(cards.every(c => c.sensitive), 'with two profiles every card names its profile');
  }
});

test('one profile gets one deck without profile names', async () => {
  const sam = fx.items.filter(it => it.profile === 'Sam');
  const { results } = await readAll([file('ViewingActivity.csv', viewingCsv(sam))]);
  const { cards } = makeYear(results, ctx(2025));
  assertTruth(cards, netflixTruth(sam, 2025));
  assert.ok(cards.some(c => !c.sensitive), 'number cards are not sensitive');
  assertCardWords(cards);
});

test('a bom, crlf and renamed columns', async () => {
  const header = ['profile', 'start_time', 'duration', 'attributes', 'title', 'supplemental video type', 'device', 'bookmark', 'latest bookmark', 'country'];
  const csv = viewingCsv(fx.items, { bom: true, crlf: true, header });
  const { results } = await readAll([file('ViewingActivity.csv', csv)]);
  assertTruth(makeYear(results, ctx(2025)).cards, fx.truth[2025]);
});

test('missing columns and the short history get plain messages', async () => {
  const { notes } = await readAll([
    file('ViewingActivity.csv', 'Profile Name,When,What\nSam,today,something\n'),
    file('NetflixViewingHistory.csv', 'Title,Date\n"Show: Season 1: Pilot",1/2/25\n'),
    file('budget.csv', 'item,cost\ntea,3\n'),
  ]);
  const by = Object.fromEntries(notes.map(n => [n.path, n]));
  assert.equal(by['ViewingActivity.csv'].message, 'this csv has the columns profile name, when and what. a netflix viewing file has start time, duration and title.');
  assert.equal(by['NetflixViewingHistory.csv'].code, 'netflix-short');
  assert.equal(by['budget.csv'].code, 'unknown');
});

test('the same export twice counts once', async () => {
  const { results } = await readAll([file('a.zip', fx.zip), file('b.zip', netflixZip(fx.items))]);
  assertTruth(makeYear(results, ctx(2025)).cards, fx.truth[2025]);
});
