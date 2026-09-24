# Contributing to jsonmock-cli

Thanks for helping! jsonmock-cli (a.k.a. **mockit**) is a small,
**zero-dependency** Node CLI, and the goal is to keep it that way: fast,
obvious, and cross-platform.

## Principles

- **No runtime dependencies.** Everything uses Node built-ins (`node:http`,
  `node:fs`, `node:path`, `node:url`, `node:crypto`). PRs that add a dependency
  will be asked to remove it — no express, json-server, cors, or nanoid; we
  implement routing, body parsing, CORS and id generation ourselves.
- **The core is pure.** The db reducers (`src/db.mjs`), the query engine
  (`src/query.mjs`), the router (`src/router.mjs`), the CORS builder
  (`src/cors.mjs`) and `computeResponse` (`src/handler.mjs`) are all pure
  functions of their inputs. That's what makes them easy to test without sockets
  or disk. Keep side effects (the `node:http` plumbing, file persistence) at the
  edges in `src/server.mjs` / the handler wrapper.
- **Safe by default.** Localhost-only binding, a request body size cap, a
  prototype-pollution guard, and path-traversal-safe static serving are
  load-bearing — don't regress them.

## Getting started

```bash
git clone https://github.com/rishbCLN/jsonmock-cli.git
cd jsonmock-cli
node --test                     # run the suite
node bin/mockit.mjs db.json     # try it against a JSON file
```

There's nothing to install — no `npm install` step.

## Tests

We use the Node built-in test runner (`node:test` + `node:assert/strict`):

```bash
node --test
```

When adding behaviour:

1. Prefer testing the **pure** function directly (reducer, router match, query,
   CORS header, or `computeResponse`) with plain objects.
2. Body-size limits and JSON parsing are tested against a fake `Readable`, not a
   real socket.
3. If you must test the wired server, listen on `127.0.0.1:0` (an ephemeral
   port), make one request, and **always** close it in a `try/finally` so the
   test process exits. Tests must never hang or leak a server/port.

## Before you open a PR

- Run `node --test` — CI runs the same on Windows, macOS, and Linux across Node
  18/20/22.
- Keep the change focused and update the README if you touch the CLI surface.
- Keep it dependency-free.

## Ideas / good first issues

- More query operators (e.g. `_start`/`_end`, full-text `q`).
- Nested routes (`/posts/1/comments`).
- A `--seed <n>` fake-data generator (built-in word lists, no faker dependency).
- A short demo GIF for the README.
