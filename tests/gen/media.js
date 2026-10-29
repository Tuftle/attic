// made-up letterboxd and goodreads exports, and the answers the cards must
// give. both have dates without times, so everything here is in utc.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { names, songName, bandName } from './ref.js';

export const MEDIA = { now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;
const iso = t => new Date(t).toISOString().slice(0, 10);
const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = rows => rows.map(r => r.map(q).join(',')).join('\n') + '\n';
const sortByDay = list => list.slice().sort((a, b) => a.t - b.t || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

function yearRange(year, now) {
  const start = Date.UTC(year, 0, 1), full = Date.UTC(year + 1, 0, 1);
  return { start, end: now >= start && now < full ? now : full, unfinished: now >= start && now < full };
}
function prevCount(list, year, now) {
  const r = yearRange(year, now);
  const p0 = Date.UTC(year - 1, 0, 1), p1 = r.unfinished ? p0 + (now - r.start) : r.start;
  if (!(Math.min(...list.map(x => x.t)) <= p0 + 14 * DAY)) return null;
  return list.filter(x => x.t >= p0 && x.t < p1).length || null;
}

// letterboxd

export function makeFilms({ seed = 'letterboxd' } = {}) {
  const r = rng(seed);
  const pool = names(r, 400, songName).map(title => ({ title, year: r.weighted([1950, 1970, 1985, 1995, 2005, 2015, 2022], [1, 2, 3, 4, 4, 5, 6]) + r.int(0, 9) }));
  const seen = [];
  const out = [];
  for (let d = Date.UTC(2024, 0, 5); d <= Date.UTC(2026, 9, 20); d += DAY) {
    const p = new Date(d).getUTCDay() === 5 || new Date(d).getUTCDay() === 6 ? 0.55 : 0.3;
    if (!r.chance(p)) continue;
    const today = new Set();
    for (let k = 0; k < r.weighted([1, 2, 3], [8, 3, 1]); k++) {
      const rewatch = seen.length > 20 && r.chance(0.12);
      const film = rewatch ? r.pick(seen) : pool[r.int(0, pool.length - 1)];
      // a film logged twice on one day is one viewing
      if (today.has(film)) continue;
      today.add(film);
      if (!rewatch) seen.push(film);
      out.push({ t: d + 12 * 3600000, title: film.title, year: Math.min(film.year, 2026), rating: r.chance(0.8) ? r.int(1, 10) / 2 : 0, rewatch, logged: d + r.int(0, 2) * DAY });
    }
  }
  return out;
}

export function letterboxdZip(films) {
  const uri = f => `https://boxd.it/${f.title.length.toString(36)}${f.year}`;
  return writeZip([
    { path: 'diary.csv', data: csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date'], ...films.map(f => [iso(f.logged), f.title, f.year, uri(f), f.rating || '', f.rewatch ? 'Yes' : '', f.rewatch ? 'again, with friends' : '', iso(f.t)])]) },
    { path: 'watched.csv', data: csv([['Date', 'Name', 'Year', 'Letterboxd URI'], ...films.map(f => [iso(f.logged), f.title, f.year, uri(f)])]) },
    { path: 'ratings.csv', data: csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'], ...films.filter(f => f.rating).map(f => [iso(f.logged), f.title, f.year, uri(f), f.rating])]) },
    { path: 'profile.csv', data: 'Date Joined,Username,Given Name\n2020-01-01,not-real,someone\n' },
  ]);
}

export function letterboxdTruth(films, year, now = MEDIA.now) {
  const { start, end } = yearRange(year, now);
  const inYear = sortByDay(films.filter(f => f.t >= start && f.t < end));
  if (!inYear.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const f of inYear) months[new Date(f.t).getUTCMonth()]++;
  out['letterboxd.films'] = { films: inYear.length, months };
  const rw = inYear.filter(f => f.rewatch).length;
  if (rw) out['letterboxd.rewatches'] = { rewatches: rw, films: inYear.length };
  const rated = inYear.filter(f => f.rating);
  if (rated.length >= 3) {
    const spread = new Array(10).fill(0);
    for (const f of rated) spread[Math.round(f.rating * 2) - 1]++;
    out['letterboxd.ratings'] = { rated: rated.length, average: rated.reduce((s, f) => s + f.rating, 0) / rated.length, spread };
  }
  const decades = new Map();
  for (const f of inYear) decades.set(Math.floor(f.year / 10) * 10, (decades.get(Math.floor(f.year / 10) * 10) || 0) + 1);
  const [dec, n] = [...decades].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  out['letterboxd.decade'] = { decade: dec, films: n };
  let m = 0;
  for (let i = 1; i < 12; i++) if (months[i] > months[m]) m = i;
  out['letterboxd.month'] = { month: m, films: months[m] };
  const bins = new Array(7).fill(0);
  for (const f of inYear) bins[(new Date(f.t).getUTCDay() + 6) % 7]++;
  let w = 0;
  for (let i = 1; i < 7; i++) if (bins[i] > bins[w]) w = i;
  out['letterboxd.weekday'] = { bins, peak: w };
  out['letterboxd.first-last'] = { first: inYear[0].title, last: inYear.at(-1).title };
  const prev = prevCount(films, year, now);
  if (prev) out['letterboxd.change'] = { films: inYear.length, prev, change: (inYear.length - prev) / prev };
  return out;
}

export function letterboxdFixture() {
  const films = makeFilms();
  const truth = {};
  for (const y of MEDIA.years) truth[y] = letterboxdTruth(films, y);
  return { items: films, zip: letterboxdZip(films), truth, zone: 'UTC', now: MEDIA.now };
}

// goodreads

export function makeBooks({ seed = 'goodreads' } = {}) {
  const r = rng(seed);
  const authors = names(r, 60, bandName);
  const weights = r.zipf(60, 1.2);
  const out = [];
  let id = 1000;
  for (let d = Date.UTC(2024, 0, 3); d <= Date.UTC(2026, 9, 22); d += DAY) {
    if (!r.chance(0.11)) continue;
    out.push({
      id: String(id++), t: d + 12 * 3600000, title: songName(r) + (r.chance(0.2) ? ': A Novel' : ''), author: r.weighted(authors, weights),
      pages: r.chance(0.9) ? r.int(120, 900) : 0, rating: r.weighted([0, 2, 3, 4, 5], [2, 1, 3, 4, 2]), year: r.chance(0.05) ? r.int(1810, 1920) : r.int(1960, 2025), shelf: 'read',
    });
  }
  out[7].year = -400;
  for (let k = 0; k < 25; k++) out.push({ id: String(id++), t: NaN, title: songName(r), author: r.pick(authors), pages: 300, rating: 0, year: 2020, shelf: k < 6 ? 'read' : r.pick(['to-read', 'currently-reading']) });
  return out;
}

export function goodreadsCsv(books, { bom = false } = {}) {
  const head = ['Book Id', 'Title', 'Author', 'Author l-f', 'Additional Authors', 'ISBN', 'ISBN13', 'My Rating', 'Average Rating', 'Publisher', 'Binding', 'Number of Pages', 'Year Published', 'Original Publication Year', 'Date Read', 'Date Added', 'Bookshelves', 'Bookshelves with positions', 'Exclusive Shelf', 'My Review', 'Spoiler', 'Private Notes', 'Read Count', 'Owned Copies'];
  const day = t => (Number.isFinite(t) ? iso(t).replace(/-/g, '/') : '');
  const rows = books.map(b => [b.id, b.title, b.author, b.author.split(' ').reverse().join(', '), '', '="0123456789"', '="9780123456789"', b.rating, '3.9', 'a publisher', 'Paperback', b.pages || '', b.year > 0 ? b.year + 1 : '', b.year, day(b.t), day(Number.isFinite(b.t) ? b.t - 20 * DAY : Date.UTC(2025, 0, 1)), b.shelf === 'read' ? '' : b.shelf, '', b.shelf, b.rating === 5 ? 'loved it, truly.\nwould read again, "twice"' : '', '', 'a private note, never read', 1, 0]);
  return (bom ? '\u{feff}' : '') + csv([head, ...rows]);
}

export function goodreadsTruth(books, year, now = MEDIA.now) {
  const read = books.filter(b => b.shelf === 'read' && Number.isFinite(b.t));
  const { start, end } = yearRange(year, now);
  const inYear = sortByDay(read.filter(b => b.t >= start && b.t < end));
  if (!inYear.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const b of inYear) months[new Date(b.t).getUTCMonth()]++;
  out['goodreads.books'] = { books: inYear.length, months };
  const paged = inYear.filter(b => b.pages);
  if (paged.length) {
    out['goodreads.pages'] = { pages: paged.reduce((s, b) => s + b.pages, 0), books: paged.length };
    const longest = paged.reduce((a, b) => (b.pages > a.pages ? b : a));
    out['goodreads.longest'] = { title: longest.title, pages: longest.pages };
  }
  const counts = new Map();
  for (const b of inYear) { const e = counts.get(b.author) || { n: 0, first: b.t }; e.n++; counts.set(b.author, e); }
  const top = [...counts].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  if (top[0][1].n >= 2) out['goodreads.authors'] = { top: top.filter(a => a[1].n >= 2).map(([n, e]) => ({ name: n, books: e.n })) };
  const rated = inYear.filter(b => b.rating);
  if (rated.length >= 3) out['goodreads.ratings'] = { rated: rated.length, average: rated.reduce((s, b) => s + b.rating, 0) / rated.length };
  const oldest = inYear.reduce((a, b) => (b.year < a.year ? b : a));
  out['goodreads.oldest'] = { title: oldest.title, year: oldest.year };
  const prev = prevCount(read, year, now);
  if (prev) out['goodreads.change'] = { books: inYear.length, prev, change: (inYear.length - prev) / prev };
  return out;
}

export function goodreadsFixture() {
  const books = makeBooks();
  const truth = {};
  for (const y of MEDIA.years) truth[y] = goodreadsTruth(books, y);
  return { items: books, zip: writeZip([{ path: 'goodreads_library_export.csv', data: goodreadsCsv(books) }]), truth, zone: 'UTC', now: MEDIA.now };
}
