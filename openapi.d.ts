import type { Express } from 'express';
import type { EnvVars } from './env.js';

/** A JSON Schema (draft 2020-12, as used by OpenAPI 3.1). */
export type JsonSchema = { [keyword: string]: unknown };

/**
 * A JSON Schema, or a Standard Schema validator that can export one (e.g.
 * zod 4.2+). Validators without JSON Schema support are ignored.
 */
export type SchemaInput = JsonSchema | object;

/** The OpenAPI 3.1 document core generates. Extra keys (servers, ...) may be added. */
export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    [key: string]: unknown;
  };
  paths: { [path: string]: { [method: string]: { [key: string]: unknown } } };
  components: {
    schemas: { [name: string]: JsonSchema };
    responses?: { [name: string]: unknown };
    parameters?: { [name: string]: unknown };
    securitySchemes?: { [name: string]: unknown };
    [key: string]: unknown;
  };
  servers?: Array<{ url: string; description?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** A `doc().responses` entry: a description, `{ description, schema }` or an OpenAPI Response Object. */
export type RouteDocResponse = string | {
  description?: string;
  schema?: SchemaInput;
  [key: string]: unknown;
};

/** Keys of `router.doc({...})` that core reads. */
export interface RouteDoc {
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  tags?: string[];
  /** `false` documents the route as public; an array replaces the detected requirement. */
  security?: false | Array<{ [scheme: string]: string[] }>;
  request?: {
    body?: SchemaInput;
    query?: SchemaInput;
    params?: SchemaInput;
    headers?: SchemaInput;
    contentType?: string;
  };
  responses?: { [status: string]: RouteDocResponse };
  /** Raw OpenAPI parameters, merged by name and location. */
  parameters?: unknown[];
  /** Raw OpenAPI request body (replaces the generated one). */
  requestBody?: unknown;
  /** `true` leaves the route out of the document. */
  exclude?: boolean;
}

/**
 * A model class (Objection model of @averoa/utilities). Its `static column`
 * definitions, `idColumn` and hidden columns feed the schemas.
 */
export type ModelClass = abstract new (...args: never[]) => unknown;

/** One entry of `router.describe()` (@averoa/routes), as far as core reads it. */
export interface RouteDescription {
  /** Lower-case verb (`get`, `post`, ..., or `all`). */
  method: string;
  /** Full Express path (relative to the mount point). */
  path?: string;
  /** The path as an OpenAPI template (`/teachers/{id}`). */
  openapiPath: string;
  params: ReadonlyArray<{ name: string; wildcard?: boolean }>;
  /** `'Controller@method'`, the function's name, or `'anonymous'`. */
  handler?: unknown;
  /** Middleware names in run order. */
  middleware?: readonly unknown[];
  /** The middleware chain as declared. */
  middlewareEntries?: readonly unknown[];
  model?: string | null;
  modelClass?: unknown;
  hooks?: readonly string[];
  form?: boolean;
  doc?: RouteDoc | object | null;
}

/** JSON Schemas of a model. */
export interface ModelSchemas {
  /** Response rows: no hidden columns, audit columns when soft delete is on. */
  read: JsonSchema;
  /** JSON body for create (writable columns, no upload columns). */
  create: JsonSchema;
  /** JSON body for update. */
  update: JsonSchema;
  /** Multipart body for create (upload columns as binary). */
  createForm: JsonSchema;
  /** Multipart body for update. */
  updateForm: JsonSchema;
  /** Schema of the id path parameter. */
  idSchema: JsonSchema;
  /** Columns a client may select, filter and order by. */
  filterable: string[];
}

export interface BuildOpenApiDocumentOptions {
  /** `router.describe()` of the API router. */
  routes?: readonly RouteDescription[];
  /** Where the router is mounted (default `'/api'`). */
  prefix?: string;
  /** OpenAPI info (default `{ title: 'API', version: '0.0.0' }`). */
  info?: OpenApiDocument['info'];
  /** Extra models (e.g. the exports of app/Models/index.js); non-classes are ignored. */
  models?: { readonly [name: string]: unknown };
  /** Middleware names that require a bearer token (default `['AuthMiddleware']`). */
  authMiddleware?: readonly string[];
  /** `describeValidation` of @averoa/utilities. */
  describeValidation?: (middleware: unknown) => unknown;
}

/** Hook of the app provider that customises the document. */
export interface OpenApiProvider {
  openapi?(doc: OpenApiDocument, context: { routes: RouteDescription[] }):
    object | undefined | void | Promise<object | undefined | void>;
}

/** The parts of @averoa/utilities the document builder uses. */
export interface OpenApiUtilities {
  describeValidation?: (middleware: unknown) => unknown;
}

export interface CreateOpenApiDocumentOptions {
  /** Default `'/api'`. */
  prefix?: string;
  AppProvider?: OpenApiProvider;
  /** Module to use instead of importing @averoa/utilities. */
  utilities?: OpenApiUtilities;
}

export interface MountOpenApiOptions extends CreateOpenApiDocumentOptions {
  /** Also serve the Swagger UI page (default `isOpenApiUiEnabled()`). */
  ui?: boolean;
}

export const OPENAPI_VERSION: string;

/** Swagger UI served by the docs page, pinned with Subresource Integrity. */
export const SWAGGER_UI: Readonly<{
  version: string;
  script: string;
  scriptIntegrity: string;
  style: string;
  styleIntegrity: string;
}>;

/** Middleware names that mean "JWT bearer token required". */
export const DEFAULT_AUTH_MIDDLEWARE: readonly string[];

/** OPENAPI_ENABLED, default true only for NODE_ENV development/test. */
export function isOpenApiEnabled(env?: EnvVars): boolean;
/** OPENAPI_UI (the Swagger UI page), default true. */
export function isOpenApiUiEnabled(env?: EnvVars): boolean;
/** JSON Schemas of a model. */
export function modelSchemas(Model: ModelClass): ModelSchemas;
/** Build the OpenAPI 3.1 document from `router.describe()` routes and models. */
export function buildOpenApiDocument(options?: BuildOpenApiDocumentOptions): OpenApiDocument;
/**
 * The document `GET /api/openapi.json` serves: routes/api.js, the models of
 * app/Models/index.js, then `AppProvider.openapi(doc, { routes })`.
 */
export function createOpenApiDocument(options?: CreateOpenApiDocumentOptions): Promise<OpenApiDocument>;
/** Content-Security-Policy of the docs page. */
export function docsContentSecurityPolicy(nonce: string): string;
/** Swagger UI page for `specUrl`. */
export function docsHtml(options: { specUrl: string; title?: string; nonce: string }): string;
/** Mount GET <prefix>/openapi.json and (unless `ui` is false) GET <prefix>/docs. */
export function mountOpenApi(app: Express, options?: MountOpenApiOptions): void;
