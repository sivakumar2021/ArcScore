module.exports = {
  name: '011_email_drip_tracking',
  up: async (client) => {
    // Add drip sequence state directly to users.
    // drip_assessment_id: the first completed assessment that anchors the drip cycle.
    // drip_step: highest step sent so far (0/1/2); NULL = not started.
    // drip_stepN_sent_at: when each step was dispatched; NULL = not yet sent.
    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS drip_assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS drip_step INTEGER,
        ADD COLUMN IF NOT EXISTS drip_step0_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS drip_step1_sent_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS drip_step2_sent_at TIMESTAMPTZ
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS users_drip_step0_idx ON users (drip_step0_sent_at)
        WHERE drip_step0_sent_at IS NOT NULL
    `);
  },
  down: async (client) => {
    await client.query(`DROP INDEX IF EXISTS users_drip_step0_idx`);
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
