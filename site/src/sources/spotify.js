// spotify: the extended streaming history (Streaming_History_Audio_*.json)
// and the smaller account data (StreamingHistory_music_*.json). field names
// are from memory and may drift, so every field has a list of aliases.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { card, scope } from '../core/cards.js';
import { name, words, pick, hours, hoursValue, duration, percent, int, count, changeWords } from '../core/templates.js';
import { totalsBy, topN, sum, hourHistogram, monthHistogram, peak, dayTotals, busiestDay, sessions, longest, discovery, share, change, maxPerDay, where, pair } from '../core/analysers.js';
import { dayName, longDayName, hourName, DAY } from '../core/timezone.js';
import { field, parseUtc, isoDay, monthLine, clock, heatmap, bars, zoneLabel, progress } from './common.js';

export const PLAY_MS = 30000;
const SESSION_GAP = 20 * 60000;

const F = {
  time: ['ts', 'endTime', 'end_time', 'timestamp'],
  ms: ['ms_played', 'msPlayed', 'ms'],
  track: ['master_metadata_track_name', 'trackName', 'track_name'],
  artist: ['master_metadata_album_artist_name', 'artistName', 'artist_name'],
  album: ['master_metadata_album_album_name', 'albumName', 'album_name'],
  episode: ['episode_name', 'episodeName'],
  show: ['episode_show_name', 'podcastName', 'showName'],
  audiobook: ['audiobook_title', 'audiobookName'],
  chapter: ['audiobook_chapter_title'],
  skipped: ['skipped'],
  reasonEnd: ['reason_end', 'reasonEnd'],
};

const EXTENDED_NAME = /^Streaming_History_(Audio|Video)_.*\.json$/i;
const ACCOUNT_NAME = /^StreamingHistory(_music_|_podcast_)?\d*\.json$/i;

