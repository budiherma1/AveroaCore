import type { NextFunction, Request, Response } from 'express';
import type { EnvVars, Logger } from './env.js';

/** Context passed to every readiness check. `signal` aborts when the check times out. */
export interface HealthCheckContext {
  signal: AbortSignal;
  /** The check's timeout in milliseconds. */
  timeout: number;
}

/**
 * A readiness check: it fails when it throws, rejects, times out or returns
 * `false`. Any other result means "up".
 */
export type HealthCheckFunction = (context: HealthCheckContext) => unknown;

/** A readiness check with its own options. */
export interface HealthCheckDefinition {
  check: HealthCheckFunction;
  /** Per-check timeout in ms (default READY_TIMEOUT). */
  timeout?: number;
  /** `false` reports the check without failing readiness (default true). */
  critical?: boolean;
}

export type HealthCheck = HealthCheckFunction | HealthCheckDefinition;

/**
 * What `AppProvider.health()` may return for each name: a check, or
 * `false` / `null` / `undefined` to drop it.
 */
export type HealthChecksConfig = Record<string, HealthCheck | false | null | undefined>;

/** The built-in checks selected by READY_CHECKS. */
export interface BuiltInHealthChecks {
  database?: HealthCheckFunction;
  queue?: HealthCheckFunction;
}

export interface HealthCheckResult {
  status: 'up' | 'down';
  durationMs: number;
  /** Only present (as `false`) for non-critical checks. */
  critical?: false;
  /** The message in development/test, `timeout` or `failed` otherwise. */
  error?: string;
}

export interface ReadinessBody {
  status: 'ok' | 'error';
  checks: Record<string, HealthCheckResult>;
}

export interface ReadinessResult {
  ok: boolean;
  body: ReadinessBody;
}

export interface HealthSettings {
  /** Liveness path, or `null` when disabled. */
  livenessPath: string | null;
  /** Readiness path, or `null` when disabled. */
  readinessPath: string | null;
  /** Default per-check timeout in ms. */
  timeout: number;
  /** Built-in check names from READY_CHECKS. */
  builtIn: string[];
}

/** The health state returned by `createHealth()`, `createApp()` and `start()`. */
export interface Health {
  /** Answers the liveness and readiness probes; calls `next()` for anything else. */
  middleware(req: Request, res: Response, next: NextFunction): Promise<void>;
  /** The configured checks, normalised. */
  checks: Record<string, HealthCheckDefinition & { critical: boolean }>;
  livenessPath: string | null;
  readinessPath: string | null;
  /** True once `markShuttingDown()` was called. */
  readonly shuttingDown: boolean;
  /** Readiness answers 503 from now on (graceful shutdown). */
  markShuttingDown(): void;
  /** Run the readiness checks programmatically (concurrent calls share one run). */
  readiness(): Promise<ReadinessResult>;
  /** True for the configured probe paths. */
  isHealthCheckPath(path: string | null | undefined): boolean;
}

/** Hooks of the app provider that `createHealth()` reads. */
export interface HealthProvider {
  health?(checks: BuiltInHealthChecks): HealthChecksConfig | false | undefined | void
    | Promise<HealthChecksConfig | false | undefined | void>;
}

export interface CreateHealthOptions {
  /** Resolves the knex instance used by the `database` check. */
  getKnex?: () => unknown;
  AppProvider?: HealthProvider;
  log?: Logger;
  /** Defaults to `healthSettings()`. */
  settings?: HealthSettings;
}

/** A probe path from the environment: `fallback` when unset, `null` when disabled. */
export function probePath(value: string | null | undefined, fallback: string): string | null;
/** Health settings from HEALTH_PATH, READY_PATH, READY_TIMEOUT and READY_CHECKS. */
export function healthSettings(env?: EnvVars): HealthSettings;
/** Built-in database check: `select 1` on the knex instance `getKnex()` resolves. */
export function databaseCheck(getKnex: () => unknown): () => Promise<void>;
/** Built-in queue check: opens (or reuses) the shared AMQP connection of @averoa/utilities. */
export function queueCheck(
  loadQueue?: () => Promise<{ getConnection(): unknown }>,
): () => Promise<void>;
/** Build the health state and middleware. */
export function createHealth(options?: CreateHealthOptions): Promise<Health>;

export default createHealth;
