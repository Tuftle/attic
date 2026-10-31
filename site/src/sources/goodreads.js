// goodreads: goodreads_library_export.csv. books on the read shelf with a
// date read. reviews and private notes are never read. dates only, so the
// cards are made in utc.

import { EventStore } from '../core/store.js';
import { card, scope } from '../core/cards.js';
import { name, words, int, count, changeWords } from '../core/templates.js';
import { totalsBy, topN, sum, monthHistogram, change, where } from '../core/analysers.js';
import { dayName } from '../core/timezone.js';
import { dateOnly, monthLine, bars, progress, readCsv, headerHas } from './common.js';

const COLUMNS = {
  title: ['Title'], author: ['Author'], rating: ['My Rating'], pages: ['Number of Pages', 'Pages'],
  original: ['Original Publication Year'], published: ['Year Published'], read: ['Date Read'],
  shelf: ['Exclusive Shelf'], id: ['Book Id', 'BookId'],
};

function match(f) {
  return /^goodreads_library_export.*\.csv$/i.test(f.name) ? 0.9 : 0;
}

function detect(files) {
  return { files: files.filter(f => /\.csv$/i.test(f.name) && headerHas(f, 'Title', 'Author', 'Date Read', 'Exclusive Shelf')).map(f => ({ file: f, score: 0.95 })) };
}

async function parse(files, onProgress) {
  const store = new EventStore(1024);
  const notes = [];
  const tick = progress(onProgress, 200);
  let undated = 0;
  for (const f of files) {
    try {
      await readCsv(f, COLUMNS, ['title', 'read'], 'goodreads library', get => {
        if (get('shelf') && get('shelf') !== 'read') return;
        const t = dateOnly(get('read'));
        if (!Number.isFinite(t)) { if (get('shelf') === 'read') undated++; return; }
        const pages = Number(get('pages')), rating = Number(get('rating'));
        const year = Number(get('original')) || Number(get('published'));
        store.push({
          t, kind: 'book', title: get('title'), creator: get('author') || undefined, id: get('id') || undefined,
          meta: { pages: pages > 0 ? pages : undefined, rating: rating > 0 ? rating : undefined, year: year ? year : undefined },
        });
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this goodreads file could not be read to the end.' });
    }
  }
  tick.done();
  if (undated) notes.push({ code: 'undated', message: `${count(undated, 'book')} on your read shelf had no date read, so they were left out.` });
  return { store, notes, count: tick.count };
}

function cards(r, ctxIn) {
  const ctx = { ...ctxIn, timeZone: 'UTC' };
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const books = store.ofKind('book', S.lo, S.hi);
  if (!books.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const base = { source: 'goodreads' };
  const out = [];
  const pagesCol = store.column('pages');
  const prev = S.prev ? store.ofKind('book', S.prev.lo, S.prev.hi).length : null;
  const delta = prev ? change(books.length, prev) : null;
  const months = monthHistogram(t, books, z);
  out.push(card({
    ...base, id: 'goodreads.books', title: 'your year in books', big: count(books.length, 'book'),
    caption: words('finished {when}.', { when }),
    visual: monthLine(months, v => int(v)),
    values: { books: books.length, months },
    stat: { label: 'books read', display: int(books.length), value: books.length, change: delta },
  }));

  if (pagesCol) {
    const paged = where(books, i => !Number.isNaN(pagesCol[i]));
    if (paged.length) {
      const pages = sum(pagesCol, paged);
      out.push(card({
        ...base, id: 'goodreads.pages', title: 'pages', big: count(pages, 'page'),
        caption: words('read {when}, about {n} a day.', { when, n: int(pages / Math.max(1, (S.y1 - S.y0) / 86400000)) }),
        detail: paged.length < books.length ? words('{n} had no page count.', { n: count(books.length - paged.length, 'book') }) : '',
        values: { pages, books: paged.length },
      }));
      const longest = paged.reduce((a, i) => (pagesCol[i] > pagesCol[a] ? i : a), paged[0]);
      out.push(card({
        ...base, id: 'goodreads.longest', title: 'the longest one', big: name(str(store.title[longest])),
        caption: words('{n}, finished on {day}.', { n: count(pagesCol[longest], 'page'), day: dayName(z.dayKey(t[longest])) }),
        values: { title: str(store.title[longest]), pages: pagesCol[longest] },
      }));
    }
  }

  const authors = topN(totalsBy(store.creator, books, null, t), 5, str);
  if (authors.length && authors[0].w >= 2) {
    out.push(card({
      ...base, id: 'goodreads.authors', title: 'your author', big: name(str(authors[0].key)),
      caption: words('{n} by one author {when}.', { n: count(authors[0].w, 'book'), when }),
      visual: bars(authors.filter(a => a.w >= 2).map(a => ({ label: name(str(a.key)), value: a.w, display: count(a.w, 'book') }))),
      values: { top: authors.filter(a => a.w >= 2).map(a => ({ name: str(a.key), books: a.w })) },
    }));
  }

  const ratingCol = store.column('rating');
  const rated = ratingCol ? where(books, i => !Number.isNaN(ratingCol[i])) : [];
  if (rated.length >= 3) {
    const avg = rated.reduce((s, i) => s + ratingCol[i], 0) / rated.length;
    out.push(card({
      ...base, id: 'goodreads.ratings', title: 'how you rated', big: `${avg.toFixed(1)} stars`,
      caption: words('on average, across {n}.', { n: count(rated.length, 'rated book') }),
      values: { rated: rated.length, average: avg },
    }));
  }

  const yearCol = store.column('year');
  const dated = yearCol ? where(books, i => !Number.isNaN(yearCol[i])) : [];
  if (dated.length) {
    const oldest = dated.reduce((a, i) => (yearCol[i] < yearCol[a] ? i : a), dated[0]);
    const y = yearCol[oldest];
    out.push(card({
      ...base, id: 'goodreads.oldest', title: 'the oldest one', big: name(str(store.title[oldest])),
      caption: words(y < 0 ? 'first written around {y} bc.' : 'first published in {y}.', { y: Math.abs(y) }),
      values: { title: str(store.title[oldest]), year: y },
    }));
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: 'goodreads.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('books than {last}: {now} against {then}.', { last: S.lastYear, now: int(books.length), then: int(prev) }),
      values: { books: books.length, prev, change: delta },
    }));
  }
  return out;
}

export default { id: 'goodreads', name: 'goodreads', unit: 'books', guide: 'goodreads', match, detect, parse, cards };
