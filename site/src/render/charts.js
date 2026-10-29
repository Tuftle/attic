// the small graphics on the cards: bars, a 24 hour clock, a calendar, a
// line, and the numbers of the last card. each chart is worked out once as a
// plain scene of shapes, then drawn either as svg on the page or onto a
// canvas for a saved image. colours come from classes, never inline styles.

import { MONTH_SHORT } from '../core/templates.js';
import { dayParts, hourName, longDayName, MONTHS } from '../core/timezone.js';

/**
 * @typedef {{ w: number, h: number, items: any[], alt: string }} Scene
 * items: { t: 'rect'|'path'|'circle'|'text'|'line'|'polyline', cls: string, ... }
 */

/**
 * @param {{ compact?: boolean }} [opts]  compact draws for a narrow screen
 * @returns {Scene|null}
 */
export function scene(visual, opts = {}) {
  if (!visual) return null;
  switch (visual.type) {
    case 'bars': return bars(visual, opts.compact);
    case 'clock': return clockFace(visual);
    case 'heatmap': return calendar(visual);
    case 'line': return line(visual, opts.compact);
    case 'stats': return stats(visual, opts.compact);
    default: return null;
  }
}

function bars(v, compact) {
  const items = v.items.slice(0, 8);
  const max = Math.max(1, ...items.map(i => i.value));
  const W = compact ? 340 : 600, row = 58;
  const out = [];
  items.forEach((it, i) => {
    const y = i * row;
    const label = it.sub ? `${it.label}, ${it.sub}` : it.label;
    out.push({ t: 'text', x: 0, y: y + 20, text: clip(label, compact ? 20 : 44), cls: 'ink', size: 20, anchor: 'start' });
    out.push({ t: 'text', x: W, y: y + 20, text: it.display, cls: 'soft', size: 18, anchor: 'end' });
    out.push({ t: 'rect', x: 0, y: y + 30, w: W, h: 12, r: 6, cls: 'track' });
    out.push({ t: 'rect', x: 0, y: y + 30, w: Math.max(6, (it.value / max) * W), h: 12, r: 6, cls: i === 0 ? 'accent' : 'accent-soft' });
  });
  const alt = items.map((it, i) => `${i + 1}. ${it.sub ? `${it.label}, ${it.sub}` : it.label}, ${it.display}`).join('; ');
  return { w: W, h: items.length * row, items: out, alt };
}

function clockFace(v) {
  // room at the sides for the "6 am" and "6 pm" labels
  const W = 420, H = 340, c = W / 2, cy = H / 2, inner = 34, outer = 132;
  const max = Math.max(1, ...v.bins);
  const out = [{ t: 'circle', cx: c, cy, r: outer, cls: 'track-line' }];
  for (let h = 0; h < 24; h++) {
    const a0 = ((h / 24) * 2 - 0.5) * Math.PI + 0.02, a1 = (((h + 1) / 24) * 2 - 0.5) * Math.PI - 0.02;
    const r = inner + Math.sqrt(v.bins[h] / max) * (outer - inner);
    if (v.bins[h] === 0) continue;
    out.push({ t: 'path', d: wedge(c, cy, inner, r, a0, a1), cls: h === v.peak ? 'accent' : 'accent-soft' });
  }
  for (const [h, label] of [[0, 'midnight'], [6, '6 am'], [12, 'noon'], [18, '6 pm']]) {
    const a = ((h / 24) * 2 - 0.5) * Math.PI;
    const x = c + Math.cos(a) * (outer + 18), y = cy + Math.sin(a) * (outer + 18);
    out.push({ t: 'text', x, y: y + 5, text: label, cls: 'soft', size: 14, anchor: h === 6 ? 'start' : h === 18 ? 'end' : 'middle' });
  }
  const quiet = v.bins.indexOf(Math.min(...v.bins));
  return { w: W, h: H, items: out, alt: `a 24 hour clock. the most at ${hourName(v.peak)}, the least at ${hourName(quiet)}.` };
}

