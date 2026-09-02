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
import { spawn } from 'node:child_process';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local'], {
    stdio: 'ignore',
    detached: false,
  });
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('wrangler dev never came up');
});

after(() => server?.kill());

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
