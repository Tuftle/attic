// strava: activities.csv from the bulk export. the file repeats some
// column names (distance in km first, then in metres), so columns are found
// by hand. activity names, notes, gpx and fit files and photos are never
// read. the column names and date format are from memory.

import { EventStore } from '../core/store.js';
import { createCsvParser, fold } from '../core/csv.js';
import { textChunks } from '../core/files.js';
import { csvColumnsMessage } from '../core/doctor.js';
import { card, scope } from '../core/cards.js';
import { words, hours, int, count, changeWords, hoursValue } from '../core/templates.js';
import { totalsBy, topN, sum, hourHistogram, monthHistogram, peak, change, where } from '../core/analysers.js';
import { dayName, hourName, MONTHS, weekdayOfDay } from '../core/timezone.js';
import { monthLine, clock, bars, progress, parseUtc, headerHas } from './common.js';
import { parseTakeoutDate } from './youtube.js';

const match = f => (/^activities\.csv$/i.test(f.name) ? 0.8 : 0);
const detect = files => ({ files: files.filter(f => /\.csv$/i.test(f.name) && headerHas(f, 'Activity Date', 'Activity Type')).map(f => ({ file: f, score: 0.95 })) });

export function stravaDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d\d-\d\d/.test(s)) return parseUtc(s);
  return parseTakeoutDate(s);
}

async function parse(files, onProgress) {
  const store = new EventStore(2048);
  const notes = [];
  const tick = progress(onProgress, 200);
  let assumedKm = false;
  for (const f of files) {
    let col = null;
    const parser = createCsvParser({
      onRow(row) {
        if (!col) {
          const h = row.map(fold);
          const all = name => h.map((x, i) => (x === name ? i : -1)).filter(i => i >= 0);
          const dist = all('distance');
          col = {
            date: h.indexOf('activitydate'), type: h.indexOf('activitytype'), id: h.indexOf('activityid'),
            elapsed: all('elapsedtime')[0] ?? -1, moving: h.indexOf('movingtime'), elevation: h.indexOf('elevationgain'),
            // two distance columns: the second is in metres. one: km, most likely
            distance: dist.length ? dist[dist.length - 1] : -1, metres: dist.length > 1,
          };
          if (col.date < 0 || col.type < 0) throw Object.assign(new Error(csvColumnsMessage(row.filter(Boolean), ['activity date', 'activity type'], 'strava activities')), { code: 'columns' });
          if (!col.metres && col.distance >= 0) assumedKm = true;
          return;
        }
        const get = i => (i >= 0 ? (row[i] || '').trim() : '');
        const t = stravaDate(get(col.date));
        if (!Number.isFinite(t)) return;
        const raw = Number(get(col.distance));
        const metres = Number.isFinite(raw) ? (col.metres ? raw : raw * 1000) : undefined;
        const elapsed = Number(get(col.elapsed)) * 1000;
        const moving = Number(get(col.moving)) * 1000;
        store.push({
          t, dur: Number.isFinite(moving) && moving > 0 ? moving : elapsed, kind: 'activity', creator: get(col.type) || 'activity', id: get(col.id) || undefined,
          meta: { metres, elevation: Number(get(col.elevation)) || undefined },
        });
        tick.tick();
      },
    });
    try {
      for await (const chunk of textChunks(f)) parser.push(chunk);
      parser.end();
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this strava file could not be read to the end.' });
    }
  }
  tick.done();
  if (assumedKm) notes.push({ code: 'units', message: 'distances were read as kilometres. if your account uses miles, they will look too short.' });
  return { store, notes, count: tick.count };
}

