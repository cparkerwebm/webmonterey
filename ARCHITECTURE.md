# webmonterey — architecture

The design and the reasoning behind `@cparkerwebm/webmonterey`, the package every WebMonterey
client site installs. [README.md](README.md) is how to work in this repo; this is why it is the
way it is. Most of what looks like an odd choice is a documented one, and the rejected option is
recorded beside it because the rejected option is the one that gets re-proposed.

---

## 0. What this is, and what came before

Three generations preceded this package. The first was a framework that shipped its own header,
footer and content blocks; every client overrode them, and moving forward meant hand-editing every
consumer, so nobody did. The second was a starter template with no upgrade path at all — a site was
minted from whatever the starter was that day and never pulled a fix forward. The third was this
code on a private registry, where every laptop, every CI run and every deploy needed a token that
failed as a 401 indistinguishable from the package not existing.

This is the fourth: the same code, public, with the auth plumbing gone and the scope reset to what
a package can honestly own. **The through-line is that the package owns plumbing, never
appearance.** Everything a client can see is theirs. Everything that can be wrong in the same way
on a hundred sites at once is ours.

---

## 1. The ownership split

This is the whole design. Every other section follows from it.

### The three tests for what belongs in the package

**Only core belongs here. A bloated package is not a generous one — it is a liability.** Core
means all three, not one of them:

1. **Every site needs it.** Not "could use it" — needs it.
2. **It is the same everywhere.** The mechanism, not the content.
3. **A site cannot supply it alone**, or would have to solve it identically a hundred times.

If it fails any of the three it belongs in the client repo, however well written it is and however
much work it took.

**The tell that something is not core: it keeps needing another field.** Structured data was the
worked example. A generic JSON-LD component grew `place`, `breadcrumbs`, a page description, then
two fields on the Person node — six additions in a day — and a candidate's site still could not say
`affiliation`. The graph *mechanics* are identical on every site; the graph *content* is different
on every one. The package took the whole component when it was only entitled to the plumbing. It
now ships the builders and emits nothing by default (§9).

### The promise: every default has a way out

**The package is a floor to stand on, never a ceiling to break through.** An audit of five
rebuilt sites found the same defect five times: a site needed one thing different, the package
offered no seam, and the site's only options were to copy package code or lose the behavior.
Every site lost the behavior, because losing it was the quiet option.

So there is a second question, asked after the first three say yes:

> If one site needs this different, can it do that from its own repo — without copying package
> code?

If the honest answer is "it would have to copy the file," the package has a hole. Fill it before
shipping: a prop, a slot, a registry entry, an optional field. Removing a seam is the most
dangerous change this package can make — a removed signature breaks loudly; a removed seam goes
quiet.

### What the package owns

| What | Why it belongs to the package |
| --- | --- |
| The cascade layer order and the inline statement that holds it | A bare `@layer` statement does not survive bundling. Discovered as a 180px logo rendering at 883px on a live site. |
| `reset.css`, `base.css`, `layout.css`, `utilities.css` | `[hidden]` needs `!important`; `dialog { margin: auto }` has been deleted by accident once already. |
| The Cloudflare includes — D1, R2, Turnstile, Workers env | Fail-closed verification, `getBinding`, the media URL builder. Security-shaped code. |
| Consent — ConsentInit, CookieConsent, the `whenConsented` API | A legal surface where one fix must reach everywhere. |
| The form pipeline | Validate → honeypot → Turnstile → D1 → notify → autoresponse. The ordering is load-bearing and was reasoned about once. |
| The email templates and the Mailgun sender with staging redirection | Rendered from data; the redirect is the one place every send passes through. |
| The block router, the base layout, robots.txt, the 404, the `/webmaster` page | Same for every site. |
| The Astro integration and its virtual modules | The mechanism by which a package reads files in the repo it is installed into. |
| The CI workflow, `check-node.mjs`, `test-hooks.mjs` | Repo tooling a site never edits. |
| The `webm` CLI and the skills | The fleet's operating procedure, versioned with the code it operates. |

### What the site owns

