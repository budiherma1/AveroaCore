import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { compileOrigin, createOriginChecker, createCors, isDevelopmentEnv, trustsProxy } from '../cors.js';
import { listen } from './helpers.js';

test('*.example.com allows subdomains only', () => {
  const allowed = createOriginChecker('*.example.com');
  assert.equal(allowed('https://a.example.com'), true);
  assert.equal(allowed('http://a.example.com'), true);
  assert.equal(allowed('https://a.b.example.com'), true);
  assert.equal(allowed('https://aexample.com'), false);
  assert.equal(allowed('https://a.example.com.evil.io'), false);
  assert.equal(allowed('https://a.exampleXcom'), false);
  assert.equal(allowed('https://evil.io/?x=a.example.com'), false);
});

test('scheme in a wildcard entry is enforced and every regex char is literal', () => {
  const allowed = createOriginChecker('https://*.ex-ample.co.uk:8443');
  assert.equal(allowed('https://a.ex-ample.co.uk:8443'), true);
  assert.equal(allowed('http://a.ex-ample.co.uk:8443'), false);
  assert.equal(allowed('https://a.exXample.co.uk:8443'), false);
  assert.equal(allowed('https://a.ex-ampleXcoXuk:8443'), false);
});

test('exact entries match exactly (case and trailing slash insensitive)', () => {
  const allowed = createOriginChecker('http://example1.com, https://App.Example2.com/');
  assert.equal(allowed('http://example1.com'), true);
  assert.equal(allowed('https://app.example2.com'), true);
  assert.equal(allowed('https://example1.com'), false);
  assert.equal(allowed('http://example1.com.evil.io'), false);
});

test('wildcard anywhere but the leading label is rejected at startup', () => {
  assert.throws(() => compileOrigin('https://example.*'), /leading subdomain wildcard/);
  assert.throws(() => compileOrigin('https://a*.example.com'), /leading subdomain wildcard/);
  assert.throws(() => compileOrigin('*example.com'), /leading subdomain wildcard/);
});

test('no Origin header and empty whitelist are allowed', () => {
  assert.equal(createOriginChecker('a.example.com')(undefined), true);
  assert.equal(createOriginChecker('')('https://anything.io'), true);
});

