// Migration 010: add subscription tracking to users.
// subscription_tier stores the active plan slug; subscription_stripe_session_id links
// to the Stripe checkout session that activated the subscription.
module.exports = {
  name: '010_subscription_tier',
  up: async (client) => {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(32) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS subscription_stripe_session_id VARCHAR(128) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS subscription_activated_at TIMESTAMPTZ DEFAULT NULL
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS subscription_tier,
        DROP COLUMN IF EXISTS subscription_stripe_session_id,
        DROP COLUMN IF EXISTS subscription_activated_at
    `);
  }
};
