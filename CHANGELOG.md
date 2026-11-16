# Changelog

## 2.3.1

### Fixed

- `make:test --http` and `make:job` generated a line longer than 100 characters, which the boilerplate's
  `npm run lint` rejected. The generator tests now check every generated file against that limit.

## 2.3.0

### Added

- **`@averoa/core/testing`**: `testApp()` builds the app, migrates and seeds the database and listens on a random
  port; `app.http()` sends JSON, forms and bearer tokens and times out instead of hanging; `close()` closes the
  server, database, queue, Redis and log streams. `fresh` (roll every migration back first) runs only with
  `NODE_ENV=test`. `fakeMail()` records direct and queued `Mail` sends. `client()` is the request function on its own.
- `make:test --http` generates a test built on `testApp()`.

## 2.2.0

### Added

- **New generators.** `make:policy` (a Gate policy; prints how to register it), `make:validator` (`validate()` rule
  sets for routes), `make:migration` (`--create <table>` / `--table <table>`) and `make:test` (a `node:test` file;
  `--http` starts the app on a random port).
- **`make:model --migration --seed`** also creates a migration built from the model's columns and a seeder. All files
  are checked before any is written.

### Fixed

- Generated files end with a newline, so they pass the boilerplate's `eslint` (`eol-last`) as generated.

## 2.1.1

### Changed

- **An incoming `X-Request-Id` is trusted only with `TRUST_REQUEST_ID=true`.** Before, `TRUST_PROXY` alone made it
  trusted, but common proxies (nginx, AWS ALB) pass a client's header through unchanged, so clients could pick the id
  that ends up in your logs. If your proxy sets or overwrites the header, set `TRUST_REQUEST_ID=true` to keep using
  its ids.

### Documentation

- A second `SIGTERM` / `SIGINT` during a graceful shutdown ends the process at once (Node.js default).

## 2.1.0

### Upgrade notes (behaviour changes)

- **`/api` is rate limited by default**: 100 requests per minute per client IP. Behind a proxy or load balancer set
  `TRUST_PROXY`, or every client shares the proxy's IP and one budget. `RATE_LIMIT_ENABLED=false` turns it off,
  `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` change it.
- **`GET /health` and `GET /ready` answer before your routes**, so an app route with one of those paths is no longer
  reached; move the probes with `HEALTH_PATH` / `READY_PATH` (or `off`). `/ready` checks the database by default,
  so an app without one answers 503 there until it sets `READY_CHECKS=none`.
- **Access logs leave out query strings** in every format (`combined` and `dev` too), so tokens in links such as
  `?token=` are not written to log files.

### Added

- **TypeScript declarations**: hand-written `.d.ts` files for every module (the runtime stays JavaScript), with
  `types` conditions in `exports` and a top-level `types`. They cover `createApp()` / `start()` and their results,
  the `AppProvider` / `ViewProvider` hook interfaces, rate limiting, the session store, Redis, request ids, health
  checks, the OpenAPI builders, the access log, CORS, CSRF, uploads, views, the CLI and the knexfile; `req.id` and
  `req.csrfToken()` are added to Express's `Request`. `@types/express` and `@types/node` are optional peer
  dependencies.
- `npm run typecheck` (strict `tsc` over the declarations and the type tests in `test/types/`), `npm run lint`
  (ESLint 10 flat config matching the AveroaJS app) and `npm run types:exports`; CI runs lint and typecheck before
  the tests. devDependencies `typescript`, `@types/express`, `@types/node`, `eslint`, `@eslint/js`, `globals`,
  `@stylistic/eslint-plugin`, `eslint-plugin-import-x`.
- **OpenAPI 3.1 document** at `GET /api/openapi.json`, built from the API router's `describe()` (`@averoa/routes`
  3.1.0), the Model `static column` definitions and `validate()` middleware (`@averoa/utilities`): paths with
  `{param}` syntax, standard CRUD operations for `crud()` routes with the FilterSearch query parameters and the
  `{ status, metadata, data }` envelope, model schemas (types from migration hints, required flags, hidden columns
  excluded, upload columns as binary in multipart bodies), a JWT bearer scheme for routes behind `AuthMiddleware`,
  and per-route `.doc({...})` metadata.
