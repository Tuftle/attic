# faq

**does my data really stay on my computer?**
yes. the page is not allowed to make network requests at all (its policy says `connect-src 'none'`), and the network functions are switched off as well. you can check: open "how do i know?" for a live count of requests, watch your browser's network tab, or save the page and use it with wi-fi off. the page itself is downloaded once, like any page.

**why does my export take so long to arrive?**
that is the service, not attic. spotify's extended history can take up to 30 days, netflix up to 30. google takeout and the ai exports are usually quicker. the [guides](../site/guides/index.html) say how long each one takes, so ask early.

**which file do i drop?**
the whole zip is fine. attic opens only the files it needs and ignores the rest, even in a large takeout.

**why does youtube say videos and not hours?**
the watch history lists what you started and when, never for how long. attic will not guess.

**why are names hidden in my saved images?**
so you can share a card without sharing what you listened to, watched, asked or visited. turn names on for a card if you want them in its image. on your screen you always see them.

**what about my conversation titles and words?**
titles are hidden in saved images by default. the card with your most used words is not shown at all until you ask for it, and even then it stays on your screen unless you choose to save it.

**does attic read my searches?**
no. for browser history, attic reads only site names and the times of visits. page titles, full addresses and searches are never read.

**the time of day looks wrong.**
exports are in utc. check the time zone picker on the "what we found" page; it starts with your browser's zone, but if you spent the year somewhere else, pick that.

**it says it does not know my file.**
services change their exports. on the "what we found" page, press "copy the shape of this file" and paste it into a [format problem report](../.github/ISSUE_TEMPLATE/format-problem.md). the shape has field names, types and counts, never values.

**two exports cover the same months. is anything counted twice?**
no. events are sorted and exact repeats dropped, so overlapping exports and the same file dropped twice count everything once.

**can i keep my year?**
save the images, copy it as text, or tick "keep my results on this device", which stores only the finished cards in this browser. "forget everything" removes all of it.

**is attic affiliated with spotify, netflix or the others?**
no. their names are used only to say which file is which.
