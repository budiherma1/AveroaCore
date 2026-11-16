import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import express from 'express';
import knex from 'knex';
import { FIXTURE_APP, listen } from './helpers.js';

process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
for (const name of [
  'SESSION_SECRET', 'CORS_WHITELIST', 'CSRF_ENABLED', 'TRUST_PROXY', 'TRUST_REQUEST_ID', 'REQUEST_ID_HEADER',
  'LOG_CHANNEL', 'LOG_FORMAT', 'ACCESS_LOG_FORMAT', 'HEALTH_PATH', 'READY_PATH', 'READY_TIMEOUT', 'READY_CHECKS',
  'SHUTDOWN_DELAY', 'SHUTDOWN_TIMEOUT',
]) delete process.env[name];

const core = await import('../index.js');
const {
  createApp, start, requestId, restoreRequestContext, requestContext, currentRequestId,
  isValidRequestId, trustIncomingRequestId, closeLogStreams,
} = core;
const { default: setMorgan, getLogStreams, accessLogSettings } = await import('../morgan.js');
const { healthSettings, probePath } = await import('../health.js');
const utilities = await import('@averoa/utilities');
const providers = await import(`${FIXTURE_APP}/app/Providers/index.js`);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

after(async () => {
  await closeLogStreams();
  await utilities.DB?.destroy?.();
});

/** Run `fn(url)` against a listening app, then close it. */
async function withServer(app, fn) {
  const srv = await listen(app);
  try {
    return await fn(srv.url);
  } finally {
    await srv.close();
  }
}

/** Set env vars for the duration of `fn`. */
async function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** A winston logger that writes JSON lines to memory. */
function memoryLog() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(c.toString()));
  const Log = utilities.createLogger({
    channel: 'stdout', format: 'json', level: 'debug', stream,
  });
  const lines = async () => {
    await new Promise((resolve) => { setTimeout(resolve, 10); });
    return chunks.join('').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  return { Log, lines };
}

/* request ids ---------------------------------------------------------------- */

test('request id: validation limits', () => {
  assert.ok(isValidRequestId('abc-123'));
  assert.ok(isValidRequestId('9f86d081-884c-4d63-a1f3-1b3c5d2e8f00'));
  assert.ok(isValidRequestId('Root=1-67891233-abcdef012345678912345678;'.replace(';', '')));
  assert.ok(isValidRequestId('a'.repeat(128)));
  assert.equal(isValidRequestId('a'.repeat(129)), false);
  assert.equal(isValidRequestId(''), false);
  assert.equal(isValidRequestId(undefined), false);
  assert.equal(isValidRequestId('has space'), false);
  assert.equal(isValidRequestId('line\nbreak'), false);
  assert.equal(isValidRequestId('<script>'), false);
  assert.equal(isValidRequestId('quote"'), false);
});

test('request id: trusted only with TRUST_REQUEST_ID=true (TRUST_PROXY alone is not enough)', () => {
  assert.equal(trustIncomingRequestId({}), false);
  assert.equal(trustIncomingRequestId({ TRUST_PROXY: 'false' }), false);
  assert.equal(trustIncomingRequestId({ TRUST_PROXY: '1' }), false);
  assert.equal(trustIncomingRequestId({ TRUST_PROXY: 'loopback' }), false);
  assert.equal(trustIncomingRequestId({ TRUST_PROXY: '1', TRUST_REQUEST_ID: 'true' }), true);
  assert.equal(trustIncomingRequestId({ TRUST_PROXY: 'true', TRUST_REQUEST_ID: 'false' }), false);
  assert.equal(trustIncomingRequestId({ TRUST_REQUEST_ID: 'true' }), true);
});

