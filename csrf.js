import crypto from 'crypto';

/**
 * Session synchronizer-token CSRF protection (replaces the deprecated csurf).
 *
 * - One random token per session, stored in `req.session.csrfToken`.
 * - Available to handlers as `req.csrfToken()` (same name csurf used) and
 *   `res.locals.csrfToken`, and to views rendered with `res.render` as
 *   `csrfToken`. The token is created lazily, the first time it is read, so
 *   pages that never print it don't create a session (and set no cookie).
 *   Express spreads `res.locals` into the render options and Edge copies its
 *   state, so a getter there would fire on every render. Instead
 *   `res.locals.csrfToken` is a non-enumerable getter (not copied), and
 *   `res.render` passes views a lazy value that turns into the token only
 *   when the template prints it (`{{ csrfToken }}`).
 * - Safe methods (GET, HEAD, OPTIONS) pass. Every other method must send the
 *   token in the body field `_csrf` or the `x-csrf-token` header, compared in
 *   constant time. Failure → HTTP 403 with `code: 'EBADCSRFTOKEN'`.
 * - Paths under `skip` prefixes are ignored entirely.
 * - Paths under `sessionOnly` prefixes (core passes '/api') are checked only
 *   when the request is authenticated by the session cookie
 *   (`req.session.passport.user` is set) AND carries no `Authorization`
 *   header. Token-only API clients are unaffected; a browser SPA that logs in
 *   with the session must send `x-csrf-token` on unsafe requests. The token
 *   is available there too, through `req.csrfToken()` / `res.locals.csrfToken`
 *   (e.g. `router.get('/csrf-token', (req, res) => res.json({ token: req.csrfToken() }))`).
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * A value that becomes the CSRF token when it is converted to a string
 * (template output, string concatenation, JSON). Copying it around (Express
 * locals, Edge state) does not create the token.
 */
export class LazyCsrfToken {
  #get;

  constructor(get) {
    this.#get = get;
  }

  toString() {
    return this.#get();
  }

  valueOf() {
    return this.#get();
  }

  toJSON() {
    return this.#get();
  }

  [Symbol.toPrimitive]() {
    return this.#get();
  }
}

function tokensMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function csrfError() {
  const err = new Error('Invalid or missing CSRF token');
  err.status = 403;
  err.expose = true;
  err.code = 'EBADCSRFTOKEN';
  return err;
}

const underPrefix = (urlPath, prefix) => urlPath === prefix || urlPath.startsWith(`${prefix}/`);

/** Authenticated through the session cookie (passport), not a token header? */
export const isSessionAuthenticated = (req) => req.session?.passport?.user != null
  && !req.get('authorization');

/**
 * @param {{ skip?: string[], sessionOnly?: string[] }} [options]
 */
export function csrfProtection({ skip = [], sessionOnly = ['/api'] } = {}) {
  return function csrf(req, res, next) {
    const urlPath = (req.originalUrl || req.url).split('?')[0];
    if (skip.some((prefix) => underPrefix(urlPath, prefix))) return next();
    const lenient = sessionOnly.some((prefix) => underPrefix(urlPath, prefix));

    if (!req.session) {
      if (lenient) return next(); // no session → cannot be cookie-authenticated
      return next(new Error('CSRF protection requires express-session to run first'));
    }

    const getToken = () => {
      if (!req.session.csrfToken) req.session.csrfToken = newToken();
      return req.session.csrfToken;
    };

    req.csrfToken = getToken;
    // Non-enumerable: Express spreads res.locals on render, which would call
    // an enumerable getter (and create a session) for every rendered page.
    Object.defineProperty(res.locals, 'csrfToken', {
      get: getToken,
      enumerable: false,
      configurable: true,
    });

    // Views get a lazy value instead (an explicit `csrfToken` option wins).
    const lazy = new LazyCsrfToken(getToken);
    const { render } = res;
    res.render = function renderWithCsrf(view, options, callback) {
      if (typeof options === 'function') {
        callback = options; // eslint-disable-line no-param-reassign
        options = undefined; // eslint-disable-line no-param-reassign
      }
      const opts = options && typeof options === 'object' ? options : {};
      const withToken = Object.hasOwn(opts, 'csrfToken') ? opts : { csrfToken: lazy, ...opts };
      return render.call(this, view, withToken, callback);
    };

    if (SAFE_METHODS.has(req.method)) return next();
    if (lenient && !isSessionAuthenticated(req)) return next();

    const sent = req.body?._csrf ?? req.get('x-csrf-token');
    if (!tokensMatch(req.session.csrfToken, sent)) return next(csrfError());

    return next();
  };
}

export default csrfProtection;
