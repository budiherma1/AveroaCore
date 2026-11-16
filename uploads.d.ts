import type { RequestHandler } from 'express';

export interface UploadsOptions {
  /** Extensions served inline (without the dot); everything else is downloaded. */
  inlineExtensions?: string[];
}

export interface UploadStaticOptions extends UploadsOptions {
  /** Default UPLOAD_INLINE_EXTENSIONS. */
  env?: string;
}

/** Raster image extensions served inline by default. */
export const DEFAULT_INLINE_EXTENSIONS: readonly string[];
/** CSP of every upload response. */
export const UPLOAD_CSP: string;

/**
 * The inline allowlist: `inlineExtensions`, then UPLOAD_INLINE_EXTENSIONS,
 * then the defaults. Lower-case extensions without the dot.
 */
export function resolveInlineExtensions(options?: UploadStaticOptions): Set<string>;
/** `express.static` for uploads with nosniff, a sandbox CSP and attachment downloads. */
export function uploadStatic(dir: string, options?: UploadStaticOptions): RequestHandler;

export default uploadStatic;