test('request id: generated when absent, echoed, available as req.id and in the context', async () => {
  await withEnv({ TRUST_REQUEST_ID: 'true' }, async () => {
    const { app } = await createApp();
    await withServer(app, async (url) => {
      const res = await fetch(`${url}/api/context`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ big: 'x'.repeat(200000) }),
      });
      const id = res.headers.get('x-request-id');
      assert.match(id, UUID);
      const body = await res.json();
      assert.equal(body.id, id);
      assert.deepEqual(body.seen, {
        start: id, timer: id, immediate: id, promise: id,
      }, 'context survives body parsing, timers, setImmediate and promises');

      // two requests get different ids
      const other = await fetch(`${url}/api/ping`);
      assert.match(other.headers.get('x-request-id'), UUID);
      assert.notEqual(other.headers.get('x-request-id'), id);
    });
  });
});

test('request id: a valid incoming id is accepted when trusted; invalid ones are replaced', async () => {
  await withEnv({ TRUST_REQUEST_ID: 'true' }, async () => {
    const { app } = await createApp();
    await withServer(app, async (url) => {
      let res = await fetch(`${url}/api/context`, {
        method: 'POST',
        headers: { 'x-request-id': 'edge-req-42', 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.headers.get('x-request-id'), 'edge-req-42');
      const body = await res.json();
      assert.equal(body.id, 'edge-req-42');
      assert.equal(body.seen.timer, 'edge-req-42');

      for (const bad of ['a'.repeat(129), 'bad id', '<x>', 'a,b']) {
        res = await fetch(`${url}/api/ping`, { headers: { 'x-request-id': bad } });
        assert.match(res.headers.get('x-request-id'), UUID, `rejected: ${bad.slice(0, 20)}`);
      }
    });
  });
});

test('request id: an incoming id is ignored unless TRUST_REQUEST_ID=true (TRUST_PROXY alone is not enough)', async () => {
  for (const vars of [{}, { TRUST_PROXY: '1', TRUST_REQUEST_ID: 'false' }, { TRUST_PROXY: 'loopback' }]) {
    await withEnv(vars, async () => {
      const { app } = await createApp();
      await withServer(app, async (url) => {
        const res = await fetch(`${url}/api/ping`, { headers: { 'x-request-id': 'spoofed-id' } });
        assert.match(res.headers.get('x-request-id'), UUID, JSON.stringify(vars));
      });
    });
  }
  await withEnv({ TRUST_PROXY: 'loopback', TRUST_REQUEST_ID: 'true' }, async () => {
    const { app } = await createApp();
    await withServer(app, async (url) => {
      const res = await fetch(`${url}/api/ping`, { headers: { 'x-request-id': 'from-proxy' } });
      assert.equal(res.headers.get('x-request-id'), 'from-proxy', 'TRUST_REQUEST_ID=true → trusted');
    });
  });
});

test('request id: REQUEST_ID_HEADER renames the header', async () => {
  const app = express();
  app.use(requestId({ header: 'X-Correlation-Id', trust: true }));
  app.get('/', (req, res) => res.json({ id: req.id }));
  await withServer(app, async (url) => {
    const res = await fetch(url, { headers: { 'x-correlation-id': 'corr-1' } });
    assert.equal(res.headers.get('x-correlation-id'), 'corr-1');
    assert.deepEqual(await res.json(), { id: 'corr-1' });
  });
});

test('request id: restoreRequestContext() re-enters the context after middleware that lost it', async () => {
  const app = express();
  app.use(requestId());
  // simulates a callback-based middleware resuming outside the request context
  app.use((req, res, next) => requestContext.exit(next));
  app.use((req, res, next) => { req.lost = currentRequestId(); next(); });
  app.use(restoreRequestContext());
  app.get('/', (req, res) => res.json({ id: req.id, lost: req.lost ?? null, restored: currentRequestId() }));
  await withServer(app, async (url) => {
    const body = await (await fetch(url)).json();
    assert.equal(body.lost, null);
    assert.equal(body.restored, body.id);
  });
});

test('error JSON carries the request id, and Log lines written during the request include it', async () => {
  const { Log, lines } = memoryLog();
  const { app } = await createApp({ utilities: { ...utilities, Log } });
  await withServer(app, async (url) => {
    const res = await fetch(`${url}/api/boom`);
    assert.equal(res.status, 500);
    const id = res.headers.get('x-request-id');
    const body = await res.json();
    assert.equal(body.requestId, id);

    const notFound = await fetch(`${url}/api/missing`);
    assert.equal((await notFound.json()).requestId, notFound.headers.get('x-request-id'));

    const entry = (await lines()).find((l) => l.level === 'error');
    assert.equal(entry.requestId, id);
    assert.match(entry.message, /GET \/api\/boom → 500/);
    assert.ok(entry.timestamp);
  });
});

/* access log ----------------------------------------------------------------- */

function captureStdout() {
  const lines = [];
  return { lines, write: (line) => lines.push(line) };
}

test('access log: combined and dev lines leave out query strings (tokens in email links)', async () => {
  await closeLogStreams();
  for (const consoleFormat of ['combined', 'dev']) {
    const out = captureStdout();
    const app = express();
    setMorgan(app, { channel: 'stdout', consoleFormat, stdout: out });
    app.get('/verify', (req, res) => res.json({ ok: true }));
    await withServer(app, async (url) => {
      await (await fetch(`${url}/verify?token=s3cr3t-token`, { headers: { referer: 'https://app.test/reset?token=other-secret' } })).text();
    });
    const line = out.lines.join('\n');
    assert.match(line, /GET \/verify/, consoleFormat);
    assert.doesNotMatch(line, /s3cr3t-token|other-secret/, consoleFormat);
  }
});

test('access log: LOG_CHANNEL=stdout writes JSON lines to stdout and opens no files', async () => {
  await closeLogStreams();
  const out = captureStdout();
  const app = express();
  app.set('trust proxy', true);
  app.use(requestId());
  setMorgan(app, { channel: 'stdout', consoleFormat: 'json', stdout: out });
  app.get('/items/:id', (req, res) => res.status(201).json({ ok: true }));
  app.get('/fail', (req, res) => res.status(503).end());

  await withServer(app, async (url) => {
    const res = await fetch(`${url}/items/7?token=secret`, {
      headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'probe/1.0' },
    });
    await res.text();
    await (await fetch(`${url}/fail`)).text();
  });

  assert.equal(getLogStreams().size, 0, 'no access.log / error.log');
  const [line, failed] = out.lines.map((l) => JSON.parse(l));
  assert.equal(line.type, 'access');
  assert.equal(line.level, 'info');
  assert.equal(line.method, 'GET');
  assert.equal(line.path, '/items/7', 'no query string');
  assert.equal(line.status, 201);
  assert.equal(typeof line.durationMs, 'number');
  assert.equal(line.ip, '203.0.113.9', 'req.ip, following trust proxy');
  assert.equal(line.userAgent, 'probe/1.0');
  assert.match(line.requestId, UUID);
  assert.equal(line.contentLength, 11);
  assert.match(line.timestamp, /Z$/);
  assert.equal(line.message, 'GET /items/7 201');
  assert.equal(failed.level, 'error');
  assert.equal(failed.status, 503);
});

test('access log: without trust proxy the forwarded IP is ignored', async () => {
  const out = captureStdout();
  const app = express();
  app.use(requestId());
  setMorgan(app, { channel: 'stdout', consoleFormat: 'json', stdout: out });
  app.get('/', (req, res) => res.end('ok'));
  await withServer(app, async (url) => {
    await (await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.9' } })).text();
  });
  assert.match(JSON.parse(out.lines[0]).ip, /127\.0\.0\.1/);
});

test('access log: files keep the combined format by default; ACCESS_LOG_FORMAT=json; LOG_CHANNEL=both', async () => {
  const dir = path.join(FIXTURE_APP, 'storages', 'logs');
  await closeLogStreams();
  fs.rmSync(dir, { recursive: true, force: true });

  const app = express();
  app.use(requestId());
  setMorgan(app, { channel: null, env: 'test' });
  app.get('/', (req, res) => res.end('ok'));
  await withServer(app, async (url) => { await (await fetch(url)).text(); });
  await closeLogStreams();
  assert.match(fs.readFileSync(path.join(dir, 'access.log'), 'utf8'), /"GET \/ HTTP\/1\.1" 200 /);

  const out = captureStdout();
  const json = express();
  json.use(requestId());
  setMorgan(json, {
    channel: 'both', fileFormat: 'json', consoleFormat: 'json', stdout: out,
  });
  json.get('/json', (req, res) => res.status(404).end());
  await withServer(json, async (url) => { await (await fetch(`${url}/json`)).text(); });
  await closeLogStreams();
  const lastAccess = JSON.parse(fs.readFileSync(path.join(dir, 'access.log'), 'utf8').trim().split('\n').pop());
  const lastError = JSON.parse(fs.readFileSync(path.join(dir, 'error.log'), 'utf8').trim().split('\n').pop());
  assert.equal(lastAccess.path, '/json');
  assert.equal(lastAccess.status, 404);
  assert.equal(lastError.requestId, lastAccess.requestId);
  assert.equal(JSON.parse(out.lines[0]).requestId, lastAccess.requestId, 'stdout too');
});

test('accessLogSettings(): channel, file and console formats from the environment', () => {
  assert.deepEqual(accessLogSettings({}), { channel: null, fileFormat: 'combined', consoleFormat: 'json' });
  assert.deepEqual(accessLogSettings({ NODE_ENV: 'development' }), { channel: null, fileFormat: 'combined', consoleFormat: 'dev' });
  assert.deepEqual(accessLogSettings({ NODE_ENV: 'development', LOG_FORMAT: 'json', LOG_CHANNEL: 'stdout' }), { channel: 'stdout', fileFormat: 'combined', consoleFormat: 'json' });
  assert.deepEqual(accessLogSettings({ NODE_ENV: 'production', LOG_FORMAT: 'pretty' }).consoleFormat, 'dev');
  assert.deepEqual(accessLogSettings({ ACCESS_LOG_FORMAT: 'json', LOG_CHANNEL: 'both' }), { channel: 'both', fileFormat: 'json', consoleFormat: 'json' });
  assert.deepEqual(accessLogSettings({ ACCESS_LOG_FORMAT: 'dev', LOG_CHANNEL: 'nope' }), { channel: null, fileFormat: 'combined', consoleFormat: 'dev' });
});

/* health --------------------------------------------------------------------- */

test('health settings: paths, disabling, timeout, built-in checks', () => {
  assert.deepEqual(healthSettings({}), {
    livenessPath: '/health', readinessPath: '/ready', timeout: 2000, builtIn: ['database'],
  });
  const s = healthSettings({
    HEALTH_PATH: 'livez', READY_PATH: 'off', READY_TIMEOUT: '500', READY_CHECKS: 'database, queue',
  });
  assert.equal(s.livenessPath, '/livez');
  assert.equal(s.readinessPath, null);
  assert.equal(s.timeout, 500);
  assert.deepEqual(s.builtIn, ['database', 'queue']);
  assert.deepEqual(healthSettings({ READY_CHECKS: 'none' }).builtIn, []);
  assert.equal(probePath('false', '/x'), null);
  assert.equal(probePath('', '/x'), '/x');
});

test('GET /health and /ready: 200 with the database up, no session cookie, no CSRF, request id set', async () => {
  const { app } = await createApp();
  await withServer(app, async (url) => {
    let res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('x-request-id'), UUID);
    assert.deepEqual(res.headers.getSetCookie(), []);

    res = await fetch(`${url}/ready`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.checks.database.status, 'up');
    assert.equal(typeof body.checks.database.durationMs, 'number');
    assert.deepEqual(res.headers.getSetCookie(), []);

    res = await fetch(`${url}/ready`, { method: 'HEAD' });
    assert.equal(res.status, 200);

    // other methods fall through to the app (here: CSRF on a web path → 403)
    res = await fetch(`${url}/health`, { method: 'POST', headers: { accept: 'application/json' } });
    assert.equal(res.status, 403);
  });
});

test('GET /ready: 503 with per-check status when the database connection is broken', async () => {
  const broken = knex({
    client: 'better-sqlite3',
    connection: { filename: path.join(FIXTURE_APP, 'does-not-exist', 'nested', 'db.sqlite') },
    useNullAsDefault: true,
  });
  const brokenUtilities = { ...utilities, getDB: async () => broken, DB: broken };
  try {
    const { app } = await createApp({ utilities: brokenUtilities });
    await withServer(app, async (url) => {
      let res = await fetch(`${url}/ready`);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.status, 'error');
      assert.equal(body.checks.database.status, 'down');
      assert.match(body.checks.database.error, /directory does not exist|unable to open|SQLITE_CANTOPEN/i);

      res = await fetch(`${url}/health`);
      assert.equal(res.status, 200, 'liveness does not depend on the database');

      // outside development/test only the kind of failure is shown
      await withEnv({ NODE_ENV: 'production', SESSION_SECRET: 'z'.repeat(64) }, async () => {
        res = await fetch(`${url}/ready`);
        assert.equal(res.status, 503);
        assert.equal((await res.json()).checks.database.error, 'failed');
      });
    });
  } finally {
    await broken.destroy();
  }
});

