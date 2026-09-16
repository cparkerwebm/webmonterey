# @cparkerwebm/webmonterey

Every published version, what changed, and whether it asks anything of you.

Entries answer one question: **should I move a site onto this, and does anything need doing
afterwards?** Versions are tagged in git — `git checkout v1.0.0` is the code inside that release —
and each has a [GitHub release](https://github.com/cparkerwebm/webmonterey/releases).

Upgrade a site with `npx webm upgrade`, then build and `npx webm compare` against the previous
build. See `/webm:upgrade`.

---

## 1.8.0 — 2026-09-15

### Added

- **The package owns the toolchain floor, and `npx webm upgrade` raises every site to it.** Until
  now the only place the package said which wrangler a site should have was the scaffold, read
  once, on the day the site was made - so every site kept its own wrangler forever and a
  dependency advisory had to be fixed one repo at a time. The case that forced this: a site
  upgraded 1.5.0 → 1.6.2 still ran wrangler 4.129.0, whose miniflare bundles sharp 0.35.2 and its
  libheif heap overflow (GHSA-rgj7-g3m4-5g8c, high); the fix was three wrangler releases away and
  every range in the chain already accepted it. Now one constant, `WRANGLER_FLOOR` in
  `cli/toolchain.ts`, is the minimum wrangler a release was tested with - **4.131.1** in this one.
  The scaffold writes it into a new site, and **`webm upgrade` gains a toolchain step**, in the
  second half after the codemods: a site whose wrangler is below the floor gets one
  `npm install wrangler@<version>` - the exact version the site's `@cloudflare/vite-plugin` pins
  when that is above the floor, else the floor, so the site ends with one copy rather than two -
  and the step prints what moved, in the queue step's style. A site at or above the floor prints
  `toolchain: wrangler <x>, at the floor` and nothing changes; a site above it is never brought
  down; nothing but wrangler is touched. Not `npm audit fix`: that bumps whatever npm decides that
  day, differs from site to site, and is not something a release can test. **`webm doctor` gains
  `toolchain-floor`**, which reads the installed wrangler - the manifest in node_modules, not the
  range - and warns when it is below the floor, naming both versions and the upgrade that raises
  it; that is how a site that has not upgraded finds out. The end-to-end test puts a site on
  wrangler 4.129.0 under a `^4.118.0` range, upgrades it, and asserts one copy at or above the
  floor, no sharp advisory in `npm audit`, and a passing build. Astro is untouched: it stays a peer
  of the site. And in this direction compatibility_date is safe: the trap is a date newer than the
  bundled runtime, never older.

### Changed

- **`webm doctor`'s `/_image` check now walks the site's chrome, not only its own on-demand
  routes.** The package's own on-demand routes - `/subscribe/confirm`, `/unsubscribe` - render the
  registry's `header`, `footer`, `panels`, `pageHeader` and `marketingPage`, and whatever those
  import; an `<Image>`, `<Picture>` or `getImage` in any of them emits `/_image` on those routes
  and renders broken in production, while every page the site wrote is prerendered and `astro dev`
  looks fine. The check now starts from the registry's chrome exports, follows the site's own
  imports, and fails naming the file and the export it was reached from; a chrome file that maps
  the registry's `blocks` counts every block as reachable. `<Picture>` joins `<Image>` and
  `getImage` on the site's own routes too. The fix is unchanged and now in `/webm:traps` under the
  `/_image` entry: the `Astro.isPrerendered` branch with a plain `<img src={image.src}>`.
- **Every transactional email names the client above the white card, and the page is built to
  render the same in Gmail, Outlook and Apple Mail.** The three templates - the form
  notification, the autoresponse and the subscription confirmation - open with the `client` from
  `webmonterey.json` as the message's one heading, centred above the card, so a person can place
  the message before reading it; until now the first thing that said who it was from was the
  copyright in the footer. The page - tint, name, card, footer - is one shared `renderPageHtml`
  in `emails/layout.ts`, exported from `@cparkerwebm/webmonterey/emails` for a site's own mail;
  a template supplies the card. HTML only: the plain-text part already opens with the copy and the
  footer names the client. The page tint is `#f0eeed`, one step lighter than before.

  The layout is rebuilt because a real send showed the old one did not survive Gmail: the tint sat
  on `<body>`, which Gmail discards, and the white card and the confirm button carried their
  colour as a `background` shorthand on a div and a link, which Gmail dropped - so a Gmail
  reader got black text on white, no card, and a button that was white text on white. Every
  colour now rides on a table cell as `bgcolor` plus `background-color` in six-digit hex, which
  is what Gmail is proven to paint; the card is a full-width table inside a max-width div, because
  Apple Mail ignores `max-width` on a table and Outlook for Windows ignores it on a div, with a
  conditional-comment table for Outlook; the button's padding is on the cell, because Outlook
  ignores padding on a link; the document declares `lang`, a charset and a title. Checked
  construct by construct against Can I Email and by sending into Gmail. Nothing to do on
  `npm update`.

### Fixed

- **A signup on a preview deployment gets a confirmation link back to the preview, not to the
  client's live domain.** The marketing links - the confirmation a new subscriber must click, and
  the per-recipient unsubscribe in a campaign - were built on `https://<domain>/` unconditionally,
  so a signup on a workers.dev preview before launch pointed at the old site and 404ed, and a test
  campaign's unsubscribe did the same. Both now build on the hostname the message carries when
  the deployment is a staging one - environment `staging`, or any workers.dev host, the same rule
  that already redirects a preview's recipients and selects its `_TEST` secrets - and on the
  domain otherwise. A cron passes no hostname and falls back to the domain. Always https. The
  choice is `mailOrigin` in `marketing/links.ts`, pure, with a test for a staging host, a
  production host and null.
- **The autoresponse heading above the echoed fields was the placeholder, not the words.** Since
  1.0.0 every autoresponse has carried the literal text `${DEFAULT_COPY.email.autoresponseHeading}`
  where "What you sent us" belonged, in both the HTML and plain-text parts: the constant was a
  single-quoted string holding a template expression, which nothing ever interpolated. Found on
  a rendered test send, not by a test, so a test now asserts no `${` reaches either part. A
  site takes the fix with `npm update`.

### For every site

1. `npx webm upgrade`. The toolchain step raises wrangler to the floor and says so; nothing else
   on the site changes. A site coming FROM a version before 1.8.0 is still driven by that older
   binary's first half, but the second half runs from the binary just installed, so the step
   applies on this very upgrade - no `--codemods-from` needed.
2. `npx webm doctor` shows `toolchain-floor` ok, and `npm run preview` boots workerd and serves
   the home page.

---

## 1.7.0 — 2026-09-15

A release about where a secret lives. Nothing changes for a site on `npm update`: every secret it
has as a Worker secret is read exactly as before. What it gains is the choice.

### Added

- **Any secret may be bound from the account's Secrets Store instead of put on the Worker, with
  no code change per secret.** Cloudflare has two places a secret can live: `wrangler secret put`
  puts one value on one Worker, a string on `env`; the Secrets Store holds one value on the
  account, bound to any Worker that needs it under `secrets_store_secrets` in `wrangler.jsonc`,
  an object on `env` whose `get()` is awaited. The package read only the first. Now every secret
  the package reads - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `TURNSTILE_SECRET_KEY`,
  `MAILGUN_WEBHOOK_SIGNING_KEY`, and the marketing pair through the mode helper - goes through
  **`getSecret(name)`** and **`getSecretForMode(name, hostname)`**, new on
  `@cparkerwebm/webmonterey/cloudflare/workers` and async, which return the string whichever way
  the name is bound. A site's own code - a Stripe key, custom mail - reads its secrets the same
  way. Which way is a per-secret decision in `wrangler.jsonc`: the Secrets Store for what is one
  per account (the Mailgun webhook signing key first; a key a fleet shares), a Worker secret for
  what is one per site. `getBinding` and `getBindingForMode` stay, synchronous, for resources -
  D1, the queue, the dataset - and `hasBinding` counts a store binding as present. The selection
  lives in `workers/secret.ts` with no Worker import, so it is unit-tested: a string, a `{ get }`
  object, a missing binding, and a store binding with nothing behind it, whose error names the
  local command to run. **Proven both ways** on the example site: a signed Mailgun test event to
  `/_webm/mailgun` is 200 with the signing key as a Worker secret and 200 again with it bound
  from a local Secrets Store, and a mis-signed one is 401 in both.

- **`webm doctor`: `binding-modes` knows the store.** A `_TEST` twin bound through
  `secrets_store_secrets` satisfies the twin check, a name read with `getSecret` counts the same
  as one read with `getBinding` in both directions of the mode check, and a store binding whose
  `binding` name nothing reads - not the site's source, not the package - is a warning naming it,
  which is what a typo in the binding name looks like. The package's own secret names are listed
  in the checks for that, and a test holds the list to the source.

- **`/webm:launch` documents the Secrets Store path**, under production secrets: the account-wide
  keys that belong there, the create and bind commands, and the two things that fail silently
  without it - local dev reads a **local copy** created with `wrangler secrets-store secret
  create` without `--remote`, since `.dev.vars` does not stand in for a store-bound name; and
  Workers Builds' generated API token cannot bind a store secret, so the site needs a token with
  **Account → Secrets Store → Edit** selected under the Worker's build configuration. The
  scaffold's `.dev.vars.example` and the site's `CLAUDE.md` say the same in a line each.

### Changed

- **A site's own secret reads should move to `getSecret`.** `getBinding<string>('STRIPE_SECRET_KEY')`
  keeps working for a Worker secret, but a name later bound from the store arrives as an object,
  and asserting `<string>` on it does not make it one - the mail or payment call gets an object
  and fails as a 401 from the provider. One search for `getBinding<string>` and `getBindingForMode<string>`
  is the whole migration; nothing is required today.

---

## 1.6.2 — 2026-09-12

### Fixed

- **`webm upgrade` now runs the NEW version's codemods.** It runs in the old version's process:
  it installed the new package and then ran the codemods from the registry it had already
  imported - the old one, in which a codemod shipping in the version being installed does not
  exist. One site's 1.5.0 → 1.6.0 and 1.6.0 → 1.6.1 upgrades each applied nothing until
  `--codemods-from` was run by hand in a fresh process. After the install the command now hands
  over to the binary it just installed, which runs the codemods, the sync and the queue step;
  nothing after the install runs from memory. **A site upgrading FROM 1.5.x, 1.6.0 or 1.6.1 is
  still driven by that older binary once more**, so on those sites follow `npx webm upgrade`
  with `npx webm upgrade --codemods-from <the version you came from>`; from 1.6.2 onward that is
  automatic. The end-to-end test now upgrades a site from 1.5.0 across the 1.6 codemods and
  asserts their changes landed.

- **`webm queue` no longer mistakes an existing queue for a failure.** Wrangler 4.129 says
  "Queue name 'x' is already taken … [code: 11009]", not "already exists"; the step reported it
  as a failure - quoting the version banner as the reason - and stopped before creating the
  `-fail` queue. It matches the error code now, and shows the error line rather than the
  banner.

---

## 1.6.1 — 2026-09-12

### Changed

- **The dead-letter queue is `<slug>-fail`, not `<slug>-dlq`.** What lands there has failed every
  retry, and the name should say so to someone reading the Cloudflare dashboard who has never
  heard the term. One site upgraded in the minutes between: **the 1.6.1 codemod renames the
  dead-letter queue in `wrangler.jsonc`, and the queue step creates the `-fail` queue** - it now
  creates both names whether or not the block is wired, since an existing queue is a no-op. The
  old `-dlq` queue is left for a person: the upgrade never deletes a resource, and the codemod
  prints the `wrangler queues delete` command to run once the next deploy is live.

---

## 1.6.0 — 2026-09-12

A release about what happens after the visitor has their page: mail through a queue, events
into analytics, a marketing list the client owns. Nothing in it is on for an existing site until
the site switches it on; a plain `npm update` changes the two things named under **Changed** and
nothing else. `npx webm upgrade` runs the one codemod, syncs the skills and checks the wiring.

### Added

- **Mail leaves through the site's Cloudflare Queue.** The visitor never needed the notification
  or the autoresponse to continue, so with `features.queue` on the action hands two messages to
  the queue and answers; the consumer retries a failed notification with a delay until
  `max_retries` moves it to the dead-letter queue, where a person can see it, and never retries
  the autoresponse, which was already the rule. Two messages, not one, so the second rule does not
  break the first. **Inline is the fallback and stays tested:** the flag off, the binding missing,
  a message over the limit or `send()` throwing all send in the request exactly as before,
  through the same two functions in `forms/deliver.ts`. Every scaffold now writes
  `src/worker.ts` - `defineWorker({ queue: formQueue() })` - and sets `main`, so a cron is one
  more handler in a file that exists. **`webm queue` creates the two queues (`<slug>`,
  `<slug>-dlq`), wires them, and prints what on this site now goes through the queue; `webm
  upgrade` runs it on every site** - the one upgrade step that leaves the machine, so when
  wrangler is not logged in it writes nothing, says so, and the site keeps sending inline until
  `npx webm queue` is run again (`--no-queue` skips it). A site adds its own kinds - a CRM add,
  a Slack post - as handlers by kind on the same consumer. `webm doctor` gains `queue-binding`.
  `@cparkerwebm/webmonterey/cloudflare/queues`.

- **Analytics Engine.** Every site with `features.analytics` writes to a Workers Analytics Engine
  dataset named for its slug through the `ANALYTICS` binding: the form pipeline's events and a
  page-view count from a one-line beacon on each production page, because prerendered pages never
  reach the Worker. Cookieless and aggregate - no identifier, cookie, IP, user agent, full referrer
  or query string is ever written - so it runs without consent, and it still stays off on previews
  and on pages rendered with `analytics={false}`. The dataset appears on first write, so the
  scaffold ships the binding and the flag ON, **and the 1.6.0 codemod switches it on for every
  existing site** - the binding, `/_webm/*` in `run_worker_first`, the flag - the one thing this
  release turns on for a site that did not ask, because nothing behind it can fail a deploy and
  every client should have the numbers. The column contract is in `analytics/datapoint.ts` and is
  fleet-wide: the platform's queries depend on it. Reads stay in the platform. `webm doctor` gains
  `analytics-binding`. `@cparkerwebm/webmonterey/cloudflare/analytics`.

- **Marketing mail, for the select sites that have it.** Behind `features.marketing`: the
  subscriber list is a table in the site's SECOND D1 database, `<slug>-mktg`, bound as `DB_MKTG`
  with its own `migrations-mktg/` folder - the client owns their subscribers, a segment is a WHERE
  clause, and Mailgun only sends, through a domain sending key for `mktg.<domain>`
  (`MAILGUN_MKTG_API_KEY`, `MAILGUN_MKTG_DOMAIN`, with `_TEST` twins). Confirmed opt-in always:
  a form with a `subscribe` block writes a pending row and sends a confirmation from the
  transactional domain, and nothing is sent until its link is clicked. Provenance on every row.
  Two injected pages, `/subscribe/confirm` and `/unsubscribe`, one click each, laid out by the
  site through a `marketingPage` registry seam; a webhook at `/_webm/mailgun` that applies
  Mailgun's unsubscribed, complained and permanent-failed events to the row (verified with
  `MAILGUN_WEBHOOK_SIGNING_KEY` before it is read); and `sendCampaign`, batches of 1,000 through
  recipient variables, each batch a queue message retried alone and idempotent. Composition is the
  site's. `/webm:launch` has the section; `webm sync` seeds `migrations-mktg/` once the flag is
  on; `webm doctor` gains `mktg-binding`. `@cparkerwebm/webmonterey/webmonterey/marketing`.

