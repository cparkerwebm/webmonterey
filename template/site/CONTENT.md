# Editing this site's content

For anyone changing words on the site — no coding required.

> **Using Claude Cowork?** Paste this whole file into the folder's **Folder instructions**
> when you connect the site. Cowork does not read it automatically.

---

## Where the words live

All page content is in **`src/content/pages/`**. One file per page. The filename is the web
address:

| File                                  | Page on the site   |
| ------------------------------------- | ------------------ |
| `src/content/pages/home.json`         | the home page, `/` |
| `src/content/pages/about.json`        | `/about`           |
| `src/content/pages/contact.json`      | `/contact`         |
| `src/content/pages/services/seo.json` | `/services/seo`    |

`home.json` is the one exception — it becomes `/`, not `/home`.

Adding a new file adds a new page. Deleting one removes that page.

---

## What a page file looks like

```json
{
  "title": "About",
  "description": "Family-run since 1994.",
  "blocks": [
    {
      "type": "content-000001",
      "heading": "Who we are",
      "body": "We have served the Monterey Bay area for thirty years."
    }
  ]
}
```

- **`title`** — the browser tab, and what search results show as the headline. Required.
- **`description`** — the grey summary line in Google results. One or two sentences.
- **`blocks`** — the sections of the page, top to bottom.

---

## What you can change

**Any text.** Headings, body copy, button labels, link addresses, `title`, `description`.

**The order of sections.** Move a whole `{ ... }` block up or down inside `blocks` and the
section moves up or down on the page.

**Remove a section.** Delete its whole `{ ... }` block, including the comma that separates it
from the next one.

---

## What you must not change

**Never invent or edit a `"type"` value.** That is not a label — it is the name of a building
block that has to already exist. If you make one up, or copy one from another site, that
section renders as **nothing at all** and the page silently loses content.

To add a kind of section that does not exist yet, ask for a new component to be built.

**Do not touch these at all:**

- `src/components/` — the building blocks themselves
- `src/styles/` — fonts, colors, spacing
- `src/layouts/`, `src/pages/`, `src/includes/`
- anything ending in `.astro`, `.ts`, `.css`
- `package.json`, `astro.config.mjs`, `wrangler.jsonc`, `tsconfig.json`
- `webmonterey.json` — the site's identity. Changing `domain` breaks search listings.
- `.dev.vars` — passwords and keys, never to be opened, copied, or pasted anywhere

**The cookie banner and privacy dialog are not page content.** They are legally significant:
the wording describes what the site actually does with data, and the categories map to real
behavior. Changing that text on your own can make the site's disclosure inaccurate. If a
client wants different wording, raise it — do not edit it here.

---

## Getting JSON right

The format is strict, and one wrong character stops the whole site from building.

- Every name and every piece of text is in `"double quotes"`. Never `'single'`, never curly
  `"smart"` quotes — if you draft in Word or Google Docs, it will substitute those silently.
- A comma between items, but **no comma after the last one** in a list or block.
- Every `{` needs a `}`, every `[` needs a `]`.
- An apostrophe inside text is fine: `"We're open"`. A double quote inside text needs a
  backslash: `"They said \"yes\""`.

---

## How to publish a change

**Always work on a branch. Never edit the live site directly.**

```sh
git checkout -b content/homepage-copy      # 1. start a branch
                                           # 2. make your edits
npm run check                              # 3. confirm nothing is broken
git add -A
git commit -m "Update homepage copy"
git push -u origin HEAD                    # 4. push
```

`npm run check` is the safety net — it catches a missing comma or a wrong field before it can
reach anyone. **If it reports an error, fix it before pushing.**

Pushing gives the branch its own preview web address, something like
`content-homepage-copy-webm-example-com.workers.dev`. Send that link for review.

When it is approved, merge the branch into `main`. That publishes it to the real site.

---

## If something goes wrong

**The build failed.** Almost always a JSON typo — a missing comma, a smart quote, an extra
comma after the last item. The error message names the file.

**A section vanished.** Its `"type"` does not match a real component. Check the spelling
against the folder names in `src/components/`.

**A change is not showing up.** Confirm you edited the right file for that page, that the
branch was pushed, and that you are looking at the preview URL for _that_ branch.

Nothing here can be broken permanently — every change is on a branch until it is merged, and
anything merged can be reverted.
