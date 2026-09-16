/*
 * The toolchain floor: the minimum wrangler a release was tested with, and the upgrade step that
 * raises a site to it.
 *
 * WHY THE PACKAGE OWNS THIS. The scaffold used to write a wrangler range into a new site's
 * devDependencies, and that was the last time the package had a say: `webm upgrade` moved the
 * package and nothing else, so every site kept the wrangler its lockfile had the day it was
 * scaffolded, and a dependency advisory had to be fixed one repo at a time. The concrete case,
 * 2026-09-12: a site upgraded 1.5.0 -> 1.6.2 still ran wrangler 4.129.0, whose miniflare bundles
 * sharp 0.35.2 and its libheif heap overflow (GHSA-rgj7-g3m4-5g8c, high). The fix is sharp
 * 0.35.4, which arrives with wrangler 4.131.1; every range in the chain already accepted it, and
 * nothing but the lockfile held the site back.
 *
 * ONE CONSTANT IS THE FLOOR. The scaffold writes it into a new site and the upgrade raises an old
 * site to it, so a release's floor reaches the whole fleet as sites upgrade. Astro stays a peer
 * of the site as it is; this is the Cloudflare toolchain the package's adapter drags in.
 *
 * WHAT THE STEP INSTALLS IS THE VERSION THE ADAPTER'S PLUGIN PINS, never below the floor.
 * @cloudflare/vite-plugin depends on an EXACT wrangler and miniflare, and @astrojs/cloudflare
 * takes whichever plugin is newest at install time - so a site whose own wrangler differs from
 * the plugin's carries two copies, two miniflares and two workerd binaries, and `npm dedupe`
 * cannot merge two exact versions. Installing the pinned one is what leaves a single copy. The
 * floor is the guarantee; the pin is how it is met without duplication.
 *
 * NOT `npm audit fix`. That bumps whatever npm decides that day, differs from site to site, and
 * is not something a release can test. The floor is deterministic and tested once per release.
 *
 * COMPATIBILITY DATE, in this direction, is safe. A newer wrangler bundles a newer workerd, and
 * the trap is a compatibility_date NEWER than the bundled runtime - miniflare refuses it with
 * ERR_FUTURE_COMPATIBILITY_DATE - never one older. Raising wrangler can only widen the dates the
 * runtime accepts; the doctor's stale-date check covers the other side.
 *
 * IDEMPOTENT, and it touches nothing but wrangler: the range in package.json, and the lockfile
 * through one `npm install wrangler@<version>`. A site already at or above the floor is left
 * exactly as it is, and a site above it is never brought down.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { compareVersions } from './codemods.ts';
import { errorLine } from './queue.ts';

/** The minimum wrangler this release was tested with. Raised in the release that needs it. */
export const WRANGLER_FLOOR = '4.131.1';

/** The range the scaffold writes: the floor with a caret, so a site can move within the major. */
export const wranglerRange = (): string => `^${WRANGLER_FLOOR}`;

export interface NpmResult {
  ok: boolean;
  /** stdout and stderr together. */
  output: string;
}

export type NpmRunner = (args: string[]) => NpmResult;

export interface ToolchainResult {
  /** What was done, in order. Empty with `skipped` null means the site was already there. */
  changes: string[];
  /** Why nothing was raised, when nothing was: what a person does next. */
  skipped: string | null;
  /** The wrangler installed in the site after the step, or null when none is. */
  installed: string | null;
}

type Manifest = { version: string; dependencies?: Record<string, string> };

/**
 * The manifest of a package installed in the site, resolved from the site upward the way `npx`
 * would find it, with a look under the two packages that can carry their own copy when the
 * resolver refuses a manifest the package does not export.
 */
function installedManifest(siteRoot: string, name: string): Manifest | null {
  const root = resolve(siteRoot);
  const candidates: string[] = [];
  try {
    candidates.push(createRequire(join(root, 'package.json')).resolve(`${name}/package.json`));
  } catch {
    /* not exported, or not installed - the paths below decide */
  }
  candidates.push(
    join(root, 'node_modules', name, 'package.json'),
    join(root, 'node_modules/@astrojs/cloudflare/node_modules', name, 'package.json'),
  );
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    } catch {
      return null;
    }
  }
  return null;
}

/** The wrangler installed in the site, or null when none is. Read from the manifest, not the range. */
export function installedWrangler(siteRoot: string): string | null {
  return installedManifest(siteRoot, 'wrangler')?.version ?? null;
}

