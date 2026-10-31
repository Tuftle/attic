import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStore, Interner } from '../../site/src/core/store.js';

test('interner gives one id per string', () => {
  const s = new Interner();
  assert.equal(s.id('a'), 0);
  assert.equal(s.id('b'), 1);
  assert.equal(s.id('a'), 0);
  assert.equal(s.id(''), -1);
  assert.equal(s.id(null), -1);
  assert.equal(s.str(1), 'b');
});

test('events go in and come out the same, across growth', () => {
  const st = new EventStore(16);
  const evs = [];
  for (let i = 0; i < 1000; i++) {
    const ev = { t: 1e12 + i * 1000, kind: i % 3 ? 'listen' : 'podcast', title: 't' + (i % 7), creator: 'c' + (i % 5), dur: i, meta: { skipped: i % 2 === 0, platform: i % 4 ? 'ios' : undefined, n: i } };
    evs.push(ev);
    st.push(ev);
  }
  assert.equal(st.length, 1000);
  const back = st.get(9);
  assert.equal(back.t, evs[9].t);
  assert.equal(back.dur, 9);
  assert.equal(back.title, 't2');
  assert.equal(back.meta.skipped, false);
  assert.equal(back.meta.platform, 'ios');
  assert.equal(back.meta.n, 9);
  assert.equal(st.get(8).meta.platform, undefined);
  assert.equal(st.metaValue('missing', 3), undefined);
});

test('events with no usable time are dropped', () => {
  const st = new EventStore();
  assert.equal(st.push({ t: NaN, kind: 'x' }), false);
  assert.equal(st.length, 0);
});

test('sort and dedupe keeps one of each exact repeat', () => {
  const st = new EventStore();
  const a = { t: 3, kind: 'listen', title: 'x', creator: 'y' };
  st.push(a); st.push({ t: 1, kind: 'listen', title: 'x', creator: 'y' }); st.push(a); st.push({ ...a, title: 'z' });
  st.push({ ...a, id: 'm1' }); st.push({ ...a, id: 'm2' });
  const removed = st.sortAndDedupe();
  assert.equal(removed, 1);
  assert.deepEqual(st.toEvents().map(e => [e.t, e.title, e.id]), [[1, 'x', undefined], [3, 'x', undefined], [3, 'x', 'm1'], [3, 'x', 'm2'], [3, 'z', undefined]]);
});

test('ties sort by content, not by reading order', () => {
  const make = order => {
    const st = new EventStore();
    for (const title of order) st.push({ t: 5, kind: 'listen', title });
    st.sortAndDedupe();
    return st.toEvents().map(e => e.title);
  };
  assert.deepEqual(make(['b', 'a', 'c']), make(['c', 'b', 'a']));
});

test('range finds events by time', () => {
  const st = new EventStore();
  for (const t of [5, 1, 3, 9, 7]) st.push({ t, kind: 'k' });
  st.sortAndDedupe();
  assert.deepEqual(st.range(3, 8), [1, 4]);
  assert.deepEqual(st.range(100, 200), [5, 5]);
  assert.deepEqual([...st.ofKind('k', 1, 3)], [1, 2]);
});
