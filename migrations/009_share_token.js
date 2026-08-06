// Migration 009: add share_token to assessments for viral sharing loop.
// share_token is a URL-safe random string generated on demand (not at creation time).
module.exports = {
  name: '009_share_token',
  up: async (client) => {
    await client.query(`
      ALTER TABLE assessments
        ADD COLUMN IF NOT EXISTS share_token VARCHAR(64)
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS assessments_share_token_unique_idx
        ON assessments (share_token)
        WHERE share_token IS NOT NULL
    `);
  },
  down: async (client) => {
    await client.query(`DROP INDEX IF EXISTS assessments_share_token_unique_idx`);
    await client.query(`ALTER TABLE assessments DROP COLUMN IF EXISTS share_token`);
  }
};
