import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import chalk from 'chalk';
import { Edge } from 'edge.js';
import { appPath } from '@averoa/utilities/paths';

/**
 * `averoa` CLI: code generators (make:*).
 *
 * Templates ship inside this package (resolved from import.meta.url, not from
 * cwd/node_modules). Generated files are written under the app root. Existing
 * files are never overwritten unless --force is given.
 */

export const TEMPLATE_DIR = fileURLToPath(new URL('./template/', import.meta.url));

/** This package's version (shown by `averoa --version`). */
export const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

let templates;
const renderTemplate = async (name, data) => {
  if (!templates) {
    templates = new Edge({ cache: false });
    templates.mount(TEMPLATE_DIR);
  }
  // Edge drops the template's final newline; files end with exactly one (eol-last)
  const output = await templates.render(name, data);
  return `${output.replace(/^\n+/, '').trimEnd()}\n`;
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate a generated class/file name: a JS identifier, no path separators. */
export function validateName(name, kind = 'name') {
  if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
    throw new Error(`Invalid ${kind} "${name}": use a JavaScript identifier (letters, digits, _ or $; no path separators).`);
  }
  return name;
}

/** Validate a table name (letters, digits, underscore). */
export function validateTable(name) {
  if (typeof name !== 'string' || !TABLE.test(name)) {
    throw new Error(`Invalid table name "${name}": use letters, digits and underscores only.`);
  }
  return name;
}

/**
 * PascalCase a table name. Words are split on `_` and `-`; the first letter of
 * each is upper-cased and the rest is kept as typed:
 * users_categories → UsersCategories, user-categories → UserCategories,
 * userCategories → UserCategories.
 */
export function titleCase(str) {
  return str.split(/[_-]+/).filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

const rel = (abs) => path.relative(appPath(), abs) || abs;

/**
 * Migration/seed timestamp in the knex `migrate:make` format: 14-digit UTC
 * YYYYMMDDHHMMSS, so generated files sort together with knex-made ones.
 */
export function migrationTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

/** Write a file under the app root; refuse to overwrite unless force. */
export async function writeAppFile(relativePath, content, { force = false } = {}) {
  const abs = appPath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, content, { flag: force ? 'w' : 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`${rel(abs)} already exists (use --force to overwrite).`, { cause: err });
    }
    throw err;
  }
  console.log(chalk.green(`${rel(abs)} created.`));
  return abs;
}

const exists = async (abs) => {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
};

/** Check every target first (without force nothing is written if one exists), then write them. */
async function writeAll(files, { force = false } = {}) {
  if (!force) {
    const taken = [];
    for (const file of files) {
      if (await exists(appPath(file.path))) taken.push(file.path);
    }
    if (taken.length > 0) {
      throw new Error(`${taken.join(', ')} already exist${taken.length === 1 ? 's' : ''} (use --force to overwrite; nothing was written).`);
    }
  }
  for (const file of files) await writeAppFile(file.path, file.content, { force });
}

