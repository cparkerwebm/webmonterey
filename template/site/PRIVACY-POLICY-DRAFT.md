# Privacy policy — DRAFT

**NOT READY TO PUBLISH.** Every `{{PLACEHOLDER}}` below must be filled in, and every section
describing something this site does not do must be deleted, before launch. This is a drafting
aid, not legal advice — the client, and their counsel if they have any, must review it.

## Why this is markdown and not a page

The package ships zero components, so it cannot ship page JSON: a block whose `type` is not in
this site's registry fails the content schema and the build stops. Once the site has a prose
block, `/webm:edit-content` turns this into `src/content/pages/privacy.json` — the text below is
already in reading order, one heading per section.

---

**Effective date:** {{DATE}}

{{LEGAL_ENTITY_NAME}} ("we", "us") operates {{DOMAIN}}. This policy explains what the site collects, why, and the choices you have.

## What we collect

**Information you give us.** If you submit a form, we receive what you typed into it — typically your name, email address, phone number and message.

**Information collected automatically.** Our hosting provider, Cloudflare, processes technical information required to serve the site: your IP address, browser user-agent, the pages you request, and the country your request came from. This is standard server logging and is used to deliver the site, keep it available, and defend it against abuse.

## Cookies and similar technologies

We group these into four categories:

- **Essential** — required for the site to work and to resist abuse. These are never optional.
- **Functional** — remember preferences, such as your cookie choices.
- **Analytics** — help us understand which pages are used.
- **Marketing** — used for advertising measurement or audience building.

When you first visit, a banner lets you accept or reject each optional category. Nothing in the functional, analytics or marketing categories loads until you choose. You can change your choices at any time from the cookie settings link in the site footer.

**Global Privacy Control.** If your browser sends a GPC signal, we treat it as an opt-out of analytics and marketing automatically, and you will not be asked again. You do not need to interact with the banner for this to take effect.

## Who we share information with

We do not sell your personal information. We do not share it for cross-context behavioral advertising except as described under Analytics below, and only where you have consented.

The site relies on these processors:

- **Cloudflare** — hosting, content delivery, and security. Processes technical request data as described above. _Essential._
- **Cloudflare Turnstile** — spam and abuse protection on forms. Runs only on pages with a form and is treated as essential, because without it the form cannot resist automated abuse.
- **Mailgun (Sinch)** — delivers form submissions to us by email.
- **Google Tag Manager / Google Analytics** — measures site usage. _Loads only with your consent to the analytics category._ Google Consent Mode v2 is enabled, so Google is told your choice directly.
- {{ADD_OR_REMOVE_PROCESSORS_TO_MATCH_THE_SITE}}

## How long we keep things

Form submissions are retained for {{RETENTION_PERIOD}} and then deleted. Server logs are retained by Cloudflare under their own retention schedule.

## Your rights

Depending on where you live — including under the California Consumer Privacy Act as amended by the CPRA — you may have the right to:

- know what personal information we hold about you and how it is used;
- request a copy of it;
- request that we correct or delete it;
- opt out of its sale or sharing (we do not sell it, and the GPC signal and cookie banner both control sharing);
- not be discriminated against for exercising any of these rights.

To make a request, contact us at {{CONTACT_EMAIL}}. We may need to verify your identity before acting on it.

## Children

The site is not directed at children under 13 and we do not knowingly collect their information.

## Changes

We will update this page if our practices change, and revise the effective date above.

## Contact

{{LEGAL_ENTITY_NAME}}

{{POSTAL_ADDRESS}}

{{CONTACT_EMAIL}}