test('AppProvider.health(): custom checks, timeouts, non-critical checks, removal and disabling', async () => {
  const original = providers.AppProvider.health;
  try {
    let received;
    providers.AppProvider.health = (checks) => {
      received = Object.keys(checks);
      return {
        ...checks,
        cache: { check: async () => false, critical: false },
        redis: async ({ signal }) => new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      };
    };
    await withEnv({ READY_TIMEOUT: '50' }, async () => {
      const { app } = await createApp();
      await withServer(app, async (url) => {
        const res = await fetch(`${url}/ready`);
        assert.equal(res.status, 503);
        const body = await res.json();
        assert.deepEqual(received, ['database']);
        assert.equal(body.checks.database.status, 'up');
        assert.equal(body.checks.redis.status, 'down');
        assert.equal(body.checks.redis.error, 'timed out after 50ms');
        assert.deepEqual({ ...body.checks.cache, durationMs: 0 }, {
          status: 'down', critical: false, durationMs: 0, error: 'check returned false',
        });
      });
    });

    // a failing non-critical check alone keeps readiness at 200
    providers.AppProvider.health = () => ({ cache: { check: () => { throw new Error('x'); }, critical: false } });
    let built = await createApp();
    await withServer(built.app, async (url) => {
      const res = await fetch(`${url}/ready`);
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys((await res.json()).checks), ['cache']);
    });

    providers.AppProvider.health = () => false;
    built = await createApp();
    await withServer(built.app, async (url) => {
      assert.equal((await fetch(`${url}/health`, { headers: { accept: 'application/json' } })).status, 404);
      assert.equal((await fetch(`${url}/ready`, { headers: { accept: 'application/json' } })).status, 404);
    });
  } finally {
    if (original) providers.AppProvider.health = original;
    else delete providers.AppProvider.health;
  }
});

