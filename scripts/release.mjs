#!/usr/bin/env node
/*
 * THE RELEASE, as one command that cannot do half of it.
 *
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs 1.3.0 --dry-run
 *
 * Publishing used to be: edit the version by hand, `npm publish`. That produced eight versions
 * with no tags, no releases and a changelog documenting one of them - not because any step was
 * hard, but because each was separately skippable and nothing noticed. Every step here is one
 * command, in the order that makes each safe:
 *
 *   the changelog entry is written FIRST, so it is a decision rather than a chore afterwards
 *   the tests run BEFORE the version bump, so a failure leaves no commit to unpick
 *   the tag is pushed WITH the commit, so the two cannot arrive separately
 *   the registry is verified AFTER the publish, because that is the artifact clients install
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changelogSection } from './changelog.mjs';

const root = new URL('../', import.meta.url);
const ROOT = root.pathname;
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const bump = args.find((a) => !a.startsWith('-'));

if (!bump) {
  console.error(`
  node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]

    patch   a fix that asks nothing of any site
    minor   new capability, or a fix a site may want to know about
    major   something a site must change to take

  --dry-run runs every check and prints the plan without bumping, publishing or pushing.
`);
  process.exit(1);
}

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts });
const git = (...a) => run('git', a).trim();
const step = (msg) => console.log(`\n▸ ${msg}`);
const die = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const current = pkg.version;

/* ── 1. The repo must be somewhere a release can come from ───────────────────────────────── */
step('Checking the working tree');
if (git('status', '--porcelain')) die('The working tree is dirty. Commit or stash first.');

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branch !== 'main') die(`On branch ${branch}. Releases come from main.`);

/*
 * LOGGED IN TO npmjs, CHECKED HERE RATHER THAN DISCOVERED AT THE PUBLISH STEP. By then the
 * version is bumped and tagged locally, and unpicking that is the worst place to learn a login
 * lapsed. Fail before anything, not after everything.
 */
try {
  run('npm', ['whoami']);
} catch {
  die('Not logged in to npmjs. Run `npm login` first.');
}

run('git', ['fetch', 'origin', 'main', '--tags']);
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
  die('main and origin/main have diverged. Push or pull first.');
}
console.log('  clean, on main, in sync with origin');

/* ── 2. Work out the version, and refuse without its changelog entry ─────────────────────── */
const next = /^\d+\.\d+\.\d+/.test(bump)
  ? bump
  : (() => {
      const [maj, min, pat] = current.split('.').map(Number);
      if (bump === 'major') return `${maj + 1}.0.0`;
      if (bump === 'minor') return `${maj}.${min + 1}.0`;
      if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
      return die(`Not a bump or a version: ${bump}`);
    })();

step(`Releasing ${current} → ${next}`);

const changelogPath = new URL('CHANGELOG.md', root);
const notes = changelogSection(readFileSync(changelogPath, 'utf8'), next);
if (!notes) {
  die(
    `CHANGELOG.md has no "## ${next}" section.\n\n` +
      `    The entry is the release notes and the only record of why a site should move,\n` +
      `    so it is written first, deliberately, not generated afterwards. Add:\n\n` +
      `      ## ${next} — ${new Date().toISOString().slice(0, 10)}\n`,
  );
}
console.log(`  changelog entry found (${notes.split('\n').length} lines)`);

/*
 * A MAJOR MUST ASK SOMETHING OF A SITE. The definitions at the top of this file are the rule -
 * "major: something a site must change to take" - and 2.0.0 broke it: it removed an export
 * nothing imported, and its own changelog said "Nothing did" under the Breaking heading.
 *
 * Textbook semver says removing a public export is breaking whether or not anyone used it. This
 * fleet is six repos with one publisher, and here the signal matters more than the taxonomy: a
 * major means stop and migrate, and spending one when there is nothing to migrate teaches the
 * next reader to ignore the one that matters. Same failure as a warning light that is always on.
 *
 * So: a major has to name the action. If the Breaking section says nothing is required, this is
 * a minor and the script says so rather than letting reflex decide.
 */
