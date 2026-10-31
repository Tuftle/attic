import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { discordFixture, discordZip, DISCORD } from '../gen/discord.js';
import { discordTime } from '../../site/src/sources/discord.js';
import { stats } from '../../site/src/core/zip.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const fx = discordFixture();
const ctx = year => ({ year, timeZone: fx.zone, now: fx.now });

test('discord times with microseconds', () => {
  assert.equal(discordTime('2024-01-05 10:00:00.123456+00:00'), Date.UTC(2024, 0, 5, 10, 0, 0, 123));
});

test('the cards match the truth, json and csv channels together', async () => {
  stats.paths.length = 0;
  const { results, notes } = await readAll([file('package.zip', fx.zip)]);
  assert.deepEqual(notes, []);
  assert.ok(!stats.paths.some(p => /activity\//.test(p)), 'analytics files are never opened');
  for (const year of DISCORD.years) {
    const { cards } = makeYear(results, ctx(year));
    assertTruth(cards, fx.truth[year], String(year));
    assertCardWords(cards);
  }
});

test('direct message partners are never named, server names are sensitive', async () => {
  const { results } = await readAll([file('package.zip', fx.zip)]);
  const { cards } = makeYear(results, ctx(2025));
  const text = JSON.stringify(cards.map(c => [c.title, c.big, c.caption, c.detail, c.visual, c.values]));
  assert.doesNotMatch(text, /someone#0|"9\d"/);
  const flags = Object.fromEntries(cards.map(c => [c.id, c.sensitive]));
  assert.equal(flags['discord.top-servers'], true);
  assert.equal(flags['discord.top-channels'], true);
  assert.equal(flags['discord.messages'], false);
  assert.equal(cards.find(c => c.id === 'discord.top-words').optIn, true);
});

test('the same package twice counts once', async () => {
  const { results } = await readAll([file('a.zip', fx.zip), file('b.zip', discordZip(fx.data, { csvFor: 3 }))]);
  assertTruth(makeYear(results, ctx(2025)).cards, fx.truth[2025]);
});
