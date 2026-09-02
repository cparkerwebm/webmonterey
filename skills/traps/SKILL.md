---
name: traps
description: Known traps in Astro on Cloudflare Workers that contradict what a model recalls. Load before touching styles or the cascade, a route's prerender flag, wrangler.jsonc, images, D1, Turnstile, or a deploy. Each entry was found on a real client site, not read in docs.
---

# Traps

Every entry here was found on a live client site. Each contradicts what a model is likely to
recall, and most produce **no error** — a wrong render, a dead URL, a form that silently rejects.

**The through-line for the cascade and router entries: neither `curl` nor `astro dev` can detect
any of them.** "It works locally" proves nothing about a server-rendered route, an image on that
route, or how a browser treats a hostname. What does work:

- `npm run preview` — a real build on real `workerd`, with the asset router in play
- `curl -H "Sec-Fetch-Dest: document" -H "Sec-Fetch-Mode: navigate" <url>` — makes curl look like
  a navigation, which is what the asset router branches on
- **a real browser with the console open**, for anything hostname-scoped. A status-code check
  cannot see a widget that failed to render.

Four of these are now `webm doctor` checks. Run it first.

---

## Cascade and CSS

**A bare `@layer` order statement does not survive bundling.** It is not attached to any rule, so
nothing carries it into the output chunk, and layer order falls back to first appearance in the
bundle. On a real client site `webm.components.core` landed before `webm.reset`, so
`img { max-inline-size: 100% }` beat a component's `max-inline-size: 11.25rem` and rendered a
180px logo at **883px**.

The trigger is **import order in page frontmatter**. Astro emits CSS chunks in module-graph
order, so a component imported above the layout puts its `components.core` chunk ahead of the
`reset` chunk. Reordering two import lines — which no reviewer would flag — is enough.

`base.astro` emits the statement as an inline `<style is:inline>` ahead of every stylesheet.
In this package it comes from `styles/layers.ts`, so the two lists cannot drift.

**An empty `@layer` block is dropped by the minifier**, which is why `components.custom` and
`overrides` are absent from built CSS until a client writes a rule.

**`[hidden]` does not hide anything on its own.** The UA stylesheet's `[hidden] { display: none }`
is in the UA origin, so any author `display` beats it — a grid or flex child simply ignores the
attribute and `el.hidden = true` appears to do nothing, with no error. `reset.css` sets
`[hidden] { display: none !important }`. The `!important` is load-bearing: `webm.reset` is the
first layer, so a plain declaration there loses on layer order alone, and for `!important`
declarations that order inverts.

**Scoped styles are scoped. A class is not reusable across pages.** A class written in one page's
`<style>` and used in another renders **completely unstyled** — no error, no warning, a bare
element. This bit one client build five separate times. Shared classes go in `src/styles/` or
`styles/custom/`.

**`reset.css` restores `dialog { margin: auto }`.** The blanket `* { margin: 0 }` otherwise
overrides the UA stylesheet and every modal pins itself to the top-left corner. This has already
been deleted once by accident while editing the adjacent rule — the comment survived and the rule
did not, so the file still read as correct.

**Do not add `inlineStylesheets: 'always'`.** CSS attribution to on-demand routes works: a
`prerender = false` route gets its own chunk containing the full layer stack in the right order.
The workaround costs ~20KB inlined into every page in exchange for nothing.

**Restyling a base class in `webm.overrides` orphans every modifier of it.** Layer order beats
specificity outright, so a rule on `.webm-consent-btn` in the last layer also beats the package's
own `.webm-consent-btn--primary` — the modifier's declarations are in an earlier layer and lose
even though the selector is more specific. The primary button keeps the text color meant for the
old background and ships as pale-on-pale. **This is the failure mode of the last layer**: it wins
against the package, and the package's variants are part of what it wins against. Restyle the
modifier alongside the base, or move the rule into `webm.components.custom`, where it competes on
specificity like normal CSS.

**A custom property whose value contains `var()` resolves where it is DECLARED, not where it is
used.** `--webm-focus-ring: var(--webm-focus-width) solid var(--webm-focus-color)` on `:root`
inherits down **already resolved**, so a component setting `--webm-focus-color` on itself changes
nothing — the ring keeps the site-wide color, and any component on a colored surface is stuck
with an invisible focus indicator. There is no error and nothing looks wrong in review. Compose
from the parts at the point of use (`outline: var(--webm-focus-width) solid var(--webm-focus-color)`)
and the overrides apply. The same trap applies to any composed token — shadows, transitions,
gradients.

