'use strict';

const { WaConnectError, codes } = require('../errors');
const { WhatsAppWebAdapter } = require('./whatsapp-web');
const { BaileysAdapter } = require('./baileys');

const ALIASES = {
  'whatsapp-web': 'whatsapp-web',
  whatsappweb: 'whatsapp-web',
  wweb: 'whatsapp-web',
  web: 'whatsapp-web',
  puppeteer: 'whatsapp-web',
  baileys: 'baileys',
  ws: 'baileys',
  socket: 'baileys',
};

const ENGINES = {
  'whatsapp-web': WhatsAppWebAdapter,
  baileys: BaileysAdapter,
};

function resolveEngineName(name) {
  const key = String(name || '').toLowerCase().trim();
  const resolved = ALIASES[key];
  if (!resolved) {
    throw new WaConnectError(
      `Unknown engine "${name}". Use "whatsapp-web" or "baileys".`,
      { code: codes.INVALID_ARGUMENT },
    );
  }
  return resolved;
}

/**
 * Create the adapter for an engine name. Libraries are required lazily so that
 * installing the package never forces you to install both engines.
 */
function createAdapter(options = {}) {
  if (options.adapter) return options.adapter;
  const name = resolveEngineName(options.engine);
  const Adapter = ENGINES[name];
  return new Adapter({ ...options, engine: name });
}

module.exports = {
  createAdapter,
  resolveEngineName,
  ENGINES,
  WhatsAppWebAdapter,
  BaileysAdapter,
};
