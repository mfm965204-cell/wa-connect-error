'use strict';

const { EventEmitter } = require('node:events');
const { WaConnectError, codes } = require('./errors');
const { createAdapter, resolveEngineName } = require('./engines');
const { safeEmit, withTimeout } = require('./utils');

const DEFAULTS = {
  engine: 'whatsapp-web',
  sessionPath: './.wa-session',
  printQR: true,
  autoReconnect: true,
  maxReconnectAttempts: 5,
  syncFullHistory: false,
};

const FORWARDED_EVENTS = [
  'qr',
  'loading',
  'authenticated',
  'state',
  'message',
  'message_create',
  'message_update',
  'message_ack',
  'history',
  'call',
  'disconnected',
  'auth_failure',
  'session_saved',
];

/**
 * The public client. One object, one API, whichever engine sits underneath.
 *
 * @fires WaClient#qr
 * @fires WaClient#ready
 * @fires WaClient#message
 * @fires WaClient#disconnected
 * @fires WaClient#error
 */
class WaClient extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {'whatsapp-web'|'baileys'} [options.engine='whatsapp-web']
   * @param {string} [options.sessionPath='./.wa-session'] where the login is stored
   * @param {boolean} [options.printQR=true] render the QR in the terminal
   * @param {boolean} [options.autoReconnect=true] Baileys: reconnect when the socket drops
   * @param {object} [options.puppeteer] whatsapp-web: Puppeteer launch options
   * @param {object} [options.clientOptions] whatsapp-web: extra whatsapp-web.js Client options
   * @param {object} [options.socketOptions] Baileys: extra makeWASocket options
   * @param {object} [options.store] Baileys: an in-memory store, enables history reads
   * @param {object} [options.adapter] a custom adapter instance (advanced)
   */
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
    if (this.options.adapter) {
      this.options.engine = this.options.adapter.name || 'custom';
    } else {
      this.options.engine = resolveEngineName(this.options.engine);
    }
    this.engine = this.options.engine;
    this._adapter = null;
    this._state = 'idle';
    this._me = null;
    this._lastQR = null;
    this._readyWaiters = [];
  }

  // ------------------------------------------------------------------ accessors

  /** @returns {'idle'|'connecting'|'open'|'closed'} */
  get state() {
    return this._state;
  }

  get isReady() {
    return this._state === 'open';
  }

  /** The logged-in account, once known. */
  get me() {
    return this._me;
  }

  /** The active engine adapter (has the same methods plus engine-specific extras). */
  get adapter() {
    return this._adapter;
  }

  /** Escape hatch: the underlying whatsapp-web.js Client or Baileys socket. */
  get raw() {
    return this._adapter ? this._adapter.raw : null;
  }

  /** The most recent QR string, if you want to render it yourself. */
  get qr() {
    return this._lastQR;
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Start the engine. Resolves once the client is running: for a fresh number
   * that means a `qr` event is on its way. Use `waitForReady()` to wait for login.
   */
  async connect() {
    if (this._state === 'open') return this;
    if (this._adapter) return this;
    this._state = 'connecting';
    this._adapter = createAdapter(this.options);
    this._wire(this._adapter);
    try {
      await this._adapter.connect();
    } catch (err) {
      this._state = 'closed';
      this._adapter = null;
      throw WaConnectError.from(err, { method: 'connect', engine: this.engine });
    }
    return this;
  }

  /**
   * Stop the engine.
   * @param {{logout?: boolean}} [options] `logout: true` also unlinks the device
   *   from the phone and clears the stored session.
   */
  async disconnect({ logout = false } = {}) {
    const adapter = this._adapter;
    if (!adapter) {
      this._state = 'closed';
      return this;
    }
    this._adapter = null;
    this._state = 'closed';
    this._me = null;
    this._lastQR = null;
    try {
      await adapter.destroy({ logout });
    } finally {
      adapter.removeAllListeners();
      this.emit('closed', { logout });
    }
    return this;
  }

  /** Alias for `disconnect({ logout: true })`. */
  logout() {
    return this.disconnect({ logout: true });
  }

  /** Resolve when the given event fires. */
  waitFor(event, { timeoutMs = 0 } = {}) {
    const promise = new Promise((resolve) => this.once(event, resolve));
    return withTimeout(promise, timeoutMs, `Timed out waiting for the "${event}" event`);
  }

  /** Resolve when the account is logged in and ready. */
  waitForReady({ timeoutMs = 0 } = {}) {
    if (this._state === 'open') return Promise.resolve(this._me);
    const promise = new Promise((resolve) => {
      this._readyWaiters.push(resolve);
    });
    return withTimeout(promise, timeoutMs, 'Timed out waiting for WhatsApp to become ready');
  }

  /** Ask for an 8-character pairing code instead of scanning a QR. */
  requestPairingCode(phoneNumber) {
    return this._call('requestPairingCode', phoneNumber);
  }

  // ------------------------------------------------------------------ messaging

  /** Send a plain text message. */
  sendText(chatId, text, options) {
    return this._call('sendText', chatId, text, options);
  }

  /** Send an image from a Buffer, a file path, a URL or `{ buffer, mimetype, filename }`. */
  sendImage(chatId, media, options) {
    return this._call('sendImage', chatId, media, options);
  }

  sendVideo(chatId, media, options) {
    return this._call('sendVideo', chatId, media, options);
  }

  sendDocument(chatId, media, options) {
    return this._call('sendDocument', chatId, media, options);
  }

  sendAudio(chatId, media, options) {
    return this._call('sendAudio', chatId, media, options);
  }

  sendLocation(chatId, location) {
    return this._call('sendLocation', chatId, location);
  }

  sendContact(chatId, contact) {
    return this._call('sendContact', chatId, contact);
  }

  sendPoll(chatId, poll) {
    return this._call('sendPoll', chatId, poll);
  }

  sendReaction(chatId, messageId, emoji) {
    return this._call('sendReaction', chatId, messageId, emoji);
  }

  deleteMessage(chatId, messageId, forEveryone = true) {
    return this._call('deleteMessage', chatId, messageId, forEveryone);
  }

  forwardMessage(chatId, messageId) {
    return this._call('forwardMessage', chatId, messageId);
  }

  downloadMedia(messageOrId) {
    return this._call('downloadMedia', messageOrId);
  }

  // -------------------------------------------------------------------- reading

  getMe() {
    return this._call('getMe');
  }

  getState() {
    return this._call('getState');
  }

  getContacts() {
    return this._call('getContacts');
  }

  getChats() {
    return this._call('getChats');
  }

  getChat(chatId) {
    return this._call('getChat', chatId);
  }

  getMessages(chatId, limit = 20) {
    return this._call('getMessages', chatId, limit);
  }

  searchMessages(query, limit = 20) {
    return this._call('searchMessages', query, limit);
  }

  // --------------------------------------------------------------------- groups

  getGroups() {
    return this._call('getGroups');
  }

  getGroupInfo(groupId) {
    return this._call('getGroupInfo', groupId);
  }

  createGroup(name, participants) {
    return this._call('createGroup', name, participants);
  }

  addParticipants(groupId, participants) {
    return this._call('addParticipants', groupId, participants);
  }

  removeParticipants(groupId, participants) {
    return this._call('removeParticipants', groupId, participants);
  }

  promoteParticipants(groupId, participants) {
    return this._call('promoteParticipants', groupId, participants);
  }

  demoteParticipants(groupId, participants) {
    return this._call('demoteParticipants', groupId, participants);
  }

  setGroupSubject(groupId, subject) {
    return this._call('setGroupSubject', groupId, subject);
  }

  setGroupDescription(groupId, description) {
    return this._call('setGroupDescription', groupId, description);
  }

  leaveGroup(groupId) {
    return this._call('leaveGroup', groupId);
  }

  getGroupInviteCode(groupId) {
    return this._call('getGroupInviteCode', groupId);
  }

  revokeGroupInvite(groupId) {
    return this._call('revokeGroupInvite', groupId);
  }

  // -------------------------------------------------------------------- account

  isRegistered(number) {
    return this._call('isRegistered', number);
  }

  getProfilePicture(id) {
    return this._call('getProfilePicture', id);
  }

  setStatus(status) {
    return this._call('setStatus', status);
  }

  setDisplayName(name) {
    return this._call('setDisplayName', name);
  }

  // ----------------------------------------------------------------- chat state

  markRead(chatId, messageIds) {
    return this._call('markRead', chatId, messageIds);
  }

  sendTyping(chatId, state = 'composing') {
    return this._call('sendTyping', chatId, state);
  }

  archiveChat(chatId, archive = true) {
    return this._call('archiveChat', chatId, archive);
  }

  pinChat(chatId, pin = true) {
    return this._call('pinChat', chatId, pin);
  }

  muteChat(chatId, until = null) {
    return this._call('muteChat', chatId, until);
  }

  // -------------------------------------------------------------------- plumbing

  /** Run an adapter method, normalising every failure into a WaConnectError. */
  async _call(method, ...args) {
    const adapter = this._adapter;
    if (!adapter) {
      throw new WaConnectError('Client is not connected. Call connect() first.', {
        code: codes.NOT_CONNECTED,
        method,
        engine: this.engine,
      });
    }
    const fn = adapter[method];
    if (typeof fn !== 'function') {
      throw new WaConnectError(`"${method}" is not supported by the ${this.engine} engine`, {
        code: codes.ENGINE_UNSUPPORTED,
        method,
        engine: this.engine,
      });
    }
    try {
      return await fn.apply(adapter, args);
    } catch (err) {
      throw WaConnectError.from(err, { method, engine: this.engine });
    }
  }

  _wire(adapter) {
    for (const event of FORWARDED_EVENTS) {
      adapter.on(event, (payload) => {
        if (event === 'qr') {
          this._lastQR = payload;
          if (this.options.printQR) this._printQR(payload);
        }
        if (event === 'state') this._onEngineState(payload);
        safeEmit(this, event, payload);
      });
    }

    adapter.on('ready', (me) => {
      this._state = 'open';
      this._me = me;
      this._lastQR = null;
      safeEmit(this, 'ready', me);
      const waiters = this._readyWaiters.splice(0, this._readyWaiters.length);
      for (const resolve of waiters) resolve(me);
    });

    adapter.on('error', (err) => {
      safeEmit(this, 'error', WaConnectError.from(err, { engine: this.engine }));
    });
    adapter.on('engine_error', (err) => {
      safeEmit(this, 'engine_error', WaConnectError.from(err, { engine: this.engine }));
    });
  }

  _onEngineState(state) {
    const value = String(state || '').toLowerCase();
    if (value === 'connecting' || value === 'open' || value === 'close') {
      if (value === 'close') this._state = this._state === 'idle' ? 'idle' : 'closed';
      else this._state = value === 'open' ? 'open' : 'connecting';
    }
  }

  _printQR(qr) {
    try {
      // eslint-disable-next-line global-require
      const qrcode = require('qrcode-terminal');
      process.stderr.write('\nScan this QR with WhatsApp > Linked devices > Link a device\n\n');
      qrcode.generate(qr, { small: true }, (output) => process.stderr.write(`${output}\n`));
    } catch {
      // Rendering is a convenience; the 'qr' event always carries the string.
    }
  }
}

module.exports = { WaClient, DEFAULTS };
