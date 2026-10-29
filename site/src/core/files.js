// one shape for every file, whether it was dropped on its own or sits
// inside a zip: name, path, size, and ways to read the start, the whole, or
// a stream of chunks. zips are opened (and zips inside zips), and only the
// index is read until a source asks for an entry.

import { openZip, entryChunks, entryHead, looksLikeZip, ZipError } from './zip.js';

export const HEAD_BYTES = 64 * 1024;
// a zip inside a zip has to be read into memory to be opened
export const NESTED_ZIP_LIMIT = 1024 * 1024 * 1024;
const MAX_DEPTH = 3;

const IGNORED = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * @typedef {Object} FileInfo
 * @property {string} name        the file name, without folders
 * @property {string} path        where it came from, such as my_data.zip/Folder/file.json
 * @property {number} size
 * @property {string|null} archive  the outermost zip it was in, or null
 * @property {(n?: number) => Promise<Uint8Array>} head
 * @property {() => AsyncIterable<Uint8Array>} chunks
 * @property {() => Promise<Uint8Array>} bytes
 * @property {() => Promise<string>} text
 * @property {Uint8Array} [headBytes]   filled in before detection
 * @property {string} [headText]
 */

const baseName = p => p.slice(p.lastIndexOf('/') + 1);

function concat(parts, len) {
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

export function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes); // drops a leading byte order mark
}

/** decode an async stream of byte chunks into text chunks */
export async function* textChunks(file) {
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of file.chunks()) {
    const s = decoder.decode(chunk, { stream: true });
    if (s) yield s;
  }
  const rest = decoder.decode();
  if (rest) yield rest;
}

async function* blobChunks(blob) {
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** @returns {FileInfo} */
export function fromBlob(blob, name = blob.name || 'file', path = name) {
  return {
    name: baseName(name),
    path,
    size: blob.size,
    archive: null,
    async head(n = HEAD_BYTES) { return new Uint8Array(await blob.slice(0, n).arrayBuffer()); },
    chunks: () => blobChunks(blob),
    async bytes() { return new Uint8Array(await blob.arrayBuffer()); },
    async text() { return decodeText(new Uint8Array(await blob.arrayBuffer())); },
    blob,
  };
}

/** @returns {FileInfo} */
export function fromEntry(blob, entry, archivePath, archive) {
  return {
    name: baseName(entry.path),
    path: `${archivePath}/${entry.path}`,
    size: entry.size,
    archive,
    entry,
    head: (n = HEAD_BYTES) => entryHead(blob, entry, n),
    chunks: () => entryChunks(blob, entry, { verify: true }),
    async bytes() {
      const parts = [];
      let len = 0;
      for await (const c of entryChunks(blob, entry, { verify: true })) { parts.push(c); len += c.length; }
      return concat(parts, len);
    },
    async text() { return decodeText(await this.bytes()); },
  };
}

export function fromBytes(name, bytes) {
  return fromBlob(new Blob([bytes]), name);
}

/**
 * turn dropped files into a flat list of files, opening zips on the way.
 * @param {(Blob & { name?: string })[]} inputs
 * @returns {Promise<{ files: FileInfo[], notes: { path: string, code: string, message: string }[] }>}
 */
export async function expandAll(inputs) {
  const files = [];
  const notes = [];
  for (const input of inputs) {
    const file = input.head && input.chunks ? input : fromBlob(input, input.name || 'file');
    await expandOne(file, files, notes, 0, null);
  }
  return { files, notes };
}

async function expandOne(file, files, notes, depth, archive) {
  if (IGNORED.test(file.path)) return;
  const named = /\.zip$/i.test(file.name);
  // inside a zip, only entries named like a zip are opened. reading the start
  // of every entry would mean inflating thousands of photos in a takeout.
  if (depth > 0 && !named) {
    files.push(file);
    return;
  }
  let head;
  try {
    head = await file.head(8);
  } catch (e) {
    notes.push({ path: file.path, code: 'unreadable', message: unreadableMessage(e) });
    return;
  }
  if (!looksLikeZip(head)) {
    if (named && file.size > 0) {
      notes.push({ path: file.path, code: 'not-zip', message: 'this file is named like a zip, but it is not one. it may still be downloading, or it may be damaged.' });
      return;
    }
    files.push(file);
    return;
  }
  if (depth >= MAX_DEPTH) {
    notes.push({ path: file.path, code: 'too-deep', message: 'this zip sits inside too many other zips. unzip the outer ones and drop the inner file.' });
    return;
  }
  let blob = file.blob;
  if (!blob) {
    if (file.size > NESTED_ZIP_LIMIT) {
      notes.push({ path: file.path, code: 'too-large', message: 'this zip sits inside another zip and is too large to open here. unzip the outer one and drop this file on its own.' });
      return;
    }
    try {
      blob = new Blob([await file.bytes()]);
    } catch (e) {
      notes.push({ path: file.path, code: e.code || 'damaged', message: e.message });
      return;
    }
  }
  let zip;
  try {
    zip = await openZip(blob);
  } catch (e) {
    notes.push({ path: file.path, code: e instanceof ZipError ? e.code : 'damaged', message: e.message });
    return;
  }
  const top = archive || file.path;
  if (zip.damaged) {
    notes.push({ path: file.path, code: 'truncated', message: 'this zip looks cut off, maybe the download did not finish. attic read what it could.' });
  }
  const real = zip.entries.filter(e => !IGNORED.test(e.path));
  if (real.length === 0) {
    notes.push({ path: file.path, code: 'empty', message: 'this zip is empty.' });
    return;
  }
  for (const entry of real) {
    await expandOne(fromEntry(blob, entry, file.path, top), files, notes, depth + 1, top);
  }
}

export function unreadableMessage(e) {
  const name = e && e.name;
  if (name === 'NotReadableError' || name === 'NotFoundError') {
    return 'the browser could not read this file. if it belongs to a program that is still open, such as a browser history file, close that program or copy the file first.';
  }
  return 'the browser could not read this file.';
}
