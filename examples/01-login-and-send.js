'use strict';

/**
 * 01 - Log in by scanning a QR code, then send one message.
 *
 *   npm install whatsapp-web.js
 *   node examples/01-login-and-send.js
 *
 * The session is stored in ./.wa-session, so the second run skips the QR.
 */

const { createClient } = require('..');

const client = createClient({
  engine: 'whatsapp-web', // or 'baileys'
  sessionPath: './.wa-session',
  printQR: true,
});

client.on('qr', (qr) => {
  // printQR already draws it in the terminal; this is the raw string
  // if you would rather render it in a web page.
  console.log('QR received, %d characters', qr.length);
});

client.on('ready', async (me) => {
  console.log('Logged in as', me.phone);

  const result = await client.sendText('919876543210', 'Hello from my own number');
  console.log('sent', result.id);

  await client.disconnect();
});

client.on('auth_failure', (err) => console.error('login failed:', err.message));
client.on('error', (err) => console.error('error:', err.code, err.message));

client.connect().catch((err) => {
  console.error('could not start:', err.message);
  process.exit(1);
});
