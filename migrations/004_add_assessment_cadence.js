module.exports = {
  name: 'add_assessment_cadence',
  up: async (client) => {
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS assessment_cadence_days INTEGER NOT NULL DEFAULT 30
    `);
  },
};
