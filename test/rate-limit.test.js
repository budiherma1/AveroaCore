import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { FIXTURE_APP, listen } from './helpers.js';

process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
delete process.env.SESSION_SECRET;
delete process.env.TRUST_PROXY;

const {
  createApp, rateLimit, ipKeyGenerator, rateLimitStoreKind, globalRateLimitOptions, closeRedis,
} = await import('../index.js');
const { setModuleLoader } = await import('../redis.js');
const providers = await import(`${FIXTURE_APP}/app/Providers/index.js`);

const RATE_ENV = [
  'RATE_LIMIT_ENABLED', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX', 'RATE_LIMIT_STORE', 'RATE_LIMIT_REDIS_PREFIX',
  'SESSION_STORE', 'REDIS_URL', 'REDIS_CONNECT_TIMEOUT', 'TRUST_PROXY',
];

afterEach(async () => {
  for (const name of RATE_ENV) delete process.env[name];
  process.env.NODE_ENV = 'test';
  delete process.env.SESSION_SECRET;
  delete providers.AppProvider.rateLimit;
  setModuleLoader(null);
  await closeRedis();
});

after(async () => {
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

/** Build the fixture app with `env`, listen, run `fn(url)`, close. */
async function withApp(env, fn) {
  Object.assign(process.env, env);
  const { app } = await createApp();
  const srv = await listen(app);
  try {
    await fn(srv.url);
  } finally {
    await srv.close();
  }
}

test('rateLimitStoreKind: memory by default, follows SESSION_STORE=redis, rejects unknown values', () => {
  assert.equal(rateLimitStoreKind({}), 'memory');
  assert.equal(rateLimitStoreKind({ SESSION_STORE: 'memory' }), 'memory');
  assert.equal(rateLimitStoreKind({ SESSION_STORE: 'redis' }), 'redis');
  assert.equal(rateLimitStoreKind({ SESSION_STORE: 'redis', RATE_LIMIT_STORE: 'memory' }), 'memory');
  assert.equal(rateLimitStoreKind({ RATE_LIMIT_STORE: ' Redis ' }), 'redis');
  assert.throws(() => rateLimitStoreKind({ RATE_LIMIT_STORE: 'memcached' }), /RATE_LIMIT_STORE must be one of memory, redis/);
});

test('globalRateLimitOptions: defaults, env overrides, invalid values throw', () => {
  assert.deepEqual(globalRateLimitOptions({}), {
    enabled: true, path: '/api', name: 'global', windowMs: 60000, limit: 100,
  });
  const custom = globalRateLimitOptions({ RATE_LIMIT_WINDOW_MS: '1000', RATE_LIMIT_MAX: '7', RATE_LIMIT_ENABLED: 'true' });
  assert.equal(custom.windowMs, 1000);
  assert.equal(custom.limit, 7);
  assert.equal(custom.enabled, true);
  for (const off of ['false', '0', 'no', 'OFF']) assert.equal(globalRateLimitOptions({ RATE_LIMIT_ENABLED: off }).enabled, false);
  assert.throws(() => globalRateLimitOptions({ RATE_LIMIT_MAX: 'lots' }), /RATE_LIMIT_MAX must be a positive integer/);
  assert.throws(() => globalRateLimitOptions({ RATE_LIMIT_MAX: '0' }), /RATE_LIMIT_MAX must be a positive integer/);
  assert.throws(() => globalRateLimitOptions({ RATE_LIMIT_WINDOW_MS: '-5' }), /RATE_LIMIT_WINDOW_MS must be a positive integer/);
});

test('global limiter: standard RateLimit headers, then 429 JSON with Retry-After on /api', async () => {
  await withApp({ RATE_LIMIT_MAX: '3' }, async (url) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${url}/api/ping`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('ratelimit'), /r=\d+/, 'draft-8 RateLimit header');
      assert.match(res.headers.get('ratelimit-policy'), /q=3; w=60/);
      assert.equal(res.headers.get('x-ratelimit-limit'), null, 'no legacy headers');
    }
    const limited = await fetch(`${url}/api/ping`);
    assert.equal(limited.status, 429);
    assert.match(limited.headers.get('content-type'), /application\/json/);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    const body = await limited.json();
    assert.equal(body.status, false);
    assert.equal(body.message, 'Too many requests, please try again later.');
    assert.equal(body.code, 'ERATELIMIT');

    // the global limiter is mounted on /api only
    const web = await fetch(`${url}/csrf`);
    assert.equal(web.status, 200);
    assert.equal(web.headers.get('ratelimit'), null);
  });
});

test('global limiter runs before body parsing and CSRF: limited POSTs never reach the handler', async () => {
  await withApp({ RATE_LIMIT_MAX: '1' }, async (url) => {
    const post = (body) => fetch(`${url}/api/echo`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal((await post('{"a":1}')).status, 200);
    const res = await post('{not json');
    assert.equal(res.status, 429, 'rejected before the JSON parser sees the invalid body');
  });
});

test('RATE_LIMIT_ENABLED=false turns the global limiter off', async () => {
  await withApp({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_MAX: '1' }, async (url) => {
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${url}/api/ping`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('ratelimit'), null);
    }
  });
});

test('invalid rate-limit settings make createApp fail (fail closed)', async () => {
  process.env.RATE_LIMIT_MAX = 'unlimited';
  await assert.rejects(() => createApp(), /RATE_LIMIT_MAX must be a positive integer/);
  delete process.env.RATE_LIMIT_MAX;
  process.env.RATE_LIMIT_STORE = 'file';
  await assert.rejects(() => createApp(), /RATE_LIMIT_STORE must be one of/);
});

