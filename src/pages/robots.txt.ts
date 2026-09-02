/*
 * robots.txt, GENERATED — not a file in public/.
 *
 * It used to live in public/, which is copied verbatim and therefore cannot read
 * webmonterey.json. That left the `Sitemap:` line commented out with an instruction to write
 * the domain in by hand at launch: one manual step, on one line, in a file nobody looks at
 * again, whose omission is completely silent. Every site that forgot it simply had no sitemap
 * submitted.
 *
 * As an endpoint it is correct by construction. `output: 'static'` prerenders this at build,
 * so the deployed result is still a plain static file with no runtime cost — check
 * dist/client/robots.txt after a build.
 *
 * The Sitemap line is emitted ONLY when `domain` is set, because that is exactly the
 * condition under which @astrojs/sitemap generates the file at all (it needs an absolute URL).
 * Advertising a sitemap that was never built is worse than advertising none.
 *
 * WORTH KNOWING WHEN THIS FILE LOOKS WRONG IN PRODUCTION: if AI/search signals are configured
 * on the Cloudflare zone, Cloudflare PREPENDS its own managed block to the response and keeps
 * this content below it. Both are served; neither replaces the other. Read past the header
 * before concluding the file has been overwritten.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const lines = ['User-agent: *', 'Allow: /'];

  /*
   * Deliberately no Disallow for noindex routes. Blocking a path here stops crawlers fetching
   * it, which means they never see its noindex tag — and an inbound link can then get the URL
   * indexed anyway, with no description. To exclude a page you must let it be crawled. The
   * sitemap `filter` in astro.config.mjs is what keeps those routes out.
   */
  if (site) {
    lines.push('', `Sitemap: ${new URL('sitemap-index.xml', site).href}`);
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