- **Secrets with a live value and a test value.** One convention, package-wide: `<NAME>` and
  `<NAME>_TEST`, suffix at the end so the pair sorts together, for any service with a sandbox
  flavour - never a `_TEST_` infix, never a scheme per service. `getBindingForMode(name,
  hostname)` and `hasBindingForMode` read the `_TEST` value on a staging deployment
  (`environment` staging, or any workers.dev host) and the live one otherwise, by the rule mail
  already uses, so nothing flips at launch and local dev keeps test keys in `.dev.vars`. A secret
  with one value is plain `getBinding`, unchanged. `webm doctor` gains `binding-modes`, warning
  on a name read both ways or listed in `.dev.vars.example` without its twin. Nothing
  service-specific ships; the first site to need it had a Stripe version in a file of its own,
  which is now two calls.

- **`appearance` on the Turnstile component.** `always` (the default, unchanged markup),
  `interaction-only` for an inline single-field form where nothing should show unless a
  challenge is needed, `execute` for visible-once-it-starts. `interaction-only` also drops the
  reserved widget height. One site set `data-appearance` itself with an inline script after the
  component, racing Turnstile's loader; it can pass the prop.

- **`noindex`, `shareImage`, `shareImageWidth` and `shareImageHeight` are page schema fields.**
  The router read the first two defensively and zod stripped them, so a site that set them in
  JSON lost them, and one site forked the whole schema for exactly that. Declared, forwarded
  plainly, and **a site that forked the schema for these can delete the fork.**

