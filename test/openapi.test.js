import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { Validator } from '@seriousme/openapi-schema-validator';
import { listen } from './helpers.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'openapi-app');

process.env.AVEROA_ROOT = FIXTURE;
process.env.NODE_ENV = 'test';
delete process.env.OPENAPI_ENABLED;
delete process.env.OPENAPI_UI;
delete process.env.SESSION_SECRET;
delete process.env.CSRF_ENABLED;

const {
  createApp, closeLogStreams, isOpenApiEnabled, buildOpenApiDocument, modelSchemas,
} = await import('../index.js');
const { isOpenApiUiEnabled, docsContentSecurityPolicy, SWAGGER_UI } = await import('../openapi.js');
const { default: Item, Category } = await import(`${FIXTURE}/app/Models/Item.js`);

let srv;
let doc;

before(async () => {
  const { app } = await createApp();
  srv = await listen(app);
  const res = await fetch(`${srv.url}/api/openapi.json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  doc = await res.json();
});

after(async () => {
  await srv?.close();
  await closeLogStreams();
  const { DB } = await import('@averoa/utilities');
  await DB?.destroy?.();
});

test('the generated document is a valid OpenAPI 3.1 document', async () => {
  const validator = new Validator();
  const result = await validator.validate(doc);
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
  assert.equal(validator.version, '3.1');
  assert.equal(doc.openapi, '3.1.0');
});

test('info comes from package.json, then AppProvider.openapi() customises the document', () => {
  assert.equal(doc.info.title, 'Fixture API');
  assert.equal(doc.info.version, '1.2.3');
  assert.equal(doc.info.description, 'Fixture app for the OpenAPI tests');
  assert.equal(typeof doc['x-route-count'], 'number');
});

test('paths: /api prefix, {param} syntax, excluded and all() routes are left out', () => {
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    '/api', '/api/auth/login', '/api/auth/me', '/api/files/{path}', '/api/items', '/api/items/{id}', '/api/public-inside',
  ]);
  assert.deepEqual(Object.keys(doc.paths['/api/items']).sort(), ['get', 'post']);
  assert.deepEqual(Object.keys(doc.paths['/api/items/{id}']).sort(), ['delete', 'get', 'put']);
  const wildcard = doc.paths['/api/files/{path}'].get.parameters[0];
  assert.equal(wildcard.in, 'path');
  assert.equal(wildcard.required, true);
});

test('validate() schemas document the body (built-in format) and query (zod) of a route', () => {
  const login = doc.paths['/api/auth/login'].post;
  assert.equal(login.summary, 'Log in');
  assert.deepEqual(login.tags, ['Auth']);
  assert.equal(login.operationId, 'AuthController.login');
  const body = login.requestBody.content['application/json'].schema;
  assert.deepEqual(body.required, ['email', 'password']);
  assert.deepEqual(body.properties.email, { type: 'string', format: 'email', description: 'Account email' });
  const redirect = login.parameters.find((p) => p.name === 'redirect');
  assert.equal(redirect.in, 'query');
  assert.equal(redirect.required, false);
  assert.equal(redirect.schema.type, 'string');
  assert.deepEqual(login.responses[422], { $ref: '#/components/responses/ValidationFailed' });
  assert.equal(login.responses[401].description, 'Invalid email or password');
  assert.equal(login.responses[200].description, 'Token issued');
  assert.equal(login.responses[200].content['application/json'].schema.properties.data.properties.token.type, 'string');
  assert.equal(login.security, undefined, 'no auth middleware on login');
});

test('routes behind AuthMiddleware get the JWT bearer scheme and a 401 response', () => {
  assert.deepEqual(doc.components.securitySchemes.bearerAuth, { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const me = doc.paths['/api/auth/me'].get;
  assert.deepEqual(me.security, [{ bearerAuth: [] }]);
  assert.deepEqual(me.responses[401], { $ref: '#/components/responses/Unauthorized' });
  assert.deepEqual(me.tags, ['Auth'], 'tag from the controller name');
  assert.equal(doc.paths['/api/public-inside'].get.security, undefined, 'doc({ security: false })');
  assert.deepEqual(doc.paths['/api/items'].post.security, [{ bearerAuth: [] }]);
  assert.equal(doc.paths['/api/items'].get.security, undefined);
});

test('crud routes: list with FilterSearch parameters and the { status, metadata, data } envelope', () => {
  const list = doc.paths['/api/items'].get;
  assert.equal(list.summary, 'List Item');
  assert.deepEqual(list.tags, ['Item']);
  const names = list.parameters.map((p) => p.name);
  for (const name of ['limit', 'page', 'orderBy', 'orderByDesc', 'groupBy', '$select', '$relations', '$relations-type', '$datatable', 'filters']) {
    assert.ok(names.includes(name), `${name} documented`);
  }
  assert.equal(names.includes('$withTrashed'), false, 'only when allowWithTrashed');
  const orderBy = list.parameters.find((p) => p.name === 'orderBy');
  assert.ok(orderBy.schema.enum.includes('name'));
  assert.ok(orderBy.schema.enum.includes('created_at'));
  assert.equal(orderBy.schema.enum.includes('secret'), false, 'hidden columns are not sortable');
  const filters = list.parameters.find((p) => p.name === 'filters');
  assert.equal(filters.style, 'form');
  assert.equal(filters.explode, true);
  const envelope = list.responses[200].content['application/json'].schema;
  assert.deepEqual(envelope.required, ['status', 'metadata', 'data']);
  assert.deepEqual(envelope.properties.metadata, { $ref: '#/components/schemas/Pagination' });
  assert.deepEqual(envelope.properties.data.items, { $ref: '#/components/schemas/Item' });
});

test('crud routes: findOne, multipart create, update and delete', () => {
  const one = doc.paths['/api/items/{id}'].get;
  assert.deepEqual(one.parameters[0], {
    name: 'id', in: 'path', required: true, schema: { type: 'integer' },
  });
  assert.deepEqual(one.responses[404], { $ref: '#/components/responses/NotFound' });

  const create = doc.paths['/api/items'].post;
  assert.deepEqual(Object.keys(create.requestBody.content), ['multipart/form-data']);
  assert.deepEqual(create.requestBody.content['multipart/form-data'].schema, { $ref: '#/components/schemas/ItemCreateForm' });
  assert.ok(create.responses['2XX']);
  assert.deepEqual(create.responses[422], { $ref: '#/components/responses/ValidationFailed' });

  const update = doc.paths['/api/items/{id}'].put;
  assert.deepEqual(update.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/ItemUpdate' });
  assert.equal(update.requestBody.required, false);

  const del = doc.paths['/api/items/{id}'].delete;
  assert.equal(del.summary, 'Remove an item');
  assert.equal(del.deprecated, true);
  assert.deepEqual(del.responses[200].content['application/json'].schema.properties, { status: { const: true } });
});

test('model schemas: types from migration hints, hidden columns excluded, uploads binary in multipart', () => {
  const read = doc.components.schemas.Item;
  assert.deepEqual(read.properties.id, { type: 'integer' });
  assert.deepEqual(read.properties.name, { type: 'string' });
  assert.deepEqual(read.properties.stock, { type: ['integer', 'null'] });
  assert.deepEqual(read.properties.active, { type: ['boolean', 'integer', 'null'] });
  assert.deepEqual(read.properties.kind, { type: ['string', 'null'], enum: ['a', 'b', null] });
  assert.deepEqual(read.properties.price, {}, 'decimal: no reliable type');
  assert.deepEqual(read.properties.note, { description: 'Free text' });
  assert.equal('secret' in read.properties, false);
  assert.deepEqual(read.properties.deleted_at, { type: ['string', 'null'] });

  const form = doc.components.schemas.ItemCreateForm;
  assert.deepEqual(form.properties.photo, { type: 'string', format: 'binary', contentMediaType: 'application/octet-stream' });
  assert.deepEqual(form.required, ['name', 'photo']);
  assert.deepEqual(form.properties.name, { type: 'string', maxLength: 50, description: 'unique; must be 1-50 characters' });
  assert.deepEqual(form.properties.tags, {}, 'json columns take any value');
  assert.equal('id' in form.properties, false);
  assert.equal('secret' in form.properties, false);

  const update = doc.components.schemas.ItemUpdate;
  assert.equal('photo' in update.properties, false, 'upload columns only in multipart bodies');
  assert.equal(update.required, undefined);

  // every model of app/Models/index.js is available for $ref
  assert.deepEqual(doc.components.schemas.Category.properties.name, { type: 'string' });
});

test('GET /api/docs serves Swagger UI with a page-specific CSP; other routes keep the helmet CSP', async () => {
  const res = await fetch(`${srv.url}/api/docs`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const csp = res.headers.get('content-security-policy');
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.match(csp, /script-src 'self' 'nonce-[^']+' https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.ok(html.includes(`nonce="${nonce}"`));
  assert.ok(html.includes(`src="${SWAGGER_UI.script}" integrity="${SWAGGER_UI.scriptIntegrity}"`));
  assert.ok(html.includes(SWAGGER_UI.styleIntegrity));
  assert.ok(html.includes('"/api/openapi.json"'));

  const other = await fetch(`${srv.url}/api`);
  assert.doesNotMatch(other.headers.get('content-security-policy'), /jsdelivr/);
  assert.notEqual(docsContentSecurityPolicy('a'), docsContentSecurityPolicy('b'));
});

test('validate() runs on the real route', async () => {
  const bad = await fetch(`${srv.url}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x', password: 'p' }),
  });
  assert.equal(bad.status, 422);
  assert.deepEqual(await bad.json(), { status: false, data: { column: 'email', message: ['email format required'], in: 'body' } });

  const ok = await fetch(`${srv.url}/api/auth/login?redirect=/home`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.io', password: 'p', admin: true }),
  });
  assert.deepEqual(await ok.json(), { status: true, data: { body: { email: 'a@b.io', password: 'p' }, query: { redirect: '/home' } } });
});

