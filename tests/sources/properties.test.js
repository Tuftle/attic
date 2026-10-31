// properties that must hold whatever the data: order does not matter,
// a time zone moves the clock and nothing else, and reading a file twice
// or in overlapping parts counts every event once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture, extendedFiles, zipOf } from '../gen/spotify.js';
import { netflixFixture, viewingCsv } from '../gen/netflix.js';
import { youtubeFixture, watchJson, takeoutZip } from '../gen/youtube.js';
import { rng } from '../gen/rng.js';
import { file } from '../gen/zipwriter.js';

const sp = spotifyFixture(), nf = netflixFixture(), yt = youtubeFixture();
const NOW = sp.now;
const strip = cards => cards.map(c => ({ id: c.id, values: c.values, title: c.title, big: c.big, caption: c.caption, detail: c.detail, visual: c.visual }));
const deck = async (inputs, year, timeZone) => strip(makeYear((await readAll(inputs)).results, { year, timeZone, now: NOW }).cards);

test('shuffling the order of plays, views and videos changes nothing', async () => {
  const r = rng('shuffle');
  const sh = list => r.shuffle(list);
  const spShuffled = Object.fromEntries(Object.entries(sp.files).map(([p, d]) => [p, p.endsWith('.json') ? JSON.stringify(sh(JSON.parse(d))) : d]));
  assert.deepEqual(await deck([file('a.zip', zipOf(spShuffled))], 2025, sp.zone), await deck([file('a.zip', sp.zip)], 2025, sp.zone));
  const lines = viewingCsv(nf.items).trim().split('\n');
  const nfShuffled = [lines[0], ...sh(lines.slice(1))].join('\n') + '\n';
  assert.deepEqual(await deck([file('ViewingActivity.csv', nfShuffled)], 2025, nf.zone), await deck([file('ViewingActivity.csv', viewingCsv(nf.items))], 2025, nf.zone));
  const ytShuffled = JSON.stringify(sh(JSON.parse(watchJson(yt.items))));
  assert.deepEqual(await deck([file('watch-history.json', ytShuffled)], 2025, yt.zone), await deck([file('watch-history.json', watchJson(yt.items))], 2025, yt.zone));
});

test('a time zone shifts the hours of the day by its offset, and the totals not at all', async () => {
  // plays well inside the year, so the year's edges do not move anything
  const inside = sp.items.filter(it => it.t > Date.UTC(2025, 0, 3) && it.t < Date.UTC(2025, 11, 28));
  const input = () => [file('a.zip', zipOf(extendedFiles(inside)))];
  const utc = await deck(input(), 2025, 'UTC');
  const plus3 = await deck(input(), 2025, 'Etc/GMT-3'); // three hours east, no daylight saving
  const by = (cards, id) => cards.find(c => c.id === id).values;
  for (const id of ['spotify.hours', 'spotify.top-artists', 'spotify.top-tracks', 'spotify.top-album', 'spotify.loyalty', 'spotify.skips', 'spotify.first-last']) {
    const a = by(utc, id), b = by(plus3, id);
    if (id === 'spotify.hours') { assert.equal(a.ms, b.ms); assert.equal(a.plays, b.plays); } else assert.deepEqual(a, b, id);
  }
  const binsUtc = by(utc, 'spotify.clock').bins, bins3 = by(plus3, 'spotify.clock').bins;
  for (let h = 0; h < 24; h++) assert.equal(bins3[(h + 3) % 24], binsUtc[h], `hour ${h}`);
  assert.equal(by(plus3, 'spotify.clock').peak, (by(utc, 'spotify.clock').peak + 3) % 24);
});

