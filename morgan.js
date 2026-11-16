import fs from 'fs';
import path from 'path';
import morgan from 'morgan';
import { appPath } from '@averoa/utilities/paths';

/**
 * HTTP request logging.
 *
 * - storages/logs/access.log: every request (combined format)
 * - storages/logs/error.log:  responses with status >= 400
 * - console (dev format) outside production and test
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
  if (existing && !existing.destroyed && !existing.closed && !existing.writableEnded) return existing;
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

const setMorgan = (app, { env = process.env.NODE_ENV } = {}) => {
  const dir = appPath('storages', 'logs');
  fs.mkdirSync(dir, { recursive: true });

  const accessLog = path.join(dir, 'access.log');
  const errorLog = path.join(dir, 'error.log');
  const accessLogStream = logStream(accessLog);
  const errorLogStream = logStream(errorLog);

  // Look the stream up on every write: after closeLogStreams() an app that is
  // still serving reopens the file instead of writing to a closed stream.
  const writer = (file) => ({ write: (line) => logStream(file).write(line) });

  app.use(morgan('combined', { stream: writer(accessLog) }));
  app.use(morgan('combined', {
    stream: writer(errorLog),
    skip: (req, res) => res.statusCode < 400,
  }));

  if (env !== 'production' && env !== 'test') {
    app.use(morgan('dev'));
  }

  return { accessLogStream, errorLogStream };
};

export default setMorgan;