---

## The asset router and on-demand routes

**`not_found_handling: "404-page"` intercepts navigations before the Worker sees them.** A
navigation request matching no static asset is served `404.html` and never falls through — and
every `prerender = false` route is such a path.

The trigger is `Sec-Fetch-Dest: document`, which browsers send and curl does not. **The same URL
in the same second returns the real page to curl and the 404 page to Chrome.** A no-JS form POST
is a navigation too, so it takes out progressive enhancement specifically.

Fix: `assets.run_worker_first` in wrangler.jsonc. **Every route given `prerender = false` must be
listed, including its trailing-slash form** — they are separate paths to the asset router.
`webm doctor` checks this.

**`<Image>` and `getImage` return a dead URL on an on-demand route.** `imageService: 'compile'`
optimizes at build and ships no runtime image endpoint, but `<Image>` on a `prerender = false`
route still emits `/_image?href=…`, which is never deployed. It 404s in production and renders
broken. Invisible locally — `astro dev` serves `/_image` happily.

Branch on `Astro.isPrerendered` and fall back to a plain `<img>`. Do **not** switch to
`passthrough` (kills optimization site-wide) or `cloudflare-binding` (a paid product). `webm
doctor` checks this.

---

## Hostnames, deploys and platform

**A Workers URL is `<worker>.<account-subdomain>.workers.dev`.** Dropping the account subdomain
produces something that looks plausible and resolves to nothing. Configured into a Turnstile
widget it yields `TurnstileError: 110200`, and the failure is nearly invisible: the widget never
renders, never mints a token, every submission is rejected 403, and the form looks normal. The
only DOM symptom is a missing iframe.

**Branch previews are a SIBLING label, not a subdomain** —
`<branch>-<worker>.<account-subdomain>.workers.dev`. Listing the exact worker hostname in
Turnstile does not cover them, so the form breaks on precisely the links clients are sent. List
`<account-subdomain>.workers.dev`; a hostname covers its subdomains. Turnstile does not support
wildcards, and the free tier allows 10 hostnames per widget.

**Chrome's "This site looks fake" warning on preview links comes from the Worker's NAME.** Its
lookalike-domain check flags "domains that embed other domain names within their own hostname",
and a Worker called `acme-com` puts `acme-com` into every preview hostname. That is why every
resource is named by the slug with the TLD dropped — `acme` embeds nothing that reads as a
domain. `webm new` does this; do not name a Worker after the full domain.

If a warning still appears on a correctly named Worker it is a URL-shape false positive, not a
Safe Browsing verdict — **Ignore is safe**. There is no other lever: a custom domain points at a
_Worker_, not a _version_, so it can only serve production, and per-version preview URLs are
`workers.dev`-only.

**`workers_dev: false` does NOT disable preview URLs.** Separate switches, which is why
wrangler.jsonc sets both explicitly.

**A branch preview is a different build, on purpose.** Workers Builds injects
`WORKERS_CI_BRANCH`; on any branch but the production one (`main`, or the integration's
`productionBranch`) every page is noindex with no canonical, there is no sitemap, `robots.txt`
disallows everything, GTM does not load, and the `/webmaster` page emits no graph. Email is
already redirected by the `workers.dev` hostname. So a client's review link can neither be
indexed nor show up in their analytics. **A local build is not a preview** - `npm run preview`
builds production, which is what you want to inspect. To see the preview shape locally:
`WORKERS_CI_BRANCH=x npm run build`.

**`wrangler deployments list` misleads twice.** `Source: Unknown (deployment)` appears even for
Workers Builds deployments — it describes the author, not the origin. And the list pages at 10
entries, so "has the count gone up?" can never become a way of waiting for a deploy.

**Verification immediately after a deploy gives false negatives.** Some edges serve the previous
version for a minute or two. Wait for a known marker before asserting anything.

**A brand-new Worker can return `error code: 1042` on valid paths for about a minute.** Retry
once after ~60s before diagnosing. The documented meaning of 1042 does not apply to a freshly
deployed static site.

**After a repo is connected to Workers Builds, `npx wrangler deploy` from a laptop is wrong.** It
succeeds, which is the trap: it creates a version no dashboard build produced, so build history no
longer describes what is live, and the next `git push` reverts it.

