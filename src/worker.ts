/*
 * The building block for a site that needs a Cron Trigger.
 *
 * WHY A SITE WOULD REPLACE THE GENERATED ENTRYPOINT AT ALL. The adapter normally writes the
 * Worker entrypoint itself, and that generated file exports `fetch` and nothing else. A Cron
 * Trigger needs `scheduled()`, and there is no room for one in a file the adapter owns.
 *
 * Pointing wrangler's `main` at a SOURCE file that re-exports the adapter's handler is the
 * documented path, and it is the one legitimate reason to set that key. The trap it replaces is
 * silent: `triggers.crons` on its own merges into the generated config and deploys without a
 * warning, and Cloudflare then invokes a handler that does not exist, on schedule, forever.
 * `webm doctor` fails on that.
 *
 * A site uses this by writing its own src/worker.ts:
 *
 *     import { defineWorker } from '@cparkerwebm/webmonterey/worker';
 *     import { runSweep } from './includes/sweep.ts';
 *
 *     export default defineWorker({
 *       scheduled: (controller, env, ctx) => ctx.waitUntil(runSweep(env)),
 *     });
 *
 * and setting `"main": "./src/worker.ts"` in wrangler.jsonc.
 *
 * CRON RUNS IN UTC, ALWAYS, with no timezone setting anywhere in Cloudflare. A job that has to
 * land at a local hour should fire hourly and let the handler check the clock in the site's own
 * time zone - pinning it to a fixed UTC hour drifts by one twice a year. The other 23 runs cost
 * a comparison and return.
 */
import { handle } from '@astrojs/cloudflare/handler';

/*
 * `env` IS THE SITE'S OWN `Env`, NOT `unknown`.
 *
 * `wrangler types` generates `interface Env` into each site's worker-configuration.d.ts, listing
 * that site's bindings. The package cannot know them, but it does not need to: the empty
 * interface below MERGES with the generated one, so inside a client repo `env.DB` is typed and
 * a handler can hand it to anything expecting `Env`.
 *
 * It was `unknown` before, which meant every scheduled handler that passed env to a typed
 * function failed to compile - and the site's own workaround for that would have been a cast,
 * which is exactly the thing the generated types exist to avoid. In a repo with no generated
 * types this stays an empty object, which is honest rather than wrong.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Env {}
}

/** What a site supplies. `fetch` is deliberately absent - see below. */
export interface WorkerHandlers {
  scheduled?: (
    controller: { scheduledTime: number; cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) => void | Promise<void>;
  queue?: (batch: unknown, env: Env, ctx: unknown) => void | Promise<void>;
}

/**
 * Build a Worker entrypoint: the adapter's own `fetch`, plus whatever else the site needs.
 *
 * `fetch` IS NOT OVERRIDABLE ON PURPOSE. Every page, action, API route and server island on the
 * site arrives through it, so anything added there runs on all of them - and a site that meant to
 * add a cron and accidentally replaced the request path takes the whole site down while the cron
 * works perfectly. Site-wide request logic belongs in Astro middleware, which is scoped and
 * testable; this stays a thin pass-through.
 */
export function defineWorker(handlers: WorkerHandlers = {}) {
  return {
    fetch(request: Request, env: unknown, ctx: unknown): Response | Promise<Response> {
      return handle(request as never, env as never, ctx as never);
    },
    ...handlers,
  };
}
