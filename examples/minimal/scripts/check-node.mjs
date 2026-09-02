// Preinstall guard. Runs BEFORE node_modules exists, so it may import nothing but
// node: builtins. Keep it dependency-free forever.
//
// Two checks, in the order that gives the most actionable message first:
//
//   1. Package manager. npm only. A stray `pnpm install` writes pnpm-lock.yaml beside the
//      committed package-lock.json, and from then on the two disagree about the tree.
//   2. Node major, against .nvmrc. Warns locally — a newer major is fine for day-to-day
//      work and CLAUDE.md says so — but fails hard in CI, where building on a major we do
//      not ship is not a warning-level event.
//
// .nvmrc is the single source of truth. There is no volta key, no packageManager field,
// and `engines` deliberately stays wider (>=22.18.0) because it describes what the code
// requires, not what we develop on.

import { readFileSync } from 'node:fs';

const strict = Boolean(process.env.CI || process.env.STRICT_NODE);

// --- 1. npm only -------------------------------------------------------------------

// Set by every package manager that runs a lifecycle script; absent when this file is run
// directly with `node scripts/check-node.mjs`, which stays allowed.
const agent = process.env.npm_config_user_agent ?? '';
const manager = agent.split('/')[0];

if (manager && manager !== 'npm') {
  console.error(
    `\nThis project is npm only. Detected ${manager}.\n` +
      `  package-lock.json is committed; a ${manager} install writes a second, competing\n` +
      `  lockfile and the two drift apart on the next dependency change.\n` +
      `  ${manager} resolves before it runs this check, so clean up after it:\n` +
      `    rm -rf node_modules pnpm-lock.yaml yarn.lock bun.lock && npm install\n`,
  );
  process.exit(1);
}

// --- 2. Node major matches .nvmrc --------------------------------------------------

let pinned;
try {
  pinned = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
} catch {
  // No pin in this checkout - nothing to enforce.
}

if (pinned) {
  const want = pinned.replace(/^v/, '').split('.')[0];
  const have = process.versions.node.split('.')[0];

  if (want !== have) {
    const summary = `Node ${process.versions.node} but .nvmrc pins ${pinned}, the major Workers Builds uses.`;

    if (strict) {
      console.error(
        `\n${summary}\n` +
          `  Workers Builds reads .nvmrc on its own. If this fired there, a NODE_VERSION\n` +
          `  build variable is overriding it: Settings > Build > Build Variables and Secrets.\n` +
          `  Locally: unset CI and STRICT_NODE to downgrade this back to a warning.\n`,
      );
      process.exit(1);
    }

    console.warn(
      `\n⚠️  ${summary}\n` +
        `   Switch with: nvm use   (fnm and mise read .nvmrc too — see README)\n` +
        `   No version manager at all? README "Node version" is a one-time setup.\n` +
        `   Continuing. Day-to-day work on a newer major is fine, but reproduce CI\n` +
        `   failures on ${want} before concluding they are not real.\n`,
    );
  }
}
