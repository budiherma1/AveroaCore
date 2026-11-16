import path from 'path';

/**
 * Edge view engine wiring for Express.
 *
 * Core does not create its own Edge instance: it uses the single shared
 * instance exported by @averoa/utilities as `View` (mounted at
 * resources/views, cache on in production). Everything here runs ONCE at
 * startup — not per request.
 */

/**
 * Convert a dot-notation view name to a path: 'users.list' → 'users/list'.
 * A trailing '.edge' extension is kept as the extension, and absolute paths
 * are left untouched.
 */
export function toViewPath(view) {
  if (typeof view !== 'string' || path.isAbsolute(view)) return view;
  const name = view.endsWith('.edge') ? view.slice(0, -'.edge'.length) : view;
  return name.replace(/\./g, '/');
}

/** App-level middleware: let `res.render('users.list')` use dot notation. */
export function dotNotation(req, res, next) {
  const render = res.render;
  res.render = function renderWithDots(view, ...args) {
    return render.call(this, toViewPath(view), ...args);
  };
  next();
}

/**
 * Register the `edge` engine on an express app.
 *
 * @param {import('express').Express} app
 * @param {object} View      the shared Edge instance (@averoa/utilities View)
 * @param {object} [options]
 * @param {string} options.views    absolute views directory (Edge's mount)
 * @param {object} [options.globals] globals to register once (ViewProvider.global())
 */
export function registerViewEngine(app, View, { views, globals } = {}) {
  if (!View || typeof View.render !== 'function') {
    throw new Error('@averoa/core: @averoa/utilities did not export a usable `View` (Edge instance)');
  }

  for (const [name, value] of Object.entries(globals ?? {})) {
    View.global(name, value);
  }

  app.set('views', views);
  app.set('view engine', 'edge');

  app.engine('edge', (filePath, options, callback) => {
    // Express hands us an absolute file path; Edge resolves names relative
    // to its mounted directory, so translate back to a template name.
    const relative = path.relative(views, filePath);
    const template = relative.startsWith('..') || path.isAbsolute(relative)
      ? filePath
      : relative.replace(/\.edge$/, '').split(path.sep).join('/');

    View.render(template, options).then(
      (html) => callback(null, html),
      (err) => callback(err),
    );
  });

  app.use(dotNotation);
}

export default registerViewEngine;
