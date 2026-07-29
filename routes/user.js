// routes/user.js — owns /api/user/* preferences endpoints.
// Does NOT own assessment logic or auth.
const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

router.get('/preferences', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT assessment_cadence_days, notifications_enabled FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    res.json({ assessment_cadence_days: row.assessment_cadence_days || 30, notifications_enabled: row.notifications_enabled !== false });
  } catch (err) {
    console.error('Get preferences error:', err);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});

router.put('/preferences', requireAuth, async (req, res) => {
  try {
    const { notifications_enabled, assessment_cadence_days } = req.body;
    if (assessment_cadence_days !== undefined) {
      const days = parseInt(assessment_cadence_days);
      if (!days || days < 7 || days > 365) return res.status(400).json({ error: 'assessment_cadence_days must be between 7 and 365' });
    }
    if (notifications_enabled !== undefined && typeof notifications_enabled !== 'boolean') {
      return res.status(400).json({ error: 'notifications_enabled must be a boolean' });
    }
    const updates = [], values = [];
    let paramIdx = 1;
    if (assessment_cadence_days !== undefined) { updates.push(`assessment_cadence_days = $${paramIdx++}`); values.push(parseInt(assessment_cadence_days)); }
    if (notifications_enabled !== undefined) { updates.push(`notifications_enabled = $${paramIdx++}`); values.push(notifications_enabled); }
    if (updates.length === 0) return res.status(400).json({ error: 'No preferences provided to update' });

    values.push(req.session.userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
    const result = await pool.query('SELECT assessment_cadence_days, notifications_enabled FROM users WHERE id = $1', [req.session.userId]);
    const row = result.rows[0];
    res.json({ ok: true, assessment_cadence_days: row.assessment_cadence_days || 30, notifications_enabled: row.notifications_enabled !== false });
  } catch (err) {
    console.error('Update preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// PATCH /api/users/cadence — legacy endpoint name, prefer PUT /api/user/preferences
router.patch('/cadence', requireAuth, async (req, res) => {
  try {
    const days = parseInt(req.body.cadence_days);
    if (!days || days < 7 || days > 365) return res.status(400).json({ error: 'cadence_days must be between 7 and 365' });
    await pool.query('UPDATE users SET assessment_cadence_days = $1 WHERE id = $2', [days, req.session.userId]);
    res.json({ ok: true, cadence_days: days });
  } catch (err) {
    console.error('Update cadence error:', err);
    res.status(500).json({ error: 'Failed to update cadence' });
  }
});

module.exports = router;