**Local and remote D1/R2 are separate stores.** Rows and objects never move between them, in
either direction, and nothing warns you. Code moves on push; schema moves via
`wrangler d1 migrations apply --remote`; **data does not move at all.**

**Astro's dev server daemonizes.** It detaches and the launching command exits, which reads as a
crash. Manage it with `astro dev status` / `logs` / `stop`.

---

## TypeScript and APIs

**`querySelector<HTMLSelectElement>` does not compile — and it is the only element type that
does not.** `worker-configuration.d.ts` declares HTMLRewriter's `interface Element`, whose
`remove()` returns `Element` so calls can chain. Being an interface it _merges_ with `lib.dom`'s
`Element`, so the global now carries a `remove(): Element` overload, and
`querySelector<T extends Element>` demands it of `T`. Every element type inherits that — except
`HTMLSelectElement`, which declares its own `remove(index: number): void`, and an own declaration
shadows the inherited one.

Cast instead: `document.querySelector('#t') as HTMLSelectElement | null`. Do not "fix" it by
removing `worker-configuration.d.ts` from tsconfig — that is what types the bindings.
`webm doctor` checks this.

**`Astro.locals.runtime` does not exist.** Removed in `@astrojs/cloudflare` v13. Any snippet using
`Astro.locals.runtime.env.DB` is Pages-era. Use `import { env } from 'cloudflare:workers'`.

**Bindings are unavailable on prerendered routes.** Any route touching `env.DB` needs
`export const prerender = false`.

**`import.meta.env` is NOT the workaround for that.** Both `.env` and `.dev.vars` populate it
server-side at build time, so on a prerendered route the secret is written **into
`dist/client/*.html`**, which Cloudflare serves publicly. A local `npm run build` before
`wrangler deploy` is exactly the machine that has `.dev.vars` present. Never
`JSON.stringify(import.meta.env)` into a page.

**`astro/zod` is zod 4.** The discriminated-union option constraint is
`core.$ZodTypeDiscriminable` — internal, not re-exported. Zod 3's `ZodDiscriminatedUnionOption`
no longer exists, so any snippet using it is pre-v4. Derive from the function signature instead.
`astro:schema`, and `z` from `astro:content`, are deprecated.

**The collections config is `src/content.config.ts`.** `src/content/config.ts` was removed in v6.

**`src/fetch.ts` is reserved in Astro 7.** Do not create it.

**Never put a non-ASCII character in a `throw new Error` message.** Astro puts the message into an
`x-astro-prerender-error` header during prerendering; an em-dash triggers a warning and renders
mangled. Fine in comments and UI copy — just not there.

---

## Cron Triggers

**A `triggers.crons` entry on its own deploys cleanly and never runs anything.**

The adapter generates the Worker entrypoint, and that generated file exports `fetch` and nothing
else. There is no `scheduled` handler in it. But the config half works perfectly: a `triggers`
block in `wrangler.jsonc` merges straight into the generated `dist/server/wrangler.json` and
deploys without a warning. Cloudflare then invokes a handler the Worker does not have, on
schedule, forever, and nothing in the repo says so.

Verified rather than assumed — with a cron in `wrangler.jsonc` and no `main`:

```sh
npx astro build
grep scheduled dist/server/entry.mjs          # nothing
npx wrangler dev --local --test-scheduled
curl 'http://127.0.0.1:8787/__scheduled?cron=0+*+*+*+*'
# -> 404, served by the asset router
```

### The fix, which is supported and already in production

Point `main` at a **source** entrypoint that re-exports the adapter's own handler. This is the one
legitimate reason to set that key.

```jsonc
// wrangler.jsonc
"main": "./src/worker.ts",
"triggers": { "crons": ["0 * * * *"] }
```

```ts
// src/worker.ts
import { defineWorker } from '@cparkerwebm/webmonterey/worker';
import { runSweep } from './includes/sweep.ts';

export default defineWorker({
  scheduled: (controller, env, ctx) => ctx.waitUntil(runSweep(env)),
});
```

`defineWorker` supplies the adapter's `fetch` and does not let you replace it — every page, action
and API route arrives through that function, so a site that meant to add a cron and accidentally
replaced the request path takes itself down while the cron works perfectly. Site-wide request
logic goes in Astro middleware instead.

`webm doctor` fails on a cron with no `main`, on a `main` that names a build artefact, on an
entrypoint with no `scheduled`, and on one that forgets the adapter handler.

