import type { Request, RequestHandler } from 'express';

/** Matches an Origin header value. */
export type OriginMatcher = (origin: string) => boolean;

export interface CreateCorsOptions {
  /** Comma-separated allowed origins (default CORS_WHITELIST). */
  whitelist?: string;
  /** Default: NODE_ENV is neither development nor test. */
  production?: boolean;
  /** Default TRUST_PROXY; when it trusts a proxy the scheme is part of the same-origin check. */
  trustProxy?: string | boolean | number;
}

/** True only for NODE_ENV development or test. */
export function isDevelopmentEnv(env?: string): boolean;
/** Compile one whitelist entry into a matcher; throws on an invalid pattern. */
export function compileOrigin(pattern: string): OriginMatcher;
/** Parse a raw CORS_WHITELIST string into matchers (`null` when empty). */
export function parseWhitelist(raw: string | null | undefined): OriginMatcher[] | null;
/** Credentialed matchers (every entry except `*`) and whether `*` is present; `null` when empty. */
export function parseWhitelistEntries(
  raw: string | null | undefined,
): { matchers: OriginMatcher[]; allowAll: boolean } | null;
/** `(origin) => boolean`: is the origin allowed at all. */
export function createOriginChecker(raw: string | null | undefined): (origin: string | null | undefined) => boolean;
/** Does TRUST_PROXY trust a proxy (anything but unset, empty, `false` and `0`)? */
export function trustsProxy(value: unknown): boolean;
/** Is `origin` the app's own origin for this request? */
export function isSameOrigin(
  req: Request,
  origin: string | null | undefined,
  options?: { compareScheme?: boolean },
): boolean;
/** Create the CORS middleware. */
export function createCors(options?: CreateCorsOptions): RequestHandler;

export default createCors;
