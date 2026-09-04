# webmonterey

The Astro framework behind WebMonterey client sites, for Cloudflare Workers with D1, R2 and
Turnstile. Plumbing, the design system, and the Claude Code skills — everything that is the same
on every site, in one upgradable package.

Published as [`@cparkerwebm/webmonterey`](https://www.npmjs.com/package/@cparkerwebm/webmonterey)
on npmjs, MIT. It is an agency framework, published so the sites built on it are cleanly their
owners' and so a fix propagates on `npm update`. It is not a community project and is not
supported as one.

**[ARCHITECTURE.md](ARCHITECTURE.md) is the design and the reasoning.** Read it before changing
anything structural; most of what looks like an odd choice is a documented one.

## What the package owns, and what it does not

The package owns anything where a bug is the _same_ bug on every site: the cascade layer order,
the reset, the Cloudflare includes, the consent system, the form pipeline, the router.

It ships **zero visible components**. Every block a visitor sees is built per client, in that
client's repo. Every default has a documented way to opt out of it.

A site hands the package its components through `src/components/registry.ts`: `blocks` for the
block router, `header`, `footer` and `panels` for the chrome, `pageHeader` in place of the
router's plain `<h1>`, `structuredData` for the site's JSON-LD, and `webmasterPage` for the body
of the `/webmaster` page. That last one is the seam for a site whose document pages have a richer
layout than a heading and a stack of paragraphs: the component receives the merged copy
(`{ title, description, intro, body }`; `intro` and `body` are HTML, the agency link already in
`intro`) and lays it out; the route, the words, the `<head>`, the share image and the agency graph
stay the package's. It carries no copy of its own - the words are overridden through
`copy.webmaster` in `webmonterey.json`, not in the component.

**The package is edited in this repo, and only here.** A session in a client site that finds a
package bug does not reach into `node_modules` or into this checkout; its deliverable is a
description of the fix, run later in a session opened here, and the site takes the result with
`npm update`. That is rule 12 of the site's `CLAUDE.md`, with an `Edit` deny on `node_modules`
behind it that `webm sync` keeps in place. The inverse holds: nothing here edits a client site.

## Creating a client site

```sh
git config --global webm.org <your-github-owner>      # once per machine
npx @cparkerwebm/webmonterey new example.com --client="Example Co"
cd example
claude          # then /webm:start
```

One name everywhere: `example.com` becomes `example` — the repo, the Worker, the D1 database and
the R2 bucket. The domain minus its TLD is the one shape every resource accepts, and it keeps a
domain out of preview hostnames, which is what trips Chrome's lookalike warning.

`webm new` writes the identity and design files, a working contact form, a home page and the
fleet skills, then runs `git init` and `npm install`. It touches nothing outside the directory.
`/webm:start` takes it from there: the GitHub repo, Cloudflare resources, Workers Builds, the
first deploy. Start Claude from the repo root — project skills load from the directory you start
in.

Then `/webm:new-component` per block, and `/webm:launch` when the site is approved on a preview.

## Layout

```
src/
  design/        design.json -> CSS, email literals, brand context. No Astro imports.
  integration/   the Astro integration, the virtual modules, the app-path middleware
  styles/        reset, base, layout, utilities - and layers.ts, the one layer-order list
  includes/      plumbing, grouped by vendor first
  layouts/       base.astro
  pages/         the block router, robots.txt, the 404, the dev-only /webm scratch page
  actions/       the form pipeline
  emails/        transactional templates
  cli/           the webm command
skills/          the fleet skills, materialized into client repos by `webm sync`
agents/ hooks/   ride along with the skills when the package ships any
template/        what `webm new` seeds and what `webm sync` refreshes
schema/          JSON Schema for design.json
examples/minimal a real site CI builds on every PR
```

## Commands

| Command            | Runs                                                             |
| ------------------ | ---------------------------------------------------------------- |
| `npm test`         | `node --test` over `src/**/*.test.ts` and `scripts/**/*.test.mjs` |
| `npm run check`    | `tsc --noEmit`                                                   |
| `npm run format`   | prettier                                                         |
| `npm run test:e2e` | pack a tarball, scaffold a site with it, build, assert on the HTML |

**No test framework and no test dependency.** Node's runner needs nothing installed and strips
TypeScript on its own.

## The pattern to follow when adding code

**Pure logic goes in a file with no virtual-module imports; the config binding goes beside it.**
`r2/url.ts` and `r2/media.ts` are the example. Anything importing `virtual:webm/site`
transitively only resolves inside an Astro build, so a test touching it cannot run.

## Node

`.nvmrc` pins 24, which is what Workers Builds runs. `engines` is `>=22.18.0`, the first release
with unflagged type stripping, which the CLI needs.

## Releasing

```sh
# 1. write the entry first - it is the release notes, not a chore afterwards
#    add "## 1.1.0 — YYYY-MM-DD" to CHANGELOG.md, then commit and push
npm login                       # once per machine
npm run release minor           # or patch, major, or an explicit 1.1.0
```

One command, in the order that makes each step safe: clean tree on `main` in sync with origin →
the changelog entry must exist → format, types and tests → `npm version` (which commits **and**
tags) → `npm publish --provenance` → push commit and tag and read both back off origin → GitHub
release from the changelog section → install the published tarball the way a client would.

`--dry-run` runs every check and prints the plan without changing anything. `prepublishOnly`
runs the same guard, so a bare `npm publish` still refuses to ship a version that is
undocumented, untagged, or built from a dirty tree.

|         |                                                  |
| ------- | ------------------------------------------------ |
| `patch` | a fix that asks nothing of any site              |
| `minor` | new capability, or a fix a site may want to know about |
| `major` | something a site must change to take — and it ships a codemod |
