import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, DEFAULT_PORT, DEFAULT_HOST } from '../src/args.mjs';

test('parseArgs: file positional + defaults', () => {
  const r = parseArgs(['db.json']);
  assert.equal(r.file, 'db.json');
  assert.equal(r.port, DEFAULT_PORT);
  assert.equal(r.host, DEFAULT_HOST);
  assert.equal(r.hostExplicit, false);
  assert.equal(r.persist, false);
  assert.equal(r.cors, '*');
  assert.deepEqual(r.errors, []);
});

test('parseArgs: --port with space, = and short form', () => {
  assert.equal(parseArgs(['db.json', '--port', '3001']).port, 3001);
  assert.equal(parseArgs(['db.json', '--port=3002']).port, 3002);
  assert.equal(parseArgs(['db.json', '-p', '3003']).port, 3003);
});

test('parseArgs: invalid port is collected as an error', () => {
  const r = parseArgs(['db.json', '--port', '99999']);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /invalid port/);
});

test('parseArgs: --host sets hostExplicit', () => {
  const r = parseArgs(['db.json', '--host', '0.0.0.0']);
  assert.equal(r.host, '0.0.0.0');
  assert.equal(r.hostExplicit, true);
});

test('parseArgs: boolean flags', () => {
  const r = parseArgs(['db.json', '--persist', '--watch', '--quiet']);
  assert.equal(r.persist, true);
  assert.equal(r.watch, true);
  assert.equal(r.quiet, true);
});

test('parseArgs: value options delay/error-rate/cors/static/routes', () => {
  const r = parseArgs([
    'db.json',
    '--delay', '250',
    '--error-rate', '0.25',
    '--cors', 'http://localhost:5173',
    '--static', 'public',
    '--routes', 'routes.json',
  ]);
  assert.equal(r.delay, 250);
  assert.equal(r.errorRate, 0.25);
  assert.equal(r.cors, 'http://localhost:5173');
  assert.equal(r.static, 'public');
  assert.equal(r.routes, 'routes.json');
});

test('parseArgs: invalid delay and error-rate', () => {
  assert.match(parseArgs(['db.json', '--delay', '-5']).errors[0], /delay/);
  assert.match(parseArgs(['db.json', '--error-rate', '2']).errors[0], /error-rate/);
});

test('parseArgs: help and version', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('parseArgs: unknown option becomes an error', () => {
  const r = parseArgs(['db.json', '--bogus']);
  assert.ok(r.errors.some((e) => /unknown option/.test(e)));
});

test('parseArgs: option missing its value is an error', () => {
  const r = parseArgs(['db.json', '--port']);
  assert.ok(r.errors.some((e) => /requires a value/.test(e)));
});

test('parseArgs: a second positional is an error', () => {
  const r = parseArgs(['a.json', 'b.json']);
  assert.equal(r.file, 'a.json');
  assert.ok(r.errors.some((e) => /unexpected argument/.test(e)));
});
