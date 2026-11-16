/**
 * Health endpoints.
 *
 * - GET /health (liveness): 200 `{ "status": "ok" }` whenever the process
 *   serves requests. No dependency is checked, so a database outage never
 *   gets the container restarted.
 * - GET /ready (readiness): runs the checks (the database by default) with a
 *   timeout each; 200 `{ status: 'ok', checks }` when every critical check
 *   passes, else 503 `{ status: 'error', checks }`. From the moment a graceful
 *   shutdown starts it answers 503 `{ status: 'shutting_down' }`, so load
 *   balancers stop sending traffic before the server closes.
 *
 * Both answer GET and HEAD with `Cache-Control: no-store`. Core mounts them
 * right after the request-id middleware, before AppProvider.beginning(),
 * the access log, helmet, CORS, body parsing, sessions, CSRF and any rate
 * limiter, so probes create no session, need no CSRF token, are not rate
 * limited and are not written to the access log.
 *
 * Environment:
 * - HEALTH_PATH    liveness path (default /health); false/off/none disables it
 * - READY_PATH     readiness path (default /ready); false/off/none disables it
 * - READY_TIMEOUT  per-check timeout in ms (default 2000)
 * - READY_CHECKS   built-in checks, comma separated: database (default), queue
 *                  (RabbitMQ connection of @averoa/utilities); `none` for none
 *
 * AppProvider.health(checks) receives the built-in checks
 * (`{ database: fn }`) and returns the checks to run: add your own (Redis,
 * an upstream API), remove some, or return `false` to disable both endpoints.
 * A check is `async ({ signal, timeout }) => any` (throwing, rejecting,
 * timing out or returning `false` means down) or
 * `{ check, timeout?, critical? }` (`critical: false` reports the check
 * without failing readiness).
 */

const DISABLED = new Set(['false', 'off', 'none', '0', 'disabled']);

const isDevelopmentEnv = () => process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

