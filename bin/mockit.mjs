#!/usr/bin/env node
// jsonmock-cli — spin up a fake REST API from a tiny JSON file, in one command.
// (Specced as "mockit"; published as jsonmock-cli because mockit/mockit-cli/
// mockrest were already taken on npm.) Zero runtime dependencies.
import { readFileSync } from 'node:fs';
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { parseArgs, HELP } from '../src/args.mjs';
import { parseDb, createPersister } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';
import { makeStyler, colorEnabled, formatRoutes } from '../src/ui.mjs';

const PROG = 'jsonmock-cli';

const EXAMPLE_DB = `  {
    "posts": [{ "id": 1, "title": "hello world" }],
    "users": [{ "id": 1, "name": "Ada" }]
  }`;

function getVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** A host is "local" when it only accepts loopback connections. */
export function isLoopbackHost(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1' || h.startsWith('127.');
}

function makeLogger(c, quiet) {
  if (quiet) return null;
  return (req, status, ms) => {
    const method = String(req.method || '?').toUpperCase().padEnd(6);
    const url = req.url || '';
    const color = status >= 500 ? c.red : status >= 400 ? c.yellow : status >= 300 ? c.cyan : c.green;
    process.stdout.write(`  ${c.dim(new Date().toTimeString().slice(0, 8))}  ${method} ${color(String(status))}  ${url}  ${c.dim(`${ms}ms`)}\n`);
  };
}

function printExposureWarning(c, host, port) {
  const bar = '!'.repeat(64);
  process.stderr.write(`${c.yellow(bar)}\n`);
  process.stderr.write(`${c.yellow('!!')} ${c.bold(c.red('WARNING: exposing an UNAUTHENTICATED mock server on the network'))}\n`);
  process.stderr.write(`${c.yellow('!!')} Binding to ${c.bold(`${host}:${port}`)} means anyone who can reach this host can\n`);
  process.stderr.write(`${c.yellow('!!')} read and modify your mock data. ${PROG} has no auth. Use only on a\n`);
  process.stderr.write(`${c.yellow('!!')} trusted network, and never in production.\n`);
  process.stderr.write(`${c.yellow(bar)}\n\n`);
}

function printBanner(c, handle, opts, dbPath, db) {
  const collections = Object.keys(db);
  const mode = opts.persist ? `persisting to ${shortPath(dbPath)}` : 'in-memory';
  const url = `http://${displayHost(opts.host)}:${handle.port}`;
  process.stdout.write(`\n${c.bold(c.green(PROG))} ${c.dim(getVersion())}  \u2192  ${c.bold(c.cyan(url))}   ${c.dim(`(${mode})`)}\n`);
  process.stdout.write(`${c.dim(`serving ${collections.length} collection${collections.length === 1 ? '' : 's'} from ${shortPath(dbPath)}`)}\n\n`);
  if (collections.length) {
    process.stdout.write(`${c.dim('routes:')}\n${formatRoutes(collections, c)}\n`);
    process.stdout.write(`  ${c.cyan('GET'.padEnd(20))}  ${c.bold('/')}   ${c.dim('resource index')}\n\n`);
  } else {
    process.stdout.write(`${c.yellow('  (no collections found in the db file)')}\n\n`);
  }
  process.stdout.write(`${c.dim('local dev only \u00b7 unauthenticated \u00b7 press Ctrl+C to stop')}\n`);
}

function displayHost(host) {
  return isLoopbackHost(host) && host !== 'localhost' ? '127.0.0.1' : host;
}

