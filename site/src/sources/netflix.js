// netflix: ViewingActivity.csv from the personal information download.
// the column names are from memory, so each has a list of aliases. start
// times are taken to be utc.

import { EventStore } from '../core/store.js';
import { createCsvParser, mapHeader, fold } from '../core/csv.js';
import { textChunks } from '../core/files.js';
import { csvColumnsMessage } from '../core/doctor.js';
import { card, scope } from '../core/cards.js';
import { name, words, pick, hours, hoursValue, percent, int, count, changeWords } from '../core/templates.js';
import { totalsBy, topN, sum, monthHistogram, dayTotals, busiestDay, share, change, where } from '../core/analysers.js';
import { dayName, DAY } from '../core/timezone.js';
import { parseUtc, isoDay, monthLine, heatmap, bars, progress } from './common.js';

const MIN_VIEW = 2 * 60000;
const LEFT_AFTER = 60 * DAY;
const REWATCH_GAP = 30;

export const COLUMNS = {
  profile: ['Profile Name', 'Profile', 'ProfileName'],
  start: ['Start Time', 'StartTime', 'Start'],
  duration: ['Duration', 'Duration Watched'],
  title: ['Title', 'Video Title'],
  supplemental: ['Supplemental Video Type', 'Supplemental Type', 'Supplemental'],
  device: ['Device Type', 'Device'],
};
const NEEDED = ['start', 'duration', 'title'];

const SEASON = /^(season|series|part|volume|vol\.|chapter|book|collection|limited series|miniseries|temporada|staffel|saison|stagione)\b/i;
const EPISODE = /^(episode|chapter|ep\.?|episodio|folge)\s*\d+/i;

/** "Show: Season 2: Episode" into its parts, or a film */
export function splitTitle(title) {
  const parts = String(title).split(': ');
  if (parts.length >= 3 && SEASON.test(parts[1])) return { show: parts[0], season: parts[1], episode: parts.slice(2).join(': '), film: false };
  if (parts.length === 2 && EPISODE.test(parts[1])) return { show: parts[0], season: '', episode: parts[1], film: false };
  return { show: title, season: '', episode: '', film: true };
}

