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
| The block router, the base layout, robots.txt, the 404 | Same for every site. |
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
| `src/pages/webapp/` | The web app, if the site grows one (§5). |
| The registry: `blocks`, `header`, `footer`, `panels`, `pageHeader`, `structuredData` | How a site hands the package its chrome and its claims. |
| `public/`, `wrangler.jsonc`, `migrations/` | Copied verbatim, real resource IDs, the site's own schema. |

---

## 2. Topology and distribution

```
cparkerwebm/webmonterey          public · MIT · npmjs as @cparkerwebm/webmonterey
  src/                           the package
  skills/ agents/ hooks/         the Claude Code plugin, materialized into every site
  template/                      what `webm new` seeds and `webm sync` refreshes
  examples/minimal/              a real site CI builds on every PR

webmonterey/<domain_underscored> private · one per client · unchanged by anything here
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

**Nothing in this repo authenticates as the agency.** No inbox, no API key, no client list. The
one default that used to — a staging email address — is now supplied by `webm new` from
`git config user.email` and required by `webm doctor` when a site is staging.

### Three names, three jobs

|             | Example                                              |                              |
| ----------- | ---------------------------------------------------- | ---------------------------- |
| GitHub repo | `webmonterey/autire_com`                             | Full domain, **underscores** |
| Slug        | `autire`                                             | Domain minus the TLD         |
| Cloudflare  | `webm-autire`, `webm-autire-db`, `webm-autire-media` | The slug, prefixed           |

The slug drops the TLD because a Worker named `webm-autire-com` puts `autire-com` into every
preview hostname, and Chrome's lookalike-domain check then warns the client their own preview
looks fake. `webm-autire` embeds nothing that reads as a domain. `slug.ts` owns the derivation;
`webm new` prints all three.

### The prefix is `webm-`

Custom properties (`--webm-action`), class names (`.webm-section`), Cloudflare resources
(`webm-<slug>`), the CLI, the skills namespace (`/webm:launch`). One prefix, so anything ours is
recognizable at a glance in any file, log or dashboard.

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
| `/<app.path>/*` | site | The web app. Reserved on every site; see below. |

### The web app namespace, reserved from day one

A URL namespace is the one thing that is expensive to retrofit. Once a site has real pages,
carving out `/portal` later means checking every existing URL for a collision. Reserving it costs
one config field and an empty folder, so every site has it from the scaffold:

```jsonc
"app": { "enabled": false, "path": "webapp", "label": "Portal" }
```

**The directory is fixed: `src/pages/webapp/`, on every site.** `path` is the public URL segment.
It defaults to the folder name so the common case needs no rewrite; a client whose customers log
in sets `portal`, `members` or `account`, and the integration injects a middleware that rewrites
`/<path>/*` onto the folder and redirects the folder name to the public path so one page cannot
answer at two URLs. The site never writes a middleware file.

From that one field the integration derives the noindex flag and the sitemap exclusion, and
`webm doctor` checks that `run_worker_first` lists the *public* path in both slash forms, that no
page JSON shares its name, and that every page under the folder is `prerender = false` — a rewrite
can only reach a route the Worker renders.

**What is not reserved:** auth, sessions, user tables. Those get built for the first client who
needs them, in that client's repo, and promoted here only when a second one does. The namespace is
the part that has to exist before it is needed; the rest can wait until it is.

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
| `environment`, `stagingEmail` | Staging rewrites every recipient. Anything on `workers.dev` is staging regardless. Both directions of getting it wrong are silent, so doctor checks both against `launched`. |
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
5. notify         failure here does NOT lose the enquiry; notified_at stays NULL for the resend
6. autoresponse   last, in its own try; a bounce must not take the notification down with it
```

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

---

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
| `app-namespace` | the app 404s in a browser, a page shadows the portal, or a portal page prerenders and never sees a binding |
| `block-types-registered` | the block renders as nothing |
| `compatibility-date` | every page renders as `[object Object]`, or the site refuses to build |
| `cron-without-handler` | the cron fires and does nothing, forever |
| `actions-exist` | the button posts to an action that is not there |
| `migrations-cover-tables` | the repo can no longer rebuild its own database |
| `d1-binding` | the form thanks the visitor and stores nothing |
| `environment` | a launched site diverting client email, or a preview mailing real contacts |
| `staging-email` | every send on the preview throws |
| `image-on-demand` | a dead `/_image` URL in production only |
| `changeme`, `timezone`, `skills-synced`, `mcp-docs`, `placeholder-branding`, `seeded-files`, `literal-values`, `select-element`, `agency-credit` | see each check's `silentAs` |

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
| 5 | Repo `<domain_underscored>`, slug `<domain-minus-TLD>`, Cloudflare `webm-<slug>` | 2 |
| 6 | Tokens are `design.json`, compiled at build; no `tokens.css` | 3 |
| 7 | Eight layers in one list, emitted inline ahead of every stylesheet | 4 |
| 8 | `/webm` scratch page is dev-only | 5 |
| 9 | Web app namespace reserved on every site: folder fixed, `app.path` public, middleware injected | 5 |
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
