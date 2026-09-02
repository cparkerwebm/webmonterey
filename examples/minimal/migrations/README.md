# D1 migrations

Sequential SQL files applied to the site's Cloudflare D1 database. Empty until a site needs
private data — form submissions, user accounts, anything that is not public page content.

## Create one

```sh
npx wrangler d1 migrations create <DATABASE_NAME> "add submissions table"
```

That writes `0001_add_submissions_table.sql` here. Numbers are sequential and must not be
reordered or renamed after they have been applied anywhere.

## Apply

```sh
npx wrangler d1 migrations apply <DATABASE_NAME> --local     # local dev database
npx wrangler d1 migrations apply <DATABASE_NAME> --remote    # PRODUCTION
```

`--remote` is the one people forget. Applying locally does nothing to production, and a
deploy does not run migrations for you.

## Check what has been applied

```sh
npx wrangler d1 migrations list <DATABASE_NAME> --remote
```

Wrangler tracks applied migrations in a `d1_migrations` table inside the database itself.

## Before any of this works

The database must exist and be bound in `wrangler.jsonc`:

```sh
npx wrangler d1 create webm-<domain-dashed>-db --update-config
```

`--update-config` writes the `d1_databases` binding into `wrangler.jsonc` for you.
