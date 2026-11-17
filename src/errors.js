'use strict';

/**
 * Stable error codes. Branch on `err.code`, never on the message text.
 */
const codes = Object.freeze({
  ENGINE_NOT_INSTALLED: 'ENGINE_NOT_INSTALLED',
  ENGINE_UNSUPPORTED: 'ENGINE_UNSUPPORTED',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  NOT_CONNECTED: 'NOT_CONNECTED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  SESSION_ERROR: 'SESSION_ERROR',
  MEDIA_ERROR: 'MEDIA_ERROR',
  SEND_FAILED: 'SEND_FAILED',
  TIMEOUT: 'TIMEOUT',
  WA_ERROR: 'WA_ERROR',
});

/**
 * Every error this package throws is a WaConnectError, so callers can do a
 * single `instanceof` check and still read the original failure from `cause`.
 */
class WaConnectError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, method?: string, engine?: string, cause?: unknown, details?: unknown}} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'WaConnectError';
    this.code = options.code || codes.WA_ERROR;
    this.method = options.method || undefined;
    this.engine = options.engine || undefined;
    if (options.details !== undefined) this.details = options.details;
    Error.captureStackTrace?.(this, WaConnectError);
  }

  /** Wrap any unknown failure from an engine into a WaConnectError. */
  static from(err, { method, engine, code } = {}) {
    if (err instanceof WaConnectError) {
      // Keep the original code and message, but fill in where it came from.
      if (!err.method && method) err.method = method;
      if (!err.engine && engine) err.engine = engine;
      return err;
    }
    const message = err && err.message ? err.message : String(err);
    const wrapped = new WaConnectError(message, {
      code: code || codes.WA_ERROR,
      method,
      engine,
      cause: err,
    });
    return wrapped;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      method: this.method,
      engine: this.engine,
    };
  }
}

/** Convenience: `throw new WaConnectError(...)` with a known code. */
function fail(code, message, extra = {}) {
  throw new WaConnectError(message, { code, ...extra });
}

module.exports = { WaConnectError, codes, fail };
