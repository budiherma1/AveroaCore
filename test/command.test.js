import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'averoa-cli-')));
process.env.AVEROA_ROOT = tmp;

const { buildProgram, validateName, titleCase, migrationTimestamp, TEMPLATE_DIR } = await import('../command.js');

const read = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8');
const run = (...args) => buildProgram()
  .exitOverride()
  .configureOutput({ writeOut() {}, writeErr() {} })
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

test('make:job generates a Job subclass that runs with dispatchSync', async () => {
  await run('make:job', 'ReportJob');
  const src = read('app/Jobs/ReportJob.js');
  assert.match(src, /import \{ Job \} from '@averoa\/utilities';/);
  assert.match(src, /class ReportJob extends Job \{/);
  assert.match(src, /async handle\(payload, context\)/);
  assert.match(src, /async failed\(payload, error, context\)/);
  assert.match(src, /export default ReportJob;/);
  assert.match(read('app/Jobs/index.js'), /export \{ default as ReportJob \} from '\.\/ReportJob\.js';/);

  // run the generated class against this package's @averoa/utilities, in a child process
  const nodeModules = path.join(tmp, 'node_modules');
  fs.symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), nodeModules, 'dir');
  try {
    const { execFileSync } = await import('node:child_process');
    const script = `
      import { Job } from '@averoa/utilities';
      import ReportJob from './app/Jobs/ReportJob.js';
      const result = await ReportJob.dispatchSync({ id: 1 });
      console.log(JSON.stringify({
        isJob: ReportJob.prototype instanceof Job, tries: ReportJob.tries, timeout: ReportJob.timeout, result: result ?? null,
      }));
      process.exit(0);`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: tmp, env: { ...process.env, AVEROA_ROOT: tmp, LOG_LEVEL: 'error' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.deepEqual(JSON.parse(out.trim().split('\n').at(-1)), {
      isJob: true, tries: 3, timeout: 60000, result: null,
    });
  } finally {
    fs.rmSync(nodeModules);
  }
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

/* C-d: make:crud is atomic and idempotent ------------------------------------ */

const snapshot = (root) => {
  const out = {};
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p); else out[path.relative(root, p)] = fs.readFileSync(p, 'utf8');
    });
  };
  walk(root);
  return out;
};

test('C-d: make:crud without routes/api.js fails with a clear error and writes nothing', async () => {
  const api = path.join(tmp, 'routes', 'api.js');
  const saved = fs.readFileSync(api, 'utf8');
  fs.rmSync(api);
  try {
    const unchanged = snapshot(tmp);
    await assert.rejects(() => run('make:crud', 'invoices'), (err) => {
      assert.match(err.message, /routes\/api\.js not found/);
      assert.match(err.message, /--init/);
      assert.doesNotMatch(err.message, /ENOENT/);
      return true;
    });
    assert.deepEqual(snapshot(tmp), unchanged, 'no file written or changed');
    assert.equal(fs.existsSync(path.join(tmp, 'app', 'Models', 'Invoices.js')), false);
  } finally {
    fs.writeFileSync(api, saved);
  }
});

test('C-d: make:crud refuses up front when any target exists (nothing written for the other tables)', async () => {
  // UserCategories exists from the earlier make:crud test
  const unchanged = snapshot(tmp);
  await assert.rejects(() => run('make:crud', 'payments,user_categories'), (err) => {
    assert.match(err.message, /app\/Models\/UserCategories\.js/);
    assert.match(err.message, /--force/);
    assert.match(err.message, /nothing was written/);
    return true;
  });
  assert.deepEqual(snapshot(tmp), unchanged, 'Payments was not generated either');

  await assert.rejects(() => run('make:crud', 'payments', '--init'), /routes\/api\.js already exists/);
  assert.deepEqual(snapshot(tmp), unchanged, '--init without --force writes nothing');
});

