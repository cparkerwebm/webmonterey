/*
 * `webm queue` against fixture sites, with wrangler faked: every path a real account can take,
 * and the four files it is allowed to touch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enableQueue } from './queue.ts';
import type { WranglerRunner } from './wrangler.ts';

const OLD_WRANGLER = `{
  "name": "acme",
  "compatibility_date": "2026-08-01",
  "assets": {
    "directory": "./dist/client",
    "run_worker_first": ["/_actions/*"]
  },
  "observability": { "enabled": true }
}
`;

const SCAFFOLD_WRANGLER = `{
  "name": "acme",
  "main": "./src/worker.ts",

  // THE QUEUE. Off until the queues exist.
  // "queues": {
  //   "producers": [{ "binding": "QUEUE", "queue": "acme" }],
  //   "consumers": [
  //     { "queue": "acme", "max_retries": 5, "dead_letter_queue": "acme-fail" }
  //   ]
  // },

  "observability": { "enabled": true }
}
`;

function site(wrangler: string, worker?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'webm-queue-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'wrangler.jsonc'), wrangler);
  writeFileSync(
    join(root, 'webmonterey.json'),
    JSON.stringify(
      { client: 'Acme', domain: 'acme.com', features: { d1: true, queue: false } },
      null,
      2,
    ) + '\n',
  );
  if (worker !== undefined) writeFileSync(join(root, 'src/worker.ts'), worker);
  return root;
}

/** A wrangler that creates on the first call per name and says "already exists" after. */
function fakeWrangler(mode: 'ok' | 'exists' | 'login' | 'error' = 'ok') {
  const calls: string[][] = [];
  const created = new Set<string>();
  const runner: WranglerRunner = (args) => {
    calls.push(args);
    const name = args[2]!;
    if (mode === 'login')
      return { ok: false, output: 'In a non-interactive environment, set CLOUDFLARE_API_TOKEN' };
    if (mode === 'error')
      return {
        ok: false,
        output: '✘ [ERROR] A request to the Cloudflare API failed. quota exceeded',
      };
    if (mode === 'exists' || created.has(name))
      return { ok: false, output: `✘ [ERROR] Queue "${name}" already exists. [code: 11009]` };
    created.add(name);
    return { ok: true, output: `✅ Created queue "${name}"` };
  };
  return { runner, calls };
}

test('a 1.5 site: both queues created, main and the block inserted, worker.ts written, flag on', () => {
  const root = site(OLD_WRANGLER);
  const { runner, calls } = fakeWrangler();
  const result = enableQueue(root, runner);
  assert.equal(result.skipped, null);
  assert.deepEqual(calls, [
    ['queues', 'create', 'acme'],
    ['queues', 'create', 'acme-fail'],
  ]);
  const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(wrangler, /"main": "\.\/src\/worker\.ts",\n\n  "assets"/);
  assert.match(
    wrangler,
    /"queues": \{\n    "producers": \[\{ "binding": "QUEUE", "queue": "acme" \}\],[\s\S]*"dead_letter_queue": "acme-fail"[\s\S]*\},\n\n  "observability"/,
  );
  assert.match(
    readFileSync(join(root, 'src/worker.ts'), 'utf8'),
    /defineWorker\(\{ queue: formQueue\(\) \}\)/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, 'webmonterey.json'), 'utf8')).features.queue,
    true,
  );
  assert.equal(result.changes.length, 6, result.changes.join('; '));

  const again = enableQueue(root, fakeWrangler('exists').runner);
  assert.deepEqual(
    again,
    { changes: [], skipped: null },
    'idempotent: the block is live, nothing is touched',
  );
});