test('OPENAPI_ENABLED defaults to development/test only; OPENAPI_UI can turn the page off', () => {
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'test' }), true);
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'staging' }), false);
  assert.equal(isOpenApiEnabled({}), false);
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'production', OPENAPI_ENABLED: 'true' }), true);
  assert.equal(isOpenApiEnabled({ NODE_ENV: 'development', OPENAPI_ENABLED: 'false' }), false);
  assert.equal(isOpenApiUiEnabled({}), true);
  assert.equal(isOpenApiUiEnabled({ OPENAPI_UI: 'off' }), false);
});

test('OPENAPI_ENABLED=false: no /api/openapi.json and no /api/docs', async () => {
  process.env.OPENAPI_ENABLED = 'false';
  try {
    const { app } = await createApp();
    const s = await listen(app);
    try {
      assert.equal((await fetch(`${s.url}/api/openapi.json`)).status, 404);
      assert.equal((await fetch(`${s.url}/api/docs`)).status, 404);
    } finally {
      await s.close();
    }
  } finally {
    delete process.env.OPENAPI_ENABLED;
  }
});

test('OPENAPI_UI=false keeps the JSON document but not the page', async () => {
  process.env.OPENAPI_UI = 'false';
  try {
    const { app } = await createApp();
    const s = await listen(app);
    try {
      assert.equal((await fetch(`${s.url}/api/openapi.json`)).status, 200);
      assert.equal((await fetch(`${s.url}/api/docs`)).status, 404);
    } finally {
      await s.close();
    }
  } finally {
    delete process.env.OPENAPI_UI;
  }
});

