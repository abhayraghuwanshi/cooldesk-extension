/**
 * Engagement scoring for a tracked destination.
 *
 * There is ONE weighting formula here, exposed on two scales, because the two
 * callers genuinely need different ones and previously each kept a private copy
 * of the weights under the same function name:
 *
 *   - `rawEngagementScore`        unbounded — persisted onto tab sessions, so
 *                                 its scale is part of stored data
 *   - `normalizedEngagementScore` 0–100 — mixed into a weighted composite
 *                                 alongside recency/frequency/session-quality,
 *                                 which only means anything on a shared scale
 *
 * Changing a weight now changes both together, which is the point. If you need
 * a third scale, add another wrapper rather than a second copy of the weights.
 *
 * Unrelated: `content-scripts/activity-tracker.js` measures *page* engagement
 * from the DOM (visible time, scroll depth, keypresses) on a different input
 * shape entirely. It is not this, and must not be folded in here.
 */

/** Relative worth of each signal. Forms are the strongest intent signal. */
export const ENGAGEMENT_WEIGHTS = {
  forms: 100,          // form submissions — high-value interactions
  clicks: 10,          // clicks show active engagement
  scroll: 0.5,         // scrolling shows content consumption
  timePerSecond: 0.1,  // dwell time carries the least weight
};

/** Score at which `normalizedEngagementScore` saturates at 100. */
export const ENGAGEMENT_SATURATION = 1000;

/**
 * The shared weighted sum, unrounded. Internal on purpose: callers should pick
 * one of the two scales below so the rounding/clamping stays consistent.
 */
function weightedEngagement(activity) {
  const time = Number(activity?.time) || 0;
  const clicks = Number(activity?.clicks) || 0;
  const scroll = Number(activity?.scroll) || 0;
  const forms = Number(activity?.forms) || 0;

  return (
    forms * ENGAGEMENT_WEIGHTS.forms +
    clicks * ENGAGEMENT_WEIGHTS.clicks +
    scroll * ENGAGEMENT_WEIGHTS.scroll +
    (time / 1000) * ENGAGEMENT_WEIGHTS.timePerSecond
  );
}

/**
 * Unbounded weighted score, rounded to 2dp.
 *
 * This is the value stored on tab sessions — treat its scale as a persisted
 * format and don't rescale it without migrating existing records.
 */
export function rawEngagementScore(activity) {
  return Math.round(weightedEngagement(activity) * 100) / 100;
}

/**
 * The same score mapped onto 0–100, saturating at `ENGAGEMENT_SATURATION`.
 * Use this whenever the result is averaged with other 0–100 component scores.
 */
export function normalizedEngagementScore(activity) {
  return Math.min(100, (weightedEngagement(activity) / ENGAGEMENT_SATURATION) * 100);
}
