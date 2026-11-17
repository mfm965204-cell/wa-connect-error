'use strict';

const { EventEmitter } = require('node:events');
const { WaConnectError, codes } = require('../errors');
const { toDigits, toWwebJid, resolveMedia, buildVcard, toMillis, safeEmit } = require('../utils');

/**
 * Adapter over `whatsapp-web.js` (Puppeteer + a real WhatsApp Web session).
 * Gives the widest feature coverage: history, search, polls, channels,
 * reactions, media download.
 */
class WhatsAppWebAdapter extends EventEmitter {
  /** @param {object} options normalised client options */
  constructor(options) {
    super();
    this.name = 'whatsapp-web';
    this.options = options;
    this.raw = null;
    this._lib = null;
    this._me = null;
    this._destroyed = false;
  }

  static get packageName() {
    return 'whatsapp-web.js';
  }

  static available() {
    try {
      require.resolve('whatsapp-web.js');
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
      lib = require('whatsapp-web.js');
    } catch (cause) {
      throw new WaConnectError(
        'whatsapp-web.js is not installed. Run: npm install whatsapp-web.js',
        { code: codes.ENGINE_NOT_INSTALLED, engine: this.name, cause },
      );
    }
    this._lib = lib;

    const { Client, LocalAuth } = lib;
    const { sessionPath, clientId, puppeteer = {}, clientOptions = {}, qrTimeoutMs } = this.options;
    const { authStrategy: userAuthStrategy, ...restClientOptions } = clientOptions || {};

    const client = new Client({
      authStrategy: userAuthStrategy || new LocalAuth({ dataPath: sessionPath, clientId }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        ...puppeteer,
      },
      ...restClientOptions,
    });
    this.raw = client;

    client.on('qr', (qr) => safeEmit(this, 'qr', qr));
    client.on('loading_screen', (percent, message) =>
      safeEmit(this, 'loading', { percent, message }),
    );
    client.on('change_state', (state) => safeEmit(this, 'state', state));
    client.on('authenticated', (session) => safeEmit(this, 'authenticated', session));
    client.on('ready', () => {
      this._me = this._normalizeMe(client.info);
      safeEmit(this, 'ready', this._me);
    });
    client.on('message', (msg) => safeEmit(this, 'message', this._normalizeMessage(msg)));
    client.on('message_create', (msg) => safeEmit(this, 'message_create', this._normalizeMessage(msg)));
    client.on('message_ack', (msg, ack) =>
      safeEmit(this, 'message_ack', { id: msg && msg.id && msg.id._serialized, ack }),
    );
    client.on('auth_failure', (message) =>
      safeEmit(
        this,
        'auth_failure',
        new WaConnectError(`Authentication failed: ${message}`, {
          code: codes.LOGIN_FAILED,
          engine: this.name,
        }),
      ),
    );
    client.on('disconnected', (reason) => {
      this._me = null;
      safeEmit(this, 'disconnected', { reason, loggedOut: /logout/i.test(String(reason)) });
    });
    client.on('remote_session_saved', () => safeEmit(this, 'session_saved'));

    if (qrTimeoutMs) {
      // Surface a clear error instead of hanging forever if the QR is never scanned.
      this._qrTimer = setTimeout(() => {
        if (!this._me) {
          safeEmit(
            this,
            'error',
            new WaConnectError('Timed out waiting for the QR code to be scanned', {
              code: codes.TIMEOUT,
              engine: this.name,
            }),
          );
        }
      }, qrTimeoutMs);
      this._qrTimer.unref?.();
    }

    try {
      await client.initialize();
    } catch (cause) {
      throw WaConnectError.from(cause, { method: 'connect', engine: this.name, code: codes.LOGIN_FAILED });
    }
    return this;
  }

  async destroy({ logout = false } = {}) {
    this._destroyed = true;
    if (this._qrTimer) clearTimeout(this._qrTimer);
    const client = this.raw;
    this.raw = null;
    this._me = null;
    if (!client) return;
    try {
      if (logout) await client.logout();
      else await client.destroy();
    } catch {
      // A closed browser is the normal case here; nothing to recover.
    }
  }