- **Swagger UI page** at `GET /api/docs` (Swagger UI 5.34.1 from jsDelivr, pinned with SRI) with its own CSP (nonce,
  no `unsafe-eval`); the app-wide helmet CSP is unchanged.
- `OPENAPI_ENABLED` (default: on for `NODE_ENV` development/test only) and `OPENAPI_UI` (default on).
- `AppProvider.openapi(doc, { routes })` to customise the document.
- Exports `buildOpenApiDocument`, `createOpenApiDocument`, `modelSchemas`, `isOpenApiEnabled`; module
  `@averoa/core/openapi.js`.
- devDependencies `@seriousme/openapi-schema-validator` (the tests validate the generated document) and `zod`.
- **Redis session store.** `SESSION_STORE=redis` (with `REDIS_URL`) stores sessions with `connect-redis`;
  `SESSION_REDIS_PREFIX` (default `sess:`) and `SESSION_TTL` (seconds, default 86400) configure it. `memory` stays the
  default. A `store` returned by `AppProvider.session()` still wins (core then does not connect to Redis).
- **Rate limiting** with `express-rate-limit` (new dependency). A global limiter is mounted on `/api` before body
  parsing and sessions: `RATE_LIMIT_MAX` (default 100) requests per `RATE_LIMIT_WINDOW_MS` (default 60000) per client
  IP, `RATE_LIMIT_ENABLED=false` turns it off, `AppProvider.rateLimit(defaults)` customises it (`false` disables it,
  `path` moves it). Limiters send the IETF draft-8 `RateLimit` / `RateLimit-Policy` headers and `Retry-After`; over
  the limit the error handler answers `429` with `{ status: false, message, code: 'ERATELIMIT' }` (JSON for `/api`
  and JSON clients, HTML otherwise). The client IP follows `TRUST_PROXY`.
- **`rateLimit(options)`** factory (exported from `@averoa/core` and `@averoa/core/rate-limit.js`, with
  `ipKeyGenerator`) for stricter per-route limits, e.g. on a login route. `name` keeps each limiter's counters apart
  in a shared store.
- **Shared Redis store for rate limits.** `RATE_LIMIT_STORE=redis` (the default when `SESSION_STORE=redis`) keeps
  counters in Redis with `rate-limit-redis`, so they are shared by every instance; `RATE_LIMIT_REDIS_PREFIX` (default
  `rl:`) sets the key prefix.
- **One shared Redis client** per `REDIS_URL` (`getRedisClient()`, `closeRedis()`), used by both stores and available
  to the app. `start()` closes it on graceful shutdown. `REDIS_CONNECT_TIMEOUT` (default 5000 ms) bounds the startup
  connection.
- `redis`, `connect-redis` and `rate-limit-redis` are **optional peer dependencies**, imported only when a Redis
  store is selected; a missing package stops startup with a message naming the `npm install` to run.

### Security

- **Redis stores fail closed at startup.** When a Redis store is selected and Redis is unreachable within
  `REDIS_CONNECT_TIMEOUT`, `createApp()` / `start()` reject unless `NODE_ENV` is `development` or `test` (there a
  warning is logged and the client keeps reconnecting; there is no silent fallback to memory). The Redis password is
  redacted in every log and error message. The offline queue is disabled, so requests fail fast while Redis is down
  instead of hanging.
