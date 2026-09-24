import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilters, sortItems, paginate, queryCollection } from '../src/query.mjs';

const posts = [
  { id: 1, title: 'alpha', views: 10, tag: 'x' },
  { id: 2, title: 'beta', views: 50, tag: 'y' },
  { id: 3, title: 'gamma', views: 30, tag: 'x' },
];

test('applyFilters: equality with numeric coercion', () => {
  assert.deepEqual(applyFilters(posts, { tag: 'x' }).map((p) => p.id), [1, 3]);
  assert.deepEqual(applyFilters(posts, { id: '2' }).map((p) => p.id), [2]);
});

test('applyFilters: operators _gte/_lte/_gt/_lt/_ne/_like', () => {
  assert.deepEqual(applyFilters(posts, { views_gte: '30' }).map((p) => p.id), [2, 3]);
  assert.deepEqual(applyFilters(posts, { views_lte: '30' }).map((p) => p.id), [1, 3]);
  assert.deepEqual(applyFilters(posts, { views_gt: '30' }).map((p) => p.id), [2]);
  assert.deepEqual(applyFilters(posts, { views_lt: '30' }).map((p) => p.id), [1]);
  assert.deepEqual(applyFilters(posts, { tag_ne: 'x' }).map((p) => p.id), [2]);
  assert.deepEqual(applyFilters(posts, { title_like: '^a' }).map((p) => p.id), [1]);
});

test('applyFilters: multiple filters are AND-ed', () => {
  assert.deepEqual(applyFilters(posts, { tag: 'x', views_gte: '20' }).map((p) => p.id), [3]);
});

test('sortItems: ascending and descending', () => {
  assert.deepEqual(sortItems(posts, 'views', 'asc').map((p) => p.id), [1, 3, 2]);
  assert.deepEqual(sortItems(posts, 'views', 'desc').map((p) => p.id), [2, 3, 1]);
});

test('sortItems: stable for equal keys', () => {
  const items = [{ id: 1, g: 'a' }, { id: 2, g: 'a' }, { id: 3, g: 'b' }];
  assert.deepEqual(sortItems(items, 'g', 'asc').map((x) => x.id), [1, 2, 3]);
});

test('paginate: slices and reports total (before pagination)', () => {
  const r = paginate(posts, 1, 2);
  assert.equal(r.total, 3);
  assert.deepEqual(r.items.map((p) => p.id), [1, 2]);
  assert.deepEqual(paginate(posts, 2, 2).items.map((p) => p.id), [3]);
});

test('queryCollection: filter + sort + paginate together', () => {
  const data = [];
  for (let i = 1; i <= 10; i++) data.push({ id: i, n: i % 2 === 0 ? 'even' : 'odd', v: i });
  const res = queryCollection(data, { n: 'even', _sort: 'v', _order: 'desc', _page: '1', _limit: '2' });
  assert.equal(res.total, 5); // evens: 2,4,6,8,10
  assert.deepEqual(res.items.map((x) => x.v), [10, 8]);
  assert.equal(res.paginated, true);
});

test('queryCollection: no params returns everything', () => {
  const res = queryCollection(posts, {});
  assert.equal(res.total, 3);
  assert.equal(res.paginated, false);
  assert.equal(res.items.length, 3);
});
