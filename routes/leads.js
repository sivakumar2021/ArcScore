// routes/leads.js — captures interstitial email submissions from referred
// referral traffic and stores them with ref attribution. Differs from
// routes/ref-leads.js in that it surfaces failures to the client (the spec
// requires 200 on insert / 409 on duplicate), returns the inserted row id,
// uses the spec-mandated ref_code / source / first_seen_at columns, fires a
// 'lead_captured' analytics row, and emits a server-side GA4 Measurement
// Protocol 'ref_lead_captured' event (on both first-write and 409 dedup) so
// capture rate is measurable in GA4.
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');
const { ga4Event } = require('../services/ga4');

const router = express.Router();

const REF_RE = /^[a-z0-9_-]{1,64}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Inline admin gate for the inbound webhook endpoint. Isolated here (rather
// than imported from routes/admin.js) so the existing POST / behaviour, which
// is intentionally unauthenticated, remains untouched.
function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// POST / — anonymous; persists (ref, email) and fires a 'lead_captured'
// analytics row. Returns 200 with the inserted row id, 409 on duplicate.
router.post('/', async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const rawRef = typeof req.body?.ref === 'string' ? req.body.ref.trim() : '';
  const ref = rawRef || (typeof req.body?.ref_code === 'string' ? req.body.ref_code.trim() : '');
  const source = typeof req.body?.source === 'string' && req.body.source.trim()
    ? req.body.source.trim()
    : 'interstitial';

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
  if (ref && !REF_RE.test(ref)) {
    return res.status(400).json({ error: 'invalid_ref' });
  }

  const email = rawEmail.toLowerCase();

  try {
    const result = await pool.query(
      `INSERT INTO ref_leads (ref_code, email, source, first_seen_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, ref_code, email, source, first_seen_at`,
      [ref || null, email, source]
    );
    const row = result.rows[0];

    logEvent(null, 'lead_captured', { ref_code: ref || null, source: 'interstitial' }).catch(() => {});
    ga4Event('ref_lead_captured', {
      ref_code: ref || null,
      source,
      landed_path: landedPath,
      is_new: true
    });

    return res.status(200).json({
      ok: true,
      id: row.id,
      ref_code: row.ref_code,
      email: row.email,
      source: row.source
    });
  } catch (err) {
    if (err && err.code === '23505') {
      ga4Event('ref_lead_captured', {
        ref_code: ref || null,
        source,
        landed_path: landedPath,
        is_new: false
      });
      return res.status(409).json({ error: 'duplicate_email' });
    }
    console.error('leads insert error:', err.message);
    return res.status(500).json({ error: 'insert_failed' });
  }
});

// POST /inbound — webhook ingest for parsed reply payloads from the outreach
// inbox. Attaches to an existing ref_leads row by LOWER(from_email) and
// increments reply_count + bumps last_reply_at; otherwise inserts a new row
// tagged source='inbound_reply' so admin filtering already works through
// ?source=inbound_reply. Gated by ADMIN_SECRET so only the inbound webhook
// (or admin tools) can write to it.
router.post('/inbound', requireAdminSecret, async (req, res) => {
  const rawEmail = typeof req.body?.from_email === 'string' ? req.body.from_email.trim() : '';
  const subject = typeof req.body?.subject === 'string' ? req.body.subject : null;
  const body = typeof req.body?.body === 'string' ? req.body.body : null;
  const receivedAt = typeof req.body?.received_at === 'string' && req.body.received_at.trim()
    ? req.body.received_at.trim()
    : null;
  const rawRef = typeof req.body?.ref_code === 'string' ? req.body.ref_code.trim() : '';
  const sentiment = typeof req.body?.sentiment === 'string' && req.body.sentiment.trim()
    ? req.body.sentiment.trim().slice(0, 32)
    : null;

  if (!rawEmail || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  if (rawRef && !REF_RE.test(rawRef)) {
    return res.status(400).json({ error: 'invalid_ref' });
  }

  const email = rawEmail.toLowerCase();
  const refCode = rawRef || null;

  // UPDATE first so the common case (row already exists) is a single query.
  // If 0 rows match we INSERT a brand-new lead tagged source='inbound_reply'.
  // The idx_ref_leads_email_unique index triggers 23505 on a concurrent insert
  // for the same email; we catch that and re-run the UPDATE so the racing
  // payload converges onto the now-existing row.
  const updateSql = `
    UPDATE ref_leads
    SET reply_count = reply_count + 1,
        last_reply_at = $2,
        last_reply_subject = $3,
        last_reply_body = $4
    WHERE email = $5
    RETURNING id, email, reply_count, last_reply_at
  `;
  const insertSql = `
    INSERT INTO ref_leads (
      email, source, ref_code, first_seen_at,
      reply_count, last_reply_at, last_reply_subject, last_reply_body
    )
    VALUES ($1, 'inbound_reply', $2, NOW(), 1, $3, $4, $5)
    RETURNING id, email, reply_count, last_reply_at
  `;

  try {
    let row;
    const updated = await pool.query(updateSql, [receivedAt, subject, body, email]);
    if (updated.rows.length > 0) {
      row = updated.rows[0];
    } else {
      try {
        const inserted = await pool.query(insertSql, [email, refCode, receivedAt, subject, body]);
        row = inserted.rows[0];
      } catch (err) {
        if (err && err.code === '23505') {
          const raced = await pool.query(updateSql, [receivedAt, subject, body, email]);
          row = raced.rows[0];
        } else {
          throw err;
        }
      }
    }

    if (!row) {
      return res.status(500).json({ error: 'insert_failed' });
    }

    // Append a per-reply audit row so the admin inbox can list every webhook
    // hit, not just the most recent. Non-fatal — a failure here must NOT break
    // the webhook contract (upstream still needs a 200 with reply_count).
    try {
      await pool.query(
        `INSERT INTO lead_replies
           (lead_id, source, subject, body, body_preview, sentiment, received_at)
         VALUES ($1, 'inbound_reply', $2, $3, LEFT($3, 200), $4, $5)`,
        [row.id, subject, body, sentiment, receivedAt]
      );
    } catch (replyErr) {
      console.error('lead_replies insert:', replyErr.message);
    }

    logEvent(null, 'inbound_reply', {
      email,
      ref_code: refCode,
      source: 'inbound_reply'
    }).catch(() => {});

    return res.status(200).json({
      ok: true,
      lead_id: row.id,
      reply_count: row.reply_count,
      last_reply_at: row.last_reply_at
    });
  } catch (err) {
    console.error('leads inbound error:', err.message);
    return res.status(500).json({ error: 'insert_failed' });
  }
});

module.exports = router;
