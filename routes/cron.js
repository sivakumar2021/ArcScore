// routes/cron.js — owns scheduled job endpoints callable by an external scheduler.
// Does NOT own auth, assessments, or user management.
// Secured by CRON_SECRET env var to prevent public invocation.
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');
const {
  sendEmail,
  registerContact,
  buildReminderEmailHtml,
  buildDripDay0Html,
  buildDripDay3Html,
  buildDripDay7Html,
} = require('../services/email');

const router = express.Router();
const APP_URL = process.env.APP_URL || 'https://arcscore-le6r.polsia.app';

// Lightweight secret check — cron callers must pass ?secret=CRON_SECRET or X-Cron-Secret header.
// Not a full auth system; just prevents accidental public triggers.
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  // If no secret configured, allow in dev (logged below) — production should always set one.
  if (!secret) {
    console.warn('[cron] CRON_SECRET not set — endpoint is unprotected');
    return next();
  }
  const provided = req.headers['x-cron-secret'] || req.query.secret;
  if (provided !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * POST /api/cron/send-reminders
 *
 * Finds users who:
 *   - Signed up 24–48 hours ago
 *   - Have not completed any assessment
 *   - Have not already received a reminder email
 *   - Have notifications_enabled = true (or NULL, default opt-in)
 *
 * Sends a gentle reminder to each, tracks via analytics_events.
 * Call this endpoint once per hour from Render's cron or an external scheduler.
 */
router.post('/send-reminders', requireCronSecret, async (req, res) => {
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Users who signed up 24–48h ago, no completed assessment, reminder not yet sent
    const { rows: candidates } = await pool.query(`
      SELECT u.id, u.email, u.name
      FROM users u
      WHERE u.created_at >= NOW() - INTERVAL '48 hours'
        AND u.created_at <= NOW() - INTERVAL '24 hours'
        AND u.reminder_email_sent_at IS NULL
        AND (u.notifications_enabled IS NULL OR u.notifications_enabled = true)
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.user_id = u.id AND a.completed_at IS NOT NULL
        )
    `);

    for (const user of candidates) {
      try {
        // Ensure contact registered (idempotent)
        await registerContact(user.email, user.name);

        const html = buildReminderEmailHtml(user.name, APP_URL);
        const firstName = user.name ? user.name.split(' ')[0] : 'there';
        const plain = `Hey ${firstName} — you signed up for ArcScore yesterday but haven't completed your first assessment yet.\n\nIt takes about 2 minutes. That's your baseline — everything useful (trends, insights, correlations) starts from here.\n\nStart here: ${APP_URL}/assess\n\nManage email preferences: ${APP_URL}/settings`;

        const { ok } = await sendEmail(
          user.email,
          'Your ArcScore assessment takes 2 minutes — finish it now',
          plain,
          html
        );

        if (ok) {
          await pool.query(
            'UPDATE users SET reminder_email_sent_at = NOW() WHERE id = $1',
            [user.id]
          );
          logEvent(user.id, 'reminder_email_sent', { email: user.email }).catch(() => {});
          results.sent++;
        } else {
          results.errors++;
        }
      } catch (err) {
        console.error(`[cron] reminder error for user ${user.id}:`, err.message);
        results.errors++;
      }
    }

    res.json({ ok: true, ...results, candidates: candidates.length });
  } catch (err) {
    console.error('[cron] send-reminders query error:', err.message);
    res.status(500).json({ error: 'cron job failed', message: err.message });
  }
});

/**
 * GET /api/cron/send-reminders
 * Same logic, GET-friendly for simple external cron services (e.g. cron-job.org).
 */
router.get('/send-reminders', requireCronSecret, async (req, res) => {
  // Delegate to the POST handler by re-invoking the logic inline.
  // Kept separate to avoid Express router gymnastics.
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    const { rows: candidates } = await pool.query(`
      SELECT u.id, u.email, u.name
      FROM users u
      WHERE u.created_at >= NOW() - INTERVAL '48 hours'
        AND u.created_at <= NOW() - INTERVAL '24 hours'
        AND u.reminder_email_sent_at IS NULL
        AND (u.notifications_enabled IS NULL OR u.notifications_enabled = true)
        AND NOT EXISTS (
          SELECT 1 FROM assessments a
          WHERE a.user_id = u.id AND a.completed_at IS NOT NULL
        )
    `);

    for (const user of candidates) {
      try {
        await registerContact(user.email, user.name);
        const html = buildReminderEmailHtml(user.name, APP_URL);
        const firstName = user.name ? user.name.split(' ')[0] : 'there';
        const plain = `Hey ${firstName} — you signed up for ArcScore yesterday but haven't completed your first assessment yet.\n\nIt takes about 2 minutes. That's your baseline — everything useful (trends, insights, correlations) starts from here.\n\nStart here: ${APP_URL}/assess\n\nManage email preferences: ${APP_URL}/settings`;

        const { ok } = await sendEmail(
          user.email,
          'Your ArcScore assessment takes 2 minutes — finish it now',
          plain,
          html
        );

        if (ok) {
          await pool.query(
            'UPDATE users SET reminder_email_sent_at = NOW() WHERE id = $1',
            [user.id]
          );
          logEvent(user.id, 'reminder_email_sent', { email: user.email }).catch(() => {});
          results.sent++;
        } else {
          results.errors++;
        }
      } catch (err) {
        console.error(`[cron] reminder error for user ${user.id}:`, err.message);
        results.errors++;
      }
    }

    res.json({ ok: true, ...results, candidates: candidates.length });
  } catch (err) {
    console.error('[cron] send-reminders query error:', err.message);
    res.status(500).json({ error: 'cron job failed', message: err.message });
  }
});

