/** The knex configuration built from config/database.js and DB_* variables. */
export interface AveroaKnexConfig {
  client: string;
  connection: unknown;
  useNullAsDefault?: boolean;
  migrations: { directory: string | string[]; [key: string]: unknown };
  seeds: { directory: string | string[]; [key: string]: unknown };
  [key: string]: unknown;
}

/** True for the SQLite clients (`sqlite3`, `better-sqlite3`, `sqlite`). */
export function isSqliteClient(client: unknown): boolean;
/** Resolve a relative SQLite filename against the app root (`:memory:` and `file:` URIs are kept). */
export function resolveSqliteFilename(filename: string): string;
export function resolveSqliteFilename<T>(filename: T): T;
/** Build the knex configuration of the app. */
export function buildConfig(): Promise<AveroaKnexConfig>;

/** The same configuration for every environment, for the knex CLI. */
declare const config: {
  development: AveroaKnexConfig;
  test: AveroaKnexConfig;
  staging: AveroaKnexConfig;
  production: AveroaKnexConfig;
};

export default config;
