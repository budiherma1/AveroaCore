import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNEXFILE = path.join(CORE, 'knexfile.js');
const KNEX_CLI = path.join(CORE, 'node_modules', 'knex', 'bin', 'cli.js');

let tmp;
let appDir;
let fakeCoreDir;

before(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'averoa-knex-')));
  appDir = path.join(tmp, 'app');
  fakeCoreDir = path.join(appDir, 'node_modules', '@averoa', 'core');
  fs.mkdirSync(path.join(appDir, 'config'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'database', 'migrations'), { recursive: true });
  fs.mkdirSync(path.join(appDir, 'database', 'seeds'), { recursive: true });
  fs.mkdirSync(fakeCoreDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'tmp-app', type: 'module' }));
  fs.writeFileSync(path.join(appDir, '.env'), 'DB_FILE_FROM_ENV=db.sqlite\n');
  fs.writeFileSync(path.join(appDir, 'config', 'database.js'), `
import path from 'path';
export default (proc) => ({
  client: 'better-sqlite3',
  connection: { filename: path.join(${JSON.stringify(appDir)}, proc.env.DB_FILE_FROM_ENV || 'missing-env.sqlite') },
  useNullAsDefault: true,
});
`);
  fs.writeFileSync(path.join(appDir, 'database', 'migrations', '20240101000000_things.js'), `
export const up = (knex) => knex.schema.createTable('things', (t) => { t.increments('id'); });
export const down = (knex) => knex.schema.dropTable('things');
`);
});

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const printConfig = (cwd, env = {}) => {
  const code = `const m = await import(${JSON.stringify(pathToFileURL(KNEXFILE).href)}); console.log(JSON.stringify(m.default.development));`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd,
    env: { ...process.env, AVEROA_ROOT: '', ...env },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
};

test('migration and seed directories are absolute and point at the app (cwd = app root)', () => {
  const config = printConfig(appDir);
  assert.equal(config.client, 'better-sqlite3');
  assert.equal(config.migrations.directory, path.join(appDir, 'database', 'migrations'));
  assert.equal(config.seeds.directory, path.join(appDir, 'database', 'seeds'));
  assert.ok(path.isAbsolute(config.migrations.directory));
  assert.equal(config.connection.filename, path.join(appDir, 'db.sqlite'), '.env loaded from the app root');
});

test('same result when cwd is inside node_modules (knex chdir to the knexfile folder)', () => {
  const config = printConfig(fakeCoreDir);
  assert.equal(config.migrations.directory, path.join(appDir, 'database', 'migrations'));
  assert.equal(config.connection.filename, path.join(appDir, 'db.sqlite'));
});

test('AVEROA_ROOT wins over cwd', () => {
  const config = printConfig(os.tmpdir(), { AVEROA_ROOT: appDir });
  assert.equal(config.seeds.directory, path.join(appDir, 'database', 'seeds'));
});

test('knex CLI migrates with and without --cwd (knexfile inside app/node_modules)', { skip: !fs.existsSync(KNEX_CLI) && 'knex CLI not installed' }, () => {
  // Mirror a real install: <app>/node_modules/@averoa/core/knexfile.js, with
  // the core's own dependencies reachable from there.
  fs.copyFileSync(KNEXFILE, path.join(fakeCoreDir, 'knexfile.js'));
  fs.writeFileSync(path.join(fakeCoreDir, 'package.json'), JSON.stringify({ name: '@averoa/core', type: 'module' }));
  if (!fs.existsSync(path.join(fakeCoreDir, 'node_modules'))) {
    fs.symlinkSync(path.join(CORE, 'node_modules'), path.join(fakeCoreDir, 'node_modules'), 'dir');
  }

  // knex changes cwd to the knexfile folder (inside node_modules); no
  // AVEROA_ROOT, so the app root must be found by walking up.
  const run = (...args) => execFileSync(process.execPath, [KNEX_CLI, ...args, '--knexfile', 'node_modules/@averoa/core/knexfile.js'], {
    cwd: appDir,
    env: { ...process.env, AVEROA_ROOT: '', NODE_ENV: 'development' },
    encoding: 'utf8',
  });

  assert.match(run('migrate:latest', '--cwd', '.'), /Batch 1 run: 1 migrations/);
  assert.match(run('migrate:list'), /Found 1 Completed Migration file/);
  assert.match(run('migrate:rollback'), /rolled back: 1 migrations/);
  assert.ok(fs.existsSync(path.join(appDir, 'db.sqlite')), 'database created where config/database.js + .env say');
});