// ─── DRIP SEQUENCE ────────────────────────────────────────────────────────────

/**
 * Helper: fetch dimension scores for an assessment, sorted by score asc.
 * Returns array of { key, score }.
 */
async function getAssessmentScores(assessmentId) {
  const { rows } = await pool.query(
    `SELECT d.key, s.score
     FROM assessment_scores s
     JOIN dimensions d ON d.id = s.dimension_id
     WHERE s.assessment_id = $1
     ORDER BY s.score ASC`,
    [assessmentId]
  );
  return rows; // lowest first
}

/**
 * POST /api/cron/send-drip
 * GET  /api/cron/send-drip
 *
 * Processes all three drip steps in a single cron pass:
 *
 *   Step 0 (Day 0): Users who just completed their first assessment and
 *                   haven't received drip_step0 yet. Fires immediately
 *                   after assessment completion — typically called from
 *                   the assessment submit handler AND from this cron for safety.
 *
 *   Step 1 (Day 3): Users where drip_step0 was sent ≥3 days ago and
 *                   drip_step1 hasn't been sent yet.
 *
 *   Step 2 (Day 7): Users where drip_step0 was sent ≥7 days ago and
 *                   drip_step2 hasn't been sent yet.
 *
 * Call hourly. Idempotent — each step is gated by its sent_at column.
 */
