import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtures, ROOT } from '../../scripts/make-fixtures.mjs';

test('the committed fixtures are exactly what the generators make', async () => {
  for (const [path, data] of Object.entries(await fixtures())) {
    const committed = readFileSync(ROOT + path);
    const fresh = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    assert.ok(committed.equals(fresh), `${path} is out of date. run: npm run make-fixtures`);
  }
});
