# jsonmock-cli

[![CI](https://github.com/rishbCLN/jsonmock-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/rishbCLN/jsonmock-cli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/jsonmock-cli.svg)](https://www.npmjs.com/package/jsonmock-cli)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Spin up a fake REST API from a tiny JSON file — in one command.**

You're building a frontend and the backend doesn't exist yet. You just want
`GET /posts`, `POST /posts`, `GET /posts/:id`… working *now*, without standing up
a server, wiring a router, or pulling in a tree of dependencies.

```bash
npx jsonmock-cli db.json
```

Point it at a JSON file and you instantly get a full CRUD REST API — filtering,
sorting, pagination and CORS included. **Zero dependencies. No config. No account.**
Just Node 18+.

<!-- Add a short demo GIF here once recorded: ![demo](docs/demo.gif) -->

> Originally specced as **mockit**; published as `jsonmock-cli` because
> `mockit` / `mockit-cli` / `mockrest` were already taken on npm.

## One file → a whole API

Given this `db.json`:

```json
{
  "posts": [{ "id": 1, "title": "hello" }],
  "users": [{ "id": 1, "name": "Ada" }]
}
```

`npx jsonmock-cli db.json` serves:

```
GET|POST              /posts
GET|PUT|PATCH|DELETE  /posts/:id
GET|POST              /users
GET|PUT|PATCH|DELETE  /users/:id
GET                   /            # resource index (names + counts)
```

```
jsonmock-cli 0.1.0  →  http://127.0.0.1:4000   (in-memory)
serving 2 collections from ./db.json
local dev only · unauthenticated · press Ctrl+C to stop
```

## Quick start

```bash
# one-off, no install
npx jsonmock-cli db.json

# or install globally
npm install -g jsonmock-cli
jsonmock-cli db.json --port 3001
```

## The db file

The db is a JSON **object of arrays**. Each key is a collection (a REST
resource); each array holds records. A numeric `id` is used as the primary key
and is auto-assigned on create when you leave it out.

```json
{
  "posts":    [{ "id": 1, "title": "hello", "views": 10 }],
  "comments": [{ "id": 1, "postId": 1, "body": "nice" }],
  "profile":  []
}
```

Collection names must be `[A-Za-z0-9_-]+`. Bodies may not contain `__proto__`,
`prototype` or `constructor` keys (prototype-pollution guard).

## A curl session

```bash
# list
curl localhost:4000/posts

# read one
curl localhost:4000/posts/1

# create (id auto-assigned) -> 201 Created + Location header
curl -X POST localhost:4000/posts -H 'content-type: application/json' \
  -d '{"title":"new post"}'

# replace (PUT) / merge (PATCH)
curl -X PUT   localhost:4000/posts/1 -H 'content-type: application/json' -d '{"title":"replaced"}'
curl -X PATCH localhost:4000/posts/1 -H 'content-type: application/json' -d '{"views":99}'

# delete
curl -X DELETE localhost:4000/posts/1
```

### Filtering, sorting, pagination

```bash
curl "localhost:4000/posts?title=hello"                 # equality filter
curl "localhost:4000/posts?views_gte=10&views_lt=100"   # operators
curl "localhost:4000/posts?title_like=^hel"             # regex (case-insensitive)
curl "localhost:4000/posts?_sort=views&_order=desc"     # sort
curl "localhost:4000/posts?_page=2&_limit=10"           # paginate (X-Total-Count header)
```

| Query param | Meaning |
| --- | --- |
| `field=value` | equality filter |
| `field_ne=value` | not equal |
| `field_gte` / `field_lte` / `field_gt` / `field_lt` | numeric/string comparisons |
| `field_like=regex` | case-insensitive regular-expression match |
| `_sort=field&_order=asc\|desc` | sort by a field |
| `_page=n&_limit=m` | pagination (response includes `X-Total-Count`) |

## Options

```
jsonmock-cli <db.json> [options]
```

| Option | Description |
| --- | --- |
| `-p, --port <n>` | Port to listen on (default: `4000`) |
| `-H, --host <h>` | Host/interface to bind (default: `127.0.0.1`, localhost only) |
| `--persist` | Write changes back to the JSON file (atomic + debounced) |
| `--watch` | Reload the db when the file changes on disk |
| `--delay <ms>` | Add artificial latency to every response |
| `--error-rate <p>` | Randomly fail this fraction (`0`–`1`) of requests with `500` |
| `--cors <origin>` | `Access-Control-Allow-Origin` value (default: `*`) |
| `--static <dir>` | Serve static files from `<dir>` for otherwise-`404` GET routes |
| `--routes <file>` | Load URL rewrite rules from a routes JSON file |
| `-q, --quiet` | Do not log each request |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

Exit codes: `0` clean shutdown, `1` runtime failure (e.g. port in use or bad
config), `2` bad usage.

`--delay` and `--error-rate` are great for testing how your UI handles slow or
flaky networks:

```bash
jsonmock-cli db.json --delay 800 --error-rate 0.1
```

### Rewrites (`--routes`)

```json
{ "/api/*": "/*" }
```

```bash
jsonmock-cli db.json --routes routes.json
curl localhost:4000/api/posts   # -> served as /posts
```

## Security

**jsonmock-cli is an unauthenticated local development server. It is not a
production server — never expose it to an untrusted network.**

- **Localhost only by default.** It binds to `127.0.0.1`. To listen on another
  interface you must pass `--host` explicitly (e.g. `--host 0.0.0.0`), and it
  prints a loud warning that an unauthenticated server is being exposed.
- **Request body size cap.** Bodies over 5 MB are rejected with `413` to prevent
  memory blowups.
- **Prototype-pollution guard.** `__proto__` / `prototype` / `constructor` keys
  are rejected in collection names and request bodies.
- **Path-traversal safe.** `--static` resolves every request path and refuses to
  serve anything outside the given directory.

## How it works

No framework — just `node:http` plus a pure core:

- `src/db.mjs` — validate the file + **pure reducers** (`state → new state`) for
  list/get/create/PUT/PATCH/delete and id assignment.
- `src/query.mjs` — **pure** filter / sort / paginate.
- `src/router.mjs` — **pure** matcher: `(method, path, collections) → match`.
- `src/handler.mjs` — a **pure** `computeResponse(request, db)` (unit-tested with
  plain objects, no sockets) wrapped with body reading + static serving.
- `src/cors.mjs` — **pure** CORS header builder.
- `src/server.mjs` — a thin `node:http` wrapper (CORS, delay, logging, start/close).

## Development

```bash
node --test                       # run the test suite (Node built-in, zero deps)
node bin/mockit.mjs db.json       # try it
node bin/mockit.mjs --help
```

The interesting logic is pure and unit-tested, so contributions are easy to
verify. There is no `npm install` step — there are no dependencies.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
