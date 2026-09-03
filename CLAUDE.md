# Working in this repo

This is the framework package, not a client site. **[ARCHITECTURE.md](ARCHITECTURE.md) is the
design and the reasoning; [README.md](README.md) is how to work here.** Read the architecture
before changing anything structural — most of what looks like an odd choice is a documented one.

## Look it up before you use it

Four documentation servers are declared in [.mcp.json](.mcp.json) and pre-approved in
[.claude/settings.json](.claude/settings.json), so they work without anyone clicking Approve.

| Question                                                               | Server         |
| ---------------------------------------------------------------------- | -------------- |
| What does this Astro API do, and is it still called that?              | `astro-docs`   |
| What does this web platform API do, and which browsers have it?        | `mdn`          |
| Is this the right way to do SEO, a11y, performance, privacy, security? | `website-spec` |
| Will this email render, arrive, and be readable?                       | `email-spec`   |

Astro ships majors faster than any training corpus turns over, and recalled API detail is
confidently wrong rather than obviously wrong. **`astro-docs` and `mdn` outrank the two
specification servers on facts** — those are opinionated best-practice guides at 0.x, not
normative standards, and they answer a different question. **Consult `email-spec` before touching
`src/emails/`:** a template that looks right in a browser is evidence of nothing.

If a server is unavailable, say so and cite the documentation site directly. Never fall back to
recall silently.

The list lives in [src/cli/mcp.ts](src/cli/mcp.ts) — one module, because the scaffold, the
codemods, `webm doctor` and this repo's own config all have to agree. Adding a server means
editing that file; `.mcp.json` is generated from it and a test asserts it has not drifted.

**No credential-bearing MCP server belongs in this file.** Everything committed here is read-only
public documentation needing no key, which is what makes pre-approving it safe. Anything that
authenticates as the agency - Mailgun, Stripe, Cloudflare - lives in the platform repo or as an
account-level connector, never here and never in a client repo.

## The rules that bite

- **The package ships zero visible components.** Every block a visitor sees is built per client.
  Generation 1 shipped framework chrome and every site overrode it.
- **Pure logic goes in a file with no virtual-module imports; the config binding goes beside it.**
  Anything importing `virtual:webm/site` only resolves inside an Astro build, so a test touching it
  cannot run. `r2/url.ts` and `r2/media.ts` are the pattern.
- **No test framework and no test dependency.** `node --test` needs nothing installed and strips
  TypeScript itself.
- **Write the CHANGELOG entry first, then `npm run release`.** The entry is the release notes and
  the script refuses without it. Never `npm publish` by hand.
- **A codemod must be idempotent.** A half-finished upgrade gets re-run, and one that doubles its
  own work on the second pass is worse than none.
- **The package is edited here, and client sites are never edited from here.** Rule 12 of
  [template/site/CLAUDE.md](template/site/CLAUDE.md) says a session in a client repo never
  reaches into this checkout; the inverse holds too. A problem found in a client site is fixed
  here, released, and taken by the site with `npm update`. A session in this repo does not open a
  client repo to patch around a package bug, and does not prove a change by editing a client site
  in place - examples/minimal and `npm run test:e2e` are what a change is proven on.

## Before you say it works

```sh
npm run format && npm run check && npm test
```
