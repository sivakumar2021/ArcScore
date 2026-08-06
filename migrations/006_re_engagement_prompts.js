module.exports = {
  name: 're_engagement_prompts',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS re_engagement_prompts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        dimension_key VARCHAR(50),
        prompt_type VARCHAR(50) NOT NULL DEFAULT 'phase_decline',
        shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dismissed_at TIMESTAMPTZ,
        converted_at TIMESTAMPTZ,
        converted_assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
        metadata JSONB
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS re_engagement_prompts_user_id_idx
        ON re_engagement_prompts(user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS re_engagement_prompts_user_shown_idx
        ON re_engagement_prompts(user_id, shown_at DESC)
    `);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS re_engagement_prompts`);
  }
};
