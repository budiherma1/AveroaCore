# Changelog

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
