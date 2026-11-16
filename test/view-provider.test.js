import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_APP, listen } from './helpers.js';

// Own file (own process): Edge globals live on the shared View instance.
process.env.AVEROA_ROOT = FIXTURE_APP;
process.env.NODE_ENV = 'test';
delete process.env.SESSION_SECRET;
delete process.env.CORS_WHITELIST;

const { createApp, closeLogStreams } = await import('../index.js');
const providers = await import(`${FIXTURE_APP}/app/Providers/index.js`);

after(async () => {
  await closeLogStreams();
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

test('C-f: an async ViewProvider.global() is awaited and its globals are registered', async () => {
  const original = providers.ViewProvider.global;
  providers.ViewProvider.global = async () => {
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    return { greeting: 'Howdy' };
  };
  try {
    const { app } = await createApp();
    const srv = await listen(app);
    try {
      const res = await fetch(`${srv.url}/view`);
      assert.equal(res.status, 200, await res.clone().text());
      assert.match(await res.text(), /<p>Howdy Averoa<\/p>/);
    } finally {
      await srv.close();
    }
  } finally {
    providers.ViewProvider.global = original;
  }
});

test('C-f: a sync ViewProvider.global() still works', async () => {
  const { app } = await createApp();
  const srv = await listen(app);
  try {
    const res = await fetch(`${srv.url}/view`);
    assert.match(await res.text(), /<p>Hello Averoa<\/p>/);
  } finally {
    await srv.close();
  }
});
