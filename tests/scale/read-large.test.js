// large inputs, generated on the fly and never committed. run with
// ATTIC_SCALE=1 npm run test:scale. checks that a 300 mb json list, alone
// and inside a zip, is read without holding the file in memory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAsBlob, createWriteStream, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Zip, ZipDeflate } from '../../site/vendor/fflate.js';
import { readJsonList } from '../../site/src/core/jsonstream.js';
import { expandAll, fromBlob } from '../../site/src/core/files.js';

const on = process.env.ATTIC_SCALE === '1';
const TARGET = 300 * 1024 * 1024;
const enc = new TextEncoder();

function* jsonChunks() {
  let bytes = 0, i = 0;
  yield enc.encode('[\n');
  while (bytes < TARGET) {
    const parts = [];
    for (let k = 0; k < 2000; k++, i++) {
      parts.push(JSON.stringify({
        ts: new Date(Date.UTC(2019, 0, 1) + i * 97000).toISOString(), platform: 'android', ms_played: 30000 + (i % 200000),
        conn_country: 'NL', master_metadata_track_name: `track ${i % 50000}`, master_metadata_album_artist_name: `artist ${i % 3000}`,
        master_metadata_album_album_name: `album ${i % 8000}`, spotify_track_uri: `spotify:track:${(i % 50000).toString(36).padStart(22, '0')}`,
        reason_start: 'trackdone', reason_end: 'trackdone', shuffle: i % 3 === 0, skipped: i % 11 === 0, offline: false,
      }));
    }
    const chunk = enc.encode((i > 2000 ? ',\n' : '') + parts.join(',\n'));
    bytes += chunk.length;
    yield chunk;
  }
  yield enc.encode('\n]\n');
}

function watchMemory() {
  const base = process.memoryUsage();
  let peak = 0;
  const sample = () => {
    const m = process.memoryUsage();
    peak = Math.max(peak, (m.heapUsed - base.heapUsed) + (m.arrayBuffers - base.arrayBuffers));
  };
  const timer = setInterval(sample, 20);
  return { sample, stop() { clearInterval(timer); sample(); return peak; } };
}

test('a 300 mb json list and the same list in a zip, in bounded memory', { skip: !on && 'set ATTIC_SCALE=1', timeout: 300000 }, async () => {
  const dir = mkdtempSync(join(process.env.ATTIC_TMP || tmpdir(), 'attic-scale-'));
  try {
    const jsonPath = join(dir, 'Streaming_History_Audio_2019-2026.json');
    const zipPath = join(dir, 'my_spotify_data.zip');
    const jsonOut = createWriteStream(jsonPath);
    const zipOut = createWriteStream(zipPath);
    const zip = new Zip((err, data) => { if (err) throw err; zipOut.write(data); });
    const entry = new ZipDeflate('Spotify Extended Streaming History/Streaming_History_Audio_2019-2026.json', { level: 1 });
    zip.add(entry);
    for (const chunk of jsonChunks()) {
      if (!jsonOut.write(chunk)) await once(jsonOut, 'drain');
      entry.push(chunk);
    }
    entry.push(new Uint8Array(0), true);
    zip.end();
    jsonOut.end();
    zipOut.end();
    await Promise.all([once(jsonOut, 'finish'), once(zipOut, 'finish')]);

    const plain = fromBlob(await openAsBlob(jsonPath), 'Streaming_History_Audio_2019-2026.json');
    assert.ok(plain.size > TARGET);
    global.gc?.();
    let mem = watchMemory();
    let count = 0;
    const t0 = performance.now();
    await readJsonList(plain, () => { count++; if ((count & 0xffff) === 0) mem.sample(); }, { streamAbove: 0 });
    const plainMs = performance.now() - t0;
    const plainPeak = mem.stop();

    global.gc?.();
    mem = watchMemory();
    const { files } = await expandAll([fromBlob(await openAsBlob(zipPath), 'my_spotify_data.zip')]);
    const inZip = files[0];
    let zcount = 0;
    const t1 = performance.now();
    await readJsonList(inZip, () => { zcount++; if ((zcount & 0xffff) === 0) mem.sample(); }, { streamAbove: 0 });
    const zipMs = performance.now() - t1;
    const zipPeak = mem.stop();

    const mb = n => Math.round(n / 1024 / 1024);
    console.log(`scale: ${count} items, ${mb(plain.size)} mb. plain: ${Math.round(plainMs)} ms, peak ${mb(plainPeak)} mb. zip: ${Math.round(zipMs)} ms, peak ${mb(zipPeak)} mb`);
    assert.equal(zcount, count);
    assert.ok(plainPeak < plain.size / 3, `plain peak ${mb(plainPeak)} mb`);
    assert.ok(zipPeak < plain.size / 3, `zip peak ${mb(zipPeak)} mb`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
