import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { decodePng, diff } from '../lib/png.js';

const dir = new URL('../visual/baseline/', import.meta.url);
const names = readdirSync(dir).filter(n => n.startsWith('image-')).sort();

test('the png reader reads the stored images, and the diff tells them apart', () => {
  assert.ok(names.length > 30);
  const a = decodePng(readFileSync(new URL(names[0], dir)));
  const b = decodePng(readFileSync(new URL(names[1], dir)));
  assert.equal(a.width, 270);
  assert.equal(a.height, 338);
  assert.equal(diff(a, a), 0);
  assert.ok(diff(a, b) > 0.01, 'two different cards differ');
  assert.equal(diff(a, { ...a, width: 1 }), 1);
});
