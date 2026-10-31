import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSql } from '../lib/sqljs.js';
import { isSqlite, openDatabase, tables, columns, rows, prepareBytes } from '../../site/src/core/sqlite.js';

async function sample() {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run('create table moz_places (id integer primary key, url text, title text)');
  db.run('create table moz_historyvisits (id integer primary key, place_id integer, visit_date integer, visit_type integer)');
  db.run("insert into moz_places values (1, 'https://example.org/a', 'a page'), (2, 'https://example.com/', 'home')");
  db.run('insert into moz_historyvisits values (1, 1, 1700000000000000, 1), (2, 2, 1700000060000000, 2)');
  const bytes = db.export();
  db.close();
  return { SQL, bytes };
}

test('opens a database from bytes and reads it row by row', async () => {
  const { SQL, bytes } = await sample();
  assert.ok(isSqlite(bytes));
  const db = openDatabase(SQL, bytes);
  assert.deepEqual(tables(db), ['moz_historyvisits', 'moz_places']);
  assert.deepEqual(columns(db, 'moz_places'), ['id', 'url', 'title']);
  const got = [...rows(db, 'select p.url, v.visit_date from moz_historyvisits v join moz_places p on p.id = v.place_id order by v.id')];
  assert.deepEqual(got, [['https://example.org/a', 1700000000000000], ['https://example.com/', 1700000060000000]]);
  db.close();
});

test('a copy of a wal mode database still opens', async () => {
  const { SQL, bytes } = await sample();
  const wal = new Uint8Array(bytes);
  wal[18] = 2;
  wal[19] = 2;
  const fixed = prepareBytes(wal);
  assert.equal(fixed[18], 1);
  assert.equal(wal[18], 2, 'the original is untouched');
  const db = openDatabase(SQL, wal);
  assert.equal(tables(db).length, 2);
  db.close();
});

test('damaged or wrong files give a plain message', async () => {
  const { SQL, bytes } = await sample();
  assert.ok(!isSqlite(new TextEncoder().encode('hello there, not a database')));
  const broken = bytes.slice(0, 120);
  assert.throws(() => { const db = openDatabase(SQL, broken); tables(db); [...rows(db, 'select * from moz_places')]; }, e => ['malformed', 'not-sqlite'].includes(e.code));
});
