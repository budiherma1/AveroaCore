import type { Request, RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Request {
      /** The session's CSRF token (created on first use); set by `csrfProtection()`. */
      csrfToken(): string;
    }
  }
}

/**
 * A value that becomes the CSRF token when converted to a string (template
 * output, string concatenation, JSON).
 */
export class LazyCsrfToken {
  constructor(get: () => string);
  toString(): string;
  valueOf(): string;
  toJSON(): string;
  [Symbol.toPrimitive](): string;
}

export interface CsrfProtectionOptions {
  /** Path prefixes that are never checked (default `[]`). */
  skip?: string[];
  /** Path prefixes checked only for session-authenticated requests (default `['/api']`). */
  sessionOnly?: string[];
}

/** Authenticated through the session cookie (passport) and without an Authorization header? */
export function isSessionAuthenticated(req: Request): boolean;
/**
 * Session synchronizer-token CSRF protection. Adds `req.csrfToken()` and
 * `res.locals.csrfToken`; views rendered with `res.render` get `csrfToken`.
 */
export function csrfProtection(options?: CsrfProtectionOptions): RequestHandler;

export default csrfProtection;
