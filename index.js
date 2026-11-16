import './env.js';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import chalk from 'chalk';
import { Model } from 'objection';
import { appPath, importApp } from '@averoa/utilities/paths';
import { createCors, isDevelopmentEnv } from './cors.js';
import morgan, { closeLogStreams } from './morgan.js';
import { registerViewEngine } from './edge-js.js';
import { csrfProtection } from './csrf.js';
import { uploadStatic } from './uploads.js';
import { createSessionStore, sessionStoreKind } from './session-store.js';
import {
  rateLimit, globalRateLimitOptions, prepareRateLimitStore, rateLimitStoreKind, setRateLimitLogger,
} from './rate-limit.js';
import { closeRedis } from './redis.js';

const API_PREFIX = '/api';

const isProduction = () => process.env.NODE_ENV === 'production';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** TRUST_PROXY: true/false, a hop count, or an express trust-proxy string. */
export function parseTrustProxy(value) {
  if (value === undefined || value === null) return undefined;
  const raw = String(value).trim();
  if (raw === '') return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const envBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
};

/** Default helmet options: CSP that fits the boilerplate's local assets. */
export function defaultHelmetOptions({ production = isProduction() } = {}) {
  return {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': production ? [] : null,
      },
    },
  };
}

/**
 * express-session options.
 * SESSION_SECRET is required unless NODE_ENV is development or test (a comma
 * separated list is allowed for rotation: the first one signs, all of them
 * verify). Production, staging and an unset NODE_ENV fail closed. In
 * development/test a random secret is generated per boot (sessions don't
 * survive restarts) with a warning. The cookie is `secure` unless NODE_ENV is
 * development or test; set TRUST_PROXY behind a TLS proxy.
 */
export function sessionOptions({ extra, log = console } = {}) {
  const development = isDevelopmentEnv();
  let secret = process.env.SESSION_SECRET?.split(',').map((s) => s.trim()).filter(Boolean);

  if (!secret || secret.length === 0) {
    if (!development) {
      const env = process.env.NODE_ENV ? `NODE_ENV=${process.env.NODE_ENV}` : 'NODE_ENV is unset';
      throw new Error(
        `@averoa/core: SESSION_SECRET is required unless NODE_ENV is development or test (${env}). `
        + 'Generate one with `openssl rand -hex 64` and set it in the environment.',
      );
    }
    secret = [crypto.randomBytes(32).toString('hex')];
    log.warn?.('@averoa/core: SESSION_SECRET is not set; using a random secret for this boot (sessions reset on restart).');
  }

  const base = {
    secret: secret.length === 1 ? secret[0] : secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: !development,
    },
  };

  const options = {
    ...base,
    ...(extra ?? {}),
    cookie: { ...base.cookie, ...(extra?.cookie ?? {}) },
  };

  if (!development && !options.store) {
    log.warn?.('@averoa/core: express-session is using the in-memory MemoryStore outside development/test; '
      + 'it leaks memory and does not scale past one process. Set SESSION_STORE=redis (with REDIS_URL) '
      + 'or return a `store` from AppProvider.session().');
  }

  return options;
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const wantsJson = (req) => {
  const urlPath = (req.originalUrl || req.url).split('?')[0];
  if (urlPath === API_PREFIX || urlPath.startsWith(`${API_PREFIX}/`)) return true;
  if (req.xhr) return true;
  return req.accepts(['html', 'json']) === 'json';
};

function notFound(req, res, next) {
  const err = new Error('Not Found');
  err.status = 404;
  err.expose = true;
  next(err);
}