| What | Notes |
| --- | --- |
| `webmonterey.json`, `design.json` | Identity, features, the palette and voice. |
| `src/components/**` | **Every visible block. All of them. Always bespoke.** The package ships zero. |
| `src/content/pages/*.json`, `src/forms/*.json` | The words and the forms. |
| `src/styles/custom/` | The override seam. `webm.components.custom` beats `webm.components.core` at equal specificity. |
| The registry: `blocks`, `header`, `footer`, `panels`, `pageHeader`, `webmasterPage`, `structuredData` | How a site hands the package its chrome, its claims, and the shape of the one page the package writes. |
| `public/`, `wrangler.jsonc`, `migrations/` | Copied verbatim, real resource IDs, the site's own schema. |

---

## 2. Topology and distribution

```
cparkerwebm/webmonterey          public · MIT · npmjs as @cparkerwebm/webmonterey
  src/                           the package
  skills/ agents/ hooks/         the Claude Code plugin, materialized into every site
  template/                      what `webm new` seeds and `webm sync` refreshes
  examples/minimal/              a real site CI builds on every PR

webmonterey/<slug>                 private · one per client · unchanged by anything here
```

**Public, on npmjs, no credential anywhere.** A public package on GitHub Packages still requires
a token to install — GitHub's docs say so explicitly — so it would have bought nothing. On npmjs
there is no `.npmrc` in a client repo, no build variable on Workers Builds, no org secret in CI,
and Renovate works with zero configuration. That is the whole reason for the move.

**The package is under a personal scope because the `webmonterey` npm org was taken.** A user
scope is owned by definition — nobody else can publish `@cparkerwebm/*` — so there is nothing to
reserve. The name is read from `package.json` in the two places the CLI needs it, so a future
rename is one edit.

**MIT because clients own their sites.** Every client repo depends on this package; a client who
leaves with their repo has to be able to build it. The plumbing is not the moat.

**Nothing in this repo is about the agency.** No inbox, no API key, no client list, no GitHub
owner. The two defaults that used to be — the org a repo is created under and the staging email
address — come from `git config webm.org` and `git config webm.stagingEmail` (falling back to
`user.email`), set once per machine, and `webm new` refuses without the first.

### One name, everywhere

The domain minus its public suffix is the GitHub repo, the Worker, the D1 database, the R2 bucket
and any KV namespace:

| Domain             | Name           |
| ------------------ | -------------- |
| `example.com`      | `example`      |
| `shop.example.com` | `shop-example` |
| `example.co.uk`    | `example`      |

Three reasons. It is the one shape valid for every resource at once — Workers and R2 accept only
`[a-z0-9-]`, no underscores, no dots. The TLD is dropped because a Worker named `example-com` puts
`example-com` into every preview hostname, and Chrome's lookalike-domain check then warns the
client their own preview looks fake; `example` embeds nothing. And in an agency account that holds
nothing but client sites, a prefix says nothing — Cloudflare scopes every one of these names to
the account, so another agency using the same convention on its own account cannot collide.

A second resource of one kind for the same client takes a purpose suffix (`example-portal`) and is
the exception. `example.com` and `example.org` both want `example`; `webm new` says so, and the
second gets a name a person chose. `slug.ts` owns the derivation.

### The prefix is `webm-`, in code

Custom properties (`--webm-action`), class names (`.webm-section`), the CLI, the skills namespace
(`/webm:launch`). One prefix in a site's code, so anything the package owns is recognizable at a
glance in a file. Cloud resources do not carry it — see above.

---

## 3. The design system as data

`design.json` sits beside `webmonterey.json` and carries about fifteen values: the neutral ramp,
the action color, one border, the state colors, two font stacks, radii, and the brand's `voice`
and `rules`. The compiler merges it over a 124-token default set and emits:

- **CSS custom properties** — `@layer webm.tokens { :root { … } }` as a Vite virtual module.
  Nothing generated is committed.
- **Email-safe literals** — every `var()` chain resolved flat, because a mail client has no
  cascade.
- **Brand context** — voice, rules, logo and resolved palette as JSON, for anything that writes
  in the client's name.

