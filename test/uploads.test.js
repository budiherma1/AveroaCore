import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { resolveInlineExtensions, uploadStatic, DEFAULT_INLINE_EXTENSIONS } from '../uploads.js';
import { listen } from './helpers.js';

test('C1: default inline allowlist is raster images only (no svg)', () => {
  const set = resolveInlineExtensions({ env: undefined });
  assert.deepEqual([...set].sort(), [...DEFAULT_INLINE_EXTENSIONS].sort());
  assert.equal(set.has('svg'), false);
  assert.equal(set.has('html'), false);
});

test('C1: UPLOAD_INLINE_EXTENSIONS overrides the defaults; provider list wins over env', () => {
  assert.deepEqual([...resolveInlineExtensions({ env: ' .PNG, pdf ,' })], ['png', 'pdf']);
  assert.deepEqual([...resolveInlineExtensions({ env: 'png', inlineExtensions: ['jpg'] })], ['jpg']);
  assert.deepEqual([...resolveInlineExtensions({ env: '' })].sort(), [...DEFAULT_INLINE_EXTENSIONS].sort());
});

test('C1: uploadStatic honours the env allowlist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'averoa-upload-'));
  fs.writeFileSync(path.join(dir, 'a.pdf'), '%PDF-1.4');
  fs.writeFileSync(path.join(dir, 'b.png'), 'png');
  const app = express();
  app.use('/upload', uploadStatic(dir, { env: 'pdf' }));
  const srv = await listen(app);
  try {
    let res = await fetch(`${srv.url}/upload/a.pdf`);
    assert.equal(res.headers.get('content-disposition'), null);
    assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    res = await fetch(`${srv.url}/upload/b.png`);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename="?b\.png"?/);
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