async function processDripEmails() {
  const results = { step0: 0, step1: 0, step2: 0, errors: 0 };

  // ── Step 0: Day 0 results recap ──────────────────────────────────────────
  // Users who completed their first assessment, notifications on, step 0 not sent.
  // "First" means earliest completed assessment by date, not by ID.
  // The subquery finds the minimum completed_at per user, then we match on a.id
  // so the JOIN still gives us the full row (completed_at, user data).
  const { rows: step0Candidates } = await pool.query(`
    SELECT u.id, u.email, u.name, a.id AS assessment_id, a.completed_at
    FROM users u
    JOIN assessments a ON a.user_id = u.id
    WHERE a.completed_at IS NOT NULL
      AND u.drip_step0_sent_at IS NULL
      AND (u.notifications_enabled IS NULL OR u.notifications_enabled = true)
      AND a.completed_at = (
        SELECT MIN(a2.completed_at)
        FROM assessments a2
        WHERE a2.user_id = u.id AND a2.completed_at IS NOT NULL
      )
  `);

  for (const user of step0Candidates) {
    try {
      const scores = await getAssessmentScores(user.assessment_id);
      if (scores.length === 0) continue;

      const arcScore = parseFloat((scores.reduce((s, r) => s + r.score, 0) / scores.length).toFixed(1));
      const topStrengths = [...scores].sort((a, b) => b.score - a.score).slice(0, 2);
      const focusAreas = scores.slice(0, 2); // already sorted asc

      await registerContact(user.email, user.name);
      const html = buildDripDay0Html(user.name, APP_URL, user.assessment_id, arcScore, topStrengths, focusAreas);
      const firstName = user.name ? user.name.split(' ')[0] : 'there';
      const plain = `Hey ${firstName} — your ArcScore is ${arcScore}/10.\n\nTop strengths: ${topStrengths.map(s => s.key).join(', ')}\nFocus areas: ${focusAreas.map(s => s.key).join(', ')}\n\nView full results: ${APP_URL}/results/${user.assessment_id}\n\nYou can retake in 7 days to see your progress.\n\nManage email preferences: ${APP_URL}/settings`;

      const { ok } = await sendEmail(
        user.email,
        `Your ArcScore: ${arcScore}/10 — results recap`,
        plain,
        html
      );

      if (ok) {
        await pool.query(
          `UPDATE users SET drip_assessment_id = $1, drip_step = 0, drip_step0_sent_at = NOW() WHERE id = $2`,
          [user.assessment_id, user.id]
        );
        logEvent(user.id, 'drip_email_sent', { step: 0, assessment_id: user.assessment_id }).catch(() => {});
        results.step0++;
      } else {
        results.errors++;
      }
    } catch (err) {
      console.error(`[cron/drip] step0 error for user ${user.id}:`, err.message);
      results.errors++;
    }
  }

  // ── Step 1: Day 3 growth opportunity ─────────────────────────────────────
  const { rows: step1Candidates } = await pool.query(`
    SELECT u.id, u.email, u.name, u.drip_assessment_id
    FROM users u
    WHERE u.drip_step0_sent_at IS NOT NULL
      AND u.drip_step0_sent_at <= NOW() - INTERVAL '3 days'
      AND u.drip_step1_sent_at IS NULL
      AND (u.notifications_enabled IS NULL OR u.notifications_enabled = true)
  `);

  for (const user of step1Candidates) {
    try {
      const scores = await getAssessmentScores(user.drip_assessment_id);
      if (scores.length === 0) continue;

      const lowestDim = scores[0]; // already sorted asc
      await registerContact(user.email, user.name);
      const html = buildDripDay3Html(user.name, APP_URL, lowestDim.key, lowestDim.score);
      const firstName = user.name ? user.name.split(' ')[0] : 'there';
      const plain = `Hey ${firstName} — your biggest growth area is ${lowestDim.key} (${lowestDim.score}/10).\n\nHere are 3 things to move the needle this week — then retake in 4 days to see if it moved.\n\nDashboard: ${APP_URL}/dashboard\n\nManage email preferences: ${APP_URL}/settings`;

      const { ok } = await sendEmail(
        user.email,
        `Your growth opportunity: ${lowestDim.key} (${lowestDim.score}/10)`,
        plain,
        html
      );

      if (ok) {
        await pool.query(
          `UPDATE users SET drip_step = 1, drip_step1_sent_at = NOW() WHERE id = $1`,
          [user.id]
        );
        logEvent(user.id, 'drip_email_sent', { step: 1, dimension: lowestDim.key }).catch(() => {});
        results.step1++;
      } else {
        results.errors++;
      }
    } catch (err) {
      console.error(`[cron/drip] step1 error for user ${user.id}:`, err.message);
      results.errors++;
    }
  }

  // ── Step 2: Day 7 retake prompt ───────────────────────────────────────────
  const { rows: step2Candidates } = await pool.query(`
    SELECT u.id, u.email, u.name, u.drip_assessment_id
    FROM users u
    WHERE u.drip_step0_sent_at IS NOT NULL
      AND u.drip_step0_sent_at <= NOW() - INTERVAL '7 days'
      AND u.drip_step2_sent_at IS NULL
      AND (u.notifications_enabled IS NULL OR u.notifications_enabled = true)
  `);

  for (const user of step2Candidates) {
    try {
      const scores = await getAssessmentScores(user.drip_assessment_id);
      if (scores.length === 0) continue;

      const arcScore = parseFloat((scores.reduce((s, r) => s + r.score, 0) / scores.length).toFixed(1));
      const lowestDim = scores[0];
      await registerContact(user.email, user.name);
      const html = buildDripDay7Html(user.name, APP_URL, arcScore, lowestDim.key);
      const firstName = user.name ? user.name.split(' ')[0] : 'there';
      const plain = `Hey ${firstName} — 7 days are up. Your retake window is open.\n\nYour original ArcScore was ${arcScore}/10. Time to see what moved.\n\nRetake now: ${APP_URL}/assess\n\nManage email preferences: ${APP_URL}/settings`;

      const { ok } = await sendEmail(
        user.email,
        `Time to retake — your 7-day window is open`,
        plain,
        html
      );

      if (ok) {
        await pool.query(
          `UPDATE users SET drip_step = 2, drip_step2_sent_at = NOW() WHERE id = $1`,
          [user.id]
        );
        logEvent(user.id, 'drip_email_sent', { step: 2, original_score: arcScore }).catch(() => {});
        results.step2++;
      } else {
        results.errors++;
      }
    } catch (err) {
      console.error(`[cron/drip] step2 error for user ${user.id}:`, err.message);
      results.errors++;
    }
  }

  return results;
}

router.post('/send-drip', requireCronSecret, async (req, res) => {
  try {
    const results = await processDripEmails();
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error('[cron] send-drip error:', err.message);
    res.status(500).json({ error: 'drip cron failed', message: err.message });
  }
});

router.get('/send-drip', requireCronSecret, async (req, res) => {
  try {
    const results = await processDripEmails();
    res.json({ ok: true, ...results });
  } catch (err) {
    console.error('[cron] send-drip error:', err.message);
    res.status(500).json({ error: 'drip cron failed', message: err.message });
  }
});

// Export processDripEmails so the assessment submit handler can call step 0 immediately
module.exports = router;
module.exports.processDripEmails = processDripEmails;
