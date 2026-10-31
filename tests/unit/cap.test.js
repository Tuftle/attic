import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capDeck, BEST, MAX_PER_SOURCE } from '../../site/src/core/cap.js';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture } from '../gen/spotify.js';
import { netflixFixture } from '../gen/netflix.js';
import { file } from '../gen/zipwriter.js';
import { checkText } from '../../scripts/house-rules.mjs';

const sp = spotifyFixture(), nf = netflixFixture();
const { results } = await readAll([file('s.zip', sp.zip), file('n.zip', nf.zip)]);
const { cards } = makeYear(results, { year: 2025, timeZone: 'Europe/Amsterdam', now: sp.now });

test('each source keeps its best cards, in their first order, and the rest wait behind one card', () => {
  const deck = capDeck(cards);
  const spotify = deck.filter(c => c.source === 'spotify');
  assert.deepEqual(spotify.filter(c => !c.more).map(c => c.id), ['spotify.hours', 'spotify.top-artists', 'spotify.top-tracks', 'spotify.clock', 'spotify.repeat', 'spotify.change']);
  const more = spotify.find(c => c.more);
  assert.equal(spotify.at(-1), more, 'the more card comes after the source');
  const all = cards.filter(c => c.source === 'spotify');
  assert.deepEqual([...spotify.filter(c => !c.more), ...more.more].map(c => c.id).sort(), all.map(c => c.id).sort(), 'nothing is lost');
  assert.deepEqual(more.more.map(c => c.id), all.filter(c => !spotify.includes(c)).map(c => c.id), 'the rest keep their order');
  assert.equal(more.big, `${more.more.length} more cards`);
});

test('netflix profiles are capped one by one, and profile names stay out of the more card', () => {
  const deck = capDeck(cards);
  for (const p of ['@1', '@2']) {
    const kept = deck.filter(c => c.source === 'netflix' && !c.more && c.id.endsWith(p));
    assert.ok(kept.length <= MAX_PER_SOURCE && kept.length >= 4, `${p} ${kept.length}`);
  }
  for (const m of deck.filter(c => c.more)) {
    assert.doesNotMatch(m.caption + m.title, /[A-Z]|Sam|Kid/);
    assert.deepEqual(checkText(m.caption, { site: true }), []);
    assert.equal(m.sensitive, false);
  }
});

test('a small source is not touched, and the order lists name real cards', () => {
  const few = cards.filter(c => c.source === 'spotify').slice(0, 4);
  assert.deepEqual(capDeck(few), few);
  for (const [src, ids] of Object.entries(BEST)) assert.ok(ids.length <= MAX_PER_SOURCE && new Set(ids).size === ids.length, src);
});
