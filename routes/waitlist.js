// routes/waitlist.js — captures self-serve waitlist emails from /pricing
// and writes them to ref_leads + lead_replies so the existing
// /admin/leads/inbox surfaces the signup. Mirrors the structural shape of
// routes/leads.js (single POST /, EMAIL_RE constant, 200/409/400 contract)
// but uses a fixed source value and does not require a ref_code.
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');
const { ga4Event } = require('../services/ga4');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST / — anonymous; persists (email) tagged source='pricing-page-waitlist'
// and inserts a paired lead_replies row with status='new' so /admin/leads/inbox
// picks it up. Returns 200 with the inserted row id, 409 on duplicate.
router.post('/', async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

  let landedPath = req.originalUrl || '/';
  const referer = req.headers.referer || req.headers.referrer;
  if (referer) {
    try {
      landedPath = new URL(referer).pathname + new URL(referer).search;
    } catch (_) {
      // Malformed referer header — fall back to req.originalUrl.
    }
  }

  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: 'invalid_email' });
  }

  const email = rawEmail.toLowerCase();

  try {
    const result = await pool.query(
      `INSERT INTO ref_leads (ref_code, email, source, first_seen_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, ref_code, email, source, first_seen_at`,
      [null, email, 'pricing-page-waitlist']
    );
    const row = result.rows[0];

    // Paired insert so the row appears in /admin/leads/inbox. Non-fatal —
    // a failure here must NOT break the 200 contract on the capture itself.
    try {
      await pool.query(
        `INSERT INTO lead_replies
           (lead_id, source, status, received_at)
         VALUES ($1, $2, 'new', NOW())`,
        [row.id, 'pricing-page-waitlist']
      );
    } catch (replyErr) {
      console.error('waitlist lead_replies insert:', replyErr.message);
    }

    logEvent(null, 'waitlist_signup', { source: 'pricing-page-waitlist' }).catch(() => {});
    ga4Event('waitlist_captured', {
      source: 'pricing-page-waitlist',
      landed_path: landedPath,
      is_new: true
    });

    return res.status(200).json({
      ok: true,
      id: row.id,
      email: row.email,
      source: row.source
    });
  } catch (err) {
    if (err && err.code === '23505') {
      ga4Event('waitlist_captured', {
        source: 'pricing-page-waitlist',
        landed_path: landedPath,
        is_new: false
      });
      return res.status(409).json({
        error: 'duplicate_email',
        message: "You're already on the list"
      });
    }
    console.error('waitlist insert error:', err.message);
    return res.status(500).json({ error: 'insert_failed' });
  }
});

module.exports = router;
