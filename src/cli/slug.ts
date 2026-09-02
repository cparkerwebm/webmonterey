/*
 * Turning a domain into the ONE name everything else uses.
 *
 *   example.com        ->  example
 *   shop.example.com   ->  shop-example
 *   example.co.uk      ->  example
 *
 * The GitHub repo, the Worker, the D1 database, the R2 bucket and any KV namespace all carry
 * that same name. It is the domain minus its public suffix, which is the one shape valid for
 * every resource at once - Workers and R2 accept only `[a-z0-9-]`, and in an agency account that
 * holds nothing but client sites a prefix says nothing.
 *
 * The TLD is dropped for a reason beyond brevity: a Worker named `example-com` puts `example-com`
 * into every preview hostname, and Chrome's lookalike-domain check reads that as a registrable
 * domain and warns the client their own preview looks fake. `example` embeds nothing.
 *
 * A second resource of the same kind for one client takes a purpose suffix - `example-portal` -
 * and is the exception, not the pattern.
 */

/** Public suffixes that take two labels, so `example.co.uk` slugs to `example`. */
const TWO_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.br',
  'com.mx',
  'co.za',
  'co.jp',
  'co.in',
  'com.sg',
]);

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Strip scheme, www, path and trailing dots. `https://www.Example.com/` -> `example.com` */
export function normalizeDomain(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '');

  if (!cleaned || !cleaned.includes('.')) {
    throw new DomainError(`"${input}" is not a domain. Expected something like example.com.`);
  }
  if (!/^[a-z0-9.-]+$/.test(cleaned)) {
    throw new DomainError(`"${input}" contains characters a hostname cannot.`);
  }
  return cleaned;
}

/**
 * The client slug - the domain with its public suffix removed.
 *
 * `example.com` -> `example`, `example.co.uk` -> `example`. Subdomains are kept, joined with a
 * dash, because `shop.example.com` and `example.com` are different sites if they are ever both
 * ours - and an indexable subdomain is always its own site.
 *
 * `example.com` and `example.org` slug to the same thing. That is a real collision inside one
 * account, and `webm new` says so rather than silently picking - the second one gets a name
 * chosen by a person.
 */
export function slugFor(domain: string): string {
  const clean = normalizeDomain(domain);
  const parts = clean.split('.');
  const lastTwo = parts.slice(-2).join('.');
  const drop = TWO_PART_SUFFIXES.has(lastTwo) ? 2 : 1;
  const kept = parts.slice(0, Math.max(1, parts.length - drop));
  return kept.join('-');
}

/** The GitHub repo name. The slug - one name, everywhere. */
export function repoName(domain: string): string {
  return slugFor(domain);
}

/**
 * Every resource name for a site, from one domain. They are all the slug; the fields exist so a
 * caller says which resource it means, and so a purpose suffix has an obvious place to go.
 */
export function resourceNames(domain: string) {
  const slug = slugFor(domain);
  return { slug, repo: slug, worker: slug, d1: slug, r2: slug, kv: slug };
}
