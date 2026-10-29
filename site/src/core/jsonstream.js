// reads a json file whose top level is a list, one item at a time, so a
// list of hundreds of megabytes never has to sit in memory as one string.
// it scans bytes, not characters: every structural character is plain
// ascii, and in utf-8 no byte of a longer character is ever below 0x80.

export const STREAM_ABOVE = 80 * 1024 * 1024;

export class JsonListError extends Error {
  /** @param {'not-a-list'|'truncated'|'garbage'|'bad-item'|'empty'} code */
  constructor(code, message, offset) {
    super(message);
    this.code = code;
    this.offset = offset;
  }
}

const OPEN_OBJ = 0x7b, CLOSE_OBJ = 0x7d, OPEN_ARR = 0x5b, CLOSE_ARR = 0x5d;
const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c;
const isSpace = b => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

const START = 0, BETWEEN = 1, ITEM = 2, AFTER = 3, DONE = 4;

/**
 * push bytes in, get parsed items out through onItem.
 * @param {(item: any) => void} onItem
 */
export class JsonListSplitter {
  constructor(onItem) {
    this.onItem = onItem;
    this.state = START;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.primitive = false;
    this.parts = [];
    this.offset = 0; // bytes seen before the current chunk
    this.count = 0;
    this.decoder = new TextDecoder('utf-8');
  }

  /** @param {Uint8Array} buf */
  push(buf) {
    let i = 0;
    const n = buf.length;
    let itemStart = this.state === ITEM ? 0 : -1;
    while (i < n) {
      const b = buf[i];
      switch (this.state) {
        case START:
          // a byte order mark, even one split across chunks
          if (isSpace(b) || (this.offset + i < 3 && b === [0xef, 0xbb, 0xbf][this.offset + i])) { i++; break; }
          if (b !== OPEN_ARR) throw new JsonListError('not-a-list', 'the file is json, but not a list of items', this.offset + i);
          this.state = BETWEEN;
          i++;
          break;
        case BETWEEN:
        case AFTER:
          if (isSpace(b)) { i++; break; }
          if (b === CLOSE_ARR) { this.state = DONE; i++; break; }
          if (this.state === AFTER) {
            if (b !== COMMA) throw new JsonListError('garbage', 'unexpected text between items', this.offset + i);
            this.state = BETWEEN;
            i++;
            break;
          }
          this.state = ITEM;
          itemStart = i;
          this.depth = 0;
          this.inString = false;
          this.escape = false;
          this.primitive = b !== OPEN_OBJ && b !== OPEN_ARR && b !== QUOTE;
          if (this.primitive) break; // scan it below without consuming
          if (b === QUOTE) this.inString = true; else this.depth = 1;
          i++;
          break;
        case ITEM: {
          // the hot loop
          let depth = this.depth, inString = this.inString, escape = this.escape;
          let end = -1;
          if (this.primitive) {
            while (i < n) {
              const c = buf[i];
              if (c === COMMA || c === CLOSE_ARR || isSpace(c)) { end = i; break; }
              i++;
            }
          } else {
            while (i < n) {
              const c = buf[i++];
              if (inString) {
                if (escape) escape = false;
                else if (c === BACKSLASH) escape = true;
                else if (c === QUOTE) {
                  inString = false;
                  if (depth === 0) { end = i; break; }
                }
              } else if (c === QUOTE) inString = true;
              else if (c === OPEN_OBJ || c === OPEN_ARR) depth++;
              else if (c === CLOSE_OBJ || c === CLOSE_ARR) {
                depth--;
                if (depth === 0) { end = i; break; }
              }
            }
          }
          this.depth = depth;
          this.inString = inString;
          this.escape = escape;
          if (end !== -1) {
            this.emit(buf.subarray(itemStart, end));
            itemStart = -1;
            this.state = AFTER;
            i = end;
          }
          break;
        }
        case DONE:
          if (isSpace(b)) { i++; break; }
          throw new JsonListError('garbage', 'there is more text after the end of the list', this.offset + i);
      }
    }
    if (this.state === ITEM && itemStart !== -1) this.parts.push(buf.slice(itemStart));
    this.offset += n;
  }

  emit(tail) {
    let bytes = tail;
    if (this.parts.length) {
      this.parts.push(tail);
      let len = 0;
      for (const p of this.parts) len += p.length;
      bytes = new Uint8Array(len);
      let at = 0;
      for (const p of this.parts) { bytes.set(p, at); at += p.length; }
      this.parts = [];
    }
    let item;
    try {
      item = JSON.parse(this.decoder.decode(bytes));
    } catch {
      throw new JsonListError('bad-item', `item ${this.count + 1} is not valid json`, this.offset);
    }
    this.count++;
    this.onItem(item);
  }

  end() {
    if (this.state === START) throw new JsonListError('empty', 'the file is empty', this.offset);
    if (this.state !== DONE) throw new JsonListError('truncated', 'the file stops before the list ends. it may not have downloaded fully', this.offset);
    return this.count;
  }
}

/**
 * read every item of a json list file.
 * @param {{ size: number, chunks: () => AsyncIterable<Uint8Array>, text: () => Promise<string> }} file
 * @param {(item: any) => void} onItem
 * @param {{ streamAbove?: number, onBytes?: (n: number) => void }} [opts]
 * @returns {Promise<number>} the number of items
 */
export async function readJsonList(file, onItem, opts = {}) {
  const limit = opts.streamAbove ?? STREAM_ABOVE;
  if (file.size < limit) {
    const text = await file.text();
    if (!text.trim()) throw new JsonListError('empty', 'the file is empty', 0);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      // json.parse cannot say why. the splitter can, and it hands over every
      // item before the problem, the same as the streaming path does.
      const s = new JsonListSplitter(onItem);
      s.push(new TextEncoder().encode(text));
      s.end();
      throw new JsonListError('garbage', 'the file is not valid json', 0);
    }
    if (!Array.isArray(value)) {
      const err = new JsonListError('not-a-list', 'the file is json, but not a list of items', 0);
      err.value = value;
      throw err;
    }
    opts.onBytes?.(file.size);
    for (const item of value) onItem(item);
    return value.length;
  }
  const splitter = new JsonListSplitter(onItem);
  let seen = 0;
  for await (const chunk of file.chunks()) {
    splitter.push(chunk);
    seen += chunk.length;
    opts.onBytes?.(seen);
  }
  return splitter.end();
}

/** parse the first few items from the start of a file, for sniffing. never throws. */
export function peekJsonItems(head, max = 3) {
  const items = [];
  const s = new JsonListSplitter(item => {
    if (items.length < max) items.push(item);
  });
  try {
    s.push(head);
  } catch {
    // a partial head is expected
  }
  return items;
}
