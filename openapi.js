import fs from 'fs';
import crypto from 'crypto';
import { appPath, importApp } from '@averoa/utilities/paths';
import { isDevelopmentEnv } from './cors.js';

/**
 * OpenAPI 3.1 document for the API routes (routes/api.js), built from
 * `router.describe()` of @averoa/routes, the Model `static column`
 * definitions, validate() middleware of @averoa/utilities and per-route
 * `.doc({...})` metadata.
 *
 * Served at GET /api/openapi.json (and a Swagger UI page at GET /api/docs)
 * when OPENAPI_ENABLED is true; default: on for NODE_ENV development/test only.
 */

export const OPENAPI_VERSION = '3.1.0';

/** Swagger UI served by the docs page, pinned with Subresource Integrity. */
export const SWAGGER_UI = Object.freeze({
  version: '5.34.1',
  script: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1/swagger-ui-bundle.js',
  scriptIntegrity: 'sha384-XFYN47VzPiDY6qPtxYKg0nqUeW/upo20xf1j2SUE7gT/i35FJB4cuS/71Iegzk8Z',
  style: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1/swagger-ui.css',
  styleIntegrity: 'sha384-4c3vsE5f+trhFyHrFrLM1fFGUn531NIaC7dcqEWIJdoRQJ5CkJbSuSCwXLpaS1KF',
});

const CDN_ORIGIN = 'https://cdn.jsdelivr.net';

/** Middleware names that mean "JWT bearer token required". */
export const DEFAULT_AUTH_MIDDLEWARE = Object.freeze(['AuthMiddleware']);

const TIMESTAMP_COLUMNS = ['created_at', 'created_by', 'updated_at', 'updated_by', 'deleted_at', 'deleted_by'];

const OPERATION_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

const envBool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
};

/** OPENAPI_ENABLED, default true only for NODE_ENV development/test. */
export function isOpenApiEnabled(env = process.env) {
  return envBool(env.OPENAPI_ENABLED, isDevelopmentEnv(env.NODE_ENV ?? ''));
}

/** OPENAPI_UI (the Swagger UI page), default true; only served when OPENAPI_ENABLED. */
export function isOpenApiUiEnabled(env = process.env) {
  return envBool(env.OPENAPI_UI, true);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStandardSchema = (v) => Boolean(v) && (typeof v === 'object' || typeof v === 'function')
  && typeof v['~standard']?.validate === 'function';

/** JSON Schema from a JSON Schema object or a Standard Schema validator that can produce one. */
function toJsonSchema(schema, io = 'input') {
  if (!schema) return undefined;
  if (isStandardSchema(schema)) {
    const converter = schema['~standard'].jsonSchema?.[io];
    if (typeof converter !== 'function') return undefined;
    try {
      const out = { ...converter({ target: 'draft-2020-12' }) };
      delete out.$schema;
      return out;
    } catch {
      return undefined;
    }
  }
  return isPlainObject(schema) ? schema : undefined;
}

/* -------------------------------------------------------------------------- */
/* Model → JSON Schema                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Run a column's `migration` against a recording fake knex table and return
 * the calls made: `[['string', ['name', 50]], ['nullable', []], ...]`.
 * Anything unusual (the migration throws, uses the result, ...) gives null.
 */
function recordMigration(def, column) {
  if (typeof def?.migration !== 'function') return null;
  const calls = [];
  const recorder = () => {
    const target = function averoaRecorder() {};
    const proxy = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return (...args) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
      apply() { return proxy; },
    });
    return proxy;
  };
  try {
    def.migration({ table: recorder(), knex: recorder(), column });
  } catch {
    return null;
  }
  return calls;
}

/**
 * `{ read, write }` JSON Schema of a column from its migration hint, or `{}`
 * when the type can't be derived reliably (decimal, json, specificType, a
 * column without `migration`, ...).
 */
