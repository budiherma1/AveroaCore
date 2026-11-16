<div align="center">

# @averoa/core

The bootstrap package of AveroaJS: it builds a secure Express 5 application from your project's conventions and ships the `averoa` code generator.

[![npm version](https://img.shields.io/npm/v/@averoa/core)](https://www.npmjs.com/package/@averoa/core)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org)
[![part of AveroaJS](https://img.shields.io/badge/part%20of-AveroaJS-6f42c1)](https://github.com/budiherma1/averoajs)

</div>

## Contents

- [Overview](#overview)
- [Installation](#installation)
- [Quick start](#quick-start)
- [API reference](#api-reference)
- [Application layout](#application-layout)
- [Bootstrap order](#bootstrap-order)
- [Providers](#providers)
- [Configuration](#configuration)
- [Security](#security)
- [API documentation (OpenAPI)](#api-documentation-openapi)
- [Rate limiting](#rate-limiting)
- [Errors and 404](#errors-and-404)
- [Views](#views)
- [Observability](#observability)
- [Graceful shutdown](#graceful-shutdown)
- [CLI reference](#cli-reference)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Upgrading from 1.x](#upgrading-from-1x)
- [Related packages](#related-packages)
- [License](#license)

## Overview

`@averoa/core` turns an AveroaJS project folder into a running server. A single call to `start()` creates the Express 5
app, installs the middleware stack (request logging, helmet, CORS, rate limiting, body parsing, cookies, sessions,
passport, CSRF),
binds Objection to the database, registers the Edge view engine, mounts your routes and static files, adds 404 and
error handlers, starts listening and handles SIGTERM/SIGINT.

It also provides:

- `createApp()`, the same build without `listen`, for tests;
- the `averoa` CLI (`make:controller`, `make:model`, `make:crud`, ...), which renders Edge templates bundled with
  the package;
- a knexfile for the knex migration CLI that works from any working directory.

Most projects get this package through the [AveroaJS boilerplate](https://github.com/budiherma1/averoajs), whose
`server.js` and `averoa.js` already call `start()` and `command()`. This page is the reference for the package itself.

Every app-specific file is located through the **app root**: `AVEROA_ROOT` when set (absolute, or relative to the
working directory), otherwise the nearest directory at or above the working directory that contains a `package.json`
and is not inside `node_modules`. Resolution is done by `@averoa/utilities/paths`.

## Installation

```bash
npm install @averoa/core @averoa/routes @averoa/utilities express edge.js knex objection passport
```

| Requirement | Version |
| --- | --- |
| Node.js | >= 20 (`engines`) |
| Module system | ESM only (`"type": "module"`) |
| Peer dependencies | `express` ^5.1.0, `passport` ^0.7.0, `objection` ^3.1.5, `knex` ^3.1.0, `edge.js` ^5.5.1, `@averoa/utilities` ^2.0.0, `@averoa/routes` ^3.0.0 |

The framework libraries are peer dependencies so that your app and the framework share a single copy of each. Install
a database driver as well; the knexfile defaults to `mysql2`.

Redis support is optional. The packages are optional peer dependencies, loaded only when the feature is turned on; a
missing one stops startup with a message that names the package to install:

| Feature | Install |
| --- | --- |
| `SESSION_STORE=redis` | `npm install redis connect-redis` (`redis` ^5 or ^6, `connect-redis` ^9) |
| `RATE_LIMIT_STORE=redis` (the default when `SESSION_STORE=redis`) | `npm install redis rate-limit-redis` (`rate-limit-redis` ^6) |

## Quick start

```js
// server.js
import { start } from '@averoa/core';

const { app, server } = await start(); // listens on APP_PORT, then 3000
```

```js
// averoa.js
import { command } from '@averoa/core';

command(); // node averoa.js make:controller HomeController
```

```js
// routes/web.js (any object with init(), or an Express router)
import express from 'express';

export default {
  async init() {
    const router = express.Router();
    router.get('/', (req, res) => res.render('pages.home', { title: 'Home' }));
    return router;
  },
};
```

In a full AveroaJS app, `routes/api.js` and `routes/web.js` export an [`@averoa/routes`](https://github.com/budiherma1/AveroaRoute)
router, which has the required `init()` method.

## API reference

### Main entry: `@averoa/core`

| Export | Kind | Description |
| --- | --- | --- |
| `start(options?)` | async function | Builds the app and starts listening. |
| `createApp(options?)` | async function | Builds the app without listening. |
| `command(argv?)` | async function | Runs the `averoa` CLI. |
| `env` | object | The `dotenv` module, after `<app root>/.env` has been loaded. |
| `sessionOptions({ extra?, log? })` | function | Returns the express-session options core uses. |
| `defaultHelmetOptions({ production? })` | function | Returns the default helmet options (the CSP below). |
| `parseTrustProxy(value)` | function | Parses a `TRUST_PROXY` string for `app.set('trust proxy', ...)`. |
| `closeLogStreams()` | async function | Closes the shared `access.log` / `error.log` streams (see [Application layout](#application-layout)). |
| `buildOpenApiDocument(options)` | function | Builds an OpenAPI 3.1 document from `router.describe()` routes and models. See [API documentation](#api-documentation-openapi). |
| `createOpenApiDocument({ prefix?, AppProvider?, utilities? })` | async function | The document `GET /api/openapi.json` serves, for the current app. |
| `modelSchemas(Model)` | function | JSON Schemas of a Model (`read`, `create`, `update`, `createForm`, `updateForm`). |
| `isOpenApiEnabled(env?)` | function | `OPENAPI_ENABLED`, defaulting to `true` only for `NODE_ENV` `development`/`test`. |
| `rateLimit(options?)` | function | Creates a rate-limit middleware with AveroaJS defaults (see [Rate limiting](#rate-limiting)). |
| `ipKeyGenerator(ip, ipv6Subnet?)` | function | Re-exported from express-rate-limit: the client IP, IPv6 grouped by subnet. Use it in custom `keyGenerator`s. |
| `rateLimitStoreKind(env?)` | function | `'memory'` or `'redis'` from `RATE_LIMIT_STORE` / `SESSION_STORE`; throws on an unknown value. |
| `globalRateLimitOptions(env?)` | function | The global limiter settings from `RATE_LIMIT_*`; throws on an invalid value. |
| `RATE_LIMIT_MESSAGE` | string | The default 429 message. |
| `createSessionStore({ log? })` | async function | The session store selected by `SESSION_STORE` (`undefined` for memory). |
| `sessionStoreKind(env?)` | function | `'memory'` or `'redis'` from `SESSION_STORE`; throws on an unknown value. |
| `getRedisClient({ url?, feature?, log? })` | async function | The shared, connected node-redis client for `REDIS_URL` (see [Session store](#session-store)). |
| `closeRedis()` | async function | Closes every shared Redis client. |
| `requestId(options?)` | function | The request-id middleware core installs (see [Request IDs](#request-ids)). |
| `restoreRequestContext()` | function | Middleware that re-enters the request context of `req`. |
| `requestContext`, `currentRequestId()` | AsyncLocalStorage, function | The per-request context and the current request id. |
| `isValidRequestId(value)`, `trustIncomingRequestId(env?)` | functions | Incoming id validation and trust rules. |
| `createHealth(options)`, `healthSettings(env?)` | functions | The `/health` and `/ready` endpoints (see [Health checks](#health-checks)). |
| `accessLogSettings(env?)`, `jsonAccessFormat` | function, morgan format | Access log settings and the JSON line format (see [Access log](#access-log)). |

Importing `@averoa/core` loads `<app root>/.env` as a side effect. Variables that already exist in `process.env` take
precedence over the file.

#### `start(options?)`

```ts
start(options?: {
  port?: number | string;      // default: APP_PORT, then 3000
  host?: string;               // listen hostname; default: all interfaces
  handleSignals?: boolean;     // default: true (graceful shutdown on SIGTERM/SIGINT)
  utilities?: object;          // module to use instead of importing @averoa/utilities
}): Promise<{ app: Express; server: http.Server; health: Health; close(reason?: string): Promise<number> }>
```

After the server is listening, `start()` logs `AveroaJS listening on <APP_HOST>:<port>`, calls
`AppProvider.server(server)` and, unless `handleSignals` is `false`, installs the
[graceful shutdown](#graceful-shutdown) handlers. A listen error (for example `EADDRINUSE`) rejects the promise.

`close()` runs the same graceful shutdown without exiting the process and resolves the exit code (`0` or `1`) the
signal handler would use; calling it again returns the same promise. `health` is described under
[Health checks](#health-checks).

#### `createApp(options?)`

```ts
createApp(options?: { utilities?: object }): Promise<{ app: Express; health: Health }>
```

Runs the full [bootstrap](#bootstrap-order) without listening and without signal handlers. `AppProvider.server` and
`AppProvider.shutdown` are not called. Use it in tests or to mount the app in your own server.

#### `command(argv?)`

```ts
command(argv?: string[]): Promise<void> // default: process.argv
```

Parses `argv` in Node format (`['node', 'averoa', 'make:model', 'User']`) and runs the matching generator. Errors are
printed in red and set `process.exitCode = 1`; the promise does not reject. See the [CLI reference](#cli-reference).

#### `sessionOptions({ extra, log })`

Builds the express-session options described under [Sessions](#sessions-and-cookies). `extra` is merged over the
defaults (with `cookie` merged separately). Throws when `SESSION_SECRET` is empty and `NODE_ENV` is neither
`development` nor `test`. `log` defaults to `console` and receives the development-secret and MemoryStore warnings.

#### `defaultHelmetOptions({ production })`

Returns `{ contentSecurityPolicy: { useDefaults: true, directives } }` with the directives listed under
[Security headers](#security-headers). `production` defaults to `NODE_ENV === 'production'` and controls
`upgrade-insecure-requests`.

#### `parseTrustProxy(value)`

| Input | Result |
| --- | --- |
| `undefined`, `null`, empty string | `undefined` (trust proxy is not set) |
| `'true'` / `'false'` | `true` / `false` |
| digits, e.g. `'1'` | the number (hop count) |
| anything else, e.g. `'loopback'`, `'10.0.0.0/8'` | the trimmed string, passed to Express as is |

### Subpath modules

The package exports `./knexfile` and every file through `./*`. Subpath imports other than the knexfile need the
`.js` extension (`@averoa/core/cors.js`, not `@averoa/core/cors`).

| Import | Exports |
| --- | --- |
| `@averoa/core/knexfile` | default: `{ development, test, staging, production }` (the same config for each); `buildConfig()`, `resolveSqliteFilename()`, `isSqliteClient()` |
| `@averoa/core/cors.js` | `createCors(options?)` (default), `compileOrigin`, `parseWhitelist`, `parseWhitelistEntries`, `createOriginChecker`, `isSameOrigin`, `trustsProxy`, `isDevelopmentEnv` |
| `@averoa/core/csrf.js` | `csrfProtection({ skip?, sessionOnly? })` (default), `isSessionAuthenticated(req)`, `LazyCsrfToken` |
| `@averoa/core/uploads.js` | `uploadStatic(dir, options?)` (default), `resolveInlineExtensions`, `DEFAULT_INLINE_EXTENSIONS`, `UPLOAD_CSP` |
| `@averoa/core/edge-js.js` | `registerViewEngine(app, View, { views, globals })` (default), `toViewPath`, `dotNotation` |
| `@averoa/core/command.js` | `command` (default), `buildProgram()`, `makeController`, `makeMiddleware`, `makeModel`, `makeHelper`, `makeJob`, `makeRepository`, `makeStrategy`, `makeCrud`, `validateName`, `validateTable`, `titleCase`, `migrationTimestamp`, `writeAppFile`, `addToIndex`, `TEMPLATE_DIR`, `VERSION` |
| `@averoa/core/morgan.js` | default: `(app, { env?, channel?, fileFormat?, consoleFormat?, stdout? }) => { accessLogStream, errorLogStream }`; `closeLogStreams()`, `getLogStreams()`, `accessLogSettings()`, `jsonAccessFormat` |
| `@averoa/core/request-id.js` | `requestId(options?)` (default), `restoreRequestContext()`, `requestContext`, `currentRequestId()`, `isValidRequestId()`, `trustIncomingRequestId()`, `REQUEST_ID_MAX_LENGTH` |
| `@averoa/core/health.js` | `createHealth(options)` (default), `healthSettings()`, `probePath()`, `databaseCheck()`, `queueCheck()` |
| `@averoa/core/env.js` | default: `dotenv` (loads `<app root>/.env` on import) |
| `@averoa/core/openapi.js` | the four OpenAPI exports above, plus `mountOpenApi(app, options)`, `isOpenApiUiEnabled`, `docsHtml`, `docsContentSecurityPolicy`, `SWAGGER_UI`, `DEFAULT_AUTH_MIDDLEWARE`, `OPENAPI_VERSION` |
| `@averoa/core/rate-limit.js` | `rateLimit(options?)` (default), `ipKeyGenerator`, `rateLimitStoreKind`, `globalRateLimitOptions`, `prepareRateLimitStore`, `setRateLimitLogger`, `rateLimitError`, `RedisRateLimitStore`, `RATE_LIMIT_STORES`, `RATE_LIMIT_MESSAGE` |
| `@averoa/core/session-store.js` | `createSessionStore({ log? })`, `sessionStoreKind`, `SESSION_STORES` |
| `@averoa/core/redis.js` | `getRedisClient`, `closeRedis`, `loadOptional(name, feature)`, `redactRedisUrl`, `setModuleLoader` (tests only) |

`createApp()` already installs all of these; the subpath modules are useful when you assemble a custom app or test a
single piece. `csrfProtection()` defaults to `skip: []` and `sessionOnly: ['/api']`. `createCors()` accepts
`{ whitelist, production, trustProxy }`, which default to `CORS_WHITELIST`, "NODE_ENV is neither development nor test"
and `TRUST_PROXY`.

## Application layout

Core reads these paths relative to the app root. Every file is optional.

| Path | Used as |
| --- | --- |
| `.env` | Loaded with dotenv when core (or the knexfile) is imported. |
| `app/Providers/index.js` | Named exports `AppProvider` and `ViewProvider` (see [Providers](#providers)). |
| `app/Strategies/index.js` | Every export's `config()` is awaited once at startup (passport strategies), in alphabetical order of the export names: module namespace order, not the order of the `export` lines. |
| `routes/api.js` | Default export; mounted at `/api`. |
| `routes/web.js` | Default export; mounted at `/`. |
| `resources/views/` | Edge views directory. |
| `public/` | Static files served at `/`. |
| `storages/upload/` | User uploads served at `/upload` with sandbox headers. |
| `storages/logs/` | `access.log` and `error.log` (created automatically, not with `LOG_CHANNEL=stdout`). Each file is opened once per process and shared by every `createApp()`; `closeLogStreams()` closes them and the next request reopens them. |
| `config/database.js` | Read by the knexfile only. |
| `database/migrations/`, `database/seeds/` | Default knex directories; written to by `make:crud`. |

A route file's default export is used as follows: if it has an `init()` method, the awaited result of `init()` is
mounted (this is what an `@averoa/routes` router provides); otherwise the export itself is mounted as an Express
router or middleware.

## Bootstrap order

`createApp()` and `start()` build the app in this order. Anything a hook registers runs at that position in the
stack.

| # | Step | Configure with |
| --- | --- | --- |
| 1 | `express()`, `x-powered-by` disabled, `trust proxy` set when `TRUST_PROXY` is set | `TRUST_PROXY` |
| 1a | request id (`req.id`, `X-Request-Id`, request context) | `TRUST_REQUEST_ID`, `REQUEST_ID_HEADER` |
| 1b | health probes `GET /health`, `GET /ready` | `HEALTH_PATH`, `READY_PATH`, `READY_*`, `AppProvider.health()` |
| 2 | `AppProvider.beginning(app)` | provider hook |
| 3 | morgan request logging (`storages/logs/access.log`, `error.log`, console) | `LOG_CHANNEL`, `ACCESS_LOG_FORMAT`, `NODE_ENV` |
| 4 | helmet security headers | `AppProvider.helmet(defaults)` |
| 5 | CORS | `CORS_WHITELIST`, `NODE_ENV`, `TRUST_PROXY` |
| 6 | global rate limiter, mounted at `/api` (before body parsing, so rejected requests stay cheap) | `RATE_LIMIT_*`, `AppProvider.rateLimit(defaults)` |
| 7 | `express.json()` and `express.urlencoded({ extended: true })` | `BODY_LIMIT` |
| 8 | `cookie-parser` | |
| 9 | `express-session` with the store from `SESSION_STORE` | `SESSION_SECRET`, `SESSION_STORE`, `AppProvider.session()` |
| 10 | `passport.initialize()` and `passport.session()` | |
| 11 | `config()` of every export of `app/Strategies/index.js` | your strategies |
| 12 | `Model.knex(...)` with `getDB()` (or `DB`) from `@averoa/utilities` | utilities' database config |
| 13 | Edge view engine, `ViewProvider.global()` globals and dot-notation `res.render` | `ViewProvider` |
| 14 | CSRF protection | `CSRF_ENABLED` |
| 15 | `routes/api.js` at `/api`, then `GET /api/openapi.json` and `GET /api/docs` when enabled | `OPENAPI_ENABLED`, `OPENAPI_UI`, `AppProvider.openapi(doc)` |
| 16 | `routes/web.js` at `/` | |
| 17 | `express.static(public/)` at `/` | |
| 18 | sandboxed `express.static(storages/upload/)` at `/upload` | `AppProvider.uploads()`, `UPLOAD_INLINE_EXTENSIONS` |
| 19 | `AppProvider.end(app)` | provider hook |
| 20 | 404 handler | |
| 21 | error handler | |

Consequences worth knowing:

- Middleware added in `AppProvider.beginning` runs before helmet, CORS, rate limiting, body parsing, sessions and CSRF.
- Health probes answer before `AppProvider.beginning`, the access log, sessions and CSRF: they never create a session,
  need no CSRF token and are not written to the access log. Middleware that must not apply to probes (a rate limiter,
  IP filtering, authentication) needs no exemption as long as it is mounted at step 2 or later.
- When a Redis store is selected, core connects to Redis while building (before the rate limiter and the session
  middleware are installed); outside `development` / `test` an unreachable Redis makes the build fail.
- Routes are matched before static files, so a route can shadow a file in `public/`.
- Routes added in `AppProvider.end` run after CSRF and after the static handlers, but before the default 404, so a
  catch-all registered there replaces the default 404 page.
- Multipart bodies are not parsed by core. Parse them in the route (for example with multer), which runs after CSRF.

## Providers

Core imports `app/Providers/index.js` and reads two **named** exports. Every hook is optional and may be async.

```js
// app/Providers/index.js
export { default as AppProvider } from './AppProvider.js';
export { default as ViewProvider } from './ViewProvider.js';
```

### `AppProvider`

| Hook | Called | Arguments | Return value |
| --- | --- | --- | --- |
| `beginning(app)` | during build, before any built-in middleware | Express app | ignored |
| `helmet(defaults)` | during build | `defaultHelmetOptions()` result | helmet options to use; `false` disables helmet; `undefined` keeps the defaults |
| `session()` | during build | none | extra express-session options merged over the defaults (e.g. `{ cookie: { maxAge } }`), or `undefined`. A `store` here wins over `SESSION_STORE` |
| `rateLimit(defaults)` | during build, unless `RATE_LIMIT_ENABLED=false` | `{ path, name, windowMs, limit }` from [`globalRateLimitOptions()`](#rate-limiting) | options for the global limiter (any `rateLimit()` option, plus `path`); `false` disables it; `undefined` keeps the defaults |
| `uploads()` | during build | none | `{ inlineExtensions: string[] }`, `false` to not serve `/upload`, or `undefined` for the defaults |
| `openapi(doc, { routes })` | on the first `GET /api/openapi.json` | generated OpenAPI document, `router.describe()` routes | the document to serve (change `doc` in place or return a new object); `undefined` keeps `doc` |
| `health(checks)` | during build | the built-in readiness checks, e.g. `{ database }` | the checks `/ready` runs (add, remove, replace); `false` disables `/health` and `/ready`; `undefined` keeps the defaults. See [Health checks](#health-checks) |
| `end(app)` | during build, after routes and static files, before the 404 and error handlers | Express app | ignored |
| `server(server)` | `start()` only, after `listen` succeeded | `http.Server` | ignored |
| `shutdown()` | `start()` only, on SIGTERM/SIGINT after the server stopped accepting connections | none | awaited |

```js
// app/Providers/AppProvider.js
class AppProvider {
  helmet(defaults) {
    defaults.contentSecurityPolicy.directives['script-src'].push('https://cdn.jsdelivr.net');
    return defaults;
  }

  session() {
    // the store comes from SESSION_STORE; return { store } only for a custom one
    return { cookie: { maxAge: 86_400_000 } };
  }

  rateLimit(defaults) {
    return { ...defaults, limit: 300, skip: (req) => req.path === '/health' };
  }

  uploads() {
    return { inlineExtensions: ['jpg', 'png', 'pdf'] };
  }

  server(server) {
    this.io = new Server(server); // e.g. socket.io
  }

  async shutdown() {
    await this.io?.close();
  }
}

export default new AppProvider();
```

### `ViewProvider`

| Hook | Called | Return value |
| --- | --- | --- |
| `global()` | once during build | object whose entries are registered as Edge globals |

`global()` may be synchronous or `async`; its result is awaited before the globals are registered.

## Configuration

All variables are read from the environment after `<app root>/.env` is loaded.

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | unset | Selects the environment-dependent behaviour described in the next table. |
| `APP_PORT` | `3000` | Listen port when `start({ port })` is not given. |
| `APP_HOST` | `http://localhost` | Only used in the startup log line. |
| `SESSION_SECRET` | random per boot in `development` / `test` | Session signing secret. Required unless `NODE_ENV` is `development` or `test` (startup throws without it, also for `staging` or an unset `NODE_ENV`). A comma-separated list rotates secrets: the first signs, all of them verify. Generate one with `openssl rand -hex 64`. |
| `CSRF_ENABLED` | `true` | `false`, `0`, `no` or `off` (any case) disables CSRF protection; any other non-empty value enables it. |
| `BODY_LIMIT` | `1mb` | Size limit for JSON and urlencoded bodies (e.g. `500kb`, `5mb`). Larger bodies get 413. |
| `CORS_WHITELIST` | empty | Comma-separated allowed origins; `*` allows every origin without credentials. See [CORS](#cors). |
| `TRUST_PROXY` | unset | Express `trust proxy`: `true`, `false`, a hop count or an address/subnet list. Set it behind a TLS-terminating proxy. It also decides the client IP the rate limiters see. See [`parseTrustProxy`](#parsetrustproxyvalue). |
| `SESSION_STORE` | `memory` | `memory` (express-session's MemoryStore) or `redis` (connect-redis on `REDIS_URL`). See [Session store](#session-store). |
| `SESSION_REDIS_PREFIX` | `sess:` | Redis key prefix for sessions. Use a distinct prefix per app when apps share a Redis. |
| `SESSION_TTL` | `86400` | Seconds a session lives in Redis when the cookie has no `maxAge` / `expires`. |
| `REDIS_URL` | unset | Redis connection URL (`redis://[user:pass@]host:port[/db]`, `rediss://` for TLS). Required when a Redis store is selected. |
| `REDIS_CONNECT_TIMEOUT` | `5000` | Milliseconds to wait for Redis at startup (also the per-attempt socket connect timeout). |
| `RATE_LIMIT_ENABLED` | `true` | `false`, `0`, `no` or `off` turns the global limiter off. Per-route limiters are not affected. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Global limiter window in milliseconds. |
| `RATE_LIMIT_MAX` | `100` | Requests per client (IP) and window for the global limiter. |
| `RATE_LIMIT_STORE` | `redis` when `SESSION_STORE=redis`, else `memory` | Counter store for every limiter created with `rateLimit()`: `memory` (per process) or `redis` (shared). |
| `RATE_LIMIT_REDIS_PREFIX` | `rl:` | Redis key prefix for rate-limit counters, followed by the limiter `name` and `:`. |
| `UPLOAD_INLINE_EXTENSIONS` | `jpg,jpeg,png,gif,webp,avif,bmp,ico` | Comma-separated extensions served inline from `/upload`; every other file is sent as a download. Case-insensitive, leading dots ignored. |
| `OPENAPI_ENABLED` | `true` in `development` / `test`, otherwise `false` | Serves the generated OpenAPI document at `GET /api/openapi.json` (and the docs page). `false`, `0`, `no` or `off` disables it; any other non-empty value enables it, also in production. |
| `OPENAPI_UI` | `true` | With `OPENAPI_ENABLED`, also serves the Swagger UI page at `GET /api/docs`. `false` keeps only the JSON document. |
| `SHUTDOWN_TIMEOUT` | `10000` | Milliseconds before a forced `process.exit(1)` during graceful shutdown (counted after `SHUTDOWN_DELAY`). `0` or a non-number falls back to the default. |
| `SHUTDOWN_DELAY` | `0` | Milliseconds between "readiness answers 503" and closing the server on SIGTERM/SIGINT, so load balancers stop routing to the instance first. |
| `TRUST_REQUEST_ID` | trust only when `TRUST_PROXY` is set | `true` reuses a valid incoming `X-Request-Id`, `false` always generates a new one. See [Request IDs](#request-ids). |
| `REQUEST_ID_HEADER` | `X-Request-Id` | Header read and written for the request id. |
| `HEALTH_PATH` | `/health` | Liveness path; `false`, `off` or `none` disables it. |
| `READY_PATH` | `/ready` | Readiness path; `false`, `off` or `none` disables it. |
| `READY_TIMEOUT` | `2000` | Per-check timeout of `/ready`, in milliseconds. |
| `READY_CHECKS` | `database` | Built-in readiness checks, comma separated: `database`, `queue`; `none` for none. |
| `LOG_CHANNEL` | unset | `stdout`, `file` or `both`; where the access log (and `Log` of `@averoa/utilities`) writes. Unset keeps the files plus the console outside production and test. See [Access log](#access-log). |
| `ACCESS_LOG_FORMAT` | `combined` in files; `json` or `dev` on stdout | `combined`, `json` or `dev` (stdout only). |
| `LOG_FORMAT` | `json` unless `NODE_ENV` is `development` or `test` (`pretty`) | `json` or `pretty`; also picks the stdout access log format (`json` / `dev`) when `ACCESS_LOG_FORMAT` is unset. |
| `AVEROA_ROOT` | auto-detected | App root directory. Set it when the process is not started from inside the project. |
| `DB_CLIENT` | `mysql2` | knexfile only: knex client when `config/database.js` does not set one. |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | unset | knexfile only: connection when `config/database.js` does not set one. For SQLite clients `DB_NAME` is the database file, resolved against the app root. |

The runtime database connection, logging, mail and queue settings belong to
[`@averoa/utilities`](https://github.com/budiherma1/AveroaUtilities) and are documented there.

### `NODE_ENV` semantics

Security-relevant defaults fail closed: only `development` and `test` get the relaxed CORS, cookie, session-secret and
error-detail behaviour. An unset `NODE_ENV`, `staging` or any other value is treated like production for those.

| Behaviour | `development` | `test` | `production` | unset / other |
| --- | --- | --- | --- | --- |
| Session cookie `secure` | no | no | yes | yes |
| Empty `CORS_WHITELIST` | every origin, with credentials | every origin, with credentials | `*`, no credentials | `*`, no credentials |
| `SESSION_SECRET` missing | random secret + warning | random secret + warning | startup error | startup error |
| MemoryStore warning | no | no | yes, when no `store` | yes, when no `store` |
| Redis store selected but unreachable at startup | warning, starts, keeps reconnecting | warning, starts, keeps reconnecting | startup error | startup error |
| 5xx error message | shown | shown | `Internal Server Error` | `Internal Server Error` |
| Stack trace in error responses | yes | yes | no | no |
| CSP `upgrade-insecure-requests` | no | no | yes | no |
| Console request log (morgan `dev`), `LOG_CHANNEL` unset | yes | no | no | yes |
| `/api/openapi.json` and `/api/docs` (without `OPENAPI_ENABLED`) | served | served | not served | not served |
| `/ready` error details | message | message | `timeout` / `failed` | `timeout` / `failed` |

For local work over plain HTTP, set `NODE_ENV=development`: otherwise startup requires `SESSION_SECRET`, error details
are hidden and the browser drops the `secure` session cookie.

## Security

### Sessions and cookies

Sessions use `express-session` with these defaults:

| Option | Value |
| --- | --- |
| `secret` | `SESSION_SECRET` (comma-separated list for rotation), or a random 32-byte secret per boot in `development` / `test` |
| `resave` | `false` |
| `saveUninitialized` | `false` (no cookie until something is stored in the session) |
| `cookie.httpOnly` | `true` |
| `cookie.sameSite` | `'lax'` |
| `cookie.secure` | `true` unless `NODE_ENV` is `development` or `test` |

The cookie name is express-session's default (`connect.sid`) and no `maxAge` is set, so the cookie lasts for the
browser session. Change either through `AppProvider.session()`; its result is spread over the defaults and its
`cookie` object is merged with the default cookie options.

A random development secret means sessions do not survive a restart. Outside development, use a real session store
(`SESSION_STORE=redis`, below): core logs a warning when `NODE_ENV` is neither `development` nor `test` and no `store`
is configured.

A `secure` cookie is only sent over HTTPS. Behind a TLS-terminating proxy, set `TRUST_PROXY` so Express sees the
original protocol.

### Session store

`SESSION_STORE` selects where sessions live:

| Value | Store | Use |
| --- | --- | --- |
| `memory` (default) | express-session's MemoryStore | development and tests. It leaks memory, is lost on restart and is not shared between processes, so core warns outside `development` / `test`. |
| `redis` | [connect-redis](https://github.com/tj/connect-redis) on the shared node-redis client | production, several processes or instances. Needs `npm install redis connect-redis` and `REDIS_URL`. |

```dotenv
SESSION_STORE=redis
REDIS_URL=redis://:password@redis.internal:6379/0
SESSION_REDIS_PREFIX=myapp:sess:
SESSION_TTL=86400
```

- **One connection.** `getRedisClient()` keeps one node-redis client per `REDIS_URL` per process. The session store,
  the rate-limit store and your own code (`await getRedisClient()`) share it, also across several `createApp()`
  calls. `start()` closes it on [graceful shutdown](#graceful-shutdown); call `closeRedis()` yourself in tests.
- **Fail closed at startup.** Core connects while building the app. If Redis cannot be reached within
  `REDIS_CONNECT_TIMEOUT` ms, `createApp()` / `start()` reject with an error that names the redacted URL, unless
  `NODE_ENV` is `development` or `test`: there core logs a warning, starts anyway and keeps reconnecting, and
  requests that touch the session fail until Redis is up. There is no silent fallback to memory, which would hide
  that sessions are not shared.
- **After startup** the client reconnects with a capped backoff (up to 5 s). The offline queue is disabled, so while
  Redis is down a request that needs it fails immediately with a 500 instead of hanging. Errors are logged once per
  outage, and the reconnection is logged.
- **Passwords never appear in logs**: the URL is printed with the password replaced by `***`.
- **Missing packages** stop startup with `SESSION_STORE=redis needs the optional package "connect-redis", which is
  not installed. Install it in your application: npm install connect-redis` (likewise for `redis`).
- **`AppProvider.session()` wins.** When it returns a `store`, core uses it, does not connect to Redis for sessions and
  logs that `SESSION_STORE` is ignored.

### CSRF

Core includes a session-based synchronizer-token CSRF middleware (it replaces the deprecated csurf). It is mounted
before both route files and is enabled unless `CSRF_ENABLED` is `false`, `0`, `no` or `off`.

**Token**

- One random token per session, stored in `req.session.csrfToken`.
- Read it with `req.csrfToken()` (or `res.locals.csrfToken`) in a handler, or `{{ csrfToken }}` in a view rendered
  with `res.render`. The token is created the first time it is read or printed, so pages that never print it, like
  an anonymous GET of a page without a form, do not create a session or set a cookie. In views, `csrfToken` is a lazy
  value that turns into the token string when it is output; use `req.csrfToken()` when you need the string itself
  in code.
- Send it as the `_csrf` body field or the `x-csrf-token` request header. When both are present, the body field is
  used. Tokens are compared in constant time.

**Which requests are checked**

| Request | Checked? |
| --- | --- |
| `GET`, `HEAD`, `OPTIONS` | Never |
| Any other method outside `/api` (web routes, `AppProvider.end` routes) | Always |
| Any other method under `/api` that is session-authenticated (`req.session.passport.user` is set) and has no `Authorization` header | Yes |
| Any other method under `/api` with an `Authorization` header, or without a logged-in session | No |
| Routes registered in `AppProvider.beginning` | No (they run before the middleware) |

A failed check is a `403` with `code: 'EBADCSRFTOKEN'` and the message `Invalid or missing CSRF token`, rendered by
the [error handler](#errors-and-404).

**Usage**

```html
<form method="post" action="/profile">
  <input type="hidden" name="_csrf" value="{{ csrfToken }}">
  ...
</form>
```

```js
// a browser SPA that logs in with the session cookie: expose the token on /api ...
router.get('/csrf-token', (req, res) => res.json({ token: req.csrfToken() }));

// ... and send it on every POST/PUT/PATCH/DELETE
fetch('/api/posts', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-csrf-token': token },
  body: JSON.stringify(post),
});
```

Multipart forms must send the token in the `x-csrf-token` header: core does not parse multipart bodies, so a `_csrf`
field in a multipart form is not visible when the check runs. With `CSRF_ENABLED=false`, `req.csrfToken` and the
`csrfToken` view variable are not defined.

### CORS

`CORS_WHITELIST` is a comma-separated list of allowed origins. Entries are compiled once at startup, and an invalid
entry makes `createApp()` / `start()` throw.

| Entry | Matches |
| --- | --- |
| `https://app.example.com` | Exactly that origin (case-insensitive, trailing slash ignored; include a non-default port if you use one) |
| `https://*.example.com` | Any subdomain of `example.com` over HTTPS, at any depth, but not `example.com` itself |
| `*.example.com` | Any subdomain of `example.com` over HTTP or HTTPS, but not the apex |
| `*` | Every origin, **without credentials** (`Access-Control-Allow-Origin: *`) |

`*.` is only valid as a leading subdomain wildcard; every other character, including dots and ports, is matched
literally. List the apex domain separately when you need it.

| Situation | Response |
| --- | --- |
| No `Origin` header (curl, server-to-server) | Allowed; no CORS headers added, except `Access-Control-Allow-Origin: *` when the public, credential-less policy applies (empty whitelist outside `development`/`test`, or a whitelist that is only `*`) |
| Empty whitelist, `NODE_ENV` is `development` or `test` | Every origin reflected, with credentials |
| Empty whitelist, any other `NODE_ENV` (incl. unset) | `Access-Control-Allow-Origin: *` without credentials, so browsers never send cookies cross-origin |
| Whitelist has an entry other than `*`, and the origin is the app's own origin or matches such an entry | Origin reflected, with credentials |
| Whitelist is only `*` (any origin, the app's own included), or contains `*` and the origin matches no other entry | `Access-Control-Allow-Origin: *` without credentials |
| Whitelist set without `*`, origin does not match | `403` `Origin not allowed by CORS` |

`*` never reflects an origin with credentials, in any environment. Combine it with explicit entries
(`CORS_WHITELIST=https://app.example.com,*`) to give a few origins credentialed access and every other origin public,
cookie-less access; responses then carry `Vary: Origin`.

The app's own origin (same-origin requests from its pages) is detected by comparing the `Origin` host and port with
the request host (the `Host` header, or `X-Forwarded-Host` when trusted). The scheme is only compared when
`TRUST_PROXY` trusts a proxy (it is set and is not `false` or `0`), because without that `req.protocol` reports the
proxy-to-app hop.

### Security headers

helmet 8 runs with its default headers (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, and so on) and this
Content-Security-Policy, which suits the boilerplate's local assets plus Google Fonts:

| Directive | Sources |
| --- | --- |
| `default-src` | `'self'` |
| `script-src` | `'self'` |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` |
| `font-src` | `'self' https://fonts.gstatic.com data:` |
| `img-src` | `'self' data: blob:` |
| `connect-src` | `'self'` |
| `form-action` | `'self'` |
| `upgrade-insecure-requests` | production only |

helmet's remaining CSP defaults also apply: `base-uri 'self'`, `frame-ancestors 'self'`, `object-src 'none'` and
`script-src-attr 'none'`. Inline scripts are therefore blocked. Extend or replace the options in
`AppProvider.helmet(defaults)`, or return `false` to disable helmet.

### Uploads

Files in `storages/upload/` are served at `/upload`. Because they are user-controlled, every response gets:

```text
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'none'; sandbox
Content-Disposition: attachment; filename="<name>"   (all files except the inline allowlist)
```

Only raster images (`jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`, `bmp`, `ico`, case-insensitive) are shown inline
by default. SVG, HTML, JavaScript and files without an extension are downloaded, so an uploaded file cannot run script
on the app's origin. Change the allowlist with `UPLOAD_INLINE_EXTENSIONS` or `AppProvider.uploads()` →
`{ inlineExtensions: [...] }` (the provider wins over the variable). Return `false` from `AppProvider.uploads()` to
not serve `/upload` at all.

Core only serves the directory. Validating and storing uploads (size, type, file names) is up to the app; the
boilerplate does this in its `UploadProvider`.

## API documentation (OpenAPI)

Core generates an [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0) document for the routes of `routes/api.js` and
serves it at **`GET /api/openapi.json`**, with a [Swagger UI](https://swagger.io/tools/swagger-ui/) page at
**`GET /api/docs`**. Both are on when `NODE_ENV` is `development` or `test` and off otherwise; set
`OPENAPI_ENABLED=true` to publish them elsewhere (for example on an internal staging host), `OPENAPI_UI=false` to keep
only the JSON. They are registered after the API router, so an app route with the same path wins.

The document is built on the first request and cached for the life of the process. Building it needs a
`@averoa/routes` release with `router.describe()` (after 3.0.1); with a plain Express router in `routes/api.js`, or an
older `@averoa/routes`, the document has no paths.

### What is generated

| Source | Result |
| --- | --- |
| Every route of the API router (`router.describe()`) | A path (`/api/teachers/{id}`) and an operation per verb, with path parameters, an `operationId` from the handler (`TeacherController.findOne`) and a tag from the controller name (`Teacher`). `all()` routes have no single operation and are left out; when two routes share a method and path, the first one (the one Express answers with) is documented. |
| `crud()` routes | Standard operations by verb: list (`GET` without a parameter), get by id, create (`POST`), update (`PUT` / `PATCH`), delete. The list documents the FilterSearch parameters (`limit`, `page`, `orderBy`, `orderByDesc`, `groupBy`, `$select`, `$relations`, `$relations-type`, `$withTrashed` when allowed, `$datatable`, `$draw`) and the `column:op=value` filters as a free-form `filters` object; responses use the `{ status, metadata, data }` envelope with the shared `Pagination` schema, plus 400 / 404 / 422 where they apply. |
| Model `static column` | Component schemas per model: `<Model>` (response rows: hidden columns removed, audit columns added when `timestamp` is on), `<Model>Create` / `<Model>Update` (JSON bodies: `writableColumns()`, required flags, rule messages as descriptions) and `<Model>CreateForm` / `<Model>UpdateForm` for `*Form` routes, where `upload` columns are `format: binary`. Every model exported from `app/Models/index.js` is added, so `doc()` responses can `$ref` it. |
| Column types | Read from the `migration` hint by running it against a recording fake table: `increments`/`integer`/`bigInteger` -> integer, `string(n)` -> string with `maxLength`, `float`/`double` -> number, `boolean` (`boolean` or `0`/`1` on reads), `uuid`, `date`, `datetime`/`timestamp` -> string, `enu` -> enum, nullability from `notNullable()`/`primary()`. Types that are not reliable across databases (`decimal`, `json`, `binary`, `specificType`, no `migration`) stay untyped. A column's `openapi: { ... }` object is merged into its schema. |
| Middleware named `AuthMiddleware` | `security: [{ bearerAuth: [] }]` (HTTP bearer, JWT) and a 401 response. |
| `validate()` middleware (`@averoa/utilities`) | Request body, query, path and header parameters from its JSON Schema (field definitions always; Standard Schemas when the library can export JSON Schema, e.g. zod 4.2+), and a 422 response. |
| `.doc({...})` on a route | Overrides and additions, see below. |

### `doc()` keys

```js
router.post('/auth/login', 'AuthController@login', [validate({ body: loginSchema })]).doc({
  summary: 'Log in with email and password',
  tags: ['Auth'],
  responses: {
    200: { description: 'Token issued', schema: { $ref: '#/components/schemas/Token' } },
    401: 'Invalid email or password',
  },
});
```

| Key | Effect |
| --- | --- |
| `summary`, `description`, `operationId`, `deprecated` | Copied to the operation. |
| `tags` | Replaces the default tag (model name, or controller name without `Controller`). |
| `security` | `false` documents the route as public; an array replaces the detected requirement (`[{ bearerAuth: [] }]`). |
| `request` | `{ body, query, params, headers, contentType }`: JSON Schema (or a Standard Schema with JSON Schema support) per part. `query` / `params` / `headers` are object schemas turned into parameters. Wins over `validate()` and crud schemas. `contentType` defaults to `application/json`, or `multipart/form-data` on `*Form` routes. |
| `responses` | `{ [status]: string \| { description, schema } \| Response Object }`. A string is the description; `schema` (JSON Schema or Standard Schema) becomes `application/json` content. Merged over the generated responses. |
| `parameters`, `requestBody` | Raw OpenAPI parameter list (merged by name and location) and request body (replaces the generated one). |
| `exclude` | `true` leaves the route out of the document. |

### Customising the document

`AppProvider.openapi(doc, { routes })` receives the generated document before it is cached; change it in place or
return a replacement:

```js
// app/Providers/AppProvider.js
openapi(doc) {
  doc.info.title = 'Acme API';
  doc.servers = [{ url: 'https://api.acme.test' }];
  doc.components.schemas.Token = {
    type: 'object',
    properties: { token: { type: 'string' }, type: { const: 'Bearer' }, expires_in: { type: 'string' } },
  };
  return doc;
}
```

`info` defaults to the `name`, `version` and `description` of the app's `package.json`. To write the document to a
file (for client generators or CI checks), call `createOpenApiDocument()` after `createApp()`:

```js
import fs from 'node:fs';
import { createApp, createOpenApiDocument } from '@averoa/core';

await createApp();
fs.writeFileSync('openapi.json', JSON.stringify(await createOpenApiDocument(), null, 2));
```

### The docs page and CSP

`/api/docs` loads Swagger UI 5.34.1 from jsDelivr, pinned by version and Subresource Integrity hashes. The app-wide
helmet CSP stays unchanged; this page alone gets its own policy: `script-src 'self' 'nonce-<random>'
https://cdn.jsdelivr.net` (a fresh nonce per request for the one inline bootstrap script, no `unsafe-eval`),
`style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`, `connect-src 'self'` (so "Try it out" only calls the app
itself) and `frame-ancestors 'self'`. If the browser can't reach jsDelivr, use the JSON document with a local tool
instead, or set `OPENAPI_UI=false`.

## Rate limiting

Core uses [express-rate-limit](https://express-rate-limit.mintlify.app/). A global limiter is mounted on `/api`
(after CORS, before body parsing, sessions and CSRF), and `rateLimit(options)` creates stricter limiters for single
routes.

**Defaults** (every limiter created with `rateLimit()`, including the global one):

- keyed by the client IP, `req.ip`, with IPv6 addresses grouped by /56. `req.ip` follows `TRUST_PROXY`: behind a
  reverse proxy set it (e.g. `TRUST_PROXY=1`), or every client shares the proxy's address; without a proxy leave it
  unset, or clients can pick their own IP through `X-Forwarded-For`. express-rate-limit reports
  `TRUST_PROXY=true` (every hop trusted) and an untrusted `X-Forwarded-For` header through the app log;
- standard headers from the IETF draft 8 (`RateLimit`, `RateLimit-Policy`), no legacy `X-RateLimit-*` headers, and
  `Retry-After` on a 429;
- over the limit, a `429` error goes to the [error handler](#errors-and-404) (or the app's own one): JSON for `/api`,
  XHR and JSON clients, a small HTML page otherwise:

  ```json
  { "status": false, "message": "Too many requests, please try again later.", "code": "ERATELIMIT" }
  ```

- counters in the store selected by `RATE_LIMIT_STORE`: `memory` (per process; every instance counts on its own) or
  `redis` ([rate-limit-redis](https://github.com/express-rate-limit/rate-limit-redis) on the shared client, needs
  `npm install redis rate-limit-redis`; counters are shared by every instance). It defaults to `redis` when
  `SESSION_STORE=redis`, and fails closed at startup like the session store;
- a store error (e.g. Redis down) fails the request with a 500. Pass `passOnStoreError: true` to let requests through
  instead.

**Global limiter.** `RATE_LIMIT_MAX` requests per `RATE_LIMIT_WINDOW_MS` (default 100 per minute) per client on
`/api`. `RATE_LIMIT_ENABLED=false` turns it off. Invalid values (`RATE_LIMIT_MAX=abc`, `0`, an unknown
`RATE_LIMIT_STORE`) make startup fail instead of silently changing the limit. `AppProvider.rateLimit(defaults)`
receives `{ path: '/api', name: 'global', windowMs, limit }` and returns the options to use (any `rateLimit()` option;
`path: '/'` covers every route, static files included) or `false` to disable it.

**Per-route limiters.** `rateLimit(options)` accepts every express-rate-limit option plus `name` (the limiter's
identity in a shared store: Redis keys are `RATE_LIMIT_REDIS_PREFIX + name + ':' + key`) and `message`. Give every
limiter a unique `name`; unnamed limiters with the same window and limit share their counters in Redis. Create
limiters once, at startup (route files, middleware modules), never inside a request handler.

```js
// app/Middleware/LoginRateLimitMiddleware.js — 5 failed logins per 15 minutes per IP and email
import crypto from 'crypto';
import { rateLimit, ipKeyGenerator } from '@averoa/core';

const limiter = rateLimit({
  name: 'login',
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // only failed attempts count
  message: 'Too many login attempts, please try again later.',
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}:${crypto.createHash('sha256').update(email).digest('hex')}`;
  },
});

export default { handle: (req, res, next) => limiter(req, res, next) };
```

A custom `keyGenerator` that uses `req.ip` must pass it through `ipKeyGenerator()`, otherwise express-rate-limit
reports `ERR_ERL_KEY_GEN_IPV6` (one IPv6 user could rotate addresses inside their /64 to bypass the limit).

## Errors and 404

Unmatched requests become a `404 Not Found` error, and every error reaches the default error handler. With
Express 5, a rejected promise from an async handler reaches it too.

- **Status**: `err.status` or `err.statusCode` when it is an integer from 400 to 599, otherwise `500`.
- **Message**: `err.message` for status < 500 or when `err.expose === true`. For other 5xx errors the message is
  replaced with `Internal Server Error` unless `NODE_ENV` is `development` or `test` (also when it is unset or
  `staging`).
- **Logging**: 5xx errors are logged with the method, URL and stack through `Log` from `@averoa/utilities`.
- **Format**: JSON for paths under `/api`, XHR requests (`X-Requested-With: XMLHttpRequest`) and requests whose
  `Accept` header prefers JSON over HTML; a minimal HTML page otherwise (also when no `Accept` header is sent).

```json
{ "status": false, "message": "Invalid or missing CSRF token", "code": "EBADCSRFTOKEN", "requestId": "4b0d6c1e-8a5f-4c39-9d0e-2f1c7a1b9e55" }
```

`requestId` is the [request id](#request-ids) of the request (also in the `X-Request-Id` response header and in the
logged 5xx line), so a user can quote it in a bug report. The HTML page shows it as `Request ID: ...` and nothing
else is added. `code` is included when the error has one and its message is exposed. `stack` is added only when `NODE_ENV` is
`development` or `test`. If the response headers were already sent, the error is passed on to Express's default handler.

## Views

Core does not create its own Edge instance. It uses the shared `View` instance exported by
[`@averoa/utilities`](https://github.com/budiherma1/AveroaUtilities) (startup fails with a clear error if that export
is missing) and registers it once:

- `views` is `resources/views` and the default engine is `edge`;
- the entries returned (or resolved, if it is `async`) by `ViewProvider.global()` become Edge globals;
- `res.render` accepts dot notation: `res.render('users.list')` renders `resources/views/users/list.edge`. Slash
  paths and a trailing `.edge` also work;
- `csrfToken` is available in every view rendered with `res.render` while CSRF is enabled; it is only created (with
  its session) when the template prints it.

## Observability

### Request IDs

The first middleware gives every request an id:

- `req.id` in handlers, and the `X-Request-Id` response header (`REQUEST_ID_HEADER` renames it);
- `requestId` in JSON error bodies and in JSON access log lines;
- `requestId` on every `Log` line (`@averoa/utilities` 2.1+) written while the request is handled, across `await`,
  promises and timers, through an `AsyncLocalStorage` context. `currentRequestId()` returns it anywhere in that code.

An incoming `X-Request-Id` is reused only when it is **trusted** and **valid**; otherwise a new
`crypto.randomUUID()` is generated (and the incoming value is ignored, not echoed):

- trusted: `TRUST_REQUEST_ID=true`, or `TRUST_REQUEST_ID` unset and `TRUST_PROXY` set to anything but `false` / `0`
  (a proxy that sets or sanitises the header is expected in front of the app). `TRUST_REQUEST_ID=false` never trusts
  it, which also suits a proxy that passes the client's header through unchanged;
- valid: 1 to 128 characters from `A-Z a-z 0-9 - _ . : + = / @`.

The context is shared with `@averoa/utilities` through a global registered symbol, so it works even when the two
packages are different versions or installed twice. Core re-enters the context after the body parsers and after
the session middleware (`restoreRequestContext()`), which resume from callbacks of their own; do the same after
third-party middleware that loses it.

### Access log

| `LOG_CHANNEL` | Files (`storages/logs/access.log`, `error.log` for status >= 400) | stdout |
| --- | --- | --- |
| unset (default, as in 2.0) | yes | morgan `dev` unless `NODE_ENV` is `production` or `test` |
| `file` | yes | no |
| `stdout` | no (the directory is not created) | yes |
| `both` | yes | yes |

Files use `ACCESS_LOG_FORMAT` `combined` (default) or `json`. stdout uses `ACCESS_LOG_FORMAT` (`json`, `combined` or
`dev`); when it is unset, `json` unless `LOG_FORMAT=pretty` or `NODE_ENV` is `development` / `test` (then `dev`).
A JSON line:

```json
{"timestamp":"2026-11-16T09:30:00.000Z","level":"info","message":"GET /api/users 200","type":"access","requestId":"4b0d6c1e-8a5f-4c39-9d0e-2f1c7a1b9e55","method":"GET","path":"/api/users","status":200,"durationMs":12.402,"ip":"203.0.113.9","userAgent":"curl/8.7.1","contentLength":512}
```

`level` is `error` for 5xx (and requests that ended before a response), `warn` for 4xx, `info` otherwise. `path` has
no query string (it may carry tokens). `ip` is `req.ip`, so it is the client address from `X-Forwarded-For` only when
`TRUST_PROXY` is set. Health probes are not logged.

For containers, `LOG_CHANNEL=stdout` with `LOG_FORMAT=json` writes the access log and the application log as JSON
lines on stdout and nothing to disk.

### Health checks

| Probe | Path | Answer |
| --- | --- | --- |
| Liveness | `GET /health` (`HEALTH_PATH`) | always `200 {"status":"ok"}` while the process serves requests; no dependency is checked, so a database outage does not get the container restarted |
| Readiness | `GET /ready` (`READY_PATH`) | runs every check concurrently, each bounded by `READY_TIMEOUT` (2000 ms); `200` when every critical check is up, `503` otherwise; `503 {"status":"shutting_down"}` once a graceful shutdown started |

```json
{"status":"error","checks":{"database":{"status":"down","durationMs":2000.4,"error":"timeout"}}}
```

Both answer `GET` and `HEAD` with `Cache-Control: no-store` (other methods fall through to the app) and are mounted
before sessions, CSRF, the access log and `AppProvider.beginning()`. `error` is the check's message when `NODE_ENV` is
`development` or `test`, and only `timeout` or `failed` otherwise. A check that goes down (or comes back up) is
logged once at `warn` (`info`), not on every probe. Concurrent probes share one run of the checks.

Built-in checks (`READY_CHECKS`, default `database`):

- `database`: `select 1` (`select 1 from dual` on Oracle) on the knex instance of `@averoa/utilities`;
- `queue`: opens (or reuses) the shared RabbitMQ connection of `@averoa/utilities` (`RABBITMQ_SERVER` or
  `config/queue.js`). Opt in only if the web process needs the broker.

`AppProvider.health(checks)` customises the list. A check is a function `({ signal, timeout }) => any` (it fails when
it throws, rejects, times out or returns `false`; `signal` aborts on timeout) or `{ check, timeout?, critical? }`,
where `critical: false` reports the check without failing readiness:

```js
// app/Providers/AppProvider.js
health(checks) {
  return {
    ...checks,                                    // keep `database`
    redis: () => redisClient.ping(),              // fails readiness when Redis is down
    search: { check: () => pingSearch(), timeout: 500, critical: false },
  };
}
```

Return `false` to disable both endpoints, or delete a key to drop a built-in check. The `health` object returned by
`createApp()` / `start()` exposes `readiness()` (runs the checks), `markShuttingDown()`, `shuttingDown`,
`isHealthCheckPath(path)`, `livenessPath` and `readinessPath`.

## Graceful shutdown

`start()` (unless `handleSignals: false`) listens once for `SIGTERM` and `SIGINT`. On the first signal it:

1. makes `/ready` answer `503 {"status":"shutting_down"}` and, when `SHUTDOWN_DELAY` is set, keeps serving for that
   many milliseconds so load balancers and Kubernetes stop routing to the instance (`/health` stays `200`);
2. stops accepting connections (`server.close()`, then closes idle keep-alive connections) and waits for in-flight
   requests to finish;
3. awaits `AppProvider.shutdown()`;
4. closes the database (`destroy()` on the knex instance from `@averoa/utilities`), the queue (`closeQueue()`), the
   shared Redis client (`closeRedis()`) and the request log files (`closeLogStreams()`), waiting for all of them to
   settle;
5. exits with code `0`, or `1` if a step threw.

If steps 2 to 4 take longer than `SHUTDOWN_TIMEOUT` milliseconds (default 10000), the process exits with code `1`.
With Kubernetes, keep `terminationGracePeriodSeconds` above `SHUTDOWN_DELAY + SHUTDOWN_TIMEOUT`.

## CLI reference

The app's `averoa.js` calls `command()`, so the generators run as `node averoa.js <command>` from the project.

```text
Usage: averoa [options] [command]

CLI for AveroaJS

Options:
  -V, --version                     output the version number
  -h, --help                        display help for command

Commands:
  make:controller [options] <name>  create a controller
  make:middleware [options] <name>  create a middleware
  make:model [options] <name>       create a model
  make:helper [options] <name>      create a helper
  make:job [options] <name>         create a job
  make:repository [options] <name>  create a repository
  make:strategy [options] <name>    create a passport strategy
  make:crud [options] <tables>      create model, migration, seed, controller
                                    and routes for tables
  help [command]                    display help for command
```

| Command | Options | Writes (relative to the app root) |
| --- | --- | --- |
| `make:controller <name>` | `-f, --force` | `app/Controllers/<name>.js` |
| `make:middleware <name>` | `-f, --force` | `app/Middleware/<name>.js` |
| `make:model <name>` | `-f, --force`, `-t, --table <table>` | `app/Models/<name>.js`, export added to `app/Models/index.js` |
| `make:helper <name>` | `-f, --force` | `app/Helpers/<name>.js`, export added to `app/Helpers/index.js` |
| `make:job <name>` | `-f, --force` | `app/Jobs/<name>.js`, export added to `app/Jobs/index.js` |
| `make:repository <name>` | `-f, --force` | `app/Repositories/<name>.js`, export added to `app/Repositories/index.js` |
| `make:strategy <name>` | `-f, --force` | `app/Strategies/<name>.js`, export added to `app/Strategies/index.js` |
| `make:crud <tables>` | `-f, --force`, `-i, --init` | per table: model, migration, seed and controller, plus routes in `routes/api.js` |

Rules shared by every generator:

- `<name>` must be a JavaScript identifier (letters, digits, `_`, `$`; no path separators). It is used as the class
  and file name exactly as typed.
- Files are written under the app root, creating directories as needed. An existing file is never overwritten unless
  `--force` is given; without it the command stops with `<path> already exists (use --force to overwrite).`
- Index files get one `export { default as <Name> } from './<Name>.js';` line, appended only if it is not already
  there.
- Errors are printed in red and the process exits with code 1.

### What the templates generate

| Generator | Output |
| --- | --- |
| controller | A class with an `async index(req, res)` method; the file exports an instance. |
| middleware | A class with `handle(req, res, next)`; the file exports an instance. |
| model | A class extending `Model` from `@averoa/utilities` with `tableName`, `timestamp = true`, `hidden = []` and a sample `column` map (`id`, `email` with migration, seed and validation rules). The table defaults to the lower-cased name (`UserCategory` → `usercategory`); use `--table user_categories` to set it. |
| helper | A class with a static `sample()` method; the file exports the class. |
| job, repository | A class with a `sample()` method; the file exports an instance. |
| strategy | A class with `config()` (called once at startup; register your passport strategy there) and an `authenticate(req, res, next)` route middleware that runs `passport.authenticate('<name>', { session: false })` and responds `401 { status: false, message: 'Unauthorized' }` when no user is found. |

### `make:crud`

```bash
node averoa.js make:crud users,rooms,user_categories
```

`<tables>` is a comma-separated list of table names (letters, digits and underscores). For each table:

| Table | Model | Controller | Route prefix |
| --- | --- | --- | --- |
| `users` | `Users` | `UsersController` | `users` |
| `user_categories` | `UserCategories` | `UserCategoriesController` | `user-categories` |
| `userCategories` | `UserCategories` | `UserCategoriesController` | `userCategories` |

The model name comes from splitting the table name on `_` (and `-`) and upper-casing the first letter of each part;
the rest of each part is kept as typed, so inner capitals survive.

It writes, per table:

- `app/Models/<Model>.js` (with `tableName` set to the table) and the export in `app/Models/index.js`;
- `database/migrations/<timestamp>_<Model>.js`, whose `up`/`down` are the model's `migrationUp`/`migrationDown`;
- `database/seeds/<timestamp>_<Model>.js`, which seeds 10 rows through the model's `seeder`;
- `app/Controllers/<Model>Controller.js` with `create`, `findAll`, `findOne`, `update` and `delete` methods backed by
  `Crud` from `@averoa/utilities`. Each method answers with the Crud result as JSON and the status code from its
  `statusCode` (400 for a bad filter, 404 not found, 422 validation, 500 other errors); a failure
  (`status: false`) without one is `400`, and a success is `200`.

`<timestamp>` uses the knex `migrate:make` format, a 14-digit UTC `YYYYMMDDHHMMSS`, so generated migrations sort
together with ones made by `knex migrate:make`. Tables generated in one command are one second apart, in the order
given.

Then it registers the routes with `router.crud()` from `@averoa/routes`:

```js
router.crud('UserCategories', 'user-categories', () => {
  router.get('/', 'UserCategoriesController@findAll');
  router.get('/:id', 'UserCategoriesController@findOne');
  router.post('/', 'UserCategoriesController@create');
  router.put('/:id', 'UserCategoriesController@update');
  router.delete('/:id', 'UserCategoriesController@delete');
});
```

- Without `--init`, the blocks are inserted before the last `export default router;` line of the existing
  `routes/api.js`. A table whose `router.crud('<Model>', '<prefix>'` block is already there is skipped, so running
  the command again does not add a second block. The command fails if the file or that line is missing.
- With `--init`, a new `routes/api.js` containing only these routes is written; add `--force` if the file exists.

The generated migrations and seeds import models from `#models`, so the app's `package.json` needs an `imports` entry
such as `"#models": "./app/Models/index.js"` (the boilerplate has it).

Everything is checked before the first file is written: invalid names, existing files (without `--force`) and a
missing or unusable `routes/api.js` (without `--init`) stop the command with nothing changed, and the error lists
every file that is in the way. Running `make:crud` again for the same table with `--force` overwrites the generated
files, reuses the model's existing migration and seed file names instead of adding new ones, and leaves its route
block alone.

## Database migrations

`@averoa/core/knexfile` is a knexfile for the knex CLI. It exports the same configuration for the `development`,
`test`, `staging` and `production` environments.

```bash
npx knex migrate:latest   --knexfile node_modules/@averoa/core/knexfile.js --cwd .
npx knex migrate:rollback --knexfile node_modules/@averoa/core/knexfile.js --cwd .
npx knex migrate:make add_rooms --knexfile node_modules/@averoa/core/knexfile.js --cwd .
npx knex seed:run         --knexfile node_modules/@averoa/core/knexfile.js --cwd .
```

The boilerplate wraps these as `npm run migrate:up`, `migrate:down`, `migrate:list`, `migrate:make`, `seed:make` and
`seed:run`.

How the configuration is built:

1. `<app root>/.env` is loaded. The app root is found as described in the [overview](#overview), so it does not
   matter that knex changes the working directory to the knexfile's folder; `--cwd .` is optional.
2. Defaults come from the environment: `client` is `DB_CLIENT` or `mysql2`, and `connection` is built from `DB_HOST`,
   `DB_PORT`, `DB_USER`, `DB_PASS` and `DB_NAME`. For `sqlite3` / `better-sqlite3` it is `{ filename: DB_NAME }`
   (`:memory:` when `DB_NAME` is empty) with `useNullAsDefault: true`.
3. `config/database.js` is imported if it exists. Its default export may be an object or a function that receives
   `process` and returns one. Its top-level keys replace the defaults (`connection` is replaced as a whole, not
   merged).
4. `migrations.directory` and `seeds.directory` default to `database/migrations` and `database/seeds`. Relative
   values, including arrays of directories, are resolved against the app root.
5. For `sqlite3` / `better-sqlite3`, a relative `connection.filename` (from `config/database.js` or `DB_NAME`) is
   resolved against the app root, so the knex CLI opens the same file as the app even though it runs from
   `node_modules/@averoa/core`. `:memory:`, absolute paths and `file:` URIs are left as they are.

The knexfile is only used by the knex CLI. At runtime the app's database connection comes from `@averoa/utilities`.

## Testing

### This package

```bash
npm install
npm test        # node --test test/*.test.js
```

The suite uses the built-in `node:test` runner against a fixture app in `test/fixtures/app`, and covers the app
bootstrap, sessions, session-store selection, rate limiting, CSRF, CORS, uploads, the view engine, the error handler,
request ids, access logging, the health probes and graceful shutdown, the CLI generators and the knexfile
(including a real `knex migrate` run with `better-sqlite3`, a dev dependency).

`test/redis.integration.test.js` runs against a real Redis (sessions and rate-limit counters shared by two app
instances) and is skipped unless `AVEROA_TEST_REDIS_URL` is set:

```bash
docker run -d --rm --name averoa-redis -p 127.0.0.1:6479:6379 redis:7.4-alpine
AVEROA_TEST_REDIS_URL=redis://127.0.0.1:6479 npm test
docker stop averoa-redis
```

One test checks the `queue` readiness check against a real RabbitMQ and is skipped unless `AVEROA_TEST_AMQP_URL` is
set, e.g. `docker run -d --rm -p 25673:5672 rabbitmq:4.1-alpine` and
`AVEROA_TEST_AMQP_URL=amqp://127.0.0.1:25673 npm test`.

The repository's `.npmrc` sets `legacy-peer-deps=true`. To run the tests against local checkouts of
`../AveroaUtilities` and `../AveroaRoute` instead of the published versions, run `node scripts/link-siblings.mjs`
after every `npm install`.

GitHub Actions (`.github/workflows/ci.yml`) runs `npm test` on Node.js 20, 22 and 24 against the published sibling
packages (dev dependencies). `.github/workflows/release.yml` publishes to npm when a `vX.Y.Z` tag matching
`package.json` is pushed, after the same checks; it needs an `NPM_TOKEN` repository secret.

### Your application

`createApp()` builds the real app without listening, which makes it a good fit for HTTP tests. Set `AVEROA_ROOT` and
`NODE_ENV` before importing `@averoa/core`, because the app root and `.env` are resolved on import.

```js
// tests/app.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.NODE_ENV = 'test';
process.env.AVEROA_ROOT ??= process.cwd();

const { createApp, closeLogStreams, closeRedis } = await import('@averoa/core');
const { DB } = await import('@averoa/utilities');

const { app } = await createApp();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.close();
  await closeLogStreams();
  await closeRedis(); // only needed with a Redis store; otherwise a no-op
  await DB?.destroy?.();
});

test('unknown API routes return JSON 404', async () => {
  const res = await fetch(`${base}/api/does-not-exist`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).status, false);
});
```

With `NODE_ENV=test` the session cookie is not `secure` (so it works over plain HTTP) and the console request log is
off. Access and error logs are still written to `storages/logs/`. Calling `createApp()` in several test files or
tests reuses the same two log files instead of opening new handles each time; call `closeLogStreams()` in `after()`
to release them.

## Upgrading from 1.x

2.0.1 requires Node >= 20 (2.0.0 declared >= 18.17, but its peer `@averoa/utilities` 2.x needs 20), Express 5, `@averoa/utilities` ^2 and `@averoa/routes` ^3. The complete list of changes
is in [CHANGELOG.md](./CHANGELOG.md). The main breaking changes:

- **Peer dependencies.** `express`, `passport`, `objection`, `knex`, `edge.js`, `@averoa/utilities` and
  `@averoa/routes` must be installed by the app.
- **Express 5.** Rejected promises from handlers reach the error handler; `req.query` is read-only.
- **App root.** App files are found through `AVEROA_ROOT` or the nearest `package.json`, not `./../../../`. Providers
  come from the app's `app/Providers/index.js`, not from `@averoa/providers`.
- **API.** `start(options?)` resolves to `{ app, server }`; `createApp(options?)` is new.
- **Sessions.** The hard-coded secret is gone: `SESSION_SECRET` is required in production, `saveUninitialized` is
  `false`, and the cookie is `secure` unless `NODE_ENV` is `development` or `test`.
- **CSRF** is enabled (built in, replacing csurf) for web routes and for session-authenticated `/api` requests. Set
  `CSRF_ENABLED=false` to disable it.
- **helmet 8** is enabled with a CSP. Adjust it in `AppProvider.helmet(defaults)`.
- **Body parsing** uses `express.json` / `express.urlencoded` with `BODY_LIMIT` (body-parser removed).
- **Default 404 and error handlers** run after `AppProvider.end(app)`.
- **CORS** wildcards are strict, invalid entries throw at startup, disallowed origins get 403, and an empty
  whitelist only allows credentials in `development`/`test`.
- **Uploads** under `/upload` are sandboxed; non-image files are downloaded.
- **Views** use the shared `View` from `@averoa/utilities`, registered once at startup.
- **knexfile** uses absolute migration and seed directories; the default client is `mysql2`.
- **CLI** never overwrites without `--force`; `make:crud -init` became `--init`; `make:model` keeps the class name and
  takes `--table`; generated migrations and seeds import from `#models`.
- **Removed:** `graphql.js` / `graphql/`, `test.js`, and the `body-parser`, `csurf` and `@averoa/providers`
  dependencies.

## Related packages

| Package | Description | Links |
| --- | --- | --- |
| `@averoa/core` | App bootstrap, security middleware, `averoa` CLI, knexfile (this package) | [npm](https://www.npmjs.com/package/@averoa/core) · [repo](https://github.com/budiherma1/AveroaCore) |
| `@averoa/utilities` | Model, Crud, FilterSearch, DB, Mail, Queue, View, Log and app-path helpers | [npm](https://www.npmjs.com/package/@averoa/utilities) · [repo](https://github.com/budiherma1/AveroaUtilities) |
| `@averoa/routes` | Router with `Controller@method` handlers and `crud()` model hooks | [npm](https://www.npmjs.com/package/@averoa/routes) · [repo](https://github.com/budiherma1/AveroaRoute) |
| `averoajs` | The project boilerplate; start new apps here (not published to npm) | [repo](https://github.com/budiherma1/averoajs) |

Issues and pull requests are welcome at [github.com/budiherma1/AveroaCore](https://github.com/budiherma1/AveroaCore).
Please run `npm test` before opening a pull request.

## License

MIT © Budi Hermawan
