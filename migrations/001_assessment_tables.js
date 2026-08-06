module.exports = {
  name: '001_assessment_tables',
  up: async (client) => {
    // Dimensions reference table
    await client.query(`
      CREATE TABLE IF NOT EXISTS dimensions (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(100) NOT NULL,
        icon VARCHAR(10) NOT NULL,
        description TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Seed the 10 life dimensions
    await client.query(`
      INSERT INTO dimensions (key, name, icon, description, sort_order) VALUES
        ('fitness', 'Fitness', '🏋', 'Physical health, energy levels, exercise habits, and body care', 1),
        ('financial', 'Financial', '💰', 'Income stability, savings, debt management, and financial security', 2),
        ('relationships', 'Relationships', '🤝', 'Quality of connections with partner, family, and close friends', 3),
        ('career', 'Career', '🚀', 'Professional growth, job satisfaction, impact, and trajectory', 4),
        ('mental_health', 'Mental Health', '🧠', 'Stress management, emotional clarity, peace of mind', 5),
        ('learning', 'Learning', '📚', 'Skill development, intellectual curiosity, and personal growth', 6),
        ('creativity', 'Creativity', '🎨', 'Creative expression, side projects, and flow states', 7),
        ('social', 'Social', '🌍', 'Community involvement, belonging, and social contribution', 8),
        ('purpose', 'Purpose', '✨', 'Sense of meaning, direction, and life alignment', 9),
        ('environment', 'Environment', '🏠', 'Living space quality, daily surroundings, and comfort', 10)
      ON CONFLICT (key) DO NOTHING
    `);

    // Structured questions for each dimension (3 questions each)
    await client.query(`
      CREATE TABLE IF NOT EXISTS dimension_questions (
        id SERIAL PRIMARY KEY,
        dimension_id INTEGER NOT NULL REFERENCES dimensions(id),
        question_text TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Seed structured questions
    await client.query(`
      INSERT INTO dimension_questions (dimension_id, question_text, sort_order)
      SELECT d.id, q.question_text, q.sort_order
      FROM dimensions d
      JOIN (VALUES
        -- Fitness
        ('fitness', 'How consistent has your exercise routine been?', 1),
        ('fitness', 'How would you rate your energy levels throughout the day?', 2),
        ('fitness', 'How well are you sleeping and recovering?', 3),
        -- Financial
        ('financial', 'How secure do you feel about your financial situation?', 1),
        ('financial', 'Are you making progress toward your financial goals?', 2),
        ('financial', 'How well are you managing spending and saving?', 3),
        -- Relationships
        ('relationships', 'How connected do you feel to the people closest to you?', 1),
        ('relationships', 'Are you investing quality time in your key relationships?', 2),
        ('relationships', 'How well are you communicating and resolving conflicts?', 3),
        -- Career
        ('career', 'How satisfied are you with your professional growth?', 1),
        ('career', 'Do you feel challenged and engaged at work?', 2),
        ('career', 'How aligned is your work with your long-term career goals?', 3),
        -- Mental Health
        ('mental_health', 'How well are you managing stress and anxiety?', 1),
        ('mental_health', 'How clear and focused does your mind feel?', 2),
        ('mental_health', 'How often do you feel at peace with yourself?', 3),
        -- Learning
        ('learning', 'Are you actively developing new skills or knowledge?', 1),
        ('learning', 'How curious and intellectually stimulated do you feel?', 2),
        ('learning', 'Are you applying what you learn to improve your life?', 3),
        -- Creativity
        ('creativity', 'How often are you engaging in creative activities?', 1),
        ('creativity', 'Do you experience flow states in your creative work?', 2),
        ('creativity', 'Are you expressing yourself through projects or art?', 3),
        -- Social
        ('social', 'How connected do you feel to your broader community?', 1),
        ('social', 'Are you contributing to causes or groups you care about?', 2),
        ('social', 'How strong is your sense of belonging?', 3),
        -- Purpose
        ('purpose', 'How clear is your sense of direction in life?', 1),
        ('purpose', 'Do your daily actions align with what matters most to you?', 2),
        ('purpose', 'How meaningful does your life feel right now?', 3),
        -- Environment
        ('environment', 'How comfortable and organized is your living space?', 1),
        ('environment', 'Does your environment support your wellbeing and productivity?', 2),
        ('environment', 'How satisfied are you with your daily surroundings?', 3)
      ) AS q(dim_key, question_text, sort_order) ON d.key = q.dim_key
    `);

    // Assessments table - one row per assessment session
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        notes TEXT
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS assessments_user_id_idx ON assessments(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS assessments_completed_at_idx ON assessments(completed_at)
    `);

    // Assessment scores - time-series data, one score per dimension per assessment
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_scores (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        dimension_id INTEGER NOT NULL REFERENCES dimensions(id),
        score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 10),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assessment_id, dimension_id)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS assessment_scores_assessment_id_idx ON assessment_scores(assessment_id)
    `);

    // Per-question responses for deeper analytics
    await client.query(`
      CREATE TABLE IF NOT EXISTS assessment_responses (
        id SERIAL PRIMARY KEY,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES dimension_questions(id),
        score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 10),
        UNIQUE(assessment_id, question_id)
      )
    `);
  }
};