- **`webm doctor`: `union-matches-registry`.** A component in the registry but not the union
  passed to `webmontereyCollections`, or the reverse, is a warning naming it - the third step of
  adding a component is the one that gets forgotten, and each half fails differently.

- **A "1.5-shaped" site in the end-to-end test.** The scaffold is laid out the 1.5.0 way - the old
  button constant, an `app` key - and the upgrade path is run against it: codemod, sync, doctor,
  build. The upgrade is exercised on every release from here on.

### Changed

- **The `/webmaster` copy.** "This {client} custom website was **built and managed** by
  WebMonterey…" - _designed_ dropped - and "WebMonterey handles **our web hosting, domain and
  ongoing maintenance of our site**." A site overriding `copy.webmaster` is unaffected.

- **The `/webmaster` button keeps 25px above the paragraph, on every layout.** `AGENCY_CTA_ATTRS`
  - the link attributes plus a `data-webm-cta` marker the page styles - replaces
  `AGENCY_LINK_ATTRS` on the button; the intro link keeps the plain constant. On one site the
  button sat almost touching the copy because the site's own paragraph spacing was a few pixels.
  **The 1.6.0 codemod rewrites the spread in a site's own webmaster layout**; `/webm:webmaster`
  shows the new constant.

- **The measured share-image size applies only to the default card.** A page naming another
  `shareImage` got `public/opengraph.png`'s dimensions stamped on it - the false-dimensions bug
  the measuring was added to prevent, from the other side. Now such a page passes its own size or
  ships no size tags, and the scrapers measure the image themselves.

