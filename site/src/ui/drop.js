// the drop zone: files, zips and whole folders, dropped anywhere on the
// page or chosen with the button.

/** every file in a dropped folder, recursively */
async function filesOfEntry(entry, path = '') {
  if (entry.isFile) {
    return [await new Promise((res, rej) => entry.file(f => res(f), rej))];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const out = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) out.push(...await filesOfEntry(e, `${path}${entry.name}/`));
  }
  return out;
}

async function filesOfDrop(dt) {
  const items = [...(dt.items || [])].filter(i => i.kind === 'file');
  const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.length && entries.every(Boolean)) {
    const out = [];
    for (const e of entries) out.push(...await filesOfEntry(e));
    return out;
  }
  return [...(dt.files || [])];
}

/**
 * @param {{ zone: HTMLElement, input: HTMLInputElement, onFiles: (files: File[]) => void, active: () => boolean }} opts
 */
export function setupDrop({ zone, input, onFiles, active }) {
  let depth = 0;
  const on = () => { zone.classList.add('over'); document.body.classList.add('dragging'); };
  const off = () => { zone.classList.remove('over'); document.body.classList.remove('dragging'); };
  window.addEventListener('dragenter', e => {
    if (!active() || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    depth++;
    on();
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) off();
  });
  window.addEventListener('dragover', e => {
    if (!active()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', async e => {
    if (!active()) return;
    e.preventDefault();
    depth = 0;
    off();
    const files = await filesOfDrop(e.dataTransfer);
    if (files.length) onFiles(files);
  });
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) onFiles(files);
  });
}
