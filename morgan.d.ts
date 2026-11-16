import type { WriteStream } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import type { EnvVars } from './env.js';

export type LogChannel = 'stdout' | 'file' | 'both';

export interface AccessLogSettings {
  /** LOG_CHANNEL, or `null` when unset (files plus the console outside production and test). */
  channel: LogChannel | null;
  fileFormat: 'combined' | 'json';
  consoleFormat: 'combined' | 'json' | 'dev';
}

export interface SetMorganOptions {
  /** NODE_ENV. */
  env?: string;
  /** Default LOG_CHANNEL. */
  channel?: LogChannel | null;
  /** Default ACCESS_LOG_FORMAT. */
  fileFormat?: 'combined' | 'json';
  /** Default ACCESS_LOG_FORMAT / LOG_FORMAT. */
  consoleFormat?: 'combined' | 'json' | 'dev';
  /** Default `process.stdout`. */
  stdout?: { write(line: string): unknown };
}

/** The log streams currently open, keyed by absolute file path. */
export function getLogStreams(): Map<string, WriteStream>;
/** Close the shared access.log / error.log streams; the next request reopens them. */
export function closeLogStreams(): Promise<void>;
/** Access log settings from LOG_CHANNEL, ACCESS_LOG_FORMAT, LOG_FORMAT and NODE_ENV. */
export function accessLogSettings(env?: EnvVars): AccessLogSettings;
/** morgan format function producing one JSON line per request. */
export function jsonAccessFormat(
  tokens: { readonly [name: string]: unknown },
  req: IncomingMessage,
  res: ServerResponse,
): string;

/** Mount the request loggers on `app`. */
declare function setMorgan(app: Express, options?: SetMorganOptions): {
  accessLogStream: WriteStream | undefined;
  errorLogStream: WriteStream | undefined;
};

export default setMorgan;
