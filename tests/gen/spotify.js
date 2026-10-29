// a made-up spotify history, its export files, and the answers the cards
// must give. the listener lives in amsterdam; the export is in utc.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, top, byTime, sessionsOf, longestOf, busiest, hourBins, firstMax, mostInADay, names, bandName, songName, showName } from './ref.js';

export const SPOTIFY = { zone: 'Europe/Amsterdam', now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026] };
const DAY = 86400000;
const iso = t => new Date(t).toISOString().replace('.000Z', 'Z');

const HOUR_WEIGHTS = [2, 1.5, 1, 0.5, 0.3, 0.2, 0.5, 2, 3, 2, 1.5, 1.5, 2, 2, 1.5, 1.5, 2, 3, 3, 3, 3.5, 4, 3.5, 3];

/** every play the listener made, in plain form, oldest first */
export function makePlays({ seed = 'spotify', zone = SPOTIFY.zone, from = [2024, 0, 3], to = [2026, 9, 20], scale = 1 } = {}) {
  const r = rng(seed);
  const artistNames = names(r, 40, bandName);
  const artists = artistNames.map((name, i) => ({
    name,
    from: i < 28 ? -Infinity : i < 36 ? utc(zone, 2025, 0, 1) : utc(zone, 2026, 0, 1),
    albums: names(r, 3, songName).map(album => ({ album, tracks: names(r, 8, songName).map(title => ({ title, len: r.int(140, 330) * 1000 })) })),
  }));
  const weights = r.zipf(40, 1.1);
  const shows = names(r, 2, showName);
  const items = [];
  const planted = { repeat: '2025-06-14', marathon: '2025-09-20' };
  const addPlay = (t, ms, a, al, tr, full) => items.push({
    t, ms, kind: 'listen', title: tr.title, artist: a.name, album: al.album, skipped: !full, reasonEnd: full ? 'trackdone' : 'fwdbtn',
  });
  const pickTrack = t => {
    const avail = artists.map((a, i) => (a.from <= t ? weights[i] : 0));
    const a = r.weighted(artists, avail);
    const al = r.pick(a.albums);
    const tr = r.weighted(al.tracks, r.zipf(8, 0.8));
    return { a, al, tr };
  };
  // runs a session of n songs from a start time, returns its end
  const session = (start, n, opts = {}) => {
    let cursor = start;
    for (let k = 0; k < n; k++) {
      const { a, al, tr } = opts.fixed || pickTrack(cursor);
      const full = opts.full || r.chance(0.8);
      const ms = full ? tr.len : r.int(2000, 45000);
      const end = Math.ceil((cursor + ms) / 1000) * 1000;
      addPlay(end - ms, ms, a, al, tr, full);
      cursor = end + (opts.tight ? r.int(0, 2) * 1000 : r.chance(0.1) ? r.int(60, 600) * 1000 : r.int(0, 3) * 1000);
    }
    return cursor;
  };
  let day = Date.UTC(...from);
  const last = Date.UTC(...to);
  for (; day <= last; day += DAY) {
    const d = new Date(day);
    const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
    const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    if (date === planted.repeat) {
      const fixed = { a: artists[3], al: artists[3].albums[0], tr: artists[3].albums[0].tracks[2] };
      session(utc(zone, y, m, dd, 15, 4, 0), 15, { fixed, full: true, tight: true });
      continue;
    }
    if (date === planted.marathon) {
      session(utc(zone, y, m, dd, 12, 0, 0), 70, { tight: true });
      continue;
    }
    // podcasts on some mornings
    if (r.chance(0.3)) {
      const show = r.pick(shows);
      const ms = r.int(20, 60) * 60000;
      const start = utc(zone, y, m, dd, r.int(6, 8), r.int(0, 59), 0);
      items.push({ t: start, ms, kind: 'podcast', title: `episode ${r.int(1, 300)}: ${songName(r).toLowerCase()}`, artist: show });
    }
    if (!r.chance(0.7 * scale)) continue;
    const n = r.weighted([1, 2, 3], [5, 3, 1]);
    const hours = [...new Set(Array.from({ length: n }, () => r.weighted([...Array(24).keys()], HOUR_WEIGHTS)))].sort((a, b) => a - b);
    let lastEnd = -Infinity;
    for (const h of hours) {
      const start = utc(zone, y, m, dd, h, r.int(0, 59), r.int(0, 59));
      if (start < lastEnd + 25 * 60000) continue;
      lastEnd = session(start, r.int(3, 14));
    }
  }
  // a few audiobook chapters and plays with no names (local files)
  for (let k = 0; k < 5; k++) items.push({ t: utc(zone, 2025, 2, 3 + k, 7, 30), ms: 1200000, kind: 'audiobook', title: `chapter ${k + 1}`, artist: 'a long book' });
  for (let k = 0; k < 25; k++) items.push({ t: utc(zone, 2025, 4, 1 + k, 10, 0), ms: 180000, kind: 'unnamed' });
  for (let k = 0; k < 4; k++) items.push({ t: utc(zone, 2025, 7, 1 + k, 11, 0), ms: 300000, kind: 'video', title: `a video ${k}`, artist: shows[0] });
  return byTime(items);
}

