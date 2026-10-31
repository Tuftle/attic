import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadSql } from '../lib/sqljs.js';
import * as fflate from '../../site/vendor/fflate.js';
import wasmBase64 from '../../site/vendor/sql-wasm.wasm.js';

const dir = fileURLToPath(new URL('../../site/vendor/', import.meta.url));
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function recorded() {
  const text = readFileSync(dir + 'VERSIONS.md', 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cells.length === 6 && /^[0-9a-f]{64}$/.test(cells[4])) {
      const [file, pkg, version, from, hash, licence] = cells;
      rows.push({ file, pkg, version, from, hash, licence });
    }
  }
  return rows;
}

test('every vendored file matches its recorded sha256', () => {
  const rows = recorded();
  assert.ok(rows.length >= 5);
  for (const row of rows) assert.equal(sha256(readFileSync(dir + row.file)), row.hash, row.file);
});

test('nothing unrecorded sits in vendor', () => {
  const listed = new Set(recorded().map(r => r.file));
  const derived = new Set(['VERSIONS.md', 'sql-wasm.wasm.js']);
  const extra = readdirSync(dir).filter(f => !listed.has(f) && !derived.has(f));
  assert.deepEqual(extra, []);
});

test('each package has its licence file and exact version', () => {
  const rows = recorded();
  for (const pkg of new Set(rows.map(r => r.pkg))) {
    const own = rows.filter(r => r.pkg === pkg);
    assert.ok(own.some(r => r.file.endsWith('LICENSE.txt')), pkg + ' licence');
    assert.equal(new Set(own.map(r => r.version)).size, 1, pkg + ' one version');
    assert.match(own[0].version, /^\d+\.\d+\.\d+$/);
  }
});

test('the derived wasm module holds exactly the vendored wasm', () => {
  const wasm = readFileSync(dir + 'sql-wasm.wasm');
  const row = recorded().find(r => r.file === 'sql-wasm.wasm');
  assert.equal(sha256(Buffer.from(wasmBase64, 'base64')), row.hash);
  assert.equal(Buffer.from(wasmBase64, 'base64').length, wasm.length);
});

test('fflate zips and unzips', () => {
  const data = new TextEncoder().encode('hello attic '.repeat(100));
  const zipped = fflate.zipSync({ 'a/b.txt': data });
  const out = fflate.unzipSync(zipped);
  assert.deepEqual(out['a/b.txt'], data);
});

test('sql.js opens in node and answers', async () => {
  const SQL = await loadSql();
  const db = new SQL.Database();
  const [res] = db.exec('select 1 + 1 as two');
  assert.equal(res.values[0][0], 2);
  db.close();
});
