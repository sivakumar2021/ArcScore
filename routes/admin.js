// routes/admin.js — owns /api/admin/* endpoints. Admin-only (ADMIN_SECRET env check).
// Does NOT own user-facing APIs or analytics writes (routes/analytics.js).
const express = require('express');
const pool = require('../db');

const router = express.Router();

// Admin auth: require X-Admin-Secret header matching ADMIN_SECRET env var.
// Falls back to IP allowlist check in development if ADMIN_SECRET not set.
function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers['x-admin-secret'] === secret) return next();
  // Allow session-based admin if user email matches ADMIN_EMAIL
  if (req.session?.userId && process.env.ADMIN_EMAIL) {
    pool.query('SELECT email FROM users WHERE id = $1', [req.session.userId])
      .then(r => {
        if (r.rows.length > 0 && r.rows[0].email === process.env.ADMIN_EMAIL) return next();
        res.status(403).json({ error: 'Admin access required' });
      })
      .catch(() => res.status(403).json({ error: 'Admin access required' }));
    return;
  }
  res.status(403).json({ error: 'Admin access required' });
}

// GET /api/admin/metrics — aggregated business metrics
router.get('/metrics', requireAdmin, async (req, res) => {
  try {
    // Signup funnel
    const [totalUsers, signupsThisWeek] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query(`SELECT COUNT(*) as count FROM users WHERE created_at >= NOW() - INTERVAL '7 days'`)
    ]);

    // Assessment metrics
    const [totalAssessments, assessmentsThisWeek, uniqueUsers, completionRate] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM assessments WHERE completed_at IS NOT NULL'),
      pool.query(`SELECT COUNT(*) as count FROM assessments WHERE completed_at IS NOT NULL AND completed_at >= NOW() - INTERVAL '7 days'`),
      pool.query('SELECT COUNT(DISTINCT user_id) as count FROM assessments WHERE completed_at IS NOT NULL'),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
          COUNT(*) AS started
        FROM assessments
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `)
    ]);

    // Average time between assessments per user (median of per-user averages)
    const avgTimeBetween = await pool.query(`
      WITH ranked AS (
        SELECT user_id, completed_at,
               LAG(completed_at) OVER (PARTITION BY user_id ORDER BY completed_at) as prev_at
        FROM assessments WHERE completed_at IS NOT NULL
      ),
      gaps AS (
        SELECT user_id, EXTRACT(EPOCH FROM (completed_at - prev_at)) / 86400.0 as gap_days
        FROM ranked WHERE prev_at IS NOT NULL
      ),
      per_user AS (
        SELECT user_id, AVG(gap_days) as avg_gap FROM gaps GROUP BY user_id
      )
      SELECT ROUND(AVG(avg_gap)::numeric, 1) as avg_days_between_assessments FROM per_user
    `);

    // Retention metrics
    const [usersWithTwoPlus, avgDaysFirstToSecond, returnedIn30Days] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as count FROM (
          SELECT user_id FROM assessments WHERE completed_at IS NOT NULL GROUP BY user_id HAVING COUNT(*) >= 2
        ) t
      `),
      pool.query(`
        WITH first_two AS (
          SELECT user_id, completed_at,
                 ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY completed_at) as rn
          FROM assessments WHERE completed_at IS NOT NULL
        )
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (a2.completed_at - a1.completed_at)) / 86400.0)::numeric, 1) as avg_days
        FROM first_two a1
        JOIN first_two a2 ON a1.user_id = a2.user_id AND a1.rn = 1 AND a2.rn = 2
      `),
      pool.query(`
        WITH first_assessment AS (
          SELECT user_id, MIN(completed_at) as first_at
          FROM assessments WHERE completed_at IS NOT NULL GROUP BY user_id
        ),
        returned AS (
          SELECT fa.user_id FROM first_assessment fa
          JOIN assessments a ON a.user_id = fa.user_id AND a.completed_at IS NOT NULL
          WHERE a.completed_at > fa.first_at
            AND a.completed_at <= fa.first_at + INTERVAL '30 days'
          GROUP BY fa.user_id
        )
        SELECT COUNT(*) as count FROM returned
      `)
    ]);

    // Signup funnel from analytics_events
    const funnelEvents = await pool.query(`
      SELECT event_type, COUNT(*) as count
      FROM analytics_events
      WHERE event_type IN ('page_view_landing', 'signup_form_started', 'signup_completed', 'assessment_started', 'assessment_completed')
      GROUP BY event_type
    `);
    const funnel = {};
    for (const row of funnelEvents.rows) funnel[row.event_type] = parseInt(row.count);

    // Users active in last 7 days (visited or completed something)
    const activeUsersThisWeek = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as count FROM analytics_events
      WHERE created_at >= NOW() - INTERVAL '7 days' AND user_id IS NOT NULL
    `);

    const totalUsersCount = parseInt(totalUsers.rows[0].count);
    const twoPlus = parseInt(usersWithTwoPlus.rows[0].count);
    const retentionRate = totalUsersCount > 0 ? Math.round((twoPlus / totalUsersCount) * 100) : 0;

    const cr = completionRate.rows[0];
    const completionRatePct = parseInt(cr.started) > 0
      ? Math.round((parseInt(cr.completed) / parseInt(cr.started)) * 100) : 0;

    res.json({
      as_of: new Date().toISOString(),
      users: {
        total: totalUsersCount,
        signups_this_week: parseInt(signupsThisWeek.rows[0].count),
        active_this_week: parseInt(activeUsersThisWeek.rows[0].count)
      },
      assessments: {
        total_completed: parseInt(totalAssessments.rows[0].count),
        completed_this_week: parseInt(assessmentsThisWeek.rows[0].count),
        unique_users_completed: parseInt(uniqueUsers.rows[0].count),
        avg_days_between: parseFloat(avgTimeBetween.rows[0].avg_days_between_assessments) || null,
        completion_rate_30d_pct: completionRatePct
      },
      retention: {
        users_2plus_assessments: twoPlus,
        retention_rate_pct: retentionRate,
        avg_days_first_to_second: parseFloat(avgDaysFirstToSecond.rows[0].avg_days) || null,
        returned_within_30_days: parseInt(returnedIn30Days.rows[0].count)
      },
      funnel
    });
  } catch (err) {
    console.error('Admin metrics error:', err);
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});

// GET /api/admin/leads — paginated list of interstitial captures, filterable by
// ref_code and source so the admin UI can scope a view (e.g. all leads tagged with
// ref_code=ted-ryce). Rows ordered newest-first by first_seen_at unless
// ?sort=replies is supplied, which orders by descending reply activity so the
// most-replied-to leads surface first.
const SORT_ORDERINGS = {
  replies: 'reply_count DESC, last_reply_at DESC NULLS LAST, first_seen_at DESC'
};

// Stage / source filter sets for the /leads/inbox inbox UI — kept in sync with
// the CHECK on lead_replies.status and the canonical source value written by
// POST /api/leads/inbound. Changing these values here mirrors migration 1753062403.
const INBOX_VALID_STAGES = new Set(['new', 'replied', 'archived', 'pipeline-start']);
router.get('/leads', requireAdmin, async (req, res) => {
  try {
    const { ref_code, source } = req.query;
    const sortKey = typeof req.query.sort === 'string' ? req.query.sort : '';
    const orderBy = SORT_ORDERINGS[sortKey] || 'first_seen_at DESC';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const where = [];
    if (ref_code) { params.push(ref_code); where.push(`ref_code = $${params.length}`); }
    if (source)   { params.push(source);   where.push(`source   = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await pool.query(
      `SELECT id, ref_code, email, source, first_seen_at, user_id, reply_count, last_reply_at
       FROM ref_leads ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ leads: rows.rows });
  } catch (err) {
    console.error('Admin leads error:', err);
    res.status(500).json({ error: 'Failed to load leads' });
  }
});

// GET /api/admin/leads/inbox — paginated reverse-chronological list of every
// row in lead_replies (one row per inbound webhook hit). Mirrors the
// ?ref_code/?source filter shape from /leads but adds ?stage= against the
// inbox's status field. When no filters are active, returns the distinct
// source values alongside so the UI can render the source dropdown without a
// second round-trip.
router.get('/leads/inbox', requireAdmin, async (req, res) => {
  try {
    const source = typeof req.query.source === 'string' && req.query.source.trim()
      ? req.query.source.trim()
      : null;
    const stage = typeof req.query.stage === 'string' && req.query.stage.trim()
      ? req.query.stage.trim()
      : null;
    if (stage && !INBOX_VALID_STAGES.has(stage)) {
      return res.status(400).json({ error: 'invalid_stage' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const params = [];
    const where = [];
    if (source) { params.push(source); where.push(`r.source = $${params.length}`); }
    if (stage)  { params.push(stage);  where.push(`r.status = $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const dataPromise = pool.query(
      `SELECT r.id, r.lead_id, r.subject, r.body_preview, r.sentiment,
              r.source, r.received_at, r.status, r.created_at,
              l.email AS lead_email, l.ref_code, l.reply_count
       FROM lead_replies r
       JOIN ref_leads l ON l.id = r.lead_id
       ${whereSql}
       ORDER BY r.received_at DESC NULLS LAST, r.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    // Distinct sources are only useful for the dropdown when no source filter
    // is active — skip the round-trip otherwise to keep the response focused.
    const sourcesPromise = source
      ? Promise.resolve({ rows: [] })
      : pool.query(`SELECT DISTINCT source FROM lead_replies ORDER BY source`);
    const [data, sources] = await Promise.all([dataPromise, sourcesPromise]);
    res.json({
      replies: data.rows,
      count: data.rows.length,
      sources: sources.rows.map(r => r.source)
    });
  } catch (err) {
    console.error('Admin leads inbox error:', err);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

// PATCH /api/admin/leads/inbox/:replyId — move a single reply to a new stage.
// Validates status against the same 4-value CHECK set; rejection is 400 so the
// row stays untouched. Returns the updated row so the caller can refresh its
// view without re-listing.
router.patch('/leads/inbox/:replyId', requireAdmin, async (req, res) => {
  try {
    const replyId = parseInt(req.params.replyId, 10);
    if (!Number.isFinite(replyId) || replyId <= 0) {
      return res.status(400).json({ error: 'invalid_reply_id' });
    }
    const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
    if (!INBOX_VALID_STAGES.has(status)) {
      return res.status(400).json({ error: 'invalid_stage' });
    }
    const updated = await pool.query(
      `UPDATE lead_replies
         SET status = $2
       WHERE id = $1
       RETURNING id, lead_id, subject, body_preview, sentiment,
                 source, received_at, status, created_at`,
      [replyId, status]
    );
    if (updated.rowCount === 0) {
      return res.status(404).json({ error: 'reply_not_found' });
    }
    res.json({ reply: updated.rows[0] });
  } catch (err) {
    console.error('Admin inbox patch error:', err);
    res.status(500).json({ error: 'Failed to update reply' });
  }
});

module.exports = router;
