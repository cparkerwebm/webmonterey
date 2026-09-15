/*
 * Access to Cloudflare bindings and secrets.
 *
 * THE ONLY CORRECT IMPORT is `cloudflare:workers`. `Astro.locals.runtime` was removed in
 * @astrojs/cloudflare v13 — any snippet using it is Cloudflare-Pages-era and will not work.
 *
 * Bindings are UNAVAILABLE while prerendering. Any route that reads one needs:
 *
 *     export const prerender = false;
 *
 * TWO KINDS OF THING LIVE ON `env`, read two ways:
 *
 *   - a SECRET - a Mailgun key, a Turnstile secret, a Stripe key - is read with getSecret, which
 *     is async because a site may bind any secret either as a Worker secret (`wrangler secret
 *     put`, a string on env) or from the account's Secrets Store (`secrets_store_secrets` in
 *     wrangler.jsonc, an object whose get() is awaited). Same name, same call, either way.
 *   - a RESOURCE - D1, a queue, a KV namespace, a dataset - is read with getBinding, synchronous,
 *     and typed by what you assert.
 *
 * The selection between them is in secret.ts, where it is tested; this file is the binding of it
 * to the real `env`.
 */
import { env } from 'cloudflare:workers';
import { environment } from '../../webmonterey/site.ts';
import { bindingMode as modeFor, bindingName, type BindingMode } from './mode.ts';
import { isBound, missingBindingMessage, readSecret } from './secret.ts';

/*
 * `env` is deliberately NOT re-exported.
 *
 * Every Worker secret is a plain string property on it, so a single `{JSON.stringify(env)}` on a
 * debug page — exactly what gets added while chasing a "binding is undefined" problem —
 * dumps every secret into the response. Import it from 'cloudflare:workers' directly if you
 * genuinely need the whole object, or use getBinding() below to take one value at a time.
 */

const bindings = env as unknown as Record<string, unknown>;

/**
 * Read a resource binding by name, failing loudly if it is not configured.
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
 *
 * NOT FOR SECRETS. A secret bound from the Secrets Store is an object here, not a string, and
 * asserting `<string>` on it does not make it one. Read a secret with getSecret.
 */
export function getBinding<T>(name: string): T {
  const value = bindings[name];
  if (!isBound(value)) throw new Error(missingBindingMessage(name));
  return value as T;
}

/**
 * True if a binding or secret is configured, however it is bound - a Secrets Store binding
 * counts. Use to make a feature degrade rather than throw.
 */
export function hasBinding(name: string): boolean {
  return isBound(bindings[name]);
}

/**
 * Read a secret by name, whichever way the site bound it.
 *
 *     const apiKey = await getSecret('MAILGUN_API_KEY');
 *
 * A Worker secret (`wrangler secret put MAILGUN_API_KEY`; `.dev.vars` locally) is returned as it
 * is. A Secrets Store binding (`secrets_store_secrets` in wrangler.jsonc; a local copy created
 * with `wrangler secrets-store secret create` without --remote) is read with its get(). The
 * site picks per secret and the code does not change. Fails loudly, naming the secret, when the
 * name is bound neither way.
 */
export function getSecret(name: string): Promise<string> {
  return readSecret(bindings, name);
}

/*
 * SECRETS WITH A LIVE AND A TEST VALUE. The naming and the selection rule are in mode.ts, which
 * is where they are tested; these are the bindings of that rule to this site's `environment`,
 * wrapping the readers above so a missing secret fails with the same message, naming the exact
 * secret that is unset - suffix included.
 *
 *     const key = await getSecretForMode('STRIPE_SECRET_KEY', context.url.hostname);
 *
 * reads STRIPE_SECRET_KEY_TEST on a staging deployment and STRIPE_SECRET_KEY otherwise. Pass the
 * request hostname when there is one; a scheduled handler has none and falls to `environment`.
 */

export { TEST_SUFFIX, bindingName, type BindingMode } from './mode.ts';

/** Which value this deployment reads: `test` on staging or any workers.dev host, else `live`. */
export function bindingMode(hostname?: string | null): BindingMode {
  return modeFor(environment, hostname);
}

/** `getBinding` of the mode-selected name: `<NAME>_TEST` in test mode, `<NAME>` in live. */
export function getBindingForMode<T>(name: string, hostname?: string | null): T {
  return getBinding<T>(bindingName(name, bindingMode(hostname)));
}

/** `hasBinding` of the mode-selected name. */
export function hasBindingForMode(name: string, hostname?: string | null): boolean {
  return hasBinding(bindingName(name, bindingMode(hostname)));
}

/** `getSecret` of the mode-selected name: `<NAME>_TEST` in test mode, `<NAME>` in live. */
export function getSecretForMode(name: string, hostname?: string | null): Promise<string> {
  return getSecret(bindingName(name, bindingMode(hostname)));
}
