// Type tests for the published declarations: `npm run typecheck`. Never run.
// Imports go through the package name, so the `exports` map (types
// conditions) is exercised as a consumer would see it.
import type { Server } from 'node:http';
import crypto from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import {
  closeLogStreams,
  closeRedis,
  command,
  createApp,
  createHealth,
  createOpenApiDocument,
  currentRequestId,
  defaultHelmetOptions,
  env,
  getRedisClient,
  globalRateLimitOptions,
  ipKeyGenerator,
  parseTrustProxy,
  rateLimit,
  RATE_LIMIT_MESSAGE,
  requestContext,
  sessionOptions,
  start,
  type AppProvider,
  type Health,
  type HealthCheckContext,
  type OpenApiDocument,
  type ViewProvider,
} from '@averoa/core';
import knexConfig, { buildConfig } from '@averoa/core/knexfile';
import { rateLimitError, RedisRateLimitStore } from '@averoa/core/rate-limit.js';
import { buildOpenApiDocument, modelSchemas, mountOpenApi } from '@averoa/core/openapi.js';
import { probePath } from '@averoa/core/health.js';
import { REQUEST_ID_MAX_LENGTH } from '@averoa/core/request-id.js';
import createCors from '@averoa/core/cors.js';
import { csrfProtection } from '@averoa/core/csrf.js';
import {
  buildProgram, makeModel, makePolicy, makeMigration, makeTest, makeValidator,
} from '@averoa/core/command.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function expectType<T extends true>(): T | void {}

/* ------------------------------------------------------------------ */
/* An AppProvider, as in the README                                    */
/* ------------------------------------------------------------------ */

class Provider implements AppProvider {
  io: { close(): Promise<void> } | undefined;

  beginning(app: Express) {
    app.get('/early', (req, res) => { res.send(req.id); });
    app.post('/form', (req, res) => { res.json({ token: req.csrfToken?.() }); });
  }

  helmet(defaults: ReturnType<typeof defaultHelmetOptions>) {
    defaults.contentSecurityPolicy.directives['script-src'].push('https://cdn.jsdelivr.net');
    return defaults;
  }

  session() {
    return { cookie: { maxAge: 86_400_000 } };
  }

  rateLimit(defaults: { path: string; name: string; windowMs: number; limit: number }) {
    return { ...defaults, limit: 300, skip: (req: Request) => req.path === '/health' };
  }

  uploads() {
    return { inlineExtensions: ['jpg', 'png', 'pdf'] };
  }

  async openapi(doc: OpenApiDocument) {
    doc.info.title = 'Acme API';
    doc.servers = [{ url: 'https://api.acme.test' }];
    doc.components.schemas.Token = { type: 'object' };
    return doc;
  }

  health(checks: Parameters<NonNullable<AppProvider['health']>>[0]) {
    return {
      ...checks,
      redis: async ({ signal }: HealthCheckContext) => !signal.aborted,
      search: { check: () => true, timeout: 500, critical: false },
    };
  }

  server(server: Server) {
    this.io = { close: async () => { server.close(); } };
  }

  async shutdown() {
    await this.io?.close();
  }
}

export const appProvider: AppProvider = new Provider();

// object literal providers: hooks may return false / undefined, sync or async
export const literalProvider: AppProvider = {
  helmet: () => false,
  // async hooks and class methods widen `false` to boolean: use `as const`
  rateLimit: async () => false as const,
  uploads: () => undefined,
  health: () => false,
  session: async () => ({ store: {}, cookie: { secure: 'auto', sameSite: 'strict' } }),
};

export const viewProvider: ViewProvider = {
  async global() {
    return { appName: 'Acme' };
  },
};

// @ts-expect-error helmet() must return options, false or undefined
export const badProvider: AppProvider = { helmet: () => 'no' };

/* ------------------------------------------------------------------ */
/* createApp / start                                                    */
/* ------------------------------------------------------------------ */

