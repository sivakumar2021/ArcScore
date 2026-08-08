// routes/assessments.js -- owns /api/assessments/* and assessment insights endpoint.
// Does NOT own insight generation engine (routes/insights.js) or life events (routes/life-events.js).
// Does NOT own public share page rendering (routes/share.js handles /api/shared/:token).
const express = require('express');
const crypto = require('crypto');
const pool = require('../db');
const { logEvent } = require('./analytics');
// Fire-and-forget: kick off drip step 0 immediately on first assessment completion.
// The cron job also processes step 0 hourly as a safety net.
const { processDripEmails } = require('./cron');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// POST /api/assessments/guest -- start a guest assessment (no auth required).
// Visitor answers all questions without signing in, then links to account at completion.
router.post('/guest', async (req, res) => {
  try {
    const { email } = req.body || {};
    const result = await pool.query(
      'INSERT INTO assessments (user_id, is_guest, guest_email) VALUES (NULL, true, $1) RETURNING id, created_at',
      [email ? email.trim().toLowerCase() : null]
    );
    res.status(201).json({ assessment: { id: result.rows[0].id, created_at: result.rows[0].created_at } });
  } catch (err) {
    console.error('Create guest assessment error:', err);
    res.status(500).json({ error: 'Failed to create assessment' });
  }
});