function errorHandler(Log) {
  // eslint-disable-next-line no-unused-vars
  return function averoaErrorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    // Details (stack, 5xx messages) only for NODE_ENV development/test;
    // production, staging and an unset NODE_ENV fail closed.
    const showDetails = isDevelopmentEnv();
    let status = Number(err?.status ?? err?.statusCode);
    if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;

    if (status >= 500) {
      Log?.error?.(`${req.method} ${req.originalUrl} → ${status}: ${err?.stack || err}`);
    }

    const expose = status < 500 || err?.expose === true;
    const message = (expose || showDetails) ? (err?.message || 'Error') : 'Internal Server Error';

    const body = { status: false, message };
    if (err?.code && expose) body.code = err.code;
    if (showDetails && err?.stack) body.stack = err.stack;

    res.status(status);
    if (wantsJson(req)) return res.json(body);

    return res.type('html').send(
      `<!doctype html><html><head><meta charset="utf-8"><title>${status}</title></head>`
      + `<body><h1>${status}</h1><p>${escapeHtml(message)}</p>`
      + `${body.stack ? `<pre>${escapeHtml(body.stack)}</pre>` : ''}</body></html>`,
    );
  };
}

/**
 * The knex instance for Objection. Prefers `getDB()` when @averoa/utilities
 * exposes it (lazy init), else the `DB` export (knex instance or proxy).
 */
async function resolveKnex(utilities) {
  if (typeof utilities?.getDB === 'function') return (await utilities.getDB()) ?? utilities.DB;
  return utilities?.DB;
}

async function loadRouter(rel) {
  const mod = await importApp(rel, { optional: true });
  const router = mod?.default;
  if (!router) return null;
  if (typeof router.init === 'function') return router.init();
  return router; // already an express router / middleware
}

/* -------------------------------------------------------------------------- */
/* app                                                                        */
/* -------------------------------------------------------------------------- */

async function build(options = {}) {
  const utilities = options.utilities ?? await import('@averoa/utilities');
  const { Log, View } = utilities;
  const log = Log ?? console;

  const providers = (await importApp('app/Providers/index.js', { optional: true })) ?? {};
  const AppProvider = providers.AppProvider ?? {};
  const ViewProvider = providers.ViewProvider ?? {};

  const app = express();
  app.disable('x-powered-by');

  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

  await AppProvider.beginning?.(app);

  morgan(app);

  // security headers
  const helmetDefaults = defaultHelmetOptions();
  const helmetOptions = AppProvider.helmet ? await AppProvider.helmet(helmetDefaults) : undefined;
  if (helmetOptions !== false) app.use(helmet(helmetOptions ?? helmetDefaults));

  app.use(createCors());

  // rate limiting: validate the settings (fail closed on typos), make sure a
  // Redis store is reachable, then mount the global limiter before body
  // parsing and sessions so rejected requests stay cheap
  setRateLimitLogger(log);
  sessionStoreKind();
  rateLimitStoreKind();
  await prepareRateLimitStore({ log });
  const rateLimitDefaults = globalRateLimitOptions();
  if (rateLimitDefaults.enabled) {
    const { enabled: _enabled, ...defaults } = rateLimitDefaults;
    const custom = AppProvider.rateLimit ? await AppProvider.rateLimit({ ...defaults }) : undefined;
    if (custom !== false) {
      const { path: limitPath = defaults.path, ...limitOptions } = { ...defaults, ...(custom ?? {}) };
      app.use(limitPath, rateLimit(limitOptions));
    }
  }

  // body parsing
  const limit = process.env.BODY_LIMIT || '1mb';
  app.use(express.json({ limit }));
  app.use(express.urlencoded({ extended: true, limit }));
  app.use(cookieParser());

  // session + passport
  // AppProvider.session() wins: a `store` there means core creates none
  let extraSession = AppProvider.session ? await AppProvider.session() : undefined;
  if (extraSession?.store) {
    if (sessionStoreKind() !== 'memory') {
      log.warn?.('@averoa/core: SESSION_STORE is ignored because AppProvider.session() returns a store.');
    }
  } else {
    const store = await createSessionStore({ log });
    if (store) extraSession = { ...(extraSession ?? {}), store };
  }
  app.use(session(sessionOptions({ extra: extraSession, log })));
  app.use(passport.initialize());
  app.use(passport.session());

  const strategies = (await importApp('app/Strategies/index.js', { optional: true })) ?? {};
  for (const strategy of Object.values(strategies)) {
    await strategy?.config?.();
  }

  const knex = await resolveKnex(utilities);
  if (knex) Model.knex(knex);

  // views (Edge instance from @averoa/utilities, registered once)
  registerViewEngine(app, View, {
    views: appPath('resources', 'views'),
    // global() may be sync or async
    globals: await ViewProvider.global?.(),
  });

  // routes
  const apiRouter = await loadRouter('routes/api.js');
  const webRouter = await loadRouter('routes/web.js');

  // CSRF runs before both routers. Web routes always need the token; /api
  // only when the request is authenticated by the session cookie and has no
  // Authorization header (token-only API clients are not affected).
  const csrfEnabled = envBool(process.env.CSRF_ENABLED, true);
  if (csrfEnabled) app.use(csrfProtection({ sessionOnly: [API_PREFIX] }));

  if (apiRouter) app.use(API_PREFIX, apiRouter);
  if (webRouter) app.use('/', webRouter);

  app.use('/', express.static(appPath('public')));

  // user uploads: nosniff + sandbox CSP, downloaded unless a raster image
  const uploads = AppProvider.uploads ? await AppProvider.uploads() : undefined;
  if (uploads !== false) {
    app.use('/upload', uploadStatic(appPath('storages', 'upload'), uploads ?? {}));
  }

  await AppProvider.end?.(app);

  app.use(notFound);
  app.use(errorHandler(Log));

  return { app, utilities, AppProvider, log };
}