test('HEALTH_PATH / READY_PATH move or disable the probes', async () => {
  await withEnv({ HEALTH_PATH: '/livez', READY_PATH: 'off' }, async () => {
    const { app } = await createApp();
    await withServer(app, async (url) => {
      assert.equal((await fetch(`${url}/livez`)).status, 200);
      assert.equal((await fetch(`${url}/health`, { headers: { accept: 'application/json' } })).status, 404);
      assert.equal((await fetch(`${url}/ready`, { headers: { accept: 'application/json' } })).status, 404);
    });
  });
});

test('graceful shutdown: readiness flips to 503 before the server closes', async () => {
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const own = { ...utilities, getDB: async () => db, DB: db };
  let shutdownCalled = false;
  const original = providers.AppProvider.shutdown;
  providers.AppProvider.shutdown = () => { shutdownCalled = true; };
  const log = console.log;
  console.log = () => {};
  try {
    await withEnv({ SHUTDOWN_DELAY: '300' }, async () => {
      const { server, close, health } = await start({
        port: 0, host: '127.0.0.1', handleSignals: false, utilities: own,
      });
      console.log = log;
      const url = `http://127.0.0.1:${server.address().port}`;

      assert.equal((await fetch(`${url}/ready`)).status, 200);

      const closing = close('SIGTERM');
      assert.equal(health.shuttingDown, true);

      let res = await fetch(`${url}/ready`);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: 'shutting_down' });
      res = await fetch(`${url}/health`);
      assert.equal(res.status, 200, 'liveness stays 200 while draining');
      assert.equal(server.listening, true, 'still serving during SHUTDOWN_DELAY');
      assert.equal(shutdownCalled, false);

      assert.equal(await closing, 0);
      assert.equal(server.listening, false);
      assert.equal(shutdownCalled, true);
      assert.equal(close(), closing, 'close() is idempotent');
      await assert.rejects(fetch(`${url}/health`));
    });
  } finally {
    console.log = log;
    if (original) providers.AppProvider.shutdown = original;
    else delete providers.AppProvider.shutdown;
  }
});

