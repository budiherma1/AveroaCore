import { rateLimit as expressRateLimit, ipKeyGenerator } from 'express-rate-limit';
import { getRedisClient, loadOptional, withTimeout } from './redis.js';
import { sessionStoreKind } from './session-store.js';

/**
 * Rate limiting (express-rate-limit).
 *
 * `rateLimit(options)` creates a limiter middleware with AveroaJS defaults:
 *
 *   - standard `RateLimit` / `RateLimit-Policy` headers (IETF draft 8), no
 *     legacy `X-RateLimit-*` headers, `Retry-After` on 429;
 *   - a 429 error passed to the app's error handler: JSON
 *     `{ status: false, message, code: 'ERATELIMIT' }` for /api, XHR and JSON
 *     clients, a small HTML page otherwise;
 *   - keyed by client IP (`req.ip`, IPv6 grouped by /56). `req.ip` honours
 *     TRUST_PROXY: behind a proxy set it, or every client shares the proxy's IP;
 *     never set it when there is no proxy, or clients can spoof X-Forwarded-For;
 *   - the store selected by RATE_LIMIT_STORE.
 *
 * Every express-rate-limit option can be passed (windowMs, limit,
 * keyGenerator, skip, skipSuccessfulRequests, ...). Extra options:
 *
 *   name     identifies the limiter in a shared store (Redis key prefix). Give
 *            every limiter a unique name; unnamed limiters with the same window
 *            and limit share their counters.
 *   message  the 429 message (default "Too many requests, please try again later.")
 *
 * Stores:
 *
 *   RATE_LIMIT_STORE=memory   in-process counters (default unless
 *                             SESSION_STORE=redis). Not shared between
 *                             processes / instances.
 *   RATE_LIMIT_STORE=redis    rate-limit-redis on the shared node-redis client
 *                             (REDIS_URL); counters are shared by every
 *                             instance. Needs the optional packages `redis` and
 *                             `rate-limit-redis`. Defaults to redis when
 *                             SESSION_STORE=redis.
 *   RATE_LIMIT_REDIS_PREFIX   key prefix (default "rl:"), followed by the name
 *
 * When the store fails (e.g. Redis is down) the request fails with a 500
 * (fail closed). Pass `passOnStoreError: true` to let requests through instead.
 */

export { ipKeyGenerator };

export const RATE_LIMIT_STORES = Object.freeze(['memory', 'redis']);

export const RATE_LIMIT_MESSAGE = 'Too many requests, please try again later.';

const positiveInt = (env, name, fallback) => {
  const value = env[name];
  if (value === undefined || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`@averoa/core: ${name} must be a positive integer (got "${value}")`);
  return n;
};

/** RATE_LIMIT_STORE, defaulting to redis when SESSION_STORE=redis. Throws on an unknown value. */
export function rateLimitStoreKind(env = process.env) {
  const raw = String(env.RATE_LIMIT_STORE ?? '').trim().toLowerCase();
  if (raw === '') return sessionStoreKind(env) === 'redis' ? 'redis' : 'memory';
  if (!RATE_LIMIT_STORES.includes(raw)) {
    throw new Error(`@averoa/core: RATE_LIMIT_STORE must be one of ${RATE_LIMIT_STORES.join(', ')} (got "${env.RATE_LIMIT_STORE}")`);
  }
  return raw;
}

/**
 * Settings of the global limiter core mounts (before body parsing and
 * sessions). Throws on invalid values so typos don't silently change limits.
 *
 *   RATE_LIMIT_ENABLED    default true; false/0/no/off turns it off
 *   RATE_LIMIT_WINDOW_MS  window in ms (default 60000)
 *   RATE_LIMIT_MAX        requests per client and window (default 100)
 *
 * `path` is where it is mounted: '/api' by default ('/' covers every route,
 * static files included).
 */
