// routes/stats.js — owns lightweight public stats for the landing page.
const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/stats/public — completed assessment count for social proof display.
// Only shown on landing page when count > 10 (handled client-side).
router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*)::int as count FROM assessments WHERE completed_at IS NOT NULL"
    );
    res.json({ count: result.rows[0].count });
  } catch (err) {
    console.error('stats/public error:', err.message);
    res.json({ count: 0 });
  }
});

module.exports = router;