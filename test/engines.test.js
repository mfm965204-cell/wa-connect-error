'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WhatsAppWebAdapter } = require('../src/engines/whatsapp-web');
const { BaileysAdapter } = require('../src/engines/baileys');

/** Public methods only: the contract the facade relies on. */
function publicMethods(Adapter) {
  return Object.getOwnPropertyNames(Adapter.prototype)
    .filter((name) => name !== 'constructor' && !name.startsWith('_'))
    .sort();
}

test('both engines expose the same public method surface', () => {
  const wweb = publicMethods(WhatsAppWebAdapter);
  const baileys = publicMethods(BaileysAdapter);
  assert.deepEqual(
    wweb.filter((m) => !baileys.includes(m)),
    [],
    'methods missing from the Baileys adapter',
  );
  assert.deepEqual(
    baileys.filter((m) => !wweb.includes(m)),
    [],
    'methods missing from the whatsapp-web adapter',
  );
});

test('the surface covers the documented API', () => {
  const expected = [
    'addParticipants',
    'archiveChat',
    'createGroup',
    'deleteMessage',
    'demoteParticipants',
    'destroy',
    'downloadMedia',
    'forwardMessage',
    'getChat',
    'getChats',
    'getContacts',
    'getGroupInfo',
    'getGroupInviteCode',
    'getGroups',
    'getMe',
    'getMessages',
    'getProfilePicture',
    'getState',
    'isRegistered',
    'leaveGroup',
    'markRead',
    'muteChat',
    'pinChat',
    'promoteParticipants',
    'removeParticipants',
    'requestPairingCode',
    'revokeGroupInvite',
    'searchMessages',
    'sendAudio',
    'sendContact',
    'sendDocument',
    'sendImage',
    'sendLocation',
    'sendPoll',
    'sendReaction',
    'sendText',
    'sendTyping',
    'sendVideo',
    'setDisplayName',
    'setGroupDescription',
    'setGroupSubject',
    'setStatus',
  ];
  for (const Adapter of [WhatsAppWebAdapter, BaileysAdapter]) {
    const methods = publicMethods(Adapter);
    for (const name of expected) {
      assert.ok(methods.includes(name), `${Adapter.name} is missing ${name}`);
    }
  }
});

test('adapters report their own name and package', () => {
  const wweb = new WhatsAppWebAdapter({ sessionPath: './tmp' });
  const baileys = new BaileysAdapter({ sessionPath: './tmp' });
  assert.equal(wweb.name, 'whatsapp-web');
  assert.equal(baileys.name, 'baileys');
  assert.equal(WhatsAppWebAdapter.packageName, 'whatsapp-web.js');
  assert.equal(BaileysAdapter.packageName, '@whiskeysockets/baileys');
  assert.equal(typeof WhatsAppWebAdapter.available(), 'boolean');
  assert.equal(typeof BaileysAdapter.available(), 'boolean');
});
