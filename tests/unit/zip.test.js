import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openZip, entryChunks, crc32, stats, ZipError } from '../../site/src/core/zip.js';
import { expandAll, fromBlob } from '../../site/src/core/files.js';
import { writeZip, file } from '../gen/zipwriter.js';
import { unzipSync, zipSync } from '../../site/vendor/fflate.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const ENTRIES = [
  { path: 'folder/a.json', data: '[1,2,3]' },
  { path: 'folder/b.txt', data: 'hello '.repeat(5000), method: 0 },
  { path: 'c/d/e.csv', data: 'x,y\n1,2\n'.repeat(2000) },
];

async function readAll(blob, zip) {
  const out = {};
  for (const e of zip.entries) {
    let s = '';
    for await (const c of entryChunks(blob, e, { verify: true })) s += dec.decode(c, { stream: true });
    out[e.path] = s;
  }
  return out;
}
const want = Object.fromEntries(ENTRIES.map(e => [e.path, e.data]));

test('crc32 matches the known value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(enc.encode('6789'), crc32(enc.encode('12345'))), 0xcbf43926);
});

test('our test writer makes zips that fflate agrees with', () => {
  const out = unzipSync(writeZip(ENTRIES));
  assert.equal(dec.decode(out['c/d/e.csv']), ENTRIES[2].data);
});

test('reads zips made by fflate', async () => {
  const bytes = zipSync(Object.fromEntries(ENTRIES.map(e => [e.path, enc.encode(e.data)])));
  const blob = new Blob([bytes]);
  assert.deepEqual(await readAll(blob, await openZip(blob)), want);
});

for (const [label, opts, entryOpts] of [
  ['plain', {}, {}],
  ['data descriptors', {}, { descriptor: true }],
  ['zip64 records', { zip64: true }, {}],
  ['zip64 with descriptors', { zip64: true }, { descriptor: true }],
  ['bytes in front, offsets shifted', { prefix: enc.encode('#!stub\n'.repeat(10)), relative: true }, {}],
  ['a comment at the end', { comment: 'made for a test' }, {}],
]) {
  test(`reads a zip with ${label}`, async () => {
    const blob = new Blob([writeZip(ENTRIES.map(e => ({ ...e, ...entryOpts })), opts)]);
    const zip = await openZip(blob);
    assert.equal(zip.damaged, null);
    assert.deepEqual(await readAll(blob, zip), want);
  });
}

test('only the entries asked for are inflated', async () => {
  const big = new Uint8Array(30 * 1024 * 1024); // compresses to almost nothing
  const blob = new Blob([writeZip([{ path: 'photos/huge.bin', data: big }, { path: 'wanted.json', data: '[]' }])]);
  const before = stats.inflates;
  const { files } = await expandAll([new File([blob], 'takeout.zip')]);
  const wanted = files.find(f => f.name === 'wanted.json');
  assert.equal(await wanted.text(), '[]');
  assert.equal(stats.inflates - before, 1);
});

test('a cut-off download keeps the complete entries', async () => {
  const bytes = writeZip(ENTRIES);
  const cut = bytes.subarray(0, bytes.length - 200); // the index is gone
  const blob = new Blob([cut]);
  const zip = await openZip(blob);
  assert.equal(zip.damaged, 'truncated');
  assert.deepEqual(zip.entries.map(e => e.path), ENTRIES.map(e => e.path));
  const halfway = new Blob([bytes.subarray(0, 4000)]);
  const z2 = await openZip(halfway);
  assert.equal(z2.entries.at(-1).truncated, true);
  await assert.rejects(async () => { for await (const _ of entryChunks(halfway, z2.entries.at(-1))) { /* read */ } }, e => e.code === 'truncated');
});

test('a damaged entry fails its checksum', async () => {
  const bytes = writeZip([{ path: 'a.txt', data: 'abcdefghij'.repeat(10), method: 0 }]);
  const i = bytes.indexOf(97, 40);
  bytes[i] = 122;
  const blob = new Blob([bytes]);
  const zip = await openZip(blob);
  await assert.rejects(async () => { for await (const _ of entryChunks(blob, zip.entries[0], { verify: true })) { /* read */ } }, e => e instanceof ZipError && e.code === 'damaged');
});

test('not a zip at all', async () => {
  await assert.rejects(openZip(new Blob(['just text, no zip here'])), e => e.code === 'not-zip');
});

test('empty zips, fake zips, nested zips and mac clutter', async () => {
  const inner = writeZip([{ path: 'inner/conversations.json', data: '[]' }]);
  const outer = writeZip([
    { path: 'export.zip', data: inner },
    { path: '__MACOSX/._export.zip', data: 'x' },
    { path: 'notes.txt', data: 'hi' },
  ]);
  const { files, notes } = await expandAll([
    file('outer.zip', outer),
    file('empty.zip', writeZip([])),
    file('broken.zip', 'this is not a zip'),
    file('plain.json', '[]'),
  ]);
  assert.deepEqual(files.map(f => f.path).sort(), ['outer.zip/export.zip/inner/conversations.json', 'outer.zip/notes.txt', 'plain.json']);
  assert.ok(files.every(f => f.path === 'plain.json' || f.archive === 'outer.zip'));
  assert.deepEqual(notes.map(n => [n.path, n.code]).sort(), [['broken.zip', 'not-zip'], ['empty.zip', 'empty']]);
  const nested = files.find(f => f.name === 'conversations.json');
  assert.equal(await nested.text(), '[]');
});

test('heads stop early', async () => {
  const blob = new Blob([writeZip([{ path: 'big.txt', data: 'z'.repeat(2_000_000) }])]);
  const { files } = await expandAll([new File([blob], 'x.zip')]);
  const head = await files[0].head(100);
  assert.equal(head.length, 100);
  assert.equal(dec.decode(head), 'z'.repeat(100));
});

test('loose files read the same way', async () => {
  const f = fromBlob(new Blob(['\u{feff}hello']), 'a.txt');
  assert.equal(await f.text(), 'hello');
  assert.equal((await f.head(2)).length, 2);
});
