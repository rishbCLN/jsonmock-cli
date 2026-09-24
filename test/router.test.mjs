import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute, splitPath, isSafeName, applyRewrites } from '../src/router.mjs';

const cols = ['posts', 'users'];

test('matchRoute: root', () => {
  assert.deepEqual(matchRoute('GET', '/', cols), {
    kind: 'root', collection: null, id: null, params: {},
  });
});

test('matchRoute: collection list', () => {
  const m = matchRoute('GET', '/posts', cols);
  assert.equal(m.kind, 'collection');
  assert.equal(m.collection, 'posts');
});

test('matchRoute: item extracts :id param', () => {
  const m = matchRoute('GET', '/posts/42', cols);
  assert.equal(m.kind, 'item');
  assert.equal(m.id, '42');
  assert.deepEqual(m.params, { id: '42' });
});

test('matchRoute: unknown collection', () => {
  assert.equal(matchRoute('GET', '/nope', cols).kind, 'unknown');
});

test('matchRoute: nested path -> notfound', () => {
  assert.equal(matchRoute('GET', '/posts/1/comments', cols).kind, 'notfound');
});

test('matchRoute: unsafe name -> notfound (pollution guard)', () => {
  assert.equal(matchRoute('GET', '/__proto__', cols).kind, 'notfound');
  assert.equal(matchRoute('GET', '/constructor', cols).kind, 'notfound');
});

test('matchRoute: trailing slash tolerated', () => {
  assert.equal(matchRoute('GET', '/posts/', cols).kind, 'collection');
});

test('splitPath + isSafeName', () => {
  assert.deepEqual(splitPath('/a/b/'), ['a', 'b']);
  assert.deepEqual(splitPath('/'), []);
  assert.equal(isSafeName('good_name-1'), true);
  assert.equal(isSafeName('bad name'), false);
  assert.equal(isSafeName('__proto__'), false);
});

test('applyRewrites: wildcard prefix, exact alias, passthrough', () => {
  const rw = [['/api/*', '/*'], ['/health', '/status']];
  assert.equal(applyRewrites('/api/posts/1', rw), '/posts/1');
  assert.equal(applyRewrites('/health', rw), '/status');
  assert.equal(applyRewrites('/other', rw), '/other');
  assert.equal(applyRewrites('/x', null), '/x');
});
