import type { EnvVars, Logger } from './env.js';

/**
 * The parts of an express-session store core relies on. connect-redis's
 * `RedisStore` (and any express-session `Store`) has them.
 */
export interface SessionStore {
  get(sid: string, callback: (err: unknown, session?: unknown) => void): unknown;
  set(sid: string, session: unknown, callback?: (err?: unknown) => void): unknown;
  destroy(sid: string, callback?: (err?: unknown) => void): unknown;
}

export type SessionStoreKind = 'memory' | 'redis';

/** The accepted SESSION_STORE values. */
export const SESSION_STORES: readonly SessionStoreKind[];

/** The configured session store kind (SESSION_STORE); throws on an unknown value. */
export function sessionStoreKind(env?: EnvVars): SessionStoreKind;

/**
 * Create the session store selected by SESSION_STORE: a connect-redis store
 * for `redis`, `undefined` for `memory` (express-session's MemoryStore).
 * Pass a type argument (e.g. connect-redis's `RedisStore`) to narrow it.
 */
export function createSessionStore<Store extends object = SessionStore>(
  options?: { log?: Logger },
): Promise<Store | undefined>;