- **`webmontereyCollections` keeps each block's fields, and accepts an empty array.** Typed as a
  plain array of options it inferred every block as `unknown`, so a site component reading a
  block off the collection failed `astro check`; and the one-member minimum failed
  `astro check` on every fresh scaffold - Workers Builds runs `npm run build`, so the FIRST push
  of every new site failed. Generic over the tuple now, `z.never()` when empty, the schema in a
  pure `blocks.ts` with a type-level test, and **the end-to-end test runs the site's own
  `npm run build`** rather than `astro build`, which is how this was missed. A site that
  re-parsed blocks through its own schema to get types can stop.

- **`webm new` installs `prettier-plugin-astro`.** The scaffolded prettier config named it and
  nothing installed it, so `npm run format` failed on every fresh site.

- **`placeholder-branding` passes on webmonterey.com.** The seed IS the agency's mark, so the
  agency's own site is identical by right; a doctor that failed that repo forever was one people
  learned to skip. The same domain check the credit check uses.

- **`/webm:start` creates D1 with `--binding=DB`.** Without it wrangler prompts and, in a session
  with no terminal, names the binding after the database; the site then failed `d1-binding` until
  it was renamed by hand. The check now says what to rename, and the skill runs `npm run format`
  after, because `--update-config` rewrites the file with tabs.

