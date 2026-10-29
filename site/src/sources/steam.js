// steam: the licences page (store.steampowered.com/account/licenses),
// saved as a web page, or the same table as csv. steam has no export of
// playtime by year, so this deck is about games added. dates only, so the
// cards are made in utc. the page structure is from memory.

import { EventStore } from '../core/store.js';
import { textChunks } from '../core/files.js';
import { card, scope } from '../core/cards.js';
import { name, words, int, count, changeWords, percent } from '../core/templates.js';
import { totalsBy, topN, monthHistogram, peak, change, share } from '../core/analysers.js';
import { dayName, MONTHS } from '../core/timezone.js';
import { monthLine, bars, progress, readCsv, headerHas } from './common.js';
import { decodeEntities } from './youtube.js';

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** "5 Jan, 2025" or "Jan 5, 2025" to 12:00 utc that day */
export function steamDate(s) {
  const t = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let m = t.match(/^(\d{1,2}) ([a-z]{3,4})\.?,? (\d{4})$/);
  if (m && m[2] in MON) return Date.UTC(Number(m[3]), MON[m[2]], Number(m[1]), 12);
  m = t.match(/^([a-z]{3,4})\.? (\d{1,2}),? (\d{4})$/);
  if (m && m[1] in MON) return Date.UTC(Number(m[3]), MON[m[1]], Number(m[2]), 12);
  return NaN;
}

const match = f => (/licen[cs]es?.*\.(html?|csv)$/i.test(f.name) ? 0.6 : 0);
function detect(files) {
  const out = [];
  for (const f of files) {
    const t = f.headText || '';
    if (/license_date_col|account_table/.test(t) && /<html/i.test(t)) { f.variant = 'html'; out.push({ file: f, score: 0.9 }); }
    else if (/\.csv$/i.test(f.name) && headerHas(f, 'Date', 'Item', 'Acquisition Method')) { f.variant = 'csv'; out.push({ file: f, score: 0.9 }); }
  }
  return { files: out };
}

const text = html => decodeEntities(html.replace(/<div class="free_license_remove_link"[\s\S]*?<\/div>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function parse(files, onProgress) {
  const store = new EventStore(1024);
  const notes = [];
  const tick = progress(onProgress, 200);
  const add = (date, item, how) => {
    const t = steamDate(date);
    if (!Number.isFinite(t) || !item) return;
    store.push({ t, kind: 'game', title: item, creator: how || 'unknown' });
    tick.tick();
  };
  for (const f of files) {
    try {
      if (f.variant === 'csv') {
        await readCsv(f, { date: ['Date'], item: ['Item', 'Name'], how: ['Acquisition Method'] }, ['date', 'item'], 'steam licences', get => add(get('date'), get('item'), get('how')));
      } else {
        let buf = '';
        for await (const chunk of textChunks(f)) {
          buf += chunk;
          let end;
          while ((end = buf.indexOf('</tr>')) !== -1) {
            const row = buf.slice(0, end);
            buf = buf.slice(end + 5);
            const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m => text(m[1]));
            if (cells.length >= 3) add(cells[0], cells[1], cells[2]);
          }
        }
      }
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this steam page could not be read to the end.' });
    }
  }
  if (!store.length) notes.push({ code: 'empty', message: 'no games were found on this steam page. save the licences page while signed in, as the guide shows.' });
  tick.done();
  return { store, notes, count: tick.count };
}

function cards(r, ctxIn) {
  const ctx = { ...ctxIn, timeZone: 'UTC' };
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const games = store.ofKind('game', S.lo, S.hi);
  if (!games.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const base = { source: 'steam' };
  const out = [];
  const months = monthHistogram(t, games, z);
  const prev = S.prev ? store.ofKind('game', S.prev.lo, S.prev.hi).length : null;
  const delta = prev ? change(games.length, prev) : null;
  out.push(card({
    ...base, id: 'steam.games', title: 'your year on steam', big: count(games.length, 'game'),
    caption: words('added to your library {when}.', { when }),
    detail: 'steam keeps no playtime by year, so this counts what you added.',
    visual: monthLine(months, v => int(v)),
    values: { games: games.length, months },
    stat: { label: 'games added on steam', display: int(games.length), value: games.length, change: delta },
  }));
  const how = topN(totalsBy(store.creator, games, null, t), 5, str);
  out.push(card({
    ...base, id: 'steam.how', title: 'how they arrived', big: str(how[0].key).toLowerCase(),
    caption: words('is how {share} of them came to you.', { share: percent(share(how[0].w, games.length)) }),
    visual: bars(how.map(e => ({ label: str(e.key).toLowerCase(), value: e.w, display: count(e.w, 'game') }))),
    values: { top: how.map(e => ({ name: str(e.key), games: e.w })) },
  }));
  const m = peak(months);
  out.push(card({
    ...base, id: 'steam.month', title: 'your busiest month', big: MONTHS[m],
    caption: words('{n} added in one month.', { n: count(months[m], 'game') }),
    values: { month: m, games: months[m] },
  }));
  const f = games[0], l = games[games.length - 1];
  out.push(card({
    ...base, id: 'steam.first-last', title: 'first and last', big: name(str(store.title[f])),
    caption: words('the first game you added {when}, on {day}.', { when, day: dayName(z.dayKey(t[f])) }),
    detail: words(S.unfinished ? 'the latest so far is {game}, on {day}.' : 'the last was {game}, on {day}.', { game: name(str(store.title[l])), day: dayName(z.dayKey(t[l])) }),
    values: { first: str(store.title[f]), last: str(store.title[l]) },
  }));
  if (delta !== null) {
    out.push(card({
      ...base, id: 'steam.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('games than {last}: {now} against {then}.', { last: S.lastYear, now: int(games.length), then: int(prev) }),
      values: { games: games.length, prev, change: delta },
    }));
  }
  return out;
}

export default { id: 'steam', name: 'steam', unit: 'games', guide: 'steam', match, detect, parse, cards };
