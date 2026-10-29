import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeOf, shapeOfFile, csvColumnsMessage, shapeText } from '../../site/src/core/doctor.js';
import { fromBytes } from '../../site/src/core/files.js';
import { loadSql } from '../lib/sqljs.js';

const SECRET = 'my secret song title';

test('a shape has names and types, never values', () => {
  const value = [
    { ts: '2026-01-01T00:00:00Z', ms_played: 1234, master_metadata_track_name: SECRET, skipped: null, tags: [SECRET] },
    { ts: '2026-01-02T00:00:00Z', ms_played: 99, extra: { nested: SECRET } },
  ];
  const shape = shapeOf(value);
  const text = JSON.stringify(shape);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('2026'));
  assert.ok(!text.includes('1234'));
  assert.equal(shape.count, 2);
  assert.deepEqual(Object.keys(shape.items.fields), ['ts', 'ms_played', 'master_metadata_track_name', 'skipped', 'tags', 'extra']);
});

test('maps keyed by ids are summarised, not listed', () => {
  const mapping = {};
  for (let i = 0; i < 20; i++) mapping[`aaaa${i}bbbb-cccc-dddd`] = { message: { author: { role: 'user' } } };
  const shape = shapeOf({ mapping });
  assert.equal(shape.fields.mapping.type, 'map');
  assert.equal(shape.fields.mapping.count, 20);
  assert.ok(!JSON.stringify(shape).includes('aaaa1bbbb'));
});

test('the shape of a csv, a json file and a database', async () => {
  const csv = await shapeOfFile(fromBytes('ViewingActivity.csv', `Profile Name,Start Time,Title\nme,2026-01-01,${SECRET}\n`));
  assert.deepEqual(csv.columns, ['Profile Name', 'Start Time', 'Title']);
  assert.ok(!JSON.stringify(csv).includes(SECRET));
  const json = await shapeOfFile(fromBytes('my private notes.json', JSON.stringify([{ title: SECRET }])));
  assert.equal(json.name, '(a file).json');
  assert.ok(!shapeText(json).includes(SECRET));
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table urls (id integer, url text)');
  db.run(`insert into urls values (1, '${SECRET}')`);
  const sqlite = await shapeOfFile(fromBytes('History', db.export()), { sql: SQL });
  assert.deepEqual(sqlite.tables, { urls: ['id', 'url'] });
  assert.ok(!JSON.stringify(sqlite).includes(SECRET));
});

test('csv column messages say what is there and what was expected', () => {
  assert.equal(
    csvColumnsMessage(['Name', 'Date'], ['profile name', 'start time', 'duration', 'title'], 'netflix viewing'),
    'this csv has the columns name and date. a netflix viewing file has profile name, start time, duration and title.',
  );
});
