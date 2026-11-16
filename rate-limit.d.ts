import type { Request, Response } from 'express';
import type {
  ClientRateLimitInfo, Options, RateLimitRequestHandler, Store,
} from 'express-rate-limit';
import type { EnvVars, Logger } from './env.js';

export { ipKeyGenerator } from 'express-rate-limit';

export type RateLimitStoreKind = 'memory' | 'redis';

/** The accepted RATE_LIMIT_STORE values. */
export const RATE_LIMIT_STORES: readonly RateLimitStoreKind[];

/** The default 429 message. */
export const RATE_LIMIT_MESSAGE: string;

/**
 * Options of `rateLimit()`: every express-rate-limit option, plus `name` (the
 * limiter's identity in a shared store) and a string `message`.
 */
export interface RateLimitOptions extends Partial<Omit<Options, 'message'>> {
  /**
   * Identifies the limiter in a shared store (Redis key prefix). Give every
   * limiter a unique name; unnamed limiters with the same window and limit
   * share their counters.
   */
  name?: string;
  /** The 429 message, or a function that returns it (default `RATE_LIMIT_MESSAGE`). */
  message?: string | ((req: Request, res: Response) => string | Promise<string>);
}

/** Settings of the global limiter, from RATE_LIMIT_*. */
export interface GlobalRateLimitOptions {
  /** RATE_LIMIT_ENABLED (default true). */
  enabled: boolean;
  /** Where the limiter is mounted (`'/api'`). */
  path: string;
  /** `'global'`. */
  name: string;
  /** RATE_LIMIT_WINDOW_MS (default 60000). */
  windowMs: number;
  /** RATE_LIMIT_MAX (default 100). */
  limit: number;
}

/** What `AppProvider.rateLimit(defaults)` receives. */
export type GlobalRateLimitDefaults = Omit<GlobalRateLimitOptions, 'enabled'>;

/** What `AppProvider.rateLimit()` may return: any `rateLimit()` option plus `path`. */
export interface GlobalRateLimitConfig extends RateLimitOptions {
  path?: string;
}

/** RATE_LIMIT_STORE, defaulting to redis when SESSION_STORE=redis. Throws on an unknown value. */
export function rateLimitStoreKind(env?: EnvVars): RateLimitStoreKind;

/** Settings of the global limiter core mounts. Throws on invalid values. */
export function globalRateLimitOptions(env?: EnvVars): GlobalRateLimitOptions;

/** Logger used by limiters created without a `logger` (core sets the app's Log). */
export function setRateLimitLogger(log?: Logger | null): void;

/** The error passed to the error handler when a client is over the limit (429, `ERATELIMIT`). */
export function rateLimitError(message?: string): Error & {
  status: 429;
  expose: true;
  code: 'ERATELIMIT';
};

/**
 * express-rate-limit store backed by rate-limit-redis on the shared client,
 * loaded on first use.
 */
export class RedisRateLimitStore implements Store {
  constructor(options: { prefix: string; url?: string });
  localKeys: boolean;
  prefix: string;
  url: string | undefined;
  init(options: Options): void;
  get(key: string): Promise<ClientRateLimitInfo | undefined>;
  increment(key: string): Promise<ClientRateLimitInfo>;
  decrement(key: string): Promise<void>;
  resetKey(key: string): Promise<void>;
}

/** Create a rate-limit middleware with AveroaJS defaults. */
export function rateLimit(options?: RateLimitOptions): RateLimitRequestHandler;

/**
 * When RATE_LIMIT_STORE=redis, check that rate-limit-redis is installed and
 * Redis is reachable (fail closed).
 */
export function prepareRateLimitStore(options?: { log?: Logger }): Promise<void>;

export default rateLimit;
