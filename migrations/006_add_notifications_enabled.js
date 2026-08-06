module.exports = {
  name: 'add_notifications_enabled',
  up: async (client) => {
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS notifications_enabled
    `);
  },
};