function columnTypes(def, column) {
  const calls = recordMigration(def, column);
  if (!calls) return { read: {}, write: {}, nullable: true };
  const typeCall = calls.find(([, args]) => args[0] === column);
  if (!typeCall) return { read: {}, write: {}, nullable: true };
  const [method, args] = typeCall;
  const modifiers = new Set(calls.filter((c) => c !== typeCall).map(([m]) => m));
  let read = {};
  let write = {};
  let autoIncrement = false;

  switch (method) {
    case 'increments':
      read = { type: 'integer' };
      write = { type: 'integer' };
      autoIncrement = true;
      break;
    case 'bigIncrements':
      read = { type: 'integer', format: 'int64' };
      write = { type: 'integer', format: 'int64' };
      autoIncrement = true;
      break;
    case 'integer': case 'int': case 'smallint': case 'tinyint': case 'mediumint':
      read = { type: 'integer' };
      write = { type: 'integer' };
      break;
    case 'bigInteger': case 'bigint':
      read = { type: 'integer', format: 'int64' };
      write = { type: 'integer', format: 'int64' };
      break;
    case 'float': case 'double': case 'real':
      read = { type: 'number' };
      write = { type: 'number' };
      break;
    case 'string': case 'varchar': case 'char': {
      const max = Number.isInteger(args[1]) ? args[1] : 255;
      read = { type: 'string' };
      write = { type: 'string', maxLength: max };
      break;
    }
    case 'text': case 'mediumtext': case 'longtext': case 'time':
      read = { type: 'string' };
      write = { type: 'string' };
      break;
    case 'uuid':
      read = { type: 'string', format: 'uuid' };
      write = { type: 'string', format: 'uuid' };
      break;
    case 'boolean':
      // MySQL and SQLite return 0/1
      read = { type: ['boolean', 'integer'] };
      write = { type: 'boolean' };
      break;
    case 'date':
      read = { type: 'string' };
      write = { type: 'string', format: 'date' };
      break;
    case 'datetime': case 'timestamp': case 'dateTime':
      read = { type: 'string' };
      write = { type: 'string' };
      break;
    case 'enu': case 'enum':
      if (Array.isArray(args[1])) {
        read = { type: 'string', enum: [...args[1]] };
        write = { type: 'string', enum: [...args[1]] };
      }
      break;
    default:
      // decimal (a string on MySQL / PostgreSQL), json, binary, specificType, ...: undocumented type
      break;
  }
  const notNull = autoIncrement || modifiers.has('notNullable') || modifiers.has('primary');
  return { read, write, nullable: !notNull };
}

/** Add 'null' to a schema's type (OpenAPI 3.1 / JSON Schema style). */
function withNull(schema) {
  if (!schema.type) return schema;
  const types = [].concat(schema.type);
  if (!types.includes('null')) types.push('null');
  const out = { ...schema, type: types };
  if (out.enum) out.enum = [...out.enum, null];
  return out;
}

const hiddenOf = (Model) => (Array.isArray(Model?.hidden) ? Model.hidden : []);
const usesSoftDelete = (Model) => Model?.timestamp !== false;

function writableOf(Model) {
  if (typeof Model.writableColumns === 'function') return Model.writableColumns();
  const ids = [].concat(Model.idColumn ?? 'id');
  return Object.keys(Model.column ?? {}).filter((c) => !ids.includes(c) && !TIMESTAMP_COLUMNS.includes(c)
    && !hiddenOf(Model).includes(c));
}

/** Columns a client may select / filter / order by (FilterSearch allowedColumns). */
function filterableOf(Model) {
  const hidden = new Set(hiddenOf(Model));
  const columns = Object.keys(Model.column ?? {});
  if (usesSoftDelete(Model)) columns.push(...TIMESTAMP_COLUMNS);
  return [...new Set(columns)].filter((c) => !hidden.has(c));
}

function ruleDescription(def) {
  const parts = [];
  if (def?.flag?.unique === true) parts.push('unique');
  for (const rule of Array.isArray(def?.validation) ? def.validation : []) {
    if (typeof rule?.msg === 'string' && rule.msg) parts.push(rule.msg);
  }
  return parts.length ? parts.join('; ') : undefined;
}

/**
 * JSON Schemas of a Model: `read` (response rows: no hidden columns, audit
 * columns when soft delete is on), `create` / `update` for JSON bodies (the
 * writable columns, no upload columns) and `createForm` / `updateForm` for
 * multipart bodies (upload columns as binary).
 */
