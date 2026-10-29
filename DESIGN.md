# yearbook: design

Your year, from your own data. Drop in the files you can already download from the services you use, and get a calm, shareable story of your year. It runs in the browser. Nothing is uploaded.

Status: design only. Nothing is built yet.
Last updated: 2026-10-29.
Owner: tuftle (tuftle@proton.me). Part of the Tuftle family (wren, nook, burrow). A sibling project, `drip`, shares its principles and some code ideas.
Working name: **yearbook**. Alternatives: keepsake, almanac. The owner decides before anything is built (section 17). Do not use the word "Wrapped" in the name, title or copy: it belongs to Spotify.

---

## 0. Start here (for the session that builds this)

Read this whole file before writing code. Then:

1. Work through the milestones in section 14, in order. Stop at the end of each one, run the tests, and report using the format in section 18. Wait for the owner to say "go" before the next milestone.
2. Never deploy, publish, post, buy anything or touch any repository except this one. The owner deploys.
3. Never ask for, accept or handle real personal exports. Use only the synthetic fixtures described in section 12. The owner tests with their own files on their own computer.
4. Commit as `tuftle <tuftle@proton.me>`. No co-author lines. Work on a branch called `build` and open a pull request to `main`. The owner merges.
5. House rules for all copy, code comments, commit messages and docs: lowercase and calm in the product, no em dashes, no buzzwords, no emojis. Plain words.
6. Runtime dependencies are limited to the two named in section 9 (a zip reader and a SQLite reader), vendored as files with exact versions and licences recorded. No framework, no bundler, no CDN.
7. Every claim about an export's file format in this document comes from memory and may be out of date. Treat each as a hypothesis. Write parsers that tolerate missing and renamed fields, and say clearly in the report where a format is unverified.
8. Budget: the owner has limited cloud credit. Keep milestones small, keep tests fast, do not run long idle jobs, and only start a browser for the runtime tests in milestones 6 and 8.

If this file and the owner disagree, the owner wins. If something here is wrong or unclear, say so in your report instead of guessing.

---

## 1. What it is

A single web page. The visitor drops in one or several files (zip archives or the files inside them) from services such as Spotify, Netflix, YouTube, ChatGPT and their own browser. yearbook recognises each one, reads it locally, and builds a deck of full-screen cards about the year: big numbers, top lists, small surprises, a few warm sentences. Each card can be saved as an image. A visitor can share only what they choose, and can hide names.

It is the shape people love in Spotify's yearly summary, applied to data the visitor already owns and made private by construction.

## 2. Why this and why now

- The yearly summary format is among the most shared things on the internet every December, and people want it for more than one service.
- Every large service already lets you download your data, and most people have never opened the file. It is theirs by right, and unreadable in practice.
- "Your data never leaves your computer" is a rare and checkable promise for a tool like this.
- Timing: the season is the first weeks of December. The data request step is slow (some exports take days or weeks), so a guide page that tells people to **request their data now** is itself the first piece of the launch (section 15).

## 3. Goals, non-goals, anti-goals

Goals
- A card deck worth sharing, made in under 15 seconds from dropping files.
- Genuinely local and checkable: the page cannot send data anywhere.
- Delight with restraint: calm, warm, a little funny, never creepy.
- Good enough that a stranger can follow the guide, get their file, and see their year without help.
- Each source works alone. Two or three sources make a richer final card.

Non-goals (not in version 1)
- Connecting to accounts, logging in to anything, using any service's API.
- Scraping anything.
- Comparing users, leaderboards, accounts, saving results on a server.
- Predictions or recommendations ("you should listen to...").
- Social media exports (Instagram, TikTok, X, Facebook): sensitive and varied. Later.
- A mobile app.

Anti-goals (a failure even if it works)
- Any network request that carries user data, by design or by accident.
- Showing something sensitive by default in a shareable card (titles of conversations, sites visited, searches).
- Pretending to know things the data does not say. State what the number means.
- Using the name, logo or look of Spotify's summary, or any service's logos.
- Dark patterns, sign-up, upsell, tracking.

## 4. The visitor's journey

