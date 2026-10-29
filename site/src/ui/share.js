// keep it: save every card as one zip of images, copy the year as text,
// keep the finished cards on this device if asked, or forget everything.

import { zipSync } from '../../vendor/fflate.js';
import { redact } from '../core/redact.js';
import { download, fileName } from './deck.js';
import { FOOTER } from '../render/card.js';

export const KEPT_KEY = 'attic.kept.v1';

/** the year as plain text, names hidden where the visitor left them hidden */
export function asText(included, year) {
  const lines = [`my ${year}, from my own data:`, ''];
  for (const { card, st } of included) {
    const c = st.names ? card : redact(card);
    lines.push(`- ${c.share.text}`);
  }
  lines.push('', FOOTER);
  return lines.join('\n');
}

export function readKept() {
  try {
    const raw = localStorage.getItem(KEPT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeKept(value) {
  try {
    if (value) localStorage.setItem(KEPT_KEY, JSON.stringify(value));
    else localStorage.removeItem(KEPT_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Record<string, HTMLElement>} els
 * @param {{ deck: import('./deck.js').Deck, onBack: () => void, onForget: () => void }} hooks
 */
export function setupKeep(els, { deck, onBack, onForget }) {
  const status = s => { els.status.textContent = s; };
  els.saveAll.addEventListener('click', async () => {
    const list = deck.included();
    const files = {};
    let n = 0;
    els.saveAll.disabled = true;
    try {
      for (const { card, n: index } of list) {
        status(`drawing card ${++n} of ${list.length}`);
        const blob = await deck.png(index);
        files[fileName(card, index + 1, deck.year)] = new Uint8Array(await blob.arrayBuffer());
      }
      download(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `attic-${deck.year}.zip`);
      status(`saved ${list.length} cards.`);
    } finally {
      els.saveAll.disabled = false;
    }
  });
  els.copy.addEventListener('click', async () => {
    const text = asText(deck.included(), deck.year);
    try {
      await navigator.clipboard.writeText(text);
      els.fallback.hidden = true;
      status('copied. names stay hidden where you left them hidden.');
    } catch {
      els.fallback.value = text;
      els.fallback.hidden = false;
      els.fallback.focus();
      els.fallback.select();
      status('your browser would not copy it, so here it is to copy yourself.');
    }
  });
  els.device.addEventListener('change', () => {
    const ok = els.device.checked
      ? writeKept({ year: deck.year, saved: new Date().toISOString().slice(0, 10), cards: deck.cards, state: deck.state })
      : writeKept(null);
    status(ok ? (els.device.checked ? 'kept on this device. only the finished cards, never your files.' : 'removed from this device.') : 'this browser does not allow keeping anything here.');
  });
  els.back.addEventListener('click', () => onBack());
  els.forget.addEventListener('click', () => onForget());
}
