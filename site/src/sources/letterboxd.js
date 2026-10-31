// letterboxd: diary.csv from the data export, or watched.csv when there is
// no diary. dates only, no times, so the cards are made in utc and say
// nothing about the hour. the column names are from memory.

import { EventStore } from '../core/store.js';
import { card, scope } from '../core/cards.js';
import { name, words, int, count, changeWords } from '../core/templates.js';
import { monthHistogram, weekdayHistogram, peak, share, change, where } from '../core/analysers.js';
import { dayName, WEEKDAYS, MONTHS } from '../core/timezone.js';
import { dateOnly, monthLine, bars, progress, readCsv, headerHas } from './common.js';

const COLUMNS = {
  date: ['Date'], name: ['Name', 'Title'], year: ['Year'], uri: ['Letterboxd URI', 'URI'],
  rating: ['Rating'], rewatch: ['Rewatch'], watched: ['Watched Date', 'WatchedDate'],
};

function match(f) {
  return /^(diary|watched)\.csv$/i.test(f.name) ? 0.5 : 0;
}

function detect(files) {
  const out = [];
  for (const f of files) {
    if (!/\.csv$/i.test(f.name) || !headerHas(f, 'Name', 'Letterboxd URI')) continue;
    if (/^diary/i.test(f.name) || headerHas(f, 'Watched Date')) { f.variant = 'diary'; out.push({ file: f, score: 0.95 }); }
    else if (/^watched/i.test(f.name)) { f.variant = 'watched'; out.push({ file: f, score: 0.9 }); }
  }
  return { files: out };
}

async function parse(files, onProgress) {
  const store = new EventStore(2048);
  const notes = [];
  const tick = progress(onProgress, 500);
  const hasDiary = files.some(f => f.variant === 'diary');
  for (const f of files) {
    if (hasDiary && f.variant !== 'diary') continue;
    try {
      await readCsv(f, COLUMNS, ['name', 'date'], 'letterboxd diary', get => {
        const t = dateOnly(get('watched') || get('date'));
        if (!Number.isFinite(t) || !get('name')) return;
        const rating = Number(get('rating'));
        const year = Number(get('year'));
        store.push({
          t, kind: 'film', title: get('name'), album: get('year') || undefined,
          meta: { rating: rating > 0 ? rating : undefined, rewatch: /^yes$/i.test(get('rewatch')), year: year > 1800 ? year : undefined },
        });
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this letterboxd file could not be read to the end.' });
    }
  }
  if (!hasDiary && store.length) notes.push({ code: 'no-diary', message: 'there was no diary.csv, so films are counted on the day you logged them.' });
  tick.done();
  return { store, notes, count: tick.count };
}

function cards(r, ctxIn) {
  const ctx = { ...ctxIn, timeZone: 'UTC' };
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const films = store.ofKind('film', S.lo, S.hi);
  if (!films.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const base = { source: 'letterboxd' };
  const out = [];
  const months = monthHistogram(t, films, z);
  const prev = S.prev ? store.ofKind('film', S.prev.lo, S.prev.hi).length : null;
  const delta = prev ? change(films.length, prev) : null;
  out.push(card({
    ...base, id: 'letterboxd.films', title: 'your year in film', big: count(films.length, 'film'),
    caption: words('logged {when}.', { when }),
    detail: words('about {n} a week.', { n: (films.length / Math.max(1, (S.y1 - S.y0) / 604800000)).toFixed(1).replace(/\.0$/, '') }),
    visual: monthLine(months, v => int(v)),
    values: { films: films.length, months },
    stat: { label: 'films watched', display: int(films.length), value: films.length, change: delta },
  }));

  const rewatchCol = store.column('rewatch');
  const rewatches = rewatchCol ? where(films, i => rewatchCol[i] === 2).length : 0;
  if (rewatches) {
    out.push(card({
      ...base, id: 'letterboxd.rewatches', title: 'old favourites', big: count(rewatches, 'rewatch', 'rewatches'),
      caption: words('films you went back to {when}, {share} of everything you logged.', { when, share: `${Math.round(share(rewatches, films.length) * 100)}%` }),
      values: { rewatches, films: films.length },
    }));
  }

  const ratingCol = store.column('rating');
  const rated = ratingCol ? where(films, i => !Number.isNaN(ratingCol[i])) : [];
  if (rated.length >= 3) {
    const avg = rated.reduce((s, i) => s + ratingCol[i], 0) / rated.length;
    const spread = [];
    for (let h = 1; h <= 10; h++) spread.push(rated.filter(i => Math.round(ratingCol[i] * 2) === h).length);
    out.push(card({
      ...base, id: 'letterboxd.ratings', title: 'how you rated', big: `${avg.toFixed(1)} stars`,
      caption: words('on average, across {n} {when}.', { n: count(rated.length, 'rated film'), when }),
      visual: bars(spread.map((v, k) => ({ label: `${(k + 1) / 2} stars`, value: v, display: int(v) })).filter(b => b.value).reverse()),
      values: { rated: rated.length, average: avg, spread },
    }));
  }

  const yearCol = store.column('year');
  if (yearCol) {
    const decades = new Map();
    for (const i of films) if (!Number.isNaN(yearCol[i])) { const d = Math.floor(yearCol[i] / 10) * 10; decades.set(d, (decades.get(d) || 0) + 1); }
    if (decades.size) {
      const [dec, n] = [...decades].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      out.push(card({
        ...base, id: 'letterboxd.decade', title: 'your decade', big: `the ${dec}s`,
        caption: words('{n} you watched {when} came out in the {dec}s.', { n: count(n, 'film'), when, dec }),
        visual: bars([...decades].sort((a, b) => b[0] - a[0]).slice(0, 8).map(([d, v]) => ({ label: `${d}s`, value: v, display: int(v) }))),
        values: { decade: dec, films: n },
      }));
    }
  }

  const m = peak(months);
  out.push(card({
    ...base, id: 'letterboxd.month', title: 'your busiest month', big: MONTHS[m],
    caption: words('{n} in one month.', { n: count(months[m], 'film') }),
    values: { month: m, films: months[m] },
  }));

  const wd = weekdayHistogram(t, films, z);
  const w = peak(wd);
  out.push(card({
    ...base, id: 'letterboxd.weekday', title: 'film night', big: WEEKDAYS[w],
    caption: words('is the day you watched the most, with {n}.', { n: count(wd[w], 'film') }),
    visual: bars(wd.map((v, d) => ({ label: WEEKDAYS[d], value: v, display: int(v) }))),
    values: { bins: wd, peak: w },
  }));

  const f = films[0], l = films[films.length - 1];
  out.push(card({
    ...base, id: 'letterboxd.first-last', title: 'first and last', big: name(str(store.title[f])),
    caption: words('the first film you logged {when}, on {day}.', { when, day: dayName(z.dayKey(t[f])) }),
    detail: words(S.unfinished ? 'the latest so far is {film}, on {day}.' : 'the last was {film}, on {day}.', { film: name(str(store.title[l])), day: dayName(z.dayKey(t[l])) }),
    values: { first: str(store.title[f]), last: str(store.title[l]) },
  }));

  if (delta !== null) {
    out.push(card({
      ...base, id: 'letterboxd.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('films than {last}: {now} against {then}.', { last: S.lastYear, now: int(films.length), then: int(prev) }),
      values: { films: films.length, prev, change: delta },
    }));
  }
  return out;
}

export default { id: 'letterboxd', name: 'letterboxd', unit: 'films', guide: 'letterboxd', match, detect, parse, cards };