function wedge(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1.toFixed(1)} ${r1.toFixed(1)} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`;
}

function calendar(v) {
  const cell = 10, gap = 2, step = cell + gap, top = 18;
  const firstWeekday = dayParts(v.first).weekday;
  const nonzero = v.values.filter(x => x > 0).sort((a, b) => a - b);
  const q = f => nonzero[Math.floor(f * (nonzero.length - 1))] || 0;
  const cuts = [q(0.25), q(0.5), q(0.8)];
  const level = x => (x <= 0 ? 0 : x <= cuts[0] ? 1 : x <= cuts[1] ? 2 : x <= cuts[2] ? 3 : 4);
  const out = [];
  let lastMonth = -1;
  v.values.forEach((x, i) => {
    const pos = i + firstWeekday;
    const col = Math.floor(pos / 7), row = pos % 7;
    const d = dayParts(v.first + i);
    if (d.day === 1 || i === 0) {
      if (d.month !== lastMonth) out.push({ t: 'text', x: col * step, y: 12, text: MONTH_SHORT[d.month], cls: 'soft', size: 11, anchor: 'start' });
      lastMonth = d.month;
    }
    out.push({ t: 'rect', x: col * step, y: top + row * step, w: cell, h: cell, r: 2, cls: `heat-${level(x)}${v.first + i === v.mark ? ' mark' : ''}` });
  });
  const cols = Math.ceil((v.values.length + firstWeekday) / 7);
  return { w: cols * step, h: top + 7 * step, items: out, alt: v.mark !== undefined ? `a calendar of the year, one square a day. the busiest was ${longDayName(v.mark)}.` : 'a calendar of the year, one square a day.' };
}

function line(v, compact) {
  const W = compact ? 360 : 600, H = compact ? 170 : 190, top = 14, bottom = 30;
  const max = Math.max(1, ...v.points);
  const xs = v.points.map((_, i) => 20 + (i * (W - 40)) / (v.points.length - 1));
  const ys = v.points.map(p => top + (1 - p / max) * (H - top - bottom));
  const out = [{ t: 'line', x1: 0, y1: H - bottom, x2: W, y2: H - bottom, cls: 'track-line' }];
  out.push({ t: 'polyline', points: xs.map((x, i) => [x, ys[i]]), cls: 'accent-line' });
  const best = v.points.indexOf(Math.max(...v.points));
  xs.forEach((x, i) => {
    out.push({ t: 'circle', cx: x, cy: ys[i], r: i === best ? 6 : 3.5, cls: i === best ? 'accent' : 'accent-soft' });
    out.push({ t: 'text', x, y: H - 8, text: v.labels[i], cls: 'soft', size: 14, anchor: 'middle' });
  });
  const least = v.points.indexOf(Math.min(...v.points));
  return { w: W, h: H, items: out, alt: `month by month: the most in ${MONTHS[best]} (${v.displays[best]}), the least in ${MONTHS[least]} (${v.displays[least]}).` };
}

function stats(v, compact) {
  const W = compact ? 360 : 600, rowH = 132;
  const out = [];
  v.items.forEach((it, i) => {
    const y = i * rowH;
    out.push({ t: 'text', x: 0, y: y + 56, text: it.display, cls: 'ink', size: 54, anchor: 'start', font: 'serif' });
    out.push({ t: 'text', x: 0, y: y + 86, text: it.label, cls: 'ink', size: 21, anchor: 'start' });
    if (it.note) out.push({ t: 'text', x: 0, y: y + 112, text: it.note, cls: 'soft', size: 18, anchor: 'start' });
  });
  return { w: W, h: v.items.length * rowH, items: out, alt: v.items.map(it => `${it.display} ${it.label}${it.note ? `, ${it.note}` : ''}`).join('; ') };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '\u{2026}' : s);

// drawing: svg for the page

const SVG = 'http://www.w3.org/2000/svg';

/** an svg element for the page. text goes in as text, never as markup. */
export function toSvg(sc, doc = document) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sc.w} ${sc.h}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', sc.alt);
  svg.setAttribute('class', 'chart');
  for (const it of sc.items) {
    let el;
    if (it.t === 'rect') {
      el = doc.createElementNS(SVG, 'rect');
      for (const [k, v] of [['x', it.x], ['y', it.y], ['width', it.w], ['height', it.h], ['rx', it.r || 0]]) el.setAttribute(k, String(round(v)));
    } else if (it.t === 'path') {
      el = doc.createElementNS(SVG, 'path');
      el.setAttribute('d', it.d);
    } else if (it.t === 'circle') {
      el = doc.createElementNS(SVG, 'circle');
      for (const [k, v] of [['cx', it.cx], ['cy', it.cy], ['r', it.r]]) el.setAttribute(k, String(round(v)));
    } else if (it.t === 'line') {
      el = doc.createElementNS(SVG, 'line');
      for (const k of ['x1', 'y1', 'x2', 'y2']) el.setAttribute(k, String(round(it[k])));
    } else if (it.t === 'polyline') {
      el = doc.createElementNS(SVG, 'polyline');
      el.setAttribute('points', it.points.map(([x, y]) => `${round(x)},${round(y)}`).join(' '));
    } else if (it.t === 'text') {
      el = doc.createElementNS(SVG, 'text');
      el.setAttribute('x', String(round(it.x)));
      el.setAttribute('y', String(round(it.y)));
      el.setAttribute('font-size', String(it.size));
      el.setAttribute('text-anchor', it.anchor === 'end' ? 'end' : it.anchor === 'middle' ? 'middle' : 'start');
      if (it.font === 'serif') el.setAttribute('class', `${it.cls} serif`);
      el.textContent = it.text;
    }
    if (!el) continue;
    if (!el.hasAttribute('class')) el.setAttribute('class', it.cls);
    svg.appendChild(el);
  }
  return svg;
}

const round = v => Math.round(v * 10) / 10;

// drawing: canvas for saved images

/**
 * draw a scene into a box on a canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Record<string, string>} palette  colours by role: ink, soft, accent, line, card
 */
export function drawScene(ctx, sc, box, palette, fonts) {
  const s = Math.min(box.w / sc.w, box.h / sc.h);
  const ox = box.x + (box.w - sc.w * s) / 2, oy = box.y + (box.h - sc.h * s) / 2;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  for (const it of sc.items) {
    const paint = paintOf(it.cls, palette);
    ctx.globalAlpha = paint.alpha;
    if (it.t === 'rect') {
      ctx.fillStyle = paint.fill;
      roundRect(ctx, it.x, it.y, it.w, it.h, it.r || 0);
      ctx.fill();
      if (paint.stroke) { ctx.globalAlpha = 1; ctx.strokeStyle = paint.stroke; ctx.lineWidth = 2; ctx.stroke(); }
    } else if (it.t === 'path') {
      ctx.fillStyle = paint.fill;
      ctx.fill(new Path2D(it.d));
    } else if (it.t === 'circle') {
      ctx.beginPath();
      ctx.arc(it.cx, it.cy, it.r, 0, Math.PI * 2);
      if (paint.stroke && !paint.fill) { ctx.strokeStyle = paint.stroke; ctx.lineWidth = 2; ctx.stroke(); } else { ctx.fillStyle = paint.fill; ctx.fill(); }
    } else if (it.t === 'line' || it.t === 'polyline') {
      const pts = it.t === 'line' ? [[it.x1, it.y1], [it.x2, it.y2]] : it.points;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = paint.stroke || paint.fill;
      ctx.lineWidth = it.t === 'line' ? 2 : 4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    } else if (it.t === 'text') {
      ctx.fillStyle = paint.fill;
      ctx.font = `${it.size}px ${it.font === 'serif' ? fonts.serif : fonts.sans}`;
      ctx.textAlign = it.anchor === 'end' ? 'right' : it.anchor === 'middle' ? 'center' : 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(it.text, it.x, it.y);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** the colour of a class, for canvas. the page uses the same classes in style.css. */
export function paintOf(cls, p) {
  const main = cls.split(' ')[0];
  const mark = cls.includes('mark');
  const table = {
    ink: { fill: p.ink },
    soft: { fill: p.soft },
    accent: { fill: p.accent },
    'accent-soft': { fill: p.accent, alpha: 0.45 },
    'accent-line': { stroke: p.accent },
    track: { fill: p.line },
    'track-line': { stroke: p.line },
    'heat-0': { fill: p.line, alpha: 0.6 },
    'heat-1': { fill: p.accent, alpha: 0.25 },
    'heat-2': { fill: p.accent, alpha: 0.45 },
    'heat-3': { fill: p.accent, alpha: 0.7 },
    'heat-4': { fill: p.accent, alpha: 1 },
  };
  const out = { alpha: 1, ...(table[main] || { fill: p.ink }) };
  if (mark) out.stroke = p.ink;
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
