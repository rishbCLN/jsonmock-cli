// Pure CORS header builder. No I/O, fully unit-testable.
//
// mockit enables permissive CORS by default because it exists to unblock local
// frontend development; the origin is configurable via --cors.

const ALLOWED_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

/**
 * Build the CORS response headers for a request.
 * @param {string} origin Configured Access-Control-Allow-Origin (default "*").
 * @param {Record<string,string|string[]>} [requestHeaders] Incoming request headers (lowercased keys).
 * @returns {Record<string,string>}
 */
export function buildCorsHeaders(origin = '*', requestHeaders = {}) {
  const allowOrigin = origin || '*';
  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Max-Age': '86400',
  };

  // Reflect requested headers on preflight when present, else allow Content-Type.
  const requested = requestHeaders['access-control-request-headers'];
  headers['Access-Control-Allow-Headers'] =
    requested && String(requested).trim() ? String(requested) : 'Content-Type';

  // A specific (non-wildcard) origin can safely carry credentials + must Vary.
  if (allowOrigin !== '*') {
    headers.Vary = 'Origin';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}
