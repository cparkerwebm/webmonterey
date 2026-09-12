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
5. `webm queue` — create the site's queues and wire them, when wrangler is logged in, and say
   what on this site now goes through the queue; otherwise it says so and the site keeps
   sending inline (`--no-queue` skips it)
6. `webm doctor` — the traps that fail silently
7. `npm run check` and `npm run build`

**Tell the person what the upgrade changed on this site**, from the command's own output: the
codemods that ran, and the queue outline - which mail and which jobs now leave through the queue
and which stay in the request. That outline is the record of what a client site does differently
after this upgrade.

## After it finishes

**Run `/reload-plugins`** if the version changed anything outside `skills/`. New and edited
`SKILL.md` files are picked up live; the plugin's other components are not.

Push the branch and check the preview URL before merging. A framework upgrade is exactly the kind
of change where `preview` catches what `dev` cannot.

## If a site should not upgrade

**Pinning is a legitimate answer.** A site that is fine can sit on an old major indefinitely; the
fleet dashboard shows who is where. Do not upgrade a site with no reason to change.
