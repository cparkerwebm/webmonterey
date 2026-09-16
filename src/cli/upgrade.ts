/*
 * `webm upgrade` - move a site to a newer framework version.
 *
 * THE STEPS LIVE HERE, NOT IN THE SKILL. An invoked skill's rendered text enters the conversation
 * once and is not re-read on later turns, so /webm:upgrade runs npm install, overwrites its own
 * SKILL.md with the new version's, and keeps executing the OLD instructions to completion. The
 * binary on disk is the new version the moment the install finishes; the markdown is frozen for
 * the session. Anything version-specific therefore has to be here.
 *
 * AND THE SAME TRAP APPLIES TO THIS PROCESS. The command runs in the OLD version's Node process:
 * it installs the new package and then, through 1.6.1, ran the codemods from the registry it had
 * already imported - the old one, in which a codemod shipping in the version being installed does
 * not exist. Two upgrades of one site each applied nothing until `--codemods-from` was run by hand
 * in a fresh process. So after the install this process does exactly one more thing: it spawns
 * the NEW binary, from the site's node_modules, to run the codemods, the toolchain step, the sync
 * and the queue step. Nothing after the install runs from memory.
 *
 * THE TOOLCHAIN STEP is the one that moves a dependency other than the package: it raises the
 * site's wrangler to the floor the new version was tested with, so a fleet-wide advisory in
 * miniflare or workerd is fixed by upgrading rather than one repo at a time. See toolchain.ts.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codemodsAfter } from './codemods.ts';
import { sync } from './sync.ts';
import { enableQueue, report as reportQueue } from './queue.ts';
import { resolveWrangler, wranglerRunner } from './wrangler.ts';
import { npmRunner, raiseToolchain, report as reportToolchain } from './toolchain.ts';
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

/** The binary the install just put in place - the one that knows the new version's codemods. */
function installedBin(siteRoot: string): string {
  return join(siteRoot, 'node_modules', PACKAGE, 'dist/webm.mjs');
}

export function run(argv: string[]): number {
  const siteRoot = process.cwd();
  const target = argv.find((a) => !a.startsWith('-')) ?? 'latest';
  const dryRun = argv.includes('--dry-run');
  const noQueue = argv.includes('--no-queue');

  if (!existsSync(join(siteRoot, 'webmonterey.json'))) {
    console.error(`webm upgrade: no webmonterey.json here. Not a WebMonterey site.`);
    return 1;
  }

  /*
   * --codemods-from <version>: the second half of an upgrade, run by the NEW binary - the
   * codemods since that version, the toolchain step, the sync, the queue step. No install, no
   * branch, no clean-tree guard: the first half did those, or a person is re-running it on
   * purpose (a site whose package.json was bumped by hand, a site upgraded on a version that had
   * the bug above), and its changes are reviewed the way any edit is.
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
    toolchainStep(siteRoot);
    const synced = resync(siteRoot);
    if (!noQueue) queueStep(siteRoot);
    tail(synced);
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

  const branch = `upgrade/${PACKAGE.split('/')[1]}-${target.replace(/[^\w.-]+/g, '-')}`;
  if (git(siteRoot, ['rev-parse', '--abbrev-ref', 'HEAD']) === 'main') {
    git(siteRoot, ['checkout', '-b', branch]);
    console.log(`Branched to ${branch}. Never upgrade on main.`);
  }

  /* A version, a dist-tag, or a path to a tarball - the last is how the end-to-end test does it. */
  const spec = /\.tgz$|^[./]/.test(target) ? target : `${PACKAGE}@${target}`;
  execFileSync('npm', ['install', spec], { cwd: siteRoot, stdio: 'inherit' });
  const to = installedVersion(siteRoot);
  if (!to) {
    console.error('webm upgrade: install did not produce a version. Check the npm output above.');
    return 1;
  }

  /* From here on, the NEW binary. See the header. */
  const bin = installedBin(siteRoot);
  if (!existsSync(bin)) {
    console.error(
      `webm upgrade: ${bin} is missing after the install. Run npx webm upgrade --codemods-from ${from ?? '0.0.0'}.`,
    );
    return 1;
  }
  console.log(
    `\nInstalled ${to}. Handing over to it for the codemods, the toolchain, the sync and the queue.`,
  );
  try {
    execFileSync(
      process.execPath,
      [bin, 'upgrade', '--codemods-from', from ?? '0.0.0', ...(noQueue ? ['--no-queue'] : [])],
      { cwd: siteRoot, stdio: 'inherit' },
    );
  } catch {
    console.error(
      `\nwebm upgrade: the ${to} binary failed on the second half. Re-run it: ` +
        `npx webm upgrade --codemods-from ${from ?? '0.0.0'}`,
    );
    return 1;
  }
  return 0;
}

function runMods(siteRoot: string, mods: ReturnType<typeof codemodsAfter>): void {
  if (!mods.length) return;
  console.log(`\nRunning ${mods.length} codemod${mods.length === 1 ? '' : 's'}:`);
  for (const mod of mods) {
    const changes = mod.run(siteRoot);
    console.log(`  ${mod.version} ${mod.title}`);
    for (const c of changes) console.log(`      ${c}`);
    if (!changes.length) console.log(`      nothing to change`);
  }
}

/*
 * THE TOOLCHAIN, on every site: wrangler raised to the floor this version was tested with, and
 * nothing else touched. Runs after the codemods, which may edit wrangler.jsonc, and before the
 * sync, so a site that stops here has a lockfile the doctor's toolchain-floor check accepts.
 * A newer wrangler bundles a newer workerd, and the compatibility_date trap is a date NEWER
 * than the bundled runtime, not older - so this direction is safe; the stale-date check covers
 * the other.
 */
function toolchainStep(siteRoot: string): void {
  console.log('\nToolchain:');
  reportToolchain(raiseToolchain(siteRoot, npmRunner(siteRoot)));
}

function resync(siteRoot: string): ReturnType<typeof sync> {
  const synced = sync(siteRoot);
  console.log(`\nSkills re-materialized (v${synced.version})`);
  for (const s of synced.added) console.log(`  + /webm:${s}`);
  for (const s of synced.removed) console.log(`  - /webm:${s}`);
  return synced;
}

/*
 * THE QUEUE, on every site. Creates the two queues on the account and wires the config - the
 * one step of an upgrade that leaves the machine. When it cannot (not logged in, no network)
 * it writes nothing and says so; the site keeps sending inline and `npx webm queue` finishes
 * it later. --no-queue skips it for a site that should stay inline.
 */
function queueStep(siteRoot: string): void {
  console.log('\nQueue:');
  const bin = resolveWrangler(siteRoot);
  reportQueue(enableQueue(siteRoot, bin ? wranglerRunner(siteRoot, bin) : null), siteRoot);
}

function tail(synced: ReturnType<typeof sync>): void {
  console.log(`\nNow, in order:`);
  console.log(`  npx webm doctor`);
  console.log(`  npm run check && npm run build`);
  console.log(`  git push -u origin HEAD   # review the preview URL before merging`);
  if (synced.added.length || synced.removed.length) {
    console.log(`\nSkill changes are live already. Run /reload-plugins if anything outside`);
    console.log(`skills/ changed - agents, hooks and .mcp.json are not picked up live.`);
  }
}
