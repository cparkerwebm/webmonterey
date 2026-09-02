/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/*
 * Cloudflare's runtime types (D1Database, R2Bucket, KVNamespace) and Astro's virtual modules
 * (astro:content, astro:actions) are ambient inside a site's build but not inside this package,
 * where there is no site to generate them from. Referencing them here is what lets `tsc --noEmit`
 * check the package on its own.
 *
 * A client site still gets its own worker-configuration.d.ts from `wrangler types`, which is what
 * types THAT site's bindings. This file types the shapes the package uses generically.
 */