function shortPath(p) {
  const cwd = process.cwd();
  return p.startsWith(cwd) ? `.${p.slice(cwd.length)}` : p;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const c = makeStyler(colorEnabled());

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`${PROG} ${getVersion()}\n`);
    return 0;
  }
  if (opts.errors.length) {
    for (const e of opts.errors) process.stderr.write(`${c.red('error:')} ${e}\n`);
    process.stderr.write(`\nRun ${c.cyan(`${PROG} --help`)} for usage.\n`);
    return 2;
  }
  if (!opts.file) {
    process.stderr.write(`${c.red('error:')} no db file given\n\n`);
    process.stderr.write(`Usage: ${c.cyan(`${PROG} <db.json> [options]`)}\n`);
    process.stderr.write(`Run ${c.cyan(`${PROG} --help`)} for details.\n`);
    return 2;
  }

  // --- Load + validate the db file ---
  const dbPath = resolve(opts.file);
  let raw;
  try {
    raw = readFileSync(dbPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      process.stderr.write(`${c.red('error:')} file not found: ${opts.file}\n\n`);
      process.stderr.write(`Create a tiny JSON file first, e.g. ${c.cyan('db.json')}:\n${EXAMPLE_DB}\n`);
    } else if (err && err.code === 'EISDIR') {
      process.stderr.write(`${c.red('error:')} ${opts.file} is a directory, not a JSON file\n`);
    } else {
      process.stderr.write(`${c.red('error:')} cannot read ${opts.file}: ${err.message}\n`);
    }
    return 1;
  }

  const { db, error } = parseDb(raw);
  if (error) {
    process.stderr.write(`${c.red('error:')} ${opts.file}: ${error}\n\n`);
    process.stderr.write(`Expected an object of arrays, e.g.:\n${EXAMPLE_DB}\n`);
    return 1;
  }

  // --- Optional rewrites (routes.json) ---
  let rewrites = null;
  if (opts.routes) {
    try {
      const robj = JSON.parse(readFileSync(resolve(opts.routes), 'utf8'));
      if (!robj || typeof robj !== 'object' || Array.isArray(robj)) {
        throw new Error('routes file must be a JSON object of { "pattern": "target" }');
      }
      rewrites = Object.entries(robj).map(([k, v]) => [k, String(v)]);
    } catch (err) {
      process.stderr.write(`${c.red('error:')} cannot load routes file ${opts.routes}: ${err.message}\n`);
      return 1;
    }
  }

  const staticDir = opts.static ? resolve(opts.static) : null;

  // --- In-memory state + optional persistence ---
  let state = db;
  const getDb = () => state;
  const setDb = (next) => { state = next; };

  let persister = null;
  if (opts.persist) persister = createPersister({ file: dbPath });
  const onChange = persister ? (next) => persister.schedule(next) : null;

  // --- Safety: warn loudly before exposing beyond localhost ---
  if (opts.hostExplicit && !isLoopbackHost(opts.host)) {
    printExposureWarning(c, opts.host, opts.port);
  }

  const options = {
    port: opts.port,
    host: opts.host,
    cors: opts.cors,
    delay: opts.delay,
    errorRate: opts.errorRate,
    staticDir,
    rewrites,
  };
  const logger = makeLogger(c, opts.quiet);

  let handle;
  try {
    handle = await startServer({ getDb, setDb, options, onChange, logger });
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      process.stderr.write(`${c.red('error:')} port ${c.bold(String(opts.port))} is already in use.\n`);
      process.stderr.write(`  try another port:  ${c.cyan(`${PROG} ${opts.file} --port ${opts.port + 1}`)}\n`);
      process.stderr.write(`  or free this one:  ${c.cyan(`npx portkill ${opts.port}`)}\n`);
      return 1;
    }
    if (err && (err.code === 'EACCES' || err.code === 'EADDRNOTAVAIL')) {
      process.stderr.write(`${c.red('error:')} cannot bind ${opts.host}:${opts.port} (${err.code}).\n`);
      return 1;
    }
    process.stderr.write(`${c.red('error:')} could not start server: ${err && err.message ? err.message : err}\n`);
    return 1;
  }

  printBanner(c, handle, opts, dbPath, state);

  // --- Optional: reload on file change (ignored while persisting) ---
  let watcher = null;
  let watchTimer = null;
  if (opts.watch && !opts.persist) {
    try {
      watcher = watch(dbPath, () => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          try {
            const reloaded = parseDb(readFileSync(dbPath, 'utf8'));
            if (reloaded.error) {
              process.stdout.write(`${c.yellow('watch:')} ignoring invalid db (${reloaded.error})\n`);
            } else {
              setDb(reloaded.db);
              process.stdout.write(`${c.dim('watch: reloaded ' + shortPath(dbPath))}\n`);
            }
          } catch { /* file briefly missing during save; ignore */ }
        }, 150);
        if (watchTimer && typeof watchTimer.unref === 'function') watchTimer.unref();
      });
    } catch { /* watch is best-effort */ }
  } else if (opts.watch && opts.persist) {
    process.stdout.write(`${c.yellow('note:')} --watch is ignored while --persist is on (mockit owns the file).\n`);
  }

  // --- Wait for Ctrl+C, then shut down cleanly ---
  await new Promise((resolveWait) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      process.stdout.write(`\n${c.dim('shutting down\u2026')}\n`);
      if (watchTimer) clearTimeout(watchTimer);
      if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
      if (persister) {
        try { await persister.flush(); } catch { /* ignore */ }
        persister.cancel();
      }
      try { await handle.close(); } catch { /* ignore */ }
      resolveWait();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });

  return 0;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
