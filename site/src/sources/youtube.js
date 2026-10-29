// youtube: watch-history.json from google takeout, or watch-history.html as
// a fallback. the history says what was watched and when, never for how
// long, so these cards count videos and never claim hours.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { textChunks } from '../core/files.js';
import { card, scope } from '../core/cards.js';
import { name, words, pick, percent, int, count, changeWords } from '../core/templates.js';
import { totalsBy, topN, hourHistogram, monthHistogram, peak, dayTotals, busiestDay, sessions, longest, discovery, share, change, where } from '../core/analysers.js';
import { dayName, hourName, clockTime, DAY } from '../core/timezone.js';
import { isoDay, monthLine, clock, heatmap, bars, zoneLabel, progress } from './common.js';

const RUN_GAP = 10 * 60000;

function match(f) {
  return /^watch-history\.(json|html?)$/i.test(f.name) ? 0.6 : 0;
}

function sniff(f) {
  const t = f.headText || '';
  if (/^\s*\[/.test(t) && /"titleUrl"\s*:/.test(t) && /youtube\.com\/(watch|shorts)/.test(t) && /"time"\s*:/.test(t)) return { variant: 'json', score: 0.9 };
  if (/<html/i.test(t) && /content-cell/.test(t) && /youtube\.com\/watch/.test(t)) return { variant: 'html', score: 0.85 };
  if (/<html/i.test(t) && /content-cell/.test(t) && match(f)) return { variant: 'html', score: 0.7 };
  return null;
}

function detect(files) {
  const out = [];
  for (const f of files) {
    // search history looks the same but is not read
    if (/search_query=|"Searched for /.test(f.headText || '')) continue;
    const s = sniff(f);
    if (s) {
      f.variant = s.variant;
      out.push({ file: f, score: s.score });
    }
  }
  return { files: out };
}

const isAd = item => Array.isArray(item.details) && item.details.some(d => /google ads/i.test(String(d && d.name)));
const isMusic = (header, url) => /youtube music/i.test(header || '') || /music\.youtube\.com/.test(url || '');

function cleanTitle(title, url) {
  if (!url) return undefined;
  return String(title || '').replace(/^Watched\s+/, '').trim() || undefined;
}

async function parse(files, onProgress) {
  const store = new EventStore(16384);
  const notes = [];
  const tick = progress(onProgress);
  const counts = { ads: 0, music: 0, unreadable: 0 };
  const add = (t, title, url, channel) => {
    if (!Number.isFinite(t)) { counts.unreadable++; return; }
    store.push({
      t, kind: 'video', title: cleanTitle(title, url), creator: url ? channel : undefined,
      meta: { shorts: /\/shorts\//.test(url || ''), removed: !url },
    });
    tick.tick();
  };
  for (const f of files) {
    try {
      if (f.variant === 'html') {
        await parseHtml(f, (entry) => {
          if (entry.ad) { counts.ads++; return; }
          if (isMusic(entry.header, entry.url)) { counts.music++; return; }
          add(entry.t, entry.title, entry.url, entry.channel);
        });
      } else {
        await readJsonList(f, item => {
          if (!item || typeof item !== 'object') return;
          if (isAd(item)) { counts.ads++; return; }
          if (isMusic(item.header, item.titleUrl)) { counts.music++; return; }
          const channel = Array.isArray(item.subtitles) && item.subtitles[0] ? item.subtitles[0].name : undefined;
          add(Date.parse(item.time), item.title, item.titleUrl, channel);
        });
      }
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'truncated' ? 'this watch history stops partway. the download may not have finished.' : 'this watch history could not be read. it may be damaged.' });
    }
  }
  tick.done();
  if (counts.ads) notes.push({ code: 'ads', message: `${count(counts.ads, 'ad')} in the history were left out.` });
  if (counts.music) notes.push({ code: 'music', message: `${count(counts.music, 'youtube music play', 'youtube music plays')} were left out. this deck is about videos.` });
  if (counts.unreadable) {
    notes.push({ code: 'dates', message: counts.unreadable > tick.count
      ? 'most dates in this html history are in a format attic cannot read yet. export the history again as json, as the guide shows.'
      : `${count(counts.unreadable, 'entry', 'entries')} had a date attic could not read.` });
  }
  return { store, notes, count: tick.count };
}

// the html fallback

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', emsp: ' ', ensp: ' ', thinsp: ' ' };
export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// common zone abbreviations in takeout dates, in minutes east of utc
const ZONES = {
  UTC: 0, GMT: 0, WET: 0, WEST: 60, BST: 60, IST: 330, CET: 60, CEST: 120, EET: 120, EEST: 180, MSK: 180,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420, AKST: -540, AKDT: -480, HST: -600,
  JST: 540, KST: 540, HKT: 480, SGT: 480, AWST: 480, ACST: 570, ACDT: 630, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780,
};
const MONTH = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Mar 2, 2025, 9:15:30 PM CET" to utc ms, or NaN */
export function parseTakeoutDate(text) {
  const s = decodeEntities(text).replace(/[\s\u{a0}\u{202f}]+/gu, ' ').trim();
  const m = s.match(/^([A-Z][a-z]{2,3}) (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?(AM|PM)? ?(UTC|GMT[+-]\d{1,2}(?::?\d{2})?|[A-Z]{2,5})?$/);
  if (!m) return NaN;
  const [, mon, day, year, hh, mm, ss, ampm, zoneText] = m;
  if (!(mon in MONTH)) return NaN;
  let hour = Number(hh) % 12;
  if (ampm === 'PM') hour += 12;
  if (!ampm) hour = Number(hh);
  let offset;
  if (!zoneText) offset = 0;
  else if (zoneText in ZONES) offset = ZONES[zoneText];
  else {
    const g = zoneText.match(/^GMT([+-])(\d{1,2}):?(\d{2})?$/);
    if (!g) return NaN;
    offset = (g[1] === '-' ? -1 : 1) * (Number(g[2]) * 60 + Number(g[3] || 0));
  }
  return Date.UTC(Number(year), MONTH[mon], Number(day), hour, Number(mm), Number(ss || 0)) - offset * 60000;
}

function parseCell(cell) {
  const header = (cell.match(/class="mdl-typography--title"[^>]*>([\s\S]*?)<br/) || [])[1] || '';
  const content = (cell.match(/class="content-cell[^"]*body-1"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
  if (content === undefined) return null;
  const links = [...content.matchAll(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(x => ({ url: decodeEntities(x[1]), text: decodeEntities(x[2].replace(/<[^>]+>/g, '')).trim() }));
  const parts = content.split(/<br\s*\/?>/).map(p => p.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const video = links.find(l => /youtube\.com\/(watch|shorts)/.test(l.url));
  const channel = links.find(l => /youtube\.com\/(channel|@|c\/|user)/.test(l.url));
  return {
    header: decodeEntities(header.replace(/<[^>]+>/g, '')).trim(),
    url: video ? video.url : undefined,
    title: video ? video.text : undefined,
    channel: channel ? channel.text : undefined,
    t: parseTakeoutDate(parts[parts.length - 1] || ''),
    ad: /from google ads/i.test(cell),
  };
}

/** stream the html, one outer cell at a time */
async function parseHtml(f, onEntry) {
  let buf = '';
  const MARK = '<div class="outer-cell';
  for await (const chunk of textChunks(f)) {
    buf += chunk;
    let at = buf.indexOf(MARK);
    while (at !== -1) {
      const next = buf.indexOf(MARK, at + MARK.length);
      if (next === -1) break;
      const e = parseCell(buf.slice(at, next));
      if (e) onEntry(e);
      at = next;
    }
    buf = at === -1 ? buf.slice(-MARK.length) : buf.slice(at);
  }
  if (buf.startsWith(MARK)) {
    const e = parseCell(buf);
    if (e) onEntry(e);
  }
}

// the cards

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const vids = store.ofKind('video', S.lo, S.hi);
  if (!vids.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const out = [];
  const base = { source: 'youtube' };

  const months = monthHistogram(t, vids, z);
  let prev = null;
  if (S.prev) prev = store.ofKind('video', S.prev.lo, S.prev.hi).length;
  const delta = prev ? change(vids.length, prev) : null;
  out.push(card({
    ...base, id: 'youtube.videos', title: 'your year on youtube', big: count(vids.length, 'video'),
    caption: words(pick(['watched {when}. the history lists videos, not minutes.', 'started {when}, by your watch history. it counts videos, not time.'], `yt:${ctx.year}:${vids.length}`), { when }),
    detail: words('about {n} a day.', { n: int(Math.round(vids.length / Math.max(1, (S.y1 - S.y0) / DAY))) }),
    visual: monthLine(months, v => int(v)),
    values: { videos: vids.length, months },
    stat: { label: 'youtube videos', display: int(vids.length), value: vids.length, change: delta },
  }));

  const channels = topN(totalsBy(store.creator, vids, null, t), 5, str);
  if (channels.length) {
    out.push(card({
      ...base, id: 'youtube.top-channels', title: 'top channels', big: name(str(channels[0].key)),
      caption: words('the channel you watched most {when}, {n}.', { when, n: count(channels[0].w, 'video') }),
      visual: bars(channels.map(e => ({ label: name(str(e.key)), value: e.w, display: count(e.w, 'video') }))),
      values: { top: channels.map(e => ({ name: str(e.key), videos: e.w })) },
    }));
  }

  const bins = hourHistogram(t, vids, z);
  const h = peak(bins);
  out.push(card({
    ...base, id: 'youtube.clock', title: 'your youtube hour', big: hourName(h),
    caption: words('is when you started the most videos {when}.', { when }),
    detail: words('by the time each video started, in {tz} time.', { tz: zoneLabel(ctx.timeZone) }),
    visual: clock(bins, h),
    values: { bins, peak: h },
  }));

  const runs = sessions(t, null, vids, RUN_GAP - 1);
  const hole = longest(runs, s => s.count);
  if (hole && hole.count >= 5) {
    const p = z.parts(hole.start);
    out.push(card({
      ...base, id: 'youtube.rabbit-hole', title: 'the rabbit hole', big: count(hole.count, 'video'),
      caption: words('in a row on {day}, from {time}, never more than 10 minutes apart.', { day: dayName(z.dayKey(hole.start)), time: clockTime(p.hour, p.minute) }),
      values: { start: hole.start, end: hole.end, count: hole.count },
      stat: { label: 'videos in a row', display: int(hole.count), value: hole.count, change: null },
    }));
  }

  const shortsCol = store.column('shorts');
  const shorts = shortsCol ? where(vids, i => shortsCol[i] === 2).length : 0;
  if (shorts) {
    out.push(card({
      ...base, id: 'youtube.shorts', title: 'shorts', big: percent(share(shorts, vids.length)),
      caption: 'of the videos you watched were shorts.',
      detail: words('{n} in all.', { n: count(shorts, 'short') }),
      values: { shorts, videos: vids.length, share: share(shorts, vids.length) },
    }));
  }

  const perDay = dayTotals(t, vids, z);
  const big = busiestDay(perDay);
  out.push(card({
    ...base, id: 'youtube.busiest-day', title: 'your busiest day', big: dayName(big.day),
    caption: words('{n} in one day.', { n: count(big.w, 'video') }),
    detail: 'each square is a day. the darker it is, the more videos.',
    visual: heatmap(z, S.y0, S.y1, perDay, big.day),
    values: { day: isoDay(big.day), videos: big.w },
  }));

  const earlier = store.ofKind('video', 0, S.lo);
  if (earlier.length && t[earlier[0]] < S.y0 - 30 * DAY) {
    const d = discovery(store.creator, earlier, vids);
    if (d.fresh) {
      out.push(card({
        ...base, id: 'youtube.new-channels', title: 'new channels', big: count(d.fresh, 'channel'),
        caption: words('new to you {when}, out of {n} you watched.', { when, n: int(d.seen) }),
        values: { seen: d.seen, fresh: d.fresh, share: d.share },
      }));
    }
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: 'youtube.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('videos than {last}: {now} against {then}.', { last: S.lastYear, now: int(vids.length), then: int(prev) }),
      values: { videos: vids.length, prev, change: delta },
    }));
  }
  return out;
}

export default {
  id: 'youtube',
  name: 'youtube',
  unit: 'videos',
  guide: 'youtube',
  match,
  detect,
  parse,
  cards,
};
