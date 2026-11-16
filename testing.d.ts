import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Knex } from 'knex';
import type { CreateAppOptions } from './index.js';

export interface TestResponse<T = any> {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or undefined when the body is not JSON. */
  body: T;
  text: string;
}

export interface TestRequestOptions {
  /** JSON body (objects are stringified; a string is sent as is). */
  body?: unknown;
  /** FormData or URLSearchParams body; fetch sets the content type. */
  form?: FormData | URLSearchParams;
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  headers?: Record<string, string>;
}

export type TestClient = <T = any>(method: string, url: string, options?: TestRequestOptions) => Promise<TestResponse<T>>;

export interface ClientOptions {
  /** Per-request timeout in ms (default 5000). */
  timeout?: number;
  /** Headers sent with every request. */
  headers?: Record<string, string>;
}

/** A fetch wrapper for tests that resolves `{ status, headers, body, text }` and times out instead of hanging. */
export function client(baseUrl: string, options?: ClientOptions): TestClient;

export interface TestAppOptions extends CreateAppOptions {
  /** Run every migration (default true). */
  migrate?: boolean;
  /** Run the seeders (default true). */
  seed?: boolean;
  /** Roll every migration back first (default: true unless the database is in-memory SQLite). Needs NODE_ENV=test. */
  fresh?: boolean;
  /** Per-request timeout of `http()` in ms (default 5000). */
  timeout?: number;
  /** Listen address (default 127.0.0.1). */
  host?: string;
}

export interface TestApp {
  app: Express;
  server: Server;
  health: unknown;
  /** Base URL, e.g. `http://127.0.0.1:53817`. */
  url: string;
  DB: Knex;
  http: TestClient;
  /** Close the server, the database, the queue connection, Redis and log streams. */
  close(): Promise<void>;
}

/** Build the app, migrate and seed the database and listen on a random port. */
export function testApp(options?: TestAppOptions): Promise<TestApp>;

export interface FakeMailMessage {
  from?: unknown;
  to?: unknown;
  subject?: string;
  text?: string;
  html?: string;
  attachments?: unknown[];
  /** Queue name for `.queue()` mail, null for a direct send. */
  queue: string | null;
  [key: string]: unknown;
}

export interface FakeMail {
  sent: FakeMailMessage[];
  /** Messages addressed to `address` (case-insensitive). */
  to(address: string): FakeMailMessage[];
  clear(): void;
  restore(): void;
}

/** Record `Mail` sends (direct and queued) instead of sending them. */
export function fakeMail(): Promise<FakeMail>;
