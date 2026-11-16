import type { Express, NextFunction, Request, Response } from 'express';

/** The parts of an Edge instance (`View` of @averoa/utilities) core uses. */
export interface EdgeLike {
  render(template: string, state?: object): Promise<string>;
  global(name: string, value: unknown): unknown;
}

export interface RegisterViewEngineOptions {
  /** Absolute views directory (Edge's mount). */
  views?: string;
  /** Globals to register once (`ViewProvider.global()`). */
  globals?: { readonly [name: string]: unknown } | null;
}

/** `'users.list'` to `'users/list'`; absolute paths and non-strings are returned as is. */
export function toViewPath<T>(view: T): T extends string ? string : T;
/** Middleware: lets `res.render('users.list')` use dot notation. */
export function dotNotation(req: Request, res: Response, next: NextFunction): void;
/** Register the `edge` view engine on an Express app. */
export function registerViewEngine(app: Express, View: EdgeLike, options?: RegisterViewEngineOptions): void;

export default registerViewEngine;
