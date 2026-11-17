'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const utils = require('../src/utils');

test('toDigits keeps only digits', () => {
  assert.equal(utils.toDigits('+91 98765-43210'), '919876543210');
  assert.equal(utils.toDigits(919876543210), '919876543210');
  assert.equal(utils.toDigits(null), '');
});

test('toWwebJid normalises phones and jids', () => {
  assert.equal(utils.toWwebJid('+91 98765 43210'), '919876543210@c.us');
  assert.equal(utils.toWwebJid('919876543210@s.whatsapp.net'), '919876543210@c.us');
  assert.equal(utils.toWwebJid('120363000000000000@g.us'), '120363000000000000@g.us');
});

test('toBaileysJid normalises phones and jids', () => {
  assert.equal(utils.toBaileysJid('919876543210@c.us'), '919876543210@s.whatsapp.net');
  assert.equal(utils.toBaileysJid('+91 98765 43210'), '919876543210@s.whatsapp.net');
  assert.equal(utils.toBaileysJid('120363000000000000@g.us'), '120363000000000000@g.us');
});

test('jid helpers reject junk', () => {
  assert.throws(() => utils.toWwebJid('abc'), /Not a usable phone number/);
  assert.throws(() => utils.toWwebJid(''), /required/);
});

test('isGroupId only matches group jids', () => {
  assert.equal(utils.isGroupId('120363000000000000@g.us'), true);
  assert.equal(utils.isGroupId('919876543210@c.us'), false);
  assert.equal(utils.isGroupId(undefined), false);
});

test('toMillis converts seconds to milliseconds', () => {
  assert.equal(utils.toMillis(1700000000), 1700000000000);
  assert.equal(utils.toMillis(1700000000000), 1700000000000);
  assert.equal(utils.toMillis({ toNumber: () => 1700000000 }), 1700000000000);
  assert.ok(Number.isFinite(utils.toMillis(undefined)));
});

test('buildVcard produces a sendable card', () => {
  const vcard = utils.buildVcard({ name: 'Asha', phone: '+91 98765 43210' });
  assert.match(vcard, /^BEGIN:VCARD/);
  assert.match(vcard, /FN:Asha/);
  assert.match(vcard, /waid=919876543210/);
  assert.match(vcard, /END:VCARD$/);
  assert.throws(() => utils.buildVcard({ name: 'No phone' }), /needs a phone number/);
});

test('resolveMedia reads buffers, files and objects', async () => {
  const fromBuffer = await utils.resolveMedia(Buffer.from('hello'), { filename: 'a.txt' });
  assert.equal(fromBuffer.buffer.toString(), 'hello');
  assert.equal(fromBuffer.mimetype, 'text/plain');

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wace-'));
  const file = path.join(dir, 'note.pdf');
  await fs.promises.writeFile(file, 'pdf-bytes');
  const fromFile = await utils.resolveMedia(file);
  assert.equal(fromFile.buffer.toString(), 'pdf-bytes');
  assert.equal(fromFile.mimetype, 'application/pdf');
  assert.equal(fromFile.filename, 'note.pdf');

  const fromObject = await utils.resolveMedia({
    data: Buffer.from('b64').toString('base64'),
    mimetype: 'image/png',
    filename: 'x.png',
  });
  assert.equal(fromObject.buffer.toString(), 'b64');
  assert.equal(fromObject.mimetype, 'image/png');
});

test('resolveMedia rejects unusable input', async () => {
  await assert.rejects(() => utils.resolveMedia('/nope/missing.png'), /does not exist/);
  await assert.rejects(() => utils.resolveMedia(42), /Unsupported media input/);
});

test('guessMime falls back to octet-stream', () => {
  assert.equal(utils.guessMime('a.JPG'), 'image/jpeg');
  assert.equal(utils.guessMime('blob.unknown'), 'application/octet-stream');
});

test('safeEmit never throws for an unhandled error event', () => {
  const { EventEmitter } = require('node:events');
  const emitter = new EventEmitter();
  let seen = null;
  emitter.on('engine_error', (err) => {
    seen = err;
  });
  assert.doesNotThrow(() => utils.safeEmit(emitter, 'error', new Error('boom')));
  assert.equal(seen.message, 'boom');
});

test('withTimeout rejects with TIMEOUT', async () => {
  const keeper = setTimeout(() => {}, 250); // keeps the loop alive while we race
  await assert.rejects(
    () => utils.withTimeout(new Promise(() => {}), 10),
    (err) => err.code === 'TIMEOUT',
  );
  clearTimeout(keeper);
  assert.equal(await utils.withTimeout(Promise.resolve(7), 50), 7);
});
