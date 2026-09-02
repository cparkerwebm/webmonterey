#!/usr/bin/env node
/*
 * The webm CLI.
 *
 * Deliberately dependency-free and dispatch-only: every command lives in src/cli/ and is
 * imported lazily, so `webm --help` does not pay for the cost of loading commands it will not
 * run - and a broken command cannot stop the others from listing.
 *
 * WHY THE CLI HOLDS THE LOGIC AND THE SKILLS STAY THIN: an invoked skill's text enters the
 * conversation once and is not re-read. `/webm:upgrade` therefore runs `npm install`, which
 * overwrites its own SKILL.md, and keeps executing the OLD instructions to completion. The
 * binary on disk is the new version immediately; the markdown is frozen for the session. So the
 * skill says "run npx webm upgrade" and this file carries the steps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/cli/package-root.ts';

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

const COMMANDS = {
  new: {
    blurb: 'Scaffold a new client site from a domain',
    load: () => import('../src/cli/new.ts'),
  },
  'design:extract': {
    blurb: 'Turn a hand-edited tokens.css into design.json',
    load: () => import('../src/cli/design-extract.ts'),
  },
  compare: {
    blurb: 'Diff two built sites - text, head tags, JSON-LD and CSS. For rebuilds.',
    load: () => import('../src/cli/compare.ts'),
  },
  sync: {
    blurb: 'Materialize the fleet skills into .claude/skills/webm/',
    load: () => import('../src/cli/sync.ts'),
  },
  doctor: {
    blurb: 'Check this site against the traps that fail silently',
    load: () => import('../src/cli/doctor.ts'),
  },
  upgrade: {
    blurb: 'Move this site to a newer framework version',
    load: () => import('../src/cli/upgrade.ts'),
  },
};

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log(`webm ${pkg.version} - ${pkg.description}\n`);
  console.log('Usage: webm <command> [options]\n');
  console.log('Commands:');
  for (const [name, c] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}  ${c.blurb}`);
  }
}

const [command, ...argv] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h' || command === 'help') {
  usage();
  process.exit(0);
}
if (command === '--version' || command === '-v') {
  console.log(pkg.version);
  process.exit(0);
}

const entry = COMMANDS[command];
if (!entry) {
  console.error(`webm: unknown command "${command}"\n`);
  usage();
  process.exit(1);
}

try {
  const mod = await entry.load();
  process.exit((await mod.run(argv)) ?? 0);
} catch (error) {
  console.error(`webm ${command}: ${error instanceof Error ? error.message : error}`);
  if (process.env.WEBM_DEBUG) console.error(error);
  process.exit(1);
}
