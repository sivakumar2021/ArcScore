// routes/ref-leads.js — captures pre-assessment email submissions from referred
// referral traffic so the originating influencer can be handed their leads.
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');

const router = express.Router();

const REF_RE = /^[a-z0-9_-]{1,64}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST / — anonymous; persists (ref, email) and fires a 'lead_captured'
// analytics row. Errors are swallowed because this is a fail-soft funnel
// step — never block the visitor from reaching Q1.
router.post('/', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const ref = typeof req.body?.ref === 'string' ? req.body.ref.trim() : '';

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(200).json({ ok: true });
  }
  if (!ref || !REF_RE.test(ref)) {
    return res.status(200).json({ ok: true });
  }

  try {
    await pool.query(
      'INSERT INTO ref_leads (ref, email) VALUES ($1, LOWER($2))',
      [ref, email]
    );
  } catch (err) {
    console.error('ref-leads insert error:', err.message);
  }

  logEvent(null, 'lead_captured', { ref, source: 'interstitial' }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
