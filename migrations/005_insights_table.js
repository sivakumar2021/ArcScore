module.exports = {
  name: 'insights_table',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS insights (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        insight_type VARCHAR(50) NOT NULL,
        dimension_key VARCHAR(50),
        pattern VARCHAR(100),
        confidence NUMERIC(4,2) NOT NULL DEFAULT 1.0,
        suggestion TEXT NOT NULL,
        description TEXT NOT NULL,
        metadata JSONB,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        assessment_count INTEGER NOT NULL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS insights_user_id_idx ON insights(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS insights_user_generated_idx ON insights(user_id, generated_at DESC)
    `);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS insights`);
  }
};
