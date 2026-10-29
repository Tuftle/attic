// draws a card onto a canvas, for saving as an image. 1080 by 1350 (4:5) by
// default, or 1080 by 1920 for a story. names are hidden unless the visitor
// turned them on for this card.

import { scene, drawScene } from './charts.js';
import { redact } from '../core/redact.js';

export const SIZES = { card: [1080, 1350], story: [1080, 1920] };
export const FOOTER = 'made with attic. it ran in my browser and nothing was uploaded.';
export const FONTS = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/** the page's colours, read from its css tokens, with the source's accent */
export function readPalette(source, doc = document) {
  const probe = doc.createElement('div');
  probe.className = `src-${source}`;
  probe.hidden = true;
  doc.body.appendChild(probe);
  const css = getComputedStyle(probe);
  const v = name => css.getPropertyValue(name).trim();
  const p = { card: v('--card'), bg: v('--bg'), ink: v('--text'), soft: v('--soft'), accent: v('--accent') || v('--link'), line: v('--line') };
  probe.remove();
  return p;
}

function wrap(ctx, text, width, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let w of words) {
    // a single word wider than the line is broken by letters
    while (ctx.measureText(w).width > width) {
      let i = w.length - 1;
      while (i > 1 && ctx.measureText(w.slice(0, i)).width > width) i--;
      if (line) { lines.push(line); line = ''; }
      lines.push(w.slice(0, i));
      w = w.slice(i);
    }
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '\u{2026}').width > width) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '\u{2026}';
    return kept;
  }
  return lines;
}

/**
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {import('../core/cards.js').Card} card
 * @param {{ size?: 'card'|'story', names?: boolean, palette: any, fonts?: typeof FONTS }} opts
 * @returns {{ regions: Record<string, {x: number, y: number, w: number, h: number}> }} where things were drawn
 */
export function drawCard(canvas, card, opts) {
  const c = opts.names ? card : redact(card);
  const [W, H] = SIZES[opts.size || 'card'];
  const p = opts.palette, f = opts.fonts || FONTS;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const regions = {};
  const pad = 96, width = W - pad * 2;
  ctx.fillStyle = p.card;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, 0, W, 14);

  let y = pad + 20;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = p.soft;
  ctx.font = `600 34px ${f.sans}`;
  ctx.fillText(c.title, pad, y);
  y += 40;

  // the big line, as large as fits in three lines
  const story = opts.size === 'story';
  let size = story ? 168 : 150, lines;
  for (;;) {
    ctx.font = `${size}px ${f.serif}`;
    lines = wrap(ctx, c.big, width, 3);
    const fits = lines.every(l => ctx.measureText(l).width <= width) && lines.length <= (size > 110 ? 2 : 3);
    if (fits || size <= 64) break;
    size -= 6;
  }
  ctx.fillStyle = p.ink;
  const bigTop = y;
  for (const l of lines) {
    y += size * 1.05;
    ctx.fillText(l, pad, y);
  }
  regions.big = { x: pad, y: bigTop, w: width, h: y - bigTop + size * 0.25 };
  y += 40;

  ctx.font = `42px ${f.sans}`;
  const capTop = y;
  for (const l of wrap(ctx, c.caption, width, 4)) {
    y += 54;
    ctx.fillText(l, pad, y);
  }
  regions.caption = { x: pad, y: capTop, w: width, h: y - capTop + 14 };

  const footerY = H - pad + 30;
  ctx.font = `30px ${f.sans}`;
  const detail = c.detail ? wrap(ctx, c.detail, width, 3) : [];
  const detailH = detail.length * 42;
  const sc = scene(c.visual);
  if (sc) {
    const top = y + 50, bottom = footerY - 70 - detailH - (detailH ? 30 : 0);
    if (bottom - top > 120) {
      const box = { x: pad, y: top, w: width, h: bottom - top };
      drawScene(ctx, sc, box, p, f);
      regions.visual = box;
    }
  }
  ctx.fillStyle = p.soft;
  ctx.font = `30px ${f.sans}`;
  let dy = footerY - 70 - detailH;
  for (const l of detail) {
    dy += 42;
    ctx.fillText(l, pad, dy);
  }
  ctx.font = `26px ${f.sans}`;
  ctx.fillStyle = p.soft;
  ctx.fillText(FOOTER, pad, footerY);
  return { regions };
}

/** a png of the card */
export async function cardPng(card, opts) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(10, 10) : document.createElement('canvas');
  drawCard(canvas, card, opts);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
