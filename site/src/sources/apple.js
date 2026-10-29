// apple music: "Apple Music Play Activity.csv" from apple's data and
// privacy download. it has a start time and the time played for every
// play; artists are often missing. without it, the daily tracks file
// gives plays per day only. columns are from memory. ip addresses and
// device ids in the file are never read.

import { EventStore } from '../core/store.js';
import { progress, readCsv, headerHas, parseUtc, dateOnly } from './common.js';
import { musicCards } from './music.js';

const ACTIVITY = {
  song: ['Song Name', 'Content Name', 'Title'], artist: ['Artist Name', 'Container Artist Name'], album: ['Album Name', 'Container Album Name'],
  start: ['Event Start Timestamp', 'Event Timestamp', 'Play Date Utc'], ms: ['Play Duration Milliseconds', 'Play Duration'],
  reason: ['End Reason Type'], media: ['Media Type'], event: ['Event Type'],
};
const DAILY = { date: ['Date Played'], ms: ['Play Duration Milliseconds'], plays: ['Play Count'], skips: ['Skip Count'], track: ['Track Description'] };

const match = f => (/^Apple Music (- )?Play (Activity|History Daily Tracks)\.csv$/i.test(f.name) ? 0.9 : 0);

function detect(files) {
  const out = [];
  for (const f of files) {
    if (!/\.csv$/i.test(f.name)) continue;
    if (headerHas(f, 'Play Duration Milliseconds') && (headerHas(f, 'Song Name') || headerHas(f, 'Content Name'))) { f.variant = 'activity'; out.push({ file: f, score: 0.95 }); }
    else if (headerHas(f, 'Date Played', 'Track Description')) { f.variant = 'daily'; out.push({ file: f, score: 0.9 }); }
  }
  return { files: out };
}

async function parse(files, onProgress) {
  const store = new EventStore(32768);
  const notes = [];
  const tick = progress(onProgress, 5000);
  const activity = files.filter(f => f.variant === 'activity');
  const use = activity.length ? activity : files.filter(f => f.variant === 'daily');
  for (const f of use) {
    try {
      if (f.variant === 'activity') {
        await readCsv(f, ACTIVITY, ['song', 'start', 'ms'], 'apple music play activity', get => {
          const ms = Number(get('ms'));
          if (!(ms > 0) || /video/i.test(get('media'))) return;
          const t = parseUtc(get('start'));
          if (!Number.isFinite(t) || !get('song')) return;
          const reason = get('reason');
          store.push({ t, dur: ms, kind: 'listen', title: get('song'), creator: get('artist') || undefined, album: get('album') || undefined, meta: { skipped: reason ? /skip/i.test(reason) : undefined } });
          tick.tick();
        });
      } else {
        await readCsv(f, DAILY, ['date', 'track'], 'apple music daily tracks', get => {
          const d = get('date').replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3');
          const t = dateOnly(d);
          const plays = Math.max(1, Number(get('plays')) || 1);
          const ms = Number(get('ms')) || 0;
          const [artist, ...song] = get('track').split(' - ');
          if (!Number.isFinite(t)) return;
          for (let k = 0; k < plays; k++) {
            store.push({ t: t + k, dur: ms / plays, kind: 'listen', title: song.length ? song.join(' - ') : artist, creator: song.length ? artist : undefined });
            tick.tick();
          }
        });
      }
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this apple music file could not be read to the end.' });
    }
  }
  if (!activity.length && store.length) notes.push({ code: 'daily', message: 'only the daily tracks file was there, so there are no hours of the day in this deck.' });
  tick.done();
  return { store, notes, count: tick.count, extras: { dateOnly: !activity.length } };
}

export default {
  id: 'apple', name: 'apple music', unit: 'plays', guide: 'apple', match, detect, parse,
  cards: (r, ctx) => musicCards(r, ctx, { id: 'apple', name: 'apple music' }),
};
