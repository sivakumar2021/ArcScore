# ArcScore — CLAUDE.md

## What This App Does
ArcScore is a personal life assessment tool. Users score themselves across 9 life dimensions (physical, financial, relationships, career, mental, learning, social, habits, purpose), track progress over time, log life events, and receive AI-generated insights about trends and correlations in their scores.

## Stack
Express.js + Node.js backend, vanilla JS SPA frontend (app.html), PostgreSQL (Neon), Render hosting, bcrypt + pg-session auth.

## Directory Map
- `public/` — static frontend: index.html (landing), app.html (SPA shell), pricing.html, shared.html, gallery.html (public aggregate gallery), admin-metrics.html
- `routes/` — Express route modules (auth, assessments, life-events, insights, assessment-insights, re-engagement, analytics, admin, cron, share, subscription, gallery)
- `services/` — shared service utilities (email.js — Polsia email proxy wrapper + HTML templates for welcome, reminder, drip steps 0/1/2)
- `db/` — database query functions by entity (assessments, subscriptions, gallery)
- `migrations/` — node-pg-migrate migration files (SQL DDL only)
- `server.js` — entry point: middleware wiring, route mounts, app.listen (≤300 lines)
- `migrate.js` — runs all migrations on startup
- `polsia.toml` — cron schedule declarations (send-reminders hourly, send-drip hourly)

## Database
- `users` — accounts: email, name, password_hash, assessment_cadence_days, notifications_enabled, welcome_email_sent_at, reminder_email_sent_at, subscription_tier, subscription_stripe_session_id, subscription_activated_at, subscribed_at, drip_assessment_id, drip_step, drip_step0_sent_at, drip_step1_sent_at, drip_step2_sent_at
- `assessments` — one record per assessment attempt; completed_at marks completion; share_token (VARCHAR 64, unique) enables public sharing; is_guest + guest_email support unauthenticated assessment (visitor completes all questions then creates or links an account)
- `assessment_scores` — per-dimension scores for each assessment
- `assessment_responses` — per-question responses for each assessment
- `dimensions` — dimension definitions (key, name, icon, description, sort_order)
- `dimension_questions` — questions per dimension
- `life_events` — user-logged life milestones with dimensions_affected
- `insights` — generated insight records per user (trend, plateau, correlation, life_event_impact)
- `re_engagement_prompts` — tracks when/whether users responded to re-engagement nudges
- `session` — pg-session store for express-session
- `magic_link_tokens` — magic link auth tokens: token (96-char hex), user_id (nullable), email, expires_at, created_at; single-use, 15-min TTL
- `analytics_events` — funnel/event tracking: (id, user_id nullable, event_type, event_data JSONB, created_at)

## External Integrations
- Polsia Email Proxy — `https://polsia.com/api/proxy/email` via `POLSIA_API_KEY`. Sends welcome emails on signup, 24h assessment reminders via cron.
- Polsia Stripe Connect — `https://polsia.com/api/company-payments/verify` via `POLSIA_API_KEY`. Verifies Stripe checkout sessions. Payment links configured via `STRIPE_LINK_I_GOT_IT`, `STRIPE_LINK_I_NEED_GUIDANCE`, `STRIPE_LINK_I_NEED_HELP`, `STRIPE_LINK_I_NEED_FOCUSED_HELP` env vars.

## SEO Setup (2026-05-24)
- `robots.txt` at `/robots.txt` — allows public pages, blocks auth/admin/api
- `sitemap.xml` at `/sitemap.xml` — 7 public URLs (home, signup, assess, pricing, dimensions, login, results/gallery)
- Landing page (public/index.html): Organization + WebApplication JSON-LD, full OG/Twitter
- pricing.html: SoftwareApplication JSON-LD, full OG/Twitter, canonical URL
- gallery.html: full OG/Twitter, canonical URL; data loaded client-side from GET /api/gallery
- app.html: OG/Twitter per-route via `__OG_TITLE__`/`__OG_DESCRIPTION__` placeholders
- shared.html: Dynamic OG/Twitter populated server-side from DB query

