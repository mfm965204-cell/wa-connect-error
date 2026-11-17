'use strict';

const pkg = require('../package.json');
const { WaClient, DEFAULTS } = require('./client');
const { WaConnectError, codes } = require('./errors');
const { createAdapter, resolveEngineName, ENGINES, WhatsAppWebAdapter, BaileysAdapter } = require('./engines');
const utils = require('./utils');

/**
 * Create a WhatsApp client.
 *
 * @example
 * const { createClient } = require('wa-connect-error');
 * const client = createClient({ engine: 'whatsapp-web' });
 * client.on('qr', (qr) => console.log(qr));
 * client.on('ready', async () => {
 *   await client.sendText('919876543210', 'Hello from my own number');
 * });
 * client.connect();
 *
 * @param {object} [options] see {@link WaClient}
 * @returns {WaClient}
 */
function createClient(options) {
  return new WaClient(options);
}

/** Which engines are actually installed in this project right now. */
function availableEngines() {
  return Object.entries(ENGINES)
    .filter(([, Adapter]) => Adapter.available())
    .map(([name]) => name);
}

module.exports = {
  createClient,
  WaClient,
  WaConnectError,
  codes,
  DEFAULTS,
  availableEngines,
  createAdapter,
  resolveEngineName,
  engines: ENGINES,
  adapters: { WhatsAppWebAdapter, BaileysAdapter },
  utils,
  VERSION: pkg.version,
};
