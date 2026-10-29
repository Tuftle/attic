// the format doctor, per source: wrong or damaged files get a plain,
// specific message, and the rest of the drop still works.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll } from '../../site/src/core/pipeline.js';
import { spotifyFixture } from '../gen/spotify.js';
import { youtubeFixture, watchJson } from '../gen/youtube.js';
import { file } from '../gen/zipwriter.js';

const sp = spotifyFixture(), yt = youtubeFixture();
const firstAudio = Object.entries(sp.files).find(([p]) => p.includes('Audio'))[1];

test('spotify: a file with the right name and the wrong content', async () => {
  const { notes } = await readAll([file('Streaming_History_Audio_2025_1.json', '{"not": "a list"}')]);
  assert.match(notes[0].message, /named like a spotify listening history, but it does not hold a list of plays/);
});

test('spotify: a history cut off partway', async () => {
  const cut = firstAudio.slice(0, Math.floor(firstAudio.length / 2));
  const { notes, results } = await readAll([file('Streaming_History_Audio_2024_0.json', cut)]);
  assert.equal(notes.find(n => n.code === 'truncated').message, 'this spotify file stops partway. the download may not have finished.');
  assert.ok(results.spotify.store.length > 0, 'the plays before the cut still count');
});

test('youtube: a history cut off partway', async () => {
  const json = watchJson(yt.items);
  const { notes } = await readAll([file('watch-history.json', json.slice(0, 5000))]);
  assert.match(notes.find(n => n.code === 'truncated').message, /watch history stops partway/);
});

test('a damaged zip and a zip cut short', async () => {
  const cut = sp.zip.slice(0, Math.floor(sp.zip.length * 0.6));
  const { notes, results } = await readAll([file('my_spotify_data.zip', cut), file('fake.zip', 'hello')]);
  const by = Object.fromEntries(notes.map(n => [n.path, n]));
  assert.equal(by['my_spotify_data.zip'].code, 'truncated');
  assert.equal(by['fake.zip'].code, 'not-zip');
  assert.ok(results.spotify, 'the complete files in the cut zip are still read');
});
