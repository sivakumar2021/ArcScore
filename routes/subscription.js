// routes/subscription.js — owns subscription status endpoints and Stripe checkout success handler.
// Does NOT own auth, user preferences, or assessment logic.
const express = require('express');
const pool = require('../db');

const router = express.Router();

const POLSIA_API_URL = process.env.POLSIA_API_URL
  ? process.env.POLSIA_API_URL.replace('/api/proxy/ai', '')
  : 'https://polsia.com';
const POLSIA_API_KEY = process.env.POLSIA_API_KEY;

// Maps Stripe product names back to internal tier slugs
const PRODUCT_NAME_TO_TIER = {
  'ArcScore I Got It':          'i-got-it',
  'I Got It':                   'i-got-it',
  'ArcScore I Need Guidance':   'i-need-guidance',
  'I Need Guidance':            'i-need-guidance',
  'ArcScore I Need Help':       'i-need-help',
  'I Need Help':                'i-need-help',
  'ArcScore I Need Focused Help': 'i-need-focused-help',
  'I Need Focused Help':        'i-need-focused-help',
};

const TIER_LABELS = {
  'i-got-it':           'I Got It',
  'i-need-guidance':    'I Need Guidance',
  'i-need-help':        'I Need Help',
  'i-need-focused-help':'I Need Focused Help',
};

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /payment/success — Stripe redirects here after checkout.
// Verifies the session, records the tier on the user, then redirects to dashboard.
router.get('/success', async (req, res) => {
  const sessionId = req.query.session_id || req.query.checkout_session_id;
  const planHint  = req.query.plan; // e.g. "i-need-help" passed in success_url

  if (!sessionId) {
    return res.redirect('/dashboard?payment=missing_session');
  }

  try {
    // Verify payment with Polsia platform
    const verifyResp = await fetch(
      `${POLSIA_API_URL}/api/company-payments/verify?session_id=${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${POLSIA_API_KEY}` } }
    );

    if (!verifyResp.ok) {
      console.error('[subscription] verify response not ok:', verifyResp.status);
      return res.redirect('/dashboard?payment=verify_failed');
    }

    const { verified, payment } = await verifyResp.json();

    if (!verified) {
      return res.redirect('/pricing?payment=not_verified');
    }

    // Resolve tier from product name → plan hint → default
    const tier = PRODUCT_NAME_TO_TIER[payment?.product_name]
      || planHint
      || 'i-got-it';

    // Update user by email (session may or may not exist — Stripe customer email is authoritative)
    const customerEmail = payment?.customer_email;
    if (customerEmail) {
      await pool.query(
        `UPDATE users
         SET subscription_tier = $1,
             subscription_stripe_session_id = $2,
             subscription_activated_at = NOW()
         WHERE LOWER(email) = LOWER($3)`,
        [tier, sessionId, customerEmail]
      );
    }

    // If user is already logged in, refresh session tier
    if (req.session.userId) {
      await pool.query(
        `UPDATE users
         SET subscription_tier = $1,
             subscription_stripe_session_id = $2,
             subscription_activated_at = NOW()
         WHERE id = $3`,
        [tier, sessionId, req.session.userId]
      );
    }

    // Redirect to dashboard with success indicator
    res.redirect(`/dashboard?payment=success&plan=${encodeURIComponent(tier)}`);
  } catch (err) {
    console.error('[subscription] payment success error:', err.message);
    res.redirect('/dashboard?payment=error');
  }
});

// GET /api/subscription/status — returns current user's subscription info
router.get('/status', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT subscription_tier, subscription_activated_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const row = result.rows[0];
    const tier = row.subscription_tier || null;
    res.json({
      tier,
      label: tier ? (TIER_LABELS[tier] || tier) : null,
      active: !!tier,
      activated_at: row.subscription_activated_at,
    });
  } catch (err) {
    console.error('[subscription] status error:', err.message);
    res.status(500).json({ error: 'Failed to load subscription status' });
  }
});

// GET /api/subscription/plans — returns Stripe payment link URLs for each tier.
// URLs are configured via STRIPE_LINK_* env vars. Falls back to signup flow if not set.
router.get('/plans', (req, res) => {
  const base = '/signup';
  res.json({
    'i-got-it': {
      label: 'I Got It',
      price: 1,
      url: process.env.STRIPE_LINK_I_GOT_IT || `${base}?plan=i-got-it`,
    },
    'i-need-guidance': {
      label: 'I Need Guidance',
      price: 5,
      url: process.env.STRIPE_LINK_I_NEED_GUIDANCE || `${base}?plan=i-need-guidance`,
    },
    'i-need-help': {
      label: 'I Need Help',
      price: 10,
      url: process.env.STRIPE_LINK_I_NEED_HELP || `${base}?plan=i-need-help`,
    },
    'i-need-focused-help': {
      label: 'I Need Focused Help',
      price: 30,
      url: process.env.STRIPE_LINK_I_NEED_FOCUSED_HELP || `${base}?plan=i-need-focused-help`,
    },
  });
});

module.exports = router;
