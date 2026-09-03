import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync } from './sync.ts';
import { DENY_RULES, STALE_RULES } from './settings.ts';

const site = () => mkdtempSync(join(tmpdir(), 'webm-sync-'));

test('materializes a skills-directory plugin at .claude/skills/webm/', () => {
  const root = site();
  sync(root);
  const target = join(root, '.claude/skills/webm');
  assert.ok(existsSync(join(target, '.claude-plugin/plugin.json')));
  const manifest = JSON.parse(readFileSync(join(target, '.claude-plugin/plugin.json'), 'utf8'));
  // The folder name IS the namespace - this is what makes skills /webm:go-live.
  assert.equal(manifest.name, 'webm');
});

test('writes a version marker the doctor reads', () => {
  const root = site();
  const result = sync(root);
  const marker = JSON.parse(
    readFileSync(join(root, '.claude/skills/webm/.webm-sync.json'), 'utf8'),
  );
  assert.equal(marker.version, result.version);
  assert.ok(marker.skills.includes('launch'));
});

test('the package ships exactly the skills the release claims', () => {
  const root = site();
  const result = sync(root);
  assert.deepEqual([...result.added].sort(), [
    'launch',
    'new-component',
    'start',
    'traps',
    'upgrade',
  ]);
});

test('agents/ and hooks/ ride along when the package ships any, and never as empty dirs', () => {
  // Empty in the package today. The mechanism is what is asserted: a .gitkeep is not an agent.
  const root = site();
  const result = sync(root);
  assert.deepEqual(result.agents, []);
  assert.deepEqual(result.hooks, []);
  assert.ok(!existsSync(join(root, '.claude/skills/webm/agents')), 'no empty agents/ in a site');
});

test('dotfiles are not copied - .DS_Store would otherwise reach every client repo', () => {
  const root = site();
  sync(root);
  const copied = readdirSync(join(root, '.claude/skills/webm/skills'));
  assert.deepEqual(
    copied.filter((f) => f.startsWith('.')),
    [],
  );
});

test('a full replace removes a skill that no longer ships', () => {
  const root = site();
  sync(root);
  // Simulate a skill that existed in an older version.
  mkdirSync(join(root, '.claude/skills/webm/skills/retired'), { recursive: true });
  writeFileSync(
    join(root, '.claude/skills/webm/skills/retired/SKILL.md'),
    '---\nname: retired\n---\n',
  );

  const second = sync(root);
  assert.ok(second.removed.includes('retired'), 'a deleted skill must disappear, not linger');
  assert.ok(!existsSync(join(root, '.claude/skills/webm/skills/retired')));
});

test('a client skill placed BESIDE the plugin survives a sync', () => {
  const root = site();
  mkdirSync(join(root, '.claude/skills/add-event'), { recursive: true });
  writeFileSync(join(root, '.claude/skills/add-event/SKILL.md'), '---\nname: add-event\n---\n');

  sync(root);
  // Siblings are untouched. Inside .claude/skills/webm/ they would be destroyed - which is why
  // the gitignore comment says client skills go beside it.
  assert.ok(existsSync(join(root, '.claude/skills/add-event/SKILL.md')));
});

test('scripts/ is REPLACED, because a fix to the Node guard must reach every site', () => {
  const dir = site();
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'check-node.mjs'), '// stale, from v1\n');
  const result = sync(dir);

  assert.ok(result.scripts.includes('check-node.mjs'), 'check-node.mjs is package-owned');
  assert.ok(result.scripts.includes('test-hooks.mjs'), 'test-hooks.mjs is package-owned');
  const written = readFileSync(join(dir, 'scripts', 'check-node.mjs'), 'utf8');
  assert.ok(!written.includes('stale, from v1'), 'the stale copy was overwritten');
  assert.match(written, /npm_config_user_agent/, 'the real guard landed');
});

test('a migration is copied when absent and NEVER rewritten once it exists', () => {
  /*
   * The one that would be a data bug rather than a cosmetic one. D1 records an applied
   * migration by filename; rewriting the file does not re-run it, so an "upgrade" that edits
   * 0001 changes local and leaves production on the old schema, with nothing to show for it.
   */
  const dir = site();
  const first = sync(dir);
  assert.ok(first.migrations.includes('0001_create_submissions.sql'), 'seeded on a fresh site');
  assert.match(
    readFileSync(join(dir, 'migrations', '0001_create_submissions.sql'), 'utf8'),
    /CREATE TABLE/,
  );

  const applied = '-- already applied to production, hands off\n';
  writeFileSync(join(dir, 'migrations', '0001_create_submissions.sql'), applied);
  const second = sync(dir);

  assert.deepEqual(second.migrations, [], 'nothing re-copied on the second sync');
  assert.equal(
    readFileSync(join(dir, 'migrations', '0001_create_submissions.sql'), 'utf8'),
    applied,
    'the applied migration is untouched',
  );
});

test('the migrations README rides along, so the --remote trap is documented in the repo', () => {
  const dir = site();
  sync(dir);
  assert.match(readFileSync(join(dir, 'migrations', 'README.md'), 'utf8'), /--remote/);
});

test('the package deny rules are MERGED into .claude/settings.json, never replacing it', () => {
  const dir = site();
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const path = join(dir, '.claude/settings.json');
  writeFileSync(
    path,
    JSON.stringify({
      '//': 'theirs',
      enabledMcpjsonServers: ['astro-docs'],
      permissions: {
        allow: ['Bash(npm run *)'],
        deny: ['Read(**/.env)', 'Write(**/.env)', 'Edit(/secrets/**)'],
      },
    }),
  );

  const first = sync(dir);
  const written = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(first.settings.added.includes('Edit(**/node_modules/**)'), 'rule 12 lands');
  assert.deepEqual(first.settings.removed, ['Write(**/.env)'], 'the rule Claude Code warns about');
  assert.equal(written['//'], 'theirs');
  assert.deepEqual(written.enabledMcpjsonServers, ['astro-docs'], 'not touched by this');
  assert.deepEqual(
    written.permissions.allow,
    ['Bash(npm run *)'],
    "the site's allow list survives",
  );
  assert.ok(written.permissions.deny.includes('Edit(/secrets/**)'), "the site's own deny survives");
  for (const rule of DENY_RULES) assert.ok(written.permissions.deny.includes(rule), rule);
  for (const rule of STALE_RULES) assert.ok(!written.permissions.deny.includes(rule), rule);
  assert.equal(
    written.permissions.deny.filter((r: string) => r === 'Read(**/.env)').length,
    1,
    'a rule already there is not doubled',
  );

  /* Idempotent: the second pass reports nothing and rewrites nothing. */
  const before = readFileSync(path, 'utf8');
  const second = sync(dir);
  assert.deepEqual(second.settings, { added: [], removed: [], created: false, skipped: null });
  assert.equal(readFileSync(path, 'utf8'), before);
});

test('a site with no settings file gets the scaffold defaults', () => {
  const dir = site();
  const result = sync(dir);
  assert.equal(result.settings.created, true);
  const written = JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(written.permissions.deny, [...DENY_RULES]);
});

test('a settings file that will not parse is left alone and reported', () => {
  const dir = site();
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude/settings.json'), '{ not json');
  const result = sync(dir);
  assert.ok(result.settings.skipped);
  assert.equal(readFileSync(join(dir, '.claude/settings.json'), 'utf8'), '{ not json');
});