const km = m => `${int(m / 1000)} km`;

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const acts = store.ofKind('activity', S.lo, S.hi);
  if (!acts.length) return [];
  const t = store.t, dur = store.dur, str = id => store.strings.str(id) || '';
  const base = { source: 'strava' };
  const out = [];
  const months = monthHistogram(t, acts, z);
  const prev = S.prev ? store.ofKind('activity', S.prev.lo, S.prev.hi).length : null;
  const delta = prev ? change(acts.length, prev) : null;
  out.push(card({
    ...base, id: 'strava.activities', title: 'your year moving', big: count(acts.length, 'activity', 'activities'),
    caption: words('recorded {when}.', { when }),
    visual: monthLine(months, v => int(v)),
    values: { activities: acts.length, months },
    stat: { label: 'activities on strava', display: int(acts.length), value: acts.length, change: delta },
  }));

  const mCol = store.column('metres');
  if (mCol) {
    const withDist = where(acts, i => !Number.isNaN(mCol[i]) && mCol[i] > 0);
    if (withDist.length) {
      const metres = sum(mCol, withDist);
      const byType = topN(totalsBy(store.creator, withDist, mCol, t), 5, str);
      out.push(card({
        ...base, id: 'strava.distance', title: 'distance', big: km(metres),
        caption: words('covered {when}, {most} of it by {type}.', { when, most: `${Math.round((byType[0].w / metres) * 100)}%`, type: str(byType[0].key).toLowerCase() }),
        visual: bars(byType.map(e => ({ label: str(e.key).toLowerCase(), value: e.w, display: km(e.w) }))),
        values: { metres, byType: byType.map(e => ({ type: str(e.key), metres: e.w })) },
      }));
      const longest = withDist.reduce((a, i) => (mCol[i] > mCol[a] ? i : a), withDist[0]);
      out.push(card({
        ...base, id: 'strava.longest', title: 'the longest one', big: km(mCol[longest]),
        caption: words('a {type} on {day}.', { type: str(store.creator[longest]).toLowerCase(), day: dayName(z.dayKey(t[longest])) }),
        values: { type: str(store.creator[longest]), metres: mCol[longest] },
      }));
    }
  }

  const moving = sum(dur, acts);
  if (moving > 0) {
    out.push(card({
      ...base, id: 'strava.time', title: 'time moving', big: hours(moving),
      caption: words('of moving time {when}.', { when }),
      values: { ms: moving },
      stat: { label: 'moving, on strava', display: hours(moving), value: hoursValue(moving), change: null },
    }));
  }

  const m = peak(months);
  out.push(card({
    ...base, id: 'strava.month', title: 'your busiest month', big: MONTHS[m],
    caption: words('{n} in one month.', { n: count(months[m], 'activity', 'activities') }),
    values: { month: m, activities: months[m] },
  }));

  // weeks in a row, monday to sunday
  const weeks = [...new Set([...acts].map(i => { const d = z.dayKey(t[i]); return d - weekdayOfDay(d); }))].sort((a, b) => a - b);
  let best = 1, run = 1;
  for (let k = 1; k < weeks.length; k++) { run = weeks[k] - weeks[k - 1] === 7 ? run + 1 : 1; if (run > best) best = run; }
  out.push(card({
    ...base, id: 'strava.weeks', title: 'weeks in a row', big: count(best, 'week'),
    caption: 'in a row with at least one activity.',
    values: { weeks: best },
  }));

  const bins = hourHistogram(t, acts, z);
  const h = peak(bins);
  out.push(card({
    ...base, id: 'strava.hour', title: 'your hour', big: hourName(h),
    caption: words('is when you started the most activities {when}.', { when }),
    visual: clock(bins, h),
    values: { bins, peak: h },
  }));

  const eCol = store.column('elevation');
  const climbed = eCol ? sum(eCol, acts) : 0;
  if (climbed > 0) {
    out.push(card({
      ...base, id: 'strava.elevation', title: 'climbing', big: `${int(climbed)} m`,
      caption: words('of elevation gained {when}.', { when }),
      detail: climbed >= 8849 ? words('that is {n} times the height of everest.', { n: (climbed / 8849).toFixed(1).replace(/\.0$/, '') }) : '',
      values: { metres: climbed },
    }));
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: 'strava.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('activities than {last}: {now} against {then}.', { last: S.lastYear, now: int(acts.length), then: int(prev) }),
      values: { activities: acts.length, prev, change: delta },
    }));
  }
  return out;
}

export default { id: 'strava', name: 'strava', unit: 'activities', guide: 'strava', match, detect, parse, cards };