### Removed

- **The reserved `/webapp` namespace.** The fixed folder, the `app` key, the injected rewrite
  middleware and the `app-namespace` check are gone. Building a real app on it showed the rewrite
  fighting Astro's form actions, and the site that did grow an app named the folder `portal` and
  wired it directly, which worked first time. A site that grows an app names the folder what the
  URL is, gives its pages `prerender = false`, lists the path in `run_worker_first` and passes
  it to `noindexRoutes`; the generic checks cover all three. **An existing site is untouched:** an
  `app` key left in `webmonterey.json` is no longer read, and no codemod deletes anything.

### For every site

1. `npx webm upgrade`, with wrangler logged in. The codemod rewrites the button spread in a
   site-owned webmaster layout and switches analytics on; the queue step creates the site's
   queues, wires them, and prints what now goes through the queue. Nothing else changes.
2. `npm run build`, and a form test on `npm run preview` proves the queue. For marketing:
   `/webm:launch` 10b.

---

## 1.5.0 — 2026-09-06

### Added

- **The `/webmaster` page names the client.** Every string in `copy.webmaster` may carry
  `{client}`, filled from `client` in `webmonterey.json` when the page renders, and the default
  copy now does: the meta description, the first paragraph ("This Acme Co custom website was
  designed, built and managed by WebMonterey…") and the contact line ("If you have a question
  about the Acme Co website…"). Until now every site in the fleet carried the same paragraph
  word for word, which is duplicate content across a hundred domains; a page that says whose
  site it is is not. A site overriding `copy.webmaster` keeps its own words and may use
  `{client}` in them. A site with no client name yet gets the sentence without the name.

- **A "Visit WebMonterey" button on `/webmaster`.** Outline style, in the site's link colour,
  radius and border width, below the paragraphs, to the same attributed agency URL the first
  paragraph links to. The label is `copy.webmaster.cta`. For a site that lays the page out
  itself, `WebmasterPageProps` gains `cta: { label, href }`, and `AGENCY_LINK_ATTRS` is
  exported beside it so the button carries the same `target` and `rel` as the intro link
  without either being typed twice. **A site that already exports `webmasterPage` does not
  show the button until its component renders `cta`** - `/webm:webmaster` has the updated
  reference component, one line to add.

- **`webm clean`.** Removes `node_modules/.vite`, `.astro` and `dist` - the three
  directories a stale dev server is made of - and nothing else. `--dry-run` lists them. The
  reset that used to be "delete some caches and restart" is one command a session in a client
  repo can run without knowing what Vite is. `/webm:traps` names it.

- **The Vite pre-bundle is rebuilt on every `astro dev` start.** `optimizeDeps.force` in dev
  only. A cache in `node_modules/.vite` that outlived a package update, a branch switch or an
  `astro check` was the dev server 500ing on every request until someone cleared it; a few
  seconds at startup buys not having that session. A cache that changes underneath a running
  server is still `webm clean`.

### Changed

- **The `/webmaster` copy, again.** "WebMonterey handles web hosting, security, strategy and
  ongoing care of our site." - _web hosting_, _our site_, and the clause about focusing on what
  we do is gone. The contact line reads "about the {client} website" rather than "about this
  website". A site overriding `copy.webmaster` is unaffected.

- **`@astrojs/cloudflare` floor is `^14.3.0`.** It fixes a cold `astro dev` crash by
  pre-bundling two of its own entrypoints, and a custom Worker entrypoint - which
  `defineWorker` builds - now falls back to static assets when no route matches. The package's
  own handler import is unchanged and the scheduled-handler scenario in the e2e still passes.
  The package is tested on Astro 7.3.1; the peer range is still `^7.0.0` and 7.3 asks nothing
  of a site. TypeScript stays on 6: TypeScript 7.0 is out, but `@astrojs/check` declares
  TypeScript 5 or 6, and Astro's language tooling needs 6 until 7.1 ships a stable API.

### Fixed

- **Astro no longer warns that `/404` is defined twice.** A site with its own
  `src/pages/404.astro` got two `[router]` warnings on every build - "A static route cannot be
  defined more than once … will result in a hard error in following versions of Astro" - because
  the package injected its 404 regardless and relied on the site's file winning. It now looks for
  the site's own 404 first, in every form Astro treats as a route (`.astro`, `.md`, `.mdx`,
  `.html`, `.ts`, `.js`), and injects its page only when there is none. A site with no 404 of
  its own sees no change.

