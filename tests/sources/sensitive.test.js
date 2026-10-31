// which cards show names or titles. a sensitive card hides its names in a
// saved image unless the visitor turns them on, so these flags matter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture } from '../gen/spotify.js';
import { netflixFixture, viewingCsv } from '../gen/netflix.js';
import { youtubeFixture } from '../gen/youtube.js';
import { chatgptFixture } from '../gen/chat.js';
import { file } from '../gen/zipwriter.js';
import { redact, leaks } from '../../site/src/core/redact.js';

const EXPECTED = {
  'spotify.hours': false, 'spotify.top-artists': true, 'spotify.top-tracks': true, 'spotify.top-album': true,
  'spotify.peak-day': false, 'spotify.clock': false, 'spotify.night': false, 'spotify.session': false,
  'spotify.discovery': false, 'spotify.loyalty': true, 'spotify.skips': false, 'spotify.repeat': true,
  'spotify.first-last': true, 'spotify.change': false, 'spotify.podcasts': true,
  'netflix.hours': false, 'netflix.top-shows': true, 'netflix.binge': true, 'netflix.tried': true,
  'netflix.first-last': true, 'netflix.night': false, 'netflix.devices': false, 'netflix.rewatch': true,
  'youtube.videos': false, 'youtube.top-channels': true, 'youtube.clock': false, 'youtube.rabbit-hole': false,
  'youtube.shorts': false, 'youtube.busiest-day': false, 'youtube.new-channels': false, 'youtube.change': false,
  'chatgpt.conversations': false, 'chatgpt.words': false, 'chatgpt.busiest': false, 'chatgpt.longest': true,
  'chatgpt.code': false, 'chatgpt.top-words': true, 'chatgpt.please': false, 'chatgpt.first': true,
  'chatgpt.models': false,
};

test('every card is flagged as expected, and hides every name when asked', async () => {
  const sp = spotifyFixture(), nf = netflixFixture(), yt = youtubeFixture(), gpt = chatgptFixture();
  const sam = nf.items.filter(it => it.profile === 'Sam');
  const { results } = await readAll([file('s.zip', sp.zip), file('ViewingActivity.csv', viewingCsv(sam)), file('y.zip', yt.zip), file('c.zip', gpt.zip)]);
  const { cards } = makeYear(results, { year: 2025, timeZone: 'Europe/Amsterdam', now: sp.now });
  const flags = Object.fromEntries(cards.map(c => [c.id, c.sensitive]));
  assert.deepEqual(flags, EXPECTED);
  for (const c of cards) {
    const hidden = redact(c);
    assert.ok(!leaks(hidden, c.names), `${c.id} leaks a name`);
    const face = x => JSON.stringify([x.title, x.big, x.caption, x.detail, x.visual]);
    if (c.sensitive) assert.notEqual(face(hidden), face(c), `${c.id} changes when names are hidden`);
    assert.equal(redact(c, { names: true }), c, 'names on keeps the card as it is');
  }
});

const MORE = {
  'letterboxd.films': false, 'letterboxd.rewatches': false, 'letterboxd.ratings': false, 'letterboxd.decade': false,
  'letterboxd.month': false, 'letterboxd.weekday': false, 'letterboxd.first-last': true, 'letterboxd.change': false,
  'goodreads.books': false, 'goodreads.pages': false, 'goodreads.longest': true, 'goodreads.authors': true,
  'goodreads.ratings': false, 'goodreads.oldest': true, 'goodreads.change': false,
  'discord.messages': false, 'discord.busiest': false, 'discord.places': false, 'discord.streak': false, 'discord.words': false,
  'discord.night': false, 'discord.top-servers': true, 'discord.top-channels': true, 'discord.top-words': true, 'discord.change': false,
  'strava.activities': false, 'strava.distance': false, 'strava.longest': false, 'strava.time': false, 'strava.month': false,
  'strava.weeks': false, 'strava.hour': false, 'strava.elevation': false, 'strava.change': false,
  'steam.games': false, 'steam.how': false, 'steam.month': false, 'steam.first-last': true, 'steam.change': false,
  'amazon.orders': false, 'amazon.spent': false, 'amazon.biggest': true, 'amazon.month': false, 'amazon.weekday': false,
  'amazon.night': false, 'amazon.repeat': true, 'amazon.change': false,
};

test('the later sources are flagged as expected, apple music like spotify', async () => {
  const { letterboxdFixture, goodreadsFixture } = await import('../gen/media.js');
  const { discordFixture } = await import('../gen/discord.js');
  const { stravaFixture } = await import('../gen/strava.js');
  const { appleFixture } = await import('../gen/apple.js');
  const { steamFixture, amazonFixture } = await import('../gen/shop.js');
  const fx = [letterboxdFixture(), goodreadsFixture(), discordFixture(), stravaFixture(), appleFixture(), steamFixture(), amazonFixture()];
  const { results } = await readAll(fx.map((f, i) => file(`${i}.zip`, f.zip)));
  const { cards } = makeYear(results, { year: 2025, timeZone: 'Europe/Amsterdam', now: Date.UTC(2026, 9, 29) });
  const want = { ...MORE, ...Object.fromEntries(Object.entries(EXPECTED).filter(([k]) => k.startsWith('spotify.')).map(([k, v]) => [k.replace('spotify.', 'apple.'), v])) };
  for (const c of cards) {
    assert.ok(c.id in want, `${c.id} is in the table`);
    assert.equal(c.sensitive, want[c.id], c.id);
    assert.ok(!leaks(redact(c), c.names), `${c.id} leaks a name`);
  }
  assert.ok(cards.length >= 40);
});
