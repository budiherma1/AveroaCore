import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import session from 'express-session';
import { FIXTURE_APP, listen } from './helpers.js';

process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
delete process.env.SESSION_SECRET;

const {
  createApp, createSessionStore, sessionStoreKind, closeRedis,
} = await import('../index.js');
const { setModuleLoader, redactRedisUrl } = await import('../redis.js');
const providers = await import(`${FIXTURE_APP}/app/Providers/index.js`);
const originalSession = providers.AppProvider.session;

const ENV = [
  'SESSION_STORE', 'SESSION_TTL', 'SESSION_REDIS_PREFIX', 'RATE_LIMIT_STORE', 'REDIS_URL', 'REDIS_CONNECT_TIMEOUT',
];

afterEach(async () => {
  for (const name of ENV) delete process.env[name];
  process.env.NODE_ENV = 'test';
  delete process.env.SESSION_SECRET;
  providers.AppProvider.session = originalSession;
  setModuleLoader(null);
  await closeRedis();
});

after(async () => {
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

const missing = (...names) => async (name) => {
  if (names.includes(name)) {
    const err = new Error(`Cannot find package '${name}' imported from /app/node_modules/@averoa/core/redis.js`);
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return import(name);
};

test('sessionStoreKind: memory by default, redis, unknown values throw', () => {
  assert.equal(sessionStoreKind({}), 'memory');
  assert.equal(sessionStoreKind({ SESSION_STORE: '' }), 'memory');
  assert.equal(sessionStoreKind({ SESSION_STORE: 'memory' }), 'memory');
  assert.equal(sessionStoreKind({ SESSION_STORE: 'REDIS' }), 'redis');
  assert.throws(() => sessionStoreKind({ SESSION_STORE: 'mongo' }), /SESSION_STORE must be one of memory, redis \(got "mongo"\)/);
});

test('createSessionStore: memory → undefined (express-session MemoryStore)', async () => {
  assert.equal(await createSessionStore(), undefined);
  process.env.SESSION_STORE = 'memory';
  assert.equal(await createSessionStore(), undefined);
});

test('createApp rejects an unknown SESSION_STORE', async () => {
  process.env.SESSION_STORE = 'cookie';
  await assert.rejects(() => createApp(), /SESSION_STORE must be one of memory, redis/);
});

test('SESSION_STORE=redis: invalid SESSION_TTL and missing REDIS_URL are startup errors', async () => {
  process.env.SESSION_STORE = 'redis';
  process.env.SESSION_TTL = '1d';
  await assert.rejects(() => createSessionStore(), /SESSION_TTL must be a positive integer of seconds/);
  delete process.env.SESSION_TTL;
  process.env.RATE_LIMIT_STORE = 'memory';
  await assert.rejects(() => createApp(), /SESSION_STORE=redis needs REDIS_URL/);
});

test('SESSION_STORE=redis without connect-redis / redis installed: clear error naming the package', async () => {
  process.env.SESSION_STORE = 'redis';
  process.env.RATE_LIMIT_STORE = 'memory';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';

  setModuleLoader(missing('connect-redis'));
  await assert.rejects(
    () => createApp(),
    /SESSION_STORE=redis needs the optional package "connect-redis", which is not installed\. Install it in your application: npm install connect-redis/,
  );

  setModuleLoader(missing('redis'));
  await assert.rejects(() => createSessionStore(), /SESSION_STORE=redis needs the optional package "redis".*npm install redis/);

  // other import failures are not disguised as "not installed"
  setModuleLoader(async (name) => {
    if (name === 'connect-redis') throw new SyntaxError('Unexpected token in connect-redis');
    return import(name);
  });
  await assert.rejects(() => createSessionStore(), /^SyntaxError: Unexpected token in connect-redis$/);
});

test('SESSION_STORE=redis with Redis unreachable: refuses to start outside development/test', async () => {
  process.env.SESSION_SECRET = 's'.repeat(64);
  process.env.SESSION_STORE = 'redis';
  process.env.RATE_LIMIT_STORE = 'memory';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.REDIS_CONNECT_TIMEOUT = '300';
  for (const env of ['production', 'staging', undefined]) {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    const started = Date.now();
    await assert.rejects(
      () => createApp(),
      /SESSION_STORE=redis but Redis at redis:\/\/127\.0\.0\.1:1 is not reachable within 300ms .*Refusing to start/,
      `NODE_ENV=${env}`,
    );
    assert.ok(Date.now() - started < 3000, 'fails fast');
  }
});

test('SESSION_STORE=redis with Redis unreachable in development/test: starts with a warning', async () => {
  process.env.SESSION_STORE = 'redis';
  process.env.RATE_LIMIT_STORE = 'memory';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.REDIS_CONNECT_TIMEOUT = '200';
  const warnings = [];
  const log = { warn: (m) => warnings.push(m), error() {}, info() {} };
  const store = await createSessionStore({ log });
  assert.equal(store.constructor.name, 'RedisStore');
  assert.ok(warnings.some((w) => /not reachable yet .*starts anyway/.test(w)), warnings.join('\n'));
});

test('AppProvider.session() returning a store wins over SESSION_STORE (no Redis needed)', async () => {
  const custom = new session.MemoryStore();
  let calls = 0;
  const original = custom.get.bind(custom);
  custom.get = (...args) => {
    calls += 1;
    return original(...args);
  };
  providers.AppProvider.session = () => ({ store: custom });
  process.env.SESSION_STORE = 'redis';
  process.env.RATE_LIMIT_STORE = 'memory';
  // no REDIS_URL: building would fail if core tried to create a Redis store

  const { app } = await createApp();
  const srv = await listen(app);
  try {
    const first = await fetch(`${srv.url}/csrf`);
    const cookie = first.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    assert.ok(cookie);
    await fetch(`${srv.url}/csrf`, { headers: { cookie } });
    assert.ok(calls > 0, 'the provider store is used');
  } finally {
    await srv.close();
  }
});

test('redactRedisUrl hides the password', () => {
  assert.equal(redactRedisUrl('redis://user:secret@redis.internal:6380/2'), 'redis://user:***@redis.internal:6380/2');
  assert.equal(redactRedisUrl('redis://127.0.0.1:6379'), 'redis://127.0.0.1:6379');
  assert.equal(redactRedisUrl('not a url'), '<invalid REDIS_URL>');
});

test('timeoutClient bounds every Redis reply (a stalled server fails, never hangs)', async () => {
  const { timeoutClient, RedisTimeoutError, redisCommandTimeout } = await import('../redis.js');
  const stalled = {
    get: () => new Promise(() => {}), // never answers
    set: async () => 'OK',
    isOpen: true,
  };
  const client = timeoutClient(stalled, 30);
  assert.equal(await client.set('k', 'v'), 'OK');
  assert.equal(client.isOpen, true, 'non-function properties pass through');
  await assert.rejects(client.get('k'), RedisTimeoutError);
  assert.equal(redisCommandTimeout({}), 2000);
  assert.equal(redisCommandTimeout({ REDIS_COMMAND_TIMEOUT: '500' }), 500);
  assert.throws(() => redisCommandTimeout({ REDIS_COMMAND_TIMEOUT: 'abc' }), /REDIS_COMMAND_TIMEOUT/);
});

test('an invalid REDIS_URL error does not carry the URL (password) in its cause', async () => {
  const { getRedisClient } = await import('../redis.js');
  const util = await import('node:util');
  const err = await getRedisClient({ url: 'redis://user:pa ss word@exa mple:6379', feature: 'test', log: { warn() {}, error() {} } })
    .then(() => null, (e) => e);
  await closeRedis();
  assert.ok(err, 'an invalid URL is a startup error');
  assert.doesNotMatch(util.inspect(err, { depth: 5 }), /pa ss word/);
});
