'use strict';

module.exports = {
  name: '1753062403_leads_reply_history',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_replies (
        id           BIGSERIAL PRIMARY KEY,
        lead_id      BIGINT NOT NULL REFERENCES ref_leads(id) ON DELETE CASCADE,
        subject      TEXT,
        body         TEXT,
        body_preview TEXT,
        sentiment    VARCHAR(32),
        source       VARCHAR(64) NOT NULL,
        received_at  TIMESTAMPTZ,
        status       VARCHAR(32) NOT NULL DEFAULT 'new'
          CHECK (status IN ('new','replied','archived','pipeline-start')),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_replies_lead_id
        ON lead_replies (lead_id, received_at DESC NULLS LAST)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_replies_status
        ON lead_replies (status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lead_replies_source
        ON lead_replies (source)
    `);
  },
  down: async (client) => {
    await client.query(`DROP INDEX IF EXISTS idx_lead_replies_source`);
    await client.query(`DROP INDEX IF EXISTS idx_lead_replies_status`);
    await client.query(`DROP INDEX IF EXISTS idx_lead_replies_lead_id`);
    await client.query(`DROP TABLE IF EXISTS lead_replies`);
  },
};
