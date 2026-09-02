/*
 * `webm doctor` - the consolidated check for everything that fails silently.
 *
 * Generation 2 specified these across a dozen places in CLAUDE.md, as prose a reader had to
 * remember. Prose is a convention; this is a mechanism. Each check maps to a trap that produced a
 * real client incident, and each failure is invisible in normal use - which is precisely why a
 * command has to go looking.
 *
 * Exit code is 1 on any failure, so it can gate a build or a go-live.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CHECKS, type CheckContext } from './checks.ts';
import { loadSiteFiles } from '../integration/config.ts';

import { PACKAGE_ROOT, packageVersion } from './package-root.ts';

/** Strip // and /* comments so JSON.parse can read a .jsonc file. */
function parseJsonc<T>(source: string): T {
  const stripped = source
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, comment) => (comment ? '' : m))
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped) as T;
}

function readTree(root: string, dir: string, exts: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.some((e) => entry.name.endsWith(e))) {
        out.set(relative(root, full), readFileSync(full, 'utf8'));
      }
    }
  };
  walk(join(root, dir));
  return out;
}

/**
 * The custom Worker entrypoint named by wrangler `main`, if there is one.
 *
 * `main` is normally absent - the adapter generates the entrypoint. A site sets it only to add
 * handlers the generated one has no room for, which in practice means `scheduled()`.
 */
/**
 * public/ files still byte-identical to the package's seeded placeholder.
 *
 * Compared by bytes rather than by hash of a known list, so replacing the artwork clears it
 * however the client's file was produced.
 */
function placeholderFiles(siteRoot: string): string[] {
  const seeded = join(PACKAGE_ROOT, 'template', 'public');
  if (!existsSync(seeded)) return [];
  return readdirSync(seeded)
    .filter((file) => {
      const theirs = join(siteRoot, 'public', file);
      if (!existsSync(theirs)) return false;
      try {
        /* Compare as base64 rather than Buffer.equals: this file typechecks without Node's
         * Buffer typings, and the files involved are a few dozen kilobytes at most. */
        return readFileSync(theirs, 'base64') === readFileSync(join(seeded, file), 'base64');
      } catch {
        return false;
      }
    })
    .map((file) => `public/${file}`);
}

function readWorkerEntry(siteRoot: string, wranglerPath: string | undefined | null): string | null {
  if (!wranglerPath) return null;
  const config = parseJsonc(readFileSync(wranglerPath, 'utf8')) as { main?: string };
  if (!config.main) return null;
  const entry = join(siteRoot, config.main);
  return existsSync(entry) ? readFileSync(entry, 'utf8') : null;
}

function contentPageNames(root: string): string[] {
  const dir = join(root, 'src/content/pages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/**
 * .mcp.json and the pre-approval list out of .claude/settings.json.
 *
 * Both are read leniently: a repo with malformed JSON in either is a repo whose MCP setup is
 * broken, and the check reports that as a missing server rather than the doctor throwing on a
 * file it was only inspecting.
 */
function readMcp(siteRoot: string): CheckContext['mcp'] {
  const read = <T>(rel: string, pick: (parsed: Record<string, unknown>) => T): T | null => {
    const path = join(siteRoot, rel);
    if (!existsSync(path)) return null;
    try {
      return pick(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      return null;
    }
  };
  return {
    declared: read('.mcp.json', (p) => (p.mcpServers ?? null) as Record<string, { url?: string }>),
    enabled: read('.claude/settings.json', (p) => (p.enabledMcpjsonServers ?? null) as string[]),
  };
}

export function buildContext(siteRoot: string): CheckContext {
  const { site } = loadSiteFiles(siteRoot);
  const wranglerPath = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(siteRoot, f))
    .find(existsSync);
  const syncPath = join(siteRoot, '.claude/skills/webm/.webm-sync.json');

  return {
    site,
    wrangler: wranglerPath ? parseJsonc(readFileSync(wranglerPath, 'utf8')) : null,
    pages: readTree(siteRoot, 'src/pages', ['.astro', '.ts']),
    components: readTree(siteRoot, 'src/components', ['.astro', '.ts']),
    today: new Date().toISOString().slice(0, 10),
    workerEntry: readWorkerEntry(siteRoot, wranglerPath),
    placeholders: placeholderFiles(siteRoot),
    contentPages: contentPageNames(siteRoot),
    content: readTree(siteRoot, 'src/content/pages', ['.json']),
    /*
     * Everything else in the repo that can hold a call the compiler will not resolve for you:
     * actions, the site's own includes and email templates, and the SQL that has to have a
     * migration behind it. Read here rather than in each check so a check stays a pure function
     * of its context and the tests can hand it a literal.
     */
    actions: readTree(siteRoot, 'src/actions', ['.ts']),
    includes: readTree(siteRoot, 'src/includes', ['.ts', '.astro']),
    emails: readTree(siteRoot, 'src/emails', ['.ts']),
    migrations: readTree(siteRoot, 'migrations', ['.sql']),
    registry: existsSync(join(siteRoot, 'src/components/registry.ts'))
      ? readFileSync(join(siteRoot, 'src/components/registry.ts'), 'utf8')
      : null,
    present: Object.fromEntries(
      [
        'public/_headers',
        'public/favicon.ico',
        'public/site.webmanifest',
        'scripts/check-node.mjs',
      ].map((f) => [f, existsSync(join(siteRoot, f))]),
    ),
    sync: existsSync(syncPath) ? JSON.parse(readFileSync(syncPath, 'utf8')) : null,
    mcp: readMcp(siteRoot),
    version: packageVersion(),
  };
}

export function run(argv: string[]): number {
  const siteRoot = argv[0] ?? process.cwd();
  if (!existsSync(join(siteRoot, 'webmonterey.json'))) {
    console.error(`webm doctor: no webmonterey.json in ${siteRoot}. Not a WebMonterey site.`);
    return 1;
  }

  const ctx = buildContext(siteRoot);
  let failed = 0;
  let warned = 0;

  for (const check of CHECKS) {
    const result = check.run(ctx);
    const mark = result.status === 'pass' ? '  ok ' : result.status === 'warn' ? 'warn ' : 'FAIL ';
    console.log(`${mark} ${check.title}`);
    if (result.detail) {
      console.log(`       ${result.detail}`);
      /*
       * The failure mode is printed with the failure. A check that only says what is wrong makes
       * the reader guess whether it matters; saying what it looks like from outside is what turns
       * "not listed in run_worker_first" into something worth fixing before a client sees it.
       */
      if (result.status === 'fail') console.log(`       fails as: ${check.silentAs}`);
    }
    if (result.status === 'fail') failed++;
    if (result.status === 'warn') warned++;
  }

  console.log(
    `\n${CHECKS.length - failed - warned} passed, ${warned} warning${warned === 1 ? '' : 's'}, ${failed} failed`,
  );
  return failed > 0 ? 1 : 0;
}
