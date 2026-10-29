// made-up steam licences and amazon orders, and the answers the cards
// must give.

import { rng } from './rng.js';
import { writeZip } from './zipwriter.js';
import { local, utc, yearRange, prevRange, names, songName } from './ref.js';

export const SHOP = { now: Date.UTC(2026, 9, 29, 12), years: [2025, 2026], zone: 'America/Chicago' };
const DAY = 86400000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// steam

export function makeGames({ seed = 'steam' } = {}) {
  const r = rng(seed);
  const titles = names(r, 300, songName);
  const out = [];
  for (let d = Date.UTC(2024, 0, 8); d <= Date.UTC(2026, 9, 18); d += DAY) {
    if (!r.chance(0.07)) continue;
    out.push({ t: d + 12 * 3600000, title: titles[out.length % titles.length] + (r.chance(0.1) ? ' & Friends' : ''), how: r.weighted(['Steam Store', 'Complimentary', 'Gift/Guest Pass', 'Retail'], [6, 3, 1, 0.3]) });
  }
  return out;
}

export function licencesHtml(games, { us = false } = {}) {
  const day = t => { const d = new Date(t); return us ? `${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${d.getUTCFullYear()}`; };
  const rows = games.slice().reverse().map(g => `<tr>\n<td class="license_date_col">${day(g.t)}</td>\n<td>\n${g.how === 'Complimentary' ? '<div class="free_license_remove_link"><a href="#">Remove</a></div>\n' : ''}${esc(g.title)}</td>\n<td class="license_acquisition_col">${g.how}</td>\n</tr>`);
  return `<html><head><title>Licenses and product key activations</title></head><body><table class="account_table"><tr><th>Date</th><th>Item</th><th>Acquisition Method</th></tr>\n${rows.join('\n')}\n</table></body></html>`;
}

export function steamTruth(games, year, now = SHOP.now) {
  const start = Date.UTC(year, 0, 1), full = Date.UTC(year + 1, 0, 1), unfinished = now >= start && now < full;
  const end = unfinished ? now : full;
  const g = games.filter(x => x.t >= start && x.t < end).sort((a, b) => a.t - b.t || (a.title < b.title ? -1 : 1));
  if (!g.length) return {};
  const out = {};
  const months = new Array(12).fill(0);
  for (const x of g) months[new Date(x.t).getUTCMonth()]++;
  out['steam.games'] = { games: g.length, months };
  const how = new Map();
  for (const x of g) { const e = how.get(x.how) || { n: 0, first: x.t }; e.n++; how.set(x.how, e); }
  out['steam.how'] = { top: [...how].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([name, e]) => ({ name, games: e.n })) };
  let m = 0;
  for (let i = 1; i < 12; i++) if (months[i] > months[m]) m = i;
  out['steam.month'] = { month: m, games: months[m] };
  out['steam.first-last'] = { first: g[0].title, last: g.at(-1).title };
  const p0 = Date.UTC(year - 1, 0, 1), p1 = unfinished ? p0 + (now - start) : start;
  if (games[0].t <= p0 + 14 * DAY) {
    const p = games.filter(x => x.t >= p0 && x.t < p1).length;
    if (p) out['steam.change'] = { games: g.length, prev: p, change: (g.length - p) / p };
  }
  return out;
}

export function steamFixture() {
  const games = makeGames();
  const truth = {};
  for (const y of SHOP.years) truth[y] = steamTruth(games, y);
  return { items: games, zip: writeZip([{ path: 'Licenses.html', data: licencesHtml(games) }]), truth, zone: 'UTC', now: SHOP.now };
}

// amazon

export function makeOrders({ seed = 'amazon', zone = SHOP.zone } = {}) {
  const r = rng(seed);
  const products = names(r, 120, songName).map(n => ({ name: `${n}, pack of ${r.int(1, 6)}`, price: r.int(3, 180) + r.int(0, 99) / 100 }));
  const weights = r.zipf(120, 0.8);
  const rows = [];
  let n = 1;
  for (let d = Date.UTC(2024, 0, 2); d <= Date.UTC(2026, 9, 24); d += DAY) {
    if (!r.chance(0.18)) continue;
    const date = new Date(d);
    const t = utc(zone, date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), r.weighted([...Array(24).keys()], [1, .5, .2, .1, .1, .1, .2, .5, 1, 1, 1, 1, 1.5, 1, 1, 1, 1, 1.5, 2, 2.5, 3, 3, 2.5, 1.5]), r.int(0, 59), r.int(0, 59));
    const id = `111-${String(n++).padStart(7, '0')}-${String(n * 7).padStart(7, '0')}`;
    const currency = r.chance(0.1) ? 'EUR' : 'USD';
    const status = r.chance(0.04) ? 'Cancelled' : 'Closed';
    for (let k = 0; k < r.weighted([1, 2, 3], [6, 2, 1]); k++) {
      const p = r.weighted(products, weights);
      const qty = r.weighted([1, 2], [9, 1]);
      rows.push({ t, id, currency, status, product: p.name, quantity: qty, owed: Math.round(p.price * qty * 100) / 100 });
    }
  }
  return rows;
}