The defaults are the design *system*; `design.json` is the *brand*. Spacing, widths, z-index,
durations, easings and shadows are deliberately not in it — a client who edits those is nearly
always a client who wants a different value in one component. `overrides` is the escape hatch:
any `--webm-*` property, raw, applied last. A key outside the prefix is a build error, because a
property nothing reads is otherwise silent.

`/design` has no Astro imports, enforced by test, so it runs under `node --test` and from the
platform without pulling a framework in to read a color.

---

## 4. The cascade

Eight layers, in one list, in `styles/layers.ts`:

```
webm.reset  webm.tokens  webm.base  webm.layout  webm.components.core
webm.components.custom  webm.utilities  webm.overrides
```

`global.css` declares them and a test asserts it matches the list. `base.astro` emits the same
statement as an inline `<style is:inline>` ahead of every stylesheet — **because a bare `@layer`
statement does not survive bundling.** It is attached to no rule, so nothing carries it into the
output chunk, and layer order falls back to first appearance in whatever the bundler emitted. Two
import lines reordered in a page's frontmatter is enough to invert reset and components.

The client's `src/styles/custom/_index.css` reaches the build through a virtual module, since the
package cannot import a relative path in the site. It was disconnected until an end-to-end test
proved a rule there never shipped; that test is permanent.

---

## 5. Namespaces

| Path | Owner | Notes |
| --- | --- | --- |
| `/_actions/*` | Astro | The form endpoint. Always in `run_worker_first`. |
| `/webm` | package | The component scratch page. **Dev server only** — it does not exist in a build. |
| `/webmaster`, `/webmaster/og.png` | package | The page every site has: who built it, who to call. Indexable, in the sitemap; the footer credit links here and this page carries the one outbound link to the agency, with its UTM parameters. Its share image is served from the package so a redesign reaches every site on `npm update`. The body is the site's if it exports `webmasterPage` from its registry: the component receives the merged copy (`{ title, description, intro, body }`; `intro` and `body` as HTML, the agency link already in `intro`) and lays it out like the site's other document pages, while the route, the copy, the `<head>`, the share image and the graph stay the package's. Without the export, an `<h1>` (or the site's `pageHeader`) and a stack of paragraphs. Off switch: `webmaster: false`. |
| `/portal/*`, or whatever the site names it | site | A web app, if the site grows one. Not reserved by the package; see below. |


---

## 6. The integration

A client's `astro.config.mjs` is six lines. Everything that used to be ninety lines of comments
explaining traps is now a decision made once here, and a fix propagates on `npm update`:

- `site` derived from `webmonterey.json`; canonical tags, Open Graph URLs and the sitemap are
  suppressed while `domain` is the placeholder, because a canonical pointing at localhost is
  worse than none.
- `output: 'static'`; a route needing a binding opts out per file with `prerender = false`, and
  every such route must be in `run_worker_first` in both slash forms or it returns 200 to curl
  and a 404 page to Chrome. Doctor checks.
- The package's own `.ts` source is marked `noExternal` so `cloudflare:workers` resolves; the
  adapter handler is excluded from pre-bundling so `astro check` cannot kill a running dev server.
- **The adapter is named in the site's config, never set from the integration.** An adapter
  registered through `updateConfig` does not run its own hooks, and the build then dies on the
  first on-demand route. `adapter()` is exported pre-configured with `imageService: 'compile'` so
  no site accidentally pays for Cloudflare Images.
- Eight virtual modules give the package the site's config, design, compiled tokens, registry,
  forms, custom CSS, the real pixel size of the share image, and which favicons actually exist.

Every injected route has an off switch. Two once did not, and a site's own `public/robots.txt`
lost to the injected one silently.

---

## 7. The config surface

`webmonterey.json` is the site's identity, and every field is read by exactly one seam
(`includes/webmonterey/site.ts`) so a rename is one edit and doctor has one thing to validate.

