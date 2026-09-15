/*
 * The form pipeline on real workerd, not just compiled.
 *
 * A build test proves the action COMPILES. It cannot see that the site's src/forms/contact.json
 * reaches the package's handler through virtual:webm/forms, that validation names the missing
 * fields by their labels, or that the asset router lets a POST through to the Worker at all.
 * Those cross the package/site boundary at runtime, and that boundary is where the last round of
 * bugs lived.
 *
 * Run: npm run test:runtime   (builds first, then serves the built output)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
/*
 * A SECOND SERVER, THE SAME SITE, ONE SECRET BOUND THE OTHER WAY. The Mailgun webhook signing
 * key is a Worker secret on the first server (`--var` is a string on env, exactly what `wrangler
 * secret put` and `.dev.vars` produce) and a Secrets Store binding on the second, read from the
 * local store `wrangler secrets-store secret create` writes without --remote. The webhook route
 * reads it with getSecret and must answer the same on both - that is the whole claim of
 * "source-agnostic", and it cannot be shown with one server since a name is bound one way at a
 * time.
 */
const STORE_PORT = 8792;
const STORE_BASE = `http://127.0.0.1:${STORE_PORT}`;
const SIGNING_KEY = 'runtime-test-signing-key';
const SITE = fileURLToPath(new URL('./', import.meta.url));
/*
 * One persistence directory for everything, named explicitly. wrangler defaults it relative to
 * the config file's directory, and the store server's config lives in dist/server/ - so without
 * this the local secret and the migrations would land in one place and that server look in
 * another.
 */
const PERSIST = new URL('./.wrangler/state', import.meta.url).pathname;
const WRANGLER_ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
const wrangler = (...args) =>
  execFileSync('npx', ['wrangler', ...args, '--persist-to', PERSIST], {
    cwd: SITE,
    encoding: 'utf8',
    stdio: 'pipe',
    env: WRANGLER_ENV,
  });
let server;
let storeServer;

const serve = (port, args) =>
  spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--local', '--persist-to', PERSIST, ...args],
    {
      cwd: SITE,
      stdio: 'ignore',
      detached: false,
      env: WRANGLER_ENV,
    },
  );

const waitFor = async (base) => {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${base}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`wrangler dev never came up on ${base}`);
};

before(async () => {
  /*
   * The tables, or the webhook's row update and the form's insert fail on a fresh checkout. Local
   * migrations are idempotent and answer the confirmation prompt themselves when not on a TTY.
   */
  for (const db of ['minimal-example-db', 'minimal-example-mktg']) {
    wrangler('d1', 'migrations', 'apply', db, '--local');
  }

  /*
   * The store-bound config: the config the adapter generated - the one wrangler really runs, via
   * .wrangler/deploy/config.json - plus the binding. Written beside it so its relative paths hold.
   * `binding` is the name the code reads; `secret_name` is deliberately different, since only the
   * first has to match.
   */
  const generated = new URL('./dist/server/wrangler.json', import.meta.url);
  const config = JSON.parse(readFileSync(generated, 'utf8'));
  config.secrets_store_secrets = [
    {
      binding: 'MAILGUN_WEBHOOK_SIGNING_KEY',
      store_id: 'runtime-test-store',
      secret_name: 'MAILGUN_WEBHOOK_SIGNING_KEY_ACCOUNT',
    },
  ];
  const storeConfig = new URL('./dist/server/wrangler.secrets-store.json', import.meta.url);
  writeFileSync(storeConfig, JSON.stringify(config));
  /* No --remote: the LOCAL copy, which is what the launch skill tells a person to create. */
  wrangler(
    'secrets-store',
    'secret',
    'create',
    'runtime-test-store',
    '--name',
    'MAILGUN_WEBHOOK_SIGNING_KEY_ACCOUNT',
    '--scopes',
    'workers',
    '--value',
    SIGNING_KEY,
  );

  /* One at a time: two wrangler dev processes opening the same local state at once do not both come up. */
  server = serve(PORT, ['--var', `MAILGUN_WEBHOOK_SIGNING_KEY:${SIGNING_KEY}`]);
  await waitFor(BASE);
  storeServer = serve(STORE_PORT, ['-c', fileURLToPath(storeConfig)]);
  await waitFor(STORE_BASE);
});

after(() => {
  server?.kill();
  storeServer?.kill();
});

/*
 * Astro refuses a cross-site POST, so a submission without a matching Origin is a 403 before the
 * handler is reached. Real browsers send it; curl does not, which is a good way to spend an hour.
 */
