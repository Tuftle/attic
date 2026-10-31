import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonListSplitter, readJsonList, peekJsonItems, JsonListError } from '../../site/src/core/jsonstream.js';
import { fromBytes } from '../../site/src/core/files.js';

const enc = new TextEncoder();
const ITEMS = [
  { a: 'brackets ] and } inside', b: [1, [2, [3]]] },
  { q: 'quote \" and backslash \\\\ and \\" escaped' },
  'a string item with , comma',
  42, -1.5e3, true, null,
  { u: 'caf\u{e9} \u{1f3b5} \u{4e2d}\u{6587}' },
  [],
  {},
];
const TEXT = '\u{feff}  [\n' + ITEMS.map(i => '  ' + JSON.stringify(i)).join(' ,\n') + '\n]\n';

function split(bytes, size) {
  const items = [];
  const s = new JsonListSplitter(i => items.push(i));
  for (let i = 0; i < bytes.length; i += size) s.push(bytes.subarray(i, i + size));
  s.end();
  return items;
}

test('splits a list into items, whatever the chunk size', () => {
  const bytes = enc.encode(TEXT);
  for (const size of [1, 2, 3, 5, 64, 100000]) assert.deepEqual(split(bytes, size), ITEMS, 'chunk ' + size);
});

test('empty list and whitespace', () => {
  assert.deepEqual(split(enc.encode(' [ ] '), 1), []);
});

test('clear errors for wrong or damaged json', () => {
  const code = text => {
    try {
      split(enc.encode(text), 3);
    } catch (e) {
      assert.ok(e instanceof JsonListError);
      return e.code;
    }
    return 'ok';
  };
  assert.equal(code('{"a": 1}'), 'not-a-list');
  assert.equal(code('[{"a": 1}, {"b": '), 'truncated');
  assert.equal(code('[{"a": 1}] trailing'), 'garbage');
  assert.equal(code('[{"a": 1} {"b": 2}]'), 'garbage');
  assert.equal(code('[{"a": nope}]'), 'bad-item');
  assert.equal(code(''), 'empty');
});

test('the whole-file path and the streaming path agree', async () => {
  const file = fromBytes('x.json', enc.encode(TEXT));
  const a = [], b = [];
  await readJsonList(file, i => a.push(i));
  await readJsonList(file, i => b.push(i), { streamAbove: 0 });
  assert.deepEqual(a, ITEMS);
  assert.deepEqual(b, ITEMS);
});

test('the whole-file path reports an object at the top', async () => {
  const file = fromBytes('x.json', enc.encode('{"conversations": []}'));
  await assert.rejects(readJsonList(file, () => {}), e => e.code === 'not-a-list' && Array.isArray(e.value.conversations));
});

test('peek reads the first items of a partial head', () => {
  const head = enc.encode(TEXT).subarray(0, 60);
  assert.deepEqual(peekJsonItems(head), [ITEMS[0]]);
});