Take it with `npx webm upgrade`. There is no codemod; the one thing to do by hand is the
`cta` line in a site that exports `webmasterPage`.

---

## 1.4.0 — 2026-09-04

### Added

- **A site can lay out the `/webmaster` page itself.** Export `webmasterPage` from
  `src/components/registry.ts` - an Astro component receiving
  `{ title, description, intro, body }` - and the page renders it in place of the built-in
  `<h1>` and stack of paragraphs. `intro` and each `body` entry are HTML, rendered with
  `set:html` - the agency link is already in `intro`; `title` and `description` are text. The route, the copy, the document title, the meta
  description, the share image and the agency JSON-LD stay the package's, so the page says the
  same thing on every site and looks like the site it is on. Until now a site whose legal pages
  used a richer document layout got a `/webmaster` that looked like a different site, and adding
  its own `src/pages/webmaster.astro` collided with the injected route. The component carries no
  copy of its own: the words are still `copy.webmaster` in `webmonterey.json`.

  **`/webm:webmaster` is the skill**, materialized on the next `webm sync` - it carries a
  complete reference component, the registry line and the checks to run on the built page, so a
  site session has something to copy rather than a description. `/webm:new-component` sends a
  session there the moment a site gains its document block, and `/webm:start` and
  `/webm:launch` both point at it, so on a new site it happens in sequence; on an existing site
  the upgrade lists it as a new skill.
  The props are exported as `WebmasterPageProps` from
  `@cparkerwebm/webmonterey/webmonterey/webmaster`.

  **Nothing changes on a site that does not export it.** The built-in layout, `pageHeader`
  seam included, renders as before, and examples/minimal asserts the whole `<main>` as a literal
  so it cannot drift.

