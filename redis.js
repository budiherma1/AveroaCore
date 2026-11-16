import { isDevelopmentEnv } from './cors.js';

/**
 * Shared Redis connection for the built-in Redis features (session store,
 * rate-limit store).
 *
 * `redis` (node-redis), `connect-redis` and `rate-limit-redis` are OPTIONAL
 * peer dependencies: they are imported lazily, only when a feature that needs
 * them is turned on, and a missing package fails with a clear message that
 * says what to install.
 *
 * One client per REDIS_URL per process, reused by every feature and by every
 * app built with createApp(). closeRedis() closes it (start() calls it on
 * graceful shutdown).
 *
 * Startup is fail closed: when a feature needs Redis and it cannot be reached
 * within REDIS_CONNECT_TIMEOUT ms (default 5000), getRedisClient() rejects,
 * so the app refuses to start. Only NODE_ENV=development or test relaxes this:
 * a warning is logged and the client keeps reconnecting in the background
 * (requests that need Redis fail until it is up; there is no silent fallback
 * to memory, which would hide that state is not shared).
 *
 * After startup the client reconnects with a capped backoff. The offline queue
 * is disabled: while Redis is down, commands fail immediately (the request
 * gets a 500) instead of hanging.
 */

const clients = new Map(); // url -> Promise<RedisClient>

let moduleLoader = (name) => import(name);

/**
 * Replace the function used to import optional packages. Internal, for tests
 * (e.g. to simulate a package that is not installed). Returns the previous one.
 */
export function setModuleLoader(loader) {
  const previous = moduleLoader;
  moduleLoader = loader ?? ((name) => import(name));
  return previous;
}

const isMissingPackage = (err, name) => ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(err?.code)
  && String(err?.message).includes(`'${name}'`);

/**
 * Import an optional peer dependency.
 * @param {string} name     package name
 * @param {string} feature  what needs it, for the error message (e.g. "SESSION_STORE=redis")
 */
export async function loadOptional(name, feature) {
  try {
    return await moduleLoader(name);
  } catch (err) {
    if (isMissingPackage(err, name)) {
      throw new Error(
        `@averoa/core: ${feature} needs the optional package "${name}", which is not installed. `
        + `Install it in your application: npm install ${name}`,
        { cause: err },
      );
    }
    throw err;
  }
}

/** The URL without its password, for logs and error messages. */
const positiveInt = (value, fallback, name) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`@averoa/core: ${name} must be a positive integer (got "${value}")`);
  return n;
};

/** REDIS_COMMAND_TIMEOUT (ms, default 2000): longest wait for a Redis reply in the stores. */
export function redisCommandTimeout(env = process.env) {
  return positiveInt(env.REDIS_COMMAND_TIMEOUT, 2000, 'REDIS_COMMAND_TIMEOUT');
}

/** Error of a Redis command that got no reply within REDIS_COMMAND_TIMEOUT. */
export class RedisTimeoutError extends Error {
  constructor(ms) {
    super(`@averoa/core: Redis did not answer within ${ms}ms (REDIS_COMMAND_TIMEOUT)`);
    this.name = 'RedisTimeoutError';
  }
}

/** `promise`, rejected with RedisTimeoutError after `ms`. */
export function withTimeout(promise, ms = redisCommandTimeout()) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new RedisTimeoutError(ms)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The client, with every promise-returning method bounded by `ms`.
 * node-redis times out commands only while they wait to be written; once on
 * the socket, a stalled server (network partition, frozen process) would
 * leave every session and rate-limit lookup pending forever.
 */
export function timeoutClient(client, ms = redisCommandTimeout()) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return function bounded(...args) {
        const result = value.apply(target, args);
        return result && typeof result.then === 'function' ? withTimeout(result, ms) : result;
      };
    },
  });
}

export function redactRedisUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid REDIS_URL>';
  }
}

async function connect({ url, feature, log }) {
  const { createClient } = await loadOptional('redis', feature);
  const timeout = positiveInt(process.env.REDIS_CONNECT_TIMEOUT, 5000, 'REDIS_CONNECT_TIMEOUT');
  const development = isDevelopmentEnv();
  const safeUrl = redactRedisUrl(url);

  let stopped = false;
  let client;
  try {
    client = createClient({
      url,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: timeout,
        reconnectStrategy: (retries) => {
          if (stopped) return new Error('@averoa/core: Redis connection closed');
          return Math.min(100 * 2 ** Math.min(retries, 6), 5000);
        },
      },
    });
  } catch (err) {
    // no `cause`: URL errors carry the full URL, password included, in `input`
    // eslint-disable-next-line preserve-caught-error -- see above
    throw new Error(`@averoa/core: invalid REDIS_URL (${safeUrl}): ${err?.code || 'parse error'}`);
  }

  let lastError;
  let reported = false;
  client.on('error', (err) => {
    lastError = err;
    if (!reported) {
      reported = true;
      log.error?.(`@averoa/core: Redis error (${safeUrl}): ${err?.message || err}`);
    }
  });
  client.on('ready', () => {
    if (reported) log.info?.(`@averoa/core: Redis connection restored (${safeUrl})`);
    reported = false;
  });

  const connecting = client.connect().then(() => true, (err) => {
    lastError = err;
    return false;
  });
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeout);
    timer.unref?.();
  });
  const connected = await Promise.race([connecting, timedOut]);
  clearTimeout(timer);
  if (connected) return client;

  const reason = lastError?.message || 'timed out';
  if (!development) {
    stopped = true;
    try { client.destroy(); } catch { /* already closed */ }
    const env = process.env.NODE_ENV ? `NODE_ENV=${process.env.NODE_ENV}` : 'NODE_ENV is unset';
    throw new Error(
      `@averoa/core: ${feature} but Redis at ${safeUrl} is not reachable within ${timeout}ms (${reason}). `
      + `Refusing to start (${env}); start Redis, fix REDIS_URL or raise REDIS_CONNECT_TIMEOUT.`,
    );
  }
  log.warn?.(`@averoa/core: ${feature} but Redis at ${safeUrl} is not reachable yet (${reason}); `
    + 'NODE_ENV is development/test, so the app starts anyway and keeps reconnecting. '
    + 'Requests that need Redis fail until it is up.');
  return client;
}

/**
 * The shared, connected node-redis client for REDIS_URL (or `url`).
 *
 * @param {object} [options]
 * @param {string} [options.url]     defaults to REDIS_URL
 * @param {string} [options.feature] what needs Redis, used in error messages
 * @param {object} [options.log]     logger with error/warn/info (default console)
 */
export function getRedisClient({ url = process.env.REDIS_URL, feature = 'Redis', log = console } = {}) {
  if (!url || !String(url).trim()) {
    return Promise.reject(new Error(
      `@averoa/core: ${feature} needs REDIS_URL (e.g. redis://127.0.0.1:6379 or rediss://user:pass@host:6380).`,
    ));
  }
  const key = String(url).trim();
  let pending = clients.get(key);
  if (!pending) {
    pending = connect({ url: key, feature, log });
    clients.set(key, pending);
    // a failed connection is not cached: the next call tries again
    pending.catch(() => {
      if (clients.get(key) === pending) clients.delete(key);
    });
  }
  return pending;
}

/** Close every shared Redis client (waits for pending commands). */
export async function closeRedis() {
  const pending = [...clients.values()];
  clients.clear();
  await Promise.allSettled(pending.map(async (p) => {
    const client = await p;
    // close() waits for pending commands; a client that is still
    // (re)connecting has none and is destroyed instead
    if (client.isReady) await client.close();
    else if (client.isOpen) client.destroy();
  }));
}
