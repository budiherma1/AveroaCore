/**
 * Knex CLI configuration for AveroaJS apps.
 *
 *   knex migrate:latest --knexfile node_modules/@averoa/core/knexfile.js [--cwd .]
 *
 * Knex changes the working directory to the knexfile's folder unless `--cwd`
 * is given, so nothing here depends on cwd: the app root comes from
 * AVEROA_ROOT or the nearest package.json outside node_modules, `.env` is
 * loaded from the app root, and migration/seed directories are absolute.
 *
 * The app's config/database.js (default export `(process) => knexConfig`, or
 * a plain object) is merged over env-based defaults. Relative
 * `migrations.directory` / `seeds.directory` values in it are resolved
 * against the app root.
 */
import path from 'path';
import dotenv from 'dotenv';
import { appPath, appRoot, importAppDefault } from '@averoa/utilities/paths';

dotenv.config({ path: appPath('.env'), quiet: true });

const resolveDirs = (dirs, fallback) => {
  const value = dirs ?? fallback;
  const resolve = (d) => path.resolve(appRoot(), d);
  return Array.isArray(value) ? value.map(resolve) : resolve(value);
};

export async function buildConfig() {
  const appConfig = await importAppDefault('config/database.js', { optional: true });
  const fromApp = (typeof appConfig === 'function' ? appConfig(process) : appConfig) ?? {};

  return {
    client: process.env.DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    },
    ...fromApp,
    migrations: {
      ...(fromApp.migrations ?? {}),
      directory: resolveDirs(fromApp.migrations?.directory, 'database/migrations'),
    },
    seeds: {
      ...(fromApp.seeds ?? {}),
      directory: resolveDirs(fromApp.seeds?.directory, 'database/seeds'),
    },
  };
}

const config = await buildConfig();

export default {
  development: config,
  test: config,
  staging: config,
  production: config,
};
