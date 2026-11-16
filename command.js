import fs from 'fs/promises';
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

let templates;
const renderTemplate = (name, data) => {
  if (!templates) {
    templates = new Edge({ cache: false });
    templates.mount(TEMPLATE_DIR);
  }
  return templates.render(name, data);
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

/** users_categories → UsersCategories */
export function titleCase(str) {
  return str.toLowerCase().split('_').filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

const rel = (abs) => path.relative(appPath(), abs) || abs;

/** Write a file under the app root; refuse to overwrite unless force. */
export async function writeAppFile(relativePath, content, { force = false } = {}) {
  const abs = appPath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  try {
    await fs.writeFile(abs, content, { flag: force ? 'w' : 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error(`${rel(abs)} already exists (use --force to overwrite).`);
    }
    throw err;
  }
  console.log(chalk.green(`${rel(abs)} created.`));
  return abs;
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

export async function makeModel(name, { force, table } = {}) {
  validateName(name, 'model name');
  const tableName = validateTable(table ?? name.toLowerCase());
  await writeAppFile(`app/Models/${name}.js`, await renderTemplate('model', { model: name, table: tableName }), { force });
  await addToIndex('app/Models', name);
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

/**
 * make:crud users,rooms,user_categories
 * Creates model, migration, seed and controller per table, then registers
 * crud routes in routes/api.js (--init writes a fresh routes/api.js).
 */
export async function makeCrud(list, { force = false, init = false } = {}) {
  const tables = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (tables.length === 0) throw new Error('make:crud needs at least one table name');
  tables.forEach(validateTable);

  const routes = tables.map((table) => ({ model: titleCase(table), path: table.split('_').join('-') }));
  routes.forEach((r) => validateName(r.model, 'model name'));

  const now = Date.now();
  for (const [i, table] of tables.entries()) {
    const model = titleCase(table);
    const controller = `${model}Controller`;
    const stamp = `${now + i}_${model}`;

    await writeAppFile(`app/Models/${model}.js`, await renderTemplate('crud-model', { model, db: table }), { force });
    await addToIndex('app/Models', model);
    await writeAppFile(`database/migrations/${stamp}.js`, await renderTemplate('crud-migration', { migration: model }), { force });
    await writeAppFile(`database/seeds/${stamp}.js`, await renderTemplate('crud-seed', { seed: model }), { force });
    await writeAppFile(`app/Controllers/${controller}.js`, await renderTemplate('crud-controller', { controller, model }), { force });
  }

  if (init) {
    await writeAppFile('routes/api.js', await renderTemplate('crud-router', { data: routes }), { force });
    return;
  }

  const apiFile = appPath('routes', 'api.js');
  const current = await fs.readFile(apiFile, 'utf8');
  const marker = 'export default router;';
  if (!current.includes(marker)) {
    throw new Error(`routes/api.js has no "${marker}" line; add the crud routes manually or use --init --force.`);
  }
  const addition = await renderTemplate('crud-router-additional', { data: routes });
  const index = current.lastIndexOf(marker);
  await fs.writeFile(apiFile, current.slice(0, index) + addition + current.slice(index + marker.length));
  console.log(chalk.green('routes/api.js updated.'));
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
    .version('2.0.0');

  const single = (cmd, description, maker) => program.command(cmd)
    .description(description)
    .argument('<name>', 'class / file name (JavaScript identifier)')
    .option('-f, --force', 'overwrite existing files')
    .action((name, opts) => maker(name, opts));

  single('make:controller', 'create a controller', makeController);
  single('make:middleware', 'create a middleware', makeMiddleware);
  single('make:model', 'create a model', makeModel)
    .option('-t, --table <table>', 'table name (default: lower-cased model name)');
  single('make:helper', 'create a helper', makeHelper);
  single('make:job', 'create a job', makeJob);
  single('make:repository', 'create a repository', makeRepository);
  single('make:strategy', 'create a passport strategy', makeStrategy);

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
