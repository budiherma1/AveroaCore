import type { Logger } from './env.js';

/**
 * The parts of a node-redis client core relies on. Pass `RedisClientType`
 * (from `redis`) as the type argument of `getRedisClient()` for the full API.
 */
export interface RedisClientLike {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  sendCommand(args: string[]): Promise<unknown>;
  close(): Promise<unknown>;
  destroy(): unknown;
}

export interface GetRedisClientOptions {
  /** Defaults to REDIS_URL. */
  url?: string;
  /** What needs Redis, used in error messages (e.g. `"SESSION_STORE=redis"`). */
  feature?: string;
  /** Logger with error/warn/info (default console). */
  log?: Logger;
}

/**
 * The shared, connected node-redis client for REDIS_URL (or `url`): one per
 * URL per process. Rejects when Redis is unreachable at startup, except in
 * NODE_ENV development/test.
 */
export function getRedisClient<Client extends object = RedisClientLike>(
  options?: GetRedisClientOptions,
): Promise<Client>;

/** Close every shared Redis client (waits for pending commands). */
export function closeRedis(): Promise<void>;

/**
 * Import an optional peer dependency, with a clear "npm install" message when
 * it is missing.
 */
export function loadOptional<Module = unknown>(name: string, feature: string): Promise<Module>;

/** The URL without its password, for logs and error messages. */
export function redactRedisUrl(url: string): string;

/**
 * Replace the function used to import optional packages (tests only).
 * Returns the previous one; `null` / `undefined` restores the default.
 */
export function setModuleLoader(
  loader: ((name: string) => Promise<unknown>) | null | undefined,
): (name: string) => Promise<unknown>;
