# CLAUDE.md

This is a **WebMonterey client site**. It is a thin repo: the framework lives in the
`@cparkerwebm/webmonterey` package, and what is here is what makes this client's site
different from every other one.

The relationship is a WordPress parent theme and child theme.

|               | Parent (the package)                                     | Child (this repo)                  |
| ------------- | -------------------------------------------------------- | ---------------------------------- |
| Owns          | layouts, styles, form pipeline, emails, routes, includes | components, content, palette, copy |
| Changes by    | `npm update @cparkerwebm/webmonterey`                    | editing files here                 |
| Overridden by | this repo, always                                        | —                                  |

**A fix to the package reaches this site on `npm update`.** That is the entire point of the
package existing, and it is why the default answer to "the shared behavior is wrong" is to fix
it upstream rather than to work around it here. Upstream means the package's own repo, in a
session opened there — never from here. Rule 12 says what a session in this repo does instead.

## The one rule that protects that

**Prefer overriding to editing around.** When something in the package is not right for this
client, express it as an override in this repo — a token in `design.json`, a rule in
`src/styles/custom/`, a wrapper in `src/actions/index.ts`. Do not reach into `node_modules` and
do not copy a package file here so you can change two lines: a copy stops receiving fixes the
moment it is made, silently, and nothing will ever tell you.

Copying a package file here is legitimate exactly once: when this client genuinely needs
different behavior, not a different value. Say so in a comment at the top of the copy, naming
what it forked from and why, so the next person knows it is deliberate.

## Commands

| Command           | Runs                                                       |
| ----------------- | ---------------------------------------------------------- |
| `npm run dev`     | dev server — fast, and blind to half the things that break |
| `npm run preview` | **a real build on real workerd**                           |
| `npm run check`   | types and content schema                                   |
| `npx webm doctor` | the things that fail silently                              |
| `npm run format`  | prettier                                                   |

**Run `npm run preview`, not `dev`, before merging anything** that touches styles,
`wrangler.jsonc`, a route's `prerender` flag, or the form pipeline. `dev` cannot see CSS
bundling, cascade order, or the asset router. Every trap in `/webm:traps` was invisible in
`dev` and visible in `preview`.

## Hard rules

### 1. Vanilla CSS and vanilla JS only

**Banned outright:** Tailwind, Bootstrap, Sass/Less/Stylus, CSS-in-JS, PostCSS plugin chains,
React, Vue, Svelte, Solid, Preact, Alpine, htmx, jQuery, Lodash, and any UI or utility
framework.

**Allowed:** plain `.css` using `@layer` and custom properties, plain `.js`/`.ts` modules,
`.astro` components, and `zod` (build-time validation only, never shipped).

TypeScript is allowed and expected — the rule targets frameworks and preprocessors, not types.

Do not add a dependency to solve something CSS or the web platform already does.

### 2. Style through tokens, and set tokens in `design.json`

Every color, space, size, radius, shadow, z-index, duration and easing is a `--webm-*` custom
property. Component CSS contains **no literal values** for these.

The palette lives in [design.json](design.json), which compiles to the token layer at build
time. Retheming this client is editing that file — one value cascades everywhere.

For a rule rather than a value, [src/styles/custom/](src/styles/custom/) is the seam:
`webm.components.custom` beats `webm.components.core` at identical specificity, so an override
lands without `!important` and stays legible as an override.

**Do not edit the package's stylesheets.** That is the change from generation 2, where a client
repo was a copy of the starter and editing it in place was correct. Here it is a copy-forward
that stops receiving fixes.

### 3. Never restyle for accessibility unless asked

A client's colors, contrast, focus rings, type sizes and spacing are **configured**, not
accidental. Do not "fix" any of them because an audit or a WCAG level says they fall short —
including darkening a color, enlarging text, or swapping a token as a side effect of unrelated
work.

**Report it, do not change it.** State the measured number and the element, then wait:

> The secondary consent buttons are 1.19:1 against the card. Want me to change that?

