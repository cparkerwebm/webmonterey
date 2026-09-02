# @cparkerwebm/webmonterey

Every published version, what changed, and whether it asks anything of you.

Entries answer one question: **should I move a site onto this, and does anything need doing
afterwards?** Versions are tagged in git — `git checkout v1.0.0` is the code inside that release —
and each has a [GitHub release](https://github.com/cparkerwebm/webmonterey/releases).

Upgrade a site with `npx webm upgrade`, then build and `npx webm compare` against the previous
build. See `/webm:upgrade`.

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