export function modelSchemas(Model) {
  const columns = Model.column ?? {};
  const hidden = new Set(hiddenOf(Model));
  const ids = [].concat(Model.idColumn ?? 'id');
  const types = {};
  for (const key of Object.keys(columns)) types[key] = columnTypes(columns[key], key);

  const read = { type: 'object', properties: {} };
  for (const key of Object.keys(columns)) {
    if (hidden.has(key)) continue;
    const def = columns[key] ?? {};
    let prop = { ...types[key].read };
    if (types[key].nullable && !ids.includes(key)) prop = withNull(prop);
    if (isPlainObject(def.openapi)) Object.assign(prop, def.openapi);
    read.properties[key] = prop;
  }
  if (usesSoftDelete(Model)) {
    for (const key of TIMESTAMP_COLUMNS) {
      if (hidden.has(key) || key in read.properties) continue;
      read.properties[key] = key.endsWith('_at') ? { type: ['string', 'null'] } : { type: ['integer', 'null'] };
    }
  }

  const writable = writableOf(Model);
  const body = (create, form) => {
    const schema = { type: 'object', properties: {} };
    const required = [];
    for (const key of writable) {
      const def = columns[key] ?? {};
      const upload = def.flag?.upload === true;
      if (upload && !form) continue; // upload columns are only read from multipart files
      let prop;
      if (upload) {
        prop = { type: 'string', format: 'binary', contentMediaType: 'application/octet-stream' };
      } else {
        prop = { ...types[key].write };
        if (def.flag?.json === true) prop = {};
        const description = ruleDescription(def);
        if (description) prop.description = description;
      }
      if (hidden.has(key)) prop.writeOnly = true;
      if (isPlainObject(def.openapi)) Object.assign(prop, def.openapi);
      schema.properties[key] = prop;
      if (create && def.flag?.required !== false) required.push(key);
    }
    if (required.length) schema.required = required;
    if (!create) {
      schema.description = 'Only the columns sent are validated and changed; required columns may not be empty.';
    }
    return schema;
  };

  return {
    read,
    create: body(true, false),
    update: body(false, false),
    createForm: body(true, true),
    updateForm: body(false, true),
    idSchema: ids.length === 1 && columns[ids[0]] ? { ...types[ids[0]].write } : {},
    filterable: filterableOf(Model),
  };
}

/* -------------------------------------------------------------------------- */
/* document builder                                                           */
/* -------------------------------------------------------------------------- */

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const responseRef = (name) => ({ $ref: `#/components/responses/${name}` });
const json = (schema) => ({ 'application/json': { schema } });

