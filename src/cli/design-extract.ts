/*
 * `webm design:extract` - turn a hand-edited tokens.css into design.json.
 *
 * Run once per site during a rebuild. Reads the stylesheet, diffs every declaration against the
 * default token set, and writes only what differs - mapped to a structured field where one
 * exists, and to `overrides` where none does.
 *
 * It REPORTS what it could not map rather than dropping it. A token silently lost here becomes a
 * color that quietly reverts on a site someone already signed off, which is the failure this
 * command exists to prevent.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DEFAULTS } from '../design/defaults.ts';
import { MAPPING } from '../design/compile.ts';
import type { DesignSystem } from '../design/types.ts';

const DEFAULT_VALUES = new Map(DEFAULTS.flatMap((g) => g.tokens.map((t) => [t.name, t.value])));
const REVERSE = new Map(MAPPING.map(([path, token]) => [token, path]));

export interface ParsedTokens {
  /** Declarations at the top level, outside every at-rule. The site's actual token values. */
  base: Map<string, string>;
  /**
   * Declarations nested inside an at-rule, keyed by token, with the at-rule preludes they came
   * from. These CANNOT be represented in design.json - it compiles a flat :root block - so they
   * are reported and left in the stylesheet rather than folded into the base values.
   */
  conditional: Map<string, string[]>;
}

/**
 * Pull `--webm-x: value;` pairs out of a stylesheet, SEPARATING at-rule-scoped ones.
 *
 * THE BUG THIS REPLACES was a flat regex over the whole file, last-write-wins. tokens.css sets
 * a token in :root and then overrides it inside `@media (prefers-reduced-motion: reduce)`, so
 * the media value overwrote the real one and became the site's base. Converting webmonterey.com
 * that way wrote `--webm-duration-fast: 0ms` as its base: every animation on the site disabled
 * for every visitor, from a migration that reported success.
 *
 * Worse, it was invisible to the obvious check. Comparing parseTokens(original) against
 * parseTokens(compiled) matched 238 of 238 - both sides ran the same broken parser, so the
 * comparison only proved it was consistently wrong.
 *
 * Brace counting rather than a CSS parser: this reads one hand-written file with a known shape,
 * and a dependency for it would be the larger risk.
 */
export function parseTokens(css: string): ParsedTokens {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const base = new Map<string, string>();
  const conditional = new Map<string, string[]>();

  /*
   * ONLY CONDITIONAL AT-RULES COUNT. `@layer webm.tokens { :root { ... } }` is how every one of
   * these stylesheets is written, and a layer does not make a declaration conditional - it only
   * places it in the cascade. Treating every at-rule as conditional put the entire file inside
   * one, so nothing was a base value and the whole extraction came back empty.
   *
   * @media, @supports and @container apply their contents only when the condition holds. Those
   * are the ones design.json cannot express.
   */
  const CONDITIONAL = /^@(media|supports|container)\b/;

  /* The conditional at-rule preludes currently open. */
  const atRules: string[] = [];
  /* Brace depth at which each open at-rule started, so it can be popped on the matching close. */
  const atRuleDepth: number[] = [];
  let depth = 0;
  let buffer = '';

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;

    if (char === '{') {
      const prelude = buffer.trim();
      if (CONDITIONAL.test(prelude)) {
        atRules.push(prelude);
        atRuleDepth.push(depth);
      }
      depth++;
      buffer = '';
      continue;
    }

    if (char === '}') {
      depth--;
      if (atRuleDepth.length && atRuleDepth.at(-1) === depth) {
        atRules.pop();
        atRuleDepth.pop();
      }
      buffer = '';
      continue;
    }

    if (char === ';') {
      const declaration = buffer.trim();
      const match = /^(--webm-[\w-]+)\s*:\s*([\s\S]+)$/.exec(declaration);
      if (match) {
        const [, name, value] = match as unknown as [string, string, string];
        if (atRules.length === 0) {
          base.set(name, value.trim());
        } else {
          conditional.set(name, [...(conditional.get(name) ?? []), atRules.join(' / ')]);
        }
      }
      buffer = '';
      continue;
    }

    buffer += char;
  }

  return { base, conditional };
}