/**
 * Build the express app (everything except `listen`). Used by `start()` and
 * by tests.
 *
 * @param {object} [options]
 * @returns {Promise<{ app: import('express').Express }>}
 */
export async function createApp(options = {}) {
  const { app } = await build(options);
  return { app };
}

/**
 * Build the app and start listening.
 *
 * @param {object}  [options]
 * @param {number|string} [options.port]  defaults to APP_PORT, then 3000
 * @param {string}  [options.host]        listen hostname (default: all interfaces)
 * @param {boolean} [options.handleSignals=true] graceful shutdown on SIGTERM/SIGINT
 * @returns {Promise<{ app: import('express').Express, server: import('http').Server }>}
 */
export async function start(options = {}) {
  const { app, utilities, AppProvider, log } = await build(options);
  const port = options.port ?? process.env.APP_PORT ?? 3000;

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const actualPort = server.address()?.port ?? port;
  const host = process.env.APP_HOST || 'http://localhost';
  console.log(chalk.blueBright(`AveroaJS listening on ${host}:${actualPort}`));

  await AppProvider.server?.(server);

  if (options.handleSignals !== false) {
    let closing = false;
    const shutdown = async (signal) => {
      if (closing) return;
      closing = true;
      log.info?.(`@averoa/core: ${signal} received, shutting down`);

      const timeout = Number(process.env.SHUTDOWN_TIMEOUT) || 10000;
      const timer = setTimeout(() => {
        log.error?.('@averoa/core: graceful shutdown timed out, forcing exit');
        process.exit(1);
      }, timeout);
      timer.unref();

      let code = 0;
      try {
        await new Promise((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections?.();
        });
        await AppProvider.shutdown?.();
        await Promise.allSettled([
          (await resolveKnex(utilities))?.destroy?.(),
          utilities.closeQueue?.(),
          closeRedis(),
          closeLogStreams(),
        ]);
      } catch (err) {
        code = 1;
        log.error?.(`@averoa/core: error during shutdown: ${err?.stack || err}`);
      }
      process.exit(code);
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }

  return { app, server };
}

export { closeLogStreams } from './morgan.js';
export { createSessionStore, sessionStoreKind } from './session-store.js';
export {
  rateLimit, ipKeyGenerator, rateLimitStoreKind, globalRateLimitOptions, RATE_LIMIT_MESSAGE,
} from './rate-limit.js';
export { getRedisClient, closeRedis } from './redis.js';
export { default as env } from './env.js';
export { default as command } from './command.js';
