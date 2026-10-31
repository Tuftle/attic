// contrast of the palette as attic uses it: at least 4.5 to 1 for text,
// 3 to 1 for large text and graphics. the palette itself is deliberate and
// stays as it is; where a token is too light for small text, it is not used
// for small text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../site/assets/style.css', import.meta.url), 'utf8');
const block = start => {
  const i = css.indexOf(start);
  return css.slice(i, css.indexOf('}', i));
};
const tokens = text => Object.fromEntries([...text.matchAll(/--([a-z]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
const light = tokens(block(':root {'));
const dark = { ...light, ...tokens(block('@media (prefers-color-scheme: dark) {\n  :root {')) };
const accents = scheme => {
  const at = scheme === 'dark' ? css.indexOf('.src-spotify', css.indexOf('@media (prefers-color-scheme: dark) {\n  .src-spotify')) : css.indexOf('.src-spotify');
  return Object.fromEntries([...css.slice(at, css.indexOf('}', css.indexOf('.src-attic', at)) + 1).matchAll(/\.src-([a-z]+) \{ --accent: (#[0-9a-f]{6}); \}/g)].map(m => [m[1], m[2]]));
};

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (fg, bg, alpha) => fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));

for (const [scheme, t] of [['light', light], ['dark', dark]]) {
  test(`${scheme}: text and links pass 4.5 to 1`, () => {
    for (const [fg, bg, label] of [
      [t.text, t.bg, 'text on the page'], [t.text, t.card, 'text on a card'],
      [t.link, t.bg, 'links on the page'], [t.link, t.card, 'links on a card'],
      [t.bg, t.link, 'the main button'],
    ]) assert.ok(ratio(rgb(fg), rgb(bg)) >= 4.5, `${label}: ${ratio(rgb(fg), rgb(bg)).toFixed(2)}`);
    // quieter text is the text colour at 82% and 78%, never the soft token
    for (const alpha of [0.82, 0.78]) {
      const c = blend(rgb(t.text), rgb(t.card), alpha);
      assert.ok(ratio(c, rgb(t.card)) >= 4.5, `text at ${alpha}: ${ratio(c, rgb(t.card)).toFixed(2)}`);
    }
  });
  test(`${scheme}: the soft token passes 3 to 1 for the large text of saved images`, () => {
    assert.ok(ratio(rgb(t.soft), rgb(t.card)) >= 3, ratio(rgb(t.soft), rgb(t.card)).toFixed(2));
  });
  test(`${scheme}: every source accent passes 3 to 1 as a graphic on a card`, () => {
    const a = accents(scheme);
    assert.equal(Object.keys(a).length, 7);
    for (const [src, hex] of Object.entries(a)) assert.ok(ratio(rgb(hex), rgb(t.card)) >= 3, `${src}: ${ratio(rgb(hex), rgb(t.card)).toFixed(2)}`);
  });
}

test('the soft token is never used for small text on the page', () => {
  const uses = [...css.matchAll(/var\(--soft\)/g)];
  assert.equal(uses.length, 0);
});

test('for the record: the soft token on the page background in light mode', () => {
  // 3.6 to 1: fine for large text, too light for small text. reported to the owner.
  const r = ratio(rgb(light.soft), rgb(light.bg));
  assert.ok(r > 3 && r < 4.5, r.toFixed(2));
});
