// the deck: full-screen cards, one idea each. arrow keys, swipe, or the
// buttons move between them; nothing moves on its own. each card can be
// saved as an image, can hide its names in that image, or can be left out.

import { scene, toSvg } from '../render/charts.js';
import { cardPng, readPalette } from '../render/card.js';
import { capDeck } from '../core/cap.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
};

/** a download of a blob, named */
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card';
export const fileName = (card, n, year) => `attic-${year}-${String(n).padStart(2, '0')}-${slug(card.id.replace(/@\d+$/, '').replace('.', '-'))}.png`;

function bigClass(text) {
  const n = [...text].length;
  return n <= 8 ? 'big-xl' : n <= 16 ? 'big-l' : n <= 28 ? 'big-m' : 'big-s';
}

/** the big number counts up from zero, unless motion is turned down */
function countUp(node, text) {
  const m = /^([\d,]+(?:\.\d+)?)(.*)$/s.exec(text);
  if (!m || reduced()) { node.textContent = text; return; }
  const target = Number(m[1].replace(/,/g, ''));
  const decimals = (m[1].split('.')[1] || '').length;
  const grouped = m[1].includes(',');
  const t0 = performance.now();
  const fmt = v => {
    const s = v.toFixed(decimals);
    if (!grouped) return s;
    const [a, b] = s.split('.');
    return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? `.${b}` : '');
  };
  const step = now => {
    const k = Math.min(1, (now - t0) / 700);
    node.textContent = k < 1 ? fmt(target * (1 - Math.pow(1 - k, 3))) + m[2] : text;
    if (k < 1 && node.isConnected) requestAnimationFrame(step);
  };
  node.textContent = fmt(0) + m[2];
  requestAnimationFrame(step);
}

