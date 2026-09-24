# mockit — build instructions

> Self-contained build spec. A fresh session should be able to build, test, and ship this tool by following this file top to bottom. Do not add runtime dependencies.

| Field | Value |
| --- | --- |
| Product name | **mockit** |
| Tagline | *Spin up a fake REST API from a tiny JSON file — in one command.* |
| Folder id | `star-tool6-mockit` |
| Intended repo / npm name | `mockit` is likely taken → prefer `mockit-cli` / `mockrest` / `jsonmock-cli` (verify all) |
| Status | Planned |
| License | MIT |

---

## 1. Problem & audience
Frontend devs constantly need a backend that doesn't exist yet. Existing tools are either heavy, require config gymnastics, or pull big dependency trees. People want: point at a JSON file, get real REST endpoints with CRUD, instantly.

**Audience:** frontend/mobile devs, prototypers, hackathon teams, teachers/demos.

## 2. Why it earns stars
- "One file → full CRUD API in one command" is an immediately graspable, high-value hook.
- **Zero dependencies** is a differentiator versus popular but dependency-heavy alternatives.
- Copy-paste quickstart delivers value in seconds.

## 3. Scope
**MVP**
- `mockit db.json` reads a JSON object of collections and serves REST:
  - `GET /posts`, `GET /posts/:id`, `POST /posts`, `PUT/PATCH /posts/:id`, `DELETE /posts/:id`.
- In-memory by default; `--persist` writes changes back to the file (debounced).
- Query support: filtering (`?title=foo`), pagination (`?_page=1&_limit=10`), sort (`?_sort=id&_order=desc`).
- CORS enabled for local dev; JSON body parsing (manual, no `body-parser`).

**Stretch**
- `--watch` reloads on file change (`fs.watch`).
- Custom routes file (`routes.json`) for rewrites.
- Latency/`--delay <ms>` and `--error-rate` to simulate flaky networks (great for testing UIs).
- Static file serving from `./public`.
- Simple `--seed <n>` generator for fake records (no faker dep — small built-in word/number lists).

**Non-goals**
- Not a production server. No auth framework, no DB engine. Local-dev tool only.

## 4. Tech & constraints
- Node **>= 18**, ESM, **zero runtime deps** — use the built-in `node:http`.
- `node:fs`, `node:url` for routing/query parsing.
- Entry `bin/mockit.mjs`.

## 5. CLI / UX design
```
Usage: mockit <db.json> [options]

Options:
  -p, --port <n>    Port (default: 4000)
  -H, --host <h>    Host to bind (default: 127.0.0.1)
      --persist     Write changes back to the JSON file
      --watch       Reload when the file changes
      --delay <ms>  Add artificial latency
      --cors <o>    CORS origin (default: *)
  -h, --help
  -v, --version
```

Example:
```
$ npx mockit db.json
mockit serving http://127.0.0.1:4000  (in-memory)
routes:
  GET|POST         /posts
  GET|PUT|PATCH|DELETE  /posts/:id
  GET|POST         /users
Ctrl+C to stop
```

`db.json`:
```json
{ "posts": [{ "id": 1, "title": "hello" }], "users": [{ "id": 1, "name": "Ada" }] }
```

## 6. Architecture & file layout
```
mockit/
  bin/mockit.mjs
  src/server.mjs     # node:http server, request lifecycle
  src/router.mjs     # pure: (method, url, db) -> {status, body}
  src/query.mjs      # pure: filter/sort/paginate an array from query params
  src/db.mjs         # load/save JSON, id generation, debounce persist
  src/args.mjs
  test/router.test.mjs
  test/query.test.mjs
  package.json
  README.md
  LICENSE
  CONTRIBUTING.md
  .github/workflows/ci.yml
  .gitignore
```

## 7. Implementation steps
1. Scaffold package.json/bin/license/gitignore.
2. `db.mjs`: load JSON, validate it's an object of arrays; next-id per collection; debounced save when `--persist`.
3. `router.mjs`: **pure** function mapping (method,path,parsed-body,db) → {status, body}. Handles collection + item routes + 404/405. Unit-test thoroughly.
4. `query.mjs`: **pure** filter/sort/paginate. Tested.
5. `server.mjs`: `node:http`, manual JSON body read (with a size cap), CORS headers, delay, wire router, pretty request logging.
6. `args.mjs`; wire `bin`; print route table on boot.
7. Stretch: `--watch`, `--delay`, seed.
8. Tests + CI + README + GIF.

## 8. Edge cases & safety
- **Bind to `127.0.0.1` by default** — do not expose on `0.0.0.0` unless the user explicitly passes `--host`. Document loudly: **mockit is an unauthenticated local dev server; never use it in production or expose it to a network.**
- Cap request body size (e.g., 5MB) to avoid memory blowups; reject malformed JSON with 400.
- `--persist` writes atomically (temp file + rename) and is debounced to avoid clobbering.
- Sanitize collection names from the URL (alphanumeric/`-`/`_`) before touching the db object (prototype-pollution guard: reject `__proto__`, `constructor`, `prototype` keys in bodies).
- Missing/invalid `db.json` → clear error + example, exit non-zero.
- Port in use → suggest `--port` (and, cheekily, `npx portkill <port>`).

## 9. Testing plan (`node --test`)
- `router`: list/read/create/update/delete happy paths + 404 for missing id + 405 for bad method.
- Create assigns a new id; delete removes; PATCH merges vs PUT replaces.
- `query`: filter by field, `_page/_limit`, `_sort/_order`.
- Prototype-pollution body rejected.

## 10. README outline
Badges → "need a backend now" pain → `npx mockit db.json` + route table screenshot → query examples → **security note (local only, no auth)** → options → install → contributing → license.

## 11. Distribution
`npm publish` (final name TBD after availability check), bin + shebang, tag, Release with GIF.

## 12. Launch checklist
GIF: file → running API → curl CRUD → Show HN → r/webdev, r/reactjs, r/node, r/frontend → dev.to → add to `awesome-zero-dependency`.

## 13. Definition of Done + star-magnet checklist
- [ ] Full CRUD from a single JSON file; query/sort/paginate work.
- [ ] Binds to localhost by default; security note in README + boot log.
- [ ] Body size cap + prototype-pollution guard.
- [ ] Zero dependencies (node:http only).
- [ ] CI green; tests pass; published; listed in awesome list.
