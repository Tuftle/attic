// builds site/guides/index.html from site/src/data/guides.json.
// the page is plain html: no javascript, nothing to load but the stylesheet.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { META_CSP } from './policy.mjs';

export const DATA = fileURLToPath(new URL('../site/src/data/guides.json', import.meta.url));
export const OUT = fileURLToPath(new URL('../site/guides/index.html', import.meta.url));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// text in backticks becomes code, everything else is escaped
export function inline(text) {
  return String(text).split('`').map((part, i) => (i % 2 ? `<code>${esc(part)}</code>` : esc(part))).join('');
}

function guide(g) {
  const where = g.where.url
    ? `<a href="${esc(g.where.url)}" rel="noreferrer">${inline(g.where.text)}</a>`
    : inline(g.where.text);
  const tips = g.tips.length
    ? `\n      <ul class="tips">\n${g.tips.map(t => `        <li>${inline(t)}</li>`).join('\n')}\n      </ul>`
    : '';
  const checked = g.checked ? `\n      <p class="checked">steps last checked on ${esc(g.checked)}.</p>` : '';
  return `    <section class="guide" id="${esc(g.id)}" aria-labelledby="${esc(g.id)}-title">
      <h2 id="${esc(g.id)}-title">${esc(g.name)}</h2>
      <dl>
        <dt>where</dt><dd>${where}</dd>
        <dt>how long</dt><dd>${inline(g.wait)}</dd>
        <dt>the file</dt><dd>${inline(g.file)}</dd>
      </dl>
      <ol>
${g.steps.map(s => `        <li>${inline(s)}</li>`).join('\n')}
      </ol>${tips}${checked}
    </section>`;
}

export function render(data) {
  const toc = data.guides.map(g => `      <li><a href="#${esc(g.id)}">${esc(g.name)}</a></li>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${META_CSP}">
  <meta name="referrer" content="no-referrer">
  <meta name="darkreader-lock">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="how to download your own data from spotify, netflix, youtube, chatgpt, claude and your browser, so attic can turn it into your year.">
  <title>attic: how do i get my files?</title>
  <link rel="icon" href="../assets/logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
  <a class="skip" href="#main">skip to the guides</a>
  <div class="page">
  <header>
    <a class="home" href="../"><img src="../assets/logo.svg" alt="" width="28" height="28">attic</a>
  </header>
  <main id="main">
    <h1>how do i get my files?</h1>
    <p class="lead">every service on this page lets you download your own data. you ask for it, they email you a link, and you drop the file into attic. it stays on your computer.</p>
    <p class="note"><strong>request your data now.</strong> some exports take days or even weeks to arrive, so ask today and it will be ready when you want it.</p>
    <nav aria-label="services">
    <ul class="toc">
${toc}
    </ul>
    </nav>
${data.guides.map(guide).join('\n')}
  </main>
  <footer class="foot">
    <p>attic is not affiliated with any of these services. their names are used only to say which file is which.</p>
    <p>services change their pages from time to time. if a step here no longer matches, the file you need is usually still there under a new name.</p>
  </footer>
  </div>
</body>
</html>
`;
}

export function unchecked(data) {
  return data.guides.filter(g => !g.checked).map(g => g.id);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  writeFileSync(OUT, render(data));
  console.log('wrote', OUT);
  const open = unchecked(data);
  if (open.length) console.warn(`note: steps not yet checked against the real pages: ${open.join(', ')}`);
}