const majorBump = next.split('.')[0] !== current.split('.')[0];
if (majorBump) {
  const breaking = notes.match(/###\s*Breaking([\s\S]*?)(?=\n###|$)/i)?.[1] ?? '';
  const asksNothing = !breaking.trim() || /\bnothing\b|\bno action\b|\bnone\b/i.test(breaking);
  if (asksNothing) {
    die(
      `${next} is a MAJOR, but its changelog does not say what a site must do.\n\n` +
        `    major is "something a site must change to take" - see the usage above. If nothing\n` +
        `    must change, this is a minor, however much the API shrank. A major that asks for\n` +
        `    nothing is a warning light left on, and the next real one gets ignored.\n\n` +
        `    Either write the migration step under "### Breaking", or release a minor.`,
    );
  }
  console.log('  major: the changelog names a migration step');
}

/* ── 3. Everything that can fail, before anything that cannot be undone ──────────────────── */
step('Running the checks');
for (const [label, cmd, cmdArgs] of [
  ['format', 'npx', ['prettier', '--check', '.']],
  ['types', 'npx', ['tsc', '--noEmit']],
  ['tests', 'npm', ['test']],
]) {
  try {
    run(cmd, cmdArgs);
    console.log(`  ok  ${label}`);
  } catch (error) {
    console.error(String(error.stdout || '') + String(error.stderr || ''));
    die(`${label} failed. Nothing has been changed.`);
  }
}

if (DRY) {
  console.log(`
  DRY RUN. Everything above passed. A real run would now:

    npm version ${next}          commit "v${next}" and tag v${next}
    npm publish --provenance     (prepublishOnly re-checks changelog, tag and tree)
    git push origin main && git push origin v${next}
                                 then read both back off origin
    gh release create v${next}   with the changelog section as its notes
    node scripts/e2e.mjs --registry
`);
  process.exit(0);
}

/* ── 4. Bump, tag, publish, push, release ────────────────────────────────────────────────── */
/*
 * THE FIRST RELEASE HAS NOTHING TO BUMP FROM.
 *
 * `npm version` refuses a version already set, so a package whose package.json says 1.0.0 and
 * which has never been published could not be released by this script at all - the one command
 * that exists so no step gets skipped could not perform the first one. Found releasing this
 * package's own 1.0.0.
 *
 * So: if the requested version IS the current version and the registry has never seen it, there
 * is nothing to bump. Tag and publish what is here. Every other check above has already run, and
 * the registry lookup is what makes this safe - a version that exists is still refused.
 */
const alreadyPublished = (() => {
  try {
    return run('npm', ['view', `${pkg.name}@${next}`, 'version']).trim();
  } catch {
    return '';
  }
})();

if (next === current) {
  if (alreadyPublished) {
    die(`${next} is already published. Bump to release something new.`);
  }
  step(`First release of ${next} - nothing to bump, tagging what is here`);
  run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`], { stdio: 'inherit' });
} else {
  step(`npm version ${next}`);
  run('npm', ['version', next, '-m', 'v%s'], { stdio: 'inherit' });
}

step('Publishing');
/*
 * --provenance signs an attestation linking the tarball to this repo and commit, which npmjs
 * shows on the package page. It needs a CI OIDC token to sign with; from a laptop npm emits a
 * warning and publishes without it rather than failing, so the flag is safe either way. `access`
 * is `public` in package.json - a scoped package defaults to restricted otherwise.
 */
try {
  run('npm', ['publish', '--provenance'], { stdio: 'inherit' });
} catch {
  die(
    `Publish failed. The commit and tag v${next} exist locally and have NOT been pushed.\n` +
      `    Fix, then: git reset --hard HEAD~1 && git tag -d v${next}`,
  );
}

step('Pushing the commit and its tag');
/*
 * THE TAG IS NAMED, not left to --follow-tags. Backfilling the eight historical tags, a single
 * `push --follow-tags` sent six of them and silently omitted two annotated tags pointing at
 * commits the remote already had - no error, exit 0. Whatever the cause, a release must not
 * depend on inferring which tags to send: an unpushed tag is invisible until the day someone
 * needs to know what code a client is running.
 */
run('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
run('git', ['push', 'origin', `v${next}`], { stdio: 'inherit' });

/*
 * READ BACK OFF THE REMOTE. `git push origin main` pushes the local ref NAMED main, which is not
 * necessarily HEAD - on a checkout of another branch it silently pushes a stale main and exits 0.
 * Six commits and two published versions sat only on a local branch that way, while every push
 * reported success. Printing local HEAD afterwards confirms nothing; this asks origin.
 */
run('git', ['fetch', 'origin', '--tags', '-q']);
const head = git('rev-parse', 'HEAD');
if (git('rev-parse', 'origin/main') !== head) {
  die('origin/main does not match HEAD after pushing. The push did not land what you think.');
}
if (!run('git', ['ls-remote', '--tags', 'origin', `v${next}`]).trim()) {
  die(`v${next} is not on origin after pushing it. Push it by hand before continuing.`);
}
console.log('  origin/main and the tag both confirmed on the remote');

step('Creating the GitHub release');
const notesFile = join(mkdtempSync(join(tmpdir(), 'webm-release-')), 'notes.md');
writeFileSync(notesFile, notes);
run('gh', ['release', 'create', `v${next}`, '--title', `v${next}`, '--notes-file', notesFile], {
  stdio: 'inherit',
});

/* ── 5. Verify the artifact clients actually install ─────────────────────────────────────── */
step('Verifying the published tarball from the registry');
run('node', ['scripts/e2e.mjs', '--registry'], { stdio: 'inherit' });

console.log(`
  ${pkg.name}@${next} released.

  Roll a site onto it:
    npm install ${pkg.name}@^${next} && npx webm sync
    npx astro build && npx webm compare <previous-dist> dist/client
`);