function sniff(f) {
  const t = f.headText || '';
  if (!/^\s*\[/.test(t)) return null;
  if (/"ts"\s*:/.test(t) && /"ms_played"\s*:/.test(t)) return { variant: /_Video_/i.test(f.name) ? 'video' : 'extended', score: 0.95 };
  if (/"endTime"\s*:/.test(t) && /"msPlayed"\s*:/.test(t)) return { variant: /_podcast_/i.test(f.name) || (/"podcastName"/.test(t) && !/"trackName"/.test(t)) ? 'podcast' : 'account', score: 0.9 };
  return null;
}

function detect(files) {
  const out = [];
  const notes = [];
  for (const f of files) {
    const s = sniff(f);
    if (s) {
      f.variant = s.variant;
      out.push({ file: f, score: s.score });
    } else if (match(f) && !f.archive) {
      notes.push({ path: f.path, code: 'format', message: 'this file is named like a spotify listening history, but it does not hold a list of plays. it may be damaged, or spotify may have changed the format.' });
    }
  }
  return { files: out, notes };
}

function match(f) {
  return EXTENDED_NAME.test(f.name) || ACCOUNT_NAME.test(f.name) ? 0.9 : 0;
}

async function parse(files, onProgress) {
  const store = new EventStore(64 * 1024);
  const notes = [];
  const tick = progress(onProgress);
  let skippedEmpty = 0;
  // the extended history is read first: where it covers a stretch of time,
  // the account data copy of the same plays is left out.
  const order = ['extended', 'video', 'account', 'podcast'];
  const sorted = [...files].sort((a, b) => order.indexOf(a.variant) - order.indexOf(b.variant) || (a.path < b.path ? -1 : 1));
  let extFrom = Infinity, extTo = -Infinity;
  let overlap = 0;
  for (const f of sorted) {
    const variant = f.variant || 'extended';
    try {
      await readJsonList(f, item => {
        if (!item || typeof item !== 'object') return;
        const end = parseUtc(field(item, F.time));
        const ms = Number(field(item, F.ms));
        if (!Number.isFinite(end) || !Number.isFinite(ms) || ms < 0) return;
        const t = end - ms;
        let kind, title, creator, album;
        const track = field(item, F.track);
        if (variant === 'video') {
          kind = 'video';
          title = track || field(item, F.episode);
          creator = field(item, F.artist) || field(item, F.show);
        } else if (variant === 'podcast') {
          kind = 'podcast';
          title = field(item, F.episode);
          creator = field(item, F.show);
        } else if (track) {
          kind = 'listen';
          title = track;
          creator = field(item, F.artist);
          album = field(item, F.album);
        } else if (field(item, F.episode)) {
          kind = 'podcast';
          title = field(item, F.episode);
          creator = field(item, F.show);
        } else if (field(item, F.audiobook)) {
          kind = 'audiobook';
          title = field(item, F.chapter) || field(item, F.audiobook);
          creator = field(item, F.audiobook);
        } else {
          skippedEmpty++;
          return;
        }
        if (variant === 'account' || variant === 'podcast') {
          if (t >= extFrom && t <= extTo) { overlap++; return; }
        }
        const skipped = item.skipped;
        store.push({
          t, dur: ms, kind, title, creator, album,
          meta: {
            skipped: typeof skipped === 'boolean' ? skipped : undefined,
            reasonEnd: typeof field(item, F.reasonEnd) === 'string' ? field(item, F.reasonEnd) : undefined,
          },
        });
        if (variant === 'extended' || variant === 'video') {
          if (t < extFrom) extFrom = t;
          if (t > extTo) extTo = t;
        }
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: spotifyMessage(e) });
    }
  }
  tick.done();
  if (overlap) notes.push({ code: 'overlap', message: `${int(overlap)} plays were in both the extended history and the account data, so they were counted once.` });
  if (skippedEmpty) notes.push({ code: 'unnamed', message: `${int(skippedEmpty)} plays had no song, episode or book name, so they were left out.` });
  return { store, notes, count: tick.count };
}

function spotifyMessage(e) {
  if (e.code === 'truncated') return 'this spotify file stops partway. the download may not have finished.';
  if (e.code === 'not-a-list') return 'this spotify file is json, but not a list of plays.';
  if (e.code === 'damaged') return e.message;
  return 'this spotify file could not be read. it may be damaged.';
}

// the cards

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const music = store.ofKind('listen', S.lo, S.hi);
  if (!music.length) return [];
  const t = store.t, dur = store.dur, str = id => store.strings.str(id) || '';
  const plays = where(music, i => dur[i] >= PLAY_MS);
  const out = [];
  const seed = id => `${id}:${ctx.year}:${music.length}`;
  const base = { source: 'spotify' };

  // total time
  const ms = sum(dur, music);
  const months = monthHistogram(t, music, z, dur);
  let prevMs = null;
  if (S.prev) prevMs = sum(dur, store.ofKind('listen', S.prev.lo, S.prev.hi));
  const delta = prevMs ? change(ms, prevMs) : null;
  const days = Math.round(ms / 3600000 / 16);
  out.push(card({
    ...base, id: 'spotify.hours', title: 'your year in music', big: hours(ms),
    caption: words(pick(['of music {when}, counting every play.', 'spent with music {when}, every play counted.'], seed('h')), { when }),
    detail: days >= 2 ? words('that is {days} waking days of music, at sixteen hours a day.', { days: int(days) }) : '',
    visual: monthLine(months.map(v => hoursValue(v)), v => `${v} h`),
    values: { ms, plays: plays.length, months },
    stat: { label: 'hours of music', display: hours(ms), value: hoursValue(ms), change: delta },
  }));

  // top artists, by time
  const byArtist = totalsBy(store.creator, music, dur, t);
  const artists = topN(byArtist, 5, str);
  if (artists.length) {
    const a = artists[0];
    out.push(card({
      ...base, id: 'spotify.top-artists', title: 'top artists', big: name(str(a.key)),
      caption: words('your most played artist {when}, with {hours}.', { when, hours: hours(a.w) }),
      detail: 'ranked by time listened.',
      visual: bars(artists.map(e => ({ label: name(str(e.key)), value: e.w, display: `${hours(e.w)}, ${percent(share(e.w, ms))}` }))),
      values: { top: artists.map(e => ({ name: str(e.key), ms: e.w })), ms },
    }));
  }

  // top tracks, by plays over 30 seconds
  const trackKey = i => pair(store.title[i], store.creator[i]);
  const trackName = k => `${str(Math.floor(k / 67108864))}\u{0}${str(k % 67108864)}`;
  const byTrack = totalsBy(trackKey, plays, null, t);
  const tracks = topN(byTrack, 5, trackName);
  const unpair = k => ({ title: str(Math.floor(k / 67108864)), artist: k % 67108864 === 67108863 ? '' : str(k % 67108864) });
  if (tracks.length) {
    const top = unpair(tracks[0].key);
    out.push(card({
      ...base, id: 'spotify.top-tracks', title: 'top songs', big: name(top.title),
      caption: words('played {n} {when}. we count plays over 30 seconds.', { n: count(tracks[0].w, 'time'), when }),
      detail: top.artist ? words('by {artist}.', { artist: name(top.artist) }) : '',
      visual: bars(tracks.map(e => {
        const u = unpair(e.key);
        return { label: name(u.title), sub: u.artist ? name(u.artist) : undefined, value: e.w, display: count(e.w, 'play') };
      })),
      values: { top: tracks.map(e => ({ ...unpair(e.key), plays: e.w })) },
      stat: { label: 'plays of your top song', display: int(tracks[0].w), value: tracks[0].w, change: null },
    }));
  }

  // top album
  const withAlbum = where(music, i => store.album[i] >= 0);
  if (withAlbum.length) {
    const albumKey = i => pair(store.album[i], store.creator[i]);
    const [al] = topN(totalsBy(albumKey, withAlbum, dur, t), 1, trackName);
    const u = unpair(al.key);
    out.push(card({
      ...base, id: 'spotify.top-album', title: 'top album', big: name(u.title),
      caption: u.artist
        ? words('by {artist}, with {hours} of listening {when}.', { artist: name(u.artist), hours: hours(al.w), when })
        : words('{hours} of listening {when}.', { hours: hours(al.w), when }),
      values: { name: u.title, artist: u.artist, ms: al.w },
    }));
  }

  // the biggest day
  const perDay = dayTotals(t, music, z, dur);
  const big = busiestDay(perDay);
  out.push(card({
    ...base, id: 'spotify.peak-day', title: 'your biggest day', big: dayName(big.day),
    caption: words('{hours} of music on one {weekday}.', { hours: hours(big.w), weekday: longDayName(big.day).split(',')[0] }),
    detail: 'each square is a day. the darker it is, the more you listened.',
    visual: heatmap(z, S.y0, S.y1, perDay, big.day),
    values: { day: isoDay(big.day), ms: big.w },
  }));

  // the hour
  if (plays.length) {
    const bins = hourHistogram(t, plays, z);
    const h = peak(bins);
    out.push(card({
      ...base, id: 'spotify.clock', title: 'your hour', big: hourName(h),
      caption: words('is when you started the most songs {when}.', { when }),
      detail: words('plays over 30 seconds, by the time they started, in {tz} time.', { tz: zoneLabel(ctx.timeZone) }),
      visual: clock(bins, h),
      values: { bins, peak: h },
    }));

    // night owl
    const night = where(plays, i => z.hour(t[i]) < 5).length;
    const nightShare = share(night, plays.length);
    out.push(card({
      ...base, id: 'spotify.night', title: 'night owl', big: percent(nightShare),
      caption: night
        ? 'of your plays started between midnight and 5 am.'
        : 'of your plays started between midnight and 5 am. very well rested.',
      detail: night ? words('{n} after dark.', { n: count(night, 'song') }) : '',
      values: { night, plays: plays.length, share: nightShare },
    }));
  }

  // the longest session
  const ses = sessions(t, dur, music, SESSION_GAP);
  const long = longest(ses, s => s.end - s.start);
  if (long && long.count > 1) {
    out.push(card({
      ...base, id: 'spotify.session', title: 'longest session', big: duration(long.end - long.start),
      caption: words('on {day}, {n} with no break longer than 20 minutes.', { day: dayName(z.dayKey(long.start)), n: count(long.count, 'song') }),
      values: { start: long.start, end: long.end, count: long.count, ms: long.ms },
    }));
  }

  // discovery, only when the history reaches back before this year
  const firstListen = store.ofKind('listen', 0, S.lo);
  if (firstListen.length && t[firstListen[0]] < S.y0 - 30 * DAY) {
    const before = where(firstListen, i => dur[i] >= PLAY_MS);
    const d = discovery(store.creator, before, plays);
    if (d.seen) {
      out.push(card({
        ...base, id: 'spotify.discovery', title: 'new to you', big: percent(d.share),
        caption: words('of the {n} you played {when} were new to you.', { n: count(d.seen, 'artist'), when }),
        detail: words('{n} you had never played before.', { n: count(d.fresh, 'artist') }),
        values: { seen: d.seen, fresh: d.fresh, share: d.share },
      }));
    }
  }

  // loyalty
  if (artists.length) {
    const loyal = share(artists[0].w, ms);
    out.push(card({
      ...base, id: 'spotify.loyalty', title: 'loyalty', big: percent(loyal),
      caption: words('of your listening time went to {artist}.', { artist: name(str(artists[0].key)) }),
      values: { name: str(artists[0].key), ms: artists[0].w, share: loyal },
    }));
  }

  // skips
  const skipCol = store.column('skipped'), reasonCol = store.column('reasonEnd');
  const known = skipCol ? where(music, i => skipCol[i] !== 0).length : 0;
  let skipped = null;
  if (skipCol && known >= music.length / 2) {
    skipped = where(music, i => skipCol[i] === 2).length;
  } else if (reasonCol && where(music, i => reasonCol[i] >= 0).length >= music.length / 2) {
    const fwd = store.strings.map.get('fwdbtn');
    skipped = fwd === undefined ? 0 : where(music, i => reasonCol[i] === fwd).length;
  }
  if (skipped !== null) {
    const rate = share(skipped, music.length);
    out.push(card({
      ...base, id: 'spotify.skips', title: 'skips', big: percent(rate),
      caption: 'of the songs you started, you skipped.',
      detail: words('{s} out of {n}.', { s: count(skipped, 'skip'), n: count(music.length, 'start') }),
      values: { skipped, started: music.length, share: rate },
    }));
  }

  // on repeat
  const rep = maxPerDay(trackKey, t, plays, z, trackName);
  if (rep && rep.n >= 3) {
    const u = unpair(rep.key);
    out.push(card({
      ...base, id: 'spotify.repeat', title: 'on repeat', big: count(rep.n, 'time'),
      caption: words('you played {track} {n} on {day}. we are not judging.', { track: name(u.title), n: count(rep.n, 'time'), day: dayName(rep.day) }),
      detail: u.artist ? words('by {artist}.', { artist: name(u.artist) }) : '',
      values: { ...u, day: isoDay(rep.day), plays: rep.n },
    }));
  }

  // first and last
  if (plays.length) {
    const f = plays[0], l = plays[plays.length - 1];
    const who = i => ({ title: str(store.title[i]), artist: str(store.creator[i]), t: t[i] });
    out.push(card({
      ...base, id: 'spotify.first-last', title: 'first and last', big: name(str(store.title[f])),
      caption: words('your first song {when}, on {day}, by {artist}.', { when, day: dayName(z.dayKey(t[f])), artist: name(str(store.creator[f])) }),
      detail: words(S.unfinished ? 'the latest so far is {track} by {artist}, on {day}.' : 'the last was {track} by {artist}, on {day}.', { track: name(str(store.title[l])), artist: name(str(store.creator[l])), day: dayName(z.dayKey(t[l])) }),
      values: { first: who(f), last: who(l) },
    }));
  }

  // against last year
  if (delta !== null) {
    out.push(card({
      ...base, id: 'spotify.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('music than {last}: {now} against {then}.', { last: S.lastYear, now: hours(ms), then: hours(prevMs) }),
      values: { ms, prevMs, change: delta },
      stat: { label: 'change in listening', display: changeWords(delta), value: delta, change: delta },
    }));
  }

  // podcasts
  const pods = store.ofKind('podcast', S.lo, S.hi);
  const podMs = sum(dur, pods);
  if (podMs >= 10 * 60000) {
    const [show] = topN(totalsBy(store.creator, pods, dur, t), 1, str);
    out.push(card({
      ...base, id: 'spotify.podcasts', title: 'podcasts', big: hours(podMs),
      caption: show ? words('of podcasts {when}, most of it {show}.', { when, show: name(str(show.key)) }) : words('of podcasts {when}.', { when }),
      detail: words('{n}, kept apart from your music.', { n: count(pods.length, 'episode') }),
      values: { ms: podMs, episodes: pods.length, top: show ? { name: str(show.key), ms: show.w } : null },
    }));
  }

  return out;
}

export default {
  id: 'spotify',
  name: 'spotify',
  unit: 'plays',
  guide: 'spotify',
  match,
  detect,
  parse,
  cards,
};