  // ------------------------------------------------------------------- helpers

  _normalizeMe(info) {
    if (!info) return null;
    return {
      id: info.wid && info.wid._serialized,
      phone: toDigits(info.wid && info.wid.user),
      name: info.pushname || info.me && info.me.pushname || undefined,
      platform: info.platform,
      engine: this.name,
    };
  }

  _normalizeMessage(msg) {
    if (!msg) return null;
    const chatId = msg.from;
    return {
      id: msg.id && msg.id._serialized,
      chatId,
      from: msg.author || msg.from,
      to: msg.to,
      body: msg.body,
      type: msg.type,
      timestamp: toMillis(msg.timestamp),
      isGroup: Boolean(msg.isStatus ? false : String(chatId).endsWith('@g.us')),
      isStatus: Boolean(msg.isStatus),
      fromMe: Boolean(msg.fromMe),
      hasMedia: Boolean(msg.hasMedia),
      ack: msg.ack,
      engine: this.name,
      raw: msg,
    };
  }

  _normalizeChat(chat) {
    if (!chat) return null;
    return {
      id: chat.id && chat.id._serialized,
      name: chat.name,
      isGroup: Boolean(chat.isGroup),
      unreadCount: chat.unreadCount,
      timestamp: toMillis(chat.timestamp),
      isMuted: Boolean(chat.isMuted),
      isArchived: Boolean(chat.archived),
      lastMessage: chat.lastMessage ? chat.lastMessage.body : undefined,
      engine: this.name,
      raw: chat,
    };
  }

  _normalizeContact(contact) {
    if (!contact) return null;
    return {
      id: contact.id && contact.id._serialized,
      phone: toDigits(contact.number || (contact.id && contact.id.user)),
      name: contact.name || contact.pushname || contact.shortName,
      isMyContact: Boolean(contact.isMyContact),
      isBusiness: Boolean(contact.isBusiness),
      engine: this.name,
      raw: contact,
    };
  }

  _normalizeGroup(chat) {
    if (!chat) return null;
    const participants = (chat.participants || []).map((p) => ({
      id: p.id && p.id._serialized,
      isAdmin: Boolean(p.isAdmin),
      isSuperAdmin: Boolean(p.isSuperAdmin),
    }));
    return {
      id: chat.id && chat.id._serialized,
      name: chat.name,
      description: chat.description,
      owner: chat.owner && chat.owner._serialized,
      createdAt: toMillis(chat.createdAt),
      participants,
      engine: this.name,
      raw: chat,
    };
  }

  _media(buffer, mimetype, filename) {
    const { MessageMedia } = this._lib;
    return new MessageMedia(mimetype, buffer.toString('base64'), filename);
  }

  async _chat(chatId) {
    return this.raw.getChatById(toWwebJid(chatId));
  }

  // ------------------------------------------------------------------ messaging

  async sendText(chatId, text, options = {}) {
    if (typeof text !== 'string' || !text.length) {
      throw new WaConnectError('sendText needs a non-empty string', { code: codes.INVALID_ARGUMENT });
    }
    const sent = await this.raw.sendMessage(toWwebJid(chatId), text, {
      linkPreview: options.linkPreview,
      sendSeen: options.sendSeen,
    });
    return this._normalizeMessage(sent);
  }

  async sendImage(chatId, media, options = {}) {
    const { buffer, mimetype, filename } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(toWwebJid(chatId), this._media(buffer, mimetype, filename), {
      caption: options.caption,
    });
    return this._normalizeMessage(sent);
  }

  async sendVideo(chatId, media, options = {}) {
    const { buffer, mimetype, filename } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(toWwebJid(chatId), this._media(buffer, mimetype, filename), {
      caption: options.caption,
      sendVideoAsGif: Boolean(options.gifPlayback),
    });
    return this._normalizeMessage(sent);
  }

