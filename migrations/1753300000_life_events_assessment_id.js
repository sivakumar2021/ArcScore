module.exports = {
  name: '1753300000_life_events_assessment_id',
  up: async (client) => {
    await client.query(`
      ALTER TABLE life_events
        ADD COLUMN IF NOT EXISTS assessment_id INTEGER
          REFERENCES assessments(id) ON DELETE SET NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS life_events_assessment_id_idx
        ON life_events(assessment_id)
        WHERE assessment_id IS NOT NULL
    `);
  }
};
