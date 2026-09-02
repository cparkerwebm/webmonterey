-- Form submissions.
--
-- Apply with:
--   npx wrangler d1 migrations apply <DATABASE_NAME> --local
--   npx wrangler d1 migrations apply <DATABASE_NAME> --remote    <- production
--
-- `--remote` is the one people forget. A deploy does not run migrations for you.

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Which form this came from, e.g. 'contact'. Matches the filename in src/forms/.
  form          TEXT    NOT NULL,

  -- The submitted fields as a JSON object. Deliberately schemaless: every client site has
  -- different fields, and a migration per form would be unmanageable across a fleet.
  -- Query individual values with SQLite's JSON operators:
  --   SELECT data ->> '$.email' FROM submissions WHERE form = 'contact';
  data          TEXT    NOT NULL,

  -- Set once the notification email is accepted by Mailgun, so a failed send can be found
  -- and retried rather than silently lost. NULL means "not sent yet".
  notified_at   TEXT,

  -- Request metadata, for spam triage and abuse reports. Keep this minimal: it is personal
  -- data under CCPA, and anything stored here has to be disclosed and deletable.
  ip            TEXT,
  user_agent    TEXT,
  country       TEXT,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The common query: "show me this form's submissions, newest first".
CREATE INDEX IF NOT EXISTS idx_submissions_form_created
  ON submissions (form, created_at DESC);

-- Finds submissions whose notification email never went out.
CREATE INDEX IF NOT EXISTS idx_submissions_unnotified
  ON submissions (created_at) WHERE notified_at IS NULL;
