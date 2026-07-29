// routes/scores.js -- owns /api/scores/* for longitudinal score history views.
// Powers the /timeline page and the embeddable history strip on /results/:id.
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

const LIFE_EVENT_TYPES = ['career_change', 'relationship', 'health', 'relocation', 'financial', 'loss', 'achievement', 'other'];
const VALID_DIMENSION_KEYS = ['fitness', 'financial', 'relationships', 'career', 'mental_health', 'learning', 'social', 'habits', 'purpose'];

function formatMonthYear(d) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// GET /api/scores/history -- all completed assessments + life events +
// server-computed summary (total, date range, biggest-mover dimension).
// Mirrors the existing /api/assessments/timeline payload shape, but adds
// a pre-computed summary so the page doesn't repeat the math.
router.get('/history', requireAuth, async (req, res) => {
  try {
    const [assessmentsResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.completed_at, a.notes,
                json_agg(json_build_object('dimension_id', s.dimension_id, 'dimension_key', d.key,
                  'dimension_name', d.name, 'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order) as scores
         FROM assessments a
         LEFT JOIN assessment_scores s ON s.assessment_id = a.id
         LEFT JOIN dimensions d ON d.id = s.dimension_id
         WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
         GROUP BY a.id ORDER BY a.completed_at ASC`,
        [req.session.userId]
      ),
      pool.query(
        `SELECT id, assessment_id, event_type, title, description, occurred_at, dimensions_affected
         FROM life_events WHERE user_id = $1 ORDER BY occurred_at ASC`,
        [req.session.userId]
      )
    ]);

    const assessments = assessmentsResult.rows.map(a => {
      const scores = Array.isArray(a.scores) ? a.scores.filter(s => s.dimension_id !== null) : [];
      return { ...a, scores };
    });

    const summary = computeHistorySummary(assessments);

    logEvent(req.session.userId, 'timeline_viewed', { source: 'api' }).catch(() => {});

    res.json({
      assessments,
      life_events: eventsResult.rows,
      summary
    });
  } catch (err) {
    console.error('Scores history error:', err);
    res.status(500).json({ error: 'Failed to load scores history' });
  }
});

// POST /api/scores/:id/event -- attach a life event to a specific assessment.
// Mirrors POST /api/life-events but ties the event to the score so it shows
// as a labeled marker on /timeline at the event's date.
router.post('/:id/event', requireAuth, async (req, res) => {
  try {
    const assessmentId = parseInt(req.params.id, 10);
    if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

    const owns = await pool.query(
      'SELECT 1 FROM assessments WHERE id = $1 AND user_id = $2',
      [assessmentId, req.session.userId]
    );
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    const { event_type, title, description, occurred_at, dimensions_affected } = req.body || {};
    if (!event_type || !title || !occurred_at) return res.status(400).json({ error: 'Event type, title, and date are required' });
    if (!LIFE_EVENT_TYPES.includes(event_type)) return res.status(400).json({ error: 'Invalid event type' });
    if (title.length > 200) return res.status(400).json({ error: 'Title must be 200 characters or less' });

    const eventDate = new Date(occurred_at);
    if (isNaN(eventDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

    const dims = Array.isArray(dimensions_affected) ? dimensions_affected : [];
    const invalidDims = dims.filter(d => !VALID_DIMENSION_KEYS.includes(d));
    if (invalidDims.length > 0) return res.status(400).json({ error: 'Invalid dimension keys: ' + invalidDims.join(', ') });

    const result = await pool.query(
      `INSERT INTO life_events (user_id, assessment_id, event_type, title, description, occurred_at, dimensions_affected)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, assessment_id, event_type, title, description, occurred_at, dimensions_affected, created_at`,
      [req.session.userId, assessmentId, event_type, title.trim(), description?.trim() || null, occurred_at, JSON.stringify(dims)]
    );
    res.status(201).json({ life_event: result.rows[0] });
  } catch (err) {
    console.error('Create score event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

function computeHistorySummary(assessments) {
  if (!assessments || assessments.length === 0) {
    return {
      total_assessments: 0,
      first_completed_at: null,
      last_completed_at: null,
      date_range: null,
      biggest_mover: null
    };
  }

  const first = assessments[0];
  const last = assessments[assessments.length - 1];
  const firstDate = new Date(first.completed_at);
  const lastDate = new Date(last.completed_at);
  const dateRange = (firstDate.getFullYear() === lastDate.getFullYear() && firstDate.getMonth() === lastDate.getMonth())
    ? formatMonthYear(firstDate)
    : `${formatMonthYear(firstDate)} – ${formatMonthYear(lastDate)}`;

  let biggestMover = null;
  if (assessments.length >= 2) {
    const keys = new Set();
    first.scores.forEach(s => keys.add(s.dimension_key));
    last.scores.forEach(s => keys.add(s.dimension_key));

    keys.forEach(key => {
      const f = first.scores.find(s => s.dimension_key === key);
      const l = last.scores.find(s => s.dimension_key === key);
      if (!f || !l) return;
      const delta = l.score - f.score;
      const absDelta = Math.abs(delta);
      if (!biggestMover || absDelta > Math.abs(biggestMover.delta)) {
        biggestMover = {
          key,
          name: l.dimension_name || f.dimension_name || key,
          icon: l.dimension_icon || f.dimension_icon || '',
          delta,
          first_score: f.score,
          latest_score: l.score,
          first_assessment_id: first.id,
          latest_assessment_id: last.id
        };
      }
    });
  }

  return {
    total_assessments: assessments.length,
    first_completed_at: first.completed_at,
    last_completed_at: last.completed_at,
    date_range: dateRange,
    biggest_mover: biggestMover
  };
}

module.exports = router;