test('C-d: re-running make:crud --force does not duplicate route blocks, migrations or seeds', async () => {
  await run('make:crud', 'orders');
  await run('make:crud', 'orders', '--force');
  await run('make:crud', 'orders,user_categories', '--force');
  const api = read('routes/api.js');
  assert.equal(api.match(/router\.crud\('Orders', 'orders'/g).length, 1);
  assert.equal(api.match(/router\.crud\('UserCategories', 'user-categories'/g).length, 1);
  assert.equal(api.match(/export default router;/g).length, 1);
  const migrations = fs.readdirSync(path.join(tmp, 'database', 'migrations')).filter((f) => f.endsWith('_Orders.js'));
  const seeds = fs.readdirSync(path.join(tmp, 'database', 'seeds')).filter((f) => f.endsWith('_Orders.js'));
  assert.equal(migrations.length, 1);
  assert.equal(seeds.length, 1);
  assert.equal(read('app/Models/index.js').match(/as Orders }/g).length, 1);

  // a new table next to existing ones only appends the new block
  await run('make:crud', 'orders,refunds', '--force');
  const updated = read('routes/api.js');
  assert.equal(updated.match(/router\.crud\('Orders'/g).length, 1);
  assert.equal(updated.match(/router\.crud\('Refunds', 'refunds'/g).length, 1);
});

/* C-e: titleCase keeps inner capitals ---------------------------------------- */

test('C-e: titleCase keeps inner capitals; snake_case and kebab-case become PascalCase', async () => {
  assert.equal(titleCase('userCategories'), 'UserCategories');
  assert.equal(titleCase('user_categories'), 'UserCategories');
  assert.equal(titleCase('user-categories'), 'UserCategories');
  assert.equal(titleCase('users'), 'Users');
  assert.equal(titleCase('blog_postTags'), 'BlogPostTags');

  await run('make:crud', 'productTypes');
  assert.match(read('app/Models/ProductTypes.js'), /class ProductTypes/);
  assert.match(read('app/Models/ProductTypes.js'), /static tableName = 'productTypes'/);
  assert.match(read('routes/api.js'), /router\.crud\('ProductTypes', 'productTypes'/);
});

/* C-h: --version comes from package.json ------------------------------------- */

test('C-h: averoa --version prints the package.json version', async () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(buildProgram().version(), pkg.version);
  let out = '';
  await assert.rejects(() => buildProgram().exitOverride()
    .configureOutput({ writeOut: (s) => { out += s; }, writeErr() {} })
    .parseAsync(['node', 'averoa', '--version']), (err) => err.code === 'commander.version');
  assert.equal(out.trim(), pkg.version);
});

/* C-j: generated crud controllers answer with Crud's statusCode -------------- */

test('C-j: generated crud controller responds with result.statusCode, 400 for a failure without one, 200 otherwise', async () => {
  await run('make:crud', 'tickets');
  const src = read('app/Controllers/TicketsController.js');
  assert.match(src, /import \{ Crud \} from '@averoa\/utilities';/);

  // load the generated controller with a stub Crud
  const stubbed = src.replace("import { Crud } from '@averoa/utilities';", 'const { Crud } = globalThis.__averoaCrudStub;');
  const file = path.join(tmp, 'TicketsController.stub.mjs');
  fs.writeFileSync(file, stubbed);
  let next;
  globalThis.__averoaCrudStub = {
    Crud: Object.fromEntries(['create', 'findAll', 'findOne', 'update', 'delete'].map((m) => [m, async () => next])),
  };
  const { default: controller } = await import(`${file}?t=${Date.now()}`);

  const call = async (method, result) => {
    next = result;
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    await controller[method]({}, res);
    return res;
  };

  const cases = [
    ['findAll', { status: true, data: [] }, 200],
    ['findOne', { status: false, message: 'Not Found', statusCode: 404 }, 404],
    ['create', { status: false, message: 'invalid', statusCode: 422 }, 422],
    ['findAll', { status: false, message: 'bad filter', statusCode: 400 }, 400],
    ['update', { status: false, message: 'boom', statusCode: 500 }, 500],
    ['delete', { status: false, message: 'no code' }, 400],
    ['delete', { status: true }, 200],
  ];
  for (const [method, result, expected] of cases) {
    const res = await call(method, result);
    assert.equal(res.statusCode, expected, `${method} ${JSON.stringify(result)}`);
    assert.deepEqual(res.body, result);
  }
  delete globalThis.__averoaCrudStub;
});

/* C-k: migrations use the knex 14-digit timestamp ---------------------------- */

test('C-k: make:crud names migrations and seeds YYYYMMDDHHMMSS_<Model>.js (knex format), ordered per table', async () => {
  assert.equal(migrationTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '20260102030405');

  const dir = path.join(tmp, 'database', 'migrations');
  const existing = new Set(fs.readdirSync(dir));
  const start = migrationTimestamp();
  await run('make:crud', 'alpha_items,beta_items,gamma_items');
  const created = fs.readdirSync(dir).filter((f) => !existing.has(f)).sort();
  assert.equal(created.length, 3);
  for (const f of created) assert.match(f, /^\d{14}_[A-Za-z]+\.js$/, f);
  assert.deepEqual(created.map((f) => f.replace(/^\d+_/, '')), ['AlphaItems.js', 'BetaItems.js', 'GammaItems.js'], 'sorted in the order given');
  assert.ok(created[0].slice(0, 14) >= start);
  // same width as knex's names, so they sort chronologically with knex-made ones
  const knexEarlier = '20000101000000_knex_made.js';
  const knexLater = '29991231235959_knex_made.js';
  assert.deepEqual(
    [knexLater, ...created, knexEarlier].sort(),
    [knexEarlier, ...created, knexLater],
  );

  const seeds = fs.readdirSync(path.join(tmp, 'database', 'seeds')).filter((f) => /_(Alpha|Beta|Gamma)Items\.js$/.test(f));
  assert.equal(seeds.length, 3);
  for (const f of seeds) assert.match(f, /^\d{14}_/);
});
