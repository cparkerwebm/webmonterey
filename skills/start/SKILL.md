---
name: start
description: Stand up a new WebMonterey client site - scaffold, GitHub repo, identity, Cloudflare resources, Workers Builds, first deploy. Use for "start a new site for <client>", "spin up <domain>", "set this up for a new client", "we have a new client".
---

# Start a client site

**Resumable.** This is routinely invoked against a repo that is already half set up, so every
step checks before it acts and is safe to re-run.

**Derive, do not ask.** If the answer is in the repo, on disk, or on the live domain, take it
from there and say where you got it. Asking for a fact the repo already contains is the failure
this skill exists to prevent.

## 0. Read the state before writing anything

```sh
git remote get-url origin 2>/dev/null   # repo created? which one?
npx webm doctor                         # everything below, in one command
npx wrangler whoami                     # auth + account
dig +short NS <domain>                  # is the zone on our Cloudflare account?
curl -sI https://<domain> | head -5     # is anything already live?
```

**If a site is already live, say so prominently.** It changes the project: launch becomes a
cutover, and the existing site is the content source.

## 1. Scaffold

Only if this directory is not already a site (no `webmonterey.json`):

```sh
npx @cparkerwebm/webmonterey new <domain> --client="<Name>"
cd <domain_with_underscores>
```

It writes the identity files, a working contact form, a home page, the fleet skills, and runs
`git init` and `npm install`. Nothing outside the directory is touched. The GitHub owner comes
from `git config webm.org` (set once per machine) or `--org`; the staging inbox from
`git config webm.stagingEmail`, falling back to `user.email`.

**One name, everywhere.** The domain minus its TLD is the GitHub repo, the Worker, the D1
database, the R2 bucket and any KV namespace:

| Domain             | Name           |
| ------------------ | -------------- |
| `example.com`      | `example`      |
| `shop.example.com` | `shop-example` |
| `example.co.uk`    | `example`      |

The TLD is dropped because a Worker named `example-com` puts `example-com` into every preview
hostname, and Chrome's lookalike check then warns the client the site looks fake. A second
resource of one kind for the same client takes a purpose suffix: `example-portal`.

`example.com` and `example.org` both want `example`. Check the name is free in the account
before committing; the second one gets a name chosen by you, not by the tool.

## 2. Create the GitHub repo

Guarded, because this is re-run against sites that already have one. `git remote get-url`, not
`git remote -v` - the latter exits 0 with no output when there are no remotes and guards nothing.

```sh
git remote get-url origin 2>/dev/null \
  || gh repo create <org>/<repo> --private --source=. --remote=origin --push
```

Private. Client CI needs no secret: the framework is a public package.

## 3. Identity

`webmonterey.json` - confirm `client`, `domain`, `timeZone`, `locale`, `stagingEmail`. Leave
`launched` null and `environment` on `staging` until `/webm:launch`.

`organization` feeds nothing until the site has structured data; `/webm:launch` decides what
schema the business gets. Fill the contact fields now if they are known - never guess one.

`design.json` is optional. A site with none compiles the default tokens, which is the right
starting point before anyone has chosen a palette. Fonts are full CSS stacks; a self-hosted
face still needs its `@font-face` in `src/styles/custom/`.

## 4. Cloudflare resources

Create only what the site needs. A marketing site with a contact form needs D1; it does not need
R2 until someone has a video.

```sh
npx wrangler d1 create <slug> --update-config     # writes the binding into wrangler.jsonc
npx wrangler d1 migrations apply <slug> --local
npx wrangler r2 bucket create <slug>              # only if media is going to R2
```

Set `features.d1: true` once the binding exists. `features.turnstile` waits for `/webm:launch`,
which creates the widget and its keys together - a sitekey without its secret fails exactly
like a bot does.

**Every route with `export const prerender = false` goes in `run_worker_first`, in both slash
forms.** Miss one and it returns 200 to curl and a 404 page to Chrome. `webm doctor` checks.

## 5. Create the Worker - once, from the laptop

Guarded and re-runnable: skip this step when the Worker already exists.

```sh
npx wrangler deployments list --name <slug>   # a list: it exists. "does not exist [code: 10007]": create it
```

The name is `name` in `wrangler.jsonc`. When there is nothing:

```sh
npm run build            # a real build; `dev` proves nothing here
npx wrangler deploy
```

**This is the ONLY laptop deploy a site ever gets.** Before Workers Builds is connected, one
deploy is exactly how the Worker comes into existence. After it is connected (step 6) a laptop
deploy is the mistake: a version no build produced, which the next push reverts. This skill used
to stop here and say to create the Worker in the dashboard by hand, and on one site nobody did -
the result was a repo, a D1 database and nothing serving. `webm doctor` now warns on that.

The deploy provisions something `wrangler.jsonc` does not name, and that is expected: the Astro
Cloudflare adapter adds a `SESSION` KV binding, which wrangler auto-provisions as
`<slug>-session`. Do not add it to the config by hand.

Then verify. Wait a minute first - a brand-new Worker can return `error code: 1042` on valid
paths for about that long. In a real browser with the console open, load
`https://<slug>.<account>.workers.dev`: the home page renders, the console is clean. Then check
one on-demand route with a document-style request, if the site has one yet - a fresh scaffold's
only Worker route is the form action, which is POST-only:

```sh
curl -sI -H 'Sec-Fetch-Dest: document' https://<slug>.<account>.workers.dev/<on-demand-route>
```

The asset router keys off that header and plain curl does not send it, so a route that is 200 to
`curl` and 404 here is missing from `run_worker_first` (step 4).

## 6. Connect the repo

In the dashboard, on the Worker that now exists: **Settings → Builds → connect `<org>/<slug>`**,
production branch `main`, no build variables. Connecting a repo to an EXISTING Worker is the
smaller step - importing a repository and typing the Worker name in by hand is where the name
mismatch Workers Builds fails on comes from.

**Push to deploy from then on.** The first push supersedes the laptop version. A `wrangler
deploy` from a laptop after this point creates a version no build produced, so history stops
describing what is live and the next push reverts it.

Confirm it took:

```sh
npx wrangler deployments list --name <slug>
```

The newest deployment's Source is no longer `Upload`.

## 7. Verify the first push

Wait a minute after the build reports success - the 1042 window again - then load the
`workers.dev` URL in a real browser with the console open. The home page renders, the console is
clean.

## 8. Hand over

Workers Builds comments the preview URL on every PR - that is the client's review link. Preview
hostnames use the slug, so Chrome's lookalike warning should not appear; if it does, it is a
URL-shape false positive and **Ignore is safe**.

A preview build is safe to hand out: every page is noindex, there is no sitemap, robots.txt
disallows everything, analytics does not load, and mail is redirected to `stagingEmail`. The
client can click anything. **Every build of this site is a preview while `environment` is
`staging`** - `main` and the laptop included - so nothing is indexable before `/webm:launch`
flips it, and that flip is what makes the site indexable. On a launched site the production
branch is `main`; anything else previews.

Next: `/webm:new-component` for each block, then `/webm:launch` when the site is
content-complete and approved on a preview.
