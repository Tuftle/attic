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
