import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_APP } from './helpers.js';

process.env.AVEROA_ROOT = FIXTURE_APP;
delete process.env.SESSION_SECRET;

const { createApp, sessionOptions, parseTrustProxy, defaultHelmetOptions } = await import('../index.js');

const quietLog = () => {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
};

after(async () => {
  process.env.NODE_ENV = 'test';
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

test('createApp throws a clear error in production without SESSION_SECRET', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.SESSION_SECRET;
  try {
    await assert.rejects(() => createApp(), /SESSION_SECRET is required unless NODE_ENV is development or test \(NODE_ENV=production\)/);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('createApp succeeds in production with SESSION_SECRET', async () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'a'.repeat(64);
  try {
    const { app } = await createApp();
    assert.equal(typeof app.handle, 'function');
  } finally {
    process.env.NODE_ENV = 'test';
    delete process.env.SESSION_SECRET;
  }
});

test('development: random secret per call with a warning', () => {
  process.env.NODE_ENV = 'development';
  try {
    const log = quietLog();
    const a = sessionOptions({ log });
    const b = sessionOptions({ log });
    assert.equal(typeof a.secret, 'string');
    assert.ok(a.secret.length >= 32);
    assert.notEqual(a.secret, b.secret);
    assert.equal(log.warnings.length, 2);
    assert.match(log.warnings[0], /SESSION_SECRET is not set/);
    assert.equal(a.cookie.secure, false);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('production: secure httpOnly lax cookie, MemoryStore warning, extra options merged', () => {
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = 'new-secret, old-secret';
  try {
    let log = quietLog();
    const opts = sessionOptions({ log, extra: { name: 'app.sid', cookie: { maxAge: 1000 } } });
    assert.deepEqual(opts.secret, ['new-secret', 'old-secret']);
    assert.equal(opts.name, 'app.sid');
    assert.deepEqual(opts.cookie, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 1000 });
    assert.equal(opts.saveUninitialized, false);
    assert.ok(log.warnings.some((w) => /MemoryStore/.test(w)));

    log = quietLog();
    sessionOptions({ log, extra: { store: {} } });
    assert.equal(log.warnings.length, 0, 'no MemoryStore warning with a store');
  } finally {
    process.env.NODE_ENV = 'test';
    delete process.env.SESSION_SECRET;
  }
});

test('C15: session cookie is secure unless NODE_ENV is development or test', () => {
  const previous = process.env.NODE_ENV;
  try {
    for (const [env, secure] of [['development', false], ['test', false], ['staging', true], [undefined, true], ['production', true]]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      if (env !== 'development' && env !== 'test') process.env.SESSION_SECRET = 'x'.repeat(64);
      const opts = sessionOptions({ log: quietLog(), extra: { store: {} } });
      assert.equal(opts.cookie.secure, secure, `NODE_ENV=${env}`);
      delete process.env.SESSION_SECRET;
    }
  } finally {
    process.env.NODE_ENV = previous ?? 'test';
  }
});

test('C-b: SESSION_SECRET is required unless NODE_ENV is development or test (staging/unset fail closed)', async () => {
  const previous = process.env.NODE_ENV;
  delete process.env.SESSION_SECRET;
  try {
    for (const env of ['staging', undefined, 'prod', '']) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      assert.throws(() => sessionOptions({ log: quietLog() }), /SESSION_SECRET is required unless NODE_ENV is development or test/, `NODE_ENV=${env}`);
    }
    delete process.env.NODE_ENV;
    await assert.rejects(() => createApp(), /SESSION_SECRET is required unless NODE_ENV is development or test \(NODE_ENV is unset\)/);

    for (const env of ['development', 'test']) {
      process.env.NODE_ENV = env;
      const log = quietLog();
      const opts = sessionOptions({ log });
      assert.equal(typeof opts.secret, 'string', `NODE_ENV=${env}`);
      assert.ok(log.warnings.some((w) => /SESSION_SECRET is not set/.test(w)));
      assert.ok(!log.warnings.some((w) => /MemoryStore/.test(w)), `no MemoryStore warning for NODE_ENV=${env}`);
    }
  } finally {
    process.env.NODE_ENV = previous ?? 'test';
  }
});

test('C-b: MemoryStore warning outside development/test, not only in production', () => {
  const previous = process.env.NODE_ENV;
  process.env.SESSION_SECRET = 'y'.repeat(64);
  try {
    for (const env of ['staging', undefined, 'production']) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      let log = quietLog();
      sessionOptions({ log });
      assert.ok(log.warnings.some((w) => /MemoryStore/.test(w)), `NODE_ENV=${env}`);
      log = quietLog();
      sessionOptions({ log, extra: { store: {} } });
      assert.equal(log.warnings.length, 0, `no warning with a store, NODE_ENV=${env}`);
    }
  } finally {
    process.env.NODE_ENV = previous ?? 'test';
    delete process.env.SESSION_SECRET;
  }
});

test('TRUST_PROXY parsing', () => {
  assert.equal(parseTrustProxy(undefined), undefined);
  assert.equal(parseTrustProxy(''), undefined);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
});

test('helmet defaults upgrade insecure requests only in production', () => {
  assert.deepEqual(defaultHelmetOptions({ production: true }).contentSecurityPolicy.directives['upgrade-insecure-requests'], []);
  assert.equal(defaultHelmetOptions({ production: false }).contentSecurityPolicy.directives['upgrade-insecure-requests'], null);
});