function extendedItem(it, r) {
  const music = it.kind === 'listen';
  return {
    ts: iso(it.t + it.ms),
    platform: r.pick(['android', 'ios', 'windows', 'web_player']),
    ms_played: it.ms,
    conn_country: 'NL',
    master_metadata_track_name: music ? it.title : null,
    master_metadata_album_artist_name: music ? it.artist : null,
    master_metadata_album_album_name: music ? it.album : null,
    spotify_track_uri: music ? `spotify:track:${it.title.length}${it.artist.length}x` : null,
    episode_name: it.kind === 'podcast' ? it.title : null,
    episode_show_name: it.kind === 'podcast' ? it.artist : null,
    spotify_episode_uri: it.kind === 'podcast' ? 'spotify:episode:x' : null,
    audiobook_title: it.kind === 'audiobook' ? it.artist : null,
    audiobook_uri: it.kind === 'audiobook' ? 'spotify:show:x' : null,
    audiobook_chapter_uri: null,
    audiobook_chapter_title: it.kind === 'audiobook' ? it.title : null,
    reason_start: 'trackdone',
    reason_end: it.reasonEnd || 'trackdone',
    shuffle: r.chance(0.3),
    skipped: !!it.skipped,
    offline: false,
    offline_timestamp: null,
    incognito_mode: false,
  };
}

/** the files of an extended history export, split by year like spotify does */
export function extendedFiles(items, seed = 'files') {
  const r = rng(seed);
  const audio = items.filter(it => it.kind !== 'video');
  const byYear = new Map();
  for (const it of audio) {
    const y = new Date(it.t + it.ms).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(extendedItem(it, r));
  }
  const files = {};
  let n = 0;
  for (const [y, list] of [...byYear].sort((a, b) => a[0] - b[0])) {
    files[`Spotify Extended Streaming History/Streaming_History_Audio_${y}_${n++}.json`] = JSON.stringify(list, null, 1);
  }
  const video = items.filter(it => it.kind === 'video').map(it => extendedItem(it, r));
  if (video.length) files['Spotify Extended Streaming History/Streaming_History_Video_2025.json'] = JSON.stringify(video, null, 1);
  files['Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf'] = '%PDF-1.4 not a real pdf';
  return files;
}

/** the account data variant: minute precision, no albums, no skips */
export function accountFiles(items) {
  const pad = n => String(n).padStart(2, '0');
  const endTime = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const music = items.filter(it => it.kind === 'listen').map(it => ({ endTime: endTime(it.t + it.ms), artistName: it.artist, trackName: it.title, msPlayed: it.ms }));
  const pods = items.filter(it => it.kind === 'podcast').map(it => ({ endTime: endTime(it.t + it.ms), podcastName: it.artist, episodeName: it.title, msPlayed: it.ms }));
  return {
    'Spotify Account Data/StreamingHistory_music_0.json': JSON.stringify(music, null, 2),
    'Spotify Account Data/StreamingHistory_podcast_0.json': JSON.stringify(pods, null, 2),
    'Spotify Account Data/Userdata.json': JSON.stringify({ country: 'NL', createdFromFacebook: false }),
  };
}

export function zipOf(files) {
  return writeZip(Object.entries(files).map(([path, data]) => ({ path, data })));
}

/**
 * the answers, worked out the plain way.
 * @returns {Record<string, any>} values by card id
 */
