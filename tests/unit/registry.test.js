import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAll } from '../../site/src/core/pipeline.js';
import { EventStore } from '../../site/src/core/store.js';
import { readJsonList } from '../../site/src/core/jsonstream.js';
import { writeZip, file } from '../gen/zipwriter.js';

// two stand-in sources, to test the registry on its own
const plays = {
  id: 'plays', name: 'plays', unit: 'plays',
  match: f => (/^plays.*\.json$/.test(f.name) ? 0.6 : 0),
  detect(files) {
    return { files: files.filter(f => /"played"/.test(f.headText)).map(f => ({ file: f, score: /^plays/.test(f.name) ? 0.9 : 0.6 })) };
  },
  async parse(files) {
    const store = new EventStore();
    for (const f of files) await readJsonList(f, i => store.push({ t: Date.parse(i.played), kind: 'listen', title: i.title }));
    return { store, notes: [] };
  },
  cards: () => [],
};
const greedy = {
  id: 'greedy', name: 'greedy',
  detect: files => ({ score: 0.55, files: files.filter(f => f.name.endsWith('.json')) }),
  async parse() { return { store: new EventStore(), notes: [] }; },
  cards: () => [],
};
const sources = [greedy, plays];

const items = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ played: new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString(), title: 'song ' + (i % 5) })));

test('each file goes to the source most sure of it', async () => {
  const { results, notes, found } = await readAll([file('plays-2026.json', items(10)), file('other.json', '{}')], { sources });
  assert.equal(results.plays.store.length, 10);
  assert.deepEqual(results.plays.files.map(f => f.name), ['plays-2026.json']);
  assert.deepEqual(results.greedy.files.map(f => f.name), ['other.json']);
  assert.equal(notes.length, 0);
  assert.equal(found.rows.find(r => r.id === 'plays').text, 'plays, 1 file, january 2026');
});

test('unknown files and zips get a kind message', async () => {
  const { notes } = await readAll([
    file('holiday.jpg', new Uint8Array([0xff, 0xd8, 0xff, 1, 2])),
    file('stuff.zip', writeZip([{ path: 'a.txt', data: 'hi' }])),
    file('blank.csv', ''),
  ], { sources });
  const by = Object.fromEntries(notes.map(n => [n.path, n.message]));
  assert.equal(by['holiday.jpg'], 'this does not look like an export from a service we know yet.');
  assert.equal(by['stuff.zip'], 'we did not find anything we know in this zip.');
  assert.equal(by['blank.csv'], 'this file is empty.');
});

test('the same file twice counts once', async () => {
  const one = await readAll([file('plays.json', items(50))], { sources });
  const two = await readAll([file('plays.json', items(50)), file('plays copy.json', items(50))], { sources });
  assert.equal(two.results.plays.store.length, one.results.plays.store.length);
  assert.equal(two.results.plays.removed, 50);
});

test('two overlapping zips equal one export', async () => {
  const all = JSON.parse(items(100));
  const a = JSON.stringify(all.slice(0, 70)), b = JSON.stringify(all.slice(40));
  const single = await readAll([file('x.zip', writeZip([{ path: 'plays.json', data: items(100) }]))], { sources });
  const split = await readAll([file('y.zip', writeZip([{ path: 'plays.json', data: a }])), file('z.zip', writeZip([{ path: 'plays.json', data: b }]))], { sources });
  assert.deepEqual(split.results.plays.store.toEvents(), single.results.plays.store.toEvents());
});

test('a source that fails says so without stopping the others', async () => {
  const broken = { ...plays, id: 'broken', name: 'broken', match: () => 0, detect: f => ({ score: 0.99, files: f.filter(x => x.name === 'bad.json') }), async parse() { throw new Error('nope'); } };
  const { results, notes } = await readAll([file('bad.json', '[]'), file('plays.json', items(3))], { sources: [broken, plays] });
  assert.equal(results.plays.store.length, 3);
  assert.equal(notes[0].source, 'broken');
  assert.match(notes[0].message, /could not read this broken export/);
});
