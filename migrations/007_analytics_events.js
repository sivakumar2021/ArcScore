module.exports = {
  name: '007_analytics_events',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(100) NOT NULL,
        event_data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events (event_type)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events (user_id) WHERE user_id IS NOT NULL`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events (created_at)`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS analytics_events`);
  }
};