Two things this is not. It does not license shipping markup that is broken rather than merely
low-contrast — semantics, labels, roles, keyboard operability and focus ORDER are correctness,
and they get fixed like any other bug. And it does not apply once you have been asked: a
request to fix a contrast problem is the permission, for that problem.

A client signs off on a palette. A change made on our own initiative between one deploy and the
next is a change they never approved and will not think to look for.

### 4. Page content is JSON, never hardcoded

Copy, headings, links and block ordering live in `src/content/pages/*.json` — one file per
page. Never hardcode client copy into an `.astro` file. If content cannot be expressed in the
block schema, the component's `schema.ts` is what changes, not the markup.

Private data — user logins, form submissions — goes to **Cloudflare D1**, never to JSON.

### 5. The prefix is `webm-`, never `wm-`

Custom properties (`--webm-action`), class names (`.webm-section`), the CLI, the skills
namespace. No exceptions.

Cloud resources are the other convention: the GitHub repo, Worker, D1, R2 and KV all carry **one
name**, the domain minus its TLD (`example.com` → `example`). A second resource of one kind takes
a purpose suffix (`example-portal`).

### 6. Cloudflare bindings come from `cloudflare:workers`

```ts
import { env } from 'cloudflare:workers';
const { results } = await env.DB.prepare('SELECT 1').run();
```

Request metadata is `Astro.request.cf`. The execution context is `Astro.locals.cfContext`.

### 7. Content edits happen on a branch

Never edit page JSON directly on `main`. Branch, edit, push — Workers Builds gives the branch
its own preview URL for client review, and a schema-breaking edit fails there instead of on the
live site. Merge when approved.

### 8. Every third party is consent-gated

Anything loaded from outside the site — pixel, analytics, embed, widget — must be gated on the
visitor's cookie choice. Categories: `essential` (never gated), `functional`, `analytics`,
`marketing`. Unsure between the last two? Choose `marketing`; it is what US privacy law treats
as "sale or sharing".

```ts
import { whenConsented } from '@cparkerwebm/webmonterey/webmonterey/compliance';

whenConsented('marketing', () => {
  /* create the script element here, not before */
});
```

Loading a script and "not using it" is not gating — the request itself sets the cookie.

**Write the gated version even when `features.compliance` is `false`.** With compliance off,
`whenConsented` fires immediately for every category, so the same code works on both kinds of
site and turning consent on later needs no changes.

**Never read `document.cookie` to check consent.** That misses the Global Privacy Control path,
and a visitor sending GPC has legally opted out — from January 2027 every browser must offer
that setting, so it stops being an edge case.

**Prefer Google Tag Manager for pixels and analytics.** `TagManager` is wired into the layout and
`ConsentInit` sets Consent Mode v2 before it loads, so a tag added in the GTM UI inherits the
visitor's choice with no code change. Write code only for an embed or widget that must render
into a specific element. Accessibility overlays (UserWay, accessiBe) are rejected on liability,
not price.

### 9. Look it up before you use it — four servers, one per question

All four are declared in [.mcp.json](.mcp.json) and pre-approved in
[.claude/settings.json](.claude/settings.json), so they work on any machine without anyone
clicking Approve. `webm doctor` fails if a site has lost one.

| Question                                                               | Server         |
| ---------------------------------------------------------------------- | -------------- |
| What does this Astro API do, and is it still called that?              | `astro-docs`   |
| What does this web platform API do, and which browsers have it?        | `mdn`          |
| Is this the right way to do SEO, a11y, performance, privacy, security? | `website-spec` |
| Will this email render, arrive, and be readable?                       | `email-spec`   |

**Astro moves faster than any training corpus and the web platform never stops.** Much of what a
model recalls about both is two majors out of date, and the recalled version is always confidently
wrong rather than obviously wrong. Look it up.

**`astro-docs` and `mdn` outrank the two specification servers on facts.** The Website and Email
Specifications are opinionated best-practice guides — genuinely good ones, and the source for
_what a good site or email does_ — but they are not normative standards despite the name, and
they are at 0.x. On what an API is or does, MDN and the Astro docs win.

**`email-spec` before touching `src/emails/`.** An email template that looks right in a browser is
evidence of nothing: the rendering quirks and the deliverability rules are the whole problem, and
they are exactly what recall gets wrong.