// POST /api/assessments/guest/submit -- complete guest assessment and create/link account.
// Unauthenticated endpoint. Creates account (or finds existing), assigns assessment, sends results.
router.post('/guest/submit', async (req, res) => {
  const { assessment_id, email, name, password, scores, responses } = req.body;

  if (!assessment_id || !email) {
    return res.status(400).json({ error: 'assessment_id and email are required' });
  }

  // Verify assessment exists and is a guest assessment
  let guestAssmt;
  try {
    const a = await pool.query(
      'SELECT id, user_id, guest_email FROM assessments WHERE id = $1',
      [assessment_id]
    );
    if (a.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });
    guestAssmt = a.rows[0];
  } catch (err) {
    return res.status(500).json({ error: 'Database error' });
  }

  if (guestAssmt.user_id !== null) {
    return res.status(400).json({ error: 'Assessment already linked to an account' });
  }

  // Check if account exists with this email
  const existingUser = await pool.query(
    'SELECT id, password_hash FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim().toLowerCase()]
  );

  let userId;
  if (existingUser.rows.length > 0) {
    // Existing user — must log in with password
    return res.status(409).json({
      error: 'existing_account',
      message: 'An account with this email already exists. Please log in first.',
      existing_email: email
    });
  }

  // Create new account
  const bcrypt = require('bcryptjs');
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  if (!passwordHash) {
    return res.status(400).json({ error: 'Password is required to create an account' });
  }

  const userResult = await pool.query(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
    [email.trim().toLowerCase(), name ? name.trim() : null, passwordHash]
  );
  const newUser = userResult.rows[0];
  userId = newUser.id;

  req.session.userId = userId;
  await new Promise((resolve, reject) => {
    req.session.save((err) => err ? reject(err) : resolve());
  });

  // Submit the assessment under the new user account
  const client = await pool.connect();
  try {
    // Assign assessment to user and write scores
    await client.query('BEGIN');
    await client.query(
      'UPDATE assessments SET user_id = $1, completed_at = NOW() WHERE id = $2',
      [userId, assessment_id]
    );

    for (const s of (scores || [])) {
      await client.query(
        `INSERT INTO assessment_scores (assessment_id, dimension_id, score)
         VALUES ($1, $2, $3) ON CONFLICT (assessment_id, dimension_id) DO UPDATE SET score = $3`,
        [assessment_id, s.dimension_id, s.score]
      );
    }
    for (const r of (responses || [])) {
      await client.query(
        `INSERT INTO assessment_responses (assessment_id, question_id, score)
         VALUES ($1, $2, $3) ON CONFLICT (assessment_id, question_id) DO UPDATE SET score = $3`,
        [assessment_id, r.question_id, r.score]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Guest submit score write error:', err);
  } finally {
    client.release();
  }

  logEvent(userId, 'signup_completed', { email: newUser.email }).catch(() => {});
  logEvent(userId, 'assessment_completed', { assessment_id, source: 'guest' }).catch(() => {});

  // Send welcome email
  (async () => {
    try {
      const { registerContact, sendEmail, buildWelcomeEmailHtml } = require('../services/email');
      const APP_URL = process.env.APP_URL || 'https://arcscore.app';
      await registerContact(newUser.email, newUser.name);
      const html = buildWelcomeEmailHtml(newUser.name, APP_URL);
      const firstName = newUser.name ? newUser.name.split(' ')[0] : 'there';
      const plain = `Hey ${firstName} — welcome to ArcScore!\n\nYour assessment is complete. View your results:\n${APP_URL}/results/${assessment_id}\n\nStart tracking your progress: ${APP_URL}/dashboard`;
      const { ok } = await sendEmail(newUser.email, 'Welcome to ArcScore — your results are ready', plain, html);
      if (ok) {
        await pool.query('UPDATE users SET welcome_email_sent_at = NOW() WHERE id = $1', [userId]);
        logEvent(userId, 'welcome_email_sent', {}).catch(() => {});
      }
      processDripEmails().catch(err => console.error('[drip] guest trigger error:', err.message));
    } catch (err) {
      console.error('[auth] guest welcome email error:', err.message);
    }
  })();

  res.status(201).json({
    user: { id: newUser.id, email: newUser.email, name: newUser.name },
    assessment_id,
    redirect: `/results/${assessment_id}`
  });
});

// GET /api/dimensions
router.get('/dimensions', async (req, res) => {
  try {
    const dims = await pool.query('SELECT id, key, name, icon, description FROM dimensions ORDER BY sort_order');
    const questions = await pool.query('SELECT id, dimension_id, question_text FROM dimension_questions ORDER BY sort_order');
    const result = dims.rows.map(d => ({ ...d, questions: questions.rows.filter(q => q.dimension_id === d.id) }));
    res.json({ dimensions: result });
  } catch (err) {
    console.error('Dimensions error:', err);
    res.status(500).json({ error: 'Failed to load dimensions' });
  }
});

// POST /api/assessments -- start a new assessment
// Enforces 7-day minimum between assessments
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    // Check most recent completed assessment
    const lastResult = await pool.query(
      `SELECT completed_at FROM assessments
       WHERE user_id = $1 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [userId]
    );

    if (lastResult.rows.length > 0) {
      const lastDate = new Date(lastResult.rows[0].completed_at);
      const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
      // Guard: negative daysSince means completed_at is in the future (timezone
      // mismatch or data corruption) — treat as no completed assessment.
      if (daysSince >= 0 && daysSince < 7) {
        const daysRemaining = Math.ceil(7 - daysSince);
        return res.status(429).json({
          error: 'Too soon to retake',
          message: `Come back in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} for your next assessment.`,
          days_remaining: daysRemaining
        });
      }
    }

    const result = await pool.query(
      'INSERT INTO assessments (user_id) VALUES ($1) RETURNING id, created_at',
      [userId]
    );
    logEvent(userId, 'assessment_started', { assessment_id: result.rows[0].id }).catch(() => {});
    res.status(201).json({ assessment: result.rows[0] });
  } catch (err) {
    console.error('Create assessment error:', err);
    res.status(500).json({ error: 'Failed to create assessment' });
  }
});

// POST /api/assessments/:id/submit
router.post('/:id/submit', requireAuth, async (req, res) => {
  const assessmentId = parseInt(req.params.id, 10);
  if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

  const client = await pool.connect();
  try {
    const { scores, responses, notes } = req.body;

    const assessment = await client.query(
      'SELECT id, user_id FROM assessments WHERE id = $1 AND user_id = $2',
      [assessmentId, req.session.userId]
    );
    if (assessment.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    await client.query('BEGIN');

    for (const s of scores) {
      await client.query(
        `INSERT INTO assessment_scores (assessment_id, dimension_id, score)
         VALUES ($1, $2, $3)
         ON CONFLICT (assessment_id, dimension_id) DO UPDATE SET score = $3`,
        [assessmentId, s.dimension_id, s.score]
      );
    }

    if (responses && responses.length > 0) {
      for (const r of responses) {
        await client.query(
          `INSERT INTO assessment_responses (assessment_id, question_id, score)
           VALUES ($1, $2, $3)
           ON CONFLICT (assessment_id, question_id) DO UPDATE SET score = $3`,
          [assessmentId, r.question_id, r.score]
        );
      }
    }

    await client.query('UPDATE assessments SET completed_at = NOW(), notes = $2 WHERE id = $1', [assessmentId, notes || null]);
    await client.query('COMMIT');

    logEvent(req.session.userId, 'assessment_completed', { assessment_id: assessmentId }).catch(() => {});

    // Kick off drip step 0 immediately on completion — fire-and-forget, non-blocking.
    // processDripEmails handles all three steps; only step 0 will match for this user right now.
    processDripEmails().catch(err => console.error('[drip] immediate trigger error:', err.message));

    res.json({ ok: true, assessment_id: assessmentId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Submit assessment error:', err);
    res.status(500).json({ error: 'Failed to submit assessment' });
  } finally {
    client.release();
  }
});

// GET /api/assessments
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.completed_at, a.created_at, a.notes,
              json_agg(json_build_object('dimension_id', s.dimension_id, 'dimension_key', d.key,
                'dimension_name', d.name, 'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order) as scores
       FROM assessments a
       LEFT JOIN assessment_scores s ON s.assessment_id = a.id
       LEFT JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
       GROUP BY a.id ORDER BY a.completed_at DESC`,
      [req.session.userId]
    );
    res.json({ assessments: result.rows });
  } catch (err) {
    console.error('Get assessments error:', err);
    res.status(500).json({ error: 'Failed to load assessments' });
  }
});

