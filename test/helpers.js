import path from 'path';
import { fileURLToPath } from 'url';

export const FIXTURE_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'app');

/** Listen on a random port; returns { url, close }. */
export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    }),
  };
}

/** Extract "name=value" pairs from set-cookie headers. */
export function cookiesFrom(res) {
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
