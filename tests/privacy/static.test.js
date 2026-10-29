import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSite, scanText } from '../../scripts/privacy-scan.mjs';

test('nothing in site/ can send data anywhere', () => {
  assert.deepEqual(scanSite(), []);
});

test('the scan catches what it is meant to', () => {
  const bad = {
    'src/a.js': ["fetch('/x')", 'new XMLHttpRequest()', "new WebSocket('wss://x')", 'navigator.sendBeacon(u, d)', "eval('1')", "new Function('x')",
      "el.innerHTML = s", 'document.cookie = 1', 'indexedDB.open(1)', "setTimeout('go()', 1)", 'localStorage.x = 1', "const u = 'https://tracker.example/p'", 'importScripts(x)'],
    'index.html': ['<script>alert(1)</script>', '<script src="https://cdn.example/x.js"></script>', '<p style="color:red">', '<button onclick="x()">',
      '<link rel="stylesheet" href="https://fonts.example/css">', '<a href="https://example.org">', '<form action="/x">', '<style>p{}</style>'],
    'assets/x.css': ["@import url('https://fonts.example/a.css');"],
  };
  for (const [path, snippets] of Object.entries(bad)) {
    for (const s of snippets) assert.ok(scanText(path, s).length > 0, `${path}: ${s}`);
  }
});

test('the vendored files are checked against their recorded contents', () => {
  assert.ok(scanText('vendor/fflate.js', 'fetch(').length > 0);
  assert.ok(scanText('vendor/sample.js', 'anything').length === 0, 'unknown vendor files are left to the checksum test');
  assert.ok(scanText('sample/sample.js', "export const SAMPLE = [];\nfetch('x')\n").length > 0);
});

test('comments may talk about what the code does not do', () => {
  assert.deepEqual(scanText('src/b.js', '// we never fetch( anything\nconst a = 1;\n'), []);
});
