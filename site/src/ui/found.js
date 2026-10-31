// "what we found": a row per source, a kind word for files we do not know,
// and the year and time zone pickers.

import { FORMAT_PROBLEM_URL } from '../core/doctor.js';
import { browserZone, isValidZone } from '../core/timezone.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function zones() {
  let list = [];
  try { list = Intl.supportedValuesOf('timeZone'); } catch { list = []; }
  const mine = browserZone();
  if (!list.includes(mine)) list = [mine, ...list];
  if (!list.includes('UTC')) list.push('UTC');
  return list;
}

/**
 * @param {{ found: any, root: Record<string, HTMLElement>, onShape: (path: string) => void, now: number }} opts
 */
export function renderFound({ found, root, onShape, now }) {
  root.rows.replaceChildren();
  for (const r of found.rows) {
    const li = el('li', 'found-row');
    li.appendChild(el('span', 'found-name', r.name));
    li.appendChild(el('span', 'found-text', r.text.slice(r.name.length + 2)));
    root.rows.appendChild(li);
  }
  if (!found.rows.length) root.rows.appendChild(el('li', 'found-row empty', 'we did not find an export we know in these files.'));

  root.unknown.replaceChildren();
  const unknown = found.notes.filter(n => !n.source && ['unknown', 'not-zip', 'empty', 'unreadable', 'too-large', 'too-deep', 'columns', 'netflix-short', 'format'].includes(n.code));
  const leftOut = found.notes.filter(n => !unknown.includes(n));
  for (const n of unknown) {
    const box = el('div', 'note unknown');
    box.appendChild(el('p', 'unknown-path', n.path || ''));
    box.appendChild(el('p', '', n.message));
    if (n.code === 'unknown' || n.code === 'format' || n.code === 'columns') {
      const p = el('p', 'actions');
      const b = el('button', 'link', 'copy the shape of this file');
      b.type = 'button';
      b.addEventListener('click', () => onShape(n.path));
      const a = el('a', '', 'tell us about it');
      a.href = FORMAT_PROBLEM_URL;
      a.rel = 'noreferrer';
      a.target = '_blank';
      p.append(b, ' ', a);
      box.appendChild(p);
      box.appendChild(el('p', 'soft-text', 'the shape has field names and counts, never what is in them.'));
    }
    root.unknown.appendChild(box);
  }
  root.notes.hidden = !leftOut.length;
  root.notesList.replaceChildren(...leftOut.map(n => el('li', '', n.message)));

  const years = found.years.slice().reverse();
  const current = new Date(now).getFullYear();
  root.year.replaceChildren(...years.map(y => { const o = el('option', '', String(y)); o.value = String(y); return o; }));
  root.year.value = String(years.includes(current) ? current : years[0] ?? current);
  root.make.disabled = !found.rows.some(r => r.count > 0);
}

export function fillZones(select) {
  if (select.options.length) return;
  const mine = browserZone();
  for (const z of zones()) {
    const o = document.createElement('option');
    o.value = z;
    o.textContent = z.toLowerCase().replace(/_/g, ' ');
    select.appendChild(o);
  }
  select.value = isValidZone(mine) ? mine : 'UTC';
}

export function yearNote(year, now) {
  const current = new Date(now).getFullYear();
  return year === current ? `${year} is not over yet, so this is your year so far.` : '';
}
