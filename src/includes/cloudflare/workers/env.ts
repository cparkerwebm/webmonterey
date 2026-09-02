/*
 * Access to Cloudflare bindings and secrets.
 *
 * THE ONLY CORRECT IMPORT is `cloudflare:workers`. `Astro.locals.runtime` was removed in
 * @astrojs/cloudflare v13 — any snippet using it is Cloudflare-Pages-era and will not work.
 *
 * Bindings are UNAVAILABLE while prerendering. Any route that reads one needs:
 *
 *     export const prerender = false;
 */
import { env } from 'cloudflare:workers';

/*
 * `env` is deliberately NOT re-exported.
 *
 * Every secret is a plain string property on it, so a single `{JSON.stringify(env)}` on a
 * debug page — exactly what gets added while chasing a "binding is undefined" problem —
 * dumps every secret into the response. Import it from 'cloudflare:workers' directly if you
 * genuinely need the whole object, or use getBinding() below to take one value at a time.
 */

/**
 * Read a binding or secret by name, failing loudly if it is not configured.
 *
 * Bindings you have not declared yet do not exist on the generated `Env` type, so
 * `env.DB` will not typecheck until the binding is in wrangler.jsonc and you have re-run
 * `wrangler types` (which `npm run dev` and `npm run build` do for you). This helper is the
 * bridge: it looks the binding up at runtime and hands back the type you assert.
 *
 *     const db = getBinding<D1Database>('DB');
 *
 * Once `wrangler types` knows about the binding, prefer plain `env.DB` — it is genuinely
 * type-checked, whereas this is an assertion you are making.
 */
export function getBinding<T>(name: string): T {
  const value = (env as unknown as Record<string, unknown>)[name];

  if (value === undefined || value === null || value === '') {
    throw new Error(
      `[webm] Missing Cloudflare binding or secret "${name}".\n` +
        `  - Local dev: add it to .dev.vars (copy .dev.vars.example)\n` +
        `  - Production: npx wrangler secret put ${name}\n` +
        `  - Resource bindings (D1, KV, R2, Queues) go in wrangler.jsonc, not secrets\n` +
        `  - Reading a binding on a prerendered route always fails; set ` +
        `\`export const prerender = false\` on the route.`,
    );
  }

  return value as T;
}

/** True if a binding or secret is configured. Use to make a feature degrade rather than throw. */
export function hasBinding(name: string): boolean {
  const value = (env as unknown as Record<string, unknown>)[name];
  return value !== undefined && value !== null && value !== '';
}
