/*
 * COMPILE-TIME ONLY. Not a test file - it imports modules that only resolve inside a Worker - so
 * it is named to stay out of the test glob and in tsconfig's include, where `npm run check`
 * type-checks it. It is the scaffold's src/worker.ts, verbatim: the first fresh site to run
 * `astro check` found the consumer's batch type did not fit the handler slot, and nothing in the
 * package itself had ever written this line down.
 */
import { defineWorker } from './worker.ts';
import { formQueue } from './includes/cloudflare/queues/consumer.ts';

export default defineWorker({ queue: formQueue() });

/* And the shape a site with a cron adds to it. */
export const withCron = defineWorker({
  queue: formQueue({ 'crm.add': async () => {} }),
  scheduled: (_controller, _env, ctx) => ctx.waitUntil(Promise.resolve()),
});
