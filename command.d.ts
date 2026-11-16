import type { Command } from 'commander';

export interface MakeOptions {
  /** Overwrite existing files. */
  force?: boolean;
}

export interface MakeModelOptions extends MakeOptions {
  /** Table name (default: the lower-cased model name). */
  table?: string;
  /** Also create a migration built from the model's columns. */
  migration?: boolean;
  /** Also create a seeder of fake rows. */
  seed?: boolean;
}

export interface MakePolicyOptions extends MakeOptions {
  /** Model the policy is for (default: the name without a trailing "Policy"). */
  model?: string;
}

export interface MakeMigrationOptions extends MakeOptions {
  /** Create this table. */
  create?: string;
  /** Change this existing table. */
  table?: string;
}

export interface MakeTestOptions extends MakeOptions {
  /** Start the app and test it over HTTP. */
  http?: boolean;
}

export interface MakeCrudOptions extends MakeOptions {
  /** Write a new routes/api.js instead of appending. */
  init?: boolean;
}

/** Directory of the bundled generator templates. */
export const TEMPLATE_DIR: string;
/** This package's version. */
export const VERSION: string;

/** Validate a generated class/file name (a JavaScript identifier); returns it. */
export function validateName(name: unknown, kind?: string): string;
/** Validate a table name (letters, digits, underscore); returns it. */
export function validateTable(name: unknown): string;
/** Validate a file name part (letters, digits, `_`, `-`); returns it. */
export function validateSlug(name: unknown, kind?: string): string;
/** PascalCase a table name: `users_categories` to `UsersCategories`. */
export function titleCase(str: string): string;
/** 14-digit UTC `YYYYMMDDHHMMSS` timestamp, as knex `migrate:make` uses. */
export function migrationTimestamp(date?: Date): string;
/** Write a file under the app root; refuses to overwrite unless `force`. Resolves the absolute path. */
export function writeAppFile(relativePath: string, content: string, options?: MakeOptions): Promise<string>;
/** Append `export { default as Name } from './Name.js';` to `<dir>/index.js` once. */
export function addToIndex(dir: string, name: string): Promise<void>;

export function makeController(name: string, options?: MakeOptions): Promise<void>;
export function makeMiddleware(name: string, options?: MakeOptions): Promise<void>;
export function makeModel(name: string, options?: MakeModelOptions): Promise<void>;
export function makeHelper(name: string, options?: MakeOptions): Promise<void>;
export function makeJob(name: string, options?: MakeOptions): Promise<void>;
export function makeRepository(name: string, options?: MakeOptions): Promise<void>;
export function makeStrategy(name: string, options?: MakeOptions): Promise<void>;
export function makePolicy(name: string, options?: MakePolicyOptions): Promise<void>;
export function makeValidator(name: string, options?: MakeOptions): Promise<void>;
export function makeMigration(name: string, options?: MakeMigrationOptions): Promise<void>;
export function makeTest(name: string, options?: MakeTestOptions): Promise<void>;
/** Model, migration, seed and controller per table, plus crud routes in routes/api.js. */
export function makeCrud(tables: string, options?: MakeCrudOptions): Promise<void>;

/** The commander program of the `averoa` CLI. */
export function buildProgram(): Command;

/**
 * Run the `averoa` CLI with `argv` in Node format (default `process.argv`).
 * Errors are printed and set `process.exitCode = 1`; the promise does not reject.
 */
declare function command(argv?: readonly string[]): Promise<void>;

export default command;