| Field | What it decides |
| --- | --- |
| `client`, `domain` | Identity. `CHANGEME` is handled differently by five consumers: the credit throws, robots omits the sitemap line, email falls back to the domain. Never guessed into a `<title>`. |
| `repo`, `worker`, `slug` | The derived names, recorded so they are visible. |
| `launched` | The date that turns placeholder-artwork and environment warnings into failures. |
| `environment`, `stagingEmail` | Staging rewrites every recipient and makes every build a preview: noindex, no sitemap, `Disallow: /`, no GTM. Anything on `workers.dev` redirects mail regardless. Both directions of getting it wrong are silent, so doctor checks both against `launched`. |
| `gtmId` | Public by design; tracked here because `.env` is absent on Workers Builds and a site lost all analytics in production over exactly that. `PUBLIC_GTM_ID` still overrides. |
| `timeZone`, `locale` | Every client-facing date. Cron runs in UTC; `hourNow()` is the companion. |
| `shortName`, `brandTitles` | Title composition, for a long client name or a site whose pages author full titles. |
| `copy` | Overrides every visitor-facing string the package renders, merged at any depth. The package owns the mechanism; the client owns the words. |
| `organization` | Contact and identity fields the site's structured data reads. **Frozen** — this is the interface that kept growing; the builders in §9 are the escape hatch, not another field here. |
| `features` | Technical switches for what is *wired*: `compliance`, `d1`, `turnstile`. `platform` is reserved and inert until the platform mail relay exists. Never commercial. |
| `app` | §5. |

---

## 8. The form pipeline, email, and staging

```
1. validate       cheapest, rejects most malformed input; a checkbox group is read with getAll
2. honeypot       no network, no third party; answers as though it succeeded
3. Turnstile      fail closed - a caught error rejects, never admits; hostname and action bound
4. D1             the enquiry is now safe even if email fails
5. deliver        two messages to the site's queue - notify, autoresponse - and the response
                  goes out; inline, in that order, when the site has no queue or it refused
```

**The queue is the same reasoning as storing first, one step on.** The test is whether the
visitor needs the result now: validation, the honeypot, Turnstile and the D1 write, yes; the
mail, no. So with `features.queue` on the action hands two messages to the site's Cloudflare
Queue and answers. `webm queue` creates the two queues, wires them and prints what on the site
now goes through the queue; `webm upgrade` runs it on every site - the one upgrade step that
leaves the machine, so it writes nothing when wrangler cannot answer and the site stays inline
until it is run again. The consumer - `formQueue()` from the queues include, exported by the
scaffold's `src/worker.ts` through `defineWorker` - retries a failed notification with a delay
until wrangler's `max_retries` moves it to the dead-letter queue, where a person can see it; and
never retries the autoresponse, which was already the rule. Two messages, not one, so the second
rule does not break the first. The message carries the fields and the request hostname: with D1
off the queue is the durable record, and the staging redirect needs a hostname a consumer has no
request to read. A site adds its own kinds - a CRM add, a Slack post - as handlers by kind on the
same consumer.

**Inline is the fallback, and stays tested.** The flag off, the binding missing, a message over
the size limit or `send()` throwing all fall to the in-request path every site ran before 1.6.0,
through the same two functions in `forms/deliver.ts` the consumer calls. A site must deliver mail
with the queue down, the way it must render with the platform down.

Turnstile is per form: `features.turnstile` switches the capability on, and a form whose
component renders no widget — a newsletter box — opts out with `"turnstile": false`, because
verifying it rejects every real subscriber while looking completely normal. A form with nowhere
to deliver refuses rather than saying thank you.

**Staging never mails a real person.** `sendEmail` is the one place every template passes
through, so the redirect lives there and not at each call site. `environment` is build-time
config — the only signal a scheduled handler can read — and the `workers.dev` hostname covers the
branch preview of a launched site that inherits `production` from main. The redirected message
is genuinely sent, to `stagingEmail`, with the real recipients in the subject and headers;
Mailgun's test mode would verify the API call and nothing about the rendering.

**There is no default inbox.** A staging site with no `stagingEmail` throws rather than mailing
the real recipients, and doctor fails it before anyone submits a form.

### Staging sites and branch previews are a different build