test('daylight saving: the same wall clock hour, whatever the season', async () => {
  // one play at 21:30 local every day of 2025 in amsterdam
  const items = [];
  for (let d = 0; d < 365; d++) {
    const local = new Date(Date.UTC(2025, 0, 1 + d, 21, 30));
    const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Amsterdam', timeZoneName: 'shortOffset' }).formatToParts(local).find(p => p.type === 'timeZoneName').value === 'GMT+2' ? 2 : 1;
    const t = local.getTime() - offset * 3600000;
    items.push({ t, ms: 200000, kind: 'listen', title: 'Same Song', artist: 'Same Band', album: 'Same Album', skipped: false, reasonEnd: 'trackdone' });
  }
  const cards = await deck([file('a.zip', zipOf(extendedFiles(items)))], 2025, 'Europe/Amsterdam');
  const bins = cards.find(c => c.id === 'spotify.clock').values.bins;
  assert.equal(bins[21], 365);
});

test('the same file twice, and overlapping zips, count every event once', async () => {
  for (const [inputs, twice, year, zone] of [
    [[file('a.zip', sp.zip)], [file('a.zip', sp.zip), file('b.zip', sp.zip)], 2025, sp.zone],
    [[file('ViewingActivity.csv', viewingCsv(nf.items))], [file('ViewingActivity.csv', viewingCsv(nf.items)), file('copy.zip', nf.zip)], 2025, nf.zone],
    [[file('t.zip', yt.zip)], [file('t1.zip', takeoutZip({ 'watch-history.json': watchJson(yt.items.slice(0, 9000)) })), file('t2.zip', takeoutZip({ 'watch-history.json': watchJson(yt.items.slice(5000)) }))], 2025, yt.zone],
  ]) {
    assert.deepEqual(await deck(twice, year, zone), await deck(inputs, year, zone));
  }
});

test('chat and browser history: order, duplicates and time zones', async () => {
  const { chatgptFixture, claudeFixture, chatgptJson, claudeJson } = await import('../gen/chat.js');
  const { browserFixture } = await import('../gen/browser.js');
  const { loadSql } = await import('../lib/sqljs.js');
  const env = { sqlite: loadSql };
  const r = rng('shuffle-chat');
  const gpt = chatgptFixture(), cl = claudeFixture(), br = await browserFixture();
  const deckOf = async (inputs, tz, year = 2025) => strip(makeYear((await readAll(inputs, { env })).results, { year, timeZone: tz, now: NOW }).cards);

  assert.deepEqual(await deckOf([file('conversations.json', chatgptJson(r.shuffle(gpt.convs)))], gpt.zone), await deckOf([file('conversations.json', chatgptJson(gpt.convs))], gpt.zone));
  assert.deepEqual(await deckOf([file('conversations.json', claudeJson(r.shuffle(cl.convs)))], cl.zone), await deckOf([file('conversations.json', claudeJson(cl.convs))], cl.zone));
  assert.deepEqual(await deckOf([file('a.zip', gpt.zip), file('b.zip', gpt.zip)], gpt.zone), await deckOf([file('a.zip', gpt.zip)], gpt.zone));
  assert.deepEqual(await deckOf([file('h.zip', br.zip), file('places.sqlite', br.places)], br.zone), await deckOf([file('h.zip', br.zip)], br.zone));

  // videos have no length, so a shift moves only the clock
  const inside = yt.items.filter(it => it.t > Date.UTC(2025, 0, 3) && it.t < Date.UTC(2025, 11, 28));
  const a = await deckOf([file('w.json', watchJson(inside))], 'UTC');
  const b = await deckOf([file('w.json', watchJson(inside))], 'Etc/GMT+5'); // five hours west
  const v = (cards, id) => cards.find(c => c.id === id).values;
  assert.deepEqual(v(a, 'youtube.videos').videos, v(b, 'youtube.videos').videos);
  assert.deepEqual(v(a, 'youtube.top-channels'), v(b, 'youtube.top-channels'));
  for (let h = 0; h < 24; h++) assert.equal(v(b, 'youtube.clock').bins[(h + 19) % 24], v(a, 'youtube.clock').bins[h]);
});