/** A probe path from the environment: fallback when unset, null when disabled. */
export function probePath(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const raw = String(value).trim();
  if (raw === '') return fallback;
  if (DISABLED.has(raw.toLowerCase())) return null;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** Health settings from the environment. */
export function healthSettings(env = process.env) {
  const timeout = Number(env.READY_TIMEOUT);
  const checks = String(env.READY_CHECKS ?? '').trim().toLowerCase();
  let builtIn = ['database'];
  if (checks !== '') {
    builtIn = DISABLED.has(checks) ? [] : checks.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return {
    livenessPath: probePath(env.HEALTH_PATH, '/health'),
    readinessPath: probePath(env.READY_PATH, '/ready'),
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 2000,
    builtIn,
  };
}

/** The cheapest query that works on the dialect. */
function pingSql(knex) {
  const client = String(knex?.client?.config?.client ?? knex?.client?.dialect ?? '').toLowerCase();
  return client.includes('oracle') ? 'select 1 from dual' : 'select 1';
}

/** Built-in database check: `select 1` on the app's knex instance. */
export function databaseCheck(getKnex) {
  return async function database() {
    const knex = await getKnex();
    if (!knex?.raw) throw new Error('no database configured');
    await knex.raw(pingSql(knex));
  };
}

/** Built-in queue check: opens (or reuses) the shared AMQP connection of @averoa/utilities. */
export function queueCheck(loadQueue = () => import('@averoa/utilities/Queue.js')) {
  return async function queue() {
    const { getConnection } = await loadQueue();
    await getConnection();
  };
}

function withTimeout(promise, ms, controller) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error(`timed out after ${ms}ms`);
        err.code = 'ETIMEDOUT';
        reject(err);
      }, ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

const normaliseCheck = (value) => {
  if (typeof value === 'function') return { check: value, critical: true };
  if (value && typeof value.check === 'function') return { critical: true, ...value };
  return null;
};

/**
 * Build the health state and middleware.
 *
 * @param {object} options
 * @param {() => Promise<object>} [options.getKnex]  resolves the knex instance
 * @param {object}  [options.AppProvider]
 * @param {object}  [options.log]
 * @param {object}  [options.settings]  defaults to healthSettings()
 */
export async function createHealth({
  getKnex = async () => undefined,
  AppProvider = {},
  log = console,
  settings = healthSettings(),
} = {}) {
  const defaults = {};
  for (const name of settings.builtIn) {
    if (name === 'database') defaults.database = databaseCheck(getKnex);
    else if (name === 'queue') defaults.queue = queueCheck();
    else log.warn?.(`@averoa/core: unknown READY_CHECKS entry "${name}" (expected database, queue or none)`);
  }

  let configured = defaults;
  if (typeof AppProvider.health === 'function') {
    const returned = await AppProvider.health({ ...defaults });
    if (returned === false) configured = false;
    else if (returned && typeof returned === 'object') configured = returned;
  }

  const enabled = configured !== false;
  const checks = {};
  if (enabled) {
    for (const [name, value] of Object.entries(configured)) {
      const check = normaliseCheck(value);
      if (check) checks[name] = check;
      else if (value !== false && value !== null && value !== undefined) {
        log.warn?.(`@averoa/core: health check "${name}" is not a function or { check }; ignored`);
      }
    }
  }

  const livenessPath = enabled ? settings.livenessPath : null;
  const readinessPath = enabled ? settings.readinessPath : null;

  const state = { shuttingDown: false };
  const lastStatus = new Map();
  let running = null;

  async function runCheck(name, { check, timeout = settings.timeout, critical }) {
    const started = process.hrtime.bigint();
    const controller = new AbortController();
    let status = 'up';
    let error;
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => check({ signal: controller.signal, timeout })),
        timeout,
        controller,
      );
      if (result === false) {
        status = 'down';
        error = new Error('check returned false');
      }
    } catch (err) {
      status = 'down';
      error = err;
    }
    const durationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100;

    // log transitions only, not every failing probe
    const previous = lastStatus.get(name);
    if (previous !== status) {
      lastStatus.set(name, status);
      if (status === 'down') log.warn?.(`@averoa/core: readiness check "${name}" is down: ${error?.message ?? error}`);
      else if (previous === 'down') log.info?.(`@averoa/core: readiness check "${name}" is up again`);
    }

    const out = { status, durationMs };
    if (!critical) out.critical = false;
    if (error) {
      // details only for development/test; elsewhere just the kind of failure
      out.error = isDevelopmentEnv() ? String(error?.message ?? error) : (error?.code === 'ETIMEDOUT' ? 'timeout' : 'failed');
    }
    return [name, out];
  }

  /** Run every check (concurrent probes share one run). */
  function readiness() {
    if (!running) {
      running = (async () => {
        const results = Object.fromEntries(await Promise.all(
          Object.entries(checks).map(([name, check]) => runCheck(name, check)),
        ));
        const ok = Object.entries(results).every(([name, r]) => r.status === 'up' || !checks[name].critical);
        return { ok, body: { status: ok ? 'ok' : 'error', checks: results } };
      })().finally(() => { running = null; });
    }
    return running;
  }

  const send = (req, res, status, body) => {
    res.status(status).set('Cache-Control', 'no-store');
    return res.json(body);
  };

  async function middleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (livenessPath && req.path === livenessPath) {
      return send(req, res, 200, { status: 'ok' });
    }
    if (readinessPath && req.path === readinessPath) {
      if (state.shuttingDown) return send(req, res, 503, { status: 'shutting_down' });
      try {
        const { ok, body } = await readiness();
        if (state.shuttingDown) return send(req, res, 503, { status: 'shutting_down' });
        return send(req, res, ok ? 200 : 503, body);
      } catch (err) {
        return next(err);
      }
    }
    return next();
  }

  return {
    middleware,
    checks,
    livenessPath,
    readinessPath,
    /** True once markShuttingDown() was called. */
    get shuttingDown() {
      return state.shuttingDown;
    },
    /** Readiness answers 503 from now on (graceful shutdown). */
    markShuttingDown() {
      state.shuttingDown = true;
    },
    /** Run the readiness checks programmatically. */
    readiness,
    /** True for the configured probe paths (for middleware that should skip them). */
    isHealthCheckPath(path) {
      return Boolean(path) && (path === livenessPath || path === readinessPath);
    },
  };
}

export default createHealth;