- **Invalid settings fail startup**: an unknown `SESSION_STORE` / `RATE_LIMIT_STORE`, or a non-positive-integer
  `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `SESSION_TTL` or `REDIS_CONNECT_TIMEOUT`.
- The MemoryStore warning now points to `SESSION_STORE=redis`.

### Added (observability)

- **Request IDs.** A new first middleware sets `req.id`, the `X-Request-Id` response header and an
  `AsyncLocalStorage` request context, so `Log` lines from `@averoa/utilities` (2.1+) include `requestId` anywhere in
  the request. An incoming `X-Request-Id` is reused only when trusted (`TRUST_REQUEST_ID=true`, or `TRUST_PROXY` set
  and `TRUST_REQUEST_ID` unset) and valid (1-128 characters of `A-Za-z0-9-_.:+=/@`); otherwise a UUID is generated.
  `REQUEST_ID_HEADER` renames the header. New exports `requestId`, `restoreRequestContext`, `requestContext`,
  `currentRequestId`, `isValidRequestId`, `trustIncomingRequestId` (also `@averoa/core/request-id.js`).
- **Error responses carry the request id**: `requestId` in JSON error bodies, `Request ID: ...` on the HTML error
  page (nothing else is added to production pages).
- **Health endpoints.** `GET /health` (liveness, always 200, no dependencies) and `GET /ready` (readiness: database
  `select 1` with `READY_TIMEOUT`, optional `queue` check via `READY_CHECKS`, 503 with per-check status). Mounted
  before `AppProvider.beginning()`, sessions, CSRF and the access log. `HEALTH_PATH` / `READY_PATH` move or disable
  them. New `AppProvider.health(checks)` hook to add, remove or disable checks. New exports `createHealth`,
  `healthSettings` (also `@averoa/core/health.js`).
- **Readiness flips to 503 on shutdown** before the server closes; `SHUTDOWN_DELAY` (default 0) keeps serving for
  that long so load balancers can drain the instance. `SHUTDOWN_TIMEOUT` now counts from the end of that delay.
- **Access log options.** `LOG_CHANNEL=stdout|file|both` (stdout writes no files: containers) and
  `ACCESS_LOG_FORMAT=combined|json|dev`. JSON lines hold timestamp, level, requestId, method, path (no query string),
  status, durationMs, ip (`req.ip`, honours `TRUST_PROXY`), userAgent and contentLength. Unset `LOG_CHANNEL` keeps
  the 2.0 behaviour (combined `access.log` / `error.log`, `dev` console outside production and test). New exports
  `accessLogSettings`, `jsonAccessFormat`.
- `start()` also resolves `health` and `close()` (graceful shutdown without `process.exit`, resolves the exit code);
  `createApp()` also resolves `health`.

### Changed

- **Removed the repository `.npmrc` (`legacy-peer-deps=true`).** `@averoa/utilities` and `@averoa/routes` are
  published, so `npm install` now installs the peer dependencies normally and the tests run against the released
  siblings. `node scripts/link-siblings.mjs` still swaps in local checkouts. Development only; the published package
  is unchanged.
- **`make:job` generates a background job**: a class extending `Job` from `@averoa/utilities` (with `tries`,
  `backoff`, `timeout`, `handle(payload, context)` and `failed(payload, error, context)`), exported as the class
  instead of an instance with a `sample()` method. It needs the `Job` export of `@averoa/utilities` (added after
  2.0.2).

### Fixed (review before release)

- **Graceful shutdown with keep-alive clients.** During shutdown every response carries `Connection: close`, and
  connections still open at `SHUTDOWN_TIMEOUT` are closed. Before, a proxy reusing one keep-alive connection kept the
  server open until the timeout, so `AppProvider.shutdown()` and the database/queue/Redis cleanup never ran.
- **A stalled Redis no longer hangs requests.** Session and rate-limit store commands give up after
  `REDIS_COMMAND_TIMEOUT` ms (default 2000) and the request fails with a 500; node-redis itself only times out
  commands that were not sent yet. New exports `withTimeout`, `timeoutClient`, `RedisTimeoutError`,
  `redisCommandTimeout` (`@averoa/core/redis.js`).
- **An invalid `REDIS_URL` error no longer carries the URL** (password included) in its `cause`.
- **`rate-limit-redis` is only required when a Redis-backed limiter is used**: `SESSION_STORE=redis` with
  `RATE_LIMIT_ENABLED=false` no longer needs it.
- **Swagger UI page CSP** allows only the pinned Swagger UI script, not all of `cdn.jsdelivr.net`.
- **Release workflow** only publishes tags that point at a commit on `main`.

## 2.0.1

### Security

- **Error details fail closed.** Stack traces and 5xx messages are now shown only when `NODE_ENV` is `development` or
  `test`. Before, they were shown whenever `NODE_ENV` was not `production`, including `staging` and an unset
  `NODE_ENV`. Every other value now gets `Internal Server Error` and no `stack`, like production.
- **`SESSION_SECRET` is required unless `NODE_ENV` is `development` or `test`.** Before, it was only required for
  `NODE_ENV=production`, so `staging` or an unset `NODE_ENV` silently used a random per-boot secret. The MemoryStore
  warning follows the same rule. Set `SESSION_SECRET`, or `NODE_ENV=development` for local work.
- **`CORS_WHITELIST=*` no longer reflects origins with credentials.** An origin allowed only by `*` now gets
  `Access-Control-Allow-Origin: *` without `Access-Control-Allow-Credentials`, in every environment, so browsers
  don't send cookies. Origins matching another entry (e.g. `https://app.example.com,*`) and same-origin requests are
  still reflected with credentials; such responses carry `Vary: Origin`.

