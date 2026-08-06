module.exports = {
  name: '008_email_send_tracking',
  up: async (client) => {
    // Track when welcome and reminder emails were sent per user.
    // Null means not yet sent. Used to prevent double-sends.
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS reminder_email_sent_at TIMESTAMPTZ
    `);
  },
  down: async (client) => {
    await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS welcome_email_sent_at`);
    await client.query(`ALTER TABLE users DROP COLUMN IF EXISTS reminder_email_sent_at`);
  }
};
