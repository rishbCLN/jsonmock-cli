import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer, shouldInjectError } from '../src/server.mjs';

test('shouldInjectError: bounds and injected RNG', () => {
  assert.equal(shouldInjectError(0), false);
  assert.equal(shouldInjectError(1), true);
  assert.equal(shouldInjectError(0.5, () => 0.4), true);
  assert.equal(shouldInjectError(0.5, () => 0.6), false);
});

/** Minimal one-shot HTTP client: no keep-alive, hard timeout, always closes. */
function request(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const headers = { Connection: 'close' };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { buf += d; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
      },
    );
    req.on('error', reject);
    req.setTimeout(4000, () => req.destroy(new Error('request timed out')));
    if (data) req.write(data);
    req.end();
  });
}

test('integration: full CRUD over 127.0.0.1:0, then a clean shutdown', async () => {
  let state = { posts: [{ id: 1, title: 'a' }] };
  const handle = await startServer({
    getDb: () => state,
    setDb: (db) => { state = db; },
    options: { port: 0, host: '127.0.0.1', cors: '*' },
  });
  try {
    const { port } = handle;

    const list = await request(port, 'GET', '/posts');
    assert.equal(list.status, 200);
    assert.deepEqual(JSON.parse(list.body).map((p) => p.id), [1]);
    assert.equal(list.headers['x-total-count'], '1');
    assert.equal(list.headers['access-control-allow-origin'], '*');

    const created = await request(port, 'POST', '/posts', { title: 'b' });
    assert.equal(created.status, 201);
    assert.equal(JSON.parse(created.body).id, 2);
    assert.equal(created.headers.location, '/posts/2');

    const got = await request(port, 'GET', '/posts/2');
    assert.equal(got.status, 200);
    assert.equal(JSON.parse(got.body).title, 'b');

    const patched = await request(port, 'PATCH', '/posts/2', { title: 'c' });
    assert.equal(patched.status, 200);
    assert.equal(JSON.parse(patched.body).title, 'c');

    const del = await request(port, 'DELETE', '/posts/1');
    assert.equal(del.status, 200);

    const after = await request(port, 'GET', '/posts');
    assert.deepEqual(JSON.parse(after.body).map((p) => p.id), [2]);

    const preflight = await request(port, 'OPTIONS', '/posts');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], '*');
  } finally {
    await handle.close();
  }
});

test('integration: oversized body is rejected with 413', async () => {
  let state = { posts: [] };
  const handle = await startServer({
    getDb: () => state,
    setDb: (db) => { state = db; },
    options: { port: 0, host: '127.0.0.1', maxBodyBytes: 64 },
  });
  try {
    const big = { blob: 'x'.repeat(500) };
    const res = await request(handle.port, 'POST', '/posts', big);
    assert.equal(res.status, 413);
  } finally {
    await handle.close();
  }
});

test('integration: 204 preflight must NOT carry Content-Length (RFC 7230)', async () => {
  let state = { posts: [] };
  const handle = await startServer({
    getDb: () => state,
    setDb: (db) => { state = db; },
    options: { port: 0, host: '127.0.0.1', cors: '*' },
  });
  try {
    const res = await request(handle.port, 'OPTIONS', '/posts');
    assert.equal(res.status, 204);
    assert.equal(res.headers['content-length'], undefined);
  } finally {
    await handle.close();
  }
});

test('integration: HEAD /posts -> 200, real headers, empty body', async () => {
  let state = { posts: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }] };
  const handle = await startServer({
    getDb: () => state,
    setDb: (db) => { state = db; },
    options: { port: 0, host: '127.0.0.1', cors: '*' },
  });
  try {
    const res = await request(handle.port, 'HEAD', '/posts');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-total-count'], '2');
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.equal(res.body, '');
  } finally {
    await handle.close();
  }
});

test('integration: an unexpected 500 still carries CORS headers', async () => {
  // A BigInt in the db makes JSON.stringify throw inside the server, exercising
  // the catch-all 500 path. It must still include CORS so a browser can read it.
  let state = { posts: [{ id: 1, oops: 10n }] };
  const handle = await startServer({
    getDb: () => state,
    setDb: (db) => { state = db; },
    options: { port: 0, host: '127.0.0.1', cors: '*' },
  });
  try {
    const res = await request(handle.port, 'GET', '/posts');
    assert.equal(res.status, 500);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  } finally {
    await handle.close();
  }
});
