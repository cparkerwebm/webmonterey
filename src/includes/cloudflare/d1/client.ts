/*
 * Thin helpers over Cloudflare D1.
 *
 * D1 holds PRIVATE data — form submissions, user accounts, anything that is not public page
 * content. Public marketing copy belongs in src/content/pages/*.json, never here.
 *
 * Every helper takes the database as its first argument rather than reaching for the binding
 * itself, so this module stays honest about its dependency and typechecks before any binding
 * exists. Callers do:
 *
 *     export const prerender = false;   // REQUIRED — bindings are unavailable when prerendering
 *
 *     import { env } from 'cloudflare:workers';
 *     import { all } from '../includes/cloudflare/d1/client.ts';
 *
 *     const rows = await all(env.DB, 'SELECT * FROM submissions WHERE form = ?', 'contact');
 *
 * Before `env.DB` typechecks, the binding must be in wrangler.jsonc and `wrangler types` must
 * have re-run. Until then use `getBinding<D1Database>('DB')` from ../workers/env.
 *
 * ALWAYS pass values as bound parameters. Never build SQL by string concatenation.
 *
 * The one thing you CANNOT bind is an identifier — a table or column name. `ORDER BY ?` does
 * not work, so a sortable table tempts you into `ORDER BY ${column}`, which is an injection.
 * Map untrusted input through an allowlist instead, so only names you wrote can ever appear:
 *
 *     const SORTABLE = { name: 'name', date: 'created_at' } as const;
 *     const column = SORTABLE[input as keyof typeof SORTABLE] ?? 'created_at';
 *     const rows = await all(env.DB, `SELECT * FROM submissions ORDER BY ${column} DESC`);
 */

/** Bind params only when there are some — `.bind()` with no arguments is an error in D1. */
function prepare(db: D1Database, sql: string, params: unknown[]) {
  const statement = db.prepare(sql);
  return params.length ? statement.bind(...params) : statement;
}

/** Every matching row. Returns an empty array when there are none. */
export async function all<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await prepare(db, sql, params).all<T>();
  return results ?? [];
}

/** The first matching row, or null. */
export async function first<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return await prepare(db, sql, params).first<T>();
}

/**
 * For INSERT / UPDATE / DELETE. Read `meta.last_row_id` and `meta.changes` off the result.
 *
 * Returns `D1Result<T>` (not just `D1Response`) so `INSERT … RETURNING id` can read
 * `.results` without a type error.
 */
export async function run<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result<T>> {
  return await prepare(db, sql, params).run<T>();
}

/**
 * Run several statements as one atomic batch.
 *
 * D1 has no interactive transactions — this is the only way to get all-or-nothing behavior.
 *
 *     await batch(env.DB, [
 *       env.DB.prepare('INSERT INTO submissions (form, body) VALUES (?, ?)').bind(form, body),
 *       env.DB.prepare('UPDATE counters SET n = n + 1 WHERE name = ?').bind(form),
 *     ]);
 */
export async function batch<T = Record<string, unknown>>(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  return await db.batch<T>(statements);
}
