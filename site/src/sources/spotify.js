// spotify: the extended streaming history (Streaming_History_Audio_*.json)
// and the smaller account data (StreamingHistory_music_*.json). field names
// are from memory and may drift, so every field has a list of aliases.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { int } from '../core/templates.js';
import { field, parseUtc, progress } from './common.js';
import { musicCards } from './music.js';

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

export default {
  id: 'spotify',
  name: 'spotify',
  unit: 'plays',
  guide: 'spotify',
  match,
  detect,
  parse,
  cards: (r, ctx) => musicCards(r, ctx, { id: 'spotify', name: 'spotify' }),
};
