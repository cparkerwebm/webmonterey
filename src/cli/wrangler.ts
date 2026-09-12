/*
 * Running the site's own wrangler, for the commands that have to leave the machine.
 *
 * Resolved from the site upward, the way `npx` would find it, never downloaded: a command that
 * installs things to do its job is a surprise. Every way a call can go unanswered - no wrangler,
 * not logged in, no network - comes back as a reason, so the caller can say what to do rather
 * than fail the whole command over something a person fixes in a minute.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

export interface WranglerResult {
  ok: boolean;
  /** stdout and stderr together, colour stripped. */
  output: string;
}

export type WranglerRunner = (args: string[]) => WranglerResult;

/** The site's wrangler binary, or null when it is not installed there. */
export function resolveWrangler(siteRoot: string): string | null {
  try {
    const require = createRequire(join(resolve(siteRoot), 'package.json'));
    return join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
  } catch {
    return null;
  }
}

export function wranglerRunner(siteRoot: string, bin: string): WranglerRunner {
  return (args) => {
    try {
      const output = execFileSync(process.execPath, [bin, ...args], {
        cwd: siteRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60_000,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
      });
      return { ok: true, output: strip(output) };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        output: strip(`${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`),
      };
    }
  };
}

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

/** Wrangler's own words for "you are not logged in", in the forms the doctor has seen. */
export function isLoginProblem(output: string): boolean {
  return /CLOUDFLARE_API_TOKEN|not (logged in|authenticated)|Authentication error|code: (10000|6111|9109)\]/i.test(
    output,
  );
}
