/**
 * Test helpers for AveroaJS applications (`@averoa/core/testing`).
 *
 *   import { test, before, after } from 'node:test';
 *   import { testApp } from '@averoa/core/testing';
 *
 *   let app;
 *   before(async () => { app = await testApp(); });   // migrated, seeded, listening
 *   after(() => app?.close());
 *
 *   test('GET /api', async () => {
 *     const res = await app.http('GET', '/api');
 *     assert.equal(res.status, 200);
 *   });
 *
 * This module has no top-level imports, so a static import is safe; set the
 * environment (NODE_ENV=test, DB_*, secrets) before calling testApp() or
 * importing @averoa/utilities, which builds the database from it on first
 * import. Jobs: `fakeJobs()` from @averoa/utilities.
 */

/**
 * A small fetch wrapper for tests. Resolves `{ status, headers, body, text }`
 * (`body` is the parsed JSON, or undefined). A request that does not answer
 * within `timeout` ms fails with an error naming it, instead of hanging the run.
 *
 * @param {string} baseUrl e.g. http://127.0.0.1:3000
 * @param {{ timeout?: number, headers?: Record<string, string> }} [options]
 */
export function client(baseUrl, { timeout = 5000, headers: defaults = {} } = {}) {
  return async (method, url, {
    body, token, headers = {}, form,
  } = {}) => {
    const init = {
      method, headers: { ...defaults, ...headers }, signal: AbortSignal.timeout(timeout),
    };
    if (form !== undefined) {
      init.body = form; // FormData or URLSearchParams: fetch sets the content type
    } else if (body !== undefined) {
      init.headers['content-type'] ??= 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    if (token) init.headers.authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(new URL(url, baseUrl), init);
    } catch (err) {
      if (err.name === 'TimeoutError') {
        throw new Error(`${method} ${url} did not respond within ${timeout}ms (handler hangs)`, { cause: err });
      }
      throw err;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return {
      status: res.status, headers: res.headers, body: json, text,
    };
  };
}

const LOAD_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/**
 * Build the app (createApp), prepare the database and listen on a random port.
 *
 * @param {object}  [options]
 * @param {boolean} [options.migrate=true]  run every migration
 * @param {boolean} [options.seed=true]     run the seeders (after migrating)
 * @param {boolean} [options.fresh]         roll every migration back first; default: true unless
 *   the database is in-memory SQLite. Only runs with NODE_ENV=test, so a test never wipes another
 *   database.
 * @param {number}  [options.timeout=5000]  per-request timeout of `http()`
 * @param {string}  [options.host='127.0.0.1']
 * @returns {Promise<TestApp>}
 */
export async function testApp({
  migrate = true, seed = true, fresh, timeout = 5000, host = '127.0.0.1', ...appOptions
} = {}) {
  const [core, utilities] = await Promise.all([import('./index.js'), import('@averoa/utilities')]);
  const DB = typeof utilities.getDB === 'function' ? (await utilities.getDB()) ?? utilities.DB : utilities.DB;

  // the database the app really uses (built once per process by @averoa/utilities)
  const { client: dbClient, connection } = DB?.client?.config ?? {};
  const { isSqliteClient, buildConfig } = await import('./knexfile.js');
  const inMemory = isSqliteClient(dbClient) && [':memory:', '', undefined].includes(connection?.filename);
  const rollback = (migrate || seed) && (fresh ?? !inMemory);
  if (rollback && process.env.NODE_ENV !== 'test') {
    throw new Error('testApp() rolls every migration back first (fresh); it runs only with NODE_ENV=test '
      + `(got "${process.env.NODE_ENV}"). Set NODE_ENV=test, or pass { fresh: false }.`);
  }

  const { app, health } = await core.createApp(appOptions);

  if (migrate || seed) {
    const config = await buildConfig();
    const migrations = { ...config.migrations, loadExtensions: LOAD_EXTENSIONS };
    if (rollback) await DB.migrate.rollback(migrations, true);
    if (migrate) await DB.migrate.latest(migrations);
    if (seed) await DB.seed.run({ ...config.seeds, loadExtensions: LOAD_EXTENSIONS });
  }

  const server = app.listen(0, host);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${server.address().port}`;
  const http = client(url, { timeout });

  let closing;
  const close = () => {
    closing ??= (async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => { server.close(() => resolve()); });
      await Promise.allSettled([
        DB?.destroy?.(),
        utilities.closeQueue?.(),
        core.closeRedis?.(),
        core.closeLogStreams?.(),
      ]);
    })();
    return closing;
  };

  return {
    app, server, health, url, DB, http, close,
  };
}

/**
 * Record mail instead of sending it, for `Mail` from @averoa/utilities: direct
 * sends and queued ones (`.queue()`) alike. Each entry is the message options
 * (`from`, `to`, `subject`, `text`, `html`, ...) plus `queue` (the queue name, or
 * null for a direct send). Call `restore()` to send for real again.
 */
export async function fakeMail() {
  const { default: Mail, defaultMailQueue } = await import('@averoa/utilities/Mail.js');
  const original = Mail.prototype.send;
  const sent = [];

  Mail.prototype.send = async function send() {
    const message = await this.build();
    if (this.channel) {
      const queue = this.channel === true ? await defaultMailQueue() : this.channel;
      sent.push({ ...message, queue });
      return { status: 'queued', channel: queue, data: message };
    }
    sent.push({ ...message, queue: null });
    return { messageId: `<fake-${sent.length}@averoa.test>`, accepted: [].concat(message.to ?? []), rejected: [] };
  };

  const addresses = (to) => [].concat(to ?? []).flatMap((v) => String(typeof v === 'object' ? v.address : v).split(','))
    .map((v) => v.replace(/^.*<([^>]+)>.*$/, '$1').trim().toLowerCase());

  return {
    sent,
    /** Messages addressed to `address` (case-insensitive; "Name <a@b>" forms match too). */
    to(address) {
      const wanted = String(address).trim().toLowerCase();
      return sent.filter((m) => addresses(m.to).includes(wanted));
    },
    clear() {
      sent.length = 0;
    },
    restore() {
      Mail.prototype.send = original;
    },
  };
}
