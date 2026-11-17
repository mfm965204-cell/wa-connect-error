'use strict';

/**
 * 02 - Pair with a phone number instead of scanning, then send media.
 *
 *   npm install @whiskeysockets/baileys
 *   node examples/02-pairing-code-and-media.js 919876543210
 *
 * WhatsApp > Linked devices > Link with phone number, then type the code.
 */

const { createClient } = require('..');

const phone = process.argv[2];
if (!phone) {
  console.error('usage: node examples/02-pairing-code-and-media.js <phone with country code>');
  process.exit(1);
}

const client = createClient({
  engine: 'baileys',
  sessionPath: './.wa-session-baileys',
  printQR: false,
});

client.on('ready', async () => {
  await client.sendImage(phone, { path: './photo.jpg', filename: 'photo.jpg' }, { caption: 'A caption' });
  await client.sendDocument(phone, { path: './invoice.pdf' }, { caption: 'Your invoice' });
  await client.sendLocation(phone, { latitude: 19.076, longitude: 72.8777, name: 'Mumbai' });
  await client.sendPoll(phone, { name: 'Lunch?', options: ['Yes', 'No'] });

  await client.disconnect();
});

client.on('disconnected', (info) => console.log('disconnected:', info.reason));
client.on('error', (err) => console.error('error:', err.code, err.message));

(async () => {
  await client.connect();
  // Ask for the 8-character code once the socket is up.
  const { code } = await client.requestPairingCode(phone);
  console.log('Enter this code on your phone:', code);
})();