Workers Builds deploys every pushed branch to `<branch>-<worker>.<account>.workers.dev` and
comments the URL on the PR — that is the client's review link, and it is sold as a feature. It is
also a public URL of a copy of the site — and until the site launches, so is `main`. So a build is
a **preview build** on either of two signals, decided in one pure function, `isPreviewBuild`:
`environment: "staging"` in webmonterey.json (every build, every hostname, the laptop included),
or any branch other than the production one (`main`, or `productionBranch` on the integration;
from the `WORKERS_CI_BRANCH` Workers Builds injects). A preview is: every page noindex with no
canonical, no sitemap, `robots.txt` disallows everything, GTM does not load, and `/webmaster`
emits no graph. Together with the `workers.dev` mail redirect, a preview can be handed to a client
with nothing to warn them about. A local build of a production site has no branch and is
production output.

Until 1.3.0 only the branch was a signal, so `main` of a site that had not launched was
indexable on its `workers.dev` hostname — the case that made `environment` the switch. Flipping it
at launch is therefore what makes a site indexable, which is why it happens after the custom
domain is live and never before, and why a launched site still declared staging disappears from
search; doctor fails that.

---

### Secrets with a live value and a test value

One convention, package-wide. Such a secret is stored on the Worker twice, `<NAME>` and
`<NAME>_TEST`, suffix at the end so the pair sorts together, for any service that comes in a
sandbox flavour - never a `_TEST_` infix, never a scheme per service. Which one a request reads
is the staging rule above, unchanged: `isStagingDeployment(environment, hostname)` picks `_TEST`
on a staging site or any workers.dev host, live otherwise, so nothing flips at launch and local
dev - a staging deployment - keeps test keys in `.dev.vars`. `getBindingForMode` and
`hasBindingForMode` in the workers include wrap `getBinding` with that selection, and the missing-
secret error names the exact secret that is unset, suffix included. A secret with one value is
plain `getBinding`, as before. `webm doctor` warns on the two disagreements visible in source: a
name read in both styles, and `.dev.vars.example` listing a mode-read name without its twin.
Nothing service-specific ships here; the first site to need it had the Stripe version in a file
of its own, and that file is now two calls.

### A secret is read the same way however it is bound

