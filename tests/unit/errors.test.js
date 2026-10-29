// error states that do not need a browser: a year with nothing in it, and
// files that cannot be read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { expandAll } from '../../site/src/core/files.js';
import { spotifyFixture } from '../gen/spotify.js';
import { file } from '../gen/zipwriter.js';

test('a year with nothing in it gives no cards and no last card', async () => {
  const { results } = await readAll([file('a.zip', spotifyFixture().zip)]);
  const { cards, final, notes } = makeYear(results, { year: 2019, timeZone: 'UTC', now: Date.UTC(2026, 9, 29) });
  assert.deepEqual(cards, []);
  assert.equal(final, null);
  assert.deepEqual(notes, []);
});

test('a file the browser cannot read says what to do', async () => {
  const locked = { name: 'History', path: 'History', size: 10, archive: null, head: async () => { throw Object.assign(new Error('locked'), { name: 'NotReadableError' }); }, chunks: async function* () {}, bytes: async () => new Uint8Array(0), text: async () => '' };
  const { notes } = await expandAll([locked]);
  assert.equal(notes[0].code, 'unreadable');
  assert.match(notes[0].message, /close that program or copy the file first/);
});

test('only files attic does not know: nothing to make, and a kind word for each', async () => {
  const { found, notes } = await readAll([file('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0])), file('notes.txt', 'hello')]);
  assert.deepEqual(found.rows, []);
  assert.equal(notes.length, 2);
  assert.ok(notes.every(n => n.message === 'this does not look like an export from a service we know yet.'));
});
