// db/gallery.js — owns gallery aggregate data queries.
// Does NOT own business logic (routes do that).
const pool = require('./index');

async function getDimensionAverages() {
  return pool.query(
    `SELECT
       d.key,
       d.name,
       d.icon,
       ROUND(AVG(s.score)::numeric, 2) as avg_score,
       COUNT(DISTINCT a.id)::int as assessment_count
     FROM dimensions d
     LEFT JOIN assessment_scores s ON s.dimension_id = d.id
     LEFT JOIN assessments a ON a.id = s.assessment_id AND a.completed_at IS NOT NULL
     GROUP BY d.id, d.key, d.name, d.icon, d.sort_order
     ORDER BY d.sort_order`
  );
}

async function getGrowthPhases() {
  return pool.query(
    `WITH per_user AS (
       SELECT
         a.user_id,
         COUNT(a.id)::int as assessment_count,
         MAX(a.completed_at) as last_date,
         MIN(a.completed_at) as first_date
       FROM assessments a
       WHERE a.completed_at IS NOT NULL
       GROUP BY a.user_id
       HAVING COUNT(a.id) >= 1
     )
     SELECT
       CASE
         WHEN assessment_count = 1 THEN 'Getting Started'
         WHEN assessment_count BETWEEN 2 AND 3 THEN 'Building Momentum'
         WHEN assessment_count BETWEEN 4 AND 7 THEN 'Tracking Progress'
         ELSE 'Arc Master'
       END as phase,
       COUNT(*)::int as user_count,
       ROUND(AVG(assessment_count)::numeric, 1) as avg_assessments
     FROM per_user
     GROUP BY phase
     ORDER BY avg_assessments ASC`
  );
}

async function getTriggerEventCounts() {
  return pool.query(
    `WITH exploded AS (
       SELECT
         event_type,
         jsonb_array_elements_text(dimensions_affected) as dim_key,
         EXTRACT(YEAR FROM occurred_at)::int as event_year
       FROM life_events
       WHERE jsonb_array_length(dimensions_affected) > 0
     )
    SELECT
       event_type,
       COUNT(*)::int as event_count,
       (SELECT json_agg(DISTINCT dim_key) FROM exploded e2 WHERE e2.event_type = e.event_type) as dimension_labels,
       (SELECT json_agg(DISTINCT event_year) FROM exploded e3 WHERE e3.event_type = e.event_type) as years
    FROM exploded e
    GROUP BY event_type
    ORDER BY event_count DESC
    LIMIT 10`
  );
}

module.exports = { getDimensionAverages, getGrowthPhases, getTriggerEventCounts };