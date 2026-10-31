// amazon: Retail.OrderHistory csv files from the "request your data" page.
// one row per item. only the date, order id, currency, amount, quantity and
// product name are read: never addresses, payment details or gift messages.
// money is never added across currencies. columns are from memory.

import { EventStore } from '../core/store.js';
import { card, scope } from '../core/cards.js';
import { name, words, int, count, changeWords, money, percent } from '../core/templates.js';
import { monthHistogram, weekdayHistogram, peak, change, share } from '../core/analysers.js';
import { dayName, MONTHS, WEEKDAYS } from '../core/timezone.js';
import { monthLine, bars, progress, readCsv, headerHas, parseUtc } from './common.js';

const COLUMNS = {
  date: ['Order Date'], order: ['Order ID'], currency: ['Currency'], owed: ['Total Owed', 'Item Total'],
  quantity: ['Quantity'], product: ['Product Name', 'Title'], status: ['Order Status'],
};

const match = f => (/^Retail\.OrderHistory.*\.csv$/i.test(f.name) ? 0.9 : 0);
const detect = files => ({ files: files.filter(f => /\.csv$/i.test(f.name) && headerHas(f, 'Order ID', 'Order Date', 'Product Name')).map(f => ({ file: f, score: 0.95 })) });

async function parse(files, onProgress) {
  const store = new EventStore(4096);
  const notes = [];
  const tick = progress(onProgress, 500);
  let cancelled = 0;
  for (const f of files) {
    // the same product can sit in one order twice; its place in the order
    // keeps the rows apart, while the same file dropped twice still matches
    const rowInOrder = new Map();
    try {
      await readCsv(f, COLUMNS, ['date', 'order', 'product'], 'amazon order history', get => {
        if (/cancel/i.test(get('status'))) { cancelled++; return; }
        const t = parseUtc(get('date'));
        if (!Number.isFinite(t)) return;
        const owed = Number(String(get('owed')).replace(/[^0-9.-]/g, ''));
        const order = get('order');
        const n = (rowInOrder.get(order) || 0) + 1;
        rowInOrder.set(order, n);
        store.push({
          t, kind: 'purchase', title: get('product'), album: order, id: `${order}#${n}`,
          meta: { owed: Number.isFinite(owed) ? owed : undefined, currency: (get('currency') || 'unknown').toUpperCase(), quantity: Number(get('quantity')) || 1 },
        });
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'columns' ? e.message : 'this amazon file could not be read to the end.' });
    }
  }
  tick.done();
  if (cancelled) notes.push({ code: 'cancelled', message: `${count(cancelled, 'cancelled item')} were left out.` });
  return { store, notes, count: tick.count };
}

