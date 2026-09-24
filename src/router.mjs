// Pure request router: map (method, pathname, collections) to a route match
// descriptor. No I/O. The handler decides what to *do* per match kind + method.
//
// It also exposes applyRewrites for optional routes.json URL rewriting.

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function decodeSegment(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Split a pathname into decoded, non-empty segments. */
export function splitPath(pathname) {
  return String(pathname == null ? '' : pathname)
    .split('/')
    .map(decodeSegment)
    .filter((s) => s.length > 0);
}

/** Is a URL segment a safe collection name (and not a pollution vector)? */
export function isSafeName(name) {
  return typeof name === 'string' && !UNSAFE_KEYS.has(name) && NAME_RE.test(name);
}

/**
 * Match a request path against the known collections.
 * @param {string} method
 * @param {string} pathname
 * @param {string[]|Set<string>} collections
 * @returns {{ kind: 'root'|'collection'|'item'|'unknown'|'notfound',
 *            collection: string|null, id: string|null, params: object }}
 */
export function matchRoute(method, pathname, collections = []) {
  const known = collections instanceof Set ? collections : new Set(collections);
  const segments = splitPath(pathname);

  if (segments.length === 0) {
    return { kind: 'root', collection: null, id: null, params: {} };
  }

  const name = segments[0];
  if (!isSafeName(name)) {
    return { kind: 'notfound', collection: null, id: null, params: {} };
  }

  if (segments.length === 1) {
    return known.has(name)
      ? { kind: 'collection', collection: name, id: null, params: {} }
      : { kind: 'unknown', collection: name, id: null, params: {} };
  }

  if (segments.length === 2) {
    const id = segments[1];
    return known.has(name)
      ? { kind: 'item', collection: name, id, params: { id } }
      : { kind: 'unknown', collection: name, id, params: { id } };
  }

  // Deeper/nested paths are not modelled by the collection API.
  return { kind: 'notfound', collection: null, id: null, params: {} };
}

/**
 * Apply optional URL rewrites (from a routes.json). Supports:
 *   - trailing wildcard:  "/api/*" -> "/*"   (strips/replaces a prefix)
 *   - exact alias:        "/health" -> "/status"
 * Rules are tried in order; the first match wins. Returns the (possibly
 * rewritten) pathname.
 * @param {string} pathname
 * @param {Array<[string,string]>} rewrites entries of [pattern, target]
 */
export function applyRewrites(pathname, rewrites) {
  if (!rewrites || rewrites.length === 0) return pathname;
  for (const [pattern, target] of rewrites) {
    if (typeof pattern !== 'string' || typeof target !== 'string') continue;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1); // e.g. "/api/*" -> "/api/"
      if (pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)) {
        const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
        return target.endsWith('/*') ? target.slice(0, -1) + rest : target;
      }
    } else if (pathname === pattern) {
      return target;
    }
  }
  return pathname;
}
