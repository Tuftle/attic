import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, createCsvParser, mapHeader, sniffDelimiter } from '../../site/src/core/csv.js';

const TRICKY = '\u{feff}Title,Note,Count\r\n"Show: Season 1: ""Pilot""",plain,3\r\n"multi\nline, with comma",,0\r\nlast,"",\r\n';
const WANT = [
  ['Title', 'Note', 'Count'],
  ['Show: Season 1: "Pilot"', 'plain', '3'],
  ['multi\nline, with comma', '', '0'],
  ['last', '', ''],
];

test('quotes, doubled quotes, newlines in quotes, crlf, bom, empty values', () => {
  assert.deepEqual(parseCsv(TRICKY), WANT);
});

test('the same rows whatever the chunk boundaries', () => {
  for (let size = 1; size <= 7; size++) {
    const rows = [];
    const p = createCsvParser({ onRow: r => rows.push(r) });
    for (let i = 0; i < TRICKY.length; i += size) p.push(TRICKY.slice(i, i + size));
    p.end();
    assert.deepEqual(rows, WANT, 'chunk size ' + size);
  }
});

test('lf, cr only, no final newline, blank lines', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2\r'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n\n1,2\n\n'), [['a', 'b'], ['1', '2']]);
});

test('semicolons and tabs are sniffed', () => {
  assert.equal(sniffDelimiter('a;b;c\n1,2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\n'), '\t');
  assert.equal(sniffDelimiter('"x;y",b\n'), ',');
  assert.deepEqual(parseCsv('a;b\n1;"2;3"\n'), [['a', 'b'], ['1', '2;3']]);
});

test('headers are found by alias, whatever the case and spacing', () => {
  const { index, missing } = mapHeader(['\u{feff}Profile Name', 'START_TIME', 'duration '], {
    profile: ['Profile Name'], start: ['Start Time', 'StartTime'], duration: ['Duration'], title: ['Title'],
  });
  assert.deepEqual(index, { profile: 0, start: 1, duration: 2, title: -1 });
  assert.deepEqual(missing, ['title']);
});