test('graceful shutdown finishes while a keep-alive client keeps sending requests', async () => {
  const http = await import('node:http');
  const db = knex({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const own = { ...utilities, getDB: async () => db, DB: db };
  const log = console.log;
  console.log = () => {};
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await withEnv({ SHUTDOWN_DELAY: '0', SHUTDOWN_TIMEOUT: '5000' }, async () => {
      const { server, close } = await start({
        port: 0, host: '127.0.0.1', handleSignals: false, utilities: own,
      });
      console.log = log;
      const { port } = server.address();
      const get = () => new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port, path: '/health', agent }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.headers.connection));
        }).on('error', () => resolve('error'));
      });
      await get();
      // close() while a request is in flight on the keep-alive socket, then keep
      // reusing that socket: without `Connection: close` the server never closes
      let closing;
      server.once('request', () => { closing = close('SIGTERM'); });
      let busy = true;
      const loop = (async () => { while (busy) await get(); })();
      while (!closing) await new Promise((resolve) => { setTimeout(resolve, 5); });

      const started = Date.now();
      assert.equal(await closing, 0, 'closed cleanly, not by SHUTDOWN_TIMEOUT');
      assert.ok(Date.now() - started < 4000);
      busy = false;
      await loop;
    });
  } finally {
    console.log = log;
    agent.destroy();
  }
});

