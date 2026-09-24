// The request handler.
//
// The heart is `computeResponse` — a PURE function of (request, db, options)
// returning { status, headers, body, db }. It touches no sockets and no disk,
// so every method/status/shape is unit-testable with plain objects.
//
// `createRequestHandler` wraps it with the small amount of I/O a real request
// needs: reading the body (with a size cap) and the optional static-file
// fallback. The node:http plumbing itself lives in server.mjs.
import { stat, readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

import { matchRoute, applyRewrites } from './router.mjs';
import {
  isPlainObject,
  hasUnsafeKey,
  listRecords,
  getRecord,
  createRecord,
  replaceRecord,
  patchRecord,
  deleteRecord,
  collectionSummary,
} from './db.mjs';

export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
const JSON_CT = 'application/json; charset=utf-8';

function json(status, body, extra, db) {
  return { status, headers: { 'Content-Type': JSON_CT, ...(extra || {}) }, body, db };
}

function methodNotAllowed(allowed, db) {
  return {
    status: 405,
    headers: { 'Content-Type': JSON_CT, Allow: allowed.join(', ') },
    body: { error: 'method not allowed', allow: allowed },
    db,
  };
}

function notFoundItem(match, db) {
  return json(404, { error: `no item in "${match.collection}" with id ${JSON.stringify(match.id)}` }, null, db);
}

/** Reject invalid write bodies; returns a response or null when the body is OK. */
function invalidBody(body, db) {
  if (!isPlainObject(body)) {
    return json(400, { error: 'request body must be a JSON object' }, null, db);
  }
  if (hasUnsafeKey(body)) {
    return json(400, { error: 'request body contains a forbidden key (__proto__, prototype, constructor)' }, null, db);
  }
  return null;
}

/**
 * Pure response computation.
 * @param {{ method:string, pathname:string, query?:object, body?:any }} request
 * @param {object} db current in-memory db
 * @param {{ rewrites?: Array<[string,string]> }} [options]
 * @returns {{ status:number, headers:object, body:any, db:object }}
 */
export function computeResponse(request, db, options = {}) {
  const method = String(request.method || 'GET').toUpperCase();
  let pathname = request.pathname || '/';
  const query = request.query || {};
  const body = request.body;

  if (options.rewrites) pathname = applyRewrites(pathname, options.rewrites);

  const collections = Object.keys(db);
  const match = matchRoute(method, pathname, collections);

  switch (match.kind) {
    case 'root':
      if (method === 'GET') return json(200, collectionSummary(db), null, db);
      return methodNotAllowed(['GET'], db);

    case 'unknown':
      return json(404, { error: `no such collection "${match.collection}"`, collections }, null, db);

    case 'notfound':
      return json(404, { error: 'not found' }, null, db);

    case 'collection': {
      if (method === 'GET') {
        const { items, total } = listRecords(db, match.collection, query);
        return json(200, items, { 'X-Total-Count': String(total) }, db);
      }
      if (method === 'POST') {
        const bad = invalidBody(body, db);
        if (bad) return bad;
        const res = createRecord(db, match.collection, body);
        if (res.error === 'conflict') return json(409, { error: res.message }, null, db);
        return json(201, res.record, { Location: `/${match.collection}/${res.record.id}` }, res.db);
      }
      return methodNotAllowed(['GET', 'POST'], db);
    }

    case 'item': {
      if (method === 'GET') {
        const record = getRecord(db, match.collection, match.id);
        return record ? json(200, record, null, db) : notFoundItem(match, db);
      }
      if (method === 'PUT') {
        const bad = invalidBody(body, db);
        if (bad) return bad;
        const res = replaceRecord(db, match.collection, match.id, body);
        return res.error ? notFoundItem(match, db) : json(200, res.record, null, res.db);
      }
      if (method === 'PATCH') {
        const bad = invalidBody(body, db);
        if (bad) return bad;
        const res = patchRecord(db, match.collection, match.id, body);
        return res.error ? notFoundItem(match, db) : json(200, res.record, null, res.db);
      }
      if (method === 'DELETE') {
        const res = deleteRecord(db, match.collection, match.id);
        return res.error ? notFoundItem(match, db) : json(200, {}, null, res.db);
      }
      return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE'], db);
    }

    default:
      return json(404, { error: 'not found' }, null, db);
  }
}

/* ------------------------------------------------------------------ *
 * Body reading + query parsing (small, injectable I/O)
 * ------------------------------------------------------------------ */

/** Turn a URLSearchParams / query string into a plain object (last value wins). */
export function parseQuery(search) {
  const sp = search instanceof URLSearchParams ? search : new URLSearchParams(search || '');
  const params = {};
  for (const [k, v] of sp.entries()) params[k] = v;
  return params;
}

/** Parse a JSON body string. Empty body -> undefined. @returns {{value, error}} */
export function parseJsonBody(text) {
  if (text == null || String(text).trim() === '') return { value: undefined, error: null };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (err) {
    return { value: undefined, error: `invalid JSON body: ${err.message}` };
  }
}

/**
 * Read a request stream into a string, rejecting once it exceeds `maxBytes`.
 * Works with any Readable-like emitter, so it is testable without sockets.
 * @returns {Promise<string>}
 */
export function readBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const cleanup = () => {
      if (typeof req.off === 'function') {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onErr);
      }
    };
    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buf.length;
      if (size > maxBytes) {
        // Stop reading; TCP backpressure prevents further memory growth. We do
        // NOT destroy the socket here so the caller can still send a clean 413.
        cleanup();
        const err = new Error('request body too large');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const onErr = (err) => {
      cleanup();
      reject(err);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onErr);
  });
}