Cloudflare has two places a secret can live. A Worker secret (`wrangler secret put`) is one
value on one Worker, and arrives on `env` as a string. A Secrets Store secret is one value on the
account, bound to any Worker that needs it under `secrets_store_secrets` in `wrangler.jsonc`,
and arrives as an object whose `get()` is awaited. The second is right for anything that is one
per account rather than one per site - the Mailgun webhook signing key, a Stripe key a fleet
shares - because rotating it is one edit rather than one `secret put` per Worker, and wrong for
a per-site key that would then need a per-site name in a shared namespace. So a site chooses
per secret, and the package must not care which it chose: every secret read in the package goes
through `getSecret(name)` (and `getSecretForMode` for a live/test pair), which returns the string
either way and is async for that reason. `getBinding` stays synchronous for resources - D1, a
queue, a dataset - and refuses nothing; `hasBinding` counts a store binding as present. The
selection is in `workers/secret.ts` with no `cloudflare:workers` import, so it is tested; `env.ts`
binds it to the real `env`. What a site gives up locally is `.dev.vars` for that name: `wrangler
dev` reads a local copy created with `wrangler secrets-store secret create` without `--remote`,
and the package's error for a store binding with nothing behind it names that command. `webm
doctor` counts a name bound through the store as set, `_TEST` twin included, and warns on a store
binding whose name nothing reads - the package's own secret names are listed in the checks for
that, and a test holds the list to the source. Workers Builds' generated token cannot bind a store
secret; the launch skill says which permission to add.

### Analytics: the site writes, the platform reads

Every site with `features.analytics` writes to a Workers Analytics Engine dataset named for its
slug, through the `ANALYTICS` binding: the form pipeline's events - stored, queued, honeypot,
Turnstile failed, notify sent or failed, autoresponse failed - and a page-view count from a
one-line beacon on each production page, because prerendered pages never reach the Worker. The
column contract is in `analytics/datapoint.ts` and is fleet-wide: the platform's queries depend
on it. What is never written: an identifier, a cookie, an IP, a user agent, a full referrer, a
query string. Cookieless and aggregate is what lets the beacon run without consent, and it still
stays off on previews and on pages rendered with `analytics={false}`, the same gates as GTM.
Reads need an account-level token and belong to the platform (§13); the dataset costs nothing to
create, so the scaffold ships the binding on.

### Marketing mail: the site's list, Mailgun to send

Offered to select clients behind `features.marketing`. The subscriber list is a table in the
site's SECOND D1 database, `<slug>-mktg`, bound as `DB_MKTG` with its own `migrations-mktg/`
folder - the purpose-suffix rule from §2, so the list can be exported, backed up or dropped
without touching submissions. Mailgun lists are not used: the client owns their subscribers the
way they own their enquiries, a segment is a WHERE clause, and the site then needs nothing from
Mailgun but sending, so the marketing key is a domain sending key for `mktg.<domain>` that can do
nothing else - `MAILGUN_MKTG_API_KEY` and `MAILGUN_MKTG_DOMAIN`, with `_TEST` twins.

What the site takes on in exchange, all in the marketing include: **confirmed opt-in**, always -
a form with a `subscribe` block writes a pending row and sends a confirmation from the
transactional domain, and nothing is sent until the link is clicked; **provenance** on every row -
source, the form's own statement of what the list sends, the timestamps, the IPs - because the
email spec says an address in a database is not evidence its owner asked; **the two link pages**,
confirm and unsubscribe, one click each, laid out by the site through the `marketingPage` seam;
**the webhook** that applies Mailgun's unsubscribed, complained and permanent-failed events to the
row, so the header unsubscribe mailbox providers show - Mailgun's, on the marketing domain only -
and the site's list agree; and **campaigns** as batches of 1,000 through Mailgun's recipient
variables, each batch a queue message retried alone and idempotent per batch, with the
per-recipient unsubscribe link in the footer. A suppression from a complaint or a bounce is never
undone by a form; an unsubscribe is, because a person signing up again is a new decision.

Composition is the site's: a portal action, a cron, whatever the client has - the package ships
`sendCampaign`, not a screen, by the zero-visible-components rule.

## 9. Structured data: parts, not a verdict

Serializing a graph is identical on every site: one `@graph` so nodes reference each other by
`@id`, `<` escaped so a value cannot close the script tag, empty fields dropped, nothing on a
noindex page. That is the package's — `includes/webmonterey/structured-data/nodes.ts` — as
builders for the common nodes plus the serializer.

*Which* nodes, with *which* fields, is what a business claims about itself, and that is the
site's. So the package emits nothing by default. A site composes its graph in a component,
exports it as `structuredData` from its registry, and the layout renders it into `<head>` on every
indexable route with `{ title, description, image }`. `/webm:launch` is where that gets decided,
once, with the client's real details in front of you.

---

## 10. How the skills reach a site

**Claude Code does not read skills out of `node_modules`.** Discovery is directory-based, and an
npm package is none of those directories. A `skills/` folder inside the installed package is
inert.

What works: any folder under `.claude/skills/` containing `.claude-plugin/plugin.json` loads as a
plugin named `<folder>@skills-dir` — no marketplace, no install step. `webm sync`, wired as the
site's `postinstall`, writes that folder on every install:

```
.claude/skills/webm/               GITIGNORED - regenerated every npm install
  .claude-plugin/plugin.json       { "name": "webm", "version": "<package version>" }
  .webm-sync.json                  the marker doctor reads
  skills/                          start · launch · upgrade · new-component · traps
  agents/  hooks/                  when the package ships any; empty today
