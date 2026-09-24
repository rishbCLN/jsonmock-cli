import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseDb,
  validateDb,
  nextId,
  createRecord,
  replaceRecord,
  patchRecord,
  deleteRecord,
  getRecord,
  listRecords,
  collectionSummary,
  hasUnsafeKey,
  isPlainObject,
  atomicWriteJson,
  createPersister,
} from '../src/db.mjs';

test('parseDb: valid object of arrays', () => {
  const { db, error } = parseDb('{"posts":[{"id":1}],"users":[]}');
  assert.equal(error, null);
  assert.deepEqual(Object.keys(db), ['posts', 'users']);
});

test('parseDb: invalid JSON reports a clear error', () => {
  const { db, error } = parseDb('{not json');
  assert.equal(db, null);
  assert.match(error, /invalid JSON/);
});

test('validateDb: rejects non-object and non-array collections', () => {
  assert.match(validateDb([1, 2]).error, /object of collections/);
  assert.match(validateDb({ posts: {} }).error, /must be an array/);
});

test('validateDb: rejects illegal + prototype-pollution names', () => {
  assert.match(validateDb({ 'bad name': [] }).error, /illegal collection name/);
  assert.ok(validateDb(JSON.parse('{"__proto__":[]}')).error);
});

test('isPlainObject / hasUnsafeKey', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(hasUnsafeKey(JSON.parse('{"__proto__":{"x":1}}')), true);
  assert.equal(hasUnsafeKey({ a: 1 }), false);
});

test('nextId: increments from max, 1 when empty', () => {
  assert.equal(nextId([]), 1);
  assert.equal(nextId([{ id: 1 }, { id: 4 }, { id: 2 }]), 5);
  assert.equal(nextId([{ id: '3' }]), 4);
});

test('createRecord: assigns id, returns a NEW db, leaves original intact', () => {
  const db = { posts: [{ id: 1 }] };
  const res = createRecord(db, 'posts', { title: 'hi' });
  assert.equal(res.error, null);
  assert.equal(res.record.id, 2);
  assert.equal(res.db.posts.length, 2);
  assert.equal(db.posts.length, 1);
  assert.notEqual(res.db, db);
});

test('createRecord: duplicate provided id -> conflict', () => {
  const db = { posts: [{ id: 1 }] };
  const res = createRecord(db, 'posts', { id: 1, title: 'dup' });
  assert.equal(res.error, 'conflict');
  assert.equal(res.db, db);
});

test('replaceRecord: PUT replaces wholesale, keeps id; 404 when missing', () => {
  const db = { posts: [{ id: 1, title: 'a', extra: 'x' }] };
  const res = replaceRecord(db, 'posts', '1', { title: 'b' });
  assert.deepEqual(res.record, { title: 'b', id: 1 });
  assert.equal(res.db.posts[0].extra, undefined);
  assert.equal(replaceRecord(db, 'posts', '9', {}).error, 'not_found');
});

test('patchRecord: PATCH merges, keeps other fields + id', () => {
  const db = { posts: [{ id: 1, title: 'a', extra: 'x' }] };
  const res = patchRecord(db, 'posts', 1, { title: 'b' });
  assert.deepEqual(res.record, { id: 1, title: 'b', extra: 'x' });
});

test('deleteRecord: removes immutably; 404 when missing', () => {
  const db = { posts: [{ id: 1 }, { id: 2 }] };
  const res = deleteRecord(db, 'posts', 1);
  assert.deepEqual(res.db.posts.map((p) => p.id), [2]);
  assert.equal(db.posts.length, 2);
  assert.equal(deleteRecord(db, 'posts', 9).error, 'not_found');
});

test('getRecord / listRecords / collectionSummary', () => {
  const db = { posts: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }], users: [] };
  assert.deepEqual(getRecord(db, 'posts', 2), { id: 2, t: 'b' });
  assert.equal(getRecord(db, 'posts', 9), null);
  assert.equal(listRecords(db, 'posts', {}).items.length, 2);
  assert.deepEqual(collectionSummary(db), { posts: 2, users: 0 });
});

test('atomicWriteJson: writes readable JSON via temp + rename', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mockit-'));
  try {
    const file = join(dir, 'db.json');
    await atomicWriteJson(file, { posts: [{ id: 1 }] });
    const txt = await readFile(file, 'utf8');
    assert.deepEqual(JSON.parse(txt), { posts: [{ id: 1 }] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createPersister: debounces, keeps only the latest, flush writes once', async () => {
  const writes = [];
  const write = async (_file, data) => { writes.push(data); };
  const setTimer = () => ({ unref() {} });
  const clearTimer = () => {};
  const p = createPersister({ file: 'x', write, setTimer, clearTimer, delay: 10 });
  p.schedule({ a: 1 });
  p.schedule({ a: 2 });
  assert.equal(writes.length, 0);
  assert.equal(p.hasPending, true);
  await p.flush();
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { a: 2 });
  assert.equal(p.hasPending, false);
});