/** The lowest version a range names: `^4.118.0` -> 4.118.0. Null for a range with no number in it. */
export function rangeMinimum(range: string): string | null {
  return range.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

/** What the step installs: the plugin's exact pin when that is above the floor, else the floor. */
export function targetWrangler(siteRoot: string): { version: string; reason: string } {
  const plugin = installedManifest(siteRoot, '@cloudflare/vite-plugin');
  const pinned = plugin?.dependencies?.wrangler;
  if (pinned && /^\d+\.\d+\.\d+$/.test(pinned) && compareVersions(pinned, WRANGLER_FLOOR) > 0) {
    return { version: pinned, reason: `what @cloudflare/vite-plugin ${plugin!.version} pins` };
  }
  return { version: WRANGLER_FLOOR, reason: 'the floor' };
}

/** How many copies of wrangler npm sees in the site's tree. */
function wranglerCopies(npm: NpmRunner): number {
  const r = npm(['ls', 'wrangler', '--parseable', '--all']);
  return new Set(
    r.output
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /[\\/]wrangler$/.test(l)),
  ).size;
}

export function raiseToolchain(siteRoot: string, npm: NpmRunner): ToolchainResult {
  const pkgPath = join(siteRoot, 'package.json');
  const before = installedWrangler(siteRoot);
  if (!existsSync(pkgPath))
    return { changes: [], skipped: 'no package.json here', installed: before };

  const readPkg = () =>
    JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  const pkg = readPkg();
  const field = pkg.devDependencies?.wrangler
    ? 'devDependencies'
    : pkg.dependencies?.wrangler
      ? 'dependencies'
      : null;
  if (!field) {
    return {
      changes: [],
      skipped: 'package.json does not list wrangler, so nothing was raised',
      installed: before,
    };
  }
  const range = pkg[field]!.wrangler!;
  const min = rangeMinimum(range);
  if (!min) {
    return {
      changes: [],
      skipped: `wrangler is "${range}" in package.json, which names no version, so it was left alone`,
      installed: before,
    };
  }

  const changes: string[] = [];
  const rangeBelow = compareVersions(min, WRANGLER_FLOOR) < 0;

  /* Installed and at or above the floor: the lockfile is fine. Only a range below it moves. */
  if (before && compareVersions(before, WRANGLER_FLOOR) >= 0) {
    if (rangeBelow) {
      pkg[field]!.wrangler = wranglerRange();
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      changes.push(
        `package.json: wrangler ${range} -> ${wranglerRange()} (${before} is installed, already above the floor)`,
      );
    }
    return { changes, skipped: null, installed: before };
  }

  /* A range above the floor with nothing installed is a site that has not run npm install. */
  if (!before && !rangeBelow && compareVersions(min, WRANGLER_FLOOR) > 0) {
    return {
      changes,
      skipped: `wrangler is not installed in this site, and ${range} is above the floor - npm install gets it`,
      installed: null,
    };
  }

  /*
   * Below the floor, or not installed under a range the floor satisfies: one install of one spec,
   * so the lockfile moves and @cloudflare/vite-plugin, miniflare and workerd re-resolve with it.
   * npm writes the range itself, as ^<version>, in the field the site already used.
   */
  const target = targetWrangler(siteRoot);
  const spec = `wrangler@${target.version}`;
  const r = npm(['install', spec, field === 'devDependencies' ? '--save-dev' : '--save']);
  if (!r.ok) {
    return {
      changes,
      skipped: `npm install ${spec} failed: ${errorLine(r.output)}. Run it by hand, then npx webm doctor.`,
      installed: before,
    };
  }
  const after = installedWrangler(siteRoot);
  changes.push(
    `npm install ${spec} (${target.reason}): ${before ?? 'nothing'} -> ${after ?? 'nothing'}`,
  );
  const rangeAfter = readPkg()[field]?.wrangler;
  if (rangeAfter && rangeAfter !== range)
    changes.push(`package.json: wrangler ${range} -> ${rangeAfter}`);

  const copies = wranglerCopies(npm);
  if (copies > 1) {
    const d = npm(['dedupe']);
    changes.push(
      d.ok
        ? `npm dedupe: ${copies} copies of wrangler -> ${wranglerCopies(npm)}`
        : `npm dedupe failed: ${errorLine(d.output)} - ${copies} copies of wrangler remain`,
    );
  }
  return { changes, skipped: null, installed: after };
}

/** The site's npm, output captured so the step can say what moved rather than echo npm. */
export function npmRunner(siteRoot: string): NpmRunner {
  return (args) => {
    try {
      const output = execFileSync('npm', args, {
        cwd: siteRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { ok: true, output };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}` };
    }
  };
}

/** Printed by `webm upgrade`, in the queue step's style. */
export function report(result: ToolchainResult): void {
  for (const c of result.changes) console.log(`  ${c}`);
  if (result.skipped) {
    console.log(`  toolchain: ${result.skipped}`);
    return;
  }
  const v = result.installed;
  if (!v) {
    console.log('  toolchain: wrangler is not installed here.');
    return;
  }
  const where =
    compareVersions(v, WRANGLER_FLOOR) === 0
      ? 'at the floor'
      : `above the floor (${WRANGLER_FLOOR})`;
  console.log(`  toolchain: wrangler ${v}, ${where}.`);
}
