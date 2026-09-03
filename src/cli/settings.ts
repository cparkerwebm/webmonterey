/*
 * The Claude Code project settings a client repo carries, and the one list of what they deny.
 *
 * WHY A MODULE, like mcp.ts. Three places have to agree about these rules: the scaffold writes
 * them into a new site, `webm sync` merges any that are missing into an existing site on every
 * install, and the tests assert both against this list rather than a literal that falls one
 * behind. `.claude/settings.json` is otherwise the site's own - a client adds allow rules to it -
 * so it is MERGED, never replaced: the package's deny rules are added when absent and everything
 * else in the file is left exactly as found.
 *
 * WHAT THE DENY RULES ENFORCE. Two things a session in a client repo must never do, made
 * mechanical rather than advisory:
 *
 *   - read a secret. .env, .dev.vars, keys, the npm config.
 *   - edit the package. Rule 12 of the site's CLAUDE.md: a session in a client repo never edits
 *     the package, not in node_modules and not in its checkout. The deliverable for an upstream
 *     problem is a description of the fix, run later in the package repo.
 *
 * THE SYNTAX, verified against code.claude.com/docs/en/permissions rather than recalled:
 *
 *   - Read and Edit rules take gitignore patterns. As a DENY rule, `Edit(**\/node_modules/**)`
 *     matches a node_modules directory at any depth under the working directory.
 *   - `Edit` rules apply to every built-in tool that edits files - Edit, Write, MultiEdit and
 *     NotebookEdit. A `Write(...)` rule is accepted, never consulted, and warned about at
 *     startup, which is why none appears here and why the two that 1.2.0 scaffolded are removed.
 *   - A `Read` deny also blocks Edit and Write on the same path. The Edit rules for the secret
 *     files are therefore redundant, and kept: they say what is meant.
 *   - THERE IS NO PATTERN FOR "ANY PATH OUTSIDE THE PROJECT". A rule names a path - `//absolute`,
 *     `~/home-relative`, `/project-relative`, or cwd-relative - and nothing expresses the
 *     complement of one. The package checkout sitting beside a client repo on the same machine
 *     cannot be denied by rule without hardcoding where it is, and a public package does not
 *     know. Rule 12 in CLAUDE.md carries that half in prose.
 */

import { MCP_NAMES } from './mcp.ts';

/** Every rule a site's settings must deny. Order is the order they are written. */
export const DENY_RULES: readonly string[] = [
  'Read(**/.dev.vars)',
  'Read(**/.dev.vars.*)',
  'Read(**/.env)',
  'Read(**/.env.*)',
  'Read(**/*.pem)',
  'Read(**/*.key)',
  'Read(**/.npmrc)',
  'Edit(**/.dev.vars)',
  'Edit(**/.env)',
  'Edit(**/node_modules/**)',
];

/**
 * Rules an earlier scaffold wrote that Claude Code never consults and warns about at startup.
 * Removed on sync, by exact string, so a rule the site wrote itself is never touched.
 */
export const STALE_RULES: readonly string[] = ['Write(**/.dev.vars)', 'Write(**/.env)'];

const PERMISSIONS_NOTE =
  'The deny list is package-managed: `webm sync` adds any rule that is missing on every ' +
  'install and leaves everything else in this file alone. Edit(**/node_modules/**) is rule 12 ' +
  'of CLAUDE.md made mechanical - a session in this repo never edits the package.';

/** The whole file, for a new site. */
export function projectSettings(repo: string): Record<string, unknown> {
  return {
    '//': `Project settings for ${repo}.`,
    '//mcp':
      'A server declared in .mcp.json is INERT until approved on each machine. Without this line the rules that say consult the Astro and MDN docs before using an API would depend on whoever cloned the repo happening to hit Approve.',
    includeCoAuthoredBy: false,
    enabledMcpjsonServers: [...MCP_NAMES],
    '//permissions': PERMISSIONS_NOTE,
    permissions: { deny: [...DENY_RULES] },
  };
}

/**
 * An existing settings file with the package's deny rules present and the stale ones gone.
 *
 * IDEMPOTENT, and additive everywhere else: a second pass reports nothing and changes nothing,
 * and a rule the site added itself - an allow list, a deny of its own - survives untouched. The
 * site's own rules keep their order; the package's are appended in DENY_RULES order.
 */
export function withDenyRules(settings: Record<string, unknown>): {
  settings: Record<string, unknown>;
  added: string[];
  removed: string[];
} {
  const permissions =
    settings.permissions && typeof settings.permissions === 'object'
      ? { ...(settings.permissions as Record<string, unknown>) }
      : {};
  const current = Array.isArray(permissions.deny)
    ? (permissions.deny as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];

  const removed = current.filter((r) => STALE_RULES.includes(r));
  const kept = current.filter((r) => !STALE_RULES.includes(r));
  const added = DENY_RULES.filter((r) => !kept.includes(r));
  if (!added.length && !removed.length) return { settings, added, removed };

  permissions.deny = [...kept, ...added];
  return {
    settings: { ...settings, '//permissions': PERMISSIONS_NOTE, permissions },
    added,
    removed,
  };
}
