// attic never uses the network. the page policy already blocks it
// (connect-src 'none'); this makes the network functions throw as well, in
// the page and in the worker, and counts any attempt for the proof panel.

export const counter = { attempts: 0, listeners: new Set() };

function note(name) {
  counter.attempts++;
  for (const fn of counter.listeners) fn(counter.attempts, name);
  return new Error(`attic does not use the network (${name} was called)`);
}

export function guardNetwork(scope = globalThis) {
  if (scope.__atticGuarded) return;
  const blocked = name => function () { throw note(name); };
  const set = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { value, configurable: false, writable: false });
    } catch {
      try { obj[key] = value; } catch { /* leave it to the page policy */ }
    }
  };
  if ('fetch' in scope) set(scope, 'fetch', blocked('fetch'));
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
    if (name in scope) set(scope, name, blocked(name));
  }
  if (scope.navigator && 'sendBeacon' in scope.navigator) set(scope.navigator, 'sendBeacon', blocked('sendBeacon'));
  set(scope, '__atticGuarded', true);
}
