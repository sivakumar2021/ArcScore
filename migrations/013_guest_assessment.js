// Migration 013: add guest assessment support.
// Allows unauthenticated visitors to start and answer all assessment questions,
// then link to an account (or create one) at completion time.
module.exports = {
  name: '013_guest_assessment',
  up: async (client) => {
    await client.query(`
      ALTER TABLE assessments
        ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT FALSE
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE assessments
        DROP COLUMN IF EXISTS guest_email,
        DROP COLUMN IF EXISTS is_guest
    `);
  }
};