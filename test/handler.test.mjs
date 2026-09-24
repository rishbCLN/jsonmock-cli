import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  computeResponse,
  parseQuery,
  parseJsonBody,
  readBody,
  resolveStaticPath,
} from '../src/handler.mjs';

const makeDb = () => ({
  posts: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }],
  users: [{ id: 1, name: 'Ada' }],
});

test('GET / lists resources with counts', () => {
  const res = computeResponse({ method: 'GET', pathname: '/' }, makeDb());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { posts: 2, users: 1 });
});

test('GET /posts returns items and X-Total-Count', () => {
  const res = computeResponse({ method: 'GET', pathname: '/posts', query: {} }, makeDb());
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  assert.equal(res.headers['X-Total-Count'], '2');
});

test('GET /posts/:id returns one; 404 for a missing id', () => {
  assert.equal(computeResponse({ method: 'GET', pathname: '/posts/1' }, makeDb()).status, 200);
  const miss = computeResponse({ method: 'GET', pathname: '/posts/99' }, makeDb());
  assert.equal(miss.status, 404);
  assert.match(miss.body.error, /no item/);
});

test('POST /posts creates, assigns id, sets Location, returns new db', () => {
  const db = makeDb();
  const res = computeResponse({ method: 'POST', pathname: '/posts', body: { title: 'c' } }, db);
  assert.equal(res.status, 201);
  assert.equal(res.body.id, 3);
  assert.equal(res.headers.Location, '/posts/3');
  assert.notEqual(res.db, db);
  assert.equal(db.posts.length, 2); // pure: original untouched
});

test('POST with a non-object body -> 400', () => {
  assert.equal(computeResponse({ method: 'POST', pathname: '/posts', body: [1, 2] }, makeDb()).status, 400);
  assert.equal(computeResponse({ method: 'POST', pathname: '/posts', body: 'x' }, makeDb()).status, 400);
});

test('POST with a prototype-pollution key -> 400', () => {
  const body = JSON.parse('{"__proto__":{"x":1},"title":"t"}');
  const res = computeResponse({ method: 'POST', pathname: '/posts', body }, makeDb());
  assert.equal(res.status, 400);
});

test('PUT replaces and PATCH merges', () => {
  const db = makeDb();
  const put = computeResponse({ method: 'PUT', pathname: '/posts/1', body: { title: 'z' } }, db);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { title: 'z', id: 1 });

  const patch = computeResponse({ method: 'PATCH', pathname: '/posts/2', body: { extra: 1 } }, db);
  assert.deepEqual(patch.body, { id: 2, title: 'b', extra: 1 });
});

test('DELETE removes -> 200 {}; 404 when missing', () => {
  const db = makeDb();
  const del = computeResponse({ method: 'DELETE', pathname: '/posts/1' }, db);
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, {});
  assert.equal(del.db.posts.length, 1);
  assert.equal(computeResponse({ method: 'DELETE', pathname: '/posts/9' }, db).status, 404);
});

test('405 for an unsupported method, with an Allow header', () => {
  const res = computeResponse({ method: 'DELETE', pathname: '/posts' }, makeDb());
  assert.equal(res.status, 405);
  assert.match(res.headers.Allow, /GET/);
});

test('HEAD is routed like GET (not 405)', () => {
  const db = makeDb();
  const list = computeResponse({ method: 'HEAD', pathname: '/posts' }, db);
  assert.equal(list.status, 200);
  assert.equal(list.headers['X-Total-Count'], '2');

  assert.equal(computeResponse({ method: 'HEAD', pathname: '/' }, db).status, 200);
  assert.equal(computeResponse({ method: 'HEAD', pathname: '/posts/1' }, db).status, 200);
  assert.equal(computeResponse({ method: 'HEAD', pathname: '/posts/99' }, db).status, 404);
  assert.equal(computeResponse({ method: 'HEAD', pathname: '/nope' }, db).status, 404);
});

test('unknown collection -> 404 listing the known collections', () => {
  const res = computeResponse({ method: 'GET', pathname: '/nope' }, makeDb());
  assert.equal(res.status, 404);
  assert.deepEqual(res.body.collections, ['posts', 'users']);
});

test('query filter + pagination flows through GET', () => {
  const db = { posts: [] };
  for (let i = 1; i <= 5; i++) db.posts.push({ id: i, k: i % 2 ? 'odd' : 'even' });
  const res = computeResponse({ method: 'GET', pathname: '/posts', query: { k: 'odd', _limit: '2', _page: '1' } }, db);
  assert.equal(res.headers['X-Total-Count'], '3'); // odds: 1,3,5
  assert.equal(res.body.length, 2);
});

test('rewrites are applied before routing', () => {
  const res = computeResponse(
    { method: 'GET', pathname: '/api/posts' },
    makeDb(),
    { rewrites: [['/api/*', '/*']] },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
});

test('parseQuery: query string / URLSearchParams -> object', () => {
  assert.deepEqual(parseQuery('a=1&b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseQuery(new URLSearchParams('x=9')), { x: '9' });
});

test('parseJsonBody: empty -> undefined, valid, invalid', () => {
  assert.deepEqual(parseJsonBody(''), { value: undefined, error: null });
  assert.deepEqual(parseJsonBody('{"a":1}'), { value: { a: 1 }, error: null });
  assert.match(parseJsonBody('{bad').error, /invalid JSON body/);
});

test('readBody: concatenates chunks (no sockets)', async () => {
  const req = Readable.from([Buffer.from('{"a":'), Buffer.from('1}')]);
  assert.equal(await readBody(req, 1000), '{"a":1}');
});

test('readBody: rejects an oversized body (the 413 path)', async () => {
  const req = Readable.from([Buffer.alloc(50), Buffer.alloc(60)]);
  await assert.rejects(() => readBody(req, 80), (e) => e.code === 'BODY_TOO_LARGE');
});

test('resolveStaticPath: allows in-base paths, blocks traversal', () => {
  const base = process.platform === 'win32' ? 'C:\\site' : '/site';
  assert.ok(resolveStaticPath(base, '/index.html'));
  assert.ok(resolveStaticPath(base, '/')); // -> index.html
  assert.equal(resolveStaticPath(base, '/../secret'), null);
  assert.equal(resolveStaticPath(base, '/..%2f..%2fetc/passwd'), null);
  assert.equal(resolveStaticPath(base, '/a\0b'), null);
});