test('buildOpenApiDocument: optional path variants, doc.request, plain routes and duplicates', async () => {
  const built = buildOpenApiDocument({
    prefix: '/v1',
    routes: [
      {
        method: 'get', path: '/a', openapiPath: '/a', params: [], handler: 'AController@one', middleware: [], middlewareEntries: [], doc: null,
      },
      {
        method: 'get', path: '/a', openapiPath: '/a', params: [], handler: 'AController@two', middleware: [], middlewareEntries: [], doc: null,
      },
      {
        method: 'post',
        path: '/b/:id',
        openapiPath: '/b/{id}',
        params: [{ name: 'id', wildcard: false }],
        handler: 'anonymous',
        middleware: ['AuthMiddleware'],
        middlewareEntries: [],
        doc: {
          request: {
            params: { type: 'object', properties: { id: { type: 'integer', description: 'The id' } } },
            headers: { type: 'object', properties: { 'x-trace': { type: 'string' } }, required: ['x-trace'] },
            body: { type: 'object', properties: { n: { type: 'number' } } },
          },
          security: [{ apiKey: [] }],
          parameters: [{ name: 'debug', in: 'query', schema: { type: 'boolean' } }],
        },
      },
    ],
  });
  assert.equal(built.paths['/v1/a'].get.operationId, 'AController.one', 'first route wins');
  const post = built.paths['/v1/b/{id}'].post;
  assert.equal(post.operationId, 'post_b_id');
  assert.deepEqual(post.parameters.find((p) => p.name === 'id'), {
    name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'The id',
  });
  assert.equal(post.parameters.find((p) => p.name === 'x-trace').required, true);
  assert.ok(post.parameters.find((p) => p.name === 'debug'));
  assert.deepEqual(post.security, [{ apiKey: [] }]);
  assert.equal(built.components.securitySchemes, undefined, 'bearerAuth only when used');
  assert.deepEqual(post.responses, { 200: { description: 'Success' } });
  assert.equal(post.requestBody.content['application/json'].schema.properties.n.type, 'number');
  assert.equal((await new Validator().validate(built)).valid, true);
});

test('modelSchemas works on a Model class directly', () => {
  const schemas = modelSchemas(Category);
  assert.deepEqual(schemas.read.properties.id, { type: 'integer' });
  assert.deepEqual(schemas.create.required, ['name']);
  assert.deepEqual(modelSchemas(Item).idSchema, { type: 'integer' });
});
