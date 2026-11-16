import type { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import type { EnvVars } from './env.js';

declare global {
  namespace Express {
    interface Request {
      /** The request id assigned by core's request-id middleware. */
      id: string;
    }
  }
}

/** The per-request context store. */
export interface RequestContextStore {
  requestId: string;
}

/**
 * The request context, shared with @averoa/utilities (Log) through a global
 * registered symbol.
 */
export const requestContext: AsyncLocalStorage<RequestContextStore>;

/** The request id of the current request context, or `undefined`. */
export function currentRequestId(): string | undefined;

/** Longest incoming request id that is reused (128). */
export const REQUEST_ID_MAX_LENGTH: number;

/** True for a usable incoming request id (1 to 128 characters from `A-Z a-z 0-9 - _ . : + = / @`). */
export function isValidRequestId(value: unknown): value is string;

/**
 * Whether an incoming request id header is trusted: TRUST_REQUEST_ID wins;
 * unset, only when TRUST_PROXY is set to something other than false / 0.
 */
export function trustIncomingRequestId(env?: EnvVars): boolean;

export interface RequestIdOptions {
  /** Header read and written (default REQUEST_ID_HEADER or `X-Request-Id`). */
  header?: string;
  /** Trust the incoming header (default `trustIncomingRequestId()`). */
  trust?: boolean;
  /** Id generator (default `crypto.randomUUID`). */
  generate?: () => string;
}

/**
 * Middleware: assigns `req.id`, sets the response header and runs the rest of
 * the stack inside the request context.
 */
export function requestId(options?: RequestIdOptions): RequestHandler;

/** Middleware: re-enters the request context of `req` (after middleware that loses it). */
export function restoreRequestContext(): RequestHandler;

export default requestId;