function cards(r, ctx) {
  const store = r.store;
  const S = scope(store, ctx);
  const { z, when } = S;
  const all = store.ofKind('purchase', S.lo, S.hi);
  if (!all.length) return [];
  const t = store.t, str = id => store.strings.str(id) || '';
  const owed = store.column('owed'), qty = store.column('quantity');
  const curOf = i => store.metaValue('currency', i);
  const base = { source: 'amazon' };
  const out = [];
  // one entry per order, at the time of its first item
  const orders = new Map();
  for (const i of all) {
    const k = store.album[i];
    let o = orders.get(k);
    if (!o) orders.set(k, (o = { id: str(k), t: t[i], i, items: 0, amounts: new Map(), products: [] }));
    o.items += qty && !Number.isNaN(qty[i]) ? qty[i] : 1;
    if (owed && !Number.isNaN(owed[i])) o.amounts.set(curOf(i), (o.amounts.get(curOf(i)) || 0) + owed[i]);
    o.products.push(str(store.title[i]));
  }
  const list = [...orders.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const firsts = list.map(o => o.i);
  const prevOrders = S.prev ? new Set([...store.ofKind('purchase', S.prev.lo, S.prev.hi)].map(i => store.album[i])).size : null;
  const delta = prevOrders ? change(list.length, prevOrders) : null;
  const months = monthHistogram(t, firsts, z);
  const items = list.reduce((s, o) => s + o.items, 0);
  out.push(card({
    ...base, id: 'amazon.orders', title: 'your year of orders', big: count(list.length, 'order'),
    caption: words('placed {when}, with {n} in them.', { when, n: count(items, 'item') }),
    visual: monthLine(months, v => int(v)),
    values: { orders: list.length, items, months },
    stat: { label: 'amazon orders', display: int(list.length), value: list.length, change: delta },
  }));

  const totals = new Map();
  for (const o of list) for (const [c, a] of o.amounts) totals.set(c, (totals.get(c) || 0) + a);
  const byCur = [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  if (byCur.length) {
    out.push(card({
      ...base, id: 'amazon.spent', title: 'spent', big: money(byCur[0][1], byCur[0][0]),
      caption: words('on amazon orders {when}.', { when }),
      detail: byCur.length > 1 ? 'each currency is added up on its own.' : '',
      visual: byCur.length > 1 ? bars(byCur.map(([c, a]) => ({ label: c.toLowerCase(), value: a, display: money(a, c) }))) : null,
      values: { totals: byCur.map(([currency, amount]) => ({ currency, amount })) },
    }));
    const [main] = byCur[0];
    const biggest = list.filter(o => o.amounts.has(main)).reduce((a, o) => (o.amounts.get(main) > a.amounts.get(main) ? o : a));
    out.push(card({
      ...base, id: 'amazon.biggest', title: 'the biggest order', big: money(biggest.amounts.get(main), main),
      caption: biggest.products.length > 1
        ? words('on {day}: {product} and {n} more.', { day: dayName(z.dayKey(biggest.t)), product: name(biggest.products[0]), n: int(biggest.products.length - 1) })
        : words('on {day}: {product}.', { day: dayName(z.dayKey(biggest.t)), product: name(biggest.products[0]) }),
      values: { order: biggest.id, amount: biggest.amounts.get(main), currency: main },
    }));
  }

  const m = peak(months);
  out.push(card({
    ...base, id: 'amazon.month', title: 'your busiest month', big: MONTHS[m],
    caption: words('{n} in one month.', { n: count(months[m], 'order') }),
    values: { month: m, orders: months[m] },
  }));
  const wd = weekdayHistogram(t, firsts, z);
  const w = peak(wd);
  out.push(card({
    ...base, id: 'amazon.weekday', title: 'your shopping day', big: WEEKDAYS[w],
    caption: words('with {share} of your orders.', { share: percent(share(wd[w], list.length)) }),
    visual: bars(wd.map((v, d) => ({ label: WEEKDAYS[d], value: v, display: int(v) }))),
    values: { bins: wd, peak: w },
  }));
  const night = list.filter(o => z.hour(o.t) < 5).length;
  out.push(card({
    ...base, id: 'amazon.night', title: 'late night shopping', big: percent(share(night, list.length)),
    caption: night ? 'of your orders were placed between midnight and 5 am.' : 'of your orders were placed between midnight and 5 am. sensible.',
    values: { night, orders: list.length, share: share(night, list.length) },
  }));

  const inOrders = new Map();
  for (const o of list) for (const p of new Set(o.products)) { const e = inOrders.get(p) || { n: 0, first: o.t }; e.n++; inOrders.set(p, e); }
  const again = [...inOrders].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1));
  if (again.length) {
    out.push(card({
      ...base, id: 'amazon.repeat', title: 'bought again', big: count(again.length, 'thing'),
      caption: words('you ordered more than once {when}. most often {product}, {n}.', { when, product: name(again[0][0]), n: count(again[0][1].n, 'time') }),
      values: { products: again.length, top: { name: again[0][0], orders: again[0][1].n } },
    }));
  }

  if (delta !== null) {
    out.push(card({
      ...base, id: 'amazon.change', title: 'compared with last year', big: changeWords(delta),
      caption: words('orders than {last}: {now} against {then}.', { last: S.lastYear, now: int(list.length), then: int(prevOrders) }),
      values: { orders: list.length, prev: prevOrders, change: delta },
    }));
  }
  return out;
}

export default { id: 'amazon', name: 'amazon', unit: 'items', guide: 'amazon', match, detect, parse, cards };
