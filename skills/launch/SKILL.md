---
name: launch
description: Launch a WebMonterey client site onto its real domain - build audit (alt text, links, sitemap), structured data, Turnstile, sending domain, production secrets, remote migrations, custom domain, verification, analytics confirmation, and the environment flip. Use for "launch the site", "point the domain at it", "we're going live", "take it out of preview".
---

# Launch

Run only when the site is content-complete and approved on a preview URL. Every step is safe to
re-run; several are the kind that fail silently, which is why they are written down.

## 1. Pre-flight

```sh
npx webm doctor
npm run build
```

Both clean. Doctor's warnings about placeholder artwork and the missing webmaster credit become
blocking here: replace the seeded favicons and share image with the client's own, and confirm
the footer imports `Webmaster.astro` - it links to the `/webmaster` page every site has, and
without the credit that page is reachable from nothing.

## 1b. Audit the build

```sh
npx webm audit
```

It reads `dist/client` and reports three things a person never checks exhaustively on a
forty-page site. Fix each and rebuild until it is clean:

- **Images with no `alt` attribute.** Write the alt text yourself: open the image, read the
  copy around it, and describe what it shows in that context - not what it is ("photo"), what it
  says. A purely decorative image gets `alt=""`, declared explicitly. The alt lives wherever the
  `<img>` is authored: the component's markup, or the block's page JSON if the schema carries it.
  Do not leave one for later; a missing alt on a launched site is an accessibility failure and a
  lost image-search result.
- **Broken internal links.** Every `href` must land on a built page or a route in
  `run_worker_first`. A typo'd slug, a page that was renamed, a form action that moved.
- **The sitemap.** Built, advertised in `robots.txt`, every URL on the production domain and
  landing on a page. After launch, fetch `https://<domain>/sitemap-index.xml` in a browser and
  submit it in Search Console.

External links are probed too and reported as warnings: many sites refuse anything that is not a
browser, so open each flagged one before calling it broken.

## 2. Structured data

**The package emits no JSON-LD on its own.** What a business claims about itself is the site's
to say, and this is where it gets decided - once, with the client's real details in front of you.

1. **Identify the business.** Read `webmonterey.json`'s `organization`, the home page, the
   contact page, and the live site if there is one. Decide the primary type: `Organization` is
   the default; `LocalBusiness` (or a subtype - `Restaurant`, `Dentist`, `Store`) only if there is
   a physical address the public visits; `Person` alongside it for a candidate, an artist, a
   consultant whose name is the brand. Look up the subtype on schema.org rather than guessing.
2. **Fill `organization`** - legalName, telephone (E.164), email, address, `sameAs` profiles,
   `logo` (a path under `public/`, at least 112×112, NOT the share image), `hours` if there are
   opening hours. **Every empty field is omitted; never invent one.** Wrong opening hours in
   structured data are surfaced by search engines as fact.
3. **Write the component.** `src/components/general/structured-data.astro`, composed from the
   package's builders, and export it from the registry:

   ```astro
   ---
   import {
     graphContext,
     renderJsonLd,
     organizationNode,
     websiteNode,
     webPageNode,
     breadcrumbNode,
     personNode,
   } from '@cparkerwebm/webmonterey/structured-data';
   const { title, description, image } = Astro.props;
   const ctx = graphContext(Astro.site!, Astro.url.pathname, { title, description });
   const jsonLd = renderJsonLd([
     organizationNode(ctx, image),
     personNode(ctx), // null unless organization.founder is set
     websiteNode(ctx),
     webPageNode(ctx),
     breadcrumbNode(ctx), // two levels from the path; pass a trail for deeper pages
   ]);
   ---

   {jsonLd && <script type="application/ld+json" set:html={jsonLd} />}
   ```

   ```ts
   // src/components/registry.ts
   export { default as structuredData } from './general/structured-data.astro';
   ```

   The layout renders it in `<head>` on every indexable route. Add a node the builders do not
   have - `Event`, `Product`, `FAQPage` - as a plain object in the array; `renderJsonLd` handles
   escaping and `@id` wiring for anything you hand it. **Only describe what is visible on the
   page.** Structured data about content a visitor cannot see is a manual-action risk.

4. **Validate** the built home page and one inner page with Google's Rich Results Test before
   moving on.

5. **Look at `/webmaster`.** The package injects it on every site, with its own share image and
   JSON-LD. If this site's document pages - privacy, terms - use a richer layout than an `<h1>`
   and a stack of paragraphs, run `/webm:webmaster`: it exports a layout component from the
   registry so the page looks like the site it is on, with the package's copy intact.

## 3. Turnstile

If the site has a form: create the widget in the Cloudflare dashboard (**Turnstile → Add
widget**), hostname list = the apex domain AND `<account-subdomain>.workers.dev` so branch
previews keep working. Turnstile has no wildcards and the free tier allows 10 hostnames.

