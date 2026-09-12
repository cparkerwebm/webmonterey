/*
 * `webm queue` - put this site's mail on its Cloudflare Queue: create the queues, wire the config,
 * switch the feature on. Run by `webm upgrade` on every site and by /webm:start on a new one, so
 * no site is left sending inline because nobody typed four things.
 *
 * WHY A COMMAND AND NOT A CODEMOD. A codemod edits files and must work offline; this creates two
 * resources on the account. A binding to a queue that does not exist fails the next deploy, so
 * the config is written only AFTER wrangler confirms both queues exist - and when it cannot (no
 * wrangler, not logged in, no network) nothing is written, the reason is printed, and the site
 * keeps sending inline, which is correct. Re-running it later finishes the job.
 *
 * IDEMPOTENT, piece by piece: a queue that already exists is fine, a block already in
 * wrangler.jsonc is left alone, a worker.ts that already exports the consumer is untouched. The
 * scaffold's commented block is uncommented rather than duplicated; an older site gets the block
 * inserted. wrangler.jsonc is edited as TEXT - its comments are the site's.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queueNames } from '../includes/cloudflare/queues/message.ts';
import { slugFor } from './slug.ts';
import {
  isLoginProblem,
  resolveWrangler,
  wranglerRunner,
  type WranglerRunner,
} from './wrangler.ts';

export interface QueueResult {
  /** What was done, in order. Empty with `skipped` null means everything was already in place. */
  changes: string[];
  /** Why nothing was created, when nothing was: what a person does next. */
  skipped: string | null;
}

export const WORKER_FILE = `/*
 * The Worker entrypoint, named by "main" in wrangler.jsonc: the adapter's own fetch, plus the
 * queue consumer. A site that needs a Cron Trigger adds scheduled() here - see /webm:traps.
 * fetch is never overridden; site-wide request logic is Astro middleware.
 *
 * formQueue handles the package's form messages and dispatches this site's own kinds:
 *   formQueue({ 'crm.add': async (message, env) => { ... } })
 */
import { defineWorker } from '@cparkerwebm/webmonterey/worker';
import { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';

export default defineWorker({ queue: formQueue() });
`;