test('AppProvider.rateLimit() receives the defaults and can change them', async () => {
  let received;
  providers.AppProvider.rateLimit = (defaults) => {
    received = defaults;
    return { ...defaults, path: '/', limit: 2 };
  };
  await withApp({ RATE_LIMIT_MAX: '50' }, async (url) => {
    assert.deepEqual(received, {
      path: '/api', name: 'global', windowMs: 60000, limit: 50,
    });
    assert.equal((await fetch(`${url}/csrf`)).status, 200);
    assert.equal((await fetch(`${url}/api/ping`)).status, 200);

    // HTML clients get the error page, JSON clients JSON
    const html = await fetch(`${url}/csrf`, { headers: { accept: 'text/html' } });
    assert.equal(html.status, 429);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.match(await html.text(), /<h1>429<\/h1><p>Too many requests, please try again later.<\/p>/);

    const json = await fetch(`${url}/csrf`, { headers: { accept: 'application/json' } });
    assert.equal(json.status, 429);
    assert.equal((await json.json()).code, 'ERATELIMIT');
  });
});

test('AppProvider.rateLimit() returning false disables the global limiter', async () => {
  providers.AppProvider.rateLimit = () => false;
  await withApp({ RATE_LIMIT_MAX: '1' }, async (url) => {
    assert.equal((await fetch(`${url}/api/ping`)).status, 200);
    assert.equal((await fetch(`${url}/api/ping`)).status, 200);
  });
});

test('TRUST_PROXY unset: a spoofed X-Forwarded-For does not get a fresh counter', async () => {
  await withApp({ RATE_LIMIT_MAX: '2' }, async (url) => {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${url}/api/ping`, { headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [200, 200, 429]);
  });
});

test('TRUST_PROXY=1: clients are told apart by X-Forwarded-For', async () => {
  await withApp({ RATE_LIMIT_MAX: '2', TRUST_PROXY: '1' }, async (url) => {
    const get = (ip) => fetch(`${url}/api/ping`, { headers: { 'x-forwarded-for': ip } }).then((r) => r.status);
    assert.equal(await get('203.0.113.1'), 200);
    assert.equal(await get('203.0.113.1'), 200);
    assert.equal(await get('203.0.113.1'), 429);
    assert.equal(await get('203.0.113.2'), 200, 'another client behind the proxy has its own counter');
    // IPv6 clients are grouped by /56
    assert.equal(await get('2001:db8:0:1::1'), 200);
    assert.equal(await get('2001:db8:0:1::2'), 200);
    assert.equal(await get('2001:db8:0:1::3'), 429);
  });
});

test('rateLimit() factory: per-route limiter with custom key, message and skipSuccessfulRequests', async () => {
  const app = express();
  app.use(express.json());
  const errors = [];
  const login = rateLimit({
    name: 'login-test',
    windowMs: 60000,
    limit: 2,
    skipSuccessfulRequests: true,
    message: 'Too many login attempts',
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
  });
  app.post('/login', login, (req, res) => res.status(req.body.password === 'ok' ? 200 : 401).json({}));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    errors.push(err);
    res.status(err.status).json({ status: false, message: err.message, code: err.code });
  });
  const srv = await listen(app);
  try {
    const attempt = (email, password) => fetch(`${srv.url}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    assert.equal((await attempt('a@x.test', 'ok')).status, 200);
    assert.equal((await attempt('a@x.test', 'ok')).status, 200);
    assert.equal((await attempt('a@x.test', 'ok')).status, 200, 'successful requests are not counted');
    assert.equal((await attempt('a@x.test', 'bad')).status, 401);
    assert.equal((await attempt('A@x.test', 'bad')).status, 401);
    const limited = await attempt('a@x.test', 'ok');
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { status: false, message: 'Too many login attempts', code: 'ERATELIMIT' });
    assert.equal(errors[0].expose, true);
    assert.equal((await attempt('b@x.test', 'bad')).status, 401, 'another account has its own counter');
  } finally {
    await srv.close();
  }
});

test('RATE_LIMIT_STORE=redis without rate-limit-redis installed: clear startup error', async () => {
  setModuleLoader(async (name) => {
    if (name === 'rate-limit-redis') {
      const err = new Error(`Cannot find package '${name}' imported from /app/node_modules/@averoa/core/redis.js`);
      err.code = 'ERR_MODULE_NOT_FOUND';
      throw err;
    }
    return import(name);
  });
  process.env.RATE_LIMIT_STORE = 'redis';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  await assert.rejects(
    () => createApp(),
    /RATE_LIMIT_STORE=redis needs the optional package "rate-limit-redis", which is not installed\. Install it in your application: npm install rate-limit-redis/,
  );
});

test('RATE_LIMIT_STORE=redis without REDIS_URL: clear startup error', async () => {
  process.env.RATE_LIMIT_STORE = 'redis';
  await assert.rejects(() => createApp(), /RATE_LIMIT_STORE=redis needs REDIS_URL/);
});

test('RATE_LIMIT_STORE=redis with Redis unreachable: production refuses to start', async () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'z'.repeat(64);
  process.env.RATE_LIMIT_STORE = 'redis';
  process.env.REDIS_URL = 'redis://:hunter2@127.0.0.1:1';
  process.env.REDIS_CONNECT_TIMEOUT = '300';
  const err = await createApp().then(() => null, (e) => e);
  assert.ok(err, 'createApp must reject');
  assert.match(err.message, /RATE_LIMIT_STORE=redis but Redis at redis:\/\/:\*\*\*@127\.0\.0\.1:1 is not reachable within 300ms/);
  assert.match(err.message, /Refusing to start \(NODE_ENV=production\)/);
  assert.doesNotMatch(err.message, /hunter2/, 'the password is never printed');
});