### Fixed

- **`make:crud` is atomic.** Every target file, a missing `routes/api.js` (without `--init`) and a `routes/api.js`
  without `export default router;` are checked before anything is written; the command now fails with a clear message
  (listing every existing file) instead of writing some files and then failing with a raw `ENOENT`.
- **`make:crud` is idempotent.** A `router.crud('<Model>', '<prefix>'` block that is already in `routes/api.js` is not
  appended again, and with `--force` a model's existing migration and seed files are overwritten instead of new ones
  being added. Duplicate table names in the list are ignored.
- **`titleCase` keeps inner capitals**: `userCategories` → `UserCategories` (was `Usercategories`). snake_case and
  kebab-case still become PascalCase.
- **`ViewProvider.global()` is awaited**, so an `async global()` registers its globals (it registered nothing).
  A synchronous `global()` works as before.
- **Request log streams no longer leak.** `storages/logs/access.log` and `error.log` are opened once per process and
  shared by every `createApp()` call, instead of two new streams per call that were never closed. New
  `closeLogStreams()` (exported from `@averoa/core` and `@averoa/core/morgan.js`) closes them; `start()` calls it on
  graceful shutdown. A request after that reopens them.
- **`averoa --version`** reads the version from `package.json` (it was hard-coded).
- **Rendering a view no longer always creates a session.** `res.locals.csrfToken` was an enumerable getter, so
  Express evaluated it on every `res.render`, which created the CSRF token, saved the session and set a cookie even
  for anonymous GETs of pages without a form. It is now non-enumerable, and views get a lazy `csrfToken` that only
  becomes the token when the template prints it. `{{ csrfToken }}` works as before; `req.csrfToken()` and
  `res.locals.csrfToken` still return the string in handlers.
- **Controllers generated by `make:crud` send Crud's status code.** They answered `200` even when `Crud` returned
  `status: false`. They now respond with `result.statusCode` (added to every Crud error result by
  `@averoa/utilities` 2.0.2: 400, 404, 422, 500), `400` for a failure without one, and `200` otherwise.
  Existing generated controllers are not changed; regenerate them with `--force` or copy the `send()` helper.
- **`make:crud` migration and seed names use the knex timestamp format** (14-digit UTC `YYYYMMDDHHMMSS`, as
  `knex migrate:make`), instead of 13-digit milliseconds that always sorted before knex-made migrations. Tables
  generated together are one second apart, in the order given.
- **knexfile: relative SQLite filenames resolve against the app root.** The knex CLI runs from
  `node_modules/@averoa/core`, so a relative `connection.filename` (or `DB_NAME`) pointed inside `node_modules` for
  the migrate/seed scripts. `:memory:`, absolute paths and `file:` URIs are unchanged. Without a connection in
  `config/database.js`, `DB_CLIENT=sqlite3` / `better-sqlite3` now builds `{ filename: DB_NAME || ':memory:' }` with
  `useNullAsDefault: true` instead of a host/port connection.

### Changed

- `engines.node` is now `>=20`, matching the peer `@averoa/utilities` 2.x (which requires Node 20 for nodemailer 10).

