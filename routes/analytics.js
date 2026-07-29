// routes/analytics.js — owns analytics_events write path and logEvent helper.
// Does NOT own reporting/aggregation; that lives in routes/admin.js.
const express = require('express');
const pool = require('../db');

const router = express.Router();

/**
 * logEvent — fire-and-forget analytics event writer.
 * Safe to call without await; errors are swallowed with a console.error.
 * @param {number|null} userId - null for anonymous events
 * @param {string} eventType - e.g. 'page_view', 'signup_completed'
 * @param {object} [eventData] - arbitrary JSON metadata
 */
async function logEvent(userId, eventType, eventData = {}) {
  try {
    await pool.query(
      'INSERT INTO analytics_events (user_id, event_type, event_data) VALUES ($1, $2, $3)',
      [userId || null, eventType, JSON.stringify(eventData)]
    );
  } catch (err) {
    console.error('analytics logEvent error:', err.message);
  }
}

// POST /api/analytics/event — client-side event beacon for page views
// user_id is read from session server-side; client sends event_type + event_data only
router.post('/event', (req, res) => {
  const { event_type, event_data } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  const userId = req.session?.userId || null;
  logEvent(userId, event_type, event_data || {}).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
module.exports.logEvent = logEvent;
