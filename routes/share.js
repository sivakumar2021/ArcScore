// routes/share.js — owns /api/shared/:token (public, no auth required).
// Returns assessment scores for the given share token. Logs shared_page_viewed event.
// Does NOT own share token generation (routes/assessments.js POST /:id/share does that).
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');

const router = express.Router();

// GET /api/shared/:token — public endpoint, no session required
router.get('/:token', async (req, res) => {
  const { token } = req.params;
  if (!token || token.length > 100) return res.status(400).json({ error: 'Invalid token' });

  try {
    const result = await pool.query(
      `SELECT a.id, a.completed_at, u.name as sharer_name,
              json_agg(
                json_build_object(
                  'key', d.key,
                  'name', d.name,
                  'icon', d.icon,
                  'score', s.score
                ) ORDER BY d.sort_order
              ) as scores
       FROM assessments a
       JOIN users u ON u.id = a.user_id
       JOIN assessment_scores s ON s.assessment_id = a.id
       JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.share_token = $1 AND a.completed_at IS NOT NULL
       GROUP BY a.id, u.name`,
      [token]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const row = result.rows[0];

    // Fire-and-forget analytics (no auth, user_id null)
    logEvent(null, 'shared_page_viewed', { assessment_id: row.id, token }).catch(() => {});

    res.json({
      assessment_id: row.id,
      completed_at: row.completed_at,
      sharer_name: row.sharer_name,
      scores: row.scores
    });
  } catch (err) {
    console.error('Shared results error:', err);
    res.status(500).json({ error: 'Failed to load shared results' });
  }
});

module.exports = router;
