// a made-up youtube watch history from takeout, in json and in html, and
// the answers the cards must give. the viewer lives in tokyo.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, top, byTime, longestOf, busiest, hourBins, firstMax, names, bandName, songName } from './ref.js';

export const YOUTUBE = { zone: 'Asia/Tokyo', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;

export function makeWatches({ seed = 'youtube', zone = YOUTUBE.zone, from = [2024, 0, 5], to = [2026, 9, 25] } = {}) {
  const r = rng(seed);
  const channels = names(r, 60, bandName).map((name, i) => ({
    name: i === 7 ? `${name} \u{65e5}\u{672c}` : name,
    id: `UC${i.toString(36).padStart(6, '0')}`,
    from: i < 50 ? -Infinity : utc(zone, 2025, 0, 1),
  }));
  const weights = r.zipf(60, 1);
  const items = [];
  let vid = 0;
  const video = (t, extra = {}) => {
    const avail = channels.map((c, i) => (c.from <= t ? weights[i] : 0));
    const c = r.weighted(channels, avail);
    const shorts = r.chance(0.15);
    const id = (vid++).toString(36).padStart(11, 'v');
    items.push({
      t, kind: 'video', title: songName(r) + (r.chance(0.1) ? ', explained' : ''), channel: c.name, channelId: c.id,
      url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, shorts, ...extra,
    });
  };
  const run = (start, n, gaps) => {
    let t = start;
    for (let k = 0; k < n; k++) {
      video(t);
      t += gaps();
    }
  };
  for (let day = Date.UTC(...from); day <= Date.UTC(...to); day += DAY) {
    const d = new Date(day);
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    if (y === 2025 && m === 3 && dd === 19) {
      run(utc(zone, y, m, dd, 23, 0, 0) + 123, 40, () => r.int(120, 480) * 1000 + r.int(0, 999));
      continue;
    }
    if (!r.chance(0.75)) continue;
    const sessions = r.weighted([1, 2, 3], [4, 3, 1]);
    for (let s = 0; s < sessions; s++) {
      const start = utc(zone, y, m, dd, r.weighted([...Array(24).keys()], [1, 0.6, 0.3, 0.1, 0.1, 0.1, 0.3, 1, 1.5, 1, 1, 1, 2, 1.5, 1, 1, 1.5, 2, 2.5, 3, 3.5, 4, 3.5, 2]), r.int(0, 59), r.int(0, 59)) + r.int(0, 999);
      run(start, r.int(2, 12), () => (r.chance(0.12) ? r.int(12, 40) * 60000 : r.int(60, 540) * 1000) + r.int(0, 999));
    }
    if (r.chance(0.08)) items.push({ t: utc(zone, y, m, dd, 12, 0) + 5, kind: 'ad', title: 'a sparkling new phone', url: 'https://www.youtube.com/watch?v=adadadadad', channel: null });
    if (r.chance(0.04)) items.push({ t: utc(zone, y, m, dd, 13, 0) + 7, kind: 'music', title: songName(r), url: 'https://music.youtube.com/watch?v=mmmmmmmm', channel: 'a band - Topic' });
    if (r.chance(0.01)) items.push({ t: utc(zone, y, m, dd, 14, 0) + 9, kind: 'video', title: null, url: null, channel: null, removed: true });
  }
  return byTime(items);
}

function jsonItem(it) {
  if (it.removed) return { header: 'YouTube', title: 'Watched a video that has been removed', time: new Date(it.t).toISOString(), products: ['YouTube'], activityControls: ['YouTube watch history'] };
  const out = {
    header: it.kind === 'music' ? 'YouTube Music' : 'YouTube',
    title: `Watched ${it.title}`,
    titleUrl: it.url,
  };
  if (it.channel) out.subtitles = [{ name: it.channel, url: `https://www.youtube.com/channel/${it.channelId || 'UCmusic'}` }];
  out.time = new Date(it.t).toISOString();
  out.products = ['YouTube'];
  if (it.kind === 'ad') out.details = [{ name: 'From Google Ads' }];
  out.activityControls = ['YouTube watch history'];
  return out;
}

/** takeout lists the newest first */
export function watchJson(items) {
  return JSON.stringify(items.slice().reverse().map(jsonItem), null, 2);
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** the html variant: dates in the account's zone, with its abbreviation */
export function watchHtml(items, zone = YOUTUBE.zone, abbr = 'JST') {
  const cells = items.slice().reverse().map(it => {
    const p = local(it.t, zone);
    const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    const when = `${MON[p.month]} ${p.day}, ${p.year}, ${h12}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}\u{202f}${p.hour < 12 ? 'AM' : 'PM'} ${abbr}`;
    const body = it.removed
      ? 'Watched a video that has been removed<br>'
      : `Watched&nbsp;<a href="${esc(it.url)}">${esc(it.title)}</a><br>${it.channel ? `<a href="https://www.youtube.com/channel/${it.channelId || 'UCmusic'}">${esc(it.channel)}</a><br>` : ''}`;
    const caption = `<b>Products:</b><br>&emsp;YouTube<br>${it.kind === 'ad' ? '<b>Details:</b><br>&emsp;From Google Ads<br>' : ''}<b>Why is this here?</b><br>&emsp;This activity was saved to your Google Account.`;
    return `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">${it.kind === 'music' ? 'YouTube Music' : 'YouTube'}<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${body}${when}<br></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1 mdl-typography--text-right"></div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption">${caption}</div></div></div>`;
  });
  return `<html><head><meta charset="utf-8"><title>Watch history</title></head><body><div class="mdl-grid">${cells.join('')}</div></body></html>`;
}

export function takeoutZip(files) {
  return writeZip([
    ...Object.entries(files).map(([path, data]) => ({ path: `Takeout/YouTube and YouTube Music/history/${path}`, data })),
    { path: 'Takeout/YouTube and YouTube Music/history/search-history.json', data: JSON.stringify([{ header: 'YouTube', title: 'Searched for something private', titleUrl: 'https://www.youtube.com/results?search_query=something+private', time: '2025-01-01T00:00:00.000Z' }]) },
    { path: 'Takeout/YouTube and YouTube Music/subscriptions/subscriptions.csv', data: 'Channel Id,Channel Url,Channel Title\nUC1,https://example.org,Someone\n' },
    { path: 'Takeout/archive_browser.html', data: '<html><body>takeout index</body></html>' },
    { path: 'Takeout/Google Photos/2025/IMG_0001.jpg', data: new Uint8Array(4096).fill(7) },
  ]);
}

export function youtubeTruth(items, year, tz = YOUTUBE.zone, now = YOUTUBE.now) {
  const kept = items.filter(it => it.kind === 'video');
  const { start, end } = yearRange(year, tz, now);
  const vids = kept.filter(it => it.t >= start && it.t < end);
  if (!vids.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const it of vids) months[local(it.t, tz).month]++;
  out['youtube.videos'] = { videos: vids.length, months };
  const ch = top(vids.filter(it => it.channel), it => it.channel, () => 1, e => e.key, 5);
  if (ch.length) out['youtube.top-channels'] = { top: ch.map(e => ({ name: e.key, videos: e.w })) };
  const bins = hourBins(vids, tz);
  out['youtube.clock'] = { bins, peak: firstMax(bins) };
  const runs = [];
  for (const it of byTime(vids)) {
    const last = runs.at(-1);
    if (last && it.t - last.end < 10 * 60000) { last.end = it.t; last.count++; } else runs.push({ start: it.t, end: it.t, count: 1 });
  }
  const hole = longestOf(runs, s => s.count);
  if (hole.count >= 5) out['youtube.rabbit-hole'] = { start: hole.start, end: hole.end, count: hole.count };
  const shorts = vids.filter(it => it.shorts).length;
  if (shorts) out['youtube.shorts'] = { shorts, videos: vids.length, share: shorts / vids.length };
  const b = busiest(vids, tz, () => 1);
  out['youtube.busiest-day'] = { day: b.day, videos: b.w };
  const earliest = Math.min(...kept.map(it => it.t));
  if (earliest < start - 30 * DAY) {
    const before = new Set(kept.filter(it => it.t < start && it.channel).map(it => it.channel));
    const seen = new Set(vids.filter(it => it.channel).map(it => it.channel));
    const fresh = [...seen].filter(c => !before.has(c)).length;
    if (fresh) out['youtube.new-channels'] = { seen: seen.size, fresh, share: fresh / seen.size };
  }
  const prev = prevRange(year, tz, now);
  if (earliest <= prev.start + 14 * DAY) {
    const p = kept.filter(it => it.t >= prev.start && it.t < prev.end).length;
    if (p) out['youtube.change'] = { videos: vids.length, prev: p, change: (vids.length - p) / p };
  }
  return out;
}

export function youtubeFixture(opts = {}) {
  const items = makeWatches(opts);
  const truth = {};
  for (const y of YOUTUBE.years) truth[y] = youtubeTruth(items, y);
  return { items, zip: takeoutZip({ 'watch-history.json': watchJson(items) }), truth, zone: YOUTUBE.zone, now: YOUTUBE.now };
}
