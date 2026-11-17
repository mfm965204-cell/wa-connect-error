'use strict';

/**
 * 03 - A tiny auto-reply bot with a command, group admin actions and a
 *      graceful shutdown. Run with the whatsapp-web engine.
 *
 *   npm install whatsapp-web.js
 *   node examples/03-bot-and-groups.js
 */

const { createClient } = require('..');

const client = createClient({ engine: 'whatsapp-web', sessionPath: './.wa-session' });

client.on('ready', async (me) => {
  console.log('bot online as', me.phone);
});

client.on('message', async (message) => {
  if (message.fromMe || message.isStatus) return;

  try {
    if (message.body === '!ping') {
      await client.sendText(message.chatId, 'pong');
      return;
    }

    if (message.body === '!whoami') {
      const me = await client.getMe();
      await client.sendText(message.chatId, `You are ${message.from}, I am ${me.phone}`);
      return;
    }

    if (message.body === '!groups' && message.isGroup) {
      const group = await client.getGroupInfo(message.chatId);
      const admins = group.participants.filter((p) => p.isAdmin).map((p) => p.id.split('@')[0]);
      await client.sendText(message.chatId, `Group: ${group.name}\nAdmins: ${admins.join(', ')}`);
      return;
    }

    if (message.body.startsWith('!invite') && message.isGroup) {
      const { code } = await client.getGroupInviteCode(message.chatId);
      await client.sendText(message.chatId, `https://chat.whatsapp.com/${code}`);
    }
  } catch (err) {
    console.error('handler failed:', err.code, err.message);
  }
});

client.on('disconnected', (info) => console.log('session ended:', info.reason));
client.on('error', (err) => console.error('error:', err.code, err.message));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await client.disconnect();
    process.exit(0);
  });
}

client.connect();