export class Deck {
  /**
   * @param {Record<string, HTMLElement>} els
   * @param {{ onBack: () => void, onKeep: () => void, size: () => 'card'|'story', onStatus?: (s: string) => void }} hooks
   */
  constructor(els, hooks) {
    this.els = els;
    this.hooks = hooks;
    this.cards = [];
    this.all = [];
    this.state = {};
    this.i = 0;
    this.year = 0;
    els.next.addEventListener('click', () => this.go(this.i + 1, 1));
    els.prev.addEventListener('click', () => this.go(this.i - 1, -1));
    els.back.addEventListener('click', () => hooks.onBack());
    els.keep.addEventListener('click', () => hooks.onKeep());
    els.save.addEventListener('click', () => this.save(this.i));
    els.names.addEventListener('click', () => {
      const st = this.st(this.cards[this.i]);
      st.names = !st.names;
      this.render(0);
    });
    els.leave.addEventListener('click', () => {
      const st = this.st(this.cards[this.i]);
      st.out = !st.out;
      this.render(0);
    });
    document.addEventListener('keydown', e => {
      if (els.root.hidden || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const keys = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
      if (e.key in keys) { e.preventDefault(); this.go(this.i + keys[e.key], keys[e.key]); }
      else if (e.key === 'Home') { e.preventDefault(); this.go(0, -1); }
      else if (e.key === 'End') { e.preventDefault(); this.go(this.cards.length - 1, 1); }
    });
    let startX = null, startY = null;
    els.stage.addEventListener('pointerdown', e => { startX = e.clientX; startY = e.clientY; });
    els.stage.addEventListener('pointerup', e => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.go(this.i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    });
  }

  /** cards from the pipeline, the last card, and any state kept on this device */
  open(cards, final, year, saved) {
    const all = [...cards, ...(final ? [final] : [])];
    this.all = all;
    this.cards = [...capDeck(all.filter(c => c.id !== 'final')), ...all.filter(c => c.id === 'final')];
    this.state = saved && typeof saved === 'object' && !Array.isArray(saved) ? { ...saved } : {};
    this.year = year;
    this.i = 0;
    this.layout();
    this.render(0);
  }

  /** the state of one card, by its id */
  st(c) {
    return this.state[c.id] || (this.state[c.id] = { names: false, out: false, revealed: !c.optIn });
  }

  /** open a "more from" card: its cards take its place */
  expand(n) {
    const c = this.cards[n];
    if (!c || !c.more) return;
    this.cards.splice(n, 1, ...c.more);
    this.layout();
    this.render(1);
  }

  layout() {
    const many = this.cards.length > 20;
    this.els.dots.hidden = many;
    this.els.progress.hidden = !many;
    this.els.progress.max = Math.max(1, this.cards.length);
    this.els.dots.replaceChildren(...(many ? [] : this.cards).map((c, n) => {
      const li = el('li');
      const b = el('button', 'dot');
      b.type = 'button';
      b.setAttribute('aria-label', `card ${n + 1} of ${this.cards.length}`);
      b.addEventListener('click', () => this.go(n, n > this.i ? 1 : -1));
      li.appendChild(b);
      return li;
    }));
  }

  go(n, dir) {
    if (n < 0 || n >= this.cards.length || n === this.i) return;
    this.i = n;
    this.render(dir);
  }

  render(dir) {
    const c = this.cards[this.i], st = this.st(c);
    const art = el('article', `card src-${c.source}${st.out ? ' is-out' : ''}`);
    art.setAttribute('aria-roledescription', 'card');
    art.setAttribute('aria-label', `${this.i + 1} of ${this.cards.length}: ${c.title}`);
    if (c.more) {
      art.classList.add('no-visual', 'is-more');
      art.append(el('p', 'card-title', c.title), el('p', 'card-big big-m', c.big), el('p', 'card-caption', c.caption));
      const b = el('button', 'primary', 'show them');
      b.type = 'button';
      b.addEventListener('click', () => this.expand(this.i));
      art.appendChild(b);
    } else if (c.optIn && !st.revealed) {
      art.append(
        el('p', 'card-title', c.title),
        el('p', 'card-big big-m', 'your most used words'),
        el('p', 'card-caption', 'counted here, from your own messages. they stay on this screen unless you choose to save them.'),
      );
      const b = el('button', 'primary', 'show my words');
      b.type = 'button';
      b.addEventListener('click', () => { st.revealed = true; this.render(0); });
      art.appendChild(b);
    } else {
      const big = el('p', `card-big ${bigClass(c.big)}`);
      art.append(el('p', 'card-title', c.title), big, el('p', 'card-caption', c.caption));
      const sc = scene(c.visual, { compact: window.innerWidth < 600 });
      if (!sc) art.classList.add('no-visual');
      if (sc) {
        const fig = el('figure', `card-visual vis-${c.visual.type}`);
        fig.appendChild(toSvg(sc));
        art.appendChild(fig);
      }
      if (c.detail) art.appendChild(el('p', 'card-detail', c.detail));
      if (st.out) art.appendChild(el('p', 'card-out', 'left out of what you save'));
      countUp(big, c.big);
    }
    if (dir && !reduced()) art.classList.add(dir > 0 ? 'from-right' : 'from-left');
    this.els.stage.replaceChildren(art);
    if (dir && !reduced()) requestAnimationFrame(() => requestAnimationFrame(() => art.classList.remove('from-right', 'from-left')));

    this.els.count.textContent = `${this.i + 1} of ${this.cards.length}`;
    this.els.progress.value = this.i + 1;
    [...this.els.dots.querySelectorAll('button')].forEach((b, n) => {
      if (n === this.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.classList.toggle('out', this.st(this.cards[n]).out);
    });
    this.els.prev.disabled = this.i === 0;
    this.els.next.disabled = this.i === this.cards.length - 1;
    this.els.names.hidden = !c.sensitive;
    this.els.names.setAttribute('aria-pressed', String(!st.names));
    this.els.names.textContent = st.names ? 'names shown' : 'names hidden';
    this.els.names.setAttribute('aria-label', st.names ? 'names are shown in the saved image. hide them' : 'names are hidden in the saved image. show them');
    this.els.leave.setAttribute('aria-pressed', String(st.out));
    this.els.leave.textContent = st.out ? 'put it back' : 'leave out';
    this.els.leave.setAttribute('aria-label', st.out ? 'put this card back into what you save' : 'leave this card out of what you save');
    this.els.save.disabled = !!(c.more || (c.optIn && !st.revealed));
    this.els.leave.hidden = !!c.more;
    this.els.save.hidden = !!c.more;
    this.els.live.textContent = c.optIn && !st.revealed ? `${c.title}. hidden until you ask.` : [c.title, c.big, c.caption, c.detail].filter(Boolean).join('. ');
  }

  /** the cards that go into a saved set or copied text */
  included() {
    return this.cards.map((c, n) => ({ card: c, st: this.st(c), n })).filter(x => !x.card.more && !x.st.out && (!x.card.optIn || x.st.revealed));
  }

  async png(n) {
    const c = this.cards[n], st = this.st(c);
    return cardPng(c, { size: this.hooks.size(), names: st.names, palette: readPalette(c.source) });
  }

  async save(n) {
    const blob = await this.png(n);
    download(blob, fileName(this.cards[n], n + 1, this.year));
  }
}
