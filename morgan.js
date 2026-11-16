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
 * The log directory is created when missing.
 */
const setMorgan = (app, { env = process.env.NODE_ENV } = {}) => {
  const dir = appPath('storages', 'logs');
  fs.mkdirSync(dir, { recursive: true });

  const accessLogStream = fs.createWriteStream(path.join(dir, 'access.log'), { flags: 'a' });
  const errorLogStream = fs.createWriteStream(path.join(dir, 'error.log'), { flags: 'a' });

  app.use(morgan('combined', { stream: accessLogStream }));
  app.use(morgan('combined', {
    stream: errorLogStream,
    skip: (req, res) => res.statusCode < 400,
  }));

  if (env !== 'production' && env !== 'test') {
    app.use(morgan('dev'));
  }

  return { accessLogStream, errorLogStream };
};

export default setMorgan;
