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
    org: flag('org') ?? gitConfig('webm.org'),
    stagingEmail:
      flag('staging-email') ?? gitConfig('webm.stagingEmail') ?? gitConfig('user.email'),
    into: flag('into'),
    install: !argv.includes('--no-install'),
  };
}

/*
 * WHO IS SCAFFOLDING, read from the machine rather than baked into the package.
 *
 * A public package carries no agency defaults: not a GitHub org, not an inbox. A default org
 * would only ever be wrong for anyone else, and a default address means a stranger's staging site
 * mails the package author. So both come from git config, set once per machine -
 *
 *     git config --global webm.org webmonterey
 *     git config --global webm.stagingEmail dev@example.com     # optional; user.email otherwise
 *
 * - and a flag overrides either for one run. `webm doctor` fails a staging site that ends up
 * with no address.
 */
function gitConfig(key: string): string | undefined {
  try {
    const value = execFileSync('git', ['config', key], { encoding: 'utf8' }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function run(argv: string[]): number {
  const args = parseArgs(argv);

  if (!args.domain) {
    console.error(
      'webm new <domain> [--client="Name"] [--org=<github-owner>] [--staging-email=you@example.com] [--into=path] [--no-install]',
    );
    console.error('\n  webm new example.com --client="Example Co"');
    return 1;
  }

  if (!args.org) {
    console.error(
      'webm new: no GitHub owner for the repo. Either pass --org=<owner> or set it once:\n\n' +
        '  git config --global webm.org <owner>\n',
    );
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
    stagingEmail: args.stagingEmail,
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
  console.log(`  repo               ${args.org}/${names.repo}`);
  console.log(
    `  worker · d1 · r2   ${names.slug}   (the domain minus its TLD, so Chrome does not flag previews)`,
  );
  console.log(
    `\n  One name everywhere. If ${names.slug} is already taken in the account - ${domain.replace(/^[^.]+/, names.slug)}` +
      ` and another TLD both want it - pick another with --into and edit webmonterey.json.`,
  );

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