// GET /api/assessments/timeline -- must precede /:id
router.get('/timeline', requireAuth, async (req, res) => {
  try {
    const assessmentsResult = await pool.query(
      `SELECT a.id, a.completed_at, a.notes,
              json_agg(json_build_object('dimension_key', d.key, 'dimension_name', d.name,
                'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order) as scores
       FROM assessments a
       LEFT JOIN assessment_scores s ON s.assessment_id = a.id
       LEFT JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
       GROUP BY a.id ORDER BY a.completed_at ASC`,
      [req.session.userId]
    );
    const eventsResult = await pool.query(
      `SELECT id, event_type, title, description, occurred_at, dimensions_affected
       FROM life_events WHERE user_id = $1 ORDER BY occurred_at ASC`,
      [req.session.userId]
    );
    res.json({ assessments: assessmentsResult.rows, life_events: eventsResult.rows });
  } catch (err) {
    console.error('Timeline error:', err);
    res.status(500).json({ error: 'Failed to load timeline data' });
  }
});

// GET /api/assessments/history -- must precede /:id
router.get('/history', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.completed_at,
              COALESCE(json_agg(json_build_object('dimension_id', s.dimension_id, 'dimension_key', d.key,
                'dimension_name', d.name, 'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order)
                FILTER (WHERE s.dimension_id IS NOT NULL), '[]') as scores
       FROM assessments a
       LEFT JOIN assessment_scores s ON s.assessment_id = a.id
       LEFT JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
       GROUP BY a.id ORDER BY a.completed_at DESC`,
      [req.session.userId]
    );

    const assessments = result.rows.map(a => {
      const scores = Array.isArray(a.scores) ? a.scores.filter(s => s.dimension_id !== null) : [];
      const overall = scores.length > 0
        ? parseFloat((scores.reduce((sum, s) => sum + s.score, 0) / scores.length).toFixed(1)) : null;
      return { ...a, overall_score: overall };
    });

    let daysSinceLast = null;
    if (assessments.length > 0) {
      daysSinceLast = Math.floor((Date.now() - new Date(assessments[0].completed_at).getTime()) / (1000 * 60 * 60 * 24));
    }

    const userResult = await pool.query('SELECT assessment_cadence_days, notifications_enabled FROM users WHERE id = $1', [req.session.userId]);
    const row = userResult.rows[0] || {};
    const cadenceDays = row.assessment_cadence_days || 30;
    const notificationsEnabled = row.notifications_enabled !== false;

    res.json({ assessments, days_since_last: daysSinceLast, cadence_days: cadenceDays,
      notifications_enabled: notificationsEnabled, show_reminder: daysSinceLast !== null && daysSinceLast >= cadenceDays });
  } catch (err) {
    console.error('Assessment history error:', err);
    res.status(500).json({ error: 'Failed to load assessment history' });
  }
});

// GET /api/assessments/re-engagement-check -- must precede /:id
router.get('/re-engagement-check', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const recentPromptResult = await pool.query(
      `SELECT id FROM re_engagement_prompts WHERE user_id = $1 AND shown_at > NOW() - INTERVAL '7 days' ORDER BY shown_at DESC LIMIT 1`,
      [userId]
    );
    if (recentPromptResult.rows.length > 0) return res.json({ show_prompt: false, reason: 'recent_prompt' });

    const userResult = await pool.query('SELECT assessment_cadence_days FROM users WHERE id = $1', [userId]);
    const cadenceDays = userResult.rows.length > 0 ? (userResult.rows[0].assessment_cadence_days || 30) : 30;

    const lastAssessmentResult = await pool.query(
      `SELECT completed_at FROM assessments WHERE user_id = $1 AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 1`,
      [userId]
    );
    if (lastAssessmentResult.rows.length === 0) return res.json({ show_prompt: false, reason: 'no_assessments' });

    const daysSinceLast = Math.floor((Date.now() - new Date(lastAssessmentResult.rows[0].completed_at).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceLast >= cadenceDays) return res.json({ show_prompt: false, reason: 'time_reminder_active' });

    const DIMENSION_NAMES = { fitness: 'Physical', financial: 'Financial', relationships: 'Relationships',
      career: 'Career', mental_health: 'Mental', learning: 'Learning', social: 'Social', habits: 'Habits', purpose: 'Purpose' };

    const insightsResult = await pool.query(
      `SELECT dimension_key, pattern, confidence, description FROM insights
       WHERE user_id = $1 AND insight_type = 'trend_fall' AND dimension_key IS NOT NULL
       ORDER BY confidence DESC LIMIT 1`,
      [userId]
    );
    if (insightsResult.rows.length === 0) return res.json({ show_prompt: false, reason: 'no_declining_dimensions' });

    const declining = insightsResult.rows[0];
    const dimName = DIMENSION_NAMES[declining.dimension_key] || declining.dimension_key;

    const promptResult = await pool.query(
      `INSERT INTO re_engagement_prompts (user_id, dimension_key, prompt_type, metadata)
       VALUES ($1, $2, 'phase_decline', $3) RETURNING id`,
      [userId, declining.dimension_key, JSON.stringify({ pattern: declining.pattern, confidence: declining.confidence })]
    );

    res.json({ show_prompt: true, prompt_id: promptResult.rows[0].id, dimension_key: declining.dimension_key,
      dimension_name: dimName, pattern: declining.pattern, confidence: declining.confidence,
      message: `Your ${dimName} score has been trending down. Time for a check-in?`, sub_message: declining.pattern });
  } catch (err) {
    console.error('Re-engagement check error:', err);
    res.status(500).json({ error: 'Failed to check re-engagement' });
  }
});

// ---- Personalized recommendations content (dimension x score tier) ----
// Hardcoded content map. No external API needed.
const DIMENSION_RECS = {
  fitness: {
    low:       { headline: 'Time to move', actions: ['Start with 10-minute daily walks', 'Track steps with your phone', 'Sleep 7-8 hours consistently'] },
    medium:    { headline: 'Room to grow', actions: ['Add 2 strength sessions per week', 'Experiment with a new sport or class', 'Audit your sleep quality'] },
    high:      { headline: 'Strong foundation', actions: ['Maintain current habits -- consistency compounds', 'Add mobility or recovery work', 'Track a new fitness metric'] },
    excellent: { headline: 'Exceptional', actions: ['Share what is working -- coach someone', 'Set a stretch performance goal', 'Use this as an anchor when other areas dip'] }
  },
  financial: {
    low:       { headline: 'Start tracking', actions: ['List all income and fixed expenses', 'Set up automatic savings -- even $10/mo', 'Cancel one unused subscription'] },
    medium:    { headline: 'Build momentum', actions: ['Increase savings rate by 2%', 'Pay off one small debt to build confidence', 'Learn one investing concept this month'] },
    high:      { headline: 'Solid ground', actions: ['Automate investments toward long-term goals', 'Review insurance coverage', 'Build or strengthen your emergency fund'] },
    excellent: { headline: 'Financial leverage', actions: ['Optimize your tax strategy', 'Explore passive income streams', 'Help a peer build a budget'] }
  },
  relationships: {
    low:       { headline: 'Invest in connection', actions: ['Text one person you have lost touch with', 'Schedule a weekly call with someone who matters', 'Practice being fully present in conversations'] },
    medium:    { headline: 'Deepen the bonds', actions: ['Have one honest conversation this week', 'Set aside phone-free time with close people', 'Express appreciation to someone directly'] },
    high:      { headline: 'Thriving connections', actions: ['Maintain rituals that keep relationships alive', 'Support someone going through a hard time', 'Introduce people in your network'] },
    excellent: { headline: 'Deeply connected', actions: ['Be the relationship anchor others lean on', 'Mentor or sponsor someone', 'Invest in a new community'] }
  },
  career: {
    low:       { headline: 'Clarify your direction', actions: ['Write down what you actually want from work', 'Request one piece of feedback from a colleague', 'Learn one skill adjacent to your role'] },
    medium:    { headline: 'Level up', actions: ['Take on a visible stretch project', 'Build a relationship with someone senior', 'Track your wins weekly'] },
    high:      { headline: 'On track', actions: ['Identify your next career milestone', 'Mentor a junior team member', 'Invest in a course or credential'] },
    excellent: { headline: 'Career leader', actions: ['Articulate your personal brand', 'Sponsor others, not just mentor', 'Explore whether your ceiling is the role or the company'] }
  },
  mental_health: {
    low:       { headline: 'Prioritize recovery', actions: ['Talk to someone -- friend, coach, or therapist', 'Reduce one major stressor this week', 'Build a 5-minute morning grounding ritual'] },
    medium:    { headline: 'Build resilience', actions: ['Practice daily mindfulness (Calm, Waking Up apps)', 'Identify what drains you and reduce exposure', 'Journal for 10 minutes before bed'] },
    high:      { headline: 'Stable and grounded', actions: ['Maintain your stress management toolkit', 'Notice early warning signs of burnout', 'Share coping strategies with others'] },
    excellent: { headline: 'Thriving mentally', actions: ['Use your resilience to take on hard things', 'Deepen your self-awareness practice', 'Model mental health habits for those around you'] }
  },
  learning: {
    low:       { headline: 'Reignite curiosity', actions: ['Read 10 pages of anything non-fiction today', 'Subscribe to one newsletter in a topic you care about', 'Watch one educational video per day'] },
    medium:    { headline: 'Grow deliberately', actions: ['Set a specific learning goal for this month', 'Take a course in a skill you want', 'Teach something you learned to someone else'] },
    high:      { headline: 'Active learner', actions: ['Build a second-brain system for notes and ideas', 'Apply learning to a real project', 'Go deeper on a topic -- read 3 books on it'] },
    excellent: { headline: 'Knowledge compounding', actions: ['Write or publish what you have learned', 'Create a learning plan for the year', 'Find peers at your level to challenge you'] }
  },
  social: {
    low:       { headline: 'Reconnect', actions: ['Accept the next social invite even if tired', 'Join one group aligned with an interest', 'Make one new acquaintance this week'] },
    medium:    { headline: 'Expand your circle', actions: ['Attend one community or networking event', 'Be the one to initiate plans', 'Diversify who you spend time with'] },
    high:      { headline: 'Well-connected', actions: ['Deepen key relationships beyond surface chat', 'Host something -- bring people together', 'Be a connector in your community'] },
    excellent: { headline: 'Socially thriving', actions: ['Lead or build a community', 'Invest in relationships that challenge you', 'Mentor or sponsor others'] }
  },
  habits: {
    low:       { headline: 'Start small', actions: ['Pick one habit and do it for 7 days straight', 'Attach it to something you already do (habit stacking)', 'Track it with a simple checkmark'] },
    medium:    { headline: 'Build the stack', actions: ['Add a second habit once the first is automatic', 'Eliminate one bad habit by removing the cue', 'Review your weekly routine -- what is working?'] },
    high:      { headline: 'Consistent systems', actions: ['Protect your habits during travel and disruption', 'Review and optimize your system quarterly', 'Document it so you can rebuild it fast'] },
    excellent: { headline: 'Habit mastery', actions: ['Coach someone on building habits', 'Tackle your hardest habit -- you are ready', 'Design your environment to make good defaults effortless'] }
  },
  purpose: {
    low:       { headline: 'Find your thread', actions: ['Write about what you would do if money were no concern', 'Identify three things that make you lose track of time', 'Volunteer for something that feels meaningful'] },
    medium:    { headline: 'Deepen your why', actions: ['Align one current project with a value you hold', 'Explore a spiritual or meditative practice', 'Read a biography of someone whose life feels purposeful'] },
    high:      { headline: 'Purpose-driven', actions: ['Express your purpose through creative or service work', 'Connect daily actions to the bigger picture', 'Reflect on legacy -- what do you want to build?'] },
    excellent: { headline: 'Living with purpose', actions: ['Inspire others by sharing your story', 'Take on a mission-level project', 'Help others find their own thread'] }
  }
};

const DIM_DISPLAY = {
  fitness: 'Physical', financial: 'Financial', relationships: 'Relationships',
  career: 'Career', mental_health: 'Mental', learning: 'Learning',
  social: 'Social', habits: 'Habits', purpose: 'Purpose'
};

function scoreToTier(score) {
  if (score <= 3) return 'low';
  if (score <= 6) return 'medium';
  if (score <= 9) return 'high';
  return 'excellent';
}

// GET /api/assessments/:id/insights -- personalized per-dimension recommendations
// Must be declared before GET /:id to avoid Express matching "insights" as the ID param
router.get('/:id/insights', requireAuth, async (req, res) => {
  const assessmentId = parseInt(req.params.id, 10);
  if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

  try {
    const assessment = await pool.query(
      'SELECT id FROM assessments WHERE id = $1 AND user_id = $2 AND completed_at IS NOT NULL',
      [assessmentId, req.session.userId]
    );
    if (assessment.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    const scoresResult = await pool.query(
      `SELECT s.score, d.key FROM assessment_scores s
       JOIN dimensions d ON d.id = s.dimension_id WHERE s.assessment_id = $1`,
      [assessmentId]
    );

    const dimensionInsights = scoresResult.rows.map(row => {
      const tier = scoreToTier(row.score);
      const content = DIMENSION_RECS[row.key] && DIMENSION_RECS[row.key][tier];
      return {
        key: row.key,
        name: DIM_DISPLAY[row.key] || row.key,
        score: row.score,
        tier,
        headline: content ? content.headline : tier,
        actions: content ? content.actions : []
      };
    });

    // Sort by score ascending -- lowest scores (most needing attention) appear first
    dimensionInsights.sort((a, b) => a.score - b.score);

    const focusAreas = dimensionInsights.slice(0, 2).map(d => d.key);
    const strengths = [...dimensionInsights].sort((a, b) => b.score - a.score).slice(0, 2).map(d => d.key);
    const biggestOpportunity = dimensionInsights[0] ? dimensionInsights[0].key : null;

    logEvent(req.session.userId, 'insights_viewed', { assessment_id: assessmentId }).catch(() => {});

    // Compute days remaining before retake is allowed (7-day minimum)
    const retakeResult = await pool.query(
      `SELECT completed_at FROM assessments WHERE user_id = $1 AND completed_at IS NOT NULL
       ORDER BY completed_at DESC LIMIT 1`,
      [req.session.userId]
    );
    let retakeDaysRemaining = 0;
    if (retakeResult.rows.length > 0) {
      const daysSince = (Date.now() - new Date(retakeResult.rows[0].completed_at).getTime()) / (1000 * 60 * 60 * 24);
      retakeDaysRemaining = Math.max(0, Math.ceil(7 - daysSince));
    }

    res.json({
      dimension_insights: dimensionInsights,
      focus_areas: focusAreas,
      strengths,
      biggest_opportunity: biggestOpportunity,
      retake_days_remaining: retakeDaysRemaining
    });
  } catch (err) {
    console.error('Assessment insights error:', err);
    res.status(500).json({ error: 'Failed to load insights' });
  }
});

// GET /api/assessments/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const assessmentId = parseInt(req.params.id, 10);
    if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

    const assessment = await pool.query(
      `SELECT a.id, a.completed_at, a.created_at, a.notes FROM assessments a WHERE a.id = $1 AND a.user_id = $2`,
      [assessmentId, req.session.userId]
    );
    if (assessment.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    const scores = await pool.query(
      `SELECT s.dimension_id, s.score, d.key, d.name, d.icon FROM assessment_scores s
       JOIN dimensions d ON d.id = s.dimension_id WHERE s.assessment_id = $1 ORDER BY d.sort_order`,
      [assessmentId]
    );
    const responses = await pool.query(
      `SELECT r.question_id, r.score, q.question_text, q.dimension_id FROM assessment_responses r
       JOIN dimension_questions q ON q.id = r.question_id WHERE r.assessment_id = $1 ORDER BY q.dimension_id, q.sort_order`,
      [assessmentId]
    );

    res.json({ assessment: { ...assessment.rows[0], scores: scores.rows, responses: responses.rows } });
  } catch (err) {
    console.error('Get assessment error:', err);
    res.status(500).json({ error: 'Failed to load assessment' });
  }
});

// POST /api/assessments/:id/share -- generate (or return existing) share token
router.post('/:id/share', requireAuth, async (req, res) => {
  const assessmentId = parseInt(req.params.id, 10);
  if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

  try {
    // Check ownership + completion
    const check = await pool.query(
      'SELECT id, share_token FROM assessments WHERE id = $1 AND user_id = $2 AND completed_at IS NOT NULL',
      [assessmentId, req.session.userId]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    // Return existing token if already generated (idempotent)
    if (check.rows[0].share_token) {
      return res.json({ share_token: check.rows[0].share_token });
    }

    // Generate a URL-safe token (32 random bytes -> 43-char base64url string)
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query('UPDATE assessments SET share_token = $1 WHERE id = $2', [token, assessmentId]);

    logEvent(req.session.userId, 'share_initiated', { assessment_id: assessmentId }).catch(() => {});
    res.json({ share_token: token });
  } catch (err) {
    console.error('Share token error:', err);
    res.status(500).json({ error: 'Failed to generate share token' });
  }
});

// POST /api/assessments/:id/claim — authenticated; links a guest assessment to the session user.
// Called immediately after signup/login when the user just finished answering as a guest.
router.post('/:id/claim', requireAuth, async (req, res) => {
  const assessmentId = parseInt(req.params.id, 10);
  if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

  const { scores, responses } = req.body;
  if (!scores || !scores.length) return res.status(400).json({ error: 'scores are required' });

  const check = await pool.query(
    'SELECT id, user_id FROM assessments WHERE id = $1',
    [assessmentId]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });
  if (check.rows[0].user_id !== null) {
    return res.status(409).json({ error: 'Assessment already claimed' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE assessments SET user_id = $1, completed_at = NOW(), is_guest = FALSE WHERE id = $2',
      [req.session.userId, assessmentId]
    );
    for (const s of scores) {
      await client.query(
        `INSERT INTO assessment_scores (assessment_id, dimension_id, score)
         VALUES ($1, $2, $3) ON CONFLICT (assessment_id, dimension_id) DO UPDATE SET score = $3`,
        [assessmentId, s.dimension_id, s.score]
      );
    }
    for (const r of (responses || [])) {
      await client.query(
        `INSERT INTO assessment_responses (assessment_id, question_id, score)
         VALUES ($1, $2, $3) ON CONFLICT (assessment_id, question_id) DO UPDATE SET score = $3`,
        [assessmentId, r.question_id, r.score]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Claim assessment error:', err);
    return res.status(500).json({ error: 'Failed to claim assessment' });
  }
  client.release();

  logEvent(req.session.userId, 'assessment_completed', { assessment_id: assessmentId, source: 'guest_claim' }).catch(() => {});
  processDripEmails().catch(err => console.error('[drip] claim trigger error:', err.message));

  res.json({ ok: true, assessment_id: assessmentId });
});

module.exports = router;
