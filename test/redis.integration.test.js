// Integration tests against a real Redis. Skipped unless AVEROA_TEST_REDIS_URL
// is set, e.g.:
//   docker run -d --rm --name averoa-redis -p 127.0.0.1:6479:6379 redis:7.4-alpine
//   AVEROA_TEST_REDIS_URL=redis://127.0.0.1:6479 npm test
import {
  describe, test, before, after, afterEach,
} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import express from 'express';
import { FIXTURE_APP, listen, cookiesFrom } from './helpers.js';

const REDIS_URL = process.env.AVEROA_TEST_REDIS_URL;

process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
delete process.env.SESSION_SECRET;

const {
  createApp, rateLimit, getRedisClient, closeRedis,
} = await import('../index.js');

const run = `averoa-test:${crypto.randomBytes(6).toString('hex')}:`;
const SECRET = crypto.randomBytes(32).toString('hex');

/**
 * Two "instances" of the same app: separate express apps AND separate Redis
 * connections (the second URL selects the same database explicitly, so
 * getRedisClient() hands out a different client).
 */
async function twoInstances(env) {
  const instances = [];
  for (const url of [REDIS_URL, `${REDIS_URL.replace(/\/+$/, '')}/0`]) {
    Object.assign(process.env, env, { REDIS_URL: url });
    const { app } = await createApp();
    instances.push(await listen(app));
  }
  return instances;
}

describe('Redis session and rate-limit stores', { skip: REDIS_URL ? false : 'AVEROA_TEST_REDIS_URL is not set' }, () => {
  let admin;

  before(async () => {
    admin = await getRedisClient({ url: REDIS_URL });
  });

  afterEach(() => {
    for (const name of ['SESSION_STORE', 'SESSION_REDIS_PREFIX', 'SESSION_TTL', 'RATE_LIMIT_STORE', 'RATE_LIMIT_MAX',
      'RATE_LIMIT_REDIS_PREFIX', 'REDIS_URL', 'SESSION_SECRET']) delete process.env[name];
    process.env.NODE_ENV = 'test';
  });

  test('getRedisClient() reuses one client per URL; closeRedis() closes it and the next call reconnects', async () => {
    const first = await getRedisClient({ url: REDIS_URL });
    assert.equal(first, admin, 'same client for the same URL');
    assert.equal(await first.ping(), 'PONG');
    await closeRedis();
    assert.equal(first.isOpen, false, 'closed');
    admin = await getRedisClient({ url: REDIS_URL });
    assert.notEqual(admin, first);
    assert.equal(await admin.ping(), 'PONG');
  });

  after(async () => {
    if (admin?.isReady) {
      const keys = await admin.keys(`${run}*`);
      if (keys.length) await admin.del(keys);
    }
    await closeRedis();
    const { DB } = await import('@averoa/utilities');
    await DB?.destroy?.();
  });

  test('a session created on one instance is used by another instance sharing Redis', async () => {
    const [a, b] = await twoInstances({
      SESSION_STORE: 'redis',
      SESSION_SECRET: SECRET,
      SESSION_REDIS_PREFIX: `${run}sess:`,
      SESSION_TTL: '120',
      RATE_LIMIT_STORE: 'memory',
    });
    try {
      // instance A creates the session (CSRF token) and logs a user in
      const tokenRes = await fetch(`${a.url}/csrf`);
      const cookie = cookiesFrom(tokenRes);
      const { token } = await tokenRes.json();
      assert.ok(cookie && token);

      const keys = await admin.keys(`${run}sess:*`);
      assert.equal(keys.length, 1, 'the session is stored in Redis under SESSION_REDIS_PREFIX');
      const ttl = await admin.ttl(keys[0]);
      assert.ok(ttl > 0 && ttl <= 120, `SESSION_TTL applies (ttl=${ttl})`);

      // instance B accepts the token only if it loads A's session from Redis
      const submit = await fetch(`${b.url}/submit`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': token },
        body: '{"x":1}',
      });
      assert.equal(submit.status, 200, await submit.text());

      // passport user written by B is visible to A
      const login = await fetch(`${b.url}/login-test`, { headers: { cookie } });
      assert.equal(login.status, 200);
      const loginCookie = cookiesFrom(login) || cookie;
      const csrf = await fetch(`${a.url}/api/csrf-token`, { headers: { cookie: loginCookie } });
      const apiToken = (await csrf.json()).token;
      // session-authenticated /api POST on A needs the CSRF token: proves A sees B's login
      const noToken = await fetch(`${a.url}/api/echo`, {
        method: 'POST', headers: { cookie: loginCookie, 'content-type': 'application/json' }, body: '{}',
      });
      assert.equal(noToken.status, 403, 'A treats the request as session-authenticated');
      const withToken = await fetch(`${a.url}/api/echo`, {
        method: 'POST', headers: { cookie: loginCookie, 'content-type': 'application/json', 'x-csrf-token': apiToken }, body: '{}',
      });
      assert.equal(withToken.status, 200);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('the global limiter counts requests across instances (RATE_LIMIT_STORE follows SESSION_STORE=redis)', async () => {
    const [a, b] = await twoInstances({
      SESSION_STORE: 'redis',
      SESSION_SECRET: SECRET,
      SESSION_REDIS_PREFIX: `${run}sess:`,
      RATE_LIMIT_MAX: '4',
      RATE_LIMIT_REDIS_PREFIX: `${run}rl:`,
    });
    try {
      const statuses = [];
      for (const srv of [a, b, a, b, a, b]) {
        const res = await fetch(`${srv.url}/api/ping`);
        statuses.push(res.status);
        if (res.status === 429) assert.equal((await res.json()).code, 'ERATELIMIT');
      }
      assert.deepEqual(statuses, [200, 200, 200, 200, 429, 429]);
      const keys = await admin.keys(`${run}rl:global:*`);
      assert.equal(keys.length, 1, 'one shared counter under RATE_LIMIT_REDIS_PREFIX + name');
      assert.equal(await admin.get(keys[0]), '6');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('per-route rateLimit({ name }) limiters share counters across instances', async () => {
    process.env.RATE_LIMIT_STORE = 'redis';
    process.env.RATE_LIMIT_REDIS_PREFIX = `${run}rl:`;
    const servers = [];
    for (const url of [REDIS_URL, `${REDIS_URL.replace(/\/+$/, '')}/0`]) {
      process.env.REDIS_URL = url;
      const app = express();
      app.post('/login', rateLimit({ name: 'login', windowMs: 60000, limit: 2 }), (req, res) => res.json({ ok: true }));
      app.post('/other', rateLimit({ name: 'other', windowMs: 60000, limit: 2 }), (req, res) => res.json({ ok: true }));
      app.use((err, req, res, next) => res.status(err.status ?? 500)
        .json({ code: err.code, message: err.message }));
      servers.push(await listen(app));
    }
    const [a, b] = servers;
    try {
      const post = (srv, path) => fetch(`${srv.url}${path}`, { method: 'POST' }).then((r) => r.status);
      assert.equal(await post(a, '/login'), 200);
      assert.equal(await post(b, '/login'), 200);
      assert.equal(await post(a, '/login'), 429);
      assert.equal(await post(b, '/other'), 200, 'limiters with different names have separate counters');
    } finally {
      await a.close();
      await b.close();
    }
  });
});
