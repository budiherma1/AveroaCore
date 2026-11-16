import type dotenvModule from 'dotenv';

/** An environment object such as `process.env`. */
export type EnvVars = Readonly<Record<string, string | undefined>>;

/** A logger with optional level methods; `console` and `Log` of @averoa/utilities work. */
export interface Logger {
  info?(message: string): unknown;
  warn?(message: string): unknown;
  error?(message: string): unknown;
}

/**
 * The `dotenv` module. Importing `@averoa/core/env.js` (or `@averoa/core`)
 * loads `<app root>/.env` first; variables already in `process.env` win.
 */
declare const dotenv: typeof dotenvModule;
export default dotenv;
