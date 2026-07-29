// routes/life-events.js — owns /api/life-events/* CRUD.
// Does NOT own assessment logic or insights.
const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

const LIFE_EVENT_TYPES = ['career_change', 'relationship', 'health', 'relocation', 'financial', 'loss', 'achievement', 'other'];
const VALID_DIMENSION_KEYS = ['fitness', 'financial', 'relationships', 'career', 'mental_health', 'learning', 'social', 'habits', 'purpose'];

router.post('/', requireAuth, async (req, res) => {
  try {
    const { event_type, title, description, occurred_at, dimensions_affected } = req.body;
    if (!event_type || !title || !occurred_at) return res.status(400).json({ error: 'Event type, title, and date are required' });
    if (!LIFE_EVENT_TYPES.includes(event_type)) return res.status(400).json({ error: 'Invalid event type' });
    if (title.length > 200) return res.status(400).json({ error: 'Title must be 200 characters or less' });

    const eventDate = new Date(occurred_at);
    if (isNaN(eventDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

    const dims = Array.isArray(dimensions_affected) ? dimensions_affected : [];
    const invalidDims = dims.filter(d => !VALID_DIMENSION_KEYS.includes(d));
    if (invalidDims.length > 0) return res.status(400).json({ error: 'Invalid dimension keys: ' + invalidDims.join(', ') });

    const result = await pool.query(
      `INSERT INTO life_events (user_id, event_type, title, description, occurred_at, dimensions_affected)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, event_type, title, description, occurred_at, dimensions_affected, created_at`,
      [req.session.userId, event_type, title.trim(), description?.trim() || null, occurred_at, JSON.stringify(dims)]
    );
    res.status(201).json({ life_event: result.rows[0] });
  } catch (err) {
    console.error('Create life event error:', err);
    res.status(500).json({ error: 'Failed to create life event' });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, event_type, title, description, occurred_at, dimensions_affected, created_at
       FROM life_events WHERE user_id = $1 ORDER BY occurred_at DESC, created_at DESC`,
      [req.session.userId]
    );
    res.json({ life_events: result.rows });
  } catch (err) {
    console.error('Get life events error:', err);
    res.status(500).json({ error: 'Failed to load life events' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });

    const result = await pool.query('DELETE FROM life_events WHERE id = $1 AND user_id = $2 RETURNING id', [eventId, req.session.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Life event not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete life event error:', err);
    res.status(500).json({ error: 'Failed to delete life event' });
  }
});

module.exports = router;
