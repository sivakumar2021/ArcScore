'use strict';

module.exports = {
  name: '1753062400_ref_leads',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ref_leads (
        id         BIGSERIAL PRIMARY KEY,
        ref        VARCHAR(64) NOT NULL,
        email      VARCHAR(255) NOT NULL,
        user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ref_leads_ref ON ref_leads (ref)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_ref_leads_email_lower ON ref_leads (LOWER(email))`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS ref_leads`);
  },
};
