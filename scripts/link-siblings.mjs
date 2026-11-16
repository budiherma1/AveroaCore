#!/usr/bin/env node
/**
 * Dev helper: install the local sibling packages (../AveroaUtilities,
 * ../AveroaRoute) into node_modules without touching package.json, so the
 * tests run against the real @averoa/utilities 2.x and @averoa/routes 3.x
 * before they are published.
 *
 * `npm i --no-save ../AveroaUtilities` is a no-op here (npm 10 skips
 * packages that are also listed as peerDependencies), so instead:
 *   1. install the siblings' runtime dependencies with --no-save
 *   2. `npm pack` each sibling and unpack it into node_modules/@averoa/<name>
 *
 * Usage: node scripts/link-siblings.mjs   (re-run after every `npm install`)
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siblings = [
  { dir: path.resolve(root, '../AveroaUtilities'), name: 'utilities' },
  { dir: path.resolve(root, '../AveroaRoute'), name: 'routes' },
];

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const deps = [];
for (const s of siblings) {
  const pkg = JSON.parse(fs.readFileSync(path.join(s.dir, 'package.json'), 'utf8'));
  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) deps.push(`${name}@${range}`);
}
if (deps.length) run('npm', ['i', '--no-save', '--no-audit', '--no-fund', ...deps], root);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'averoa-pack-'));
for (const s of siblings) {
  const out = run('npm', ['pack', '--silent', '--pack-destination', tmp], s.dir).trim().split('\n').pop();
  const target = path.join(root, 'node_modules', '@averoa', s.name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  run('tar', ['-xzf', path.join(tmp, out), '-C', target, '--strip-components=1'], root);
  console.log(`linked @averoa/${s.name} from ${s.dir}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
