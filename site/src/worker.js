// the worker: all reading and counting happens here, so the page never
// freezes. everything is imported at the start, so nothing is loaded after
// files arrive.

import { guardNetwork, counter } from './core/guard.js';
import { createHost } from './host.js';
import { loadSqlEngine } from './core/sqlengine.js';

guardNetwork(self);
const host = createHost(msg => self.postMessage(msg), { sqlite: loadSqlEngine });

// the worker keeps its own record of requests; any show up in the proof panel
let started = Infinity;
let requests = 0;
const report = () => self.postMessage({ type: 'net', n: requests + counter.attempts });
counter.listeners.add(report);
try {
  new PerformanceObserver(list => {
    requests += list.getEntries().filter(e => /^https?:/.test(e.name) && e.startTime > started).length;
    report();
  }).observe({ type: 'resource' });
} catch {
  // the page policy still holds
}

self.onmessage = e => {
  if (e.data && e.data.type === 'read') {
    started = performance.now();
    requests = 0;
  }
  host(e.data);
};

loadSqlEngine().then(
  () => self.postMessage({ type: 'ready', sqlite: true }),
  () => self.postMessage({ type: 'ready', sqlite: false }),
);