export function spotifyTruth(items, year, tz = SPOTIFY.zone, now = SPOTIFY.now) {
  const kept = items.filter(it => it.kind !== 'unnamed');
  const { start, end } = yearRange(year, tz, now);
  const music = kept.filter(it => it.kind === 'listen' && it.t >= start && it.t < end);
  if (!music.length) return {};
  const plays = music.filter(it => it.ms >= 30000);
  const out = {};
  const ms = music.reduce((s, it) => s + it.ms, 0);
  const months = new Array(12).fill(0);
  for (const it of music) months[local(it.t, tz).month] += it.ms;
  const prev = prevRange(year, tz, now);
  const covered = Math.min(...kept.map(it => it.t)) <= prev.start + 14 * DAY;
  const prevMs = covered ? kept.filter(it => it.kind === 'listen' && it.t >= prev.start && it.t < prev.end).reduce((s, it) => s + it.ms, 0) : null;
  out['spotify.hours'] = { ms, plays: plays.length, months };

  const artists = top(music, it => it.artist, it => it.ms, e => e.key, 5);
  out['spotify.top-artists'] = { top: artists.map(e => ({ name: e.key, ms: e.w })), ms };
  const tracks = top(plays, it => `${it.title}\u{0}${it.artist}`, () => 1, e => e.key, 5);
  out['spotify.top-tracks'] = { top: tracks.map(e => ({ title: e.item.title, artist: e.item.artist, plays: e.w })) };
  const [album] = top(music.filter(it => it.album), it => `${it.album}\u{0}${it.artist}`, it => it.ms, e => e.key, 1);
  out['spotify.top-album'] = { name: album.item.album, artist: album.item.artist, ms: album.w };

  const big = busiest(music, tz, it => it.ms);
  out['spotify.peak-day'] = { day: big.day, ms: big.w };
  const bins = hourBins(plays, tz);
  out['spotify.clock'] = { bins, peak: firstMax(bins) };
  const night = plays.filter(it => local(it.t, tz).hour < 5).length;
  out['spotify.night'] = { night, plays: plays.length, share: night / plays.length };

  const long = longestOf(sessionsOf(music, 20 * 60000), s => s.end - s.start);
  out['spotify.session'] = { start: long.start, end: long.end, count: long.count, ms: long.ms };

  const earliestMusic = Math.min(...kept.filter(it => it.kind === 'listen').map(it => it.t));
  if (earliestMusic < start - 30 * DAY) {
    const before = new Set(kept.filter(it => it.kind === 'listen' && it.ms >= 30000 && it.t < start).map(it => it.artist));
    const seen = new Set(plays.map(it => it.artist));
    const fresh = [...seen].filter(a => !before.has(a)).length;
    if (fresh) out['spotify.discovery'] = { seen: seen.size, fresh, share: fresh / seen.size };
  }
  out['spotify.loyalty'] = { name: artists[0].key, ms: artists[0].w, share: artists[0].w / ms };
  const skipped = music.filter(it => it.skipped).length;
  out['spotify.skips'] = { skipped, started: music.length, share: skipped / music.length };

  const rep = mostInADay(plays, tz, it => `${it.title}\u{0}${it.artist}`, it => `${it.title}\u{0}${it.artist}`);
  if (rep && rep.n >= 3) out['spotify.repeat'] = { title: rep.item.title, artist: rep.item.artist, day: rep.day, plays: rep.n };

  const p = byTime(plays);
  const who = it => ({ title: it.title, artist: it.artist, t: it.t });
  out['spotify.first-last'] = { first: who(p[0]), last: who(p[p.length - 1]) };

  if (prevMs) out['spotify.change'] = { ms, prevMs, change: (ms - prevMs) / prevMs };

  const pods = kept.filter(it => it.kind === 'podcast' && it.t >= start && it.t < end);
  const podMs = pods.reduce((s, it) => s + it.ms, 0);
  if (podMs >= 10 * 60000) {
    const [show] = top(pods, it => it.artist, it => it.ms, e => e.key, 1);
    out['spotify.podcasts'] = { ms: podMs, episodes: pods.length, top: { name: show.key, ms: show.w } };
  }
  return out;
}

/** everything a test needs */
export function spotifyFixture(opts = {}) {
  const items = makePlays(opts);
  const files = extendedFiles(items);
  const truth = {};
  for (const y of SPOTIFY.years) truth[y] = spotifyTruth(items, y);
  return { items, files, zip: zipOf(files), truth, zone: SPOTIFY.zone, now: SPOTIFY.now };
}
