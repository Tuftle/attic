import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scene, paintOf } from '../../site/src/render/charts.js';
import { readAll, makeYear } from '../../site/src/core/pipeline.js';
import { spotifyFixture } from '../gen/spotify.js';
import { youtubeFixture } from '../gen/youtube.js';
import { file } from '../gen/zipwriter.js';
import { redact } from '../../site/src/core/redact.js';

const sp = spotifyFixture(), yt = youtubeFixture();
const { results } = await readAll([file('s.zip', sp.zip), file('y.zip', yt.zip)]);
const { cards, final } = makeYear(results, { year: 2025, timeZone: sp.zone, now: sp.now });
const all = [...cards, final];

test('every graphic has a scene and a text equivalent, wide and narrow', () => {
  const types = new Set();
  for (const c of all) {
    if (!c.visual) continue;
    types.add(c.visual.type);
    for (const compact of [false, true]) {
      const sc = scene(c.visual, { compact });
      assert.ok(sc, c.id);
      assert.ok(sc.w > 0 && sc.h > 0, c.id);
      assert.ok(sc.alt.length > 10, `${c.id} has a text equivalent`);
      for (const it of sc.items) assert.ok(Number.isFinite(it.x ?? it.cx ?? it.x1 ?? 0), `${c.id} ${it.t}`);
    }
  }
  assert.deepEqual([...types].sort(), ['bars', 'clock', 'heatmap', 'line', 'stats']);
});

test('the text equivalent of a hidden card hides its names too', () => {
  for (const c of all.filter(x => x.sensitive && x.visual)) {
    const alt = scene(redact(c).visual).alt;
    for (const n of c.names) if (n.length > 3) assert.ok(!alt.includes(n), `${c.id} alt shows ${n}`);
  }
});

test('every class used in a chart has a colour for saved images', () => {
  const p = { ink: '#111', soft: '#222', accent: '#333', line: '#444', card: '#fff' };
  for (const c of all) {
    const sc = scene(c.visual);
    for (const it of sc?.items || []) {
      const paint = paintOf(it.cls, p);
      assert.ok(paint.fill || paint.stroke, `${it.cls} has a colour`);
    }
  }
});
