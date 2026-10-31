// chatgpt: conversations.json from the data export. each conversation has a
// mapping of message nodes; this reads every visible user and assistant
// node, branches included. the shape is from memory and may drift.

import { EventStore } from '../core/store.js';
import { readJsonList } from '../core/jsonstream.js';
import { int } from '../core/templates.js';
import { parseUtc, progress } from './common.js';
import { chatCards, wordCount, hasCode } from './chat.js';

function match(f) {
  return /^conversations.*\.json$/i.test(f.name) ? 0.5 : 0;
}

function detect(files) {
  const out = [];
  for (const f of files) {
    const t = f.headText || '';
    if (/^\s*\[/.test(t) && /"mapping"\s*:/.test(t) && /"(create_time|title)"\s*:/.test(t)) out.push({ file: f, score: 0.9 });
  }
  return { files: out };
}

/** the text of a message's content, whatever its type */
export function contentText(content) {
  if (!content || typeof content !== 'object') return '';
  if (Array.isArray(content.parts)) return content.parts.filter(p => typeof p === 'string').join('\n');
  if (typeof content.text === 'string') return content.text;
  return '';
}

const HIDDEN_TYPES = new Set(['user_editable_context', 'model_editable_context', 'thoughts', 'reasoning_recap', 'system_error']);

async function parse(files, onProgress) {
  const store = new EventStore(16384);
  const notes = [];
  const texts = new Map();
  const tick = progress(onProgress, 500);
  let hidden = 0;
  for (const f of files) {
    try {
      await readJsonList(f, conv => {
        if (!conv || typeof conv !== 'object' || !conv.mapping) return;
        const convId = String(conv.conversation_id || conv.id || `${conv.create_time}:${conv.title}`);
        const convTime = parseUtc(conv.create_time);
        const title = typeof conv.title === 'string' ? conv.title : undefined;
        for (const [key, node] of Object.entries(conv.mapping)) {
          const m = node && node.message;
          if (!m || !m.author) continue;
          const role = m.author.role;
          if (role !== 'user' && role !== 'assistant') continue;
          const type = m.content && m.content.content_type;
          if (HIDDEN_TYPES.has(type) || (m.metadata && m.metadata.is_visually_hidden_from_conversation)) { hidden++; continue; }
          const text = contentText(m.content);
          const t = m.create_time ? parseUtc(m.create_time) : convTime;
          const id = String(m.id || key);
          if (store.push({
            t, kind: 'chat', title, album: convId, creator: role, id,
            meta: { words: wordCount(text), code: hasCode(text), model: role === 'assistant' ? (m.metadata && m.metadata.model_slug) || undefined : undefined },
          }) && role === 'user') texts.set(id, text);
        }
        tick.tick();
      });
    } catch (e) {
      notes.push({ path: f.path, code: e.code || 'format', message: e.code === 'truncated' ? 'this chatgpt export stops partway. the download may not have finished.' : 'this chatgpt export could not be read. it may be damaged.' });
    }
  }
  tick.done();
  if (hidden) notes.push({ code: 'hidden', message: `${int(hidden)} hidden messages, such as custom instructions, were left out.` });
  return { store, notes, extras: { texts }, count: tick.count };
}

export default {
  id: 'chatgpt',
  name: 'chatgpt',
  unit: 'conversations',
  guide: 'chatgpt',
  match,
  detect,
  parse,
  cards: (r, ctx) => chatCards(r, ctx, { id: 'chatgpt', name: 'chatgpt' }),
};
