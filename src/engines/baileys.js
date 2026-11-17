'use strict';

const { EventEmitter } = require('node:events');
const { WaConnectError, codes } = require('../errors');
const {
  toDigits,
  toBaileysJid,
  isGroupId,
  resolveMedia,
  buildVcard,
  toMillis,
  safeEmit,
} = require('../utils');

/** A pino-shaped no-op logger, so Baileys stays quiet unless you ask it not to. */
function silentLogger() {
  const noop = () => {};
  const logger = {
    level: 'silent',
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  };
  return logger;
}

function unwrapMessage(message) {
  if (!message) return null;
  if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage) {
    return unwrapMessage(message.documentWithCaptionMessage.message);
  }
  return message;
}

/**
 * Adapter over `@whiskeysockets/baileys` (WebSocket, no browser).
 * Lighter and faster to start than Puppeteer; keeps less history locally.
 */
class BaileysAdapter extends EventEmitter {
  /** @param {object} options normalised client options */
  constructor(options) {
    super();
    this.name = 'baileys';
    this.options = options;
    this.raw = null;
    this._lib = null;
    this._me = null;
    this._saveCreds = null;
    this._attempts = 0;
    this._destroyed = false;
    this._contacts = new Map();
    this._chats = new Map();
    this._groups = new Map();
  }

  static get packageName() {
    return '@whiskeysockets/baileys';
  }

