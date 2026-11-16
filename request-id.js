import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request ids.
 *
 * Every request gets an id: `req.id`, the `X-Request-Id` response header, the
 * JSON error body (`requestId`), the JSON access log line, and every Log line
 * written while the request is handled (through an AsyncLocalStorage context).
 *
 * An incoming `X-Request-Id` is reused only when it is trusted and valid:
 *  - trusted: TRUST_REQUEST_ID=true, or TRUST_REQUEST_ID unset and TRUST_PROXY
 *    set (to anything but false), i.e. a proxy in front of the app that is
 *    expected to set or sanitise the header. TRUST_REQUEST_ID=false never
 *    trusts it.
 *  - valid: 1 to 128 characters from `A-Z a-z 0-9 - _ . : + = / @`.
 * Otherwise a new id is generated with crypto.randomUUID().
 */

/**
 * The context storage. Shared with @averoa/utilities (Log) through a global
 * registered symbol, so both packages see the same request context even when
 * they are different versions or installed twice.
 */
const KEY = Symbol.for('averoa.requestContext');
export const requestContext = globalThis[KEY] ?? new AsyncLocalStorage();
if (!globalThis[KEY]) {
  Object.defineProperty(globalThis, KEY, { value: requestContext, enumerable: false });
}

/** The request id of the current request context, or undefined. */
export const currentRequestId = () => requestContext.getStore()?.requestId;

export const REQUEST_ID_MAX_LENGTH = 128;
const VALID_ID = /^[A-Za-z0-9\-_.:+=/@]+$/;

/** True for a usable incoming request id (length and charset limits). */
export function isValidRequestId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= REQUEST_ID_MAX_LENGTH
    && VALID_ID.test(value);
}

const envFlag = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
};

/**
 * Whether an incoming request id header is trusted: only with
 * TRUST_REQUEST_ID=true. Common proxies (nginx, AWS ALB) pass a client's
 * X-Request-Id through unchanged, so TRUST_PROXY alone is no reason to trust it.
 */
export function trustIncomingRequestId(env = process.env) {
  return envFlag(env.TRUST_REQUEST_ID) === true;
}

const CONTEXT = Symbol('averoa.requestContextStore');

/**
 * Middleware: assigns `req.id`, sets the response header and runs the rest of
 * the stack inside the request context.
 *
 * @param {object}  [options]
 * @param {string}  [options.header]    header name (default REQUEST_ID_HEADER or X-Request-Id)
 * @param {boolean} [options.trust]     trust the incoming header (default trustIncomingRequestId())
 * @param {() => string} [options.generate] id generator (default crypto.randomUUID)
 */
export function requestId({
  header = process.env.REQUEST_ID_HEADER || 'X-Request-Id',
  trust = trustIncomingRequestId(),
  generate = () => crypto.randomUUID(),
} = {}) {
  return function averoaRequestId(req, res, next) {
    const incoming = trust ? req.get(header) : undefined;
    const id = isValidRequestId(incoming) ? incoming : generate();
    req.id = id;
    res.setHeader(header, id);
    const store = { requestId: id };
    req[CONTEXT] = store;
    requestContext.run(store, next);
  };
}

/**
 * Middleware: re-enters the request context of `req`. Some middleware resumes
 * from callbacks that are not tied to the request (stream events of body
 * parsers, session store callbacks), which loses the AsyncLocalStorage
 * context; core mounts this after them.
 */
export function restoreRequestContext() {
  return function averoaRestoreRequestContext(req, res, next) {
    const store = req[CONTEXT];
    if (!store || requestContext.getStore() === store) return next();
    return requestContext.run(store, next);
  };
}

export default requestId;
