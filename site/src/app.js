// the page: landing, reading, what we found, the deck, keep it. all the
// reading and counting runs in a worker; this file only moves between views.

import { guardNetwork } from './core/guard.js';
import { setupDrop } from './ui/drop.js';
import { createProgress } from './ui/progress.js';
import { renderFound, fillZones, yearNote } from './ui/found.js';
import { Deck } from './ui/deck.js';
import { setupKeep, readKept, writeKept } from './ui/share.js';
import { setupProof } from './ui/proof.js';

guardNetwork(window);

const $ = id => document.getElementById(id);
const VIEWS = ['landing', 'reading', 'found', 'deck', 'keep'];
let view = 'landing';

function show(name) {
  view = name;
  for (const v of VIEWS) $(v).hidden = v !== name;
  document.body.dataset.view = name;
  hideError();
  const heading = $(`${name}-title`);
  if (heading) heading.focus({ preventScroll: false });
}

function showError(message) {
  const e = $('error');
  e.textContent = message;
  e.hidden = false;
}
function showStatus(message) {
  const e = $('status');
  e.textContent = message;
  e.hidden = false;
}
function hideError() { $('error').hidden = true; $('status').hidden = true; }

// the worker, or the same work on this page when a worker cannot start
function createRunner(onMessage) {
  let worker = null, inline = null, ready = false, queue = [];
  const startInline = async () => {
    const [{ createHost }, { loadSqlEngine }] = await Promise.all([import('./host.js'), import('./core/sqlengine.js')]);
    inline = createHost(msg => onMessage(msg), { sqlite: loadSqlEngine });
    const pending = queue;
    queue = [];
    for (const m of pending) inline(m);
  };
  const start = () => {
    ready = false;
    try {
      const url = globalThis.ATTIC_WORKER_URL || new URL('./worker.js', import.meta.url);
      worker = new Worker(url, globalThis.ATTIC_WORKER_URL ? undefined : { type: 'module' });
      worker.onmessage = e => {
        if (e.data.type === 'ready') { ready = true; queue = []; return; }
        onMessage(e.data);
      };
      worker.onerror = e => {
        e.preventDefault?.();
        if (!ready) { worker.terminate(); worker = null; startInline(); } else onMessage({ type: 'error', message: 'something went wrong while reading. try again, or with fewer files at once.' });
      };
    } catch {
      worker = null;
      startInline();
    }
  };
  start();
  return {
    post(m) {
      if (worker) { worker.postMessage(m); if (!ready) queue.push(m); } else if (inline) inline(m); else queue.push(m);
    },
    restart() {
      worker?.terminate();
      worker = null;
      inline = null;
      queue = [];
      start();
    },
  };
}

const progress = createProgress($('progress'));
const proof = setupProof({ dialog: $('proof'), open: $('proof-open'), close: $('proof-close'), count: $('proof-count') });
let found = null;

const runner = createRunner(msg => {
  if (msg.type === 'progress') progress.update(msg.p);
  else if (msg.type === 'found') {
    found = msg.found;
    renderFound({ found, root: foundEls, onShape: path => runner.post({ type: 'shape', path }), now: Date.now() });
    updateYearNote();
    if (!msg.quiet) show('found');
  } else if (msg.type === 'cards') {
    if (!msg.cards.length) {
      showError(`there is nothing from ${msg.year} in these files that attic can count. try another year.`);
      return;
    }
    deck.open(msg.cards, msg.final, msg.year);
    show('deck');
  } else if (msg.type === 'shape') {
    const shown = () => showStatus('the shape of the file is copied. paste it into the issue. it has field names and counts, never what is in them.');
    Promise.resolve(navigator.clipboard?.writeText(msg.text)).then(shown, () => showStatus(msg.text));
  } else if (msg.type === 'net') {
    proof.worker(msg.n);
  } else if (msg.type === 'error') {
    if (view === 'reading') show('landing');
    showError(msg.message);
  }
});

const foundEls = {
  rows: $('found-rows'), unknown: $('found-unknown'), notes: $('found-notes'), notesList: $('found-notes-list'),
  year: $('year'), make: $('make'),
};

function read(files) {
  proof.start();
  progress.reset();
  show('reading');
  fillZones($('zone'));
  runner.post({ type: 'read', files, timeZone: $('zone').value });
}

setupDrop({ zone: $('drop'), input: $('file-input'), onFiles: read, active: () => view === 'landing' || view === 'found' });

$('example').addEventListener('click', async () => {
  const { SAMPLE } = await import('../sample/sample.js');
  const files = SAMPLE.map(f => new File([Uint8Array.from(atob(f.data), ch => ch.charCodeAt(0))], f.name));
  read(files);
});

function updateYearNote() {
  const note = yearNote(Number($('year').value), Date.now());
  $('year-note').textContent = note;
  $('year-note').hidden = !note;
}
$('year').addEventListener('change', updateYearNote);
$('zone').addEventListener('change', () => runner.post({ type: 'zone', timeZone: $('zone').value }));
$('make').addEventListener('click', () => {
  runner.post({ type: 'make', year: Number($('year').value), timeZone: $('zone').value, now: Date.now() });
});
$('restart').addEventListener('click', () => show('landing'));

const deck = new Deck({
  root: $('deck'), stage: $('stage'), next: $('next'), prev: $('prev'), dots: $('dots'), progress: $('deck-progress'), count: $('deck-count'),
  back: $('deck-back'), keep: $('deck-keep'), save: $('card-save'), names: $('card-names'), leave: $('card-leave'), live: $('deck-live'),
}, {
  onBack: () => (found ? show('found') : show('landing')),
  onKeep: () => show('keep'),
  size: () => document.querySelector('input[name="size"]:checked').value,
});

setupKeep({
  saveAll: $('save-all'), copy: $('copy-text'), status: $('keep-status'), fallback: $('copy-fallback'),
  device: $('keep-device'), back: $('keep-back'), forget: $('forget'),
}, {
  deck,
  onBack: () => show('deck'),
  onForget: () => {
    runner.post({ type: 'forget' });
    runner.restart();
    writeKept(null);
    found = null;
    deck.open([], null, 0);
    $('keep-device').checked = false;
    $('kept').hidden = true;
    progress.reset();
    show('landing');
    showStatus('everything is forgotten. this page holds nothing now.');
  },
});

const kept = readKept();
if (kept && Array.isArray(kept.cards) && kept.cards.length) {
  $('kept').hidden = false;
  $('kept-open').addEventListener('click', () => {
    deck.open(kept.cards, null, kept.year, kept.state);
    $('keep-device').checked = true;
    show('deck');
  });
  $('kept-forget').addEventListener('click', () => { writeKept(null); $('kept').hidden = true; });
}

fillZones($('zone'));
document.body.dataset.view = 'landing';