function setPath(target: Record<string, unknown>, path: readonly string[], value: string): void {
  let node = target;
  for (const key of path.slice(0, -1)) {
    node[key] ??= {};
    node = node[key] as Record<string, unknown>;
  }
  node[path.at(-1)!] = value;
}

export interface ExtractResult {
  design: DesignSystem;
  mapped: string[];
  overridden: string[];
  added: string[];
  unchanged: number;
  /**
   * Tokens the stylesheet also sets inside an at-rule, with the preludes. design.json compiles a
   * flat :root block and cannot express these, so they stay in the site's own CSS - and the
   * command has to SAY so, because a silently dropped media override is a site that stops
   * responding to reduced-motion or to a breakpoint with nothing to show for it.
   */
  conditional: Map<string, string[]>;
}

export function extract(css: string): ExtractResult {
  const { base: found, conditional } = parseTokens(css);
  const design: DesignSystem = { version: 1 };
  const mapped: string[] = [];
  const overridden: string[] = [];
  const added: string[] = [];
  let unchanged = 0;

  for (const [name, value] of found) {
    const isKnown = DEFAULT_VALUES.has(name);
    if (isKnown && DEFAULT_VALUES.get(name) === value) {
      unchanged++;
      continue;
    }
    const path = REVERSE.get(name);
    if (path) {
      setPath(design as Record<string, unknown>, path, value);
      mapped.push(name);
    } else {
      design.overrides ??= {};
      design.overrides[name] = value;
      (isKnown ? overridden : added).push(name);
    }
  }

  return { design, mapped, overridden, added, unchanged, conditional };
}

export function run(argv: string[]): number {
  const input = argv[0] ?? 'src/styles/tokens.css';
  const output = argv[1] ?? 'design.json';

  if (!existsSync(input)) {
    console.error(`webm design:extract: no such file: ${input}`);
    console.error(`  usage: webm design:extract [tokens.css] [design.json]`);
    return 1;
  }
  if (existsSync(output)) {
    console.error(`webm design:extract: ${output} already exists. Move it aside first.`);
    return 1;
  }

  const result = extract(readFileSync(input, 'utf8'));
  const json = JSON.stringify(
    { $schema: './node_modules/@cparkerwebm/webmonterey/schema/design.json', ...result.design },
    null,
    2,
  );
  writeFileSync(output, json + '\n');

  console.log(`Read ${input}`);
  console.log(`  ${result.unchanged} tokens match the defaults and were omitted`);
  if (result.mapped.length) {
    console.log(`  ${result.mapped.length} mapped to structured fields:`);
    for (const n of result.mapped) console.log(`      ${n}`);
  }
  if (result.overridden.length) {
    console.log(`  ${result.overridden.length} kept as overrides (no structured field exists):`);
    for (const n of result.overridden) console.log(`      ${n}`);
  }
  if (result.added.length) {
    console.log(`  ${result.added.length} are site tokens, not part of the default set:`);
    for (const n of result.added) console.log(`      ${n}`);
  }
  console.log(`\nWrote ${output}`);

  /*
   * THE PART THAT MUST NOT BE QUIET. design.json compiles one flat :root block, so a token the
   * stylesheet also sets inside @media cannot be carried across. Folding those values into the
   * base is what the old parser did, and it wrote a reduced-motion 0ms as webmonterey.com's real
   * animation duration - every animation off, for every visitor, reported as a success.
   */
  if (result.conditional.size) {
    console.log(
      `\n${result.conditional.size} tokens are ALSO set inside an at-rule. design.json holds one\n` +
        `flat :root block, so those conditional values are NOT in it and must stay in CSS:\n`,
    );
    for (const [name, rules] of result.conditional) {
      console.log(`      ${name}   ${[...new Set(rules)].join(', ')}`);
    }
    console.log(
      `\n  Move those blocks to src/styles/custom/_index.css. Leaving them behind silently\n` +
        `  drops reduced-motion handling and every responsive token override.`,
    );
  }

  console.log(
    `\nNext: delete ${input}, and check the compiled output matches what the site rendered before.`,
  );
  return 0;
}
