# R2 media — `media.<client-domain>`

Large or numerous files that should not live in git: video, audio, PDFs, galleries, downloads,
and anything migrated wholesale out of a WordPress uploads folder.

`media.ts` builds URLs. A binding is only needed if the Worker itself reads or writes objects —
serving them to visitors goes through the custom domain and never touches the Worker.

## Setup

Do this **after** `go-live` has moved the zone onto the agency Cloudflare account. A custom
domain on a bucket requires the zone to be on the same account as the bucket, so doing it
earlier fails for the same reason `preview.<client-domain>` does.

```sh
npx wrangler r2 bucket create <slug>        # the domain minus its TLD, same as the Worker and D1
```

Then in the dashboard: **R2 → the bucket → Settings → Custom Domains → Connect Domain**, and
enter `media.<client-domain>`. Cloudflare creates the DNS record itself.

**Do not enable the `r2.dev` subdomain.** It is rate-limited, Cloudflare documents it as
unsuitable for production, and it puts client media on a hostname the client does not own.

Only add a binding to `wrangler.jsonc` if the Worker reads or writes objects — an upload
endpoint, a signed download. Serving public media does not need one.

## Bulk uploads: use rclone, not wrangler

`wrangler r2 object put` **caps at 300 MiB per object**, and there is no object-listing or
recursive-download command at all. It cannot perform a migration; do not spend an afternoon
scripting around it.

Create a bucket-scoped R2 API token (Object Read & Write), then:

```
[webm-media]
type = s3
provider = Cloudflare
access_key_id = <token id>
secret_access_key = <token secret>
endpoint = https://<account-id>.r2.cloudflarestorage.com
region = auto
no_check_bucket = true
```

`no_check_bucket = true` is **required**, not tuning. A bucket-scoped token cannot
`CreateBucket`, and rclone probes for exactly that before its first upload — so without it
every transfer fails with an error naming an operation you never asked for.

```sh
rclone copy ./uploads webm-media:<slug> --transfers 2 --progress
rclone check ./uploads webm-media:<slug>
```

Two things learned the hard way:

- **`rclone check` is what proves a transfer**, not `rclone copy`'s exit code.
- **A slow uplink wants FEWER parallel transfers.** 8 streams on a ~17 Mbps uplink produced
  constant connection timeouts; 2 streams did not. Raising `--transfers` to fix slowness makes
  it worse.

## Local and remote are separate stores

`wrangler dev` writes to a local simulated bucket under `.wrangler/`. Objects **never** move
between it and production, in either direction, and nothing warns you. Code moves on push;
objects do not move at all. A deployed site starts with an empty bucket and has to be seeded
there. Same rule as D1 — see CLAUDE.md.
