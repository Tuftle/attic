// writes the small generated exports and their truth files to
// tests/fixtures/<source>/. everything is made up and the same every run.
// a test checks that the committed files match what this writes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export const ROOT = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));

/** every fixture file, by path under tests/fixtures */
export async function fixtures() {
  const { spotifyFixture } = await import('../tests/gen/spotify.js');
  const { netflixFixture } = await import('../tests/gen/netflix.js');
  const { youtubeFixture } = await import('../tests/gen/youtube.js');
  const { chatgptFixture, claudeFixture } = await import('../tests/gen/chat.js');
  const { browserFixture } = await import('../tests/gen/browser.js');
  const out = {};
  const add = (dir, name, fx) => {
    out[`${dir}/${name}`] = fx.zip;
    out[`${dir}/truth.json`] = JSON.stringify({ zone: fx.zone, now: new Date(fx.now).toISOString(), years: fx.truth }, null, 1) + '\n';
  };
  add('spotify', 'my_spotify_data.zip', spotifyFixture());
  add('netflix', 'netflix-report.zip', netflixFixture());
  add('youtube', 'takeout-youtube.zip', youtubeFixture());
  add('chatgpt', 'chatgpt-export.zip', chatgptFixture());
  add('claude', 'claude-export.zip', claudeFixture());
  add('browser', 'browser-history.zip', await browserFixture());
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, data] of Object.entries(await fixtures())) {
    mkdirSync(dirname(ROOT + path), { recursive: true });
    writeFileSync(ROOT + path, data);
    console.log('wrote', 'tests/fixtures/' + path, typeof data === 'string' ? data.length : data.byteLength, 'bytes');
  }
}
