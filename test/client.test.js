'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createClient, WaClient, WaConnectError, codes, availableEngines, resolveEngineName } = require('../src');

/** A stand-in engine so the tests never touch WhatsApp or the network. */
class FakeAdapter extends EventEmitter {
  constructor() {
    super();
    this.name = 'fake';
    this.raw = { hello: 'world' };
    this.calls = [];
    this.destroyed = null;
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    return this;
  }

  async destroy(options) {
    this.destroyed = options;
  }

  async sendText(chatId, text) {
    this.calls.push(['sendText', chatId, text]);
    return { id: 'MSG1', chatId, body: text, engine: 'fake' };
  }

  async sendImage(chatId) {
    throw new WaConnectError('media failed', { code: codes.MEDIA_ERROR });
  }

  async getMe() {
    return { phone: '919876543210', engine: 'fake' };
  }
}

function makeClient(overrides = {}) {
  const adapter = new FakeAdapter();
  const client = createClient({ adapter, printQR: false, ...overrides });
  return { adapter, client };
}

test('createClient returns a WaClient with sensible defaults', () => {
  const client = createClient();
  assert.ok(client instanceof WaClient);
  assert.equal(client.engine, 'whatsapp-web');
  assert.equal(client.options.sessionPath, './.wa-session');
  assert.equal(client.state, 'idle');
  assert.equal(client.isReady, false);
});

test('unknown engine names are rejected', () => {
  assert.throws(() => createClient({ engine: 'carrier-pigeon' }), /Unknown engine/);
  assert.equal(resolveEngineName('wweb'), 'whatsapp-web');
  assert.equal(resolveEngineName('WS'), 'baileys');
});

test('availableEngines reports what is installed', () => {
  const engines = availableEngines();
  assert.ok(Array.isArray(engines));
});

test('connect starts the adapter and exposes raw', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  assert.equal(adapter.connected, true);
  assert.equal(client.state, 'connecting');
  assert.deepEqual(client.raw, { hello: 'world' });
  await client.disconnect();
});

test('events are forwarded to the public client', async () => {
  const { adapter, client } = makeClient();
  const seen = { qr: null, message: null };
  client.on('qr', (qr) => {
    seen.qr = qr;
  });
  client.on('message', (msg) => {
    seen.message = msg;
  });
  await client.connect();

  adapter.emit('qr', 'QR-STRING');
  adapter.emit('message', { id: 'M1', body: 'hi' });

  assert.equal(seen.qr, 'QR-STRING');
  assert.equal(client.qr, 'QR-STRING');
  assert.equal(seen.message.body, 'hi');
  await client.disconnect();
});

test('ready flips state and resolves waitForReady', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  const waiting = client.waitForReady({ timeoutMs: 1000 });
  adapter.emit('ready', { phone: '919876543210', engine: 'fake' });
  const me = await waiting;
  assert.equal(me.phone, '919876543210');
  assert.equal(client.state, 'open');
  assert.equal(client.isReady, true);
  assert.equal(client.me.phone, '919876543210');
  assert.equal(client.qr, null);
  await client.disconnect();
});

test('actions are delegated to the engine', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  const sent = await client.sendText('919876543210', 'hello');
  assert.equal(sent.body, 'hello');
  assert.deepEqual(adapter.calls[0], ['sendText', '919876543210', 'hello']);
  assert.equal((await client.getMe()).phone, '919876543210');
  await client.disconnect();
});

test('calling before connect throws NOT_CONNECTED', async () => {
  const { client } = makeClient();
  await assert.rejects(() => client.sendText('919876543210', 'hi'), (err) => {
    assert.ok(err instanceof WaConnectError);
    assert.equal(err.code, codes.NOT_CONNECTED);
    return true;
  });
});

test('methods the engine lacks throw ENGINE_UNSUPPORTED', async () => {
  const { client } = makeClient();
  await client.connect();
  await assert.rejects(() => client.getGroups(), (err) => {
    assert.equal(err.code, codes.ENGINE_UNSUPPORTED);
    assert.equal(err.method, 'getGroups');
    return true;
  });
  await client.disconnect();
});

test('engine errors keep their code', async () => {
  const { client } = makeClient();
  await client.connect();
  await assert.rejects(() => client.sendImage('919876543210', Buffer.from('x')), (err) => {
    assert.ok(err instanceof WaConnectError);
    assert.equal(err.code, codes.MEDIA_ERROR);
    assert.equal(err.method, 'sendImage');
    return true;
  });
  await client.disconnect();
});

test('disconnect tears the adapter down and emits closed', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  let closed = null;
  client.on('closed', (info) => {
    closed = info;
  });
  await client.disconnect();
  assert.deepEqual(adapter.destroyed, { logout: false });
  assert.deepEqual(closed, { logout: false });
  assert.equal(client.state, 'closed');
  assert.equal(client.adapter, null);
  assert.equal(client.raw, null);
});

test('logout passes the logout flag through', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  await client.logout();
  assert.deepEqual(adapter.destroyed, { logout: true });
});

test('adapter errors surface as WaConnectError', async () => {
  const { adapter, client } = makeClient();
  const errors = [];
  client.on('error', (err) => errors.push(err));
  await client.connect();
  adapter.emit('error', new Error('socket died'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof WaConnectError);
  assert.equal(errors[0].message, 'socket died');
  await client.disconnect();
});

test('an unhandled error event does not crash the process', async () => {
  const { adapter, client } = makeClient();
  await client.connect();
  assert.doesNotThrow(() => adapter.emit('error', new Error('nobody is listening')));
  await client.disconnect();
});

test('waitForReady times out cleanly', async () => {
  const { client } = makeClient();
  await client.connect();
  const keeper = setTimeout(() => {}, 250); // keeps the loop alive while we race
  await assert.rejects(() => client.waitForReady({ timeoutMs: 20 }), (err) => err.code === codes.TIMEOUT);
  clearTimeout(keeper);
  await client.disconnect();
});
