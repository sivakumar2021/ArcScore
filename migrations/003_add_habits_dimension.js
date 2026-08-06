module.exports = {
  name: '003_add_habits_dimension',
  up: async (client) => {
    // Remove assessment_responses for creativity and environment questions
    await client.query(`
      DELETE FROM assessment_responses
      WHERE question_id IN (
        SELECT dq.id FROM dimension_questions dq
        JOIN dimensions d ON d.id = dq.dimension_id
        WHERE d.key IN ('creativity', 'environment')
      )
    `);

    // Remove assessment_scores for creativity and environment dimensions
    await client.query(`
      DELETE FROM assessment_scores
      WHERE dimension_id IN (
        SELECT id FROM dimensions WHERE key IN ('creativity', 'environment')
      )
    `);

    // Remove questions for creativity and environment
    await client.query(`
      DELETE FROM dimension_questions
      WHERE dimension_id IN (
        SELECT id FROM dimensions WHERE key IN ('creativity', 'environment')
      )
    `);

    // Remove creativity and environment dimensions
    await client.query(`
      DELETE FROM dimensions WHERE key IN ('creativity', 'environment')
    `);

    // Add habits dimension at sort_order 9 (shifting purpose down to 10)
    await client.query(`
      UPDATE dimensions SET sort_order = 10 WHERE key = 'purpose'
    `);

    await client.query(`
      INSERT INTO dimensions (key, name, icon, description, sort_order)
      VALUES ('habits', 'Habits', '🔄', 'Daily routines, follow-through on commitments, and alignment of habits with goals', 9)
      ON CONFLICT (key) DO NOTHING
    `);

    // Add 3 questions for habits
    await client.query(`
      INSERT INTO dimension_questions (dimension_id, question_text, sort_order)
      SELECT d.id, q.question_text, q.sort_order
      FROM dimensions d
      JOIN (VALUES
        ('habits', 'How consistent are your daily routines and rituals?', 1),
        ('habits', 'How well do you follow through on commitments you make to yourself?', 2),
        ('habits', 'How aligned are your daily habits with your long-term goals?', 3)
      ) AS q(dim_key, question_text, sort_order) ON d.key = q.dim_key
    `);
  }
};
