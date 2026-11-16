// @averoa/core/testing: testApp(), client() and fakeMail() on a throw-away copy
// of the fixture app with one migration, one seeder and routes that use the DB
// and Mail. The copy lives inside the package so it resolves this package's
// node_modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { FIXTURE_APP } from './helpers.js';
// static import on purpose: it must not load @averoa/utilities before the env is set
import { testApp, client, fakeMail } from '../testing.js';

const root = fs.mkdtempSync(path.join(path.dirname(FIXTURE_APP), '.tmp-testing-'));
fs.cpSync(FIXTURE_APP, root, { recursive: true });
const write = (rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

write('config/database.js', `export default () => ({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});
`);
write('database/migrations/20260101000000_notes.js', `export const up = (knex) => knex.schema.createTable('notes', (t) => {
  t.increments('id'); t.string('title');
});
export const down = (knex) => knex.schema.dropTableIfExists('notes');
`);
write('database/seeds/1000-notes.js', "export const seed = async (knex) => { await knex('notes').insert({ title: 'seeded' }); };\n");
write('routes/web.js', "import express from 'express';\nexport default { init: () => express.Router() };\n");
write('routes/api.js', `import express from 'express';
import { DB, Mail } from '@averoa/utilities';

export default {
  async init() {
    const router = express.Router();
    router.get('/notes', async (req, res) => res.json(await DB('notes').select('title').orderBy('id')));
    router.post('/notes', async (req, res) => {
      await DB('notes').insert({ title: req.body.title });
      res.status(201).json({ ok: true });
    });
    router.get('/whoami', (req, res) => res.json({ auth: req.headers.authorization ?? null, x: req.headers['x-test'] ?? null }));
    router.post('/mail', async (req, res) => {
      await Mail.init().from('app@averoa.test').to('Ada <ADA@example.test>').subject('Hi').text('direct').send();
      await Mail.init().from('app@averoa.test').to('bob@example.test').subject('Later').text('queued').queue().send();
      await Mail.init().to('carol@example.test').subject('Named').queue('urgent').send();
      res.json({ ok: true });
    });
    router.get('/slow', async () => { await new Promise(() => {}); });
    return router;
  },
};
`);

process.env.AVEROA_ROOT = root;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.SESSION_SECRET = 'x'.repeat(32);
process.env.RATE_LIMIT_ENABLED = 'false';
delete process.env.CSRF_ENABLED;

let app;

before(async () => {
  app = await testApp();
});

after(async () => {
  await app?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('testApp migrates, seeds and serves the app on a random port', async () => {
  assert.match(app.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const created = await app.http('POST', '/api/notes', { body: { title: 'second' } });
  assert.equal(created.status, 201, created.text);
  const res = await app.http('GET', '/api/notes');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [{ title: 'seeded' }, { title: 'second' }]);
  assert.equal(res.headers.get('content-type').split(';')[0], 'application/json');
  assert.equal(typeof app.DB, 'function');
  assert.equal((await app.DB('notes').count({ n: '*' }))[0].n, 2);
});

test('http() sends bearer tokens and headers; client() times out instead of hanging', async () => {
  const res = await app.http('GET', '/api/whoami', { token: 'abc', headers: { 'x-test': '1' } });
  assert.deepEqual(res.body, { auth: 'Bearer abc', x: '1' });
  const raw = await app.http('GET', '/api/nope');
  assert.equal(raw.status, 404);

  const quick = client(app.url, { timeout: 100 });
  await assert.rejects(() => quick('GET', '/api/slow'), /GET \/api\/slow did not respond within 100ms/);
});

test('fakeMail records direct and queued mail and restores sending', async () => {
  const mail = await fakeMail();
  try {
    const res = await app.http('POST', '/api/mail');
    assert.equal(res.status, 200, res.text);
    assert.equal(mail.sent.length, 3);
    const [direct] = mail.to('ada@example.test');
    assert.equal(direct.subject, 'Hi');
    assert.equal(direct.text, 'direct');
    assert.equal(direct.queue, null);
    assert.equal(mail.to('bob@example.test')[0].queue, 'mail');
    assert.equal(mail.to('carol@example.test')[0].queue, 'urgent');
    mail.clear();
    assert.equal(mail.sent.length, 0);
  } finally {
    mail.restore();
  }
  const { default: Mail } = await import('@averoa/utilities/Mail.js');
  assert.doesNotMatch(Mail.prototype.send.toString(), /sent\.push/, 'the real send() is back');
});

test('fresh rolls every migration back first, and only with NODE_ENV=test', async () => {
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => testApp({ fresh: true }), /runs only with NODE_ENV=test \(got "production"\)/);
  } finally {
    process.env.NODE_ENV = 'test';
  }
  assert.equal((await app.DB('notes').count({ n: '*' }))[0].n, 2, 'nothing was rolled back');

  // same in-memory database: rolled back, migrated and seeded again -> only the seeded row
  const second = await testApp({ fresh: true });
  const res = await second.http('GET', '/api/notes');
  assert.deepEqual(res.body, [{ title: 'seeded' }]);
  await new Promise((resolve) => { second.server.close(resolve); });
});
