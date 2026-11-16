import type { Server } from 'node:http';
import type { Express } from 'express';
import type { HelmetOptions } from 'helmet';
import type { EdgeLike } from './edge-js.js';
import type { Logger } from './env.js';
import type { BuiltInHealthChecks, Health, HealthChecksConfig } from './health.js';
import type { OpenApiDocument, RouteDescription } from './openapi.js';
import type { GlobalRateLimitConfig, GlobalRateLimitDefaults } from './rate-limit.js';
import type { UploadsOptions } from './uploads.js';
// adds `req.csrfToken()` to Express.Request (core always installs csrfProtection)
import './csrf.js';

/** A value or a promise of it: every provider hook may be async. */
export type Awaitable<T> = T | Promise<T>;

export type { EnvVars, Logger } from './env.js';
export type {
  BuiltInHealthChecks,
  CreateHealthOptions,
  Health,
  HealthCheck,
  HealthCheckContext,
  HealthCheckDefinition,
  HealthCheckFunction,
  HealthCheckResult,
  HealthChecksConfig,
  HealthSettings,
  ReadinessBody,
  ReadinessResult,
} from './health.js';
export type {
  BuildOpenApiDocumentOptions,
  CreateOpenApiDocumentOptions,
  JsonSchema,
  ModelClass,
  ModelSchemas,
  OpenApiDocument,
  RouteDescription,
  RouteDoc,
  RouteDocResponse,
} from './openapi.js';
export type {
  GlobalRateLimitConfig,
  GlobalRateLimitDefaults,
  GlobalRateLimitOptions,
  RateLimitOptions,
  RateLimitStoreKind,
} from './rate-limit.js';
export type { RequestContextStore, RequestIdOptions } from './request-id.js';
export type { SessionStore, SessionStoreKind } from './session-store.js';
export type { GetRedisClientOptions, RedisClientLike } from './redis.js';
export type { AccessLogSettings, LogChannel } from './morgan.js';
export type { UploadsOptions } from './uploads.js';
export type { EdgeLike } from './edge-js.js';

/* -------------------------------------------------------------------------- */
/* sessions and helmet                                                        */
/* -------------------------------------------------------------------------- */

/** express-session cookie options. */
export interface SessionCookieOptions {
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean | 'auto';
  sameSite?: boolean | 'lax' | 'strict' | 'none';
  domain?: string;
  path?: string;
  partitioned?: boolean;
  priority?: 'low' | 'medium' | 'high';
  signed?: boolean;
  encode?: unknown;
}

/**
 * Extra express-session options (what `AppProvider.session()` returns), merged
 * over core's defaults; `cookie` is merged separately.
 */
export interface SessionOptionsExtra {
  secret?: string | string[];
  name?: string;
  /** An express-session store; when set, SESSION_STORE is ignored. */
  store?: unknown;
  cookie?: SessionCookieOptions;
  genid?: unknown;
  rolling?: boolean;
  resave?: boolean;
  proxy?: boolean;
  saveUninitialized?: boolean;
  unset?: 'destroy' | 'keep';
}

/** The express-session options core uses. */
export interface SessionOptions extends SessionOptionsExtra {
  secret: string | string[];
  resave: boolean;
  saveUninitialized: boolean;
  cookie: SessionCookieOptions & {
    httpOnly: boolean;
    sameSite: boolean | 'lax' | 'strict' | 'none';
    secure: boolean | 'auto';
  };
}

/** Content-Security-Policy directives of `defaultHelmetOptions()`. */
export interface DefaultCspDirectives {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'font-src': string[];
  'img-src': string[];
  'connect-src': string[];
  'form-action': string[];
  /** `[]` in production, `null` (off) otherwise. */
  'upgrade-insecure-requests': string[] | null;
  [directive: string]: string[] | null;
}

/** What `defaultHelmetOptions()` returns (and `AppProvider.helmet()` receives). */
export interface DefaultHelmetOptions {
  contentSecurityPolicy: {
    useDefaults: boolean;
    directives: DefaultCspDirectives;
  };
}

/* -------------------------------------------------------------------------- */
/* providers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hooks of the `AppProvider` export of app/Providers/index.js. Every hook is
 * optional and may be async.
 *
 * @example
 * import type { AppProvider } from '@averoa/core';
 *
 * class Provider implements AppProvider {
 *   session() {
 *     return { cookie: { maxAge: 86_400_000 } };
 *   }
 * }
 * export default new Provider();
 */
