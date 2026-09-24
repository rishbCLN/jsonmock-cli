import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorsHeaders } from '../src/cors.mjs';

test('buildCorsHeaders: wildcard default', () => {
  const h = buildCorsHeaders('*', {});
  assert.equal(h['Access-Control-Allow-Origin'], '*');
  assert.match(h['Access-Control-Allow-Methods'], /GET/);
  assert.match(h['Access-Control-Allow-Methods'], /DELETE/);
  assert.equal(h['Access-Control-Allow-Headers'], 'Content-Type');
  assert.equal(h.Vary, undefined);
  assert.equal(h['Access-Control-Allow-Credentials'], undefined);
});

test('buildCorsHeaders: a specific origin adds Vary + credentials', () => {
  const h = buildCorsHeaders('http://localhost:5173', {});
  assert.equal(h['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(h.Vary, 'Origin');
  assert.equal(h['Access-Control-Allow-Credentials'], 'true');
});

test('buildCorsHeaders: reflects requested headers on preflight', () => {
  const h = buildCorsHeaders('*', { 'access-control-request-headers': 'X-Custom, Authorization' });
  assert.equal(h['Access-Control-Allow-Headers'], 'X-Custom, Authorization');
});

test('buildCorsHeaders: empty origin falls back to wildcard', () => {
  assert.equal(buildCorsHeaders('', {})['Access-Control-Allow-Origin'], '*');
});