## 2.0.0

Requires Node >= 18.17, Express 5, `@averoa/utilities` ^2 and `@averoa/routes` ^3.

### Breaking changes

- **Peer dependencies.** `express` ^5, `passport` ^0.7, `objection` ^3, `knex` ^3, `edge.js` ^5,
  `@averoa/utilities` ^2 and `@averoa/routes` ^3 are now `peerDependencies`: the app installs them,
  so the app and the framework share one copy.
- **Express 5.** Handlers may return rejected promises; they reach the error handler.
  Don't mutate `req.query` (it's a getter in Express 5).
- **App code is located through the app root**, not `./../../../`. The root is `AVEROA_ROOT`, or
  the nearest `package.json` above the working directory that isn't inside `node_modules`.
  `routes/api.js`, `routes/web.js`, `app/Strategies/index.js` and `app/Providers/index.js` are all
  optional. Providers come from the app's `app/Providers/index.js`, not from `@averoa/providers`.
- **`start(options?)` returns `Promise<{ app, server }>`.** The port is `options.port`, then `APP_PORT`, then 3000.
  The new `createApp(options?)` builds the app without listening (used by tests).
- **Sessions.** The hard-coded `"secret"` is gone. In production `SESSION_SECRET` is required, and
  startup throws without it. A comma-separated list rotates secrets. In development a random
  secret is generated on each boot, with a warning. The cookie is `httpOnly`, `sameSite: 'lax'`,
  and `secure` unless `NODE_ENV` is `development` or `test` (set `TRUST_PROXY` behind a TLS proxy). `saveUninitialized` is now `false`.
  `AppProvider.session()` may return extra options (e.g. `store`). A warning is logged when production uses the MemoryStore.
- **CSRF protection is on for web routes** (everything outside `/api`; `/api` only for
  cookie-authenticated calls, see Security). csurf (deprecated) is
  replaced by a built-in session synchronizer token. Forms send `_csrf` (views get `csrfToken`),
  AJAX sends the `x-csrf-token` header (`req.csrfToken()` returns the token). Multipart forms must use
  the header, because they're parsed after the CSRF check. Requests that fail the check get 403 with `code: 'EBADCSRFTOKEN'`.
  Set `CSRF_ENABLED=false` to disable it.
- **helmet 8 is enabled** with a CSP for local assets plus Google Fonts. Override or extend it with
  `AppProvider.helmet(defaults)`: return an options object, or `false` to disable helmet.
- **Body parsing** uses `express.json` / `express.urlencoded` (body-parser was removed), with a size limit of
  `BODY_LIMIT` (default `1mb`). Larger bodies get 413.
- **Default 404 and error handler** run after `AppProvider.end(app)`. Responses are JSON for `/api`, XHR or
  JSON-accepting requests (`{ status: false, message }`) and a small HTML page otherwise. The stack is shown outside
  production only. In production, 5xx messages are replaced with `Internal Server Error`.
  5xx errors are logged through `@averoa/utilities` `Log`. `err.status` / `err.statusCode` are respected (e.g. multer 413/400).
- **CORS.** Wildcards are compiled once with every regex character escaped. `*.` is only valid as a
  leading subdomain wildcard and matches subdomains but not the apex. Invalid entries throw at startup.
  Same-origin requests are always allowed. Disallowed origins get 403 instead of 500.
  With an empty `CORS_WHITELIST`, every origin is allowed **without credentials** unless `NODE_ENV` is
  `development` or `test`, where every origin is still allowed with credentials (see Security).
- **Views.** Core no longer creates its own Edge instance (it was cache-off and re-registered and
  re-mounted on every request). It uses the shared `View` from `@averoa/utilities`. The engine and
  `ViewProvider.global()` are registered once at startup. Dot notation (`res.render('users.list')`) still works.
- **knexfile.** `.env` and `config/database.js` are loaded from the app root. Migration and seed
  directories are absolute, so `knex --knexfile node_modules/@averoa/core/knexfile.js` works with
  or without `--cwd .`. The default client is now `mysql2`.