export interface AppProvider {
  /** During build, before any built-in middleware (after the request id and health probes). */
  beginning?(app: Express): unknown;
  /** Helmet options to use; `false` disables helmet, `undefined` keeps the defaults. */
  helmet?(defaults: DefaultHelmetOptions):
    Awaitable<HelmetOptions | DefaultHelmetOptions | false | undefined | void>;
  /**
   * Extra express-session options merged over the defaults. A `store` here
   * wins over SESSION_STORE.
   */
  session?(): Awaitable<SessionOptionsExtra | undefined | void>;
  /**
   * Options for the global limiter (any `rateLimit()` option, plus `path`);
   * `false` disables it, `undefined` keeps the defaults. Not called when
   * RATE_LIMIT_ENABLED=false.
   */
  rateLimit?(defaults: GlobalRateLimitDefaults): Awaitable<GlobalRateLimitConfig | false | undefined | void>;
  /** `/upload` options; `false` does not serve `/upload`, `undefined` keeps the defaults. */
  uploads?(): Awaitable<UploadsOptions | false | undefined | void>;
  /**
   * On the first `GET /api/openapi.json`: change `doc` in place or return a
   * replacement; `undefined` keeps `doc`.
   */
  openapi?(doc: OpenApiDocument, context: { routes: RouteDescription[] }):
    Awaitable<object | undefined | void>;
  /**
   * The checks `/ready` runs (add, remove, replace); `false` disables
   * `/health` and `/ready`; `undefined` keeps the built-in ones.
   */
  health?(checks: BuiltInHealthChecks): Awaitable<HealthChecksConfig | false | undefined | void>;
  /** After routes and static files, before the 404 and error handlers. */
  end?(app: Express): unknown;
  /** `start()` only, after `listen` succeeded. */
  server?(server: Server): unknown;
  /** `start()` only, during graceful shutdown, after the server stopped accepting connections. Awaited. */
  shutdown?(): unknown;
}

/** Hooks of the `ViewProvider` export of app/Providers/index.js. */
export interface ViewProvider {
  /** Entries registered as Edge globals, once during build. */
  global?(): Awaitable<{ readonly [name: string]: unknown } | null | undefined | void>;
}

/* -------------------------------------------------------------------------- */
/* app                                                                        */
/* -------------------------------------------------------------------------- */

/** The parts of @averoa/utilities core uses (pass `utilities` to replace the import). */
export interface AveroaUtilities {
  Log?: Logger;
  View?: EdgeLike;
  /** The knex instance (or a proxy of it). */
  DB?: unknown;
  /** Lazily initialised knex instance; preferred over `DB`. */
  getDB?: () => unknown;
  closeQueue?: () => unknown;
  describeValidation?: (middleware: unknown) => unknown;
}

export interface CreateAppOptions {
  /** Module to use instead of importing @averoa/utilities. */
  utilities?: AveroaUtilities;
}

export interface StartOptions extends CreateAppOptions {
  /** Default APP_PORT, then 3000. */
  port?: number | string;
  /** Listen hostname (default: all interfaces). */
  host?: string;
  /** Graceful shutdown on SIGTERM/SIGINT (default true). */
  handleSignals?: boolean;
}

export interface CreateAppResult {
  app: Express;
  /** Drives `/ready`: `health.markShuttingDown()`, `health.readiness()`. */
  health: Health;
}

export interface StartResult extends CreateAppResult {
  server: Server;
  /**
   * Run the graceful shutdown without exiting the process; resolves the exit
   * code (0 or 1). Calling it again returns the same promise.
   */
  close(reason?: string): Promise<number>;
}

/** Parse TRUST_PROXY for `app.set('trust proxy', ...)`: `undefined` when unset. */
export function parseTrustProxy(value: unknown): boolean | number | string | undefined;
/** The default helmet options (CSP for the boilerplate's local assets). */
export function defaultHelmetOptions(options?: { production?: boolean }): DefaultHelmetOptions;
/**
 * The express-session options core uses. Throws when SESSION_SECRET is empty
 * outside NODE_ENV development/test.
 */
export function sessionOptions(options?: { extra?: SessionOptionsExtra | null; log?: Logger }): SessionOptions;
/** Build the Express app (everything except `listen`). */
export function createApp(options?: CreateAppOptions): Promise<CreateAppResult>;
/** Build the app and start listening. */
export function start(options?: StartOptions): Promise<StartResult>;

export { closeLogStreams, accessLogSettings, jsonAccessFormat } from './morgan.js';
export {
  buildOpenApiDocument, createOpenApiDocument, modelSchemas, isOpenApiEnabled,
} from './openapi.js';
export { createSessionStore, sessionStoreKind } from './session-store.js';
export {
  rateLimit, ipKeyGenerator, rateLimitStoreKind, globalRateLimitOptions, RATE_LIMIT_MESSAGE,
} from './rate-limit.js';
export { getRedisClient, closeRedis } from './redis.js';
export {
  requestId, restoreRequestContext, requestContext, currentRequestId, isValidRequestId, trustIncomingRequestId,
} from './request-id.js';
export { createHealth, healthSettings } from './health.js';
export { default as env } from './env.js';
export { default as command } from './command.js';