/** Append `export { default as Name } from './Name.js';` to an index file once. */
export async function addToIndex(dir, name) {
  const abs = appPath(dir, 'index.js');
  const line = `export { default as ${name} } from './${name}.js';`;
  let current = '';
  try {
    current = await fs.readFile(abs, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (current.split('\n').some((l) => l.trim() === line)) return;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.appendFile(abs, `${prefix}${line}\n`);
}

/* -------------------------------------------------------------------------- */
/* generators                                                                 */
/* -------------------------------------------------------------------------- */

export async function makeController(name, { force } = {}) {
  validateName(name, 'controller name');
  await writeAppFile(`app/Controllers/${name}.js`, await renderTemplate('controller', { controller: name }), { force });
}

export async function makeMiddleware(name, { force } = {}) {
  validateName(name, 'middleware name');
  await writeAppFile(`app/Middleware/${name}.js`, await renderTemplate('middleware', { middleware: name }), { force });
}

/**
 * make:model User [--table users] [--migration] [--seed]
 * --migration adds a migration that builds the table from the model's `static
 * column` (Model.migrationUp), --seed a seeder of 10 fake rows (Model.seeder).
 * Every target is checked before anything is written.
 */
export async function makeModel(name, {
  force = false, table, migration = false, seed = false,
} = {}) {
  validateName(name, 'model name');
  const tableName = validateTable(table ?? name.toLowerCase());
  const stamp = `${migrationTimestamp()}_${name}`;
  const files = [{ path: `app/Models/${name}.js`, content: await renderTemplate('model', { model: name, table: tableName }) }];
  if (migration) {
    const target = (force && await findStamped('database/migrations', name)) || `database/migrations/${stamp}.js`;
    files.push({ path: target, content: await renderTemplate('crud-migration', { migration: name }) });
  }
  if (seed) {
    const target = (force && await findStamped('database/seeds', name)) || `database/seeds/${stamp}.js`;
    files.push({ path: target, content: await renderTemplate('crud-seed', { seed: name }) });
  }
  await writeAll(files, { force });
  await addToIndex('app/Models', name);
}

/**
 * make:policy TeacherPolicy [--model Teacher]
 * The model defaults to the name without a trailing "Policy". The policy still
 * has to be registered in app/Providers/AuthProvider.js; the hint says how.
 */
export async function makePolicy(name, { force, model } = {}) {
  validateName(name, 'policy name');
  const modelName = validateName(model ?? (name.replace(/Policy$/, '') || name), 'model name');
  await writeAppFile(`app/Policies/${name}.js`, await renderTemplate('policy', { name, model: modelName }), { force });
  console.log(chalk.yellow(`Register it in app/Providers/AuthProvider.js: [${modelName}, ${name}] in policies().`));
}

/** make:validator PostValidator: app/Validators/<name>.js, an instance with sample rule sets. */
export async function makeValidator(name, { force } = {}) {
  validateName(name, 'validator name');
  await writeAppFile(`app/Validators/${name}.js`, await renderTemplate('validator', { name }), { force });
}

const FILE_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Validate a file name part such as `add_status_to_posts` or `posts-api`. */
export function validateSlug(name, kind = 'name') {
  if (typeof name !== 'string' || !FILE_SLUG.test(name)) {
    throw new Error(`Invalid ${kind} "${name}": use letters, digits, _ and - (no path separators).`);
  }
  return name;
}

/**
 * make:migration create_posts_table --create posts | add_status_to_posts --table posts
 * database/migrations/<timestamp>_<name>.js, an ES module with up/down.
 */
export async function makeMigration(name, { force, create, table } = {}) {
  validateSlug(name, 'migration name');
  if (create && table) throw new Error('make:migration: use --create or --table, not both.');
  if (create) validateTable(create);
  if (table) validateTable(table);
  await writeAppFile(
    `database/migrations/${migrationTimestamp()}_${name}.js`,
    await renderTemplate('migration', { create: create ?? null, table: table ?? null }),
    { force },
  );
}

/**
 * make:test posts [--http]
 * tests/<name>.test.js for node:test, using the boilerplate's tests/helpers.js;
 * --http starts the real app (migrated and seeded) on a random port.
 */
export async function makeTest(name, { force, http = false } = {}) {
  const base = validateSlug(String(name ?? '').replace(/(\.test)?(\.js)?$/, ''), 'test name');
  const file = `${base}.test.js`;
  await writeAppFile(`tests/${file}`, await renderTemplate('test', { http, file, title: base }), { force });
  if (!await exists(appPath('tests', 'helpers.js'))) {
    console.log(chalk.yellow('tests/helpers.js not found: the test imports setTestEnv (and client) from it, as in the AveroaJS boilerplate.'));
  }
}

const simpleMaker = (template, dir, kind) => async (name, { force } = {}) => {
  validateName(name, kind);
  await writeAppFile(`${dir}/${name}.js`, await renderTemplate(template, { name }), { force });
  await addToIndex(dir, name);
};

export const makeHelper = simpleMaker('helper', 'app/Helpers', 'helper name');
export const makeJob = simpleMaker('job', 'app/Jobs', 'job name');
export const makeRepository = simpleMaker('repository', 'app/Repositories', 'repository name');
export const makeStrategy = simpleMaker('strategy', 'app/Strategies', 'strategy name');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Existing `<timestamp>_<Model>.js` in a migrations/seeds dir, if any. */
async function findStamped(dir, model) {
  let names = [];
  try {
    names = await fs.readdir(appPath(dir));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const re = new RegExp(`^\\d+_${escapeRegExp(model)}\\.js$`);
  const match = names.filter((n) => re.test(n)).sort();
  return match.length ? `${dir}/${match[match.length - 1]}` : null;
}

/** Is a `router.crud('Model', 'path'` block already in routes/api.js? */
const hasCrudRoute = (source, route) => new RegExp(
  `router\\.crud\\(\\s*['"\`]${escapeRegExp(route.model)}['"\`]\\s*,\\s*['"\`]${escapeRegExp(route.path)}['"\`]`,
).test(source);

/**
 * make:crud users,rooms,user_categories
 * Creates model, migration, seed and controller per table, then registers
 * crud routes in routes/api.js (--init writes a fresh routes/api.js).
 *
 * Everything is checked before anything is written: invalid names, existing
 * files (without --force) and a missing or unusable routes/api.js (without
 * --init) abort with nothing changed. Re-running is safe: with --force the
 * existing migration/seed of a model is overwritten instead of a new one being
 * added, and a crud route block that is already in routes/api.js is not
 * appended again.
 */
export async function makeCrud(list, { force = false, init = false } = {}) {
  const tables = [...new Set(list.split(',').map((s) => s.trim()).filter(Boolean))];
  if (tables.length === 0) throw new Error('make:crud needs at least one table name');
  tables.forEach(validateTable);

  const routes = tables.map((table) => ({ model: titleCase(table), path: table.split('_').join('-') }));
  routes.forEach((r) => validateName(r.model, 'model name'));
  const models = routes.map((r) => r.model);
  const duplicate = models.find((m, i) => models.indexOf(m) !== i);
  if (duplicate) throw new Error(`make:crud: two tables map to the same model name "${duplicate}".`);

  // 1. plan every file (rendering templates up front)
  const now = Date.now();
  const files = [];
  for (const [i, table] of tables.entries()) {
    const model = titleCase(table);
    const controller = `${model}Controller`;
    // one second apart, so tables generated together keep their order
    const stamp = `${migrationTimestamp(new Date(now + i * 1000))}_${model}`;
    const migration = (await findStamped('database/migrations', model)) ?? `database/migrations/${stamp}.js`;
    const seed = (await findStamped('database/seeds', model)) ?? `database/seeds/${stamp}.js`;

    files.push(
      { path: `app/Models/${model}.js`, content: await renderTemplate('crud-model', { model, db: table }), index: model },
      { path: migration, content: await renderTemplate('crud-migration', { migration: model }) },
      { path: seed, content: await renderTemplate('crud-seed', { seed: model }) },
      { path: `app/Controllers/${controller}.js`, content: await renderTemplate('crud-controller', { controller, model }) },
    );
  }

  const apiFile = appPath('routes', 'api.js');
  let routesUpdate = null;
  if (init) {
    files.push({ path: 'routes/api.js', content: await renderTemplate('crud-router', { data: routes }) });
  } else {
    let current;
    try {
      current = await fs.readFile(apiFile, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      throw new Error(
        'routes/api.js not found. Run make:crud with --init to create it (nothing was written).',
        { cause: err },
      );
    }
    const marker = 'export default router;';
    if (!current.includes(marker)) {
      throw new Error(`routes/api.js has no "${marker}" line; add the crud routes manually or use --init --force (nothing was written).`);
    }
    const missing = routes.filter((route) => !hasCrudRoute(current, route));
    if (missing.length > 0) {
      const addition = (await renderTemplate('crud-router-additional', { data: missing })).trimEnd();
      const index = current.lastIndexOf(marker);
      routesUpdate = current.slice(0, index) + addition + current.slice(index + marker.length);
    }
  }

  // 2. refuse before writing anything if a target exists (without --force)
  if (!force) {
    const taken = [];
    for (const file of files) {
      if (await exists(appPath(file.path))) taken.push(file.path);
    }
    if (taken.length > 0) {
      throw new Error(`${taken.join(', ')} already exist${taken.length === 1 ? 's' : ''} (use --force to overwrite; nothing was written).`);
    }
  }

  // 3. write
  for (const file of files) {
    await writeAppFile(file.path, file.content, { force });
    if (file.index) await addToIndex('app/Models', file.index);
  }

  if (routesUpdate !== null) {
    await fs.writeFile(apiFile, routesUpdate);
    console.log(chalk.green('routes/api.js updated.'));
  } else if (!init) {
    console.log(chalk.yellow('routes/api.js already has these crud routes; not changed.'));
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Build the commander program (exported for tests).
 */
export function buildProgram() {
  const program = new Command();
  program
    .name('averoa')
    .description('CLI for AveroaJS')
    .version(VERSION);

  const single = (cmd, description, maker) => program.command(cmd)
    .description(description)
    .argument('<name>', 'class / file name (JavaScript identifier)')
    .option('-f, --force', 'overwrite existing files')
    .action((name, opts) => maker(name, opts));

  single('make:controller', 'create a controller', makeController);
  single('make:middleware', 'create a middleware', makeMiddleware);
  single('make:model', 'create a model', makeModel)
    .option('-t, --table <table>', 'table name (default: lower-cased model name)')
    .option('-m, --migration', 'also create a migration built from the model columns')
    .option('-s, --seed', 'also create a seeder of fake rows');
  single('make:policy', 'create an authorization policy', makePolicy)
    .option('--model <model>', 'model the policy is for (default: the name without "Policy")');
  single('make:validator', 'create request validation rules', makeValidator);
  single('make:helper', 'create a helper', makeHelper);
  single('make:job', 'create a job', makeJob);
  single('make:repository', 'create a repository', makeRepository);
  single('make:strategy', 'create a passport strategy', makeStrategy);

  program.command('make:migration')
    .description('create a migration')
    .argument('<name>', 'e.g. create_posts_table or add_status_to_posts')
    .option('-c, --create <table>', 'create this table')
    .option('-t, --table <table>', 'change this existing table')
    .option('-f, --force', 'overwrite existing files')
    .action((name, opts) => makeMigration(name, opts));

  program.command('make:test')
    .description('create a node:test file in tests/')
    .argument('<name>', 'file name without .test.js, e.g. posts')
    .option('--http', 'start the app and test it over HTTP')
    .option('-f, --force', 'overwrite existing files')
    .action((name, opts) => makeTest(name, opts));

  program.command('make:crud')
    .description('create model, migration, seed, controller and routes for tables')
    .argument('<tables>', 'comma separated table names, e.g. users,rooms,user_categories')
    .option('-i, --init', 'write a new routes/api.js instead of appending (needs --force if it exists)')
    .option('-f, --force', 'overwrite existing files')
    .action((tables, opts) => makeCrud(tables, opts));

  return program;
}

/**
 * Run the CLI. Used by the app's `averoa.js`: `import { command } from '@averoa/core'; command();`
 */
const command = async (argv = process.argv) => {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    console.error(chalk.red(err.message));
    process.exitCode = 1;
  }
};

export default command;