function baseComponents() {
  return {
    schemas: {
      Error: {
        type: 'object',
        required: ['status', 'message'],
        properties: { status: { const: false }, message: { type: 'string' } },
      },
      ValidationError: {
        type: 'object',
        required: ['status', 'data'],
        properties: {
          status: { const: false },
          data: {
            type: 'object',
            required: ['column', 'message'],
            properties: {
              column: { type: ['string', 'null'], description: 'First failing field (a dotted path for nested values).' },
              message: {
                description: "'required', or every failing rule's message.",
                oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
              },
              in: { type: 'string', enum: ['body', 'query', 'params', 'headers'], description: 'Set by validate() middleware.' },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        required: ['item_total', 'per_page', 'page_total', 'current_page', 'has_next_page', 'has_prev_page'],
        properties: {
          item_total: { type: 'integer' },
          per_page: { type: 'integer' },
          page_total: { type: 'integer' },
          current_page: { type: 'integer' },
          has_next_page: { type: 'boolean' },
          has_prev_page: { type: 'boolean' },
        },
      },
    },
    responses: {
      BadRequest: { description: 'Invalid request (for example an unknown filter column).', content: json(ref('Error')) },
      Unauthorized: { description: 'Missing or invalid bearer token.', content: json(ref('Error')) },
      NotFound: { description: 'No row with this id (or it is soft-deleted).', content: json(ref('Error')) },
      ValidationFailed: { description: 'Validation failed.', content: json(ref('ValidationError')) },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  };
}

const FILTER_DESCRIPTION = 'Filters as extra query keys: `column=value` (equals) or `column:op=value` with op one of '
  + '`eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `like`, `ilike`, `in` (comma separated), `notNull`, `isNull`, '
  + '`btwn` (two comma separated values) and `search` (words); `a|b:op=value` matches any of the columns.';

function listParameters(Model, info) {
  const columns = info.filterable;
  const columnSchema = columns.length ? { type: 'string', enum: columns } : { type: 'string' };
  const params = [
    {
      name: 'limit', in: 'query', description: 'Rows per page (0 = the maximum, 1000 by default).', schema: { type: 'integer', minimum: 0, default: 10 },
    },
    {
      name: 'page', in: 'query', description: 'Page number.', schema: { type: 'integer', minimum: 1, default: 1 },
    },
    {
      name: 'orderBy', in: 'query', description: 'Sort ascending by this column.', schema: columnSchema,
    },
    {
      name: 'orderByDesc', in: 'query', description: 'Sort descending by this column (wins over orderBy).', schema: columnSchema,
    },
    {
      name: 'groupBy', in: 'query', description: 'Group by this column.', schema: columnSchema,
    },
    {
      name: '$select', in: 'query', description: `Comma separated columns to return${columns.length ? ` (${columns.join(', ')})` : ''}.`, schema: { type: 'string' },
    },
  ];
  if (relationsAllowed(Model)) {
    params.push(
      {
        name: '$relations', in: 'query', description: 'Relation expression to load, e.g. `[rooms]` (only the relations the model allows).', schema: { type: 'string' },
      },
      {
        name: '$relations-type', in: 'query', description: '`join` allows filtering on `relation.column`.', schema: { type: 'string', enum: ['fetch', 'join'], default: 'fetch' },
      },
    );
  }
  if (Model.allowWithTrashed === true) {
    params.push({
      name: '$withTrashed', in: 'query', description: 'Include soft-deleted rows.', schema: { type: 'boolean' },
    });
  }
  params.push(
    {
      name: '$datatable', in: 'query', description: 'DataTables mode: answers `{ draw, recordsTotal, recordsFiltered, data }` instead of the envelope.', schema: { type: 'boolean' },
    },
    {
      name: '$draw', in: 'query', description: 'DataTables draw counter, echoed back in DataTables mode.', schema: { type: 'string' },
    },
    {
      name: 'filters',
      in: 'query',
      description: FILTER_DESCRIPTION,
      style: 'form',
      explode: true,
      schema: { type: 'object', additionalProperties: { type: 'string' } },
      example: {},
    },
  );
  return params;
}

function relationsAllowed(Model) {
  if (Model.allowGraph === false || Model.allowGraph === '') return false;
  if (Model.allowGraph) return true;
  try {
    const mappings = typeof Model.relationMappings === 'function' ? Model.relationMappings() : Model.relationMappings;
    return isPlainObject(mappings) && Object.keys(mappings).length > 0;
  } catch {
    return false;
  }
}

function findOneParameters(Model) {
  const params = [{
    name: '$select', in: 'query', description: 'Comma separated columns to return.', schema: { type: 'string' },
  }];
  if (relationsAllowed(Model)) {
    params.push({
      name: '$relations', in: 'query', description: 'Relation expression to load, e.g. `[rooms]`.', schema: { type: 'string' },
    });
  }
  return params;
}

/** Normalise a `doc().responses` entry into an OpenAPI Response Object. */
function responseObject(value, fallbackDescription) {
  if (typeof value === 'string') return { description: value };
  if (!isPlainObject(value)) return { description: fallbackDescription };
  if (value.$ref) return value;
  const { schema, ...rest } = value;
  const out = { description: fallbackDescription, ...rest };
  if (schema !== undefined && !out.content) {
    const converted = toJsonSchema(schema, 'output');
    if (converted) out.content = json(converted);
  }
  return out;
}

/** Turn an object JSON Schema into OpenAPI parameters. */
function objectParameters(schema, location) {
  if (!isPlainObject(schema?.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([name, prop]) => {
    const { description, ...rest } = isPlainObject(prop) ? prop : {};
    const param = {
      name, in: location, required: location === 'path' ? true : required.has(name), schema: rest,
    };
    if (description) param.description = description;
    return param;
  });
}

const SECTION_LOCATION = { params: 'path', query: 'query', headers: 'header' };

/** Merge parameters: later ones replace earlier ones with the same name + location. */
function mergeParameters(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const p of list ?? []) {
      if (!p) continue;
      map.set(p.$ref ? p.$ref : `${p.in}:${p.name}`, p);
    }
  }
  return [...map.values()];
}

function controllerTag(handler) {
  if (typeof handler !== 'string' || !handler.includes('@')) return undefined;
  const name = handler.split('@')[0].replace(/Controller$/, '');
  return name || undefined;
}

function operationIdFor(route) {
  const base = typeof route.handler === 'string' && route.handler.includes('@')
    ? route.handler.replace('@', '.')
    : `${route.method}${route.openapiPath.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}`;
  return base.replace(/[^A-Za-z0-9_.-]/g, '_');
}

const CRUD_SUMMARY = {
  list: (m) => `List ${m}`,
  findOne: (m) => `Get ${m} by id`,
  create: (m) => `Create ${m}`,
  update: (m) => `Update ${m}`,
  delete: (m) => `Delete ${m}`,
};

function crudKind(route) {
  const hasParams = route.params.length > 0;
  switch (route.method) {
    case 'get': return hasParams ? 'findOne' : 'list';
    case 'post': return 'create';
    case 'put': case 'patch': return 'update';
    case 'delete': return 'delete';
    default: return null;
  }
}

/** JSON Schemas of validate() middleware on the route (via @averoa/utilities describeValidation). */
function validationSchemas(route, describeValidation) {
  if (typeof describeValidation !== 'function') return [];
  const out = [];
  for (const entry of route.middlewareEntries ?? []) {
    if (typeof entry !== 'function') continue;
    const described = describeValidation(entry);
    if (described) out.push(described);
  }
  return out;
}

/**
 * Build the OpenAPI 3.1 document.
 *
 * @param {object} options
 * @param {Array<object>} options.routes  `router.describe()` of the API router
 * @param {string} [options.prefix='/api']  where the router is mounted
 * @param {object} [options.info]  OpenAPI info (default: name/version/description of the app's package.json)
 * @param {Record<string, Function>} [options.models]  extra models (e.g. app/Models/index.js) added to components
 * @param {string[]} [options.authMiddleware]  middleware names that require a bearer token
 * @param {Function} [options.describeValidation]  from @averoa/utilities
 * @returns {object}
 */
export function buildOpenApiDocument({
  routes = [],
  prefix = '/api',
  info,
  models = {},
  authMiddleware = DEFAULT_AUTH_MIDDLEWARE,
  describeValidation,
} = {}) {
  const components = baseComponents();
  const paths = {};
  const usedOperationIds = new Set();
  const modelNames = new Map(); // class -> component name
  const modelInfo = new Map(); // class -> modelSchemas()
  let usesBearer = false;

  const componentName = (name) => String(name).replace(/[^A-Za-z0-9_.-]/g, '_');

  const registerModel = (Model, name) => {
    if (typeof Model !== 'function') return null;
    if (modelNames.has(Model)) return modelNames.get(Model);
    let base = componentName(name || Model.name || 'Model');
    while (components.schemas[base]) base = `${base}_`;
    const schemas = modelSchemas(Model);
    modelNames.set(Model, base);
    modelInfo.set(Model, schemas);
    components.schemas[base] = schemas.read;
    return base;
  };
  const modelBody = (Model, kind) => {
    const name = modelNames.get(Model);
    const key = `${name}${kind[0].toUpperCase()}${kind.slice(1)}`;
    if (!components.schemas[key]) components.schemas[key] = modelInfo.get(Model)[kind];
    return ref(key);
  };

  for (const [name, Model] of Object.entries(models ?? {})) {
    if (Model && typeof Model === 'function' && Model.column) registerModel(Model, name);
  }

  const auth = new Set(authMiddleware);

  for (const route of routes) {
    if (!OPERATION_METHODS.has(route.method)) continue; // all(): no single OpenAPI operation
    const doc = route.doc ?? {};
    if (doc.exclude === true) continue;

    const fullPath = route.openapiPath === '/' ? (prefix || '/') : `${prefix}${route.openapiPath}`;
    paths[fullPath] ??= {};
    if (paths[fullPath][route.method]) continue; // Express answers with the first matching route
    const operation = {};

    const Model = route.modelClass && route.modelClass.column ? route.modelClass : null;
    const modelName = Model ? registerModel(Model, route.model) : null;
    const kind = Model ? crudKind(route) : null;

    // tags / summary / ids
    const tags = doc.tags ?? (modelName ? [modelName] : [controllerTag(route.handler)].filter(Boolean));
    if (tags.length) operation.tags = tags;
    const summary = doc.summary ?? (kind ? CRUD_SUMMARY[kind](modelName) : undefined);
    if (summary) operation.summary = summary;
    if (doc.description) operation.description = doc.description;
    let operationId = doc.operationId ?? operationIdFor(route);
    if (usedOperationIds.has(operationId)) {
      let n = 2;
      while (usedOperationIds.has(`${operationId}_${n}`)) n += 1;
      operationId = `${operationId}_${n}`;
    }
    usedOperationIds.add(operationId);
    operation.operationId = operationId;
    if (doc.deprecated) operation.deprecated = true;

    // parameters
    const modelMeta = Model ? modelInfo.get(Model) : null;
    const pathParams = route.params.map((p) => {
      const param = {
        name: p.name, in: 'path', required: true, schema: { type: 'string' },
      };
      if (Model && p.name === 'id' && modelMeta.idSchema.type) param.schema = { ...modelMeta.idSchema };
      if (p.wildcard) param.description = 'Wildcard: the rest of the path.';
      return param;
    });
    let crudParams = [];
    if (kind === 'list') crudParams = listParameters(Model, modelMeta);
    else if (kind === 'findOne') crudParams = findOneParameters(Model);

    const validations = validationSchemas(route, describeValidation);
    const validationParams = [];
    let validatedBody;
    for (const sections of validations) {
      for (const [section, location] of Object.entries(SECTION_LOCATION)) {
        validationParams.push(...objectParameters(sections[section], location));
      }
      if (sections.body) validatedBody = sections.body;
    }
    const docParams = [];
    for (const [section, location] of Object.entries(SECTION_LOCATION)) {
      docParams.push(...objectParameters(toJsonSchema(doc.request?.[section]), location));
    }
    const parameters = mergeParameters(pathParams, crudParams, validationParams, docParams, doc.parameters)
      // a path parameter must exist in the template
      .filter((p) => p.in !== 'path' || route.params.some((rp) => rp.name === p.name));
    if (parameters.length) operation.parameters = parameters;

    // request body
    const contentType = doc.request?.contentType ?? (route.form ? 'multipart/form-data' : 'application/json');
    let bodySchema = toJsonSchema(doc.request?.body) ?? validatedBody;
    if (!bodySchema && Model && (kind === 'create' || kind === 'update')) {
      bodySchema = modelBody(Model, `${kind}${route.form ? 'Form' : ''}`);
    }
    if (doc.requestBody) operation.requestBody = doc.requestBody;
    else if (bodySchema) {
      operation.requestBody = {
        required: kind !== 'update',
        content: { [contentType]: { schema: bodySchema } },
      };
    }

    // responses
    const responses = {};
    if (kind) {
      const row = ref(modelName);
      switch (kind) {
        case 'list':
          responses[200] = {
            description: `Paginated ${modelName} rows.`,
            content: json({
              type: 'object',
              required: ['status', 'metadata', 'data'],
              properties: { status: { const: true }, metadata: ref('Pagination'), data: { type: 'array', items: row } },
            }),
          };
          responses[400] = responseRef('BadRequest');
          break;
        case 'findOne':
          responses[200] = {
            description: `One ${modelName}.`,
            content: json({ type: 'object', required: ['status', 'data'], properties: { status: { const: true }, data: row } }),
          };
          responses[400] = responseRef('BadRequest');
          responses[404] = responseRef('NotFound');
          break;
        case 'create':
          responses['2XX'] = {
            description: `The created ${modelName} (200 or 201, depending on the controller).`,
            content: json({ type: 'object', required: ['status', 'data'], properties: { status: { const: true }, data: row } }),
          };
          responses[422] = responseRef('ValidationFailed');
          break;
        case 'update':
        case 'delete':
          responses[200] = {
            description: kind === 'update' ? 'Updated.' : 'Deleted (soft delete when the model has timestamps).',
            content: json({ type: 'object', required: ['status'], properties: { status: { const: true } } }),
          };
          responses[404] = responseRef('NotFound');
          if (kind === 'update') responses[422] = responseRef('ValidationFailed');
          break;
        default:
          break;
      }
    }
    if (validations.length) responses[422] ??= responseRef('ValidationFailed');

    // security
    let security;
    if (doc.security === false) security = undefined;
    else if (Array.isArray(doc.security)) security = doc.security;
    else if ((route.middleware ?? []).some((m) => auth.has(m))) security = [{ bearerAuth: [] }];
    if (security) {
      operation.security = security;
      if (security.some((s) => 'bearerAuth' in s)) {
        usesBearer = true;
        responses[401] ??= responseRef('Unauthorized');
      }
    }

    for (const [code, value] of Object.entries(doc.responses ?? {})) {
      responses[code] = responseObject(value, responses[code]?.description ?? 'Response');
    }
    if (!Object.keys(responses).some((code) => /^2/.test(code))) {
      responses[200] = { description: 'Success' };
    }
    operation.responses = responses;

    paths[fullPath][route.method] = operation;
  }

  for (const [p, item] of Object.entries(paths)) if (!Object.keys(item).length) delete paths[p];
  if (!usesBearer) delete components.securitySchemes;

  return {
    openapi: OPENAPI_VERSION,
    info: info ?? { title: 'API', version: '0.0.0' },
    paths,
    components,
  };
}

/* -------------------------------------------------------------------------- */
/* serving                                                                    */
/* -------------------------------------------------------------------------- */

function appInfo() {
  try {
    const pkg = JSON.parse(fs.readFileSync(appPath('package.json'), 'utf8'));
    const out = { title: pkg.name || 'API', version: String(pkg.version || '0.0.0') };
    if (pkg.description) out.description = pkg.description;
    return out;
  } catch {
    return { title: 'API', version: '0.0.0' };
  }
}

/**
 * Build the application's document: routes/api.js `describe()` (when the
 * router has one), the models of app/Models/index.js, then
 * `AppProvider.openapi(doc, { routes })` (return the document, changed or not).
 */
export async function createOpenApiDocument({ prefix = '/api', AppProvider = {}, utilities } = {}) {
  const mod = await importApp('routes/api.js', { optional: true });
  const router = mod?.default;
  let routes = [];
  if (router && typeof router.describe === 'function') {
    if (typeof router.init === 'function') await router.init();
    routes = router.describe();
  }
  const models = (await importApp('app/Models/index.js', { optional: true })) ?? {};
  const utils = utilities ?? await import('@averoa/utilities');
  let doc = buildOpenApiDocument({
    routes,
    prefix,
    info: appInfo(),
    models,
    describeValidation: utils.describeValidation,
  });
  if (typeof AppProvider.openapi === 'function') {
    const changed = await AppProvider.openapi(doc, { routes });
    if (changed !== undefined) doc = changed;
  }
  return doc;
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Content-Security-Policy of the docs page: the pinned CDN files, the page's own nonce, no eval. */
export function docsContentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${CDN_ORIGIN}`,
    `style-src 'self' 'unsafe-inline' ${CDN_ORIGIN}`,
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** Swagger UI page for `specUrl`. */
export function docsHtml({ specUrl, title = 'API documentation', nonce }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${SWAGGER_UI.style}" integrity="${SWAGGER_UI.styleIntegrity}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER_UI.script}" integrity="${SWAGGER_UI.scriptIntegrity}" crossorigin="anonymous"></script>
<script nonce="${nonce}">
window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl).replace(/</g, '\\u003c')}, dom_id: '#swagger-ui', deepLinking: true });
</script>
</body>
</html>`;
}

/**
 * Mount GET <prefix>/openapi.json and (unless OPENAPI_UI=false) GET <prefix>/docs.
 * The document is built on the first request and cached. Registered after the
 * app's API router, so an app route with the same path wins.
 */
export function mountOpenApi(app, {
  prefix = '/api', AppProvider = {}, utilities, ui = isOpenApiUiEnabled(),
} = {}) {
  let cached = null;
  const specPath = `${prefix}/openapi.json`;

  app.get(specPath, async (req, res) => {
    if (!cached) {
      cached = createOpenApiDocument({ prefix, AppProvider, utilities });
      cached.catch(() => { cached = null; });
    }
    res.set('Cache-Control', 'no-store');
    res.json(await cached);
  });

  if (ui) {
    app.get(`${prefix}/docs`, (req, res) => {
      const nonce = crypto.randomBytes(16).toString('base64');
      // replaces the app-wide helmet CSP for this page only
      res.set('Content-Security-Policy', docsContentSecurityPolicy(nonce));
      res.set('Cache-Control', 'no-store');
      res.type('html').send(docsHtml({ specUrl: specPath, title: `${appInfo().title} API`, nonce }));
    });
  }
}
