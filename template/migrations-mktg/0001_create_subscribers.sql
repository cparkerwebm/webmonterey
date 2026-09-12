-- Marketing subscribers. THE SITE'S OWN LIST: the source of truth is this table, not a list at
-- the mail provider, so the client owns their data and a segment is a WHERE clause.
--
-- This is the SECOND database, <slug>-mktg, bound as DB_MKTG. Apply with:
--   npx wrangler d1 migrations apply <slug>-mktg --local
--   npx wrangler d1 migrations apply <slug>-mktg --remote    <- production
--
-- `--remote` is the one people forget. A deploy does not run migrations for you.

CREATE TABLE IF NOT EXISTS subscribers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Lower-cased, trimmed. One row per address; a second signup updates the row.
  email           TEXT    NOT NULL UNIQUE,
  name            TEXT,

  -- pending      signed up, confirmation mail sent, not yet confirmed - never mailed a campaign
  -- subscribed   confirmed by clicking the link
  -- unsubscribed asked to stop, on the site or through the mail provider's headers
  -- suppressed   the provider stopped it for us: a complaint, or a permanent bounce
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'subscribed', 'unsubscribed', 'suppressed')),

  -- The link token. Random, per row, in every confirm and unsubscribe URL; there is no secret to
  -- sign with and nothing to guess. Rotated on each new signup of the same address.
  token           TEXT    NOT NULL UNIQUE,

  -- CONSENT PROVENANCE, kept because the law asks how and when each person subscribed and what
  -- they were told they would get. `source` is the form id and the page path; `purposes` is the
  -- form's own statement of what the list sends, copied at signup so a later rewording does not
  -- change what this person agreed to.
  source          TEXT    NOT NULL,
  purposes        TEXT    NOT NULL,
  -- The privacy notice in force at signup, if the site versions it - e.g. '2026-09'.
  policy_version  TEXT,
  signup_ip       TEXT,
  signed_up_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  confirm_ip      TEXT,
  confirmed_at    TEXT,

  -- Why and when it stopped: 'site' (the unsubscribe page), 'provider' (the mail header),
  -- 'complaint', 'bounce'.
  unsubscribed_at TEXT,
  unsubscribe_reason TEXT,

  -- Free-form, for segments: JSON the site writes from its own form fields, e.g. {"interests":
  -- ["events"]}. Query with SQLite's JSON operators: WHERE vars ->> '$.plan' = 'pro'.
  vars            TEXT    NOT NULL DEFAULT '{}',

  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The campaign query: everyone who may be mailed.
CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers (status, id);

-- What each campaign sent, so a send is idempotent per batch and the client has a history.
CREATE TABLE IF NOT EXISTS campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The site's own key for the campaign, e.g. '2026-10-newsletter'. One row per key.
  key           TEXT    NOT NULL UNIQUE,
  subject       TEXT    NOT NULL,
  -- How the audience was chosen: the WHERE fragment, for the record.
  audience      TEXT,
  recipients    INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS campaign_batches (
  campaign_id   INTEGER NOT NULL REFERENCES campaigns(id),
  batch         INTEGER NOT NULL,
  recipients    INTEGER NOT NULL,
  sent_at       TEXT,
  -- Mailgun's message id for the batch, once accepted.
  message_id    TEXT,
  PRIMARY KEY (campaign_id, batch)
);
