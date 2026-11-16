import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { FIXTURE_APP, listen, cookiesFrom } from './helpers.js';

const UPLOAD_DIR = path.join(FIXTURE_APP, 'storages', 'upload');

process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
delete process.env.SESSION_SECRET;
delete process.env.CORS_WHITELIST;
delete process.env.CSRF_ENABLED;
delete process.env.UPLOAD_INLINE_EXTENSIONS;
delete process.env.TRUST_PROXY;

const { createApp } = await import('../index.js');
const providers = await import(`${FIXTURE_APP}/app/Providers/index.js`);
const strategies = await import(`${FIXTURE_APP}/app/Strategies/index.js`);

let app;
let srv;
let engineCalls = 0;

before(async () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, 'evil.html'), '<script>alert(document.cookie)</script>');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'evil.js'), 'alert(1)');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'noext'), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(UPLOAD_DIR, 'photo.PNG'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(UPLOAD_DIR, 'notes.txt'), 'hi');
  ({ app } = await createApp());
  // count engine registrations from here on: there must be none per request
  const original = app.engine.bind(app);
  app.engine = (...args) => {
    engineCalls += 1;
    return original(...args);
  };
  srv = await listen(app);
});

after(async () => {
  await srv?.close();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

test('createApp builds the fixture app from AVEROA_ROOT and runs provider hooks', async () => {
  assert.equal(typeof app.listen, 'function');
  assert.equal(providers.calls.beginning, 1);
  assert.equal(providers.calls.end, 1);
  assert.equal(providers.calls.session, 1);
  assert.equal(providers.calls.helmet, 1);
  assert.equal(strategies.configured.count, 1);

  const res = await fetch(`${srv.url}/api/ping`);
  assert.deepEqual(await res.json(), { pong: true });

  const end = await fetch(`${srv.url}/from-end`);
  assert.deepEqual(await end.json(), { end: true });

  const file = await fetch(`${srv.url}/static.txt`);
  assert.equal((await file.text()).trim(), 'static file');
});

test('helmet security headers and CSP are set', async () => {
  const res = await fetch(`${srv.url}/api/ping`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(res.headers.get('x-powered-by'), null);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /fonts\.googleapis\.com/);
  assert.doesNotMatch(csp, /upgrade-insecure-requests/, 'no upgrade outside production');
});

test('CSRF: web POST without token is rejected', async () => {
  const res = await fetch(`${srv.url}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.status, false);
  assert.equal(body.code, 'EBADCSRFTOKEN');
});

test('CSRF: web POST with token (header or _csrf field) is accepted, wrong token rejected', async () => {
  const first = await fetch(`${srv.url}/csrf`);
  const { token } = await first.json();
  const cookie = cookiesFrom(first);
  assert.ok(token && token.length >= 32);
  assert.match(cookie, /fixture\.sid=/, 'AppProvider.session() options applied');

  let res = await fetch(`${srv.url}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token, cookie },
    body: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, body: { a: 1 } });

  res = await fetch(`${srv.url}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ _csrf: token, b: '2' }).toString(),
  });
  assert.equal(res.status, 200);

  res = await fetch(`${srv.url}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': `${token.slice(0, -1)}x`, cookie, accept: 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

test('CSRF: /api POST is not affected', async () => {
  const res = await fetch(`${srv.url}/api/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { body: { x: 1 } });
});

test('session cookie is httpOnly and SameSite=Lax', async () => {
  const res = await fetch(`${srv.url}/csrf`);
  const raw = res.headers.getSetCookie().join('\n');
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  assert.doesNotMatch(raw, /Secure/, 'not secure outside production');
});

test('404 is JSON for /api', async () => {
  const res = await fetch(`${srv.url}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /json/);
  const body = await res.json();
  assert.equal(body.status, false);
  assert.equal(body.message, 'Not Found');
});

test('404 is HTML for browsers on web routes and JSON when JSON is accepted', async () => {
  let res = await fetch(`${srv.url}/nope`, { headers: { accept: 'text/html' } });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /html/);

  res = await fetch(`${srv.url}/nope`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).status, false);
});

test('error handler shows stack in development and hides it in production', async () => {
  let res = await fetch(`${srv.url}/api/boom`);
  assert.equal(res.status, 500);
  let body = await res.json();
  assert.equal(body.message, 'api exploded');
  assert.ok(body.stack, 'stack in non-production');

  process.env.NODE_ENV = 'production';
  try {
    res = await fetch(`${srv.url}/api/boom`);
    assert.equal(res.status, 500);
    body = await res.json();
    assert.deepEqual(body, { status: false, message: 'Internal Server Error' });

    res = await fetch(`${srv.url}/boom`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    assert.equal(res.status, 500);
    assert.doesNotMatch(html, /secret internals/);
    assert.doesNotMatch(html, /at /);
  } finally {
    process.env.NODE_ENV = 'test';
  }
});

test('edge engine is registered once and renders with dot notation, globals and csrfToken', async () => {
  const engine = app.engines['.edge'];
  assert.equal(typeof engine, 'function');

  for (const route of ['/view', '/view-slash', '/view']) {
    const res = await fetch(`${srv.url}${route}`);
    assert.equal(res.status, 200, await res.clone().text());
    const html = await res.text();
    assert.match(html, /<p>Hello (Averoa|Slash)<\/p>/);
    assert.match(html, /name="_csrf" value="[A-Za-z0-9_-]{40,}"/);
  }

  assert.equal(engineCalls, 0, 'app.engine() is not called per request');
  assert.equal(app.engines['.edge'], engine, 'same engine function after requests');
});

/* C11: cookie-authenticated /api calls need the CSRF token ------------------ */

async function loginSession() {
  const res = await fetch(`${srv.url}/login-test`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { user: { id: 7 } });
  const cookie = cookiesFrom(res);
  assert.match(cookie, /fixture\.sid=/);
  return cookie;
}

test('C11: session-authenticated /api POST without CSRF token is rejected', async () => {
  const cookie = await loginSession();
  const res = await fetch(`${srv.url}/api/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ x: 1 }),
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.code, 'EBADCSRFTOKEN');
});

test('C11: session-authenticated /api POST with the token (from req.csrfToken() on /api) is accepted', async () => {
  const cookie = await loginSession();
  const tokenRes = await fetch(`${srv.url}/api/csrf-token`, { headers: { cookie } });
  const { token } = await tokenRes.json();
  assert.ok(token && token.length >= 32);

  const res = await fetch(`${srv.url}/api/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': token },
    body: JSON.stringify({ x: 2 }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { body: { x: 2 } });
});

test('C11: /api POST with an Authorization header or without a logged-in session skips CSRF', async () => {
  const cookie = await loginSession();
  let res = await fetch(`${srv.url}/api/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, authorization: 'Bearer abc' },
    body: JSON.stringify({ x: 3 }),
  });
  assert.equal(res.status, 200);

  // anonymous session cookie (no passport user) → not cookie-authenticated
  const anon = await fetch(`${srv.url}/csrf`);
  res = await fetch(`${srv.url}/api/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookiesFrom(anon) },
    body: JSON.stringify({ x: 4 }),
  });
  assert.equal(res.status, 200);
});

/* C1: uploads are not served as active same-origin content ------------------- */

test('C1: uploaded html/svg/js/extensionless files are attachments with a sandbox CSP', async () => {
  for (const name of ['evil.html', 'evil.svg', 'evil.js', 'noext']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${srv.url}/upload/${name}`);
    assert.equal(res.status, 200, name);
    assert.match(res.headers.get('content-disposition') ?? '', /^attachment/, name);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox", name);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', name);
  }
});

test('C1: raster images (case-insensitive extension) are inline but still sandboxed + nosniff', async () => {
  const res = await fetch(`${srv.url}/upload/photo.PNG`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), null);
  assert.match(res.headers.get('content-type'), /image\/png/);
  assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('C1: AppProvider.uploads() can change the inline allowlist or disable /upload', async () => {
  const original = providers.AppProvider.uploads;
  try {
    providers.AppProvider.uploads = () => ({ inlineExtensions: ['txt'] });
    let built = await createApp();
    let s = await listen(built.app);
    try {
      let res = await fetch(`${s.url}/upload/notes.txt`);
      assert.equal(res.headers.get('content-disposition'), null);
      res = await fetch(`${s.url}/upload/photo.PNG`);
      assert.match(res.headers.get('content-disposition') ?? '', /^attachment/);
    } finally {
      await s.close();
    }

    providers.AppProvider.uploads = () => false;
    built = await createApp();
    s = await listen(built.app);
    try {
      const res = await fetch(`${s.url}/upload/photo.PNG`);
      assert.equal(res.status, 404);
    } finally {
      await s.close();
    }
  } finally {
    if (original) providers.AppProvider.uploads = original;
    else delete providers.AppProvider.uploads;
  }
});
