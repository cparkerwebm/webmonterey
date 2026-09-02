/*
 * @cparkerwebm/webmonterey/design
 *
 * One input, four outputs. design.json compiles to:
 *
 *   CSS custom properties  -> the website and web app, via a Vite virtual module
 *   email-safe literals    -> transactional mail, where var() does not exist
 *   brand context          -> Cowork and the platform MCP server
 *   resolved palette       -> social graphics and client reports
 *
 * No Astro imports anywhere under this subpath. That is what keeps it testable with
 * `node --test` and usable from the platform without pulling a framework in to read a color.
 */
export { DEFAULTS, TOKEN_NAMES } from './defaults.ts';
export { compile, toCss, compileToCss, DesignError } from './compile.ts';
export { resolve, emailPalette, ResolveError } from './resolve.ts';
export { brandContext } from './brand.ts';
export type { DesignSystem, Token, TokenGroup, Color } from './types.ts';
