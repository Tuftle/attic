// the proof panel: the policy in plain words, and a live count of every
// request made since files were dropped. the count comes from the browser's
// own record of requests, plus the network functions attic replaced so that
// they throw. it should always say zero.

import { counter } from '../core/guard.js';

export function setupProof({ dialog, open, close, count }) {
  let since = Infinity;
  let seen = 0;
  let base = counter.attempts;
  let fromWorker = 0;
  const show = () => { count.textContent = String(seen + (counter.attempts - base) + fromWorker); };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.startTime >= since && /^https?:/.test(e.name)) seen++;
      }
      show();
    }).observe({ type: 'resource', buffered: true });
  } catch {
    // an older browser without the observer still has the policy
  }
  counter.listeners.add(show);
  open.addEventListener('click', () => {
    show();
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  });
  close.addEventListener('click', () => (dialog.close ? dialog.close() : dialog.removeAttribute('open')));
  return {
    /** start counting from now */
    start() {
      since = performance.now();
      seen = 0;
      base = counter.attempts;
      fromWorker = 0;
      show();
    },
    /** requests the worker saw on its side */
    worker(n) {
      fromWorker = n;
      show();
    },
    get count() { return Number(count.textContent); },
  };
}
