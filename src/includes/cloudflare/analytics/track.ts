/*
 * Write one event to the site's Analytics Engine dataset. Fire-and-forget, and FAIL-OPEN: this
 * never throws into a page or a form. A site with the feature off, or no binding, or a binding
 * that misbehaves, records nothing and carries on.
 *
 *     track({ event: 'form.stored', host: context.url.hostname, form: formId });
 *
 * The column contract and the privacy rules are in datapoint.ts, which is where they are tested.
 * `writeDataPoint` returns synchronously and the runtime writes in the background, so there is
 * nothing to await and nothing to put in waitUntil.
 */
import { features } from '../../webmonterey/site.ts';
import { hasBinding, getBinding } from '../workers/env.ts';
import { ANALYTICS_BINDING, dataPoint, type EventInput } from './datapoint.ts';

export {
  ANALYTICS_BINDING,
  dataPoint,
  parseBeacon,
  type AnalyticsEvent,
  type EventInput,
} from './datapoint.ts';

export function track(input: EventInput): void {
  if (!features?.analytics || !hasBinding(ANALYTICS_BINDING)) return;
  try {
    getBinding<AnalyticsEngineDataset>(ANALYTICS_BINDING).writeDataPoint(dataPoint(input));
  } catch (error) {
    console.warn('[webm] Analytics write failed and was dropped:', error);
  }
}

/** Whether a page view beacon should be written on this deployment. */
export function analyticsOn(): boolean {
  return Boolean(features?.analytics) && hasBinding(ANALYTICS_BINDING);
}
