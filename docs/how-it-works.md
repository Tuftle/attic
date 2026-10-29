# how attic works

attic is one static page. everything it does with your files happens in that page, in a worker, and nothing is sent anywhere. this note explains the parts that took some care: reading big exports without loading them, getting time zones right, and making the privacy claim something you can check.

## reading a zip without opening all of it

a google takeout can be tens of gigabytes, mostly photos. attic needs one file from it.

a zip keeps an index of every file at its end, the central directory. attic reads only the last few kilobytes of the archive to find that index, then reads the index itself. each entry says where its data starts and how large it is, so attic can slice exactly that range out of the file (`Blob.slice`) and inflate it with fflate's streaming `Inflate`. the photos are never read, let alone decompressed. zip64 archives, data descriptors and archives with something stuck in front of them are all handled, and every file read in full is checked against its crc32.

fflate also has a streaming `Unzip` that reads an archive front to back. attic does not use it: it keeps the compressed bytes of every file it skips, which would hold the whole archive in memory. if a download was cut off and the index is missing, attic walks the local headers from the start instead and keeps every file that arrived complete.

zips inside zips are opened too, up to a size limit, since that one has to be read into memory.

## reading a huge json list

a long spotify history is hundreds of megabytes of one json list. `JSON.parse` on all of it would need the whole text in memory, several times over.

attic reads the bytes as they stream in and finds where each item of the top level list starts and ends. this works on bytes, not characters: every character that matters to json structure (brackets, braces, quotes, commas, backslashes) is plain ascii, and in utf-8 no byte of a longer character is ever below 0x80, so a byte scan never mistakes part of a name for structure. items that sit entirely inside one chunk are parsed together as one small list; an item that spans two chunks is stitched together and parsed on its own.

in the scale test, a 300 mb list is read with a peak of a few megabytes. inside a deflated zip the peak is under 100 mb.

## a million events

every source turns its files into events: a time, a length if known, a kind, and up to three names. the store keeps them in typed arrays (one `Float64Array` for times, one for lengths, `Int32Array`s for names) and keeps each distinct name once. after reading, events are sorted by time and exact repeats are dropped, which is what makes two overlapping exports count every play once.

on this project's test machine, a million spotify plays are read and turned into cards in about 5.3 seconds in node and about 7.3 seconds in the browser's worker. the page itself never blocks for more than 50 ms.

## time zones

exports are in utc. "late night" and "your busiest day" are not.

attic converts every time to the time zone you pick, which defaults to your browser's. asking `Intl` for each of a million events is slow, so the utc offset is worked out once per 15 minute stretch and remembered. every modern time zone offset, and every daylight saving change, falls on a multiple of 15 minutes (yes, including lord howe island's half hour shift and nepal's 5:45), so the shortcut is exact. the tests check it against `Intl` at thousands of random times and around every change of 2026, in eight zones.

the traps the tests cover: a play at 23:30 utc that belongs to the next morning in tokyo, the hour that happens twice when clocks go back, the hour that never happens when they go forward, and the edges of the year in each zone.

## the cards

a card is a plain object made by a pure function from the events. its words come from a few templates per card, chosen by a hash of the data, so the same data always gives the same words. no language model is involved.

every card is built twice from the same templates: once as shown, and once with each name from the data replaced by a mark. hiding names in a saved image swaps one for the other. it never has to search the text for names, so a band called "you" or "the" cannot slip through or break a sentence.

the numbers are checked against truth files. seeded generators write made-up exports in each service's format, along with the answers, worked out by deliberately plain reference code that shares nothing with the app.

## checking the privacy claim

- the page's policy says `connect-src 'none'`, so the browser itself refuses any request the page or its worker might try, even by mistake. the same policy is in the header and in a meta tag in every page, and a test checks they match.
- `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` are replaced so they throw, in the page and in the worker.
- the proof panel ("how do i know?") counts every request since you dropped your files, from the browser's own record. it should say zero.
- the runtime test drops every kind of export into the page in chromium, makes the deck, saves images and a zip, copies the text, and checks that not one request was made.
- the static scan fails the build if attic's own code ever calls a network function, writes markup from strings, runs text as code, or stores anything outside "keep my results on this device".
- `npm run build-single` writes the whole app into one html file. open it from your disk with wi-fi off and it works the same.

one honest caveat: the page itself is downloaded once, like any page. after that, nothing leaves.

## what is written from memory

every export format here was written from memory and may have drifted. each parser looks for fields by a list of names, and an unknown file gets a plain message and a button that copies its shape (field names and counts, never values) for a format report. see [the faq](faq.md).