async function corsServer(options) {
  const app = express();
  app.use(createCors(options));
  app.get('/x', (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  return listen(app);
}

test('middleware: whitelisted origin gets credentials, others 403, same-origin passes', async () => {
  const srv = await corsServer({ whitelist: '*.example.com', production: true });
  try {
    let res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://a.example.com' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://a.example.com');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');

    res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://a.example.com.evil.io' } });
    assert.equal(res.status, 403);

    res = await fetch(`${srv.url}/x`, { headers: { origin: srv.url } });
    assert.equal(res.status, 200);
  } finally {
    await srv.close();
  }
});

test('middleware: empty whitelist in production allows all WITHOUT credentials', async () => {
  const srv = await corsServer({ whitelist: '', production: true });
  try {
    const res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://other.io' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
  } finally {
    await srv.close();
  }
});

test('middleware: empty whitelist in development reflects origin with credentials', async () => {
  const srv = await corsServer({ whitelist: '', production: false });
  try {
    const res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://other.io' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://other.io');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  } finally {
    await srv.close();
  }
});

async function withNodeEnv(value, fn) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test('C15: only NODE_ENV development/test count as development', () => {
  assert.equal(isDevelopmentEnv('development'), true);
  assert.equal(isDevelopmentEnv('test'), true);
  for (const env of ['production', 'staging', 'prod', 'Development', '', undefined]) {
    assert.equal(isDevelopmentEnv(env), false, `NODE_ENV=${env}`);
  }
});

test('C15: empty whitelist with NODE_ENV staging/unset does NOT reflect origins with credentials', async () => {
  for (const env of ['staging', undefined, 'production']) {
    await withNodeEnv(env, async () => {
      const srv = await corsServer({ whitelist: '' });
      try {
        const res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://evil.io' } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('access-control-allow-origin'), '*', `NODE_ENV=${env}`);
        assert.equal(res.headers.get('access-control-allow-credentials'), null, `NODE_ENV=${env}`);
      } finally {
        await srv.close();
      }
    });
  }
  await withNodeEnv('development', async () => {
    const srv = await corsServer({ whitelist: '' });
    try {
      const res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://other.io' } });
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://other.io');
      assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    } finally {
      await srv.close();
    }
  });
});

test('C16: TRUST_PROXY unset/false/0 does not count as trusting a proxy', () => {
  for (const v of [undefined, '', ' ', 'false', 'FALSE', '0', false]) assert.equal(trustsProxy(v), false, String(v));
  for (const v of ['true', '1', '2', 'loopback', '10.0.0.0/8']) assert.equal(trustsProxy(v), true, v);
});

test('C16: behind a TLS proxy without TRUST_PROXY the app\'s own https origin is same-origin', async () => {
  for (const trustProxy of ['', 'false']) {
    const srv = await corsServer({ whitelist: 'https://partner.io', production: true, trustProxy });
    const host = new URL(srv.url).host;
    try {
      // browser on https://<host> → TLS proxy → app over http
      let res = await fetch(`${srv.url}/x`, { headers: { origin: `https://${host}` } });
      assert.equal(res.status, 200, `TRUST_PROXY=${trustProxy}`);
      assert.equal(res.headers.get('access-control-allow-origin'), `https://${host}`);

      // a different port or host is still cross-origin → 403
      res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://127.0.0.1:1' } });
      assert.equal(res.status, 403);
      res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://evil.io' } });
      assert.equal(res.status, 403);
    } finally {
      await srv.close();
    }
  }
});

test('C16: default ports are normalised in the same-origin check', async () => {
  const srv = await corsServer({ whitelist: 'https://partner.io', production: true, trustProxy: '' });
  const http = await import('node:http');
  const u = new URL(srv.url);
  const statusFor = (headers) => new Promise((resolve, reject) => {
    const r = http.request({ host: u.hostname, port: u.port, path: '/x', headers }, (resp) => {
      resp.resume();
      resolve(resp.statusCode);
    });
    r.on('error', reject);
    r.end();
  });
  try {
    assert.equal(await statusFor({ host: 'app.example.com', origin: 'https://app.example.com:443' }), 200);
    assert.equal(await statusFor({ host: 'app.example.com:443', origin: 'https://app.example.com' }), 200);
    assert.equal(await statusFor({ host: 'app.example.com', origin: 'https://app.example.com:8443' }), 403);
    assert.equal(await statusFor({ host: 'app.example.com', origin: 'https://app.example.com.evil.io' }), 403);
  } finally {
    await srv.close();
  }
});

test('C16: with TRUST_PROXY set the scheme is compared (X-Forwarded-Proto)', async () => {
  const app = express();
  app.set('trust proxy', true);
  app.use(createCors({ whitelist: 'https://partner.io', production: true, trustProxy: 'true' }));
  app.get('/x', (req, res) => res.json({ ok: true }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
  const srv = await listen(app);
  const host = new URL(srv.url).host;
  try {
    let res = await fetch(`${srv.url}/x`, { headers: { origin: `https://${host}`, 'x-forwarded-proto': 'https' } });
    assert.equal(res.status, 200);
    res = await fetch(`${srv.url}/x`, { headers: { origin: `https://${host}` } });
    assert.equal(res.status, 403, 'https origin vs plain http request is cross-origin when the proxy is trusted');
  } finally {
    await srv.close();
  }
});

test('C-c: CORS_WHITELIST="*" allows every origin WITHOUT credentials (never reflected)', async () => {
  for (const production of [true, false]) {
    const srv = await corsServer({ whitelist: '*', production });
    try {
      const res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://evil.io' } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('access-control-allow-origin'), '*', `production=${production}`);
      assert.equal(res.headers.get('access-control-allow-credentials'), null, `production=${production}`);

      // preflight
      const pre = await fetch(`${srv.url}/x`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.io', 'access-control-request-method': 'PUT' },
      });
      assert.equal(pre.headers.get('access-control-allow-origin'), '*');
      assert.equal(pre.headers.get('access-control-allow-credentials'), null);
    } finally {
      await srv.close();
    }
  }
});

test('C-c: "*" next to other entries: listed origins get credentials, the rest get * without credentials', async () => {
  const srv = await corsServer({ whitelist: 'https://app.example.com, *', production: true });
  try {
    let res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://app.example.com' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://app.example.com');
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
    assert.match(res.headers.get('vary') ?? '', /Origin/);

    res = await fetch(`${srv.url}/x`, { headers: { origin: 'https://evil.io' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-credentials'), null);
    assert.match(res.headers.get('vary') ?? '', /Origin/, 'response varies by Origin');
  } finally {
    await srv.close();
  }
});
