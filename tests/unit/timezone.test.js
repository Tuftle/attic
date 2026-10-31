import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zone, isValidZone, weekdayOfDay, dayName, hourName, DAY } from '../../site/src/core/timezone.js';
import { rng } from '../gen/rng.js';

const ZONES = ['UTC', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'America/Sao_Paulo', 'Pacific/Chatham', 'Asia/Tokyo'];

// the slow, plain way: ask Intl for every single time
function reference(t, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { year: +p.year, month: +p.month - 1, day: +p.day, hour: +p.hour % 24, weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}

test('local parts agree with Intl at thousands of random times', () => {
  const r = rng('tz');
  const from = Date.UTC(2018, 0, 1), to = Date.UTC(2028, 0, 1);
  for (const tz of ZONES) {
    const z = zone(tz);
    for (let i = 0; i < 1500; i++) {
      const t = from + Math.floor(r.float() * (to - from));
      const want = reference(t, tz);
      const got = z.parts(t);
      assert.deepEqual({ year: got.year, month: got.month, day: got.day, hour: got.hour, weekday: got.weekday }, want, `${tz} ${new Date(t).toISOString()}`);
      assert.equal(z.hour(t), want.hour);
      assert.equal(z.weekday(t), want.weekday);
    }
  }
});

test('the minutes around every daylight saving change are right', () => {
  for (const tz of ZONES) {
    const z = zone(tz);
    let prev = z.offset(Date.UTC(2026, 0, 1));
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 15 * 60000) {
      const o = z.offset(t);
      if (o !== prev) {
        for (const dt of [-60000, 0, 60000, 14 * 60000]) {
          const want = reference(t + dt, tz);
          assert.equal(z.hour(t + dt), want.hour, `${tz} ${new Date(t + dt).toISOString()}`);
        }
        prev = o;
      }
    }
  }
});

test('new york in 2026: clocks go forward on march 8 and back on november 1', () => {
  const z = zone('America/New_York');
  assert.equal(z.hour(Date.UTC(2026, 2, 8, 6, 59)), 1);
  assert.equal(z.hour(Date.UTC(2026, 2, 8, 7, 0)), 3);
  assert.equal(z.hour(Date.UTC(2026, 10, 1, 5, 30)), 1);
  assert.equal(z.hour(Date.UTC(2026, 10, 1, 6, 30)), 1);
  const [a, b] = z.yearBounds(2026);
  assert.equal(a, Date.UTC(2026, 0, 1, 5));
  assert.equal(b, Date.UTC(2027, 0, 1, 5));
});

test('a play just before midnight utc is late evening in new york and next morning in tokyo', () => {
  const t = Date.UTC(2026, 5, 30, 23, 30);
  assert.equal(zone('America/New_York').hour(t), 19);
  assert.equal(zone('Asia/Tokyo').hour(t), 8);
  assert.equal(zone('Asia/Tokyo').dayKey(t) - zone('America/New_York').dayKey(t), 1);
});

test('year bounds hold every local day of the year', () => {
  for (const tz of ZONES) {
    const z = zone(tz);
    const [a, b] = z.yearBounds(2025);
    assert.equal(z.year(a), 2025, tz);
    assert.equal(z.year(a - 1), 2024, tz);
    assert.equal(z.year(b - 1), 2025, tz);
    assert.equal(z.year(b), 2026, tz);
    assert.equal(z.dayKey(b) - z.dayKey(a), 365, tz);
    assert.equal(z.dayStart(z.dayKey(a)), a, tz);
  }
});

test('names and helpers', () => {
  assert.ok(isValidZone('Europe/Amsterdam'));
  assert.ok(!isValidZone('Mars/Olympus'));
  assert.throws(() => zone('Mars/Olympus'));
  assert.equal(weekdayOfDay(0), 3); // 1970-01-01, a thursday
  assert.equal(weekdayOfDay(-1), 2);
  assert.equal(dayName(Math.floor(Date.UTC(2026, 2, 3) / DAY)), 'march 3');
  assert.equal(hourName(0), 'midnight');
  assert.equal(hourName(13), '1 pm');
});
