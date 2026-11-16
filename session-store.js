import { getRedisClient, loadOptional, timeoutClient } from './redis.js';

/**
 * Session store selection.
 *
 *   SESSION_STORE=memory   express-session's MemoryStore (default). Fine for
 *                          development/test; outside them core warns, because it
 *                          leaks memory and is not shared between processes.
 *   SESSION_STORE=redis    connect-redis on the shared node-redis client
 *                          (REDIS_URL). Needs the optional packages `redis` and
 *                          `connect-redis`.
 *
 *   SESSION_REDIS_PREFIX   key prefix (default "sess:")
 *   SESSION_TTL            seconds a session lives in Redis when the cookie has
 *                          no maxAge/expires (default 86400 = 1 day)
 *
 * A `store` returned by AppProvider.session() always wins: core then does not
 * create (or connect) a Redis store.
 */

export const SESSION_STORES = Object.freeze(['memory', 'redis']);

/** The configured session store kind; throws on an unknown value. */
export function sessionStoreKind(env = process.env) {
  const raw = String(env.SESSION_STORE ?? '').trim().toLowerCase();
  if (raw === '') return 'memory';
  if (!SESSION_STORES.includes(raw)) {
    throw new Error(`@averoa/core: SESSION_STORE must be one of ${SESSION_STORES.join(', ')} (got "${env.SESSION_STORE}")`);
  }
  return raw;
}

const ttlSeconds = (value) => {
  if (value === undefined || String(value).trim() === '') return 86400;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`@averoa/core: SESSION_TTL must be a positive integer of seconds (got "${value}")`);
  return n;
};

/**
 * Create the session store selected by SESSION_STORE.
 * Resolves to `undefined` for the memory store (express-session's default).
 *
 * @param {object} [options]
 * @param {object} [options.log]  logger (default console)
 * @returns {Promise<import('express-session').Store | undefined>}
 */
export async function createSessionStore({ log = console } = {}) {
  const kind = sessionStoreKind();
  if (kind === 'memory') return undefined;

  const feature = 'SESSION_STORE=redis';
  const ttl = ttlSeconds(process.env.SESSION_TTL);
  const { RedisStore } = await loadOptional('connect-redis', feature);
  const client = await getRedisClient({ feature, log });
  return new RedisStore({
    client: timeoutClient(client),
    prefix: process.env.SESSION_REDIS_PREFIX || 'sess:',
    ttl,
  });
}