- **CLI (`averoa make:*`).** Templates are resolved from the package itself. Files are written under the
  app root and never overwritten unless `--force` is given. Names must be JavaScript identifiers, with no path
  separators. `make:crud -init` is now `make:crud --init` (and needs `--force` if `routes/api.js`
  exists). `make:model` keeps the class name as typed (it used to lower-case it); `--table` sets
  the table. Generated migrations and seeds import models from `#models`, so the app needs the
  `imports` map in its package.json. The strategy template now actually invokes `passport.authenticate()`.
- **Removed:** `graphql.js` and `graphql/` (they used the undeclared, end-of-life
  `apollo-server-express` / `apollo-server-core`; use `@apollo/server` from the app if you need
  GraphQL). Also removed: `test.js`, and the `body-parser`, `csurf` and `@averoa/providers` dependencies.

### Security

- **Uploads are no longer served as active content.** `/upload` (from `storages/upload`) now sends
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and
  `Content-Disposition: attachment` for every file except raster images (`jpg`, `jpeg`, `png`, `gif`,
  `webp`, `avif`, `bmp`, `ico`). SVG, HTML, JS and extension-less files are downloaded, not rendered,
  so an uploaded file can't run script on the app's origin. Change the inline list with
  `UPLOAD_INLINE_EXTENSIONS` (comma separated, e.g. `jpg,png,pdf`) or
  `AppProvider.uploads()` → `{ inlineExtensions: [...] }` (wins over the env var); return `false`
  to not serve `/upload` at all.
- **CSRF on cookie-authenticated `/api` calls.** CSRF now runs before both routers. `/api` requests
  are checked when they are authenticated by the session cookie (`req.session.passport.user` is set)
  and carry no `Authorization` header. Token-only API clients and anonymous calls are unaffected.
  A browser SPA that logs in with the session must send the `x-csrf-token` header on
  POST/PUT/PATCH/DELETE. `req.csrfToken()` / `res.locals.csrfToken` are available on `/api` too, so
  expose it with a route such as
  `router.get('/csrf-token', (req, res) => res.json({ token: req.csrfToken() }))`.
  Multipart (`*Form`) API routes must use the header, not a `_csrf` field.
- **CORS and the session cookie fail closed outside development/test.** The permissive behaviour
  (every origin reflected with credentials when `CORS_WHITELIST` is empty, non-`secure` session
  cookie) now applies only when `NODE_ENV` is `development` or `test`. Any other value (`production`,
  `staging`, unset, ...) behaves like production: no credentialed CORS without a whitelist, and a
  `secure` session cookie (which express-session only sends over HTTPS, or behind a proxy with
  `TRUST_PROXY` set). Set `NODE_ENV=development` for local work over plain http.
- **Same-origin CORS check behind a TLS proxy.** The app's own origin is detected by comparing the
  Origin's host and port with the request's `Host` (or a trusted `X-Forwarded-Host`). The scheme is
  only compared when `TRUST_PROXY` trusts a proxy (it is not unset, `false` or `0`), because without it
  `req.protocol` is the proxy→app hop (`http`). Previously the app's own `https://` pages got 403
  from their own API once a `CORS_WHITELIST` was set. Set `TRUST_PROXY` (e.g. `1` or `true`) behind
  a TLS-terminating proxy so the scheme, `req.secure` and secure cookies work.
- `Model.knex()` is bound to `getDB()` when `@averoa/utilities` exports it, otherwise to `DB`.

### Added

- `createApp(options)`, graceful shutdown on SIGTERM/SIGINT (`server.close`, `DB.destroy()`,
  `closeQueue()`, optional `AppProvider.shutdown()`, forced exit after `SHUTDOWN_TIMEOUT` ms).
- Env vars: `SESSION_SECRET`, `CSRF_ENABLED`, `BODY_LIMIT`, `TRUST_PROXY`, `SHUTDOWN_TIMEOUT`,
  `UPLOAD_INLINE_EXTENSIONS`.
- `AppProvider.uploads()` hook (see Security).
- `storages/logs` is created automatically.
- Tests (`npm test`, built-in `node:test`).
