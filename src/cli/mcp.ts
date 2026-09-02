/*
 * The documentation servers every WebMonterey repo talks to, and the one list that says so.
 *
 * WHY THIS IS A MODULE AND NOT A LITERAL IN THE SCAFFOLD. Four places have to agree about these
 * servers: the scaffold writes them into a new site, the codemod adds them to an existing one,
 * `webm doctor` checks a site still has them, and the package's own .mcp.json declares them for
 * this repo. Four literals is four chances to add a server in three places and spend an afternoon
 * on why one repo answers from training data.
 *
 * WHAT THEY ARE FOR. Astro ships majors faster than any model's corpus turns over, and the web
 * platform ships behavior continuously - baseline support, a new API, a deprecation. Both
 * servers exist so a session can read what is true today rather than recalling what was true at
 * a training cutoff. Neither of them enforces anything on their own: they are a reference. What
 * makes a session USE them is the rule in CLAUDE.md, and what makes a repo keep them wired is
 * the `mcp-docs` check in doctor.
 */

export interface McpServer {
  type: 'http';
  url: string;
  /** Said in the file, so the next person reading .mcp.json knows what it is for. */
  purpose: string;
}

export const MCP_SERVERS: Record<string, McpServer> = {
  /*
   * Astro's own, from docs.astro.build/en/guides/build-with-ai. Free, open source, and the
   * documented way to give a tool current Astro knowledge.
   */
  'astro-docs': {
    type: 'http',
    url: 'https://mcp.docs.astro.build/mcp',
    purpose: 'Current Astro documentation. Consult before using any Astro API.',
  },
  /*
   * Mozilla's, from developer.mozilla.org/en-US/mcp. Search, reference and - the part no model
   * has current - browser compatibility data.
   *
   * EXPERIMENTAL, AND MOZILLA SAYS SO: it may be withdrawn at any time, and queries are logged
   * while the experiment runs. It is a docs lookup, so nothing confidential should reach it in
   * the first place; the rule in CLAUDE.md is what keeps it that way. If it disappears, the
   * failure is a session that cannot reach it, not a build that breaks.
   */
  mdn: {
    type: 'http',
    url: 'https://mcp.mdn.mozilla.net/',
    purpose: 'MDN reference and browser-compat data. Consult before using a web platform API.',
  },
  /*
   * The Website Specification and The Email Specification - Joost de Valk and contributors,
   * MIT/CC BY. Search, per-topic pages and, the useful part here, generated checklists across
   * SEO, accessibility, performance, privacy, security and i18n.
   *
   * GUIDANCE, NOT A STANDARD, WHATEVER THE NAME SAYS. These are opinionated best-practice
   * documents, not normative specs, and they are at 0.2.0 and 0.1.0. They must never outrank MDN
   * or the Astro docs on what an API does; they answer a different question - what a good site or
   * a good email does. CLAUDE.md states that precedence, because a server called
   * "specification" invites exactly the wrong assumption.
   */
  'website-spec': {
    type: 'http',
    url: 'https://mcp.specification.website/mcp',
    purpose: 'Site-quality guidance: SEO, accessibility, performance, privacy, security, i18n.',
  },
  /*
   * Email is a SEPARATE server from the website one - the Website Specification excludes it by
   * design. It earns its place because src/emails/ is where recall is worst: client rendering
   * quirks and deliverability rules move, and a template that looks right in a browser is not
   * evidence of anything.
   */
  'email-spec': {
    type: 'http',
    url: 'https://mcp.specification.email/mcp',
    purpose: 'Email guidance: rendering, deliverability, accessibility. For src/emails/ work.',
  },
};

/** The server names, in the order they should appear everywhere. */
export const MCP_NAMES: string[] = Object.keys(MCP_SERVERS);

/** The `.mcp.json` body. `purpose` is dropped - it documents this file, not the protocol. */
export function mcpConfig(): { mcpServers: Record<string, { type: string; url: string }> } {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(MCP_SERVERS).map(([name, s]) => [name, { type: s.type, url: s.url }]),
    ),
  };
}

/**
 * What a repo is missing, given what it declares and what it pre-approves.
 *
 * TWO LISTS, BECAUSE A SERVER CAN BE WIRED AND STILL INERT. A server in .mcp.json that is not in
 * `enabledMcpjsonServers` prompts for approval on every machine, and a rule that depends on
 * whoever cloned the repo happening to hit Approve is not a rule. That is the failure this
 * separates out rather than folding into one boolean.
 */
export function mcpGaps(
  declared: Record<string, { url?: string }> | null | undefined,
  enabled: string[] | null | undefined,
): { undeclared: string[]; unapproved: string[]; wrongUrl: string[] } {
  const d = declared ?? {};
  const e = new Set(enabled ?? []);
  const undeclared = MCP_NAMES.filter((n) => !(n in d));
  return {
    undeclared,
    unapproved: MCP_NAMES.filter((n) => n in d && !e.has(n)),
    wrongUrl: MCP_NAMES.filter((n) => n in d && d[n]?.url !== MCP_SERVERS[n].url),
  };
}
