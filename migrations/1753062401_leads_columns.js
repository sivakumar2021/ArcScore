'use strict';

module.exports = {
  name: '1753062401_leads_columns',
  up: async (client) => {
    await client.query(`
      ALTER TABLE ref_leads
        ADD COLUMN IF NOT EXISTS ref_code VARCHAR(64),
        ADD COLUMN IF NOT EXISTS source VARCHAR(64) NOT NULL DEFAULT 'interstitial',
        ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    // Backfill ref_code from the legacy `ref` column so the admin endpoint and the
    // new POST /api/leads writes can read ref_code without ambiguity.
    await client.query(`UPDATE ref_leads SET ref_code = ref WHERE ref_code IS NULL`);

    // Backfill first_seen_at from created_at for rows pre-dating the column;
    // DEFAULT NOW() handles rows inserted after the ALTER.
    await client.query(`UPDATE ref_leads SET first_seen_at = created_at WHERE first_seen_at IS NULL`);

    // Dedupe on lowercased email before creating the unique index — the route
    // writes LOWER(email), so any mixed-case duplicates must collapse first.
    await client.query(`DELETE FROM ref_leads a USING ref_leads b WHERE a.id > b.id AND LOWER(a.email) = LOWER(b.email)`);

    // Promote lowercase-only writes to a strict uniqueness guarantee so the route
    // can rely on 23505 unique_violation, not a SELECT-then-INSERT round-trip.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ref_leads_email_unique ON ref_leads (email)`);
  },
  down: async (client) => {
    await client.query(`DROP INDEX IF EXISTS idx_ref_leads_email_unique`);
    await client.query(`
      ALTER TABLE ref_leads
        DROP COLUMN IF EXISTS first_seen_at,
        DROP COLUMN IF EXISTS source,
        DROP COLUMN IF EXISTS ref_code
    `);
  },
};
