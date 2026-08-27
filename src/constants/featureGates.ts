/**
 * Temporary product-availability gates.
 *
 * These are NOT entitlement. Entitlement answers "what is this user allowed to
 * do"; a gate here answers "is this part of the product open right now", for
 * everyone, regardless of plan. Keeping the two apart matters: a blocked
 * subscription section must never make a paying Ultra user look Free.
 *
 * DELIBERATELY A PLAIN CONSTANT. One boolean read at render time, with no
 * runtime configuration, no environment variable and no flag service behind it,
 * because the whole point is that removing the gate is a one-line change that
 * restores the original experience with nothing left behind.
 */

/**
 * Blocks the subscription/billing SECTION in the account page.
 *
 * Presentation only. Stripe, the billing API, checkout, the customer portal and
 * every entitlement rule stay exactly as they are — this hides the way in, it
 * does not disable the machinery. Set to `false` and the original card returns
 * unchanged.
 */
export const SUBSCRIPTIONS_TEMPORARILY_DISABLED = true;