export function enableQueue(siteRoot: string, wrangler: WranglerRunner | null): QueueResult {
  const sitePath = join(siteRoot, 'webmonterey.json');
  if (!existsSync(sitePath))
    return { changes: [], skipped: 'no webmonterey.json here - not a WebMonterey site' };
  const site = JSON.parse(readFileSync(sitePath, 'utf8')) as {
    domain?: string;
    slug?: string;
    features?: Record<string, unknown>;
  };
  const slug = site.slug ?? (site.domain ? safeSlug(site.domain) : null);
  if (!slug)
    return {
      changes: [],
      skipped: 'webmonterey.json names no usable domain, so the queue has no name',
    };
  const names = queueNames(slug);

  const wranglerPath = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(siteRoot, f))
    .find(existsSync);
  if (!wranglerPath) return { changes: [], skipped: 'no wrangler.jsonc here' };
  let config = readFileSync(wranglerPath, 'utf8');
  const changes: string[] = [];

  /*
   * 1. The queues, on the account - before any config names them. Both names, even on a site
   * whose block is already wired: a rename (1.6.1's -fail) means the block can name a queue that
   * does not exist yet, and creating an existing one is a no-op wrangler reports as such.
   */
  const alreadyWired = /^[ \t]*"queues"\s*:/m.test(config);
  {
    if (!wrangler) {
      if (alreadyWired) return { changes, skipped: null };
      return {
        changes,
        skipped:
          'wrangler is not installed in this site, so the queues were not created. The site keeps ' +
          'sending inline. npm install, then npx webm queue.',
      };
    }
    const deadLetter = config.match(/"dead_letter_queue"\s*:\s*"([^"]+)"/)?.[1] ?? names.deadLetter;
    for (const name of [names.queue, deadLetter]) {
      const r = wrangler(['queues', 'create', name]);
      if (r.ok || /already exists/i.test(r.output)) {
        if (r.ok) changes.push(`created queue ${name}`);
        else if (!alreadyWired) changes.push(`queue ${name} already exists`);
        continue;
      }
      return {
        changes,
        skipped: isLoginProblem(r.output)
          ? 'wrangler is not logged in (npx wrangler login), so the queues were not created and ' +
            'nothing was written. The site keeps sending inline. Log in, then npx webm queue.'
          : `wrangler could not create queue ${name}: ${firstLine(r.output)}. Nothing was ` +
            'written; the site keeps sending inline. Fix that, then npx webm queue.',
      };
    }
  }

  /* 2. wrangler.jsonc: main, and the queues block. */
  const before = config;
  if (!/^[ \t]*"main"\s*:/m.test(config)) {
    config = insertBefore(config, /^[ \t]*"assets"\s*:/m, `  "main": "./src/worker.ts",\n\n`);
    changes.push('wrangler.jsonc: "main": "./src/worker.ts"');
  }
  if (!alreadyWired) {
    const commented = config.match(
      /^[ \t]*\/\/ "queues": \{\n(?:[ \t]*\/\/.*\n)*?[ \t]*\/\/ \},?\n/m,
    );
    if (commented) {
      const live = commented[0].replace(/^([ \t]*)\/\/ ?/gm, '$1');
      config = config.replace(commented[0], live);
      changes.push('wrangler.jsonc: the queues block uncommented');
    } else {
      const block =
        `  "queues": {\n` +
        `    "producers": [{ "binding": "QUEUE", "queue": "${names.queue}" }],\n` +
        `    "consumers": [\n` +
        `      { "queue": "${names.queue}", "max_retries": 5, "dead_letter_queue": "${names.deadLetter}" }\n` +
        `    ]\n` +
        `  },\n\n`;
      config = insertBefore(config, /^[ \t]*"observability"\s*:/m, block);
      changes.push('wrangler.jsonc: the queues block');
    }
  }
  if (config !== before) writeFileSync(wranglerPath, config);

  /* 3. The consumer. */
  const workerPath = join(siteRoot, 'src/worker.ts');
  if (!existsSync(workerPath)) {
    writeFileSync(workerPath, WORKER_FILE);
    changes.push('src/worker.ts: written, exporting defineWorker({ queue: formQueue() })');
  } else {
    const source = readFileSync(workerPath, 'utf8');
    if (!/\bformQueue\b/.test(source) && !/\bqueue\s*[(:]/.test(stripComments(source))) {
      const withImport = source.replace(
        /(import \{ defineWorker \} from '@cparkerwebm\/webmonterey\/worker';\n)/,
        `$1import { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';\n`,
      );
      const withHandler = withImport.replace(
        /defineWorker\(\{\n?/,
        (m) => `${m}  queue: formQueue(),\n`,
      );
      if (withHandler !== source && withImport !== source) {
        writeFileSync(workerPath, withHandler);
        changes.push('src/worker.ts: queue: formQueue() added to the existing entrypoint');
      } else {
        changes.push(
          'src/worker.ts: exists but does not use defineWorker - add `queue: formQueue()` to it by hand',
        );
      }
    }
  }

  /* 4. The flag. */
  if (site.features?.queue !== true) {
    site.features = { ...(site.features ?? {}), queue: true };
    writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');
    changes.push('webmonterey.json: features.queue on');
  }

  return { changes, skipped: null };
}

function insertBefore(text: string, anchor: RegExp, block: string): string {
  const at = text.search(anchor);
  if (at !== -1) return text.slice(0, at) + block + text.slice(at);
  const close = text.lastIndexOf('}');
  return (
    text.slice(0, close).replace(/,?\s*$/, ',\n\n') +
    block.replace(/,\n\n$/, '\n') +
    text.slice(close)
  );
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const firstLine = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('🪵')) ?? 'no output';

function safeSlug(domain: string): string | null {
  try {
    return slugFor(domain);
  } catch {
    return null;
  }
}

export function run(): number {
  const siteRoot = process.cwd();
  const bin = resolveWrangler(siteRoot);
  const result = enableQueue(siteRoot, bin ? wranglerRunner(siteRoot, bin) : null);
  report(result);
  return result.skipped ? 1 : 0;
}

/** Shared with `webm upgrade`, which runs the same step. */
export function report(result: QueueResult, siteRoot = process.cwd()): void {
  for (const c of result.changes) console.log(`  ${c}`);
  if (result.skipped) {
    console.log(`  queue: ${result.skipped}`);
    return;
  }
  console.log(result.changes.length === 0 ? '  queue: already wired.' : '  queue: on.');
  for (const line of outline(siteRoot)) console.log(`  ${line}`);
  if (result.changes.length) {
    console.log(
      '  Next: npm run build, then a form test on `npm run preview` - astro dev does not run ' +
        'consumers.',
    );
  }
}

/**
 * WHAT ON THIS SITE NOW GOES THROUGH THE QUEUE, so the person running the upgrade knows what the
 * site does differently. Read from the site's own files: the flags in webmonterey.json say which
 * package jobs are live, and the handler kinds in src/worker.ts are the site's own. Stated as
 * what leaves the request and what stays, because the second half is the question people ask.
 */
export function outline(siteRoot: string): string[] {
  const sitePath = join(siteRoot, 'webmonterey.json');
  const features = existsSync(sitePath)
    ? ((JSON.parse(readFileSync(sitePath, 'utf8')) as { features?: Record<string, unknown> })
        .features ?? {})
    : {};
  const lines = [
    'Through the queue on this site:',
    '  - form notification emails to the client: retried on failure, dead-lettered after the retries',
    '  - visitor autoresponse emails: sent once, never retried',
  ];
  if (features.marketing === true) {
    lines.push(
      '  - newsletter signups: the pending row and the confirmation email',
      '  - campaign batches: up to 1,000 recipients each, retried alone, idempotent',
    );
  }
  const workerPath = join(siteRoot, 'src/worker.ts');
  if (existsSync(workerPath)) {
    const source = stripComments(readFileSync(workerPath, 'utf8'));
    const handlers = source.match(/formQueue\(\s*\{([\s\S]*?)\}\s*\)/)?.[1] ?? '';
    const kinds = [...handlers.matchAll(/['"]([\w.-]+)['"]\s*:/g)].map((m) => m[1]!);
    if (kinds.length) lines.push(`  - this site's own jobs: ${kinds.join(', ')}`);
    if (/\bscheduled\s*[(:]/.test(source))
      lines.push('  (the cron in src/worker.ts is unchanged - a schedule, not a queue)');
  }
  lines.push(
    'Still in the request, because the visitor needs the answer: validation, the honeypot, Turnstile, the D1 write.',
    'If the queue is ever down or the binding missing, the action sends inline as before.',
  );
  return lines;
}