Then, **in the same change**: sitekey into `vars.PUBLIC_TURNSTILE_SITE_KEY` in `wrangler.jsonc`,
secret via `npx wrangler secret put TURNSTILE_SECRET_KEY`, and `features.turnstile: true`. A
mismatch fails exactly like a bot does and names nothing.

## 4. Check the client's existing DMARC BEFORE adding a sending domain

```sh
dig +short TXT _dmarc.<client-domain>
```

A DMARC record on `example.com` applies to its subdomains by default. If the client already
publishes `p=reject` and DKIM on the new sending subdomain is not right, **every message
vanishes** - no bounce, no error, nothing in the logs. Fix the DKIM before the first send, not
after the first missing enquiry.

## 5. Sending domain

Transactional mail sends from `webm.<client-domain>` as `website@webm.<client-domain>` - separate
from the client's own mail, so a bounce problem on one never poisons the other.

Add the domain in Mailgun, then add the SPF, DKIM and tracking records it gives you to the zone.
Every client zone is on the agency Cloudflare account, so this is a DNS edit.

## 6. Production secrets

Anything in `.dev.vars` locally must exist as a real secret on the Worker. Local files are never
uploaded.

```sh
npx wrangler secret list
npx wrangler secret put MAILGUN_API_KEY
npx wrangler secret put MAILGUN_DOMAIN        # webm.<client-domain>
npx wrangler secret put TURNSTILE_SECRET_KEY  # if not done in step 3
```

**Record each one in the password manager as you create it.** Wrangler cannot read a secret
back out, so nothing else in the system backs them up.

Public values - the Turnstile site key, a GTM container id - are not secrets. They go in
`vars` in `wrangler.jsonc` or `gtmId` in `webmonterey.json`, and are committed.

## 7. D1, if the site uses it

```sh
npx wrangler d1 migrations list <slug> --remote
npx wrangler d1 migrations apply <slug> --remote
```

`--remote` is the step people forget. Local migrations do nothing in production, and local and
remote are separate stores - **data never moves between them in either direction**.

## 8. Custom domain

Cloudflare dashboard, the Worker, **Settings → Domains & Routes → Add → Custom domain**. The
apex only; Cloudflare provisions the certificate. Send `www` to the apex with a Redirect Rule,
not a second custom domain. MX records are untouched - a custom domain claims address records
only.

## 9. Verify

Wait for a known marker before asserting anything - some edges serve the previous version for a
minute or two, and a check run in that window reports old titles and missing assets that are
fine.

Then, in a **real browser with the console open**:

- every page renders and every internal link resolves
- the contact form submits, and the notification arrives
- Turnstile renders - it refuses to render headless, so a headless pass proves nothing

And for every route with `prerender = false`, including its trailing-slash form:

```sh
curl -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" https://<domain>/<route>
```

That header is what the asset router branches on. Without it curl gets the real page and Chrome
gets the 404.

**A form test before step 11 goes to `stagingEmail`** with `[staging → …]` in the subject naming
who it was really for. That is the system working - check that inbox, not the client's.

## 10. Analytics - two confirmations, asked out loud

Neither of these can be checked from the repo, so **ask, and wait for the answer.** Do not
proceed on an assumption, and do not mark either done because the field is filled in.

1. **"Is Google Tag Manager configured for this site?"** - meaning the container exists, its
   tags are published (not just saved), and `gtmId` in `webmonterey.json` is that container. A
   `gtmId` with an unpublished container loads a script that fires nothing. If the site has no
   analytics by agreement, confirm that instead and move on.
2. **"Has the launch annotation been added in Google Analytics?"** - a dated note on the
   property for the launch, so the traffic change that follows has an explanation next to it
   when someone looks a year from now.

Record the answers in the launch commit message.

## 11. Hand the site its email back, and record the launch

In one change:

```json
"environment": "production",
"launched": "YYYY-MM-DD"
```

**This flip is also what makes the site indexable, so it happens here and not before.** While
`environment` says `staging`, every build is a preview - every page noindex with no canonical,
no sitemap, robots.txt disallowing everything, no Google Tag Manager - on every hostname, `main`
included. Flip it before the custom domain is live and the `workers.dev` copy is what gets
indexed.

Until `environment` flips, every message the site sends is redirected to `stagingEmail` - correct
right up to the moment the domain is attached and wrong immediately after: the form keeps saying
thank you, the client's inbox stays empty, and the first anyone hears of it is a customer asking
why nobody called back. And a launched site left on `staging` is invisible to search: every page
noindex, no sitemap, `Disallow: /`. `webm doctor` fails a launched site still declared staging,
which is why both fields change together.

Anything served from `workers.dev` is still treated as staging for MAIL whatever this says, and
any branch other than `main` still builds as a preview, so branch previews of the live site keep
redirecting and stay out of the index. That is deliberate.

Commit, push, and confirm the deploy. Then run `npx webm doctor` one last time: zero failures.
