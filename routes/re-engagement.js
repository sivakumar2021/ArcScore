// routes/re-engagement.js — owns /api/re-engagement/* prompt lifecycle.
// Does NOT own assessment CRUD or insight generation.
const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

router.post('/:id/dismiss', requireAuth, async (req, res) => {
  try {
    const promptId = parseInt(req.params.id, 10);
    if (isNaN(promptId)) return res.status(400).json({ error: 'Invalid prompt ID' });

    await pool.query(
      `UPDATE re_engagement_prompts SET dismissed_at = NOW() WHERE id = $1 AND user_id = $2`,
      [promptId, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Dismiss re-engagement error:', err);
    res.status(500).json({ error: 'Failed to dismiss' });
  }
});

router.post('/:id/convert', requireAuth, async (req, res) => {
  try {
    const promptId = parseInt(req.params.id, 10);
    if (isNaN(promptId)) return res.status(400).json({ error: 'Invalid prompt ID' });

    const { assessment_id } = req.body;
    await pool.query(
      `UPDATE re_engagement_prompts SET converted_at = NOW(), converted_assessment_id = $3 WHERE id = $1 AND user_id = $2`,
      [promptId, req.session.userId, assessment_id || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Convert re-engagement error:', err);
    res.status(500).json({ error: 'Failed to record conversion' });
  }
});

module.exports = router;