test('READY_CHECKS=queue checks the RabbitMQ connection of @averoa/utilities', async () => {
  const { queueCheck } = await import('../health.js');
  await queueCheck(async () => ({ getConnection: async () => ({}) }))();
  await assert.rejects(queueCheck(async () => ({ getConnection: async () => { throw new Error('ECONNREFUSED'); } }))(), /ECONNREFUSED/);

  // real module, no broker configured → down with a clear message
  await withEnv({ READY_CHECKS: 'database,queue', RABBITMQ_SERVER: undefined }, async () => {
    const { app } = await createApp();
    await withServer(app, async (url) => {
      const res = await fetch(`${url}/ready`);
      assert.equal(res.status, 503);
      const { checks } = await res.json();
      assert.equal(checks.database.status, 'up');
      assert.equal(checks.queue.status, 'down');
      assert.match(checks.queue.error, /no AMQP server configured/);
    });
  });
});

// Needs a broker, e.g. `docker run -d --rm -p 25673:5672 rabbitmq:4.1-alpine` and
// AVEROA_TEST_AMQP_URL=amqp://127.0.0.1:25673 npm test
test('READY_CHECKS=queue against a real RabbitMQ', { skip: !process.env.AVEROA_TEST_AMQP_URL && 'AVEROA_TEST_AMQP_URL not set' }, async () => {
  const { closeQueue } = utilities;
  await withEnv({ READY_CHECKS: 'database,queue', RABBITMQ_SERVER: process.env.AVEROA_TEST_AMQP_URL }, async () => {
    const { app } = await createApp();
    try {
      await withServer(app, async (url) => {
        const res = await fetch(`${url}/ready`);
        const body = await res.json();
        assert.equal(res.status, 200, JSON.stringify(body));
        assert.equal(body.checks.queue.status, 'up');
      });
    } finally {
      await closeQueue();
    }
  });
});