  static available() {
    try {
      require.resolve('@whiskeysockets/baileys');
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------- lifecycle

  async connect() {
    if (this.raw) return this;
    let lib;
    try {
      lib = require('@whiskeysockets/baileys');
    } catch (cause) {
      throw new WaConnectError(
        '@whiskeysockets/baileys is not installed. Run: npm install @whiskeysockets/baileys',
        { code: codes.ENGINE_NOT_INSTALLED, engine: this.name, cause },
      );
    }
    this._lib = lib;

    const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = lib;
    this._DisconnectReason = DisconnectReason;

    let state;
    let saveCreds;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(this.options.sessionPath));
    } catch (cause) {
      throw new WaConnectError(`Could not read the session folder: ${this.options.sessionPath}`, {
        code: codes.SESSION_ERROR,
        engine: this.name,
        cause,
      });
    }
    this._saveCreds = saveCreds;

    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      version = undefined; // fall back to the version bundled with the library
    }

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: this.options.browser || Browsers.ubuntu('Desktop'),
      logger: this.options.logger || silentLogger(),
      syncFullHistory: Boolean(this.options.syncFullHistory),
      markOnlineOnConnect: this.options.markOnlineOnConnect !== false,
      generateHighQualityLinkPreview: this.options.linkPreview !== false,
      ...(this.options.socketOptions || {}),
    });
    this.raw = sock;

    sock.ev.on('creds.update', () => {
      Promise.resolve()
        .then(() => this._saveCreds && this._saveCreds())
        .catch((err) => safeEmit(this, 'error', WaConnectError.from(err, { engine: this.name })));
    });

    sock.ev.on('connection.update', (update) => this._onConnectionUpdate(update));
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') return;
      for (const msg of messages || []) {
        const normalised = this._normalizeMessage(msg);
        if (!normalised || normalised.isProtocol) continue;
        safeEmit(this, 'message', normalised);
        if (normalised.fromMe) safeEmit(this, 'message_create', normalised);
      }
    });
    sock.ev.on('messages.update', (updates) => {
      for (const item of updates || []) {
        safeEmit(this, 'message_update', {
          id: item.key && item.key.id,
          chatId: item.key && item.key.remoteJid,
          status: item.update && item.update.status,
          engine: this.name,
          raw: item,
        });
      }
    });
    sock.ev.on('contacts.upsert', (contacts) => this._cacheContacts(contacts));
    sock.ev.on('contacts.update', (contacts) => this._cacheContacts(contacts));
    sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      this._cacheContacts(contacts);
      for (const chat of chats || []) this._chats.set(chat.id, chat);
      if (messages && messages.length) {
        safeEmit(this, 'history', { count: messages.length, engine: this.name });
      }
    });
    sock.ev.on('groups.upsert', (groups) => this._cacheGroups(groups));
    sock.ev.on('groups.update', (groups) => this._cacheGroups(groups));
    sock.ev.on('call', (calls) => safeEmit(this, 'call', calls));

    return this;
  }

  _onConnectionUpdate(update) {
    if (update.qr) safeEmit(this, 'qr', update.qr);

    if (update.connection === 'connecting') safeEmit(this, 'state', 'connecting');

    if (update.connection === 'open') {
      this._attempts = 0;
      this._me = this._normalizeMe(this.raw.user);
      safeEmit(this, 'ready', this._me);
    }

    if (update.connection === 'close') {
      const statusCode = update.lastDisconnect && update.lastDisconnect.error
        && update.lastDisconnect.error.output
        ? update.lastDisconnect.error.output.statusCode
        : undefined;
      const loggedOut = statusCode === this._DisconnectReason.loggedOut;
      this._me = null;
      safeEmit(this, 'state', 'close');
      safeEmit(this, 'disconnected', {
        code: statusCode,
        loggedOut,
        reason:
          (update.lastDisconnect && update.lastDisconnect.error && update.lastDisconnect.error.message) ||
          'connection closed',
      });

      if (loggedOut) {
        safeEmit(
          this,
          'auth_failure',
          new WaConnectError('This session was logged out from the phone', {
            code: codes.LOGIN_FAILED,
            engine: this.name,
          }),
        );
        return;
      }

      const maxAttempts = this.options.maxReconnectAttempts ?? 5;
      if (this._destroyed || this.options.autoReconnect === false || this._attempts >= maxAttempts) return;
      this._attempts += 1;
      const delayMs = Math.min(2000 * this._attempts, 15000);
      const timer = setTimeout(() => {
        if (this._destroyed) return;
        this.raw = null;
        this.connect().catch((err) => safeEmit(this, 'error', WaConnectError.from(err, { engine: this.name })));
      }, delayMs);
      timer.unref?.();
    }
  }

  async destroy({ logout = false } = {}) {
    this._destroyed = true;
    const sock = this.raw;
    this.raw = null;
    this._me = null;
    if (!sock) return;
    try {
      if (logout) await sock.logout();
      else sock.end(undefined);
    } catch {
      // already closed
    }
  }

  // ------------------------------------------------------------------- helpers

  _normalizeMe(user) {
    if (!user) return null;
    return {
      id: user.id,
      phone: toDigits(user.id),
      name: user.name || user.verifiedName || undefined,
      engine: this.name,
    };
  }

  _normalizeMessage(msg) {
    if (!msg || !msg.key) return null;
    const key = msg.key;
    const content = unwrapMessage(msg.message) || {};
    const text =
      content.conversation ||
      (content.extendedTextMessage && content.extendedTextMessage.text) ||
      (content.imageMessage && content.imageMessage.caption) ||
      (content.videoMessage && content.videoMessage.caption) ||
      (content.documentMessage && content.documentMessage.caption) ||
      (content.buttonsResponseMessage && content.buttonsResponseMessage.selectedDisplayText) ||
      (content.listResponseMessage && content.listResponseMessage.title) ||
      '';

    const type = Object.keys(content)[0] || 'unknown';
    return {
      id: key.id,
      chatId: key.remoteJid,
      from: key.fromMe ? key.remoteJid : key.participant || key.remoteJid,
      to: key.fromMe ? key.remoteJid : undefined,
      body: text,
      type,
      timestamp: toMillis(msg.messageTimestamp),
      isGroup: isGroupId(key.remoteJid),
      isStatus: key.remoteJid === 'status@broadcast',
      fromMe: Boolean(key.fromMe),
      hasMedia: Boolean(
        content.imageMessage ||
          content.videoMessage ||
          content.audioMessage ||
          content.documentMessage ||
          content.stickerMessage,
      ),
      isProtocol: type === 'protocolMessage',
      pushName: msg.pushName,
      engine: this.name,
      raw: msg,
    };
  }

  _cacheContacts(contacts) {
    for (const contact of contacts || []) {
      if (!contact || !contact.id) continue;
      const existing = this._contacts.get(contact.id) || {};
      this._contacts.set(contact.id, { ...existing, ...contact });
    }
  }

  _cacheGroups(groups) {
    for (const group of groups || []) {
      if (!group || !group.id) continue;
      this._groups.set(group.id, { ...(this._groups.get(group.id) || {}), ...group });
    }
  }

  _normalizeGroup(group) {
    if (!group) return null;
    return {
      id: group.id,
      name: group.subject,
      description: group.desc,
      owner: group.owner,
      createdAt: toMillis(group.creation),
      participants: (group.participants || []).map((p) => ({
        id: p.id,
        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        isSuperAdmin: p.admin === 'superadmin',
      })),
      engine: this.name,
      raw: group,
    };
  }

  _store() {
    return this.options.store || null;
  }

  // ------------------------------------------------------------------ messaging

  _messageOptions(options = {}) {
    const result = {};
    if (options.quoted) result.quoted = options.quoted.raw || options.quoted;
    if (options.ephemeralExpiration) result.ephemeralExpiration = options.ephemeralExpiration;
    if (options.messageId) result.messageId = options.messageId;
    return result;
  }

  async sendText(chatId, text, options = {}) {
    if (typeof text !== 'string' || !text.length) {
      throw new WaConnectError('sendText needs a non-empty string', { code: codes.INVALID_ARGUMENT });
    }
    const sent = await this.raw.sendMessage(toBaileysJid(chatId), { text }, this._messageOptions(options));
    return this._normalizeMessage(sent);
  }

  async sendImage(chatId, media, options = {}) {
    const { buffer, mimetype } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { image: buffer, caption: options.caption, mimetype },
      this._messageOptions(options),
    );
    return this._normalizeMessage(sent);
  }

  async sendVideo(chatId, media, options = {}) {
    const { buffer, mimetype } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { video: buffer, caption: options.caption, mimetype, gifPlayback: Boolean(options.gifPlayback) },
      this._messageOptions(options),
    );
    return this._normalizeMessage(sent);
  }

  async sendDocument(chatId, media, options = {}) {
    const { buffer, mimetype, filename } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      {
        document: buffer,
        mimetype,
        fileName: filename || 'file',
        caption: options.caption,
      },
      this._messageOptions(options),
    );
    return this._normalizeMessage(sent);
  }

  async sendAudio(chatId, media, options = {}) {
    const { buffer, mimetype } = await resolveMedia(media, { mimetype: 'audio/mp4' });
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { audio: buffer, mimetype, ptt: Boolean(options.voice) },
      this._messageOptions(options),
    );
    return this._normalizeMessage(sent);
  }

  async sendLocation(chatId, { latitude, longitude, name, address } = {}) {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new WaConnectError('sendLocation needs numeric latitude and longitude', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { location: { degreesLatitude: latitude, degreesLongitude: longitude, name, address } },
      this._messageOptions(),
    );
    return this._normalizeMessage(sent);
  }

  async sendContact(chatId, contact = {}) {
    const vcard = buildVcard(contact);
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { contacts: { displayName: contact.name || toDigits(contact.phone), contacts: [{ vcard }] } },
      this._messageOptions(),
    );
    return this._normalizeMessage(sent);
  }

  async sendPoll(chatId, { name, options, allowMultipleAnswers = false } = {}) {
    if (!name || !Array.isArray(options) || options.length < 2) {
      throw new WaConnectError('sendPoll needs a name and at least two options', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const sent = await this.raw.sendMessage(
      toBaileysJid(chatId),
      { poll: { name, values: options, selectableCount: allowMultipleAnswers ? options.length : 1 } },
      this._messageOptions(),
    );
    return this._normalizeMessage(sent);
  }

  async sendReaction(chatId, messageId, emoji) {
    if (!messageId) {
      throw new WaConnectError('sendReaction needs the id of the message to react to', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const jid = toBaileysJid(chatId);
    await this.raw.sendMessage(jid, {
      react: { text: emoji || '', key: { remoteJid: jid, id: messageId, fromMe: false } },
    });
    return { ok: true, messageId, emoji: emoji || '' };
  }

  async deleteMessage(chatId, messageId, forEveryone = true) {
    if (!forEveryone) {
      throw new WaConnectError('Baileys can only delete a message for everyone', {
        code: codes.ENGINE_UNSUPPORTED,
        engine: this.name,
        method: 'deleteMessage',
      });
    }
    const jid = toBaileysJid(chatId);
    await this.raw.sendMessage(jid, {
      delete: { remoteJid: jid, id: messageId, fromMe: true },
    });
    return { ok: true, messageId };
  }

  async forwardMessage() {
    throw new WaConnectError(
      'forwardMessage needs a message store with Baileys. Use the whatsapp-web engine, or re-send the content.',
      { code: codes.ENGINE_UNSUPPORTED, engine: this.name, method: 'forwardMessage' },
    );
  }

  async downloadMedia(message) {
    const raw = message && message.raw ? message.raw : message;
    if (!raw || !raw.message) {
      throw new WaConnectError('downloadMedia needs a normalised message from an event', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const buffer = await this._lib.downloadMediaMessage(raw, 'buffer', {}, {
      logger: this.options.logger || silentLogger(),
      reuploadRequest: this.raw.updateMediaMessage,
    });
    const content = unwrapMessage(raw.message) || {};
    const inner =
      content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || {};
    return {
      buffer,
      mimetype: inner.mimetype,
      filename: inner.fileName,
    };
  }

  // --------------------------------------------------------------------- reading

  async getMe() {
    return this._me || this._normalizeMe(this.raw.user);
  }

  async getState() {
    return this.raw ? (this.raw.ws && this.raw.ws.isOpen ? 'CONNECTED' : 'DISCONNECTED') : null;
  }

  async getContacts() {
    const store = this._store();
    const source = store && store.contacts ? Object.values(store.contacts) : [...this._contacts.values()];
    return source
      .filter((c) => c && c.id)
      .map((c) => ({
        id: c.id,
        phone: toDigits(c.id),
        name: c.name || c.notify || c.verifiedName,
        isMyContact: c.id ? true : undefined,
        engine: this.name,
        raw: c,
      }));
  }

  async getChats() {
    const store = this._store();
    const source = store && store.chats ? store.chats.all() : [...this._chats.values()];
    return source.map((chat) => ({
      id: chat.id,
      name: chat.name || (chat.id ? toDigits(chat.id) : undefined),
      isGroup: isGroupId(chat.id),
      unreadCount: chat.unreadCount,
      timestamp: toMillis(chat.conversationTimestamp),
      lastMessage: undefined,
      engine: this.name,
      raw: chat,
    }));
  }

  async getChat(chatId) {
    const jid = toBaileysJid(chatId);
    const store = this._store();
    const chat = store && store.chats ? store.chats.get(jid) : this._chats.get(jid);
    if (!chat) {
      throw new WaConnectError(
        'Chat not found in the local cache. Enable a store or use the whatsapp-web engine.',
        { code: codes.ENGINE_UNSUPPORTED, engine: this.name, method: 'getChat' },
      );
    }
    return {
      id: chat.id,
      name: chat.name,
      isGroup: isGroupId(chat.id),
      unreadCount: chat.unreadCount,
      timestamp: toMillis(chat.conversationTimestamp),
      engine: this.name,
      raw: chat,
    };
  }

  async getMessages(chatId, limit = 20) {
    const store = this._store();
    if (!store || typeof store.loadMessages !== 'function') {
      throw new WaConnectError(
        'Reading history needs a Baileys store. Pass { store } built with makeInMemoryStore, or use the whatsapp-web engine.',
        { code: codes.ENGINE_UNSUPPORTED, engine: this.name, method: 'getMessages' },
      );
    }
    const messages = await store.loadMessages(toBaileysJid(chatId), limit);
    return messages.map((m) => this._normalizeMessage(m));
  }

  async searchMessages() {
    throw new WaConnectError(
      'searchMessages is only available with the whatsapp-web engine',
      { code: codes.ENGINE_UNSUPPORTED, engine: this.name, method: 'searchMessages' },
    );
  }

  // ---------------------------------------------------------------------- groups

  async getGroups() {
    const groups = await this.raw.groupFetchAllParticipating();
    return Object.values(groups || {}).map((g) => this._normalizeGroup(g));
  }

  async getGroupInfo(groupId) {
    return this._normalizeGroup(await this.raw.groupMetadata(toBaileysJid(groupId)));
  }

  async createGroup(name, participants) {
    if (!name || !Array.isArray(participants) || participants.length === 0) {
      throw new WaConnectError('createGroup needs a name and at least one participant', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const group = await this.raw.groupCreate(name, participants.map((p) => toBaileysJid(p)));
    return this._normalizeGroup(group);
  }

  async _participantsUpdate(groupId, participants, action) {
    const jid = toBaileysJid(groupId);
    const jids = participants.map((p) => toBaileysJid(p));
    const result = await this.raw.groupParticipantsUpdate(jid, jids, action);
    return { groupId: jid, action, participants: jids, result };
  }

  addParticipants(groupId, participants) {
    return this._participantsUpdate(groupId, participants, 'add');
  }

  removeParticipants(groupId, participants) {
    return this._participantsUpdate(groupId, participants, 'remove');
  }

  promoteParticipants(groupId, participants) {
    return this._participantsUpdate(groupId, participants, 'promote');
  }

  demoteParticipants(groupId, participants) {
    return this._participantsUpdate(groupId, participants, 'demote');
  }

  async setGroupSubject(groupId, subject) {
    await this.raw.groupUpdateSubject(toBaileysJid(groupId), subject);
    return { ok: true, groupId, subject };
  }

  async setGroupDescription(groupId, description) {
    await this.raw.groupUpdateDescription(toBaileysJid(groupId), description);
    return { ok: true, groupId, description };
  }

  async leaveGroup(groupId) {
    await this.raw.groupLeave(toBaileysJid(groupId));
    return { ok: true, groupId };
  }

  async getGroupInviteCode(groupId) {
    return { groupId, code: await this.raw.groupInviteCode(toBaileysJid(groupId)) };
  }

  async revokeGroupInvite(groupId) {
    return { groupId, code: await this.raw.groupRevokeInvite(toBaileysJid(groupId)) };
  }

  // --------------------------------------------------------------------- account

  async isRegistered(number) {
    const jid = toBaileysJid(number);
    const [result] = (await this.raw.onWhatsApp(jid)) || [];
    return { exists: Boolean(result && result.exists), jid: (result && result.jid) || null };
  }

  async getProfilePicture(id) {
    try {
      return (await this.raw.profilePictureUrl(toBaileysJid(id), 'image')) || null;
    } catch {
      return null;
    }
  }

  async setStatus(status) {
    await this.raw.updateProfileStatus(status);
    return { ok: true, status };
  }

  async setDisplayName(name) {
    await this.raw.updateProfileName(name);
    return { ok: true, name };
  }

  async requestPairingCode(phoneNumber) {
    const phone = toDigits(phoneNumber);
    const registered = this.raw.authState && this.raw.authState.creds && this.raw.authState.creds.registered;
    if (registered) {
      throw new WaConnectError('This session is already paired; log out before requesting a new code', {
        code: codes.SESSION_ERROR,
        engine: this.name,
      });
    }
    const code = await this.raw.requestPairingCode(phone);
    return { code, phone };
  }

  // ------------------------------------------------------------------ chat state

  async markRead(chatId, messageIds) {
    const jid = toBaileysJid(chatId);
    let keys = [];
    if (Array.isArray(messageIds) && messageIds.length) {
      keys = messageIds.map((id) =>
        typeof id === 'string' ? { remoteJid: jid, id, fromMe: false } : { remoteJid: jid, ...id },
      );
    } else {
      const store = this._store();
      if (!store || typeof store.loadMessages !== 'function') {
        throw new WaConnectError(
          'markRead needs message ids with Baileys (pass an array as the second argument)',
          { code: codes.ENGINE_UNSUPPORTED, engine: this.name, method: 'markRead' },
        );
      }
      const recent = await store.loadMessages(jid, 10);
      keys = recent.map((m) => m.key);
    }
    await this.raw.readMessages(keys);
    return { ok: true, chatId, count: keys.length };
  }

  async sendTyping(chatId, state = 'composing') {
    const map = { composing: 'composing', paused: 'paused', recording: 'recording' };
    await this.raw.sendPresenceUpdate(map[state] || 'composing', toBaileysJid(chatId));
    return { ok: true, chatId, state };
  }

  async archiveChat(chatId, archive = true) {
    await this.raw.chatModify({ archive }, toBaileysJid(chatId));
    return { ok: true, chatId, archived: archive };
  }

  async pinChat(chatId, pin = true) {
    await this.raw.chatModify({ pin }, toBaileysJid(chatId));
    return { ok: true, chatId, pinned: pin };
  }

  async muteChat(chatId, until = null) {
    const mute = until ? Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)) : null;
    await this.raw.chatModify({ mute }, toBaileysJid(chatId));
    return { ok: true, chatId, mutedUntil: until };
  }
}

module.exports = { BaileysAdapter };
