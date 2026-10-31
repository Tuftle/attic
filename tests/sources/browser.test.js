import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { browserFixture, browserTruth, placesSqlite, BROWSER } from '../gen/browser.js';
import { siteOf } from '../../site/src/sources/browser.js';
import { loadSql } from '../lib/sqljs.js';
import { file } from '../gen/zipwriter.js';
import { assertTruth, assertCardWords } from '../lib/check.js';

const fx = await browserFixture();
const env = { sqlite: loadSql };
const ctx = year => ({ year, timeZone: BROWSER.zone, now: BROWSER.now });

test('site names, and nothing that is not on the web', () => {
  assert.equal(siteOf('https://www.example.org/a?q=secret'), 'example.org');
  assert.equal(siteOf('http://user:pw@Mail.Example.com:8080/x'), 'mail.example.com');
  assert.equal(siteOf('https://www2.bank.example/'), 'bank.example');
  assert.equal(siteOf('file:///home/me/notes.txt'), null);
  assert.equal(siteOf('about:newtab'), null);
  assert.equal(siteOf('http://192.168.1.1/'), null);
  assert.equal(siteOf('http://localhost:3000/'), null);
});

test('firefox and chrome together match the truth', async () => {
  const { results, notes } = await readAll([file('history.zip', fx.zip)], { env });
  assert.deepEqual(notes, []);
  assert.equal(results.browser.files.length, 2);
  for (const year of BROWSER.years) {
    const { cards } = makeYear(results, ctx(year));
    assertTruth(cards, fx.truth[year], String(year));
    assertCardWords(cards);
  }
});

test('page titles, full addresses and searches never reach the store', async () => {
  const { results } = await readAll([file('places.sqlite', fx.places)], { env });
  const s = results.browser.store;
  const strings = s.strings.list.join('\n');
  assert.doesNotMatch(strings, /title|search\?q|\/|https?:/);
  assert.deepEqual(Object.keys(s.meta), []);
});

test('a wal mode copy reads the same', async () => {
  const wal = new Uint8Array(fx.places);
  wal[18] = 2;
  wal[19] = 2;
  const firefoxOnly = fx.visits.filter(v => v.browser === 'firefox');
  await placesSqlite(firefoxOnly);
  const { results } = await readAll([file('places.sqlite', wal)], { env });
  assertTruth(makeYear(results, ctx(2025)).cards, browserTruth(firefoxOnly, 2025));
});

test('a database that is not a history, and a damaged one', async () => {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table recipes (name text)');
  const other = db.export();
  const { notes } = await readAll([file('cookbook.sqlite', other), file('History', fx.history.slice(0, 3000))], { env });
  const by = Object.fromEntries(notes.map(n => [n.path, n]));
  assert.equal(by['cookbook.sqlite'].code, 'schema');
  assert.match(by['cookbook.sqlite'].message, /does not look like a browser history/);
  assert.ok(['malformed', 'not-sqlite'].includes(by.History.code), by.History.code);
});

test('site cards are sensitive, number cards are not', async () => {
  const { results } = await readAll([file('history.zip', fx.zip)], { env });
  const { cards } = makeYear(results, ctx(2025));
  const flags = Object.fromEntries(cards.map(c => [c.id, c.sensitive]));
  assert.deepEqual(flags, {
    'browser.hours': false, 'browser.top-sites': true, 'browser.weekday': false,
    'browser.rabbit-hole': false, 'browser.night': false, 'browser.first-last': true,
  });
});
