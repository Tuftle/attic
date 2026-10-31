// claude: conversations.json from the data export. a list of
// conversations, each with its chat_messages. the least certain format in
// attic: written from memory, with several aliases for every field.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { parseUtc, field, progress } from './common.js';
import { chatCards, wordCount, hasCode } from './chat.js';

function match(f) {
  return /^conversations.*\.json$/i.test(f.name) ? 0.5 : 0;
}

function detect(files) {
  const out = [];
  for (const f of files) {
    const t = f.headText || '';
    if (/^\s*\[/.test(t) && /"chat_messages"\s*:/.test(t)) out.push({ file: f, score: 0.9 });
  }
  return { files: out };
}

/** the text of a message: its text field, or the text parts of its content */
export function messageText(m) {
  if (Array.isArray(m.content) && m.content.length) {
    const parts = m.content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text);
    if (parts.length) return parts.join('\n');
  }
  return typeof m.text === 'string' ? m.text : '';
}

const ROLES = { human: 'user', user: 'user', assistant: 'assistant', claude: 'assistant' };

async function parse(files, onProgress) {
  const store = new EventStore(16384);
  const notes = [];
  const texts = new Map();
  const tick = progress(onProgress, 500);
  for (const f of files) {
    try {
      await readJsonList(f, conv => {
        if (!conv || typeof conv !== 'object' || !Array.isArray(conv.chat_messages)) return;
        const convId = String(field(conv, ['uuid', 'id']) || `${conv.created_at}:${conv.name}`);
        const title = typeof conv.name === 'string' && conv.name ? conv.name : undefined;
        const convTime = parseUtc(field(conv, ['created_at', 'createdAt']));
        for (const m of conv.chat_messages) {
          if (!m || typeof m !== 'object') continue;
          const role = ROLES[String(field(m, ['sender', 'role']) || '').toLowerCase()];
          if (!role) continue;
          const text = messageText(m);
          const t = parseUtc(field(m, ['created_at', 'createdAt'])) || convTime;
          const id = String(field(m, ['uuid', 'id']) || `${convId}:${t}:${role}`);
          if (store.push({ t, kind: 'chat', title, album: convId, creator: role, id, meta: { words: wordCount(text), code: hasCode(text) } }) && role === 'user') texts.set(id, text);
        }
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'truncated' ? 'this claude export stops partway. the download may not have finished.' : 'this claude export could not be read. it may be damaged.' });
    }
  }
  tick.done();
  return { store, notes, extras: { texts }, count: tick.count };
}

export default {
  id: 'claude',
  name: 'claude',
  unit: 'conversations',
  guide: 'claude',
  match,
  detect,
  parse,
  cards: (r, ctx) => chatCards(r, ctx, { id: 'claude', name: 'claude' }),
};
