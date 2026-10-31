import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { youtubeFixture, youtubeTruth, watchHtml, watchJson, takeoutZip, YOUTUBE } from '../gen/youtube.js';
import { parseTakeoutDate } from '../../site/src/sources/youtube.js';
import { stats } from '../../site/src/core/zip.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const fx = youtubeFixture();
const ctx = year => ({ year, timeZone: fx.zone, now: fx.now });

test('the cards match the truth', async () => {
  stats.paths.length = 0;
  const { results, notes } = await readAll([file('takeout-20261020.zip', fx.zip)]);
  assert.ok(results.youtube);
  assert.equal(results.youtube.files.length, 1, 'search history is never read');
  assert.ok(!stats.paths.some(p => /\.jpg$/.test(p)), 'the photo in the takeout was never opened');
  assert.ok(notes.some(n => n.code === 'ads'));
  assert.ok(notes.some(n => n.code === 'music'));
  for (const year of YOUTUBE.years) {
    const { cards } = makeYear(results, ctx(year));
    assertTruth(cards, fx.truth[year], String(year));
    assertCardWords(cards);
  }
});

test('youtube cards never claim hours', async () => {
  const { results } = await readAll([file('takeout.zip', fx.zip)]);
  for (const year of YOUTUBE.years) {
    for (const c of makeYear(results, ctx(year)).cards) {
      const text = [c.title, c.big, c.caption, c.detail, c.share.text].join(' ');
      assert.doesNotMatch(text, /\d[\d,.]* hours?\b|hours (watched|of)|watch time|minutes watched/i, c.id);
    }
  }
});

test('the html export gives the same answers, to the second', async () => {
  const items = fx.items.filter(it => it.t >= Date.UTC(2024, 11, 1)).map(it => ({ ...it, t: Math.floor(it.t / 1000) * 1000 }));
  const { results, notes } = await readAll([file('watch-history.html', watchHtml(items))]);
  assert.deepEqual(notes.filter(n => !['ads', 'music'].includes(n.code)), []);
  const { cards } = makeYear(results, ctx(2025));
  assertTruth(cards, youtubeTruth(items, 2025), 'html');
});

test('takeout dates in english, with or without the narrow space', () => {
  assert.equal(parseTakeoutDate('Mar 2, 2025, 9:15:30 PM CET'), Date.UTC(2025, 2, 2, 20, 15, 30));
  assert.equal(parseTakeoutDate('Mar 2, 2025, 9:15:30\u{202f}AM JST'), Date.UTC(2025, 2, 2, 0, 15, 30));
  assert.equal(parseTakeoutDate('Dec 31, 2025, 12:05:00 AM GMT+05:30'), Date.UTC(2025, 11, 30, 18, 35, 0));
  assert.equal(parseTakeoutDate('Jul 4, 2025, 12:00:00 PM EDT'), Date.UTC(2025, 6, 4, 16, 0, 0));
  assert.ok(Number.isNaN(parseTakeoutDate('2 mars 2025, 21:15:30 CET')));
});

test('a history in an unknown date format says how to fix it', async () => {
  const items = fx.items.slice(0, 50).filter(it => it.kind === 'video');
  const html = watchHtml(items).replace(/[A-Z][a-z]{2} \d{1,2}, \d{4}, [^<]+<br><\/div>/g, '2 mars 2025, 21:15:30 CET<br></div>');
  const { notes } = await readAll([file('watch-history.html', html)]);
  assert.ok(notes.some(n => n.code === 'dates' && /export the history again as json/.test(n.message)));
});

test('json and html together count once', async () => {
  const items = fx.items.map(it => ({ ...it, t: Math.floor(it.t / 1000) * 1000 }));
  const { results } = await readAll([file('a.zip', takeoutZip({ 'watch-history.json': watchJson(items), 'watch-history.html': watchHtml(items) }))]);
  assert.equal(makeYear(results, ctx(2025)).cards.find(c => c.id === 'youtube.videos').values.videos, youtubeTruth(items, 2025)['youtube.videos'].videos);
});
