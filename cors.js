import cors from 'cors';

/**
 * CORS for AveroaJS.
 *
 * CORS_WHITELIST is a comma separated list of allowed origins:
 *
 *   https://app.example.com          exact origin (scheme + host [+ port])
 *   https://*.example.com            any subdomain of example.com over https
 *   *.example.com                    any subdomain of example.com, http or https
 *   *                                every origin
 *
 * `*.` is only accepted as a leading subdomain wildcard. It matches one or
 * more labels (a.example.com, a.b.example.com) but not the apex
 * (example.com) — list the apex separately if you need it. Every other
 * character is matched literally (dots, ports, ...).
 *
 * Requests without an Origin header (curl, server-to-server) and same-origin
 * requests (the app's own pages) are always allowed. Same-origin compares the
 * Origin's host and port with the request's Host header. The scheme is only
 * compared when TRUST_PROXY trusts a proxy (not unset/false/0): without it,
 * `req.protocol` is the proxy→app hop (http) and cannot be trusted behind a
 * TLS proxy.
 *
 * Empty CORS_WHITELIST:
 *   - NODE_ENV=development or test: every origin is allowed, with
 *     credentials (cookies).
 *   - any other NODE_ENV (production, staging, unset, ...): every origin is
 *     allowed but WITHOUT credentials (`Access-Control-Allow-Origin: *`).
 *     Browsers then never send cookies cross-origin, so a forgotten whitelist
 *     cannot expose sessions to other sites. Set CORS_WHITELIST to enable
 *     credentialed cross-origin requests.
 *
 * A disallowed origin gets HTTP 403.
 */

/**
 * True only for NODE_ENV=development or NODE_ENV=test. Every other value,
 * including unset, gets the production-safe behaviour (fail closed).
 */
export const isDevelopmentEnv = (env = process.env.NODE_ENV) => env === 'development' || env === 'test';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

const normalize = (origin) => origin.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Compile one whitelist entry into a matcher function `(origin) => boolean`.
 * Throws on an invalid pattern so mistakes surface at startup.
 */
export function compileOrigin(pattern) {
  const entry = normalize(pattern);
  if (!entry) throw new Error('CORS_WHITELIST contains an empty entry');

  if (entry === '*') return () => true;

  if (!entry.includes('*')) {
    return (origin) => normalize(origin) === entry;
  }

  const match = /^(?:(https?):\/\/)?\*\.([^*]+)$/.exec(entry);
  if (!match || !match[2] || match[2].startsWith('.')) {
    throw new Error(
      `Invalid CORS_WHITELIST entry "${pattern}": "*." is only allowed as a leading subdomain wildcard, e.g. "https://*.example.com"`,
    );
  }

  const scheme = match[1] ? escapeRegExp(match[1]) : 'https?';
  const rest = escapeRegExp(match[2]);
  const regex = new RegExp(`^${scheme}:\\/\\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+${rest}$`, 'i');
  return (origin) => regex.test(normalize(origin));
}

/** Parse a raw CORS_WHITELIST string into matcher functions (empty → null). */
export function parseWhitelist(raw) {
  const entries = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  return entries.map(compileOrigin);
}

/**
 * Build an origin checker. Returns `(origin) => boolean`.
 * With no whitelist every origin is allowed (see credentials rule above).
 */
export function createOriginChecker(raw) {
  const matchers = parseWhitelist(raw);
  return (origin) => {
    if (!origin) return true;
    if (!matchers) return true;
    return matchers.some((matches) => matches(origin));
  };
}

/**
 * Does TRUST_PROXY trust a proxy? Unset, empty, "false" and "0" do not (the
 * boilerplate ships TRUST_PROXY=false); anything else (true, a hop count, an
 * address list) does, and only then is `req.protocol` reliable.
 */
export function trustsProxy(value) {
  if (value === undefined || value === null || value === false) return false;
  const raw = String(value).trim().toLowerCase();
  return raw !== '' && raw !== 'false' && !/^0+$/.test(raw);
}

/**
 * Is `origin` the app's own origin for this request?
 *
 * Compares host + port of the Origin header with the request host
 * (`req.host`: the Host header, or X-Forwarded-Host when trusted). The scheme
 * is compared only when `compareScheme` is true (TRUST_PROXY trusts a proxy); otherwise
 * the default port of the Origin's own scheme is assumed for a Host header
 * without a port.
 */
export function isSameOrigin(req, origin, { compareScheme = false } = {}) {
  const host = req.host ?? req.get('host');
  if (!origin || !host) return false;
  let originUrl;
  let selfUrl;
  try {
    originUrl = new URL(origin);
    const scheme = compareScheme ? `${req.protocol}:` : originUrl.protocol;
    selfUrl = new URL(`${scheme}//${host}`);
  } catch {
    return false;
  }
  if (compareScheme && originUrl.protocol !== selfUrl.protocol) return false;
  return originUrl.host.toLowerCase() === selfUrl.host.toLowerCase();
}

/**
 * Create the CORS middleware.
 * @param {{ whitelist?: string, production?: boolean, trustProxy?: string }} [options]
 *   `production` defaults to "NODE_ENV is neither development nor test".
 *   `trustProxy` defaults to TRUST_PROXY; when it trusts a proxy the scheme is
 *   part of the same-origin check.
 */
export function createCors({
  whitelist = process.env.CORS_WHITELIST,
  production = !isDevelopmentEnv(),
  trustProxy = process.env.TRUST_PROXY,
} = {}) {
  const hasWhitelist = parseWhitelist(whitelist) !== null;
  const isAllowed = createOriginChecker(whitelist);
  const compareScheme = trustsProxy(trustProxy);

  // Not development/test and no whitelist: public, credential-less CORS.
  if (!hasWhitelist && production) {
    return cors({ origin: '*', credentials: false });
  }

  return cors((req, callback) => {
    const origin = req.get('origin');

    if (!origin || isSameOrigin(req, origin, { compareScheme }) || isAllowed(origin)) {
      callback(null, { origin: origin ? true : false, credentials: true });
      return;
    }

    const err = new Error('Origin not allowed by CORS');
    err.status = 403;
    err.expose = true;
    callback(err);
  });
}

export default createCors;