**`./dist/_worker.js/index.js` is the value NOT to use.** It is the Pages-era form, it names a
build artefact rather than a source file, and it fails the build with "main field doesn't point to
an existing file".

**Cron runs in UTC, always** — there is no timezone setting anywhere in Cloudflare. A job that has
to land at a local hour should fire hourly and let the handler check the clock in the site's own
zone with `hourNow()`; pinning it to a fixed UTC hour drifts by one twice a year.

**Cloudflare Queues: a producer is two lines; a consumer is not supported by the package.** A
producer is a binding plus `env.QUEUE.send()`. A consumer needs a `queue()` handler on the Worker
export, and `defineWorker` accepts one — but nothing in the package has exercised it. Spike it on a
throwaway Worker before a client depends on it.

## Build and platform defaults

**Static assets build to `dist/client/`, not `dist/`.** Astro's own docs and most tutorials say
`./dist`.

**`npx wrangler deploy` from the repo root is correct — do not add `--config`.** The build writes
`.wrangler/deploy/config.json`, which redirects Wrangler to the generated
`dist/client/wrangler.json`. The root file is still the one you edit.

**Do not hand-write `public/.assetsignore`.** Adapter v14 generates
`dist/client/.assetsignore` itself, and the worker is emitted to `dist/_worker.js` — a sibling of
the assets directory, never inside it.

**The adapter binds Cloudflare Images by default.** `imageService` defaults to
`'cloudflare-binding'`, a separate paid product transforming at request time. The integration sets
`'compile'`.

**An `env.SESSION` KV binding is added automatically** and auto-provisioned on deploy. It backs
`Astro.session`. Leave it alone.

**Turnstile has no official Astro or Workers integration.** `@cloudflare/pages-plugin-turnstile`
is Pages-only. Verification is a manual POST to
`https://challenges.cloudflare.com/turnstile/v0/siteverify`.

**Astro deleted every `llms.txt` / `llms-full.txt`.** Those URLs 404. The MCP server is the only
official AI-docs endpoint.

**Cloudflare's own Astro framework guide is stale** — it still says "Astro 6 beta" and points at
`locals` for bindings. Where it disagrees with docs.astro.build on adapter APIs, **docs.astro.build
wins.** Cloudflare docs remain authoritative for wrangler and the platform.

**`git` does not track empty directories.** Every empty folder needs a `.gitkeep`.

---

## Email and DNS

**A staging site's email is redirected, and both directions of getting that wrong are silent.**
`environment` in webmonterey.json decides it: on `staging`, every recipient is rewritten to
`stagingEmail` and the subject is prefixed `[staging → who-it-was-for]`. Left on `staging` after
launch, the client's enquiries go to the agency and their own inbox stays empty — the form still
says thank you. Left on `production` before launch, testing a preview mails the client's real
contacts for real. `webm doctor` checks both directions against `launched`; `/webm:launch` is
where it gets flipped.

**A staging site with no `stagingEmail` refuses to send at all.** The package carries no default
inbox, so there is nowhere safe to redirect to. `sendEmail` throws rather than mailing the real
recipients; `webm doctor` fails the site before anyone submits a form.

**Anything on `workers.dev` redirects regardless of what `environment` says.** webmonterey.json is
committed, so a branch preview of a live site inherits `production` from main — the hostname test
is what stops that preview mailing real people. It matches the `workers.dev` label specifically,
not "any hostname that is not the canonical domain": `domain` is stored bare, so the latter would
divert every enquiry the day a site answers on `www.`.

**A scheduled handler has no request, so it has no hostname.** Only `environment` protects the
nightly sweep — the check that reads a hostname cannot see a cron at all. This is why the switch
is config rather than something derived from the URL.

**Check the client's existing DMARC before adding a sending subdomain.** A DMARC record on
`example.com` applies to its subdomains by default. If the client publishes `p=reject` and DKIM on
the new subdomain is not right, **every message vanishes** — no bounce, no error, nothing in the
logs.

**R2 has no object versioning.** Its equivalent is **bucket locks**, which prevent deletion and
overwriting for a retention period. Any snippet enabling "R2 versioning" is wrong — the command
does not exist.

**`rclone sync` is not a backup.** It makes the destination match the source, so a file deleted at
the source disappears from the backup within 24 hours. Use `rclone copy`.
