/*
 * `webm upgrade` - move a site to a newer framework version.
 *
 * THE STEPS LIVE HERE, NOT IN THE SKILL. An invoked skill's rendered text enters the conversation
 * once and is not re-read on later turns, so /webm:upgrade runs npm install, overwrites its own
 * SKILL.md with the new version's, and keeps executing the OLD instructions to completion. The
 * binary on disk is the new version the moment the install finishes; the markdown is frozen for
 * the session. Anything version-specific therefore has to be here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codemodsAfter, codemodsBetween } from './codemods.ts';
import { sync } from './sync.ts';
import { enableQueue, report as reportQueue } from './queue.ts';
import { resolveWrangler, wranglerRunner } from './wrangler.ts';
import { packageName } from './package-root.ts';

const PACKAGE = packageName();

function git(siteRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: siteRoot, encoding: 'utf8' }).trim();
}

function installedVersion(siteRoot: string): string | null {
  const path = join(siteRoot, 'node_modules', PACKAGE, 'package.json');
  if (!existsSync(path)) return null;
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

export function run(argv: string[]): number {
  const siteRoot = process.cwd();
  const target = argv.find((a) => !a.startsWith('-')) ?? 'latest';
  const dryRun = argv.includes('--dry-run');

  if (!existsSync(join(siteRoot, 'webmonterey.json'))) {
    console.error(`webm upgrade: no webmonterey.json here. Not a WebMonterey site.`);
    return 1;
  }

  /*
   * --codemods-from <version>: run the codemods and the sync against the INSTALLED version, with
   * no install, no branch, and no clean-tree guard - it is a targeted rerun someone asked for, and its
   * changes are reviewed the way any edit is. For a site whose package.json was bumped by hand, and for the
   * end-to-end test, which lays a site out the old way and runs the upgrade path over it.
   */
  const codemodsFrom = argv[argv.indexOf('--codemods-from') + 1];
  if (argv.includes('--codemods-from')) {
    const installed = installedVersion(siteRoot);
    if (!codemodsFrom || !installed) {
      console.error(
        'webm upgrade --codemods-from <version>: needs a version, and an installed package.',
      );
      return 1;
    }
    console.log(`Installed: ${installed}. Running the codemods since ${codemodsFrom}.`);
    runMods(siteRoot, codemodsAfter(codemodsFrom));
    resync(siteRoot);
    return 0;
  }

  /*
   * A dirty tree turns a failed upgrade into a mess with no clean revert. Refuse rather than
   * stash - an automatic stash is a surprise nobody wants to discover later.
   */
  if (git(siteRoot, ['status', '--porcelain'])) {
    console.error('webm upgrade: working tree is not clean. Commit or stash first.');
    return 1;
  }

  const from = installedVersion(siteRoot);
  console.log(`Installed: ${from ?? 'nothing'} -> ${target}`);
  if (dryRun) {
    console.log('--dry-run: stopping before any change.');
    return 0;
  }

  const branch = `upgrade/${PACKAGE.split('/')[1]}-${target}`;
  if (git(siteRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main') {
    git(siteRoot, ['checkout', '-b', branch]);
    console.log(`Branched to ${branch}. Never upgrade on main.`);
  }

  execFileSync('npm', ['install', `${PACKAGE}@${target}`], { cwd: siteRoot, stdio: 'inherit' });
  const to = installedVersion(siteRoot);
  if (!to) {
    console.error('webm upgrade: install did not produce a version. Check the npm output above.');
    return 1;
  }

  runCodemods(siteRoot, from ?? '0.0.0', to);
  const synced = resync(siteRoot);

  /*
   * THE QUEUE, on every site. Creates the two queues on the account and wires the config - the
   * one step of an upgrade that leaves the machine. When it cannot (not logged in, no network)
   * it writes nothing and says so; the site keeps sending inline and `npx webm queue` finishes
   * it later. --no-queue skips it for a site that should stay inline.
   */
  if (!argv.includes('--no-queue')) {
    console.log('\nQueue:');
    const bin = resolveWrangler(siteRoot);
    reportQueue(enableQueue(siteRoot, bin ? wranglerRunner(siteRoot, bin) : null), siteRoot);
  }

  console.log(`\nNow, in order:`);
  console.log(`  npx webm doctor`);
  console.log(`  npm run check && npm run build`);
  console.log(`  git push -u origin HEAD   # review the preview URL before merging`);
  if (synced.added.length || synced.removed.length) {
    console.log(`\nSkill changes are live already. Run /reload-plugins if anything outside`);
    console.log(`skills/ changed - agents, hooks and .mcp.json are not picked up live.`);
  }
  return 0;
}

function runCodemods(siteRoot: string, from: string, to: string): void {
  runMods(siteRoot, codemodsBetween(from, to));
}

function runMods(siteRoot: string, mods: ReturnType<typeof codemodsBetween>): void {
  if (!mods.length) return;
  console.log(`\nRunning ${mods.length} codemod${mods.length === 1 ? '' : 's'}:`);
  for (const mod of mods) {
    const changes = mod.run(siteRoot);
    console.log(`  ${mod.version} ${mod.title}`);
    for (const c of changes) console.log(`      ${c}`);
    if (!changes.length) console.log(`      nothing to change`);
  }
}

function resync(siteRoot: string): ReturnType<typeof sync> {
  const synced = sync(siteRoot);
  console.log(`\nSkills re-materialized (v${synced.version})`);
  for (const s of synced.added) console.log(`  + /webm:${s}`);
  for (const s of synced.removed) console.log(`  - /webm:${s}`);
  return synced;
}