  async sendDocument(chatId, media, options = {}) {
    const { buffer, mimetype, filename } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(toWwebJid(chatId), this._media(buffer, mimetype, filename), {
      caption: options.caption,
      sendMediaAsDocument: true,
    });
    return this._normalizeMessage(sent);
  }

  async sendAudio(chatId, media, options = {}) {
    const { buffer, mimetype, filename } = await resolveMedia(media);
    const sent = await this.raw.sendMessage(toWwebJid(chatId), this._media(buffer, mimetype, filename), {
      sendAudioAsVoice: Boolean(options.voice),
    });
    return this._normalizeMessage(sent);
  }

  async sendLocation(chatId, { latitude, longitude, name, address } = {}) {
    const { Location } = this._lib;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new WaConnectError('sendLocation needs numeric latitude and longitude', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const sent = await this.raw.sendMessage(
      toWwebJid(chatId),
      new Location(latitude, longitude, { name, address }),
    );
    return this._normalizeMessage(sent);
  }

  async sendContact(chatId, contact) {
    const sent = await this.raw.sendMessage(toWwebJid(chatId), buildVcard(contact || {}));
    return this._normalizeMessage(sent);
  }

  async sendPoll(chatId, { name, options, allowMultipleAnswers = false } = {}) {
    const { Poll } = this._lib;
    if (!name || !Array.isArray(options) || options.length < 2) {
      throw new WaConnectError('sendPoll needs a name and at least two options', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const sent = await this.raw.sendMessage(
      toWwebJid(chatId),
      new Poll(name, options, { allowMultipleAnswers }),
    );
    return this._normalizeMessage(sent);
  }

  async sendReaction(chatId, messageId, emoji) {
    if (!messageId) {
      throw new WaConnectError('sendReaction needs the id of the message to react to', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const result = await this.raw.sendReaction(messageId, emoji || '');
    return { ok: Boolean(result), messageId, emoji: emoji || '' };
  }

  async deleteMessage(chatId, messageId, forEveryone = true) {
    const message = await this.raw.getMessageById(messageId);
    if (!message) {
      throw new WaConnectError(`Message not found: ${messageId}`, { code: codes.WA_ERROR });
    }
    await message.delete(forEveryone);
    return { ok: true, messageId };
  }

  async forwardMessage(chatId, messageId) {
    const message = await this.raw.getMessageById(messageId);
    if (!message) {
      throw new WaConnectError(`Message not found: ${messageId}`, { code: codes.WA_ERROR });
    }
    const forwarded = await message.forward(toWwebJid(chatId));
    return this._normalizeMessage(forwarded);
  }

  async downloadMedia(messageOrId) {
    const message =
      typeof messageOrId === 'string' ? await this.raw.getMessageById(messageOrId) : messageOrId;
    if (!message || typeof message.downloadMedia !== 'function') {
      throw new WaConnectError('downloadMedia needs a message id or a normalised message', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const media = await message.downloadMedia();
    if (!media) {
      throw new WaConnectError('That message has no downloadable media', { code: codes.MEDIA_ERROR });
    }
    return {
      buffer: Buffer.from(media.data, 'base64'),
      mimetype: media.mimetype,
      filename: media.filename,
    };
  }

  // --------------------------------------------------------------------- reading

  async getMe() {
    return this._me || this._normalizeMe(this.raw.info);
  }

  async getState() {
    return this.raw ? this.raw.getState() : null;
  }

  async getContacts() {
    const contacts = await this.raw.getContacts();
    return contacts.map((c) => this._normalizeContact(c));
  }

  async getChats() {
    const chats = await this.raw.getChats();
    return chats.map((c) => this._normalizeChat(c));
  }

  async getChat(chatId) {
    return this._normalizeChat(await this._chat(chatId));
  }

  async getMessages(chatId, limit = 20) {
    const chat = await this._chat(chatId);
    const messages = await chat.fetchMessages({ limit });
    return messages.map((m) => this._normalizeMessage(m));
  }

  async searchMessages(query, limit = 20) {
    const messages = await this.raw.searchMessages(query, { limit });
    return (messages || []).map((m) => this._normalizeMessage(m));
  }

  // ---------------------------------------------------------------------- groups

  async getGroups() {
    const chats = await this.raw.getChats();
    return chats.filter((c) => c.isGroup).map((c) => this._normalizeGroup(c));
  }

  async getGroupInfo(groupId) {
    return this._normalizeGroup(await this._chat(groupId));
  }

  async createGroup(name, participants) {
    if (!name || !Array.isArray(participants) || participants.length === 0) {
      throw new WaConnectError('createGroup needs a name and at least one participant', {
        code: codes.INVALID_ARGUMENT,
      });
    }
    const group = await this.raw.createGroup(name, participants.map((p) => toWwebJid(p)));
    return this._normalizeGroup(group);
  }

  async _participantsUpdate(groupId, participants, action) {
    const chat = await this._chat(groupId);
    const jids = participants.map((p) => toWwebJid(p));
    const method = {
      add: 'addParticipants',
      remove: 'removeParticipants',
      promote: 'promoteParticipants',
      demote: 'demoteParticipants',
    }[action];
    const result = await chat[method](jids);
    return {
      groupId: chat.id && chat.id._serialized,
      action,
      participants: jids,
      result,
    };
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
    const chat = await this._chat(groupId);
    await chat.setSubject(subject);
    return { ok: true, groupId, subject };
  }

  async setGroupDescription(groupId, description) {
    const chat = await this._chat(groupId);
    await chat.setDescription(description);
    return { ok: true, groupId, description };
  }

  async leaveGroup(groupId) {
    const chat = await this._chat(groupId);
    await chat.leave();
    return { ok: true, groupId };
  }

  async getGroupInviteCode(groupId) {
    const chat = await this._chat(groupId);
    return { groupId, code: await chat.getInviteCode() };
  }

  async revokeGroupInvite(groupId) {
    const chat = await this._chat(groupId);
    return { groupId, code: await chat.revokeInvite() };
  }

  // --------------------------------------------------------------------- account

  async isRegistered(number) {
    const jid = toWwebJid(number);
    const exists = await this.raw.isRegisteredUser(jid);
    return { exists: Boolean(exists), jid: exists ? jid : null };
  }

  async getProfilePicture(id) {
    try {
      return await this.raw.getProfilePicUrl(toWwebJid(id));
    } catch {
      return null;
    }
  }

  async setStatus(status) {
    await this.raw.setStatus(status);
    return { ok: true, status };
  }

  async setDisplayName(name) {
    await this.raw.setDisplayName(name);
    return { ok: true, name };
  }

  async requestPairingCode(phoneNumber) {
    const code = await this.raw.requestPairingCode(toDigits(phoneNumber));
    return { code, phone: toDigits(phoneNumber) };
  }

  // ------------------------------------------------------------------ chat state

  async markRead(chatId) {
    const chat = await this._chat(chatId);
    await chat.sendSeen();
    return { ok: true, chatId };
  }

  async sendTyping(chatId, state = 'composing') {
    const chat = await this._chat(chatId);
    if (state === 'paused') await chat.clearState();
    else if (state === 'recording') await chat.sendStateRecording();
    else await chat.sendStateTyping();
    return { ok: true, chatId, state };
  }

  async archiveChat(chatId, archive = true) {
    await this.raw.archiveChat(toWwebJid(chatId), archive);
    return { ok: true, chatId, archived: archive };
  }

  async pinChat(chatId, pin = true) {
    await this.raw.pinChat(toWwebJid(chatId), pin);
    return { ok: true, chatId, pinned: pin };
  }

  async muteChat(chatId, until = null) {
    await this.raw.muteChat(toWwebJid(chatId), until);
    return { ok: true, chatId, mutedUntil: until };
  }
}

module.exports = { WhatsAppWebAdapter };
