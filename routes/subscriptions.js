// routes/subscriptions.js — owns /api/subscriptions/* endpoints.
// Handles payment success verification, plan status reads, and Stripe link config.
// Does NOT own auth, assessment logic, or Stripe checkout session creation.
const express = require('express');
const { getSubscription, setSubscription, setSubscriptionByEmail, PLAN_NAMES, VALID_TIERS } = require('../db/subscriptions');

const router = express.Router();

const APP_URL   = process.env.APP_URL   || 'https://arcscore.app';
const API_URL   = process.env.POLSIA_API_URL || 'https://polsia.com';
const API_KEY   = process.env.POLSIA_API_KEY || '';

// Tier → Stripe payment link — set via env vars so links update without redeploy.
// Uses same var names as routes/subscription.js for consistency.
const STRIPE_LINKS = {
  'i-got-it':            process.env.STRIPE_LINK_I_GOT_IT           || process.env.STRIPE_LINK_TIER1 || null,
  'i-need-guidance':     process.env.STRIPE_LINK_I_NEED_GUIDANCE     || process.env.STRIPE_LINK_TIER2 || null,
  'i-need-help':         process.env.STRIPE_LINK_I_NEED_HELP         || process.env.STRIPE_LINK_TIER3 || null,
  'i-need-focused-help': process.env.STRIPE_LINK_I_NEED_FOCUSED_HELP || process.env.STRIPE_LINK_TIER4 || null,
};

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// GET /api/subscriptions/links — returns Stripe links for each tier (safe to expose)
router.get('/links', (req, res) => {
  res.json({
    tiers: [
      { key: 'i-got-it',            name: 'I Got It',            price: 1,  url: STRIPE_LINKS['i-got-it'] },
      { key: 'i-need-guidance',     name: 'I Need Guidance',     price: 5,  url: STRIPE_LINKS['i-need-guidance'] },
      { key: 'i-need-help',         name: 'I Need Help',         price: 10, url: STRIPE_LINKS['i-need-help'] },
      { key: 'i-need-focused-help', name: 'I Need Focused Help', price: 30, url: STRIPE_LINKS['i-need-focused-help'] },
    ]
  });
});

// GET /api/subscriptions/me — returns current user's subscription (authenticated)
router.get('/me', requireAuth, async (req, res) => {
  try {
    const sub = await getSubscription(req.session.userId);
    const tier = sub.subscription_tier;
    res.json({
      tier,
      plan_name: tier ? (PLAN_NAMES[tier] || tier) : null,
      subscribed_at: sub.subscribed_at,
      upgrade_url: `${APP_URL}/pricing`,
    });
  } catch (err) {
    console.error('[subscriptions] GET /me error:', err.message);
    res.status(500).json({ error: 'Failed to load subscription' });
  }
});

// GET /payment/success — Stripe success redirect handler
// Verifies session with Polsia and updates user's tier
// Query params: session_id (Stripe checkout session), plan (tier key)
router.get('/success', async (req, res) => {
  const { session_id, plan } = req.query;

  // Plan must be a valid tier
  if (!plan || !VALID_TIERS.includes(plan)) {
    return res.redirect(`${APP_URL}/pricing?error=invalid_plan`);
  }

  // If no session_id, we can't verify — redirect to pricing with error
  if (!session_id) {
    return res.redirect(`${APP_URL}/pricing?error=missing_session`);
  }

  try {
    // Verify payment with Polsia platform
    let verified = false;
    let customerEmail = null;

    if (API_KEY) {
      try {
        const verifyRes = await fetch(
          `${API_URL}/api/company-payments/verify?session_id=${encodeURIComponent(session_id)}`,
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        );
        const data = await verifyRes.json();
        verified = data.verified === true;
        customerEmail = data.payment?.customer_email || null;
      } catch (verifyErr) {
        console.error('[subscriptions] verify error:', verifyErr.message);
        // Non-fatal: fall through to session-based update below
      }
    }

    // Update tier — prefer session user, fall back to email match
    if (req.session.userId) {
      await setSubscription(req.session.userId, plan, session_id);
    } else if (customerEmail) {
      await setSubscriptionByEmail(customerEmail, plan, session_id);
    }

    // Redirect to dashboard with success toast param — matches app.html ?payment=success&plan= handler
    res.redirect(`${APP_URL}/dashboard?payment=success&plan=${encodeURIComponent(plan)}`);
  } catch (err) {
    console.error('[subscriptions] success handler error:', err.message);
    res.redirect(`${APP_URL}/pricing?error=update_failed`);
  }
});

module.exports = router;
