// Thin node:http wrapper. It wires the (pure) handler to real sockets and adds
// the cross-cutting concerns the spec asks for: CORS, artificial delay,
// optional error injection, request logging, and clean start/close. All the
// interesting logic lives in handler.mjs / db.mjs; this file stays boring.
import http from 'node:http';

import { buildCorsHeaders } from './cors.mjs';
import { createRequestHandler } from './handler.mjs';

const JSON_CT = 'application/json; charset=utf-8';

/** Decide whether to inject a synthetic 500 (for --error-rate). Pure. */
export function shouldInjectError(rate, rng = Math.random) {
  if (!rate || rate <= 0) return false;
  if (rate >= 1) return true;
  return rng() < rate;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeResponse(res, status, headers, body) {
  const h = { ...headers };
  if (body != null) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    h['Content-Length'] = String(buf.length);
    res.writeHead(status, h);
    res.end(buf);
  } else {
    h['Content-Length'] = '0';
    res.writeHead(status, h);
    res.end();
  }
}

/**
 * Create (but do not start) the http.Server.
 * @param {{
 *   getDb: () => object, setDb: (db:object)=>void,
 *   options?: object, onChange?: (db:object)=>void,
 *   logger?: (req, status:number, ms:number) => void,
 * }} ctx
 */
export function createServer(ctx) {
  const { getDb, setDb, options = {}, onChange, logger } = ctx;
  const handle = createRequestHandler({ getDb, setDb, options, onChange });
  const corsOrigin = options.cors == null ? '*' : options.cors;
  const delay = options.delay || 0;
  const errorRate = options.errorRate || 0;
  const rng = options.rng || Math.random;

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    let status = 500;
    try {
      const cors = buildCorsHeaders(corsOrigin, req.headers || {});

      if (String(req.method || '').toUpperCase() === 'OPTIONS') {
        status = 204;
        writeResponse(res, 204, cors, undefined);
        return;
      }

      if (delay > 0) await sleep(delay);

      if (shouldInjectError(errorRate, rng)) {
        status = 500;
        writeResponse(res, 500, { ...cors, 'Content-Type': JSON_CT }, JSON.stringify({ error: 'injected failure (--error-rate)' }));
        return;
      }

      const result = await handle(req);
      status = result.status;
      const headers = { ...result.headers, ...cors };

      if (result.raw) {
        writeResponse(res, status, headers, result.body);
      } else if (result.body === undefined || status === 204) {
        writeResponse(res, status, headers, undefined);
      } else {
        writeResponse(res, status, headers, JSON.stringify(result.body));
      }
    } catch {
      status = 500;
      try {
        writeResponse(res, 500, { 'Content-Type': JSON_CT }, JSON.stringify({ error: 'internal server error' }));
      } catch {
        /* response already partially sent */
      }
    } finally {
      if (logger) {
        try { logger(req, status, Date.now() - start); } catch { /* ignore */ }
      }
    }
  });

  return server;
}

function closeServer(server) {
  return new Promise((resolve) => {
    // Force-drop any keep-alive sockets so close() resolves promptly (Node 18.2+).
    try { server.closeAllConnections?.(); } catch { /* ignore */ }
    server.close(() => resolve());
  });
}

/**
 * Start listening. Resolves once bound, rejects on listen errors (EADDRINUSE).
 * @returns {Promise<{ server: import('node:http').Server, port: number, host: string, close: () => Promise<void> }>}
 */
export function startServer(ctx) {
  const server = createServer(ctx);
  const { port = 4000, host = '127.0.0.1' } = ctx.options || {};

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve({
        server,
        port: addr && typeof addr === 'object' ? addr.port : port,
        host,
        close: () => closeServer(server),
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