export async function boot() {
  const { app, health } = await createApp();
  expectType<Equal<typeof app, Express>>();
  expectType<Equal<typeof health, Health>>();
  app.use((_req: Request, _res: Response, next: NextFunction) => next());

  const ready = await health.readiness();
  const ok: boolean = ready.ok && ready.body.status === 'ok';
  health.markShuttingDown();
  const shuttingDown: boolean = health.shuttingDown;

  const started = await start({ port: 0, host: '127.0.0.1', handleSignals: false });
  const server: Server = started.server;
  const code: number = await started.close('test');

  // @ts-expect-error unknown option
  await start({ prot: 3000 });

  await closeLogStreams();
  await closeRedis();
  return {
    ok, shuttingDown, server, code,
  };
}

/* ------------------------------------------------------------------ */
/* rate limiting                                                        */
/* ------------------------------------------------------------------ */

export const loginLimiter = rateLimit({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later.',
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip ?? '')}:${crypto.createHash('sha256').update(email).digest('hex')}`;
  },
});
export const handle = (req: Request, res: Response, next: NextFunction) => loginLimiter(req, res, next);
export const asyncMessage = rateLimit({ message: async (req) => `slow down ${req.ip}` });
export const store = new RedisRateLimitStore({ prefix: 'rl:custom:' });
export const err = rateLimitError();
expectType<Equal<typeof err.code, 'ERATELIMIT'>>();
export const message: string = RATE_LIMIT_MESSAGE;
export const globalLimit: number = globalRateLimitOptions({ RATE_LIMIT_MAX: '10' }).limit;
// @ts-expect-error message must be a string or a function
rateLimit({ message: 42 });

/* ------------------------------------------------------------------ */
/* the rest of the main entry and the subpath modules                   */
/* ------------------------------------------------------------------ */

export const trust = parseTrustProxy(process.env.TRUST_PROXY);
export const sessionDefaults = sessionOptions({ extra: { cookie: { maxAge: 1000 } } });
export const secure: boolean | 'auto' = sessionDefaults.cookie.secure;
export const id: string | undefined = currentRequestId() ?? requestContext.getStore()?.requestId;
export const parsed = env.parse('A=1');
export const cli: Promise<void> = command(['node', 'averoa', 'make:model', 'User']);
export const program = buildProgram().name();
export async function generators() {
  await makeModel('Post', { table: 'posts', migration: true, seed: true });
  await makePolicy('PostPolicy', { model: 'Post' });
  await makeValidator('PostValidator', { force: true });
  await makeMigration('add_title_to_posts', { table: 'posts' });
  await makeTest('posts', { http: true });
  // @ts-expect-error -- create is a table name, not a boolean
  await makeMigration('x', { create: true });
}

export async function redis() {
  const client = await getRedisClient({ url: 'redis://127.0.0.1:6379' });
  const isReady: boolean = client.isReady;
  interface TypedClient { ping(): Promise<string> }
  const typed = await getRedisClient<TypedClient>();
  return [isReady, await typed.ping()];
}

export async function openapi() {
  class Teacher {
    static column = { name: { migration: (t: unknown) => t } };
  }
  const doc = buildOpenApiDocument({
    routes: [{
      method: 'get', openapiPath: '/teachers', params: [], handler: 'TeacherController@index', doc: { summary: 'List' },
    }],
    models: { Teacher },
  });
  const schemas = modelSchemas(Teacher);
  const generated: OpenApiDocument = await createOpenApiDocument({ prefix: '/api' });
  return [doc.openapi, schemas.read, generated.paths];
}

export async function health() {
  const h = await createHealth({
    getKnex: async () => undefined,
    AppProvider: { health: (checks) => ({ ...checks, extra: () => true }) },
  });
  return [h.livenessPath, probePath('/live', '/health'), REQUEST_ID_MAX_LENGTH];
}

export async function knex() {
  const config = await buildConfig();
  const dirs: string | string[] = knexConfig.production.migrations.directory;
  return [config.client, dirs];
}

export function middleware(app: Express) {
  app.use(createCors({ whitelist: 'https://app.example.com' }));
  app.use(csrfProtection({ skip: ['/webhooks'] }));
  mountOpenApi(app, { prefix: '/api', ui: false });
}
