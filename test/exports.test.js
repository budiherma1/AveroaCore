import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { EXPORT_CHECKS_FILE, exportChecksSource } from '../scripts/export-names.mjs';

// test/types/exports.ts lists the runtime exports of every module; the
// typecheck compares it with the .d.ts files. Keep it in sync with the code.
test('test/types/exports.ts matches the runtime exports (run `npm run types:exports`)', async () => {
  assert.equal(fs.readFileSync(EXPORT_CHECKS_FILE, 'utf8'), await exportChecksSource());
});
