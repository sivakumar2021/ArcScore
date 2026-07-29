// db/subscriptions.js — owns subscription_tier reads/writes on the users table.
// Does NOT own auth, assessment logic, or Stripe checkout sessions.
const pool = require('./index');

const PLAN_NAMES = {
  'i-got-it':            'I Got It',
  'i-need-guidance':     'I Need Guidance',
  'i-need-help':         'I Need Help',
  'i-need-focused-help': 'I Need Focused Help',
};

const VALID_TIERS = Object.keys(PLAN_NAMES);

/**
 * Get subscription info for a user.
 * Returns { subscription_tier, subscribed_at } or { subscription_tier: null }.
 */
async function getSubscription(userId) {
  const result = await pool.query(
    'SELECT subscription_tier, subscribed_at FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) return { subscription_tier: null, subscribed_at: null };
  return result.rows[0];
}

/**
 * Set subscription tier on a user after a verified Stripe checkout.
 * Idempotent: safe to call multiple times with the same session_id.
 */
async function setSubscription(userId, tier, stripeSessionId) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}`);
  }
  await pool.query(
    `UPDATE users
     SET subscription_tier = $1,
         subscribed_at      = COALESCE(subscribed_at, NOW()),
         stripe_session_id  = $2
     WHERE id = $3`,
    [tier, stripeSessionId, userId]
  );
}

/**
 * Find a user by email — used when Stripe returns customer_email on success.
 */
async function getUserByEmail(email) {
  const result = await pool.query(
    'SELECT id, email, name, subscription_tier FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Set subscription by email (for post-checkout redirect when user may not be logged in yet).
 */
async function setSubscriptionByEmail(email, tier, stripeSessionId) {
  if (!VALID_TIERS.includes(tier)) {
    throw new Error(`Invalid tier: ${tier}`);
  }
  const result = await pool.query(
    `UPDATE users
     SET subscription_tier = $1,
         subscribed_at      = COALESCE(subscribed_at, NOW()),
         stripe_session_id  = $2
     WHERE LOWER(email) = LOWER($3)
     RETURNING id, email, name`,
    [tier, stripeSessionId, email]
  );
  return result.rows[0] || null;
}

module.exports = { getSubscription, setSubscription, getUserByEmail, setSubscriptionByEmail, PLAN_NAMES, VALID_TIERS };
