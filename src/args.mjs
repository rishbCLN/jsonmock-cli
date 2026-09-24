// Zero-dependency CLI argument parsing for jsonmock-cli. Kept pure so it is
// fully unit-testable — no I/O, no process access. Mirrors portkill's args.mjs.

export const DEFAULT_PORT = 4000;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_CORS = '*';
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export const HELP = `jsonmock-cli — spin up a fake REST API from a tiny JSON file

Usage:
  jsonmock-cli <db.json> [options]

Options:
  -p, --port <n>        Port to listen on (default: ${DEFAULT_PORT})
  -H, --host <h>        Host/interface to bind (default: ${DEFAULT_HOST}, localhost only)
      --persist         Write changes back to the JSON file (atomic + debounced)
      --watch           Reload the db when the file changes on disk
      --delay <ms>      Add artificial latency to every response
      --error-rate <p>  Randomly fail this fraction (0..1) of requests with 500
      --cors <origin>   Access-Control-Allow-Origin value (default: ${DEFAULT_CORS})
      --static <dir>    Serve static files from <dir> for otherwise-404 GET routes
      --routes <file>   Load URL rewrite rules from a routes JSON file
  -q, --quiet           Do not log each request
  -h, --help            Show this help
  -v, --version         Show the version

Examples:
  jsonmock-cli db.json                     # CRUD API on http://127.0.0.1:4000
  jsonmock-cli db.json -p 3001             # pick a port
  jsonmock-cli db.json --persist           # write changes back to db.json
  jsonmock-cli db.json --delay 400         # simulate a slow network
  curl "localhost:4000/posts?_page=1&_limit=10&_sort=id&_order=desc"

Query params (on any collection):
  ?field=value       filter (also _ne, _gte, _lte, _gt, _lt, _like)
  ?_page=1&_limit=10 paginate
  ?_sort=field&_order=asc|desc  sort

Security:
  jsonmock-cli is an UNAUTHENTICATED local development server. By default it
  binds to 127.0.0.1 (localhost) only. Passing --host with a non-loopback
  address (e.g. 0.0.0.0) exposes your mock data to everyone on the network and
  prints a loud warning. Never run it in production or on an untrusted network.
`;

function parsePort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < MIN_PORT || n > MAX_PORT) {
    return { value: null, error: `invalid port "${value}" (must be ${MIN_PORT}-${MAX_PORT})` };
  }
  return { value: n, error: null };
}

/**
 * Parse the full argv (excluding node + script).
 * @returns {{
 *   file: string|null, port: number, host: string, hostExplicit: boolean,
 *   persist: boolean, watch: boolean, delay: number, errorRate: number,
 *   cors: string, static: string|null, routes: string|null, quiet: boolean,
 *   help: boolean, version: boolean, errors: string[]
 * }}
 */
export function parseArgs(argv) {
  const result = {
    file: null,
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    hostExplicit: false,
    persist: false,
    watch: false,
    delay: 0,
    errorRate: 0,
    cors: DEFAULT_CORS,
    static: null,
    routes: null,
    quiet: false,
    help: false,
    version: false,
    errors: [],
  };

  const args = Array.isArray(argv) ? argv.slice() : [];

  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    let key = raw;
    let inline = null;
    if (raw.startsWith('--') && raw.includes('=')) {
      const eq = raw.indexOf('=');
      key = raw.slice(0, eq);
      inline = raw.slice(eq + 1);
    }

    // Pull the value for an option that requires one (inline `=v` or next token).
    const needValue = () => {
      if (inline != null) return inline;
      const next = args[i + 1];
      if (next === undefined) {
        result.errors.push(`option ${key} requires a value`);
        return null;
      }
      i += 1;
      return next;
    };

    switch (key) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '--persist':
        result.persist = true;
        break;
      case '--watch':
        result.watch = true;
        break;
      case '-q':
      case '--quiet':
        result.quiet = true;
        break;
      case '-p':
      case '--port': {
        const v = needValue();
        if (v == null) break;
        const { value, error } = parsePort(v);
        if (error) result.errors.push(error);
        else result.port = value;
        break;
      }
      case '-H':
      case '--host': {
        const v = needValue();
        if (v == null) break;
        if (!v) result.errors.push('option --host requires a non-empty value');
        else {
          result.host = v;
          result.hostExplicit = true;
        }
        break;
      }
      case '--delay': {
        const v = needValue();
        if (v == null) break;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) {
          result.errors.push(`invalid --delay "${v}" (must be a non-negative integer of milliseconds)`);
        } else {
          result.delay = n;
        }
        break;
      }
      case '--error-rate': {
        const v = needValue();
        if (v == null) break;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          result.errors.push(`invalid --error-rate "${v}" (must be a number between 0 and 1)`);
        } else {
          result.errorRate = n;
        }
        break;
      }
      case '--cors': {
        const v = needValue();
        if (v == null) break;
        result.cors = v;
        break;
      }
      case '--static': {
        const v = needValue();
        if (v == null) break;
        result.static = v;
        break;
      }
      case '--routes': {
        const v = needValue();
        if (v == null) break;
        result.routes = v;
        break;
      }
      default: {
        if (key.length > 1 && key.startsWith('-')) {
          result.errors.push(`unknown option: ${key}`);
          break;
        }
        if (result.file == null) {
          result.file = raw;
        } else {
          result.errors.push(`unexpected argument: ${raw}`);
        }
      }
    }
  }

  return result;
}
