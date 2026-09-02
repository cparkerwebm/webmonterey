# @cparkerwebm/webmonterey

Every published version, what changed, and whether it asks anything of you.

Entries answer one question: **should I move a site onto this, and does anything need doing
afterwards?** Versions are tagged in git — `git checkout v1.0.0` is the code inside that release —
and each has a [GitHub release](https://github.com/cparkerwebm/webmonterey/releases).

Upgrade a site with `npx webm upgrade`, then build and `npx webm compare` against the previous
build. See `/webm:upgrade`.

---

## 1.2.0 — 2026-09-02

### Added

- **Every site has a `/webmaster` page.** Injected by the integration, rendered with the site's
  own chrome, indexable and in the sitemap. It says who designed, built and manages the site and
  who to contact when something is wrong, carries its own share image (served from the package at
  `/webmaster/og.png`, so a redesign reaches every site on `npm update`) and its own structured
  data — a `WebPage` about the agency's `Organization`, using the same `@id` the agency's own site
  declares. Every word is overridable through `copy.webmaster`. Off switch: `webmaster: false` on
  the integration.

- **`webm audit`** — the pre-launch checks only a build can answer: images with no `alt`
  attribute (an explicit `alt=""` is fine), internal links that land on no page or Worker route,
  and a sitemap that is missing, unadvertised, or lists a page that was not built. External links
  are probed and reported as warnings. `/webm:launch` runs it and says how to act on each finding.

- **Branch previews are a different build.** On any Workers Builds branch other than the
  production one (`main`, or `productionBranch` on the integration), every page is noindex with
  no canonical, there is no sitemap, `robots.txt` disallows everything, Google Tag Manager does
  not load, and `/webmaster` emits no graph. Detected from the `WORKERS_CI_BRANCH` variable
  Workers Builds injects; a local build is production. Mail on previews was already redirected by
  the `workers.dev` hostname. Nothing to do on a site.

- **`/webm:launch` asks two questions out loud** before the flip: is Google Tag Manager
  configured and published for this site, and has the launch annotation been added in Google
  Analytics. Neither is knowable from the repo, so the skill waits for the answer.

### Changed

- **The default share image is `public/opengraph.png`** (was `open-graph.png`). `webm new` seeds
  the WebMonterey artwork there - the same image the `/webmaster` page uses - and a client replaces
  it with their own; `webm doctor` flags the seed until they do. **On an existing site:** rename
  `public/open-graph.png` to `public/opengraph.png`, or every page's `og:image` points at a file
  that is not there.

- **The footer credit is an internal link.** `Powered by WebMonterey` now goes to the site's own
  `/webmaster` page instead of leaving the site; that page carries the one outbound link, with
  the UTM parameters (`utm_campaign=webmaster`). The email footer keeps the outbound link — an
  email cannot usefully point at a page on the site it is about.

  **On an existing site:** the import moves —
  `@cparkerwebm/webmonterey/webmonterey/credits/Credit.astro` is now
  `@cparkerwebm/webmonterey/webmonterey/webmaster/Webmaster.astro`, and the module
  `webmonterey/credits` is `webmonterey/webmaster`. The doctor check is `webmaster-credit`. The
  site's `structuredData` component is not rendered on `/webmaster`; the page emits its own.

---

## 1.1.0 — 2026-09-02

### Changed

- **One name, everywhere.** `webm new` now derives a single name from the domain — `example.com`
  becomes `example` — and uses it for the GitHub repo, the Worker, the D1 database, the R2 bucket
  and any KV namespace. The `webm-` prefix and the `-db` / `-media` suffixes are gone from cloud
  resources: Cloudflare scopes every one of those names to the account, so in an account that holds
  nothing but client sites a prefix said nothing, and one-of-each needs no suffix. The TLD is still
  dropped, for the same reason as before — it keeps a domain out of preview hostnames, which is
  what trips Chrome's lookalike warning.

  **Existing sites are untouched.** Every name is read from the site's own `webmonterey.json` and
  `wrangler.jsonc`; nothing renames a resource that exists. A rebuild onto the new convention is a
  new repo and new resources beside the old, tested in full, then a domain cutover — which is the
  clean way to do it anyway.

- **No agency defaults left in the package.** `webm new` reads the GitHub owner from
  `git config webm.org` and the staging inbox from `git config webm.stagingEmail` (falling back
  to `user.email`); `--org` and `--staging-email` override for one run. Without an owner it refuses
  and says how to set one. Set it once per machine:

  ```sh
  git config --global webm.org <your-github-owner>
  ```

---

## 1.0.0 — 2026-09-02

The first public release, on npmjs. This is the framework as it stands after two private
generations and an ownership audit — not a rewrite, and not the same package renamed.

### What a site gets

- **The integration.** One call in `astro.config.mjs` derives `site` from `webmonterey.json`,
  sets static output, wires the sitemap with noindex filtering, and provides the virtual modules
  a package needs to read files in the repo it is installed into.
- **The design system as data.** `design.json` carries ~15 brand values over a 124-token
  system; the compiler emits CSS custom properties, email-safe literals and brand context from
  one file.
- **The cascade.** Eight layers in a fixed order, emitted inline ahead of every stylesheet
  because a bare `@layer` statement does not survive bundling. Reset, base, layout and
  utilities, with `src/styles/custom/` as the client's override seam.
- **The form pipeline.** Validate → honeypot → Turnstile (per-form opt-out) → D1 → notify →
  autoresponse. Store before send. A form with nowhere to deliver refuses rather than saying
  thank you.
- **Consent.** Consent Mode v2 defaults before GTM loads, GPC honored, a native `<dialog>`
  whose decline buttons never leave the fold, and `whenConsented()` for every third party.
- **Staging never mails a real person.** `environment: "staging"` and any `workers.dev`
  hostname redirect every recipient to `stagingEmail`. There is no default inbox in the package;
  a staging site without one refuses to send and fails `webm doctor`.
- **The web app namespace, reserved.** `src/pages/webapp/` on every site; `app.path` in
  `webmonterey.json` is the public URL, rewritten onto the folder by injected middleware when
  it differs. Off by default; nothing runs until it is switched on.
- **Structured data as parts, not a verdict.** The package emits no JSON-LD of its own. A site
  composes its graph from the builders in `@cparkerwebm/webmonterey/structured-data` and exports
  it as `structuredData` from its registry; `/webm:launch` is where that gets written.
- **`webm` CLI:** `new`, `sync`, `doctor` (21 checks, each for a failure that stays silent),
  `upgrade` (branch, install, codemods, resync), `compare` (text, head, JSON-LD and CSS of two
  builds), `design:extract`.
- **Five skills**, materialized into `.claude/skills/webm/` on every install: `/webm:start`,
  `/webm:launch`, `/webm:upgrade`, `/webm:new-component`, `/webm:traps`. A client's own skills
  and agents sit beside the plugin folder and are never touched.

### What is deliberately absent

- **No registry credential anywhere.** Not in the scaffold, not in CI, not in Workers Builds.
- **No visible components.** Every block a visitor sees is built per client.
- **No `/webm` scratch page in a production build.** It exists in `astro dev` and nowhere else.
- **No default JSON-LD, no default inbox, no plan or tier anywhere in config.**
