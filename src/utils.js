'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WaConnectError, codes } = require('./errors');

/** Keep digits only: "+91 98765-43210" -> "919876543210" */
function toDigits(input) {
  return String(input == null ? '' : input).replace(/\D/g, '');
}

/** A group id looks like 120363000000000000@g.us in both engines. */
function isGroupId(id) {
  return typeof id === 'string' && id.endsWith('@g.us');
}

/** Normalise any user-supplied target into a whatsapp-web.js chat id. */
function toWwebJid(input) {
  const value = String(input == null ? '' : input).trim();
  if (!value) {
    throw new WaConnectError('A chat id or phone number is required', { code: codes.INVALID_ARGUMENT });
  }
  if (value.includes('@')) {
    return value.replace(/@s\.whatsapp\.net$/, '@c.us').replace(/@c\.us$/, '@c.us');
  }
  const digits = toDigits(value);
  if (digits.length < 6) {
    throw new WaConnectError(`Not a usable phone number: "${value}"`, { code: codes.INVALID_ARGUMENT });
  }
  return `${digits}@c.us`;
}

/** Normalise any user-supplied target into a Baileys jid. */
function toBaileysJid(input) {
  const value = String(input == null ? '' : input).trim();
  if (!value) {
    throw new WaConnectError('A chat id or phone number is required', { code: codes.INVALID_ARGUMENT });
  }
  if (value.includes('@')) {
    return value.replace(/@c\.us$/, '@s.whatsapp.net');
  }
  const digits = toDigits(value);
  if (digits.length < 6) {
    throw new WaConnectError(`Not a usable phone number: "${value}"`, { code: codes.INVALID_ARGUMENT });
  }
  return `${digits}@s.whatsapp.net`;
}

/** Strip the server part: "919876543210@c.us" -> "919876543210" */
function bareId(id) {
  return String(id == null ? '' : id).split('@')[0];
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

function guessMime(filename) {
  return MIME_BY_EXT[path.extname(String(filename || '')).toLowerCase()] || 'application/octet-stream';
}

/**
 * Turn anything media-shaped into `{ buffer, mimetype, filename }`.
 * Accepts a Buffer, a local file path, an http(s) URL, or an object
 * `{ buffer | path | url | data(base64), mimetype, filename }`.
 *
 * @param {Buffer|Uint8Array|string|{buffer?: Buffer, path?: string, url?: string, data?: string, mimetype?: string, filename?: string}} input
 * @param {{filename?: string, mimetype?: string}} [defaults]
 */
async function resolveMedia(input, defaults = {}) {
  const asObject = input && typeof input === 'object' && !Buffer.isBuffer(input) && !(input instanceof Uint8Array);
  const mimetypeHint = (asObject && input.mimetype) || defaults.mimetype;
  const filenameHint = (asObject && input.filename) || defaults.filename;

  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const buffer = Buffer.from(input);
    const mimetype =
      mimetypeHint || (filenameHint ? guessMime(filenameHint) : 'application/octet-stream');
    return { buffer, mimetype, filename: filenameHint };
  }

  if (typeof input === 'string') {
    if (/^https?:\/\//i.test(input)) {
      const res = await fetch(input);
      if (!res.ok) {
        throw new WaConnectError(`Could not download media (${res.status} ${res.statusText})`, {
          code: codes.MEDIA_ERROR,
        });
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const filename = filenameHint || decodeURIComponent(new URL(input).pathname.split('/').pop() || 'file');
      return { buffer, mimetype: mimetypeHint || guessMime(filename), filename };
    }
    if (fs.existsSync(input)) {
      const buffer = await fs.promises.readFile(input);
      const filename = filenameHint || path.basename(input);
      return { buffer, mimetype: mimetypeHint || guessMime(filename), filename };
    }
    throw new WaConnectError(`Media path does not exist: ${input}`, { code: codes.MEDIA_ERROR });
  }

  if (asObject) {
    if (input.buffer) return resolveMedia(input.buffer, { mimetype: mimetypeHint, filename: filenameHint });
    if (input.path) return resolveMedia(input.path, { mimetype: mimetypeHint, filename: filenameHint });
    if (input.url) return resolveMedia(input.url, { mimetype: mimetypeHint, filename: filenameHint });
    if (input.data) {
      const buffer = Buffer.from(input.data, 'base64');
      return {
        buffer,
        mimetype: mimetypeHint || guessMime(filenameHint),
        filename: filenameHint,
      };
    }
  }

  throw new WaConnectError('Unsupported media input', { code: codes.MEDIA_ERROR });
}

/** Build a vCard string used to send a contact card. */
function buildVcard({ name, phone }) {
  const digits = toDigits(phone);
  if (!digits) {
    throw new WaConnectError('sendContact needs a phone number', { code: codes.INVALID_ARGUMENT });
  }
  const display = name || digits;
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${display}`,
    `N:${display};;;;`,
    `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
    'END:VCARD',
  ].join('\n');
}

/** WhatsApp timestamps are seconds; normalise to milliseconds. */
function toMillis(ts) {
  if (ts == null) return Date.now();
  const n = typeof ts === 'object' && typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts);
  if (!Number.isFinite(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

/**
 * `emit('error')` throws when nobody listens. Route those to `engine_error`
 * instead so a missing listener never crashes a user's process.
 */
function safeEmit(emitter, event, payload) {
  if (event === 'error' && emitter.listenerCount('error') === 0) {
    emitter.emit('engine_error', payload);
    return false;
  }
  emitter.emit(event, payload);
  return true;
}

/** Small promise helper used by `client.waitFor()`. */
function withTimeout(promise, ms, message) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new WaConnectError(message || `Timed out after ${ms}ms`, { code: codes.TIMEOUT }));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = {
  toDigits,
  isGroupId,
  toWwebJid,
  toBaileysJid,
  bareId,
  guessMime,
  resolveMedia,
  buildVcard,
  toMillis,
  safeEmit,
  withTimeout,
};
