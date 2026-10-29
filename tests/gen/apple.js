// a made-up apple music play activity file, from the same plays as the
// spotify fixture, and its truth: the spotify reference, renamed.

import { writeZip } from './zipwriter.js';
import { makePlays, spotifyTruth, SPOTIFY } from './spotify.js';

export function playActivityCsv(plays) {
  const head = ['Apple Id Number', 'Album Name', 'Artist Name', 'Client IP Address', 'Content Specific Type', 'End Reason Type', 'Event End Timestamp', 'Event Start Timestamp', 'Event Type', 'Media Duration In Milliseconds', 'Media Type', 'Play Duration Milliseconds', 'Song Name', 'UTC Offset In Seconds'];
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = plays.map(p => ['1', p.album, p.artist, '192.0.2.1', 'Song', p.skipped ? 'TRACK_SKIPPED_FORWARDS' : 'NATURAL_END_OF_TRACK', new Date(p.t + p.ms).toISOString(), new Date(p.t).toISOString(), 'PLAY_END', p.ms, 'AUDIO', p.ms, p.title, 3600].map(q).join(','));
  // a stopped stream with no time played, which is not a play
  rows.push(['1', 'x', 'y', '192.0.2.1', 'Song', 'FAILED_TO_LOAD', '', new Date(Date.UTC(2025, 4, 1)).toISOString(), 'PLAY_END', 200000, 'AUDIO', 0, 'Nothing', 0].join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function appleFixture() {
  const plays = makePlays({ seed: 'apple' }).filter(p => p.kind === 'listen');
  const truth = {};
  for (const y of SPOTIFY.years) {
    truth[y] = Object.fromEntries(Object.entries(spotifyTruth(plays, y)).map(([k, v]) => [k.replace('spotify.', 'apple.'), v]));
  }
  const zip = writeZip([{ path: 'Apple Media Services information/Apple Music Activity/Apple Music Play Activity.csv', data: playActivityCsv(plays) }]);
  return { items: plays, zip, truth, zone: SPOTIFY.zone, now: SPOTIFY.now };
}
