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
- [Errors and 404](#errors-and-404)
- [Views](#views)
- [Graceful shutdown](#graceful-shutdown)
- [CLI reference](#cli-reference)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Upgrading from 1.x](#upgrading-from-1x)
- [Related packages](#related-packages)
- [License](#license)

## Overview

`@averoa/core` turns an AveroaJS project folder into a running server. A single call to `start()` creates the Express 5
app, installs the middleware stack (request logging, helmet, CORS, body parsing, cookies, sessions, passport, CSRF),
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

Importing `@averoa/core` loads `<app root>/.env` as a side effect. Variables that already exist in `process.env` take
precedence over the file.

#### `start(options?)`

```ts
start(options?: {
  port?: number | string;      // default: APP_PORT, then 3000
  host?: string;               // listen hostname; default: all interfaces
  handleSignals?: boolean;     // default: true (graceful shutdown on SIGTERM/SIGINT)
  utilities?: object;          // module to use instead of importing @averoa/utilities
}): Promise<{ app: Express; server: http.Server }>
```

After the server is listening, `start()` logs `AveroaJS listening on <APP_HOST>:<port>`, calls
`AppProvider.server(server)` and, unless `handleSignals` is `false`, installs the
[graceful shutdown](#graceful-shutdown) handlers. A listen error (for example `EADDRINUSE`) rejects the promise.

#### `createApp(options?)`

```ts
createApp(options?: { utilities?: object }): Promise<{ app: Express }>
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
| `@averoa/core/morgan.js` | default: `(app, { env? }) => { accessLogStream, errorLogStream }`; `closeLogStreams()`, `getLogStreams()` |
| `@averoa/core/env.js` | default: `dotenv` (loads `<app root>/.env` on import) |

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
| `storages/logs/` | `access.log` and `error.log` (created automatically). Each file is opened once per process and shared by every `createApp()`; `closeLogStreams()` closes them and the next request reopens them. |
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
| 2 | `AppProvider.beginning(app)` | provider hook |
| 3 | morgan request logging (`storages/logs/access.log`, `error.log`, console) | `NODE_ENV` |
| 4 | helmet security headers | `AppProvider.helmet(defaults)` |
| 5 | CORS | `CORS_WHITELIST`, `NODE_ENV`, `TRUST_PROXY` |
| 6 | `express.json()` and `express.urlencoded({ extended: true })` | `BODY_LIMIT` |
| 7 | `cookie-parser` | |
| 8 | `express-session` | `SESSION_SECRET`, `AppProvider.session()` |
| 9 | `passport.initialize()` and `passport.session()` | |
| 10 | `config()` of every export of `app/Strategies/index.js` | your strategies |
| 11 | `Model.knex(...)` with `getDB()` (or `DB`) from `@averoa/utilities` | utilities' database config |
| 12 | Edge view engine, `ViewProvider.global()` globals and dot-notation `res.render` | `ViewProvider` |
| 13 | CSRF protection | `CSRF_ENABLED` |
| 14 | `routes/api.js` at `/api` | |
| 15 | `routes/web.js` at `/` | |
| 16 | `express.static(public/)` at `/` | |
| 17 | sandboxed `express.static(storages/upload/)` at `/upload` | `AppProvider.uploads()`, `UPLOAD_INLINE_EXTENSIONS` |
| 18 | `AppProvider.end(app)` | provider hook |
| 19 | 404 handler | |
| 20 | error handler | |

Consequences worth knowing:

- Middleware added in `AppProvider.beginning` runs before helmet, CORS, body parsing, sessions and CSRF.
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
| `session()` | during build | none | extra express-session options merged over the defaults (e.g. `{ store }`), or `undefined` |
| `uploads()` | during build | none | `{ inlineExtensions: string[] }`, `false` to not serve `/upload`, or `undefined` for the defaults |
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
    return { store: new RedisStore({ client: redisClient }), cookie: { maxAge: 86_400_000 } };
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
| `TRUST_PROXY` | unset | Express `trust proxy`: `true`, `false`, a hop count or an address/subnet list. Set it behind a TLS-terminating proxy. See [`parseTrustProxy`](#parsetrustproxyvalue). |
| `UPLOAD_INLINE_EXTENSIONS` | `jpg,jpeg,png,gif,webp,avif,bmp,ico` | Comma-separated extensions served inline from `/upload`; every other file is sent as a download. Case-insensitive, leading dots ignored. |
| `SHUTDOWN_TIMEOUT` | `10000` | Milliseconds before a forced `process.exit(1)` during graceful shutdown. `0` or a non-number falls back to the default. |
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
| 5xx error message | shown | shown | `Internal Server Error` | `Internal Server Error` |
| Stack trace in error responses | yes | yes | no | no |
| CSP `upgrade-insecure-requests` | no | no | yes | no |
| Console request log (morgan `dev`) | yes | no | no | yes |

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

A random development secret means sessions do not survive a restart. Outside development, use a real session store:
core logs a warning when `NODE_ENV` is neither `development` nor `test` and no `store` is configured.

A `secure` cookie is only sent over HTTPS. Behind a TLS-terminating proxy, set `TRUST_PROXY` so Express sees the
original protocol.

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
{ "status": false, "message": "Invalid or missing CSRF token", "code": "EBADCSRFTOKEN" }
```

`code` is included when the error has one and its message is exposed. `stack` is added only when `NODE_ENV` is
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

## Graceful shutdown

`start()` (unless `handleSignals: false`) listens once for `SIGTERM` and `SIGINT`. On the first signal it:

1. stops accepting connections (`server.close()`, then closes idle keep-alive connections) and waits for in-flight
   requests to finish;
2. awaits `AppProvider.shutdown()`;
3. closes the database (`destroy()` on the knex instance from `@averoa/utilities`), the queue (`closeQueue()`) and the
   request log files (`closeLogStreams()`), waiting for all of them to settle;
4. exits with code `0`, or `1` if a step threw.

If shutdown takes longer than `SHUTDOWN_TIMEOUT` milliseconds (default 10000), the process exits with code `1`.

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
bootstrap, sessions, CSRF, CORS, uploads, the view engine, the error handler, the CLI generators and the knexfile
(including a real `knex migrate` run with `better-sqlite3`, a dev dependency).

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

const { createApp, closeLogStreams } = await import('@averoa/core');
const { DB } = await import('@averoa/utilities');

const { app } = await createApp();
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.close();
  await closeLogStreams();
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
