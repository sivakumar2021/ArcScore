// Migration 011: add email drip sequence tracking to users.
// Tracks which step of the post-assessment 7-day drip sequence each user
// has received. Step 0 = Day 0 results recap, Step 1 = Day 3 growth tip,
// Step 2 = Day 7 retake prompt.
module.exports = {
  name: '011_email_drip',
  up: async (client) => {
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS drip_assessment_id INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS drip_step INTEGER DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS drip_step0_sent_at TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS drip_step1_sent_at TIMESTAMPTZ DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS drip_step2_sent_at TIMESTAMPTZ DEFAULT NULL
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS drip_assessment_id,
        DROP COLUMN IF EXISTS drip_step,
        DROP COLUMN IF EXISTS drip_step0_sent_at,
        DROP COLUMN IF EXISTS drip_step1_sent_at,
        DROP COLUMN IF EXISTS drip_step2_sent_at
    `);
  }
};