## Recent Changes
- 2026-07-20: Share CTA block on /results — X, LinkedIn, Copy buttons with score-templated text, UTM-tagged share URLs (arc_ref=share_token), share_clicked GA4 event fired via existing trackEvent. public/app.html only — no backend, no migration, no new mounts.
- 2026-06-27: Magic link auth — added `magic_link_tokens` table (migration 014), new endpoints POST /api/auth/magic/send (generate+email link), GET /api/auth/magic/verify (validate token, create session, redirect), POST /api/auth/magic/complete-signup (new-account creation after magic link). Login page now has Password / Email Link toggle. Signup page shows magic link completion form when landing with ?magic=pending.
- 2026-06-23: Remove auth gate from assessment start — visitors can now complete all 9 dimension questions without an account. After completion, email capture modal prompts for account creation (new account or login). Guest assessments stored with `is_guest=true` and `guest_email`, then linked to the user's account on submission. Migration 013_guest_assessment.js; new endpoints POST /api/assessments/guest (start) and /api/assessments/guest/submit (complete+create); updated startAssessment/submitAssessment in app.html.
- 2026-06-23: Fix landing page copy contradiction — footer and signup copy previously said "10 minutes" while hero and step descriptions said "2 minutes". All references updated to "about 2 minutes" across index.html, app.html, shared.html.
- 2026-06-18: Expanded assessment from 3 → 10 questions per dimension (90 total). 7 new layered behavioral questions added per dimension (Q4-Q10), covering surface behavior, underlying patterns, and felt impact. Migration 1750291300_expand_questions.js. Frontend and scoring unchanged — question rendering and dimension averaging are already dynamic.
- 2026-06-10: Fix missing subscribed_at column — migration 010 added subscription_activated_at but app code referenced subscribed_at; migration 012 adds the missing column; CLAUDE.md updated with both column names.
- 2026-06-09: Renamed "Fitness" → "Physical" and "Mental Health" → "Mental" across all code, DB, and UI. Migration 1781029942_rename_dimensions.js; updated DIMENSION_META (app.html), DIMENSION_NAMES (assessments.js, insights.js), labels (email.js), legend (index.html). CLAUDE.md updated.
- 2026-05-26: Social Proof Gallery — public /results/gallery page with anonymized aggregate ArcScore data: dimension averages, growth phase distributions, and top life events. Full OG/Twitter meta tags, sitemap and robots.txt updated. Files: routes/gallery.js (GET /api/gallery), db/gallery.js (aggregate queries), public/gallery.html (static page with client-side JS data fetching).
- 2026-05-24: SEO foundation — meta tags, canonical URLs, OG/Twitter Card on all public pages, robots.txt updated (added /assess, /dimensions, /shared, /results/gallery), sitemap.xml updated (added /assess, /results/gallery), pricing.html full OG/JSON-LD, app.html OG placeholder tokens, JSON-LD on index/pricing
- 2026-05-23: Post-Assessment Email Drip — 3-step 7-day sequence: Day 0 results recap (immediate), Day 3 growth opportunity (dimension-specific tips), Day 7 retake prompt (delta arrows teaser); migration 011_email_drip.js; routes/cron.js + jobs/send-drip.js + services/email.js templates; polsia.toml cron declarations; step 0 fires immediately on assessment submit + hourly cron safety net
- 2026-05-22: Assessment Insights Engine — GET /api/assessments/:id/insights returns per-dimension recommendations (band: low/medium/high/excellent), focus areas, strengths, growth opportunity, retake countdown; rendered as "Your Insights" section below breakdown on results page; tracks analytics_events 'insights_viewed'; routes/assessment-insights.js + inline CSS/JS in app.html
- 2026-05-18: Mounted routes/subscriptions.js at /api/subscriptions (was missing from server.js); fixed success redirect mismatch (?subscribed= → ?payment=success&plan=); aligned STRIPE_LINK_* env var names across both subscription route files
- 2026-05-18: Stripe subscription integration — migration 010 (subscription_tier/session/activated_at on users), routes/subscription.js (/api/subscription/plans, /api/subscription/status, /payment/success), pricing.html CTAs wired to Stripe via STRIPE_LINK_* env vars, dashboard plan badge + upgrade nudge, /api/auth/me returns subscription_tier
- 2026-05-17: Added pricing page with 4-tier plan layout (Choose Your Arc: $1/$5/$10/$30/mo), pricing section on landing page, /pricing route (public/pricing.html, server.js), pricing nav link, responsive card grid, Plan 3 "Most Popular" highlight
- 2026-05-17: Added shareable results — public /shared/:token page, POST /api/assessments/:id/share token generation, GET /api/shared/:token data endpoint, migration 009 (share_token column), share button on results page (routes/share.js, migration 009_share_token.js, public/shared.html)
