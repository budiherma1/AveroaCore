import fs from 'fs';
import path from 'path';
import morgan from 'morgan';
import { appPath } from '@averoa/utilities/paths';

/**
 * HTTP request logging.
 *
 * Where (LOG_CHANNEL, shared with Log of @averoa/utilities):
 * - unset (2.0 behaviour) or `file`:
 *   - storages/logs/access.log: every request
 *   - storages/logs/error.log:  responses with status >= 400
 *   - unset only: the console (dev format) outside production and test
 * - `stdout`: one line per request on stdout, no files (containers)
 * - `both`:   the files and stdout
 *
 * Format (ACCESS_LOG_FORMAT):
 * - files: `combined` (default) or `json`
 * - stdout: `json`, `combined` or `dev`; default follows LOG_FORMAT (json
 *   unless NODE_ENV is development or test, where it is `dev`)
 * A JSON line holds timestamp, level, message, type 'access', requestId,
 * method, path (without the query string), status, durationMs, ip (req.ip,
 * so it follows TRUST_PROXY), userAgent and contentLength.
 *
 * The log directory is created when missing. The file streams are opened once
 * per process (per file) and shared by every app built with createApp(), so
 * building the app repeatedly (e.g. in tests) does not leak file handles.
 * closeLogStreams() closes them (start() calls it on graceful shutdown); a
 * later request reopens them.
 */
const streams = new Map();

const logStream = (file) => {
  const existing = streams.get(file);
  const usable = existing && !existing.destroyed && !existing.closed && !existing.writableEnded;
  if (usable) return existing;
  const stream = fs.createWriteStream(file, { flags: 'a' });
  streams.set(file, stream);
  return stream;
};

/** The log streams currently open, keyed by absolute file path. */
export const getLogStreams = () => new Map(streams);

/** Close every log stream opened by setMorgan(); the next app opens new ones. */
export async function closeLogStreams() {
  const open = [...streams.values()];
  streams.clear();
  await Promise.all(open.map((stream) => new Promise((resolve) => {
    if (stream.closed || stream.destroyed) {
      resolve();
      return;
    }
    stream.once('close', () => resolve());
    stream.once('error', () => resolve());
    stream.end();
  })));
}

const CHANNELS = new Set(['stdout', 'file', 'both']);
const FORMATS = new Set(['combined', 'json', 'dev']);
const isDevelopmentEnv = (env) => env === 'development' || env === 'test';

/** Access log settings from the environment. */
export function accessLogSettings(env = process.env) {
  const channel = String(env.LOG_CHANNEL ?? '').trim().toLowerCase();
  const format = String(env.ACCESS_LOG_FORMAT ?? '').trim().toLowerCase();
  const logFormat = String(env.LOG_FORMAT ?? '').trim().toLowerCase();
  let consoleDefault = isDevelopmentEnv(env.NODE_ENV) ? 'dev' : 'json';
  if (logFormat === 'json') consoleDefault = 'json';
  else if (logFormat === 'pretty') consoleDefault = 'dev';
  return {
    channel: CHANNELS.has(channel) ? channel : null,
    fileFormat: format === 'json' ? 'json' : 'combined',
    consoleFormat: FORMATS.has(format) ? format : consoleDefault,
  };
}

const levelOf = (status) => {
  if (!status || status >= 500) return 'error';
  return status >= 400 ? 'warn' : 'info';
};

/** morgan format function producing one JSON line per request. */
export function jsonAccessFormat(tokens, req, res) {
  const status = res.headersSent ? res.statusCode : null;
  const urlPath = (req.originalUrl || req.url || '').split('?')[0];
  const duration = Number(tokens['total-time']?.(req, res, 3) ?? tokens['response-time'](req, res, 3));
  const length = Number(res.getHeader('content-length'));
  const entry = {
    timestamp: new Date().toISOString(),
    level: levelOf(status),
    message: `${req.method} ${urlPath} ${status ?? '-'}`,
    type: 'access',
    requestId: req.id,
    method: req.method,
    path: urlPath,
    status,
    durationMs: Number.isFinite(duration) ? duration : null,
    ip: req.ip ?? req.socket?.remoteAddress,
    userAgent: req.get?.('user-agent'),
  };
  if (Number.isFinite(length)) entry.contentLength = length;
  return JSON.stringify(entry);
}

// Query strings are left out of every access log format: they carry tokens
// (?token= in email links, signed URLs) that must not end up in log files.
const withoutQuery = (url) => String(url ?? '').split(/[?#]/)[0];
morgan.token('averoa-path', (req) => withoutQuery(req.originalUrl || req.url));
morgan.token('averoa-referrer', (req) => withoutQuery(req.headers.referer || req.headers.referrer) || undefined);

/** Apache `combined` without query strings (path and referrer). */
export const COMBINED_FORMAT = ':remote-addr - :remote-user [:date[clf]] ":method :averoa-path HTTP/:http-version" '
  + ':status :res[content-length] ":averoa-referrer" ":user-agent"';
/** morgan's `dev` line without the query string (and without colours). */
export const DEV_FORMAT = ':method :averoa-path :status :response-time ms - :res[content-length]';

const morganFormat = (format) => {
  if (format === 'json') return jsonAccessFormat;
  if (format === 'combined') return COMBINED_FORMAT;
  if (format === 'dev') return DEV_FORMAT;
  return format;
};

/**
 * @param {import('express').Express} app
 * @param {object} [options]
 * @param {string} [options.env]      NODE_ENV
 * @param {'stdout'|'file'|'both'|null} [options.channel] default LOG_CHANNEL
 * @param {'combined'|'json'} [options.fileFormat]       default ACCESS_LOG_FORMAT
 * @param {'combined'|'json'|'dev'} [options.consoleFormat] default ACCESS_LOG_FORMAT / LOG_FORMAT
 * @param {{ write(line: string): void }} [options.stdout] default process.stdout
 */
const setMorgan = (app, options = {}) => {
  const settings = accessLogSettings();
  const env = options.env ?? process.env.NODE_ENV;
  const channel = options.channel === undefined ? settings.channel : options.channel;
  const fileFormat = morganFormat(options.fileFormat ?? settings.fileFormat);
  const consoleFormat = morganFormat(options.consoleFormat ?? settings.consoleFormat);
  const stdout = options.stdout ?? process.stdout;

  let accessLogStream;
  let errorLogStream;
  if (channel !== 'stdout') {
    const dir = appPath('storages', 'logs');
    fs.mkdirSync(dir, { recursive: true });

    const accessLog = path.join(dir, 'access.log');
    const errorLog = path.join(dir, 'error.log');
    accessLogStream = logStream(accessLog);
    errorLogStream = logStream(errorLog);

    // Look the stream up on every write: after closeLogStreams() an app that is
    // still serving reopens the file instead of writing to a closed stream.
    const writer = (file) => ({ write: (line) => logStream(file).write(line) });

    app.use(morgan(fileFormat, { stream: writer(accessLog) }));
    app.use(morgan(fileFormat, {
      stream: writer(errorLog),
      skip: (req, res) => res.statusCode < 400,
    }));
  }

  if (channel === 'stdout' || channel === 'both') {
    app.use(morgan(consoleFormat, { stream: { write: (line) => stdout.write(line) } }));
  } else if (channel === null && env !== 'production' && env !== 'test') {
    app.use(morgan(DEV_FORMAT));
  }

  return { accessLogStream, errorLogStream };
};

export default setMorgan;