export function globalRateLimitOptions(env = process.env) {
  const enabledRaw = env.RATE_LIMIT_ENABLED;
  const enabled = enabledRaw === undefined || String(enabledRaw).trim() === ''
    || !['false', '0', 'no', 'off'].includes(String(enabledRaw).trim().toLowerCase());
  return {
    enabled,
    path: '/api',
    name: 'global',
    windowMs: positiveInt(env, 'RATE_LIMIT_WINDOW_MS', 60000),
    limit: positiveInt(env, 'RATE_LIMIT_MAX', 100),
  };
}

let defaultLog = console;

/** Logger used by limiters created without a `logger` (core sets the app's Log). */
export function setRateLimitLogger(log) {
  defaultLog = log ?? console;
}

const toLogger = (log) => ({
  warn: (err, message) => log.warn?.(`@averoa/core rate limit: ${message ? `${message} ` : ''}${err?.message ?? err}`),
  error: (err, message) => log.error?.(`@averoa/core rate limit: ${message ? `${message} ` : ''}${err?.message ?? err}`),
});

export function rateLimitError(message = RATE_LIMIT_MESSAGE) {
  const err = new Error(message);
  err.status = 429;
  err.expose = true;
  err.code = 'ERATELIMIT';
  return err;
}

/**
 * express-rate-limit store backed by rate-limit-redis on the shared client.
 * rate-limit-redis and the client are loaded on first use, so a limiter can be
 * created synchronously anywhere (route files, middleware modules) before the
 * connection exists.
 */
export class RedisRateLimitStore {
  localKeys = false;

  constructor({ prefix, url = process.env.REDIS_URL }) {
    this.prefix = prefix;
    this.url = url;
  }

  init(options) {
    const feature = 'RATE_LIMIT_STORE=redis';
    this.ready = loadOptional('rate-limit-redis', feature).then(({ RedisStore }) => {
      const inner = new RedisStore({
        prefix: this.prefix,
        sendCommand: async (...args) => {
          const client = await getRedisClient({ url: this.url, feature, log: defaultLog });
          return withTimeout(client.sendCommand(args));
        },
      });
      // loading the scripts can fail while Redis is down; rate-limit-redis
      // reloads them on the next command
      return Promise.resolve(inner.init(options)).then(() => inner, () => inner);
    });
    this.ready.catch(() => {}); // surfaced by every increment()
  }

  async get(key) {
    return (await this.ready).get(key);
  }

  async increment(key) {
    return (await this.ready).increment(key);
  }

  async decrement(key) {
    return (await this.ready).decrement(key);
  }

  async resetKey(key) {
    return (await this.ready).resetKey(key);
  }
}

/**
 * Create a rate-limit middleware (see the top of this file).
 * @param {object} [options] express-rate-limit options plus `name` and `message`
 */
export function rateLimit(options = {}) {
  const {
    name, message, store, logger, max, ...rest
  } = options;
  const windowMs = rest.windowMs ?? 60000;
  const limit = rest.limit ?? max ?? 5;

  let finalStore = store;
  if (!finalStore && rateLimitStoreKind() === 'redis') {
    const base = process.env.RATE_LIMIT_REDIS_PREFIX || 'rl:';
    const id = name ? String(name) : `w${windowMs}-l${typeof limit === 'number' ? limit : 'fn'}`;
    finalStore = new RedisRateLimitStore({ prefix: `${base}${id}:` });
  }

  const text = message ?? RATE_LIMIT_MESSAGE;
  return expressRateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: async (req, res, next) => {
      const msg = typeof text === 'function' ? await text(req, res) : text;
      next(rateLimitError(typeof msg === 'string' ? msg : RATE_LIMIT_MESSAGE));
    },
    logger: logger ?? toLogger(defaultLog),
    ...rest,
    windowMs,
    limit,
    ...(finalStore ? { store: finalStore } : {}),
  });
}

/**
 * Before the app serves requests: when RATE_LIMIT_STORE=redis, check that
 * rate-limit-redis is installed and Redis is reachable (fail closed).
 */
export async function prepareRateLimitStore({ log = console } = {}) {
  if (rateLimitStoreKind() !== 'redis') return;
  const feature = 'RATE_LIMIT_STORE=redis';
  await loadOptional('rate-limit-redis', feature);
  await getRedisClient({ feature, log });
}

export default rateLimit;
