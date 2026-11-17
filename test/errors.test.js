'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WaConnectError, codes } = require('../src/errors');

test('WaConnectError carries a stable code and metadata', () => {
  const err = new WaConnectError('nope', { code: codes.NOT_CONNECTED, method: 'sendText', engine: 'baileys' });
  assert.equal(err.name, 'WaConnectError');
  assert.equal(err.code, 'NOT_CONNECTED');
  assert.equal(err.method, 'sendText');
  assert.equal(err.engine, 'baileys');
  assert.deepEqual(err.toJSON(), {
    name: 'WaConnectError',
    code: 'NOT_CONNECTED',
    message: 'nope',
    method: 'sendText',
    engine: 'baileys',
  });
});

test('WaConnectError.from wraps anything once', () => {
  const original = new Error('socket closed');
  const wrapped = WaConnectError.from(original, { method: 'connect', engine: 'baileys' });
  assert.equal(wrapped.code, 'WA_ERROR');
  assert.equal(wrapped.cause, original);
  assert.equal(WaConnectError.from(wrapped), wrapped);
});

test('WaConnectError.from handles non-Error throwables', () => {
  const wrapped = WaConnectError.from('plain string');
  assert.equal(wrapped.message, 'plain string');
});

test('every documented code exists', () => {
  const expected = [
    'ENGINE_NOT_INSTALLED',
    'ENGINE_UNSUPPORTED',
    'INVALID_ARGUMENT',
    'NOT_CONNECTED',
    'LOGIN_FAILED',
    'SESSION_ERROR',
    'MEDIA_ERROR',
    'SEND_FAILED',
    'TIMEOUT',
    'WA_ERROR',
  ];
  for (const key of expected) assert.equal(codes[key], key);
  assert.ok(Object.isFrozen(codes));
});
