/*
 * `webm new <domain>` - from nothing to a site that builds.
 *
 * THE BOOTSTRAP GAP THIS CLOSES: `start` has to run before the package is installed, so it
 * cannot come from the package's own skills. `npx @cparkerwebm/webmonterey new example.com` runs
 * with no repo and no prior setup, and hands off to /webm:start once the skills exist.
 *
 * Deliberately does NOT touch Cloudflare or GitHub. Creating a Worker, a D1 database or a repo
 * are outward-facing actions with real consequences, and they belong to a person with the
 * dashboard open - or to the start skill, which knows what order they go in. This writes files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DomainError, normalizeDomain, repoName, resourceNames } from './slug.ts';
import { scaffold } from './scaffold.ts';
import { sync } from './sync.ts';
import { seed, gitkeepEmptyDirs, SCAFFOLD_DIRS } from './seed.ts';

import { PACKAGE_ROOT, packageVersion } from './package-root.ts';

function parseArgs(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = (name: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    domain: positional[0],
    client: flag('client'),
    org: flag('org') ?? 'webmonterey',
    stagingEmail: flag('staging-email'),
    into: flag('into'),
    install: !argv.includes('--no-install'),
  };
}

/*
 * WHERE A STAGING SITE'S MAIL GOES, defaulting to whoever is scaffolding it.
 *
 * The package carries no inbox of its own: a default address baked into a public package means
 * a stranger's staging site mails the package author. `git config user.email` is the person at
 * the keyboard, which is the right default for a site they are about to test. The flag overrides
 * it; doctor fails a staging site that ends up with none.
 */
function gitUserEmail(): string {
  try {
    return execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function run(argv: string[]): number {
  const args = parseArgs(argv);

  if (!args.domain) {
    console.error(
      'webm new <domain> [--client="Name"] [--org=webmonterey] [--staging-email=you@example.com] [--into=path] [--no-install]',
    );
    console.error('\n  webm new autire.com --client="Autire Technologies"');
    return 1;
  }

  let domain: string;
  try {
    domain = normalizeDomain(args.domain);
  } catch (error) {
    console.error(`webm new: ${error instanceof DomainError ? error.message : error}`);
    return 1;
  }

  const names = resourceNames(domain);
  const root = resolve(args.into ?? repoName(domain));

  /*
   * Refuse a directory that already has anything in it. Scaffolding over an existing site would
   * overwrite webmonterey.json and design.json - the two files nobody can reconstruct.
   */
  if (existsSync(root) && readdirSync(root).length > 0) {
    console.error(`webm new: ${root} exists and is not empty. Refusing to scaffold over it.`);
    return 1;
  }

  const files = scaffold({
    domain,
    client: args.client,
    org: args.org,
    stagingEmail: args.stagingEmail ?? gitUserEmail(),
    packageVersion: packageVersion(),
    /* Real today, not a constant - see ScaffoldOptions.today for what a stale one does. */
    today: new Date().toISOString().slice(0, 10),
  });

  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  /*
   * Seed AFTER the scaffold, and never over it. Both can produce a given path; the scaffold's
   * version is the one with this client's domain in it.
   */
  const seeded = seed(PACKAGE_ROOT, root);

  /*
   * scripts/ and migrations/ come from `sync`, so they arrive on every install rather than only
   * at scaffold time. Run it before the .gitkeep walk so migrations/ is not marked empty.
   */
  sync(root);

  const kept = gitkeepEmptyDirs(root, SCAFFOLD_DIRS);

  console.log(`Scaffolded ${Object.keys(files).length} files into ${root}`);
  console.log(`  + ${seeded.length} seeded (favicons, headers, CLAUDE.md, a contact form)`);
  console.log(`  + ${kept.length} .gitkeep, so the empty directories survive a clone\n`);
  console.log(`  repo     ${args.org}/${names.repo}      (keeps the domain)`);
  console.log(
    `  worker   ${names.worker}                (slug - no TLD, so Chrome does not flag previews)`,
  );
  console.log(`  d1       ${names.d1}`);
  console.log(`  r2       ${names.r2Media}`);

  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  } catch {
    console.log('\n  (git init failed - initialize the repo yourself)');
  }

  if (args.install) {
    console.log('\nInstalling…');
    try {
      execFileSync('npm', ['install'], { cwd: root, stdio: 'inherit' });
    } catch {
      console.error(
        `\nInstall failed. The scaffold is written and fine; fix the cause above and run npm install in ${names.repo}.`,
      );
      return 1;
    }
  }

  console.log(`\nNext:`);
  console.log(`  cd ${names.repo}`);
  console.log(`  claude          # then /webm:start — it takes it from here`);
  console.log(`\nStart Claude from the repo root. Project skills-dir plugins load only from the`);
  console.log(`directory you start in; launching from a subdirectory misses them.`);
  return 0;
}