### Changed

- **The `/webmaster` copy.** "This custom website was designed, built and managed by
  WebMonterey, a webmaster service in Monterey, California. WebMonterey handles the hosting,
  security, strategy and ongoing care of the site…" - _custom_ added, _maintenance_ dropped,
  _updates_ is now _strategy_ - and the contact paragraph is bold. `copy.webmaster.intro` and
  `copy.webmaster.body` now take the same inline subset as page prose (`**bold**`, `_italic_`,
  `[text](/url)`), which is how the bold is expressed. A site overriding `copy.webmaster` in
  `webmonterey.json` keeps its own words; one that does not gets these. The agency's
  description in the page's JSON-LD drops _maintenance_ too.

### Fixed

- **"managed byWebMonterey".** The built-in `/webmaster` intro had no space before the agency
  link - Astro drops the whitespace between an expression and an element on separate lines. It
  reads "managed by WebMonterey" now.

---

## 1.3.0 — 2026-09-02

### Changed

- **A staging site is a preview build everywhere.** `environment: "staging"` in webmonterey.json
  now makes every build a preview — every page noindex with no canonical, no sitemap, `robots.txt`
  `Disallow: /`, no Google Tag Manager — on every hostname and in every build: a feature branch,
  `main` on Workers Builds, a laptop. Until now only a non-production branch was a preview, so a
  site that had not launched was crawlable on its `workers.dev` URL the moment `main` deployed.
  The branch rule stays: a feature branch of a launched site is still a preview. An unset
  `environment` is production, as everywhere else, so a site predating the field builds as before.
  The decision is one pure function, `isPreviewBuild`; the build log says which signal made a
  build a preview, and `virtual:webm/build` carries it as `reason`.

  **A launched site whose webmonterey.json still says `"staging"` disappears from search after
  this update:** every page goes noindex and the sitemap is gone. `/webm:launch` sets
  `"environment": "production"` and `launched` together; `webm doctor` already fails a launched
  site still declared staging, and its message now names this consequence. Flipping `environment`
  is what makes a site indexable, so it must not happen before the custom domain is live —
  `/webm:start` and `/webm:launch` both say so.

- **`/webm:start` creates the Worker.** Step 5 is now one deploy from the laptop — `npm run build
  && npx wrangler deploy`, guarded by `wrangler deployments list` so a re-run skips it — and step 6
  connects the repo to the Worker that now exists (Settings → Builds), a smaller dashboard step
  than importing a repository and typing the Worker name in by hand. The skill used to stop and
  ask for the Worker to be made in the dashboard; on one site it was not, and the result was a
  repo, a database and nothing serving. That laptop deploy is the only one a site ever gets: once
  the repo is connected, a laptop deploy is a version no build produced, which the next push
  reverts. The adapter's auto-provisioned `<slug>-session` KV namespace is expected and stays out
  of wrangler.jsonc. The scaffolded README's deploy note says the same.

### Added

- **`webm doctor` checks that the Worker exists.** It asks wrangler for the deployments of the
  Worker named in wrangler.jsonc and warns when there are none — the silent failure above. It skips
  with a note when wrangler is not installed or not logged in, so CI and a fresh laptop are not
  failed for being unable to ask.

- **Hard rule 12 in a site's CLAUDE.md: a session in a client repo never edits the package.** Not
  in `node_modules`, and not in the package's checkout when it sits on the same machine. The
  deliverable for an upstream problem is a description of the fix — what, where, expected
  behaviour, how to verify — as a prompt for a session opened in the package repo; the site takes
  the fix with `npm update`. Enforced as far as Claude Code's rules reach: `.claude/settings.json`
  denies `Edit(**/node_modules/**)`, and **`webm sync` now merges the package's deny rules into a
  site's settings on every install** — adding what is missing, leaving the site's own rules alone,
  and dropping the two `Write(...)` rules 1.2.0 scaffolded, which Claude Code never consults and
  warns about at startup. The docs have no rule syntax for "any path outside this project", so
  that half stays prose.

  **On an existing site:** the settings arrive with the next install. `CLAUDE.md` is the site's
  own file, so copy rule 12 in from
  `node_modules/@cparkerwebm/webmonterey/template/site/CLAUDE.md`.

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
