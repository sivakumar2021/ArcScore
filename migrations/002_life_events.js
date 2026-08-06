module.exports = {
  name: '002_life_events',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS life_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_type VARCHAR(30) NOT NULL CHECK (event_type IN (
          'career_change', 'relationship', 'health', 'relocation',
          'financial', 'loss', 'achievement', 'other'
        )),
        title VARCHAR(200) NOT NULL,
        description TEXT,
        occurred_at DATE NOT NULL,
        dimensions_affected JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS life_events_user_id_idx ON life_events(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS life_events_occurred_at_idx ON life_events(occurred_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS life_events_user_occurred_idx ON life_events(user_id, occurred_at DESC)
    `);
  }
};