const submit = (fields) =>
  fetch(`${BASE}/_actions/submitForm`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });

test('a static route is served from assets', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).length > 1000);
});

test('an on-demand route reaches the Worker for a BROWSER request, not just curl', async () => {
  /*
   * The trap this exists for: not_found_handling intercepts navigation requests that match no
   * static asset, keyed off Sec-Fetch-Dest. Leave /contact out of run_worker_first and this URL
   * returns 200 to curl and the 404 page to Chrome.
   */
  const res = await fetch(`${BASE}/contact`, { headers: { 'Sec-Fetch-Dest': 'document' } });
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('Contact'), 'the on-demand page rendered, not the 404');
});

test('an unmatched path serves the package 404, with its status', async () => {
  const res = await fetch(`${BASE}/nothing-here`, { headers: { 'Sec-Fetch-Dest': 'document' } });
  assert.equal(res.status, 404);
  assert.match(await res.text(), /Page not found/);
});

test('a valid submission is accepted', async () => {
  const res = await submit({
    form: 'contact',
    name: 'Test Person',
    email: 't@example.com',
    message: 'hello there',
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"ok"/);
});

test('a missing required field is rejected, naming the fields by their LABELS', async () => {
  // The site's src/forms/contact.json reached the package's handler - labels come from there.
  const res = await submit({ form: 'contact', name: 'Test' });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.match(body, /Email/);
  assert.match(body, /Message/);
});

test('an unknown form id is rejected rather than stored', async () => {
  const res = await submit({ form: 'no-such-form' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Unknown form/);
});

test('a cross-site POST is refused before the handler runs', async () => {
  const res = await fetch(`${BASE}/_actions/submitForm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ form: 'contact' }),
  });
  assert.equal(res.status, 403);
});

test('a checkbox group keeps every ticked box, not just the first', async () => {
  /*
   * THE ONE THAT LOST REAL CLIENT DATA. A checkbox group posts one entry per ticked box, and
   * formData.get returns only the first - so "Recording, Mixing, Mastering" was stored and
   * emailed as "Recording". No error, no warning: the enquiry arrives looking complete and is
   * quietly wrong. Found on two client sites independently.
   */
  const body = new URLSearchParams();
  body.append('form', 'contact');
  body.append('name', 'Test Person');
  body.append('email', 't@example.com');
  body.append('message', 'hello');
  body.append('services', 'Recording');
  body.append('services', 'Mixing');
  body.append('services', 'Mastering');

  const res = await fetch(`${BASE}/_actions/submitForm`, {
    method: 'POST',
    headers: { Origin: BASE, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(res.status, 200, 'a multi-value field must not break the submission');
});

test('the honeypot discards a bot without telling it why', async () => {
  /*
   * Answers as though it SUCCEEDED. Telling a bot which check it failed is how the next attempt
   * gets past it - so a 200 here is the correct, deliberate response, not a pass-through.
   */
  const res = await submit({
    form: 'contact',
    name: 'Bot',
    email: 'bot@example.com',
    message: 'spam',
    website: 'http://spam.example',
  });
  assert.equal(res.status, 200, 'the bot is told nothing');
  const body = await res.text();
  assert.doesNotMatch(body, /honeypot|spam|rejected/i, 'and the response reveals nothing');
});

/*
 * Mailgun signs every webhook as the hex HMAC-SHA256 of timestamp + token under the account's
 * signing key. This is that, in node:crypto; the Worker verifies it with Web Crypto.
 */
const mailgunEvent = (key) => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = 'x'.repeat(50);
  const signature = createHmac('sha256', key)
    .update(timestamp + token)
    .digest('hex');
  return JSON.stringify({
    signature: { timestamp, token, signature },
    'event-data': { event: 'unsubscribed', recipient: 'nobody@example.com' },
  });
};
const postEvent = (base, body) =>
  fetch(`${base}/_webm/mailgun`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

for (const [how, base] of [
  ['a Worker secret', BASE],
  ['a Secrets Store binding', STORE_BASE],
]) {
  test(`the Mailgun webhook verifies a signed event with the key bound as ${how}`, async () => {
    const res = await postEvent(base, mailgunEvent(SIGNING_KEY));
    assert.equal(res.status, 200, await res.text());
  });

  test(`and rejects a mis-signed one with the key bound as ${how}`, async () => {
    /*
     * The 200 above proves the key was READ; this proves it was COMPARED. A route that could not
     * get the secret and admitted everything would pass the first alone.
     */
    const res = await postEvent(base, mailgunEvent('not-the-key'));
    assert.equal(res.status, 401);
  });
}
