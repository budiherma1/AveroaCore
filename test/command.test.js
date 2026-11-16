import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'averoa-cli-')));
process.env.AVEROA_ROOT = tmp;

const { buildProgram, validateName, TEMPLATE_DIR } = await import('../command.js');

const read = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');
const run = (...args) => buildProgram().exitOverride().configureOutput({ writeOut() {}, writeErr() {} })
  .parseAsync(['node', 'averoa', ...args]);

let log;
before(() => {
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.mkdirSync(path.join(tmp, 'routes'));
  fs.writeFileSync(path.join(tmp, 'routes', 'api.js'), "import Router from '@averoa/routes';\n\nconst router = Router();\n\nexport default router;\n");
  log = console.log;
  console.log = () => {};
});

after(() => {
  console.log = log;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('templates resolve from the package, not from cwd', () => {
  assert.ok(fs.existsSync(path.join(TEMPLATE_DIR, 'controller.edge')));
});

test('name validation rejects path separators and non-identifiers', async () => {
  assert.equal(validateName('UserController'), 'UserController');
  for (const bad of ['../evil', 'a/b', 'a\\b', '1abc', 'with space', '']) {
    assert.throws(() => validateName(bad), /Invalid/);
  }
  await assert.rejects(() => run('make:controller', '../../etc/x'), /Invalid controller name/);
  assert.equal(fs.existsSync(path.join(tmp, 'app')), false);
});

test('make:controller writes under the app root and refuses to overwrite without --force', async () => {
  await run('make:controller', 'HomeController');
  const file = 'app/Controllers/HomeController.js';
  assert.match(read(file), /class HomeController/);

  fs.writeFileSync(path.join(tmp, file), '// edited');
  await assert.rejects(() => run('make:controller', 'HomeController'), /already exists \(use --force/);
  assert.equal(read(file), '// edited');

  await run('make:controller', 'HomeController', '--force');
  assert.match(read(file), /class HomeController/);
});

test('make:model keeps the class name, lower-cases the table, appends to index once', async () => {
  await run('make:model', 'BlogPost');
  const src = read('app/Models/BlogPost.js');
  assert.match(src, /class BlogPost extends Model/);
  assert.match(src, /static tableName = 'blogpost'/);
  assert.match(src, /static hidden = \[\]/);

  await run('make:model', 'BlogPost', '--force', '--table', 'blog_posts');
  assert.match(read('app/Models/BlogPost.js'), /static tableName = 'blog_posts'/);
  const index = read('app/Models/index.js');
  assert.equal(index.match(/BlogPost/g).length, 2, 'one export line (name appears twice in it)');
});

test('make:crud generates model/migration/seed/controller using #models and appends routes', async () => {
  await run('make:crud', 'user_categories');
  assert.match(read('app/Models/UserCategories.js'), /static tableName = 'user_categories'/);
  assert.match(read('app/Controllers/UserCategoriesController.js'), /Crud\.findAll\('UserCategories', req\)/);
  const migrations = fs.readdirSync(path.join(tmp, 'database', 'migrations'));
  assert.equal(migrations.length, 1);
  assert.match(read(`database/migrations/${migrations[0]}`), /from '#models'/);
  const seeds = fs.readdirSync(path.join(tmp, 'database', 'seeds'));
  assert.match(read(`database/seeds/${seeds[0]}`), /import \{ UserCategories \} from '#models'/);
  const api = read('routes/api.js');
  assert.match(api, /router\.crud\('UserCategories', 'user-categories'/);
  assert.equal(api.match(/export default router;/g).length, 1);

  await assert.rejects(() => run('make:crud', 'bad-name'), /Invalid table name/);
  await assert.rejects(() => run('make:crud', 'rooms', '--init'), /routes\/api\.js already exists/);
});

test('make:strategy template invokes the passport middleware', async () => {
  await run('make:strategy', 'ApiKeyStrategy');
  const src = read('app/Strategies/ApiKeyStrategy.js');
  assert.match(src, /\}\)\(req, res, next\);/);
  assert.match(read('app/Strategies/index.js'), /export \{ default as ApiKeyStrategy \} from '\.\/ApiKeyStrategy\.js';/);
});

test('generated files are valid JavaScript', async () => {
  for (const kind of ['middleware', 'helper', 'job', 'repository']) {
    await run(`make:${kind}`, `Sample${kind[0].toUpperCase()}${kind.slice(1)}`);
  }
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p);
  });
  walk(path.join(tmp, 'app'));
  walk(path.join(tmp, 'database'));
  const { execFileSync } = await import('node:child_process');
  assert.ok(files.length >= 10);
  for (const file of files) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }), file);
  }
});
