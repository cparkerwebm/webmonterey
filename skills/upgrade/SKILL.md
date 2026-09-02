---
name: upgrade
description: Move a WebMonterey site to a newer version of the framework package. Use for "upgrade the package", "update webmonterey", "there's a new version", "bump the framework".
---

# Upgrade

## Run the CLI, do not follow steps from memory

```sh
npx webm upgrade
```

**This skill is deliberately thin, and that is the point.** An invoked skill's text enters the
conversation once and is not re-read on later turns. So this skill runs `npm install`, which
overwrites its own `SKILL.md` with the new version's — and then keeps executing the _old_
instructions to completion.

The binary on disk is the new version immediately. The markdown is frozen for the session. So the
steps live in the CLI, where they update the moment the install finishes.

## What it does

1. Branch — never upgrade on `main`
2. Bump `@cparkerwebm/webmonterey`
3. Run any codemods the new version ships
4. `webm sync` — re-materialize the fleet skills
5. `webm doctor` — the traps that fail silently
6. `npm run check` and `npm run build`

## After it finishes

**Run `/reload-plugins`** if the version changed anything outside `skills/`. New and edited
`SKILL.md` files are picked up live; the plugin's other components are not.

Push the branch and check the preview URL before merging. A framework upgrade is exactly the kind
of change where `preview` catches what `dev` cannot.

## If a site should not upgrade

**Pinning is a legitimate answer.** A site that is fine can sit on an old major indefinitely; the
fleet dashboard shows who is where. Do not upgrade a site with no reason to change.