export function orderCsv(rows) {
  const head = ['Website', 'Order ID', 'Order Date', 'Purchase Order Number', 'Currency', 'Unit Price', 'Unit Price Tax', 'Shipping Charge', 'Total Discounts', 'Total Owed', 'Shipment Item Subtotal', 'Shipment Item Subtotal Tax', 'ASIN', 'Product Condition', 'Quantity', 'Payment Instrument Type', 'Order Status', 'Shipment Status', 'Ship Date', 'Shipping Option', 'Shipping Address', 'Billing Address', 'Carrier Name & Tracking Number', 'Product Name', 'Gift Message', 'Gift Sender Name', 'Gift Recipient Contact Details', 'Item Serial Number'];
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [head.join(','), ...rows.map(x => ['Amazon.com', x.id, new Date(x.t).toISOString(), 'Not Applicable', x.currency, x.owed, 0, 0, 0, x.owed, x.owed, 0, 'B000000', 'New', x.quantity, 'Visa - 0000', x.status, 'Shipped', new Date(x.t + 2 * DAY).toISOString(), 'standard', '1 Private Street, Nowhere', '1 Private Street, Nowhere', 'UPS(1Z)', x.product, 'a private gift note', 'Someone', 'someone@example.org', ''].map(q).join(','))].join('\n') + '\n';
}

export function amazonTruth(rows, year, tz = SHOP.zone, now = SHOP.now) {
  const kept = rows.filter(x => x.status !== 'Cancelled');
  const { start, end } = yearRange(year, tz, now);
  const items = kept.filter(x => x.t >= start && x.t < end);
  if (!items.length) return {};
  const orders = new Map();
  for (const x of items) {
    let o = orders.get(x.id);
    if (!o) orders.set(x.id, (o = { id: x.id, t: x.t, items: 0, amounts: new Map(), products: [] }));
    o.items += x.quantity;
    o.amounts.set(x.currency, (o.amounts.get(x.currency) || 0) + x.owed);
    o.products.push(x.product);
  }
  const list = [...orders.values()].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const out = {};
  const months = new Array(12).fill(0);
  for (const o of list) months[local(o.t, tz).month]++;
  out['amazon.orders'] = { orders: list.length, items: list.reduce((s, o) => s + o.items, 0), months };
  const totals = new Map();
  for (const o of list) for (const [c, a] of o.amounts) totals.set(c, (totals.get(c) || 0) + a);
  const byCur = [...totals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  out['amazon.spent'] = { totals: byCur.map(([currency, amount]) => ({ currency, amount })) };
  const main = byCur[0][0];
  const big = list.filter(o => o.amounts.has(main)).reduce((a, o) => (o.amounts.get(main) > a.amounts.get(main) ? o : a));
  out['amazon.biggest'] = { order: big.id, amount: big.amounts.get(main), currency: main };
  let m = 0;
  for (let i = 1; i < 12; i++) if (months[i] > months[m]) m = i;
  out['amazon.month'] = { month: m, orders: months[m] };
  const bins = new Array(7).fill(0);
  for (const o of list) bins[local(o.t, tz).weekday]++;
  let w = 0;
  for (let i = 1; i < 7; i++) if (bins[i] > bins[w]) w = i;
  out['amazon.weekday'] = { bins, peak: w };
  const night = list.filter(o => local(o.t, tz).hour < 5).length;
  out['amazon.night'] = { night, orders: list.length, share: night / list.length };
  const seen = new Map();
  for (const o of list) for (const p of new Set(o.products)) { const e = seen.get(p) || { n: 0, first: o.t }; e.n++; seen.set(p, e); }
  const again = [...seen].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first || (a[0] < b[0] ? -1 : 1));
  if (again.length) out['amazon.repeat'] = { products: again.length, top: { name: again[0][0], orders: again[0][1].n } };
  const prev = prevRange(year, tz, now);
  if (Math.min(...kept.map(x => x.t)) <= prev.start + 14 * DAY) {
    const p = new Set(kept.filter(x => x.t >= prev.start && x.t < prev.end).map(x => x.id)).size;
    if (p) out['amazon.change'] = { orders: list.length, prev: p, change: (list.length - p) / p };
  }
  return out;
}

export function amazonFixture() {
  const rows = makeOrders();
  const truth = {};
  for (const y of SHOP.years) truth[y] = amazonTruth(rows, y);
  const zip = writeZip([{ path: 'Retail.OrderHistory.1/Retail.OrderHistory.1.csv', data: orderCsv(rows) }, { path: 'Retail.CustomerProfile/profile.csv', data: 'Name,Email\nsomeone,someone@example.org\n' }]);
  return { items: rows, zip, truth, zone: SHOP.zone, now: SHOP.now };
}