/* ------------------------------------------------------------------ *
 * Static file serving (path-traversal safe)
 * ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export function contentTypeFor(filePath) {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a URL pathname to an absolute file path inside baseDir, or null when
 * the request would escape the base directory (path traversal). PURE.
 */
export function resolveStaticPath(baseDir, urlPathname) {
  const base = resolve(baseDir);
  let rel;
  try {
    rel = decodeURIComponent(String(urlPathname || ''));
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  rel = rel.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  const target = resolve(base, rel);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

async function tryServeStatic(staticDir, pathname) {
  const filePath = resolveStaticPath(staticDir, pathname);
  if (!filePath) return null;
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return null;
    const buf = await readFile(filePath);
    return { status: 200, headers: { 'Content-Type': contentTypeFor(filePath) }, body: buf, raw: true };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Handler factory
 * ------------------------------------------------------------------ */

/**
 * Build an async request handler around the pure core + injected state.
 * @param {{
 *   getDb: () => object,
 *   setDb: (db: object) => void,
 *   options?: object,
 *   onChange?: (db: object) => void,
 * }} ctx
 * @returns {(req: import('node:http').IncomingMessage) => Promise<{status:number, headers:object, body:any, raw?:boolean}>}
 */
export function createRequestHandler(ctx) {
  const { getDb, setDb, options = {}, onChange } = ctx;
  const maxBytes = options.maxBodyBytes || MAX_BODY_BYTES;

  return async function handle(req) {
    const method = String(req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const query = parseQuery(url.searchParams);

    let body;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      let text;
      try {
        text = await readBody(req, maxBytes);
      } catch (err) {
        if (err && err.code === 'BODY_TOO_LARGE') {
          return { ...json(413, { error: `request body exceeds the ${maxBytes}-byte limit` }, { Connection: 'close' }, getDb()), raw: false };
        }
        return { ...json(400, { error: 'failed to read request body' }, null, getDb()), raw: false };
      }
      const parsed = parseJsonBody(text);
      if (parsed.error) return { ...json(400, { error: parsed.error }, null, getDb()), raw: false };
      body = parsed.value;
    }

    const db = getDb();
    const result = computeResponse({ method, pathname, query, body }, db, options);

    if (result.db && result.db !== db) {
      setDb(result.db);
      if (onChange) onChange(result.db);
    }

    if (result.status === 404 && method === 'GET' && options.staticDir) {
      const served = await tryServeStatic(options.staticDir, pathname);
      if (served) return served;
    }

    return { status: result.status, headers: result.headers, body: result.body, raw: false };
  };
}
