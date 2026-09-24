// The in-memory "database".
//
// Two clearly separated halves:
//   1. PURE reducers (state -> new state) for REST operations. They never mutate
//      their input, so they are trivial to unit-test and are the most-tested
//      part of mockit.
//   2. Impure persistence helpers (atomic write + debounced persister) used only
//      when --persist is on. They live here per the spec but are kept apart from
//      the pure core.
import { writeFile, rename } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';

import { queryCollection } from './query.mjs';

export const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const COLLECTION_NAME_RE = /^[A-Za-z0-9_-]+$/;

/* ------------------------------------------------------------------ *
 * Validation + shared helpers
 * ------------------------------------------------------------------ */

export function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** Does a plain object contain a prototype-pollution key at the top level? */
export function hasUnsafeKey(obj) {
  if (!isPlainObject(obj)) return false;
  return Object.keys(obj).some((k) => UNSAFE_KEYS.has(k));
}

/** Compare ids loosely so numeric 1 and string "1" from the URL match. */
export function sameId(a, b) {
  return String(a) === String(b);
}

/** Validate a parsed value as a db (object of arrays). @returns {{db, error}} */
export function validateDb(data) {
  if (!isPlainObject(data)) {
    return { db: null, error: 'db must be a JSON object of collections, e.g. { "posts": [ ... ] }' };
  }
  const db = {};
  for (const key of Object.keys(data)) {
    if (UNSAFE_KEYS.has(key)) {
      return { db: null, error: `illegal collection name "${key}"` };
    }
    if (!COLLECTION_NAME_RE.test(key)) {
      return { db: null, error: `illegal collection name "${key}" (use letters, numbers, "-" and "_")` };
    }
    const value = data[key];
    if (!Array.isArray(value)) {
      const got = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      return { db: null, error: `collection "${key}" must be an array (got ${got})` };
    }
    db[key] = value;
  }
  return { db, error: null };
}

/** Parse + validate raw db file text. @returns {{db, error}} */
export function parseDb(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { db: null, error: `invalid JSON: ${err.message}` };
  }
  return validateDb(data);
}

export function hasCollection(db, name) {
  return Object.prototype.hasOwnProperty.call(db, name);
}

export function collectionNames(db) {
  return Object.keys(db);
}

/** A `{ collection: count }` summary used for the GET / resource index. */
export function collectionSummary(db) {
  const out = {};
  for (const name of Object.keys(db)) out[name] = (db[name] || []).length;
  return out;
}

/* ------------------------------------------------------------------ *
 * PURE reducers  (state -> new state)
 * ------------------------------------------------------------------ */

/** Next numeric auto-increment id for a collection (1 when empty). */
export function nextId(items) {
  let max = 0;
  for (const it of items || []) {
    if (!it) continue;
    if (typeof it.id === 'number' && Number.isFinite(it.id)) {
      if (it.id > max) max = it.id;
    } else if (typeof it.id === 'string' && /^\d+$/.test(it.id)) {
      const n = Number(it.id);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

export function findRecord(items, id) {
  return (items || []).find((r) => r && sameId(r.id, id));
}

/** GET /collection — filter/sort/paginate. Read-only. */
export function listRecords(db, collection, params = {}) {
  return queryCollection(db[collection] || [], params);
}

/** GET /collection/:id — a single record or null. Read-only. */
export function getRecord(db, collection, id) {
  return findRecord(db[collection] || [], id) || null;
}

/** POST /collection — append a record, assigning an id when absent. */
export function createRecord(db, collection, body) {
  const items = db[collection] || [];
  const record = { ...body };
  if (record.id === undefined || record.id === null || record.id === '') {
    record.id = nextId(items);
  } else if (findRecord(items, record.id)) {
    return {
      db,
      record: null,
      error: 'conflict',
      message: `a record with id ${JSON.stringify(record.id)} already exists in "${collection}"`,
    };
  }
  const newDb = { ...db, [collection]: [...items, record] };
  return { db: newDb, record, error: null };
}

/** PUT /collection/:id — replace a record wholesale (id is preserved). */
export function replaceRecord(db, collection, id, body) {
  const items = db[collection] || [];
  const idx = items.findIndex((r) => r && sameId(r.id, id));
  if (idx === -1) return { db, record: null, error: 'not_found' };
  const record = { ...body, id: items[idx].id };
  const newItems = items.slice();
  newItems[idx] = record;
  return { db: { ...db, [collection]: newItems }, record, error: null };
}

/** PATCH /collection/:id — shallow-merge into a record (id is preserved). */
export function patchRecord(db, collection, id, body) {
  const items = db[collection] || [];
  const idx = items.findIndex((r) => r && sameId(r.id, id));
  if (idx === -1) return { db, record: null, error: 'not_found' };
  const record = { ...items[idx], ...body, id: items[idx].id };
  const newItems = items.slice();
  newItems[idx] = record;
  return { db: { ...db, [collection]: newItems }, record, error: null };
}

/** DELETE /collection/:id — remove a record. */
export function deleteRecord(db, collection, id) {
  const items = db[collection] || [];
  const idx = items.findIndex((r) => r && sameId(r.id, id));
  if (idx === -1) return { db, record: null, error: 'not_found' };
  const record = items[idx];
  const newItems = items.slice(0, idx).concat(items.slice(idx + 1));
  return { db: { ...db, [collection]: newItems }, record, error: null };
}

/* ------------------------------------------------------------------ *
 * Impure persistence (only used with --persist)
 * ------------------------------------------------------------------ */

/** Write JSON atomically: to a temp file in the same dir, then rename over. */
export async function atomicWriteJson(file, data) {
  const tmp = join(dirname(file), `.${basename(file)}.${randomBytes(6).toString('hex')}.tmp`);
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

/**
 * Create a debounced persister. Timers are unref'd so a pending write never
 * keeps the process alive; call flush() on shutdown to force the last write.
 * The timer functions are injectable for deterministic testing.
 */
export function createPersister(opts = {}) {
  const {
    file,
    delay = 300,
    write = atomicWriteJson,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = opts;
  let timer = null;
  let pending = null;

  async function flush() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    if (pending == null) return;
    const data = pending;
    pending = null;
    await write(file, data);
  }

  return {
    schedule(data) {
      pending = data;
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        Promise.resolve(flush()).catch(() => {});
      }, delay);
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    flush,
    cancel() {
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      pending = null;
    },
    get hasPending() {
      return pending != null;
    },
  };
}
