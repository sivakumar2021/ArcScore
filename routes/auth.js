// routes/auth.js — owns /api/auth/* endpoints.
// Does NOT own user preferences, assessment logic, or email sending.
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { logEvent } = require('./analytics');
const { sendEmail, registerContact, buildWelcomeEmailHtml } = require('../services/email');

const APP_URL = process.env.APP_URL || 'https://arcscore.app';

const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const { email, name, password } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, name, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase().trim(), name.trim(), passwordHash]
    );

    const user = result.rows[0];
    req.session.userId = user.id;
    // Await session save before sending response — prevents race where
    // fast-following request (loadDashboard) finds empty session in DB.
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    // Track signup completion
    logEvent(user.id, 'signup_completed', { email: user.email }).catch(() => {});

    // Register contact then send welcome email (fire-and-forget — never block signup response)
    (async () => {
      try {
        await registerContact(user.email, user.name);
        const html = buildWelcomeEmailHtml(user.name, APP_URL);
        const plain = `Hey ${user.name ? user.name.split(' ')[0] : 'there'} — welcome to ArcScore!\n\nScore yourself across 9 life dimensions and track your progress over time.\n\nStart your first assessment (takes ~2 minutes):\n${APP_URL}/assess\n\nManage email preferences: ${APP_URL}/settings`;
        const { ok } = await sendEmail(user.email, 'Welcome to ArcScore — start your first assessment', plain, html);
        if (ok) {
          await pool.query('UPDATE users SET welcome_email_sent_at = NOW() WHERE id = $1', [user.id]);
          logEvent(user.id, 'welcome_email_sent', { email: user.email }).catch(() => {});
        }
      } catch (err) {
        console.error('[auth] welcome email error:', err.message);
      }
    })();

    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.userId = user.id;
    // Await session save so the DB write completes before the response.
    // Without this, connect-pg-simple saves asynchronously via pool.query,
    // and a fast-following request (e.g. loadDashboard -> /api/assessments)
    // can find an empty session, triggering "Not authenticated".
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  try {
    const result = await pool.query(
      'SELECT id, email, name, subscription_tier FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ user: null });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.json({ user: null });
  }
});

router.post('/check-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });
  const result = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  );
  res.json({ exists: result.rows.length > 0 });
});

// ─── MAGIC LINK AUTH ─────────────────────────────────────────────────────────

const crypto = require('crypto');

