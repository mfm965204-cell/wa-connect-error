# wa-connect-error

Log in to WhatsApp Web from **your own number** — scan a QR or type a pairing code — then send messages, media, polls and locations, read chats, and run group admin actions. One small API on top of two interchangeable engines: [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and [Baileys](https://github.com/WhiskeySockets/Baileys).

Switch engines by changing one string. Your calling code stays the same.

```js
const { createClient } = require('wa-connect-error');

const client = createClient({ engine: 'whatsapp-web' }); // or 'baileys'

client.on('qr', (qr) => console.log(qr));          // scan once, session is reused
client.on('ready', async (me) => {
  console.log('logged in as', me.phone);
  await client.sendText('919876543210', 'Hello from my own number');
});

client.connect();
```

- **One API, two engines.** `whatsapp-web.js` (Puppeteer, full feature set) and `baileys` (WebSocket, no browser, starts in about a second).
- **Login is just a QR or a pairing code.** Sessions persist in a folder, so you scan once.
- **Uniform results.** Every message comes back as the same normalised object, whatever the engine.
- **Errors you can branch on.** Every failure is a `WaConnectError` with a stable `code`.
- **Zero dependencies of its own** except `qrcode-terminal`; both engines are optional peer dependencies.
- **Typed.** Ships `index.d.ts`.

## Install

```bash
npm install wa-connect-error
```

Then install the engine you want to use — the package never forces both:

```bash
npm install whatsapp-web.js                    # engine: 'whatsapp-web'
npm install @whiskeysockets/baileys            # engine: 'baileys'
```

Node.js 18 or newer. `whatsapp-web.js` drives a headless Chromium through Puppeteer, so it needs the browser download (or `PUPPETEER_EXECUTABLE_PATH` pointing at an installed Chrome).

## Logging in

### Option 1 — QR code (both engines)

```js
const client = createClient({ engine: 'whatsapp-web', sessionPath: './.wa-session', printQR: true });
client.on('qr', (qr) => { /* printQR already draws it; this is the raw string */ });
client.on('ready', (me) => console.log('logged in as', me.phone));
client.connect();
```

On your phone: **WhatsApp → Settings → Linked devices → Link a device**, then scan.

### Option 2 — pairing code (no camera needed)

```js
const client = createClient({ engine: 'baileys', printQR: false });
await client.connect();
const { code } = await client.requestPairingCode('919876543210');
console.log('type this on your phone:', code);
```

On your phone: **Linked devices → Link with phone number**, then type the eight characters.

### Staying logged in

The session lives in `sessionPath` (default `./.wa-session`). Keep that folder across restarts and no QR is needed. `client.logout()` unlinks the device from the phone and clears the session; `client.disconnect()` just stops the process.

Treat the session folder like a password: it is a full login to the account. Never commit it — `.gitignore` in this repo already excludes it.

## The API

### Lifecycle

| Method | What it does |
| --- | --- |
| `createClient(options)` | Build a client. Nothing starts until `connect()`. |
| `client.connect()` | Start the engine. Resolves when the client is running (a `qr` event follows for a new number). |
| `client.waitForReady({ timeoutMs })` | Resolve with your account once login completes. |
| `client.waitFor(event, { timeoutMs })` | Resolve on the next occurrence of any event. |
| `client.disconnect({ logout })` | Stop the engine. `logout: true` also unlinks the device. |
| `client.logout()` | Shortcut for `disconnect({ logout: true })`. |
| `client.requestPairingCode(phone)` | Get an eight-character pairing code. |

### Sending

| Method | Notes |
| --- | --- |
| `sendText(chatId, text, opts)` | `opts.linkPreview`, `opts.sendSeen` |
| `sendImage(chatId, media, opts)` | `opts.caption` |
| `sendVideo(chatId, media, opts)` | `opts.caption`, `opts.gifPlayback` |
| `sendDocument(chatId, media, opts)` | `opts.caption` |
| `sendAudio(chatId, media, opts)` | `opts.voice` for a voice note |
| `sendLocation(chatId, { latitude, longitude, name, address })` | |
| `sendContact(chatId, { name, phone })` | Sends a vCard |
| `sendPoll(chatId, { name, options, allowMultipleAnswers })` | |
| `sendReaction(chatId, messageId, emoji)` | Empty string removes the reaction |
| `deleteMessage(chatId, messageId, forEveryone)` | |
| `forwardMessage(chatId, messageId)` | whatsapp-web engine only |
| `downloadMedia(messageOrId)` | Returns `{ buffer, mimetype, filename }` |

`chatId` accepts a phone number (`'919876543210'`), a jid (`'919876543210@c.us'`, `'...@s.whatsapp.net'`) or a group id (`'...@g.us'`). The right suffix is applied for the engine you chose.

`media` accepts a `Buffer`, a file path, an `https://` URL, or `{ buffer | path | url | data (base64), mimetype, filename }`.

### Reading

| Method | Notes |
| --- | --- |
| `getMe()` | `{ id, phone, name, engine }` |
| `getState()` | Engine connection state |
| `getContacts()` | Normalised contacts |
| `getChats()` | Normalised chats |
| `getChat(chatId)` | One chat |
| `getMessages(chatId, limit)` | Recent messages |
| `searchMessages(query, limit)` | whatsapp-web engine only |

### Groups

`getGroups()`, `getGroupInfo(id)`, `createGroup(name, participants)`, `addParticipants(id, list)`, `removeParticipants(id, list)`, `promoteParticipants(id, list)`, `demoteParticipants(id, list)`, `setGroupSubject(id, subject)`, `setGroupDescription(id, text)`, `leaveGroup(id)`, `getGroupInviteCode(id)`, `revokeGroupInvite(id)`.

### Account and chat state

`isRegistered(number)` → `{ exists, jid }`, `getProfilePicture(id)`, `setStatus(text)`, `setDisplayName(name)`, `markRead(chatId, messageIds?)`, `sendTyping(chatId, 'composing' | 'paused' | 'recording')`, `archiveChat(chatId, bool)`, `pinChat(chatId, bool)`, `muteChat(chatId, until)`.

### Events

`qr`, `ready`, `message`, `message_create`, `message_update`, `message_ack`, `authenticated`, `state`, `loading`, `history`, `call`, `disconnected`, `auth_failure`, `session_saved`, `closed`, `error`.

Every `message` is the same shape from both engines:

```js
{
  id: 'false_919876543210@c.us_3EB0...',
  chatId: '919876543210@c.us',
  from: '919876543210@c.us',
  body: 'hello',
  type: 'chat',
  timestamp: 1731890000000,   // milliseconds
  isGroup: false,
  isStatus: false,
  fromMe: false,
  hasMedia: false,
  engine: 'whatsapp-web',
  raw: /* the engine's own object, untouched */
}
```

The `raw` field is always there, so anything this API does not wrap is still reachable through `client.raw` (the whatsapp-web.js `Client`) or `message.raw`.

### Errors

```js
const { WaConnectError, codes } = require('wa-connect-error');

try {
  await client.sendText('919876543210', 'hi');
} catch (err) {
  if (err instanceof WaConnectError && err.code === codes.NOT_CONNECTED) {
    await client.connect();
  } else {
    throw err;
  }
}
```

| Code | Meaning |
| --- | --- |
| `ENGINE_NOT_INSTALLED` | The engine package is missing — `npm install` it |
| `ENGINE_UNSUPPORTED` | This engine cannot do that action (see the matrix) |
| `INVALID_ARGUMENT` | Bad phone number, missing text, malformed poll |
| `NOT_CONNECTED` | Called before `connect()`, or after `disconnect()` |
| `LOGIN_FAILED` | Authentication or pairing failed |
| `SESSION_ERROR` | The session folder is unreadable or already paired |
| `MEDIA_ERROR` | Media missing, undownloadable, or not present on the message |
| `SEND_FAILED` | The engine rejected the send |
| `TIMEOUT` | `waitFor*` expired |
| `WA_ERROR` | Anything else from the engine — read `err.cause` |

## Which engine?

| | `whatsapp-web.js` | `baileys` |
| --- | --- | --- |
| Login | QR or pairing code | QR or pairing code |
| Runtime | headless Chromium (Puppeteer) | plain WebSocket |
| Start time | several seconds | about a second |
| Memory | heavy | light |
| Read history, `searchMessages`, `forwardMessage` | yes | needs a store |
| Group admin, polls, media, locations | yes | yes |
| Best for | feature-complete bots, desktop/server with headroom | small VMs, serverless-ish workers, many sessions |

Baileys keeps little in memory by design. If you want history reads, pass a store:

```js
const { makeInMemoryStore } = require('@whiskeysockets/baileys');
const store = makeInMemoryStore({});
const client = createClient({ engine: 'baileys', store });
```

Actions an engine cannot do throw `ENGINE_UNSUPPORTED` with a message that says what to use instead. Nothing silently no-ops.

## Before you ship this

- **This is unofficial.** Both engines drive WhatsApp Web the way a browser would; they are not affiliated with WhatsApp or Meta. Bulk or unsolicited messaging breaks the [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and gets numbers banned. Use it for your own number, your own conversations, and with consent from the people you message.
- **One number, one session.** Running two processes on the same `sessionPath` corrupts the session.
- **Keep the QR path private.** Anyone who can see your `qr` event can link their device to the account until you approve or the code expires.
- **Sessions on servers** need persistent storage — a mounted volume for `sessionPath`, not a container's scratch disk.

## Publishing this package (what the workflow does)

`.github/workflows/publish.yml` publishes to npm on every GitHub **release**, and can be run by hand from the Actions tab with a chosen dist-tag or as a dry run.

One-time setup in the repository:

1. Create an npm **Automation** access token: npmjs.com → Access Tokens → Generate New Token → *Automation*.
2. Add it as a repository secret named `NPM_TOKEN` (Settings → Secrets and variables → Actions).
3. Optional but recommended: create an environment named `npm` (Settings → Environments) so publishes can require approval.
4. Bump `version` in `package.json`, commit, then create a release tagged `v0.1.0` — the tag must match the version, and the workflow fails loudly if it does not.

The workflow runs lint and tests first, skips publishing if that exact version already exists on npm, and publishes with `--provenance` so npm shows a signed, verifiable link back to this repository and commit.

`.github/workflows/ci.yml` runs lint, tests, a smoke test and `npm pack --dry-run` on Node 18, 20 and 22 for every push and pull request.

## License

MIT

---

Developed by Error
