import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MCP_NAMES, MCP_SERVERS, mcpConfig, mcpGaps } from './mcp.ts';

const repo = new URL('../../', import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, repo), 'utf8'));

test('every server is http and has an absolute https url', () => {
  for (const [name, s] of Object.entries(MCP_SERVERS)) {
    assert.equal(s.type, 'http', name);
    assert.ok(s.url.startsWith('https://'), `${name} is not https`);
    assert.ok(s.purpose.length > 0, `${name} has no stated purpose`);
  }
});

test('mcpConfig drops purpose - it documents our file, not the protocol', () => {
  const entry = mcpConfig().mcpServers['astro-docs'];
  assert.deepEqual(Object.keys(entry).sort(), ['type', 'url']);
});

/*
 * THE POINT OF THE MODULE. Four places have to agree about these servers, and two of them are
 * checked-in files in this repo rather than code, so nothing but a test can notice them drifting.
 * Adding a server to mcp.ts and forgetting the repo's own .mcp.json is the exact mistake that
 * leaves the framework being written from recall while every client site reads current docs.
 */
test("the package's own .mcp.json is what mcp.ts says it should be", () => {
  assert.deepEqual(readJson('.mcp.json'), mcpConfig());
});

test("the package's own settings pre-approve every server, in order", () => {
  assert.deepEqual(readJson('.claude/settings.json').enabledMcpjsonServers, MCP_NAMES);
});

test('a fully wired repo has no gaps', () => {
  assert.deepEqual(mcpGaps(mcpConfig().mcpServers, MCP_NAMES), {
    undeclared: [],
    unapproved: [],
    wrongUrl: [],
  });
});

test('gaps separate not-declared from declared-but-inert, because the fixes differ', () => {
  const gaps = mcpGaps({ 'astro-docs': { url: MCP_SERVERS['astro-docs'].url } }, []);
  assert.deepEqual(gaps.undeclared, ['mdn', 'website-spec', 'email-spec']);
  assert.deepEqual(gaps.unapproved, ['astro-docs']);
});

test('a server pointed somewhere else is a gap even when declared and approved', () => {
  const gaps = mcpGaps({ ...mcpConfig().mcpServers, mdn: { url: 'https://evil.test' } }, MCP_NAMES);
  assert.deepEqual(gaps.wrongUrl, ['mdn']);
});

test('nothing at all is reported as everything undeclared rather than throwing', () => {
  assert.deepEqual(mcpGaps(null, null).undeclared, MCP_NAMES);
});