// Tokens: 48 random bytes → 96-char hex string. Single-use, 15-minute TTL.
const TOKEN_BYTES = 48;
const TOKEN_TTL_MS = 15 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function buildMagicLinkEmailHtml(greeting, magicUrl, isExistingUser) {
  const cta = isExistingUser ? 'Sign In to ArcScore' : 'Complete Your Account';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Your ArcScore Link</title></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">Arc<span style="color:#7c3aed;">Score</span></div>
            <p style="margin:8px 0 0;font-size:14px;color:#8b949e;">Your personal life assessment tracker</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 20px;font-size:16px;color:#e6edf3;">${greeting} 👋</p>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              Click the button below to ${isExistingUser ? 'sign in' : 'complete your account'}. This link expires in <strong style="color:#e6edf3;">15 minutes</strong>.
            </p>
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${magicUrl}" style="display:inline-block;padding:14px 32px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                ${cta} →
              </a>
            </div>
            <p style="margin:0;font-size:12px;color:#6e7681;line-height:1.5;">
              Or copy and paste: <span style="word-break:break-all;color:#7c3aed;">${magicUrl}</span>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              If you didn't request this, you can safely ignore this email.<br/>
              <a href="${APP_URL}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// POST /api/auth/magic/send — generate and email a magic link.
router.post('/magic/send', async (req, res) => {
  const { email, assessment_id } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  const normalized = email.trim().toLowerCase();

  const userResult = await pool.query(
    'SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)',
    [normalized]
  );
  const user = userResult.rows[0];

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await pool.query(
    `INSERT INTO magic_link_tokens (token, user_id, email, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, user?.id || null, normalized, expiresAt]
  );

  const assessmentParam = assessment_id ? `&assessment_id=${encodeURIComponent(assessment_id)}` : '';
  const magicUrl = `${APP_URL}/api/auth/magic/verify?token=${token}${assessmentParam}`;
  const firstName = user?.name?.split(' ')[0] || null;
  const subject = firstName ? `Your ArcScore sign-in link` : `Your ArcScore account link`;
  const greeting = firstName ? `Hey ${firstName}` : `Hey there`;
  const bodyText = firstName
    ? `${greeting} — click the link below to sign in. It expires in 15 minutes.\n\n${magicUrl}\n\nIf you didn't request this, ignore it.`
    : `${greeting} — click the link below to create your ArcScore account. It expires in 15 minutes.\n\n${magicUrl}\n\nIf you didn't request this, ignore it.`;
  const htmlBody = buildMagicLinkEmailHtml(greeting, magicUrl, !!firstName);

  if (!user) {
    registerContact(normalized, null).catch(() => {});
  }

  const { ok } = await sendEmail(normalized, subject, bodyText, htmlBody);

  if (!ok) {
    await pool.query('DELETE FROM magic_link_tokens WHERE token = $1', [token]);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  res.json({ ok: true, message: 'Check your email for a sign-in link.' });
});

// GET /api/auth/magic/verify?token=xxx — validate token, create session, redirect.
// Single-use: token deleted atomically in the same transaction as session creation.
router.get('/magic/verify', async (req, res) => {
  const { token, assessment_id } = req.query;
  if (!token || typeof token !== 'string' || token.length !== TOKEN_BYTES * 2) {
    return res.status(400).json({ error: 'Invalid token format' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await client.query(
      `DELETE FROM magic_link_tokens
       WHERE token = $1 AND expires_at > NOW()
       RETURNING id, user_id, email`,
      [token]
    );

    if (row.rows.length === 0) {
      await client.query('COMMIT');
      const expired = await pool.query(
        'SELECT 1 FROM magic_link_tokens WHERE token = $1 AND expires_at <= NOW()',
        [token]
      );
      const reason = expired.rows.length > 0 ? 'expired' : 'invalid';
      const msg = reason === 'expired'
        ? 'This sign-in link has expired. Please request a new one.'
        : 'This sign-in link is invalid. Please request a new one.';
      return res.status(410).json({ error: msg });
    }

    const record = row.rows[0];

    if (record.user_id !== null) {
      const userRow = await client.query(
        'SELECT id, email, name FROM users WHERE id = $1',
        [record.user_id]
      );
      if (userRow.rows.length === 0) {
        await client.query('COMMIT');
        return res.status(404).json({ error: 'Account not found.' });
      }
      const user = userRow.rows[0];
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
      });
      await client.query('COMMIT');
      logEvent(user.id, 'login_magic', {}).catch(() => {});
      if (assessment_id) {
        return res.redirect(`${APP_URL}/assess?resumed=1&assessment_id=${encodeURIComponent(assessment_id)}`);
      }
      return res.redirect(`${APP_URL}/dashboard?magic=success`);
    }

    // New-account flow: store token info in session, redirect to signup completion
    req.session.magicPendingTokenRecord = { id: record.id, email: record.email };
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    await client.query('COMMIT');
    const signupAssessParam = assessment_id ? `&assessment_id=${encodeURIComponent(assessment_id)}` : '';
    return res.redirect(`${APP_URL}/signup?magic=pending${signupAssessParam}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[magic verify] error:', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  } finally {
    client.release();
  }
});

// POST /api/auth/magic/complete-signup — create account after magic link for new user.
// Requires session.magicPendingTokenRecord set by the verify endpoint.
router.post('/magic/complete-signup', async (req, res) => {
  if (!req.session.magicPendingTokenRecord) {
    return res.status(400).json({
      error: 'No pending magic link session. Please use the link from your email.',
    });
  }

  const { name, password } = req.body || {};
  if (!name || !password || password.length < 6) {
    return res.status(400).json({ error: 'Name and password (6+ chars) are required' });
  }

  const { id: tokenRecordId, email } = req.session.magicPendingTokenRecord;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenRow = await client.query(
      `DELETE FROM magic_link_tokens
       WHERE id = $1 AND user_id IS NULL AND expires_at > NOW()
       RETURNING id`,
      [tokenRecordId]
    );
    if (tokenRow.rows.length === 0) {
      await client.query('COMMIT');
      delete req.session.magicPendingTokenRecord;
      return res.status(410).json({ error: 'Magic link expired. Please request a new one.' });
    }

    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      delete req.session.magicPendingTokenRecord;
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userResult = await client.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, name.trim(), passwordHash]
    );
    const user = userResult.rows[0];

    req.session.userId = user.id;
    delete req.session.magicPendingTokenRecord;
    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });
    await client.query('COMMIT');

    logEvent(user.id, 'signup_completed', { email: user.email }).catch(() => {});

    (async () => {
      try {
        await registerContact(user.email, user.name);
        const html = buildWelcomeEmailHtml(user.name, APP_URL);
        const plain = `Hey ${user.name ? user.name.split(' ')[0] : 'there'} — welcome to ArcScore!\n\nScore yourself across 9 life dimensions and track your progress over time.\n\nStart your first assessment (takes ~2 minutes):\n${APP_URL}/assess\n\nManage email preferences: ${APP_URL}/settings`;
        const { ok } = await sendEmail(user.email, 'Welcome to ArcScore — start your first assessment', plain, html);
        if (ok) {
          await pool.query('UPDATE users SET welcome_email_sent_at = NOW() WHERE id = $1', [user.id]);
          logEvent(user.id, 'welcome_email_sent', { email: user.email }).catch(() => {});
        }
      } catch (err) {
        console.error('[auth] welcome email error:', err.message);
      }
    })();

    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[magic complete-signup] error:', err.message);
    delete req.session.magicPendingTokenRecord;
    res.status(500).json({ error: 'Failed to create account.' });
  } finally {
    client.release();
  }
});

module.exports = router;
