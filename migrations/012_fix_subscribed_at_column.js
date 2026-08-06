// Migration 012: add subscribed_at column (alias for subscription_activated_at).
// The app code uses subscribed_at; the original migration only added subscription_activated_at.
module.exports = {
  name: '012_fix_subscribed_at_column',
  up: async (client) => {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ DEFAULT NULL
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS subscribed_at
    `);
  }
};