1. **landing.** Headline: "your year, from your own data." Sub: "drop in the files you can download from spotify, netflix, youtube, chatgpt or your browser. yearbook turns them into a story you can keep. it happens in this page. nothing is uploaded." Big drop zone for files and zips. Under it: "try it with example data" (a built-in fake year) and "how do i get my files?" which leads to the guides (section 8). A line: "works offline. try it with wi-fi off." and "how do i know?" for the proof panel.
2. **what we found.** Each recognised source appears as a row: "spotify, 4 files, march 2019 to october 2026". Unrecognised files are listed with a kind explanation ("this does not look like an export from a service we know yet"). A year picker (default: the current calendar year, with a note if the year is not finished). A time zone picker (default: the browser's, because many exports are in UTC and "late night" depends on it). A button: "make my year".
3. **making it.** A calm progress view per source with real counts ("read 412,000 plays"). The page stays responsive because all work happens in a Web Worker.
4. **the deck.** Full-screen cards, one idea each, large serif numbers. Move with arrow keys, swipe, or the next button. Progress dots. A "pause on this card" feel: no autoplay. Each card has: **save image**, **hide names** (on by default for sensitive cards), **leave this one out**.
5. **the last card.** "your year in one page": the three or four best numbers across all sources, as a single shareable image.
6. **keep it.** Buttons: save all cards (a zip of images), copy as text, and "forget everything" (clears memory). Nothing is stored unless the visitor asks.

## 5. The sources in version 1

Priority order. For each source: how it is recognised, what is read, what the cards say. All field names below are from memory: verify against a real export if the owner supplies one (structure only), and tolerate drift.

### 5.1 Spotify (extended streaming history)

- **File:** a zip from Spotify's privacy page. The "extended streaming history" variant contains JSON files named like `Streaming_History_Audio_2019-2021_0.json` (a list of plays). The smaller "account data" variant has `StreamingHistory0.json` with `endTime`, `artistName`, `trackName`, `msPlayed`. Support both.
- **Fields (extended, from memory):** `ts` (end time, UTC), `ms_played`, `master_metadata_track_name`, `master_metadata_album_artist_name`, `master_metadata_album_album_name`, `spotify_track_uri`, `reason_start`, `reason_end`, `skipped`, `shuffle`, `platform`, `conn_country`. Podcast and video items exist with other fields; keep them separate.
- **Count a play** only if `ms_played` is at least 30 000 (30 seconds). Say so on the card ("plays over 30 seconds").
- **Cards:** total hours and the same time as something relatable ("that is 64 days awake and listening" only if true and kind); top 5 artists (hours and share); top 5 tracks (plays); top album; your day and hour of peak listening; a 24 hour clock graphic; night owl share (plays between 0:00 and 5:00); longest session (a session ends after a 20 minute gap); discovery (artists first heard this year, as a share of all artists); loyalty (share of time in your top artist); skip rate; first and last song of the year; most repeated track in a single day; change from the previous year if the data has one.

### 5.2 Netflix

- **File:** `ViewingActivity.csv` inside the data request archive (a folder `CONTENT_INTERACTION` in the zip). Columns from memory: Profile Name, Start Time, Duration, Attributes, Title, Supplemental Video Type, Device Type, Bookmark, Latest Bookmark, Country.
- **Details:** Start Time is most likely UTC. Duration is `HH:MM:SS`. Titles look like `Show: Season 2: Episode name`; split on `: ` into show, season, episode when it fits, otherwise treat as a film. Rows with Supplemental Video Type set (trailers, previews) are excluded. Ignore views under 2 minutes.
- **Cards:** hours watched; top 5 shows by hours; episodes in your busiest binge day; started versus finished (a show is "left behind" if it has 1 to 2 episodes and nothing for 60 days: say "tried" not "abandoned"); first and last thing you watched; late night share; devices; each profile separately if more than one; rewatches.

### 5.3 YouTube (Google Takeout)

- **File:** from Google Takeout, YouTube history. Usually `watch-history.json` (a list of objects with `title` beginning "Watched ", `titleUrl`, `subtitles` holding the channel name and url, `time` in ISO UTC) or `watch-history.html`. Prefer JSON, support HTML as a fallback with a small tolerant parser.
- **Cards:** videos watched; top 5 channels; peak hour; a rabbit hole (the longest run of videos with gaps under 10 minutes); share that were Shorts (url contains `/shorts/`); your busiest day; new channels discovered.
- **Note:** history does not include watch duration. Never claim hours watched. Say "videos".

### 5.4 ChatGPT and Claude exports ("your year with ai")

- **File:** the data export from the account settings, a zip containing `conversations.json` (a list of conversations; each has a title, create and update times and a `mapping` of message nodes whose `author.role` is user, assistant or tool, with `content.parts`). Claude's export is a similar JSON list. Detect each by shape.
- **Cards:** conversations and messages; words you wrote and words you got back; busiest day and hour; your longest conversation; how many contained code (fenced blocks); a few most-used words from your own messages (local counting with a stop-word list, shown only if the visitor opts in); the number of times you said please or thank you (a small joke, optional); the first conversation of the year; the model mix if present.
- **Privacy:** titles and topic words are sensitive. They are hidden in shareable images by default and shown only on screen to the visitor.

### 5.5 Your browser

- **Files:** Firefox and Wren: a copy of `places.sqlite`. Chrome, Edge, Brave: a copy of the `History` file (SQLite, no extension). Both are read with a SQLite engine in the browser. (Wren already has a "year in review" built from local history; this is the portable, shareable version.)
- **Cards:** top sites; hours online (estimated: sum of gaps between visits that are under 5 minutes, capped, and labelled as an estimate); busiest weekday; sites first visited this year; your longest rabbit hole; the late-night share; first and last site of the year.
- **Privacy:** site names are sensitive. Hide by default in images. No search queries are read unless the visitor opts in, and even then they stay on screen only.

### 5.6 Later (after launch)

Letterboxd (`diary.csv`, `ratings.csv`), Goodreads (`goodreads_library_export.csv`), Strava activities, Amazon orders, Apple Music, Steam. Each is a source plugin (section 8) and should take a day.

## 6. The data model

Every source turns its files into a list of normalised events. The card logic works only on events, so analysis code is shared.

```js
/** @typedef {Object} Event
 *  @property {number} t        start time, ms since epoch, UTC
 *  @property {number} [dur]    length in ms, if known
 *  @property {string} kind     'listen' | 'watch' | 'chat' | 'visit' | ...
 *  @property {string} [title]  track, episode, video, page
 *  @property {string} [creator] artist, channel, site
 *  @property {string} [album]  album or show
 *  @property {Object} [meta]   small extra values: skipped, device, role, words, code
 */
```

Storage: parallel typed arrays for time and duration, and interned strings for names, so a million events fit comfortably in memory.

Shared analysers (pure functions, tested once): top N with tie rules, 24 hour and weekday histograms in a chosen time zone, sessions by gap length, streaks, first and last, discovery (first seen this year versus before), diversity, share of the whole, change against the previous year.

## 7. The cards

A card is a plain object produced by a pure function, so it can be tested without a browser.

```js
{ id, source, title, big, caption, detail, visual, sensitive, share: { text } }
```

- `big`: the one number or name that carries the card, written large.
- `caption`: what it means, in one plain sentence. Always say what was counted ("plays over 30 seconds").
- `visual`: an instruction for the renderer (bar list, 24 hour clock, calendar heatmap, line), not a picture. The renderer draws it with SVG and canvas.
- `sensitive`: true if the card shows names or titles. Sensitive cards are blurred or reduced to numbers in saved images unless the visitor turns names on.
- Text comes from templates with a few variants chosen by a seeded hash of the data, so the same data always gives the same words. No language model, no randomness at read time.
- Tone: warm and a little wry, never judgemental ("you listened to one song 212 times. we are not judging.") One joke per card at most. Never guess feelings or health. Never infer anything private beyond what the numbers say.

The final card ("your year in one page") picks the best three or four numbers across sources by a fixed ranking (largest relative surprise, then size) and composes them.

## 8. Architecture and files

Static site, vanilla ES modules. All parsing and analysis run in a Web Worker. Core logic has no DOM and runs in Node tests.

```
yearbook/
  DESIGN.md
  README.md
  package.json                type: module; scripts: test, privacy-scan, make-fixtures, build-single
  vercel.json                 headers only
  site/                       the only thing deployed
    index.html
    guides/index.html         "how do i get my files?" (static)
    assets/style.css  assets/logo.svg
    vendor/                   fflate (zip), sql.js (sqlite wasm): files + VERSIONS.md + licences
    src/
      app.js                  UI wiring
      worker.js               the pipeline
      ui/                     drop.js found.js progress.js deck.js proof.js share.js
      core/
        types.js  files.js  zip.js  jsonstream.js  csv.js  sqlite.js
        timezone.js  analysers.js  templates.js  cards.js  final.js  redact.js
      sources/
        index.js              registry
        spotify.js  netflix.js  youtube.js  chatgpt.js  claude.js  browser.js
      render/
        card.js               draws a card to canvas (png export)
        charts.js             SVG helpers: bars, clock, heatmap, line
      data/guides.json        how to request each export (steps, where, how long)
      data/stopwords.json
    sample/                   built-in fake year (generated, not real)
  tests/
    unit/  gen/  fixtures/  privacy/  visual/
  scripts/
    make-fixtures.mjs  privacy-scan.mjs  build-single.mjs
  .github/ISSUE_TEMPLATE/     format-problem.md  (structure only, never data)
```

### 8.1 A source plugin

```js
export default {
  id: 'spotify',
  name: 'spotify',
  detect(fileInfos),            // -> { score 0..1, files: [...] }  by name and by sniffing the first kilobytes
  async parse(files, onProgress), // -> { events, notes: [...] }
  cards(events, ctx),            // -> Card[]  ctx has year, timeZone, previous year
  guide: 'spotify',              // key into guides.json
};
```

`detect` must be tolerant: match on file name patterns and on content shape, and return a confidence. A file that no source claims gets a friendly "we do not know this one yet" and a link to the format-problem template (which asks for structure only).

### 8.2 Files and zips

- Accept any mix of loose files and zips, several at once. Overlapping exports (two zips covering the same months) must not double count: deduplicate by a key of time, title and creator.
- Read zips with `fflate`'s streaming unzip and a filter, so only files a source asks for are decompressed. Never load a whole archive into memory. A zip may contain gigabytes of unrelated data (a full Google Takeout), so the filter is essential.
- Large JSON lists (hundreds of megabytes) are read by a small streaming reader that splits the top-level array into items and parses one at a time. Plain `JSON.parse` is fine below about 80 MB.
- SQLite (browser history) uses `sql.js`, loaded from `vendor/`. Open a copy of the file in memory. If the file is locked, tell the visitor how to copy it first (guide).
- Time zones: events are UTC. Convert for display with `Intl.DateTimeFormat` in the chosen zone. Daylight saving must be right (tests).

### 8.3 Performance targets

Parse and analyse 1 000 000 events in under 8 seconds on a mid-range laptop, never blocking the main thread for more than 50 ms. Progress is reported honestly with counts.

## 9. Dependencies (the only two)

- **fflate**: zip reading and writing, MIT licence, small. Vendored file, exact version recorded in `vendor/VERSIONS.md` with a checksum and licence text.
- **sql.js**: SQLite compiled to WebAssembly, MIT licence, about 1 MB. Vendored, same recording. A test checks that the vendored files match the recorded checksums.

Everything else is hand written: csv, dates, charts, templates, rendering. No chart library.

## 10. Design

Follows the Tuftle look. Reuse these tokens.

| token | light | dark | use |
|---|---|---|---|
| `--bg` | `#f4efe6` | `#211c17` | page |
| `--card` | `#fbf8f2` | `#2a231c` | cards, panels |
| `--text` | `#3b2f25` | `#e6dccd` | body |
| `--soft` | `#8a7b6b` | `#9a8b7a` | secondary text |
| `--link` | `#8a4b2a` | `#d9a073` | accents, buttons |
| `--line` | `#ddd2c1` | `#3a3128` | borders |
| `--glow` | `rgba(224,168,112,.3)` | `rgba(217,160,115,.14)` | highlights |
| `--leaf` | `#7a9a5a` | `#7a9a5a` | small green accent |

- Georgia serif for the big numbers and names (fallbacks `"Iowan Old Style", "Palatino Linotype", Palatino, serif`). System sans for small text. No web fonts. Dark mode follows `prefers-color-scheme`; add `<meta name="darkreader-lock">`.
- Each source has a quiet accent made from the same palette (shifts of warmth and a leaf tint), not the service's brand colours. No service logos.
- Cards are full-screen on a phone and centred 4:5 panels on a desktop. Plenty of space. One big element, one sentence, one small graphic.
- Motion: a gentle count-up and a soft slide between cards. Nothing autoplays. Respect `prefers-reduced-motion` (no animation, instant changes).
- Saved images: 1080 by 1350 (4:5) by default, with an option for 1080 by 1920 (story). Footer line: "made with yearbook. it ran in my browser and nothing was uploaded."
- Accessibility: keyboard navigation through the deck, visible focus, contrast at least 4.5:1, every graphic has a text equivalent, screen readers get the card's sentence, labels on all controls, works at 360 px.

## 11. Privacy and security design

This is the product. Each item is a requirement with a test.

1. **Content-Security-Policy**, header plus meta:
   `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
   No inline scripts or styles. `connect-src 'none'` means even a bug cannot send data. (`'wasm-unsafe-eval'` is needed only for sql.js.)
2. `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` denying everything, `Cross-Origin-Opener-Policy: same-origin`.
3. No analytics, no third-party scripts or fonts, no error reporters.
4. No storage by default. Nothing in `localStorage`, cookies or IndexedDB unless the visitor ticks "keep my results on this device", which stores only the computed cards, never the raw events.
5. **Proof panel** ("how do i know?"): the policy in plain words, a live counter of requests since files were dropped (`PerformanceObserver` plus wrapped `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` that throw), and steps to verify (wi-fi off, network tab, save the page and run it offline). Be honest: the page itself was downloaded once.
6. **Single file build** (`build-single.mjs`) so the whole app, including the vendored libraries, can be saved and opened offline.
7. **Sensitive cards** (titles, sites, topics) are blurred or reduced to numbers in saved images by default.
8. **Format problem reports** never include data. A helper copies the *shape* of a file (field names, types, counts of items, never values) for pasting into an issue.
9. Supply chain: two vendored libraries with recorded checksums; nothing fetched at build or run time.

## 12. Testing

The agent never sees real exports. Everything uses synthetic data from deterministic generators.

### 12.1 Fixture generators (`tests/gen/`)

For each source, a seeded generator writes an export in the shape described in section 5 **and** a `truth.json` with the answers the cards must produce (totals, top lists, peaks, sessions). Include:

- multi year histories, multiple profiles (Netflix), podcast items mixed in (Spotify)
- time zone traps: plays near midnight, daylight saving changes, UTC against local
- duplicates across overlapping zips
- tolerance cases: missing fields, extra fields, renamed columns (alias lists), BOM, CRLF, empty values
- scale cases: a 2 000 000 event Spotify history and a 300 MB JSON, generated on the fly in the test and not committed
- wrong-file cases: a CSV that is not Netflix, an empty zip, a zip inside a zip

### 12.2 What must pass

- **Unit tests** for every analyser and parser, with the truth files as expected values.
- **Card tests:** every card function returns the right numbers for the generated data and never returns text that breaks the house rules (a checker for em dashes, emojis, banned words, and "hours watched" on YouTube).
- **Property tests:** shuffling event order changes nothing; shifting the time zone changes hours-of-day stats by the right amount and nothing else; loading the same file twice changes nothing; splitting one export into two overlapping zips equals the single export.
- **Format doctor tests:** each source, given a wrong or damaged file, gives a plain, specific message.
- **Privacy tests:** the same three as `drip` (static scan, runtime zero requests after load while processing a fixture, header equals meta policy). Plus: sensitive cards are blurred in the exported image (compare pixels in a known region).
- **Visual tests:** render each card for a fixed fixture in headless Chrome and compare with a stored image within a small tolerance, at desktop and phone widths, light and dark.
- **Accessibility:** axe in the runtime test and a manual keyboard pass of the deck.
- **Performance:** the 1 000 000 event budget in 8.3.
- **Vendored files:** checksums match `vendor/VERSIONS.md`.

### 12.3 Real files (owner only)

The owner runs it on their own exports and reports problems as shapes, not data. Real-world drift becomes new fixtures.

## 13. Deployment

- A Vercel static project named `yearbook`, serving `site/`. `vercel.json` carries the headers in section 11. No functions, no variables, no secrets.
- Domain later: the owner plans tuftle.com. Until then a vercel.app address or `tuftle.vercel.app/yearbook`.
- GitHub repository `Tuftle/yearbook`, public. Licence is the owner's choice (the other Tuftle projects use MPL 2.0). The guides data may be CC0.
- The agent prepares everything and stops. The owner runs `vercel deploy --prod --yes`.

## 14. Milestones and acceptance

Each milestone ends with tests passing and a report.

- **M0 scaffold.** Layout, package.json, `node --test`, the house-rule linter (fails on em dashes, emojis, buzzwords, and the word "wrapped" in `site/` copy), vendored libraries recorded with checksums. Accept: tests and linter run; checksum test passes.
- **M1 guides page.** `guides/index.html` and `guides.json`: for each source, plain steps to request the export, where to click, how long it takes, how to find the right file, and a warning that some exports take days or weeks. Static, no JavaScript needed. Accept: owner review. **This can ship first, in mid November,** as the "request your data now" hook (section 15).
- **M2 reading files.** files, zip (streaming and filtered), jsonstream, csv, sqlite, timezone, source detection and the "what we found" model, dedupe. Accept: all generated archives are read correctly, memory stays bounded on the large fixtures, wrong files get kind messages.
- **M3 first sources.** Spotify, Netflix, YouTube parsers and analysers and cards. Accept: truth files match exactly.
- **M4 more sources.** ChatGPT, Claude, browser history (Firefox and Chromium formats). Accept: truth files match; sensitive flags correct.
- **M5 the deck.** UI: landing, found, progress, deck, final card, image export (4:5 and story), save all as zip, copy as text, hide names, leave out, forget everything. Dark mode, phone width, keyboard, reduced motion. Accept: walkthrough with screenshots from headless Chrome.
- **M6 trust.** CSP header and meta, proof panel, single file build, privacy scan, runtime zero-request test. Accept: privacy tests pass; the single file works from `file://`.
- **M7 hardening.** Property tests, performance budget, accessibility, visual tests, error states, a built-in example year, copy review. Accept: all targets met.
- **M8 launch kit.** README in the Tuftle style, screenshots, short demo script, FAQ, issue templates, a technical write-up. Accept: owner review. The owner deploys.

## 15. Launch plan

- The first public piece is the **guides page** (M1), in mid November, because exports take time: "request your data now, so it is ready in december." It gives the launch an audience that already has files.
- The app is ready by the last week of November. Launch in the first days of December, around when the big services release their own yearly summaries. Check the actual dates for 2026 then; do not assume.
- **X:** a 15 second screen recording of dropping a zip and the cards appearing, then the final card. One line: "my year, from my own data. it never left my laptop." The visitor posts their own card, with names hidden by default.
- **Hacker News:** "Show HN: yearbook, your year from your own Spotify, Netflix, YouTube and ChatGPT exports, in your browser". The link goes to the working page and an example year, no sign-up. First comment: how streaming zips and huge JSON are read without loading them, the time zone traps, and how to verify the privacy claim.
- Honest odds: nobody can promise a top-10 spot. This has a familiar format, a personal result, a privacy claim anyone can check, and a real season. Execution quality and timing decide.

## 16. Risks

- **Format drift.** Services change their exports. Mitigations: tolerant parsers, alias lists, the format doctor, shape-only issue reports, and keeping each source a small plugin.
- **Slow exports.** Mitigation: the early guides page and clear time estimates.
- **Trademark and legal.** Do not use "Wrapped" or any service's logos or look. Service names appear only as plain nominative text. It is the visitor's own data; say plainly that yearbook is not affiliated with any service.
- **Sensitive content.** Chat titles, browsing and search are private. Defaults hide them in images and the page never uploads anything.
- **Large inputs.** Full Takeout archives are huge. Streaming and filtered unzip are required, and failure must be graceful ("this file is too large for your browser's memory; here is how to export only the part we need").
- **Calendar.** The window is short. Ship the guides first.

## 17. Decisions for the owner before building

1. Final name (yearbook, keepsake, almanac, other) and whether a domain is wanted now.
2. Which sources to cut or add for version 1 (suggested: Spotify, Netflix, YouTube, ChatGPT and Claude, browser history).
3. Repo and licence (suggested: public `Tuftle/yearbook`, MPL 2.0).
4. Whether image footers should say "made with yearbook" (suggested: yes, quietly).
5. Whether the owner can provide the shape (not the data) of one real export per source for verification.
6. The launch date, once the 2026 season dates are known.

## 18. How the building session reports

After each milestone, send:
- what is done, in plain words
- test counts, and for sources the match against the truth files
- anything uncertain or guessed, especially export formats
- what you will do next and what you need from the owner
- cost note: roughly how much of the budget this milestone used, if known

## 19. Shared with drip

Both projects are static, local-only and tested the same way. Shared ideas, to copy first and extract later into one small toolkit if it proves worth it: the csv reader, the privacy scan and runtime zero-request test, the proof panel, the single-file build, the house-rule linter, the share-card canvas renderer, the palette. Keep them in separate repositories for now so either can ship alone.

## 20. House rules from the Tuftle handoff (for consistency)

- Copy is lowercase and calm. No em dashes, buzzwords or emojis in anything written for people.
- The cream and brown palette is deliberate. Do not "fix" it.
- Git author is `tuftle <tuftle@proton.me>`. No Claude co-author lines.
- Keep secrets out of chat and out of the repo.
- Siblings for reference: wren (browser), nook (search), burrow (password manager). burrow's README (https://github.com/Tuftle/burrow) is the style model for READMEs: centred icon, badges, short link row, overview table, install section, privacy table, layout tree, licence, small footer. The sibling repositories are public at https://github.com/Tuftle.