/** "01:02:03" or "02:03" to ms */
export function parseDuration(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

function headerOf(f) {
  const text = (f.headText || '').replace(/^\u{feff}/u, '');
  const line = text.split(/\r?\n/)[0] || '';
  return line.split(/[,;\t]/).map(s => fold(s.replace(/"/g, '')));
}

function match(f) {
  return /^ViewingActivity.*\.csv$/i.test(f.name) ? 0.9 : 0;
}

function detect(files) {
  const out = [];
  const notes = [];
  for (const f of files) {
    if (!/\.csv$/i.test(f.name) && !match(f)) continue;
    const head = headerOf(f);
    const has = key => COLUMNS[key].some(a => head.includes(fold(a)));
    if (NEEDED.every(has)) {
      out.push({ file: f, score: match(f) ? 0.95 : 0.8 });
    } else if (head.length === 2 && head[0] === 'title' && head[1] === 'date') {
      if (!f.archive || /NetflixViewingHistory/i.test(f.name)) {
        notes.push({ path: f.path, code: 'netflix-short', message: 'this is netflix\'s short viewing history. it has titles and dates, but no times or lengths, so attic cannot use it. ask netflix for your personal information instead, as the guide shows.' });
      }
    } else if (match(f)) {
      const raw = ((f.headText || '').replace(/^\u{feff}/u, '').split(/\r?\n/)[0] || '').split(/[,;\t]/).map(s => s.replace(/"/g, '').trim()).filter(Boolean);
      notes.push({ path: f.path, code: 'columns', message: csvColumnsMessage(raw, ['start time', 'duration', 'title'], 'netflix viewing') });
    }
  }
  return { files: out, notes };
}

async function parse(files, onProgress) {
  const store = new EventStore(8192);
  const notes = [];
  const tick = progress(onProgress, 2000);
  let extras = 0, short = 0, bad = 0;
  for (const f of files) {
    let index = null;
    const parser = createCsvParser({
      onRow(row) {
        if (!index) {
          const h = mapHeader(row, COLUMNS);
          if (NEEDED.some(k => h.index[k] === -1)) throw Object.assign(new Error(csvColumnsMessage(row, ['start time', 'duration', 'title'], 'netflix viewing')), { code: 'columns' });
          index = h.index;
          return;
        }
        const get = k => (index[k] >= 0 ? (row[index[k]] || '').trim() : '');
        if (get('supplemental')) { extras++; return; }
        const t = parseUtc(get('start'));
        const dur = parseDuration(get('duration'));
        const title = get('title');
        if (!Number.isFinite(t) || !Number.isFinite(dur) || !title) { bad++; return; }
        if (dur < MIN_VIEW) { short++; return; }
        const s = splitTitle(title);
        store.push({
          t, dur, kind: 'watch', title, creator: get('profile') || undefined, album: s.show,
          meta: { film: s.film, device: get('device') || undefined },
        });
        tick.tick();
      },
    });
    try {
      for await (const chunk of textChunks(f)) parser.push(chunk);
      parser.end();
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this netflix file could not be read to the end. it may be damaged.' });
    }
  }
  tick.done();
  if (extras) notes.push({ code: 'trailers', message: `${int(extras)} trailers and previews were left out.` });
  if (short) notes.push({ code: 'short', message: `${int(short)} views under 2 minutes were left out.` });
  if (bad) notes.push({ code: 'rows', message: `${int(bad)} rows had no usable time, length or title.` });
  return { store, notes, count: tick.count };
}

// the cards

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const all = store.ofKind('watch', S.lo, S.hi);
  if (!all.length) return [];
  const profiles = topN(totalsBy(store.creator, all, store.dur, store.t), 50, id => store.strings.str(id));
  const out = [];
  if (profiles.length <= 1) {
    out.push(...deck(store, S, ctx, all, null, ''));
  } else {
    profiles.forEach((p, n) => {
      const idx = where(all, i => store.creator[i] === p.key);
      out.push(...deck(store, S, ctx, idx, store.strings.str(p.key), `@${n + 1}`));
    });
  }
  return out;
}

function deck(store, S, ctx, idx, profile, suffix) {
  const { z, when } = S;
  const t = store.t, dur = store.dur, str = id => store.strings.str(id) || '';
  const filmCol = store.column('film');
  const isFilm = i => filmCol && filmCol[i] === 2;
  const mine = profile === null ? () => true : i => str(store.creator[i]) === profile;
  const out = [];
  const titled = text => (profile === null ? text : words(`${text}, for {profile}`, { profile: name(profile) }));
  const make = spec => out.push(card({ source: 'netflix', ...spec, id: spec.id + suffix, title: titled(spec.title) }));
  const seed = id => `${id}${suffix}:${ctx.year}:${idx.length}`;

  // hours
  const ms = sum(dur, idx);
  let prevMs = null;
  if (S.prev) prevMs = sum(dur, where(store.ofKind('watch', S.prev.lo, S.prev.hi), mine));
  const delta = prevMs ? change(ms, prevMs) : null;
  make({
    id: 'netflix.hours', title: 'hours watched', big: hours(ms),
    caption: words(pick(['on netflix {when}, leaving out trailers and anything under 2 minutes.', 'of netflix {when}. trailers and views under 2 minutes are left out.'], seed('h')), { when }),
    detail: words('{n} in all.', { n: count(idx.length, 'view') }),
    visual: monthLine(monthHistogram(t, idx, z, dur).map(hoursValue), v => `${v} h`),
    values: { ms, views: idx.length, months: monthHistogram(t, idx, z, dur) },
    stat: { label: 'of netflix', display: hours(ms), value: hoursValue(ms), change: delta },
  });

  // top shows
  const episodes = where(idx, i => !isFilm(i));
  const shows = topN(totalsBy(store.album, episodes, dur, t), 5, str);
  if (shows.length) {
    make({
      id: 'netflix.top-shows', title: 'top shows', big: name(str(shows[0].key)),
      caption: words('your most watched show {when}, with {hours}.', { when, hours: hours(shows[0].w) }),
      detail: 'ranked by time watched.',
      visual: bars(shows.map(e => ({ label: name(str(e.key)), value: e.w, display: hours(e.w) }))),
      values: { top: shows.map(e => ({ name: str(e.key), ms: e.w })) },
    });
  }

  // the biggest binge
  const perDay = dayTotals(t, episodes, z);
  const binge = busiestDay(perDay);
  if (binge && binge.w >= 3) {
    const that = where(episodes, i => z.dayKey(t[i]) === binge.day);
    const [show] = topN(totalsBy(store.album, that, null, t), 1, str);
    make({
      id: 'netflix.binge', title: 'the big binge', big: count(binge.w, 'episode'),
      caption: words('in one day, on {day}, mostly {show}.', { day: dayName(binge.day), show: name(str(show.key)) }),
      visual: heatmap(z, S.y0, S.y1, perDay, binge.day),
      detail: 'each square is a day. the darker it is, the more episodes.',
      values: { day: isoDay(binge.day), episodes: binge.w, show: str(show.key) },
      stat: { label: 'episodes in one day', display: int(binge.w), value: binge.w, change: null },
    });
  }

  // tried and kept: shows first started this year
  const everIdx = where(store.ofKind('watch'), mine);
  const dataEnd = everIdx.length ? t[everIdx[everIdx.length - 1]] : S.y1;
  const showInfo = new Map();
  for (const i of everIdx) {
    if (isFilm(i)) continue;
    const k = store.album[i];
    let s = showInfo.get(k);
    if (!s) showInfo.set(k, (s = { first: t[i], last: t[i], eps: new Set() }));
    s.last = t[i];
    s.eps.add(store.title[i]);
  }
  const started = [...showInfo.entries()].filter(([, s]) => s.first >= S.y0 && s.first < S.y1);
  if (started.length >= 3) {
    const tried = started.filter(([, s]) => s.eps.size <= 2 && dataEnd - s.last >= LEFT_AFTER).sort((a, b) => a[1].first - b[1].first);
    const kept = started.filter(([, s]) => s.eps.size >= 3).length;
    make({
      id: 'netflix.tried', title: 'tried and kept',
      big: tried.length ? count(tried.length, 'show') : count(kept, 'show'),
      caption: tried.length
        ? words('you tried for an episode or two and then left, and {kept} you kept watching.', { kept: int(kept) })
        : 'you kept watching. none were left after an episode or two.',
      detail: words('out of {n} you started {when}.', { n: count(started.length, 'new show'), when }),
      visual: tried.length ? bars(tried.slice(0, 5).map(([k, s]) => ({ label: name(str(k)), value: s.eps.size, display: count(s.eps.size, 'episode') }))) : null,
      values: { started: started.length, tried: tried.length, kept, triedNames: tried.slice(0, 5).map(([k]) => str(k)) },
    });
  }

  // first and last
  const f = idx[0], l = idx[idx.length - 1];
  make({
    id: 'netflix.first-last', title: 'first and last', big: name(str(store.title[f])),
    caption: words('the first thing you watched {when}, on {day}.', { when, day: dayName(z.dayKey(t[f])) }),
    detail: words(S.unfinished ? 'the latest so far is {title}, on {day}.' : 'the last was {title}, on {day}.', { title: name(str(store.title[l])), day: dayName(z.dayKey(t[l])) }),
    values: { first: { title: str(store.title[f]), t: t[f] }, last: { title: str(store.title[l]), t: t[l] } },
  });

  // late nights
  const night = where(idx, i => z.hour(t[i]) < 5).length;
  make({
    id: 'netflix.night', title: 'late nights', big: percent(share(night, idx.length)),
    caption: night ? 'of what you watched started between midnight and 5 am.' : 'of what you watched started between midnight and 5 am. early nights all round.',
    detail: night ? words('{n} after midnight.', { n: count(night, 'view') }) : '',
    values: { night, views: idx.length, share: share(night, idx.length) },
  });

  // devices
  const devCol = store.column('device');
  const devices = devCol ? topN(totalsBy(devCol, idx, dur, t), 4, str) : [];
  if (devices.length) {
    make({
      id: 'netflix.devices', title: 'where you watched', big: str(devices[0].key).toLowerCase(),
      caption: words('took {share} of your viewing time.', { share: percent(share(devices[0].w, ms)) }),
      visual: bars(devices.map(e => ({ label: str(e.key).toLowerCase(), value: e.w, display: hours(e.w) }))),
      values: { top: devices.map(e => ({ name: str(e.key), ms: e.w })) },
    });
  }

  // rewatches: the same title on days a month or more apart
  const upTo = where(everIdx, i => t[i] < S.y1);
  const daysOf = new Map();
  for (const i of upTo) {
    const k = store.title[i];
    let d = daysOf.get(k);
    if (!d) daysOf.set(k, (d = { days: [], first: t[i] }));
    const day = z.dayKey(t[i]);
    if (d.days[d.days.length - 1] !== day) d.days.push(day);
  }
  const y0day = z.dayKey(S.y0);
  const rewatched = [];
  for (const [k, d] of daysOf) {
    const inYear = d.days.filter(x => x >= y0day);
    if (!inYear.length) continue;
    if (inYear[inYear.length - 1] - d.days[0] >= REWATCH_GAP) rewatched.push({ key: k, w: d.days.length, first: d.first });
  }
  if (rewatched.length) {
    const [topOne] = topN(new Map(rewatched.map(x => [x.key, { ...x, n: x.w }])), 1, str);
    make({
      id: 'netflix.rewatch', title: 'came back to it', big: int(rewatched.length),
      caption: words('{things} you watched again {when}, a month or more after the first time.', { things: rewatched.length === 1 ? 'episode or film' : 'episodes and films', when }),
      detail: words('most of all {title}, on {n}.', { title: name(str(topOne.key)), n: count(topOne.w, 'different day') }),
      values: { titles: rewatched.length, top: { title: str(topOne.key), days: topOne.w } },
    });
  }

  if (delta !== null) {
    make({
      id: 'netflix.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('netflix than {last}: {now} against {then}.', { last: S.lastYear, now: hours(ms), then: hours(prevMs) }),
      values: { ms, prevMs, change: delta },
    });
  }
  return out;
}

export default {
  id: 'netflix',
  name: 'netflix',
  unit: 'views',
  guide: 'netflix',
  match,
  detect,
  parse,
  cards,
};
