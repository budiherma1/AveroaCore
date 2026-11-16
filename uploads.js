import path from 'path';
import express from 'express';

/**
 * Static serving for user uploads (`/upload` → storages/upload).
 *
 * Uploaded files are user-controlled. Served inline from the app's own origin,
 * an uploaded .html / .svg / .js runs as same-origin script (stored XSS; the
 * app CSP's 'self' allows it). Every response from here therefore gets:
 *
 *   X-Content-Type-Options: nosniff
 *   Content-Security-Policy: default-src 'none'; sandbox
 *   Content-Disposition: attachment        (except allowlisted raster images)
 *
 * Only raster images are shown inline by default; everything else, SVG
 * included, is downloaded. Change the allowlist with
 * `AppProvider.uploads()` → `{ inlineExtensions: [...] }` or the env var
 * UPLOAD_INLINE_EXTENSIONS (comma separated, e.g. "jpg,png,pdf").
 * `AppProvider.uploads()` returning `false` disables the /upload route.
 */
export const DEFAULT_INLINE_EXTENSIONS = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico']);

export const UPLOAD_CSP = "default-src 'none'; sandbox";

const normalizeExt = (ext) => String(ext).trim().toLowerCase().replace(/^\.+/, '');

/**
 * Resolve the inline allowlist.
 * Priority: `inlineExtensions` (from AppProvider.uploads()) → UPLOAD_INLINE_EXTENSIONS → defaults.
 * @returns {Set<string>} lower-case extensions without the dot
 */
export function resolveInlineExtensions({
  inlineExtensions,
  env = process.env.UPLOAD_INLINE_EXTENSIONS,
} = {}) {
  let list = inlineExtensions;
  if (!Array.isArray(list)) {
    list = (env !== undefined && String(env).trim() !== '')
      ? String(env).split(',')
      : DEFAULT_INLINE_EXTENSIONS;
  }
  return new Set(list.map(normalizeExt).filter(Boolean));
}

/**
 * express.static for uploads with the safe headers above.
 * @param {string} dir
 * @param {{ inlineExtensions?: string[], env?: string }} [options]
 */
export function uploadStatic(dir, options = {}) {
  const inline = resolveInlineExtensions(options);
  return express.static(dir, {
    setHeaders(res, filePath) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', UPLOAD_CSP);
      const ext = normalizeExt(path.extname(filePath));
      if (!ext || !inline.has(ext)) res.attachment(path.basename(filePath));
    },
  });
}

export default uploadStatic;
