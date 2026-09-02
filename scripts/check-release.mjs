#!/usr/bin/env node
/*
 * THE GUARD ON `npm publish`, wired to prepublishOnly so it cannot be walked past by accident.
 *
 * Eight versions were published from this repo before any of this existed: no tags, no releases,
 * and a CHANGELOG still describing 1.0.0 as unreleased - which shipped inside every tarball,
 * because CHANGELOG.md is in `files`. Every client site's node_modules carried a changelog
 * asserting the package had never been released.
 *
 * None of that was a hard problem. It happened because publishing was `npm publish` after editing
 * a version number by hand, and nothing in that path had an opinion. This does.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { changelogSection } from './changelog.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const { version, name } = pkg;

/* stderr is captured, not inherited: a missing tag is an expected outcome here, and git's own
 * "fatal: ambiguous argument" printed above our explanation reads like a crash. */
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const problems = [];

/* 1. The changelog must document what is being published. */
if (!changelogSection(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version)) {
  problems.push(
    `CHANGELOG.md has no "## ${version}" section.\n` +
      `    Write the entry BEFORE releasing - it is the release notes, and the only\n` +
      `    record of why a site should move. Add:  ## ${version} — ${new Date().toISOString().slice(0, 10)}`,
  );
}

/* 2. A published version must be reachable in git. Without a tag, the only way back to the code
 *    a client site is running is unpacking a tarball from the registry. */
let tagged = '';
try {
  tagged = git('rev-list', '-n', '1', `v${version}`);
} catch {
  problems.push(
    `No git tag v${version}.\n` +
      `    \`npm publish\` does not tag; \`npm version\` does. Use \`npm run release\`,\n` +
      `    which does both in the right order.`,
  );
}
if (tagged && tagged !== git('rev-parse', 'HEAD')) {
  problems.push(
    `v${version} points at ${tagged.slice(0, 7)}, but HEAD is ${git('rev-parse', '--short', 'HEAD')}.\n` +
      `    The tag would not describe what is about to be published.`,
  );
}

/* 3. A dirty tree means the tarball contains something no commit records. */
if (git('status', '--porcelain')) {
  problems.push(
    'The working tree is dirty. Commit or stash first - anything uncommitted\n' +
      '    would be packed into the tarball and exist in no commit.',
  );
}

if (problems.length) {
  console.error(`\n  Refusing to publish ${name}@${version}:\n`);
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  process.exit(1);
}

console.log(`  ok  ${name}@${version} is documented, tagged and clean.`);
