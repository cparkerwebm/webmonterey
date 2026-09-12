/*
 * Secrets with a LIVE value and a TEST value: the naming and the selection, pure.
 *
 * NAMING. Any such secret is stored on the Worker twice: `<NAME>` for live and `<NAME>_TEST` for
 * test, suffix at the END so the pair sorts together in `wrangler secret list`. It applies to
 * every service, not one in particular - a payment provider's API key and webhook secret, a
 * mail provider's sandbox domain, a maps or SMS or CRM key, anything a client site gets in a
 * sandbox flavour. Never a `_TEST_` infix, never a scheme per service.
 *
 * SELECTION. Which value a request reads is the rule the package already applies to mail:
 * isStagingDeployment. On a staging deployment - `environment` "staging", or any workers.dev
 * host - the `_TEST` value is read; otherwise the live one. Nothing flips at launch: /webm:launch
 * sets environment to production, and the custom domain is not a workers.dev host. Local dev is
 * a staging deployment, so .dev.vars holds the `_TEST` values.
 *
 * A secret with only one value - a Turnstile secret, a D1 binding - is unaffected: plain
 * getBinding, no suffix, as before.
 *
 * Generalised from the first client site to need it, which had stripeMode(hostname),
 * stripeSecretKey(hostname) and stripeWebhookSecret(hostname) in a file of its own: each one a
 * getBinding of the mode-selected name, which is all this is.
 *
 * Lives apart from env.ts because env.ts imports `cloudflare:workers`, which only resolves inside
 * a Worker, and this has to be testable.
 */
import { isStagingDeployment, type SiteConfig } from '../../webmonterey/config.ts';

export type BindingMode = 'live' | 'test';

export const TEST_SUFFIX = '_TEST';

/** Which value this deployment reads. */
export function bindingMode(
  environment: SiteConfig['environment'],
  hostname?: string | null,
): BindingMode {
  return isStagingDeployment(environment, hostname) ? 'test' : 'live';
}

/** The secret name for a mode: `STRIPE_SECRET_KEY` live, `STRIPE_SECRET_KEY_TEST` test. */
export function bindingName(name: string, mode: BindingMode): string {
  return mode === 'test' ? `${name}${TEST_SUFFIX}` : name;
}
