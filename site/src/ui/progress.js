// the reading view: real counts as they come in.

import { int } from '../core/templates.js';

export function createProgress(list) {
  const rows = new Map();
  const row = key => {
    let li = rows.get(key);
    if (!li) {
      li = document.createElement('li');
      list.appendChild(li);
      rows.set(key, li);
    }
    return li;
  };
  return {
    reset() { rows.clear(); list.replaceChildren(); },
    update(p) {
      if (p.stage === 'opening') row('open').textContent = `opening ${p.count === 1 ? 'one file' : `${int(p.count)} files`}`;
      else if (p.stage === 'looking') row('look').textContent = `looking through ${p.count === 1 ? 'one file' : `${int(p.count)} files`}`;
      else if (p.stage === 'reading' || p.stage === 'read') {
        const li = row(p.source);
        li.textContent = `${p.source === 'browser' ? 'your browser' : p.source}: ${p.stage === 'read' ? 'read' : 'reading'} ${int(p.count || 0)} ${p.unit || 'items'}`;
        li.classList.toggle('done', p.stage === 'read');
      }
    },
  };
}
