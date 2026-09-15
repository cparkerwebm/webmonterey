/*
 * A secret, whichever way the site bound it: the pure half of getSecret.
 *
 * TWO WAYS TO BIND ONE NAME. A Worker secret (`wrangler secret put NAME`, `.dev.vars` locally)
 * arrives on `env` as a plain string. A Secrets Store binding (`secrets_store_secrets` in
 * wrangler.jsonc, the value held once on the account and bound to any Worker that needs it)
 * arrives as an object with an async `get()`. The name is the same, the code reading it should
 * be the same, and until this the code was not: a `getBinding<string>` on a Secrets Store binding
 * hands a Mailgun call an object, which fails as a 401 from Mailgun and names nothing.
 *
 * So every secret read in the package goes through readSecret, which returns the string in
 * either case, and a site chooses per secret - a per-site key as a Worker secret, an
 * account-wide one (the Mailgun webhook signing key, a Stripe key shared by a fleet) from the
 * store - with no code change per secret. Resource bindings (D1, a queue, a dataset) are not
 * secrets and stay on getBinding.
 *
 * Takes the bindings object as an argument, so this is testable: env.ts binds it to the real
 * `env` from `cloudflare:workers`, which only resolves inside a Worker.
 */

/** The shape of a Secrets Store binding on `env`, duck-typed: nothing else on `env` has get(). */
export interface SecretsStoreBinding {
  get(): Promise<string>;
}

export function isSecretsStoreBinding(value: unknown): value is SecretsStoreBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { get?: unknown }).get === 'function'
  );
}

/** Whether a binding is configured: a non-empty string, a Secrets Store binding, or a resource. */
export function isBound(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** The message every missing binding fails with, naming both ways to set it. */
export function missingBindingMessage(name: string): string {
  return (
    `[webm] Missing Cloudflare binding or secret "${name}".\n` +
    `  - Local dev: add it to .dev.vars (copy .dev.vars.example), or create it in the local ` +
    `Secrets Store\n` +
    `  - Production: npx wrangler secret put ${name}, or bind it from the account's Secrets ` +
    `Store under secrets_store_secrets in wrangler.jsonc\n` +
    `  - Resource bindings (D1, KV, R2, Queues) go in wrangler.jsonc, not secrets\n` +
    `  - Reading a binding on a prerendered route always fails; set ` +
    `\`export const prerender = false\` on the route.`
  );
}

/**
 * The secret's value. A string binding is returned as it is; a Secrets Store binding is read
 * with get(). Throws, naming the secret, when the name is not bound at all, and when the store
 * has no secret behind the binding - locally that is a binding declared in wrangler.jsonc with
 * no local copy created yet, which is the common case the first time.
 */
export async function readSecret(bindings: Record<string, unknown>, name: string): Promise<string> {
  const value = bindings[name];
  if (!isBound(value)) throw new Error(missingBindingMessage(name));
  if (typeof value === 'string') return value;
  if (isSecretsStoreBinding(value)) {
    try {
      return await value.get();
    } catch (error) {
      throw new Error(
        `[webm] The Secrets Store binding "${name}" has no secret behind it: ` +
          `${error instanceof Error ? error.message : String(error)}\n` +
          `  - Local dev: npx wrangler secrets-store secret create <store-id> --name <secret_name> ` +
          `--scopes workers  (no --remote: it creates the LOCAL copy wrangler dev reads)\n` +
          `  - Production: the secret_name in wrangler.jsonc must exist in that store, with the ` +
          `workers scope.`,
        { cause: error },
      );
    }
  }
  throw new Error(
    `[webm] "${name}" is bound as ${describe(value)}, not a secret. A secret is a string ` +
      `(wrangler secret put) or a Secrets Store binding (secrets_store_secrets); read a ` +
      `resource binding with getBinding instead.`,
  );
}

function describe(value: unknown): string {
  if (typeof value !== 'object' || value === null) return typeof value;
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
  return ctor && ctor !== 'Object' ? `a ${ctor}` : 'an object';
}
