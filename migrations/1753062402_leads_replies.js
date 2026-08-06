'use strict';

module.exports = {
  name: '1753062402_leads_replies',
  up: async (client) => {
    await client.query(`
      ALTER TABLE ref_leads
        ADD COLUMN IF NOT EXISTS reply_count        INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_reply_at      TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_reply_subject TEXT,
        ADD COLUMN IF NOT EXISTS last_reply_body    TEXT
    `);
  },
  down: async (client) => {
    await client.query(`
      ALTER TABLE ref_leads
        DROP COLUMN IF EXISTS last_reply_body,
        DROP COLUMN IF EXISTS last_reply_subject,
        DROP COLUMN IF EXISTS last_reply_at,
        DROP COLUMN IF EXISTS reply_count
    `);
  },
};