If a server is unavailable in a session — `mdn` is explicitly an experiment Mozilla may withdraw —
**say so and cite the documentation site directly.** Never fall back to recall silently. A session
that quietly stops checking is the failure all four are here to prevent.

### 10. A class used by more than one page belongs in a shared stylesheet

Astro scopes a component's `<style>` to that component's markup. A class defined in one page's
`<style>` block and used in another renders **completely unstyled** — no error, no warning, just
a bare element. It is invisible until someone looks at the second page.

Shared class → `src/styles/custom/`. A page's own `<style>` block is only for markup that page
alone renders.

### 11. Never edit inside `node_modules`

A change there survives until the next install and not one second longer. If the package is
wrong, the package gets fixed — by a session in the package repo, not this one. See rule 12.

### 12. A session in a client repo never edits the package

Not in `node_modules`, and not in the package's own checkout if it happens to be on this machine.
When something in the package is wrong, the deliverable from a session in this repo is a
**description of the fix** — what is wrong, where (file and line in the installed package), what
the behavior should be, and how to verify it — written as a prompt the user can run in a session
opened in the package repo. The package is versioned, tested and published on its own; this site
takes the fix with `npm update`.

This session stays inside this site's scope. An override in `design.json`, `src/styles/custom/`
or `src/actions/index.ts` is fine; reaching upstream is not.

Why this is a rule: "fix it upstream", read from inside a client repo, invited exactly the wrong
thing. The package source sat next door on the same machine, a session opened it mid-task and
edited it — a change nobody reviewed, in a repo nobody had open, on no branch, which then had to
be published before this site could even use it. The client-site session ended with the site
depending on a package version that did not exist.

`.claude/settings.json` denies `Edit` under any `node_modules/`, so the first half is mechanical
and `webm sync` keeps it that way. Claude Code has no rule syntax for "any path outside this
project", so the second half is this paragraph.

## Structure

```
design.json                 this client's palette. Compiles to --webm-* tokens.
webmonterey.json            domain, client name, environment, features.
src/
  components/               EVERY visible component. The package ships none.
    registry.ts             maps a block `type` to its component. A block whose type is
                            not here renders as nothing, silently.
  content/pages/*.json      the words. One file per route; home.json is `/`.
  forms/*.json              form definitions. Filename is the form id.
  actions/index.ts          re-exports the package pipeline. Wrap to customize.
  pages/webapp/             the web app, if this site grows one. Folder is fixed; the public
                            URL is `app.path` in webmonterey.json. Every page `prerender = false`.
  styles/custom/            per-client CSS overrides.
  assets/                   images processed at build time.
public/                     served verbatim. Favicons, _headers.
migrations/                 D1 schema. Additive only — never edit an applied migration.
```

## Component IDs

Components are numbered, not named for what they look like: `content-000001`, not `hero-split`.
A name describing the current design stops being true the first time the design changes, and
renaming it means touching every content file that references it.

The `type` in a page JSON file must match a key in `registry.ts`. Inventing one — or copying it
from another project — makes the block render as nothing, with no error.

## Skills

`.claude/skills/webm/` is materialized from the package on every install. Do not edit it; it is
replaced wholesale. This client's own skills go beside it at `.claude/skills/<name>/`.

|                       |                                                                           |
| --------------------- | ------------------------------------------------------------------------- |
| `/webm:traps`         | the things that fail silently — read this before debugging anything weird |
| `/webm:new-component` | adding a block type                                                       |
| `/webm:start`         | standing a new site up: repo, Cloudflare resources, first deploy          |
| `/webm:launch`        | launch checklist: structured data, sending domain, secrets, DNS, cutover  |
| `/webm:upgrade`       | taking a new package version                                              |

Content edits: branch, edit `src/content/pages/*.json`, `npm run check`, push — the branch
preview is the client's review link. Merge when approved. Never change a block's `type`.

Palette: `design.json`. Fonts are full CSS stacks; a self-hosted face still needs its
`@font-face` in `src/styles/custom/`. The `overrides` map takes any `--webm-*` token raw.