test('a 1.6 scaffold: the commented block is uncommented, the existing worker.ts left alone', () => {
  const root = site(
    SCAFFOLD_WRANGLER,
    `import { defineWorker } from '@cparkerwebm/webmonterey/worker';\nimport { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';\n\nexport default defineWorker({ queue: formQueue() });\n`,
  );
  const result = enableQueue(root, fakeWrangler().runner);
  assert.equal(result.skipped, null);
  const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(wrangler, /^  "queues": \{\n    "producers"/m);
  assert.doesNotMatch(wrangler, /\/\/ "queues"/);
  assert.match(
    wrangler,
    /\/\/ THE QUEUE\. Off until the queues exist\./,
    'the comment above it stays',
  );
  assert.ok(result.changes.some((c) => /uncommented/.test(c)));
  assert.ok(!result.changes.some((c) => /worker\.ts/.test(c)), 'worker.ts was already right');
});

test('a cron site: the queue line joins the existing defineWorker', () => {
  const root = site(
    OLD_WRANGLER.replace(
      '"compatibility_date"',
      '"main": "./src/worker.ts",\n  "compatibility_date"',
    ),
    `import { defineWorker } from '@cparkerwebm/webmonterey/worker';\nimport { runSweep } from './includes/sweep.ts';\n\nexport default defineWorker({\n  scheduled: (controller, env, ctx) => ctx.waitUntil(runSweep(env)),\n});\n`,
  );
  const result = enableQueue(root, fakeWrangler().runner);
  assert.equal(result.skipped, null);
  const worker = readFileSync(join(root, 'src/worker.ts'), 'utf8');
  assert.match(
    worker,
    /import \{ formQueue \} from '@cparkerwebm\/webmonterey\/cloudflare\/queues';/,
  );
  assert.match(worker, /defineWorker\(\{\n  queue: formQueue\(\),\n  scheduled:/);
  assert.ok(!result.changes.some((c) => /"main"/.test(c)), 'main was already set');
});

test('not logged in: nothing is created and NOTHING is written - the site keeps sending inline', () => {
  const root = site(OLD_WRANGLER);
  const result = enableQueue(root, fakeWrangler('login').runner);
  assert.match(result.skipped!, /not logged in/);
  assert.equal(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'), OLD_WRANGLER);
  assert.equal(existsSync(join(root, 'src/worker.ts')), false);
  assert.equal(
    JSON.parse(readFileSync(join(root, 'webmonterey.json'), 'utf8')).features.queue,
    false,
  );
});

test('any other wrangler failure is reported with its first line, and no wrangler is a skip too', () => {
  const root = site(OLD_WRANGLER);
  assert.match(
    enableQueue(root, fakeWrangler('error').runner).skipped!,
    /could not create queue acme: .*quota exceeded/,
  );
  assert.match(enableQueue(root, null).skipped!, /wrangler is not installed/);
  assert.equal(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'), OLD_WRANGLER);
});

test('the outline names what now goes through the queue on THIS site, and what still does not', async () => {
  const { outline } = await import('./queue.ts');
  const root = site(
    OLD_WRANGLER,
    `import { defineWorker } from '@cparkerwebm/webmonterey/worker';
import { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';
export default defineWorker({
  queue: formQueue({ 'crm.add': async () => {}, 'slack.post': async () => {} }),
  scheduled: (c, env, ctx) => ctx.waitUntil(Promise.resolve()),
});`,
  );
  const lines = outline(root).join('\n');
  assert.match(lines, /form notification emails.*retried/);
  assert.match(lines, /autoresponse.*never retried/);
  assert.match(lines, /this site's own jobs: crm\.add, slack\.post/);
  assert.match(lines, /cron in src\/worker\.ts is unchanged/);
  assert.match(lines, /Still in the request.*Turnstile, the D1 write/);
  assert.doesNotMatch(lines, /newsletter/, 'marketing is off on this site');

  writeFileSync(
    join(root, 'webmonterey.json'),
    JSON.stringify({ domain: 'acme.com', features: { marketing: true } }),
  );
  assert.match(outline(root).join('\n'), /newsletter signups[\s\S]*campaign batches/);
});

test('a wired site whose dead-letter queue was renamed gets the new queue created, nothing else', () => {
  const root = site(
    OLD_WRANGLER.replace(
      '"observability"',
      '"main": "./src/worker.ts",\n  "queues": { "producers": [{ "binding": "QUEUE", "queue": "acme" }], "consumers": [{ "queue": "acme", "dead_letter_queue": "acme-fail" }] },\n  "observability"',
    ),
    "import { defineWorker } from '@cparkerwebm/webmonterey/worker';\nimport { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';\nexport default defineWorker({ queue: formQueue() });\n",
  );
  writeFileSync(
    join(root, 'webmonterey.json'),
    JSON.stringify({ domain: 'acme.com', features: { queue: true } }),
  );
  const { runner, calls } = fakeWrangler();
  runner(['queues', 'create', 'acme']); // the main queue already exists on the account
  calls.length = 0;
  const result = enableQueue(root, runner);
  assert.equal(result.skipped, null);
  assert.deepEqual(calls, [
    ['queues', 'create', 'acme'],
    ['queues', 'create', 'acme-fail'],
  ]);
  assert.deepEqual(result.changes, ['created queue acme-fail']);
});