```

**The folder name is the namespace.** `/webm:launch` is the fleet's; `/add-event` is the
client's, committed beside the plugin at `.claude/skills/add-event/` and never touched by a sync.
A client's own agents go in `.claude/agents/`. Namespaced means fleet; bare means this client.

**Skills ship inside the npm tarball, so skills and code are one artifact.** A marketplace plugin
updates globally in the background while the package updates per repo; the two drift, and a
doctor check written for one version mis-fires on the other. Materialized skills cannot skew.

### Three kinds of package-owned file on disk

| | Where | Rule |
| --- | --- | --- |
| **REPLACE** | `.claude/skills/webm/`, `scripts/`, `.github/workflows/ci.yml` | Regenerated every install. A fix propagates. |
| **ADD-ONLY** | `migrations/` | Copied when absent, never rewritten. An applied migration must not change. |
| **MERGE** | `.claude/settings.json` | The package's deny rules are added when absent; the rest of the file is the site's. |
| **SEED** | `public/`, `CLAUDE.md`, `CONTENT.md`, `src/forms/contact.json`, editor config | Written once by `webm new`, then the client's outright. |

Anything a client will edit is SEED. Putting it in REPLACE throws their work away on the next
update, silently.

### The upgrade skill is thin on purpose

An invoked skill's text enters the conversation once and is not re-read. `/webm:upgrade` runs
`npm install`, which overwrites its own `SKILL.md` with the new version's, and keeps executing the
*old* instructions. So the steps live in `webm upgrade` — the binary on disk is the new version
the moment the install finishes — and the skill says "run the CLI."

---

## 11. `webm doctor`

Every check maps to a trap that produced a real incident, and every failure is silent in normal
use — which is the whole reason a command has to look for it. The checks are pure functions of a
context built once, so the suite is tested without a site on disk, and every check that scans
source strips comments first: three checks have fired on their own documentation.

| Check | Fails silently as |
| --- | --- |
| `run-worker-first` | 200 to curl, a 404 page in Chrome |
| `block-types-registered` | the block renders as nothing |
| `compatibility-date` | every page renders as `[object Object]`, or the site refuses to build |
| `cron-without-handler` | the cron fires and does nothing, forever |
| `actions-exist` | the button posts to an action that is not there |
| `migrations-cover-tables` | the repo can no longer rebuild its own database |
| `d1-binding` | the form thanks the visitor and stores nothing |
| `environment` | a launched site diverting client email, or a preview mailing real contacts |
| `staging-email` | every send on the preview throws |
| `image-on-demand` | a dead `/_image` URL in production only |
| `changeme`, `timezone`, `skills-synced`, `mcp-docs`, `placeholder-branding`, `seeded-files`, `literal-values`, `select-element`, `webmaster-credit` | see each check's `silentAs` |

`webm audit` is the doctor's sibling for things only a **build** can answer — images with no alt
attribute, internal links that land nowhere, a sitemap that is missing, unadvertised or lists a
page that does not exist — plus a probe of every external link. It runs in `/webm:launch`.

A false positive teaches people the doctor cries wolf, which is worse than a miss. Warnings are
for a site mid-build; failures are for things that are wrong on a launched site.

---

## 12. Upgrade, versions, lifecycle

- **`astro` is a peer dependency** with a caret on the majors the package supports. Never a plain
  dependency: two copies of Astro in one tree break the integration in ways that are hard to read.
- **An Astro minor should need nothing.** CI catches it if not. **An Astro major** gets a package
  major, a codemod, and a widened peer range only after `examples/minimal` is green on it. CI has
  a leg that tests the next Astro major the moment one is in prerelease, and stays silent until
  then — a warning light that is always on gets learned as normal.
- **A major must ask something of a site**, and it ships a codemod. A major that asks for nothing
  is a minor, however much the API shrank; the release script refuses otherwise.
- **Codemods are idempotent.** A half-finished upgrade gets re-run.
- **The package owns the toolchain floor.** One constant names the minimum wrangler a release was
  tested with; the scaffold writes it into a new site and `webm upgrade` raises an old site to it,
  installing the exact version the adapter's Cloudflare plugin pins so the site ends with one copy.
  A fleet-wide advisory in miniflare or workerd is fixed by raising the floor once and letting sites
  upgrade, not one lockfile at a time - and never by `npm audit fix`, which differs from site to
  site and cannot be tested once. `webm doctor` warns a site that is below it. Astro stays a peer.
- **A site can pin.** Sitting on an old major is legitimate.
- **Every trap that caused an incident becomes a test** in `examples/minimal`, against built
  output, on every PR — because the layer-order bug was invisible in source and in `astro dev`.
- **The release is one command** — `npm run release` — because each step used to be separately
  skippable and eight versions went out with no tags. Changelog entry first, checks before the
  bump, tag pushed with the commit and read back off origin, then the published tarball installed
  the way a client would.

---

## 13. The platform

Fleet inventory, provisioning, the mail relay, billing, backups — none of it lives here. The
platform is its own private repo with its own design, and this package's only contact with it is
the reserved `features.platform` flag.

One rule governs that contact, and it belongs in this document because it constrains the
package: **a client site must render with the platform down.** The platform may sit in the path
for mail, forms and billing — those can queue and retry. It must never be in the path for serving
a page.

---

## 14. Decision register

| # | Decision | § |
| --- | --- | --- |
| 1 | Package owns plumbing, never appearance | 1 |
| 2 | Zero visible components ship | 1 |
| 3 | Every default has a documented way out; removing a seam is a breaking change | 1 |
| 4 | Public, npmjs, MIT, personal scope; no credential anywhere | 2 |
| 5 | One name everywhere — the domain minus its TLD — for repo, Worker, D1, R2, KV | 2 |
| 6 | Tokens are `design.json`, compiled at build; no `tokens.css` | 3 |
| 7 | Eight layers in one list, emitted inline ahead of every stylesheet | 4 |
| 8 | `/webm` scratch page is dev-only | 5 |
| 9 | A web app is the site's own namespace, named for its URL and wired directly; nothing reserved (reversed in 1.6.0) | 5 |
| 10 | Auth, sessions and users are built for the first client who needs them, not reserved | 5 |
| 11 | The adapter is named in the site's config, never set by the integration | 6 |
| 12 | `organization` is frozen; the structured-data builders are the escape hatch | 7 |
| 13 | `features` are technical switches, never commercial | 7 |
| 14 | Store before send; Turnstile per form; a form with nowhere to deliver refuses | 8 |
| 15 | Staging redirects every recipient; no default inbox; refuse rather than guess | 8 |
| 16 | The package emits no JSON-LD; the site composes from builders at launch | 9 |
| 17 | Skills ship in the tarball as a skills-dir plugin; namespace `webm`; full replace | 10 |
| 18 | REPLACE / ADD-ONLY / SEED | 10 |
| 19 | Upgrade logic in the CLI; the skill is thin | 10 |
| 20 | `astro` is a peer; CI tests the next major when one exists | 12 |
| 21 | A major ships a codemod and names what a site must do | 12 |
| 22 | The platform is elsewhere, and a site must render with it down | 13 |
| 23 | American spelling in prose; the code already was | — |
| 24 | The integration injects no route the site already has a file for; the 404 is the first | 6 |
| 25 | TypeScript stays where `@astrojs/check` and Astro's language tooling are; 7.x waits for 7.1 | 12 |
| 26 | The `/webmaster` copy names the client; `{client}` is filled everywhere the copy is used | 7 |
| 27 | A secret with a test value is `<NAME>_TEST`, selected by the staging rule; nothing flips at launch | 8 |
| 28 | Mail leaves through the site's queue when it has one, inline when it has not; the autoresponse never retries | 8 |
| 29 | Analytics: the site writes a slug-named dataset under one fleet-wide column contract; the platform reads; nothing identifying is written | 8 |
| 30 | The marketing list is the site's own second D1 database; Mailgun only sends, through a domain sending key | 8 |
| 31 | Confirmed opt-in always, provenance on every row, and a provider suppression is never undone by a form | 8 |
| 32 | A secret is read with `getSecret` whether it is a Worker secret or a Secrets Store binding; the site chooses per secret in `wrangler.jsonc` | 8 |
| 33 | The package owns the wrangler floor; `webm upgrade` raises a site to it and nothing else moves; never `npm audit fix` | 12 |
