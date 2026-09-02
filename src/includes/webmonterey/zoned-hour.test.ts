/*
 * The hour-in-zone primitive that every scheduled job depends on.
 *
 * Cron runs in UTC with no timezone setting anywhere in Cloudflare, so a job that must land at a
 * local hour fires hourly and asks this function whether it is time. Get this wrong and the job
 * runs at the wrong hour for half the year, or never runs at all - and neither reports anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedHour, DEFAULT_TIME_ZONE } from './config.ts';

test('Pacific is UTC-8 in winter', () => {
  // 2026-01-15T18:00Z is 10:00 PST.
  assert.equal(zonedHour(new Date('2026-01-15T18:00:00Z'), 'America/Los_Angeles'), 10);
});

test('Pacific is UTC-7 in summer, so a fixed UTC hour would drift', () => {
  /*
   * The whole reason this exists. The SAME UTC instant is 10:00 in winter and 11:00 in summer, so
   * an evening job pinned to a UTC hour goes out at 8pm for half the year and 9pm for the other.
   */
  assert.equal(zonedHour(new Date('2026-07-15T18:00:00Z'), 'America/Los_Angeles'), 11);
});

test('midnight is 0, never 24', () => {
  /*
   * hourCycle: 'h23' is what makes this true. The obvious `hour12: false` renders midnight as 24
   * in several implementations - a job scheduled for hour 0 then never fires, and one testing
   * `hour < 1` fires twice. Wrong for a year before anyone notices.
   */
  assert.equal(zonedHour(new Date('2026-01-15T08:00:00Z'), 'America/Los_Angeles'), 0);
  assert.equal(zonedHour(new Date('2026-07-15T07:00:00Z'), 'America/Los_Angeles'), 0);
});

test('the day rolls over at the right moment, not at UTC midnight', () => {
  // 2026-03-02T07:59Z is 23:59 on the 1st in Pacific; one minute later it is midnight on the 2nd.
  assert.equal(zonedHour(new Date('2026-03-02T07:59:00Z'), 'America/Los_Angeles'), 23);
  assert.equal(zonedHour(new Date('2026-03-02T08:00:00Z'), 'America/Los_Angeles'), 0);
});

test('the fleet default is Pacific, which is the whole target region', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'America/Los_Angeles');
  assert.equal(zonedHour(new Date('2026-01-15T18:00:00Z'), DEFAULT_TIME_ZONE), 10);
});

test('another zone can be asked for explicitly', () => {
  assert.equal(zonedHour(new Date('2026-01-15T18:00:00Z'), 'UTC'), 18);
  assert.equal(zonedHour(new Date('2026-01-15T18:00:00Z'), 'America/New_York'), 13);
});
