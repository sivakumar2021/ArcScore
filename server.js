// server.js — entry point. Wires middleware, mounts routes, starts listener.
// All business logic lives in routes/ and db/. Keep this file under 300 lines.
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const pool = require('./db');
const authRoutes = require('./routes/auth');
const assessmentRoutes = require('./routes/assessments');
const lifeEventsRoutes = require('./routes/life-events');
const insightRoutes = require('./routes/insights');
const reEngagementRoutes = require('./routes/re-engagement');
const userRoutes = require('./routes/user');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const cronRoutes = require('./routes/cron');
const shareRoutes = require('./routes/share');
const statsRoutes = require('./routes/stats');
const subscriptionRoutes = require('./routes/subscription');
const subscriptionsRoutes = require('./routes/subscriptions');
const assessmentInsightsRoutes = require('./routes/assessment-insights');
const galleryRoutes = require('./routes/gallery');
const refLeadsRoutes = require('./routes/ref-leads');
const leadsRoutes = require('./routes/leads');
const scoresRoutes = require('./routes/scores');

const app = express();
const port = process.env.PORT || 3000;

function createSessionStore() {
  if (process.env.DATABASE_URL) {
    return new PgSession({ pool, createTableIfMissing: true });
  }

  return new (require('express-session').Store)();
}

function gaSnippet() {
  const id = process.env.GA_MEASUREMENT_ID;
  if (!id) return '';
  return `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${id}');
</script>`;
}

// ─── MIDDLEWARE ───

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust Render's proxy so secure cookies work behind HTTPS termination
app.set('trust proxy', 1);

// Sessions backed by PostgreSQL
app.use(session({
  store: createSessionStore(),
  secret: process.env.SESSION_SECRET || 'REDACTED',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// ─── HEALTH CHECK ───

app.get('/health', (req, res) => res.json({ status: 'healthy' }));

// ─── STATIC FILES ───

app.use(express.static(path.join(__dirname, 'static')));

// ─── API ROUTES ───

app.use('/api/auth', authRoutes);
app.use('/api/assessments', assessmentInsightsRoutes);
app.use('/api/assessments', assessmentRoutes);
// /api/dimensions is a GET-only endpoint returning dimension definitions
// Mounted directly to avoid URL mangling issues
app.get('/api/dimensions', (req, res, next) => {
  req.url = '/dimensions';
  assessmentRoutes(req, res, next);
});
app.use('/api/life-events', lifeEventsRoutes);
app.use('/api/insights', insightRoutes);
app.use('/api/re-engagement', reEngagementRoutes);
app.use('/api/user', userRoutes);
app.use('/api/users', userRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/shared', shareRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/gallery', galleryRoutes);
app.use('/api/ref-leads', refLeadsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/assessments', assessmentInsightsRoutes);
app.use('/api/scores', scoresRoutes);

// ─── SEO ───

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
`User-agent: *
Allow: /
Allow: /login
Allow: /signup
Allow: /pricing
Allow: /assess
Allow: /dimensions
Allow: /shared
Allow: /results/gallery
Allow: /timeline
Disallow: /dashboard
Disallow: /results/
Disallow: /life-events
Disallow: /api/
Disallow: /admin/

Sitemap: https://arcscore-le6r.polsia.app/sitemap.xml`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const baseUrl = 'https://arcscore-le6r.polsia.app';
  const today = new Date().toISOString().split('T')[0];
  res.type('application/xml').send(
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>${baseUrl}/signup</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>${baseUrl}/assess</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>${baseUrl}/pricing</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>
  <url><loc>${baseUrl}/dimensions</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>${baseUrl}/login</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.4</priority></url>
  <url><loc>${baseUrl}/results/gallery</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
</urlset>`
  );
});

// ─── HTML ROUTES ───

// Landing page
app.get('/', (req, res) => {
  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  const htmlPath = path.join(__dirname, 'static', 'index.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('__POLSIA_SLUG__', slug).replace('__GA_SNIPPET__', gaSnippet());
    res.type('html').send(html);
  } else {
    res.json({ message: 'Hello from ArcScore!' });
  }
});

const APP_ROUTE_META = {
  '/login':       { title: 'Log In — ArcScore', description: 'Log in to ArcScore to view your life dimension scores and track your progress over time.', robots: 'noindex, nofollow', ogTitle: 'Log In — ArcScore', ogDesc: 'Access your ArcScore dashboard and track your life dimensions over time.' },
  '/signup':      { title: 'Create Account — ArcScore', description: 'Join ArcScore and take your first life assessment. Score 9 dimensions and start tracking your arc.', robots: 'index, follow', ogTitle: 'Join ArcScore — Score 9 Life Dimensions', ogDesc: 'Score yourself across 9 life dimensions — fitness, finances, relationships, career, and more. Free to start.' },
  '/assess':      { title: 'Life Assessment — ArcScore', description: 'Take a comprehensive life assessment across 9 dimensions.', robots: 'index, follow', ogTitle: 'Take the ArcScore Assessment — 9 Life Dimensions', ogDesc: 'Answer 27 questions across 9 life dimensions. Get your personalized ArcScore in minutes.' },
  '/dashboard':   { title: 'Dashboard — ArcScore', description: 'Your personal ArcScore dashboard. View your life dimension scores and progress over time.', robots: 'noindex, nofollow', ogTitle: 'Your ArcScore Dashboard', ogDesc: 'Track your life dimension scores, log events, and see how your arc changes over time.' },
  '/life-events': { title: 'Life Events — ArcScore', description: 'Log milestones and life events to understand how major changes affect your scores.', robots: 'noindex, nofollow', ogTitle: 'Life Events — ArcScore', ogDesc: 'Log milestones and life events to see how major changes affect your scores.' },
  '/settings':    { title: 'Settings — ArcScore', description: 'Manage your ArcScore preferences including reassessment reminders.', robots: 'noindex, nofollow', ogTitle: 'Settings — ArcScore', ogDesc: 'Manage your ArcScore preferences and reassessment reminders.' },
  '/dimensions':  { title: 'Dimensions — ArcScore', description: 'Explore each of the 9 life dimensions tracked by ArcScore.', robots: 'index, follow', ogTitle: 'The 9 Life Dimensions — ArcScore', ogDesc: 'Explore the 9 dimensions ArcScore tracks: fitness, financial, relationships, career, mental health, learning, social, habits, and purpose.' },
  '/timeline':    { title: 'Score Arc — ArcScore', description: 'Track how your 9 life dimension scores change over time across multiple ArcScore assessments.', robots: 'noindex, nofollow', ogTitle: 'Your Score Arc — ArcScore', ogDesc: 'See how your 9 life dimensions evolve over time across ArcScore assessments.' },
  '/admin/metrics': { title: 'Metrics — ArcScore Admin', description: 'Admin metrics dashboard.', robots: 'noindex, nofollow', ogTitle: 'ArcScore Admin', ogDesc: 'Admin metrics dashboard.' }
};

function serveAppWithMeta(meta, routePath) {
  return (req, res) => {
    const htmlPath = path.join(__dirname, 'static', 'app.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html
      .replace(/__PAGE_TITLE__/g, meta.title)
      .replace(/__PAGE_DESCRIPTION__/g, meta.description)
      .replace(/__PAGE_ROBOTS__/g, meta.robots)
      .replace(/__PAGE_PATH__/g, routePath || req.path)
      .replace(/__OG_TITLE__/g, meta.ogTitle)
      .replace(/__OG_DESCRIPTION__/g, meta.ogDesc)
      .replace('__GA_SNIPPET__', gaSnippet());
    res.type('html').send(html);
  };
}

app.get('/login',        serveAppWithMeta(APP_ROUTE_META['/login'], '/login'));
app.get('/signup',       serveAppWithMeta(APP_ROUTE_META['/signup'], '/signup'));
app.get('/assess',       serveAppWithMeta(APP_ROUTE_META['/assess'], '/assess'));
app.get('/dashboard',    serveAppWithMeta(APP_ROUTE_META['/dashboard'], '/dashboard'));
app.get('/life-events',  serveAppWithMeta(APP_ROUTE_META['/life-events'], '/life-events'));
app.get('/settings',     serveAppWithMeta(APP_ROUTE_META['/settings'], '/settings'));
app.get('/dimensions',   serveAppWithMeta(APP_ROUTE_META['/dimensions'], '/dimensions'));
app.get('/timeline',     serveAppWithMeta(APP_ROUTE_META['/timeline'], '/timeline'));

// Public gallery — static page; must precede /results/:id catch-all
app.get('/results/gallery', serveAppWithMeta({
  title: 'ArcScore Gallery — What Does the Average Arc Look Like?',
  description: 'Explore anonymized aggregate ArcScore data across 9 life dimensions. See how people score, what events shape their arcs, and where growth happens most.',
  robots: 'index, follow',
  ogTitle: 'ArcScore Gallery — See What the Average Arc Looks Like',
  ogDesc: 'Anonymized data across thousands of assessments. Dimension averages, common life events, and where growth happens most.'
}, '/results/gallery'));

app.get('/results/:id', (req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'app.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html
    .replace(/__PAGE_TITLE__/g, 'Your ArcScore Results')
    .replace(/__PAGE_DESCRIPTION__/g, 'View your ArcScore assessment results across 9 life dimensions.')
    .replace(/__PAGE_ROBOTS__/g, 'noindex, nofollow')
    .replace(/__PAGE_PATH__/g, `/results/${req.params.id}`)
    .replace(/__OG_TITLE__/g, 'Your ArcScore Results — 9 Life Dimensions')
    .replace(/__OG_DESCRIPTION__/g, 'See how you scored across 9 life dimensions. Take the ArcScore assessment and start tracking your arc.')
    .replace('__GA_SNIPPET__', gaSnippet());
  res.type('html').send(html);
});

// Public shared results page — server-rendered OG tags for social crawlers
app.get('/shared/:token', async (req, res) => {
  const token = req.params.token;
  const baseUrl = 'https://arcscore-le6r.polsia.app';
  const shareUrl = `${baseUrl}/shared/${encodeURIComponent(token)}`;

  // Default meta — overridden if we can fetch scores from DB
  let title = 'My ArcScore Results — How do you compare?';
  let description = 'I scored myself across 9 life dimensions. See my results and take your own assessment.';

  try {
    const row = await pool.query(
      `SELECT u.name, ROUND(AVG(s.score)::numeric, 1) as avg_score,
              MAX(d.name) FILTER (WHERE s.score = (SELECT MAX(s2.score) FROM assessment_scores s2 WHERE s2.assessment_id = a.id)) as top_dim,
              MAX(d.name) FILTER (WHERE s.score = (SELECT MIN(s2.score) FROM assessment_scores s2 WHERE s2.assessment_id = a.id)) as low_dim
       FROM assessments a
       JOIN users u ON u.id = a.user_id
       JOIN assessment_scores s ON s.assessment_id = a.id
       JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.share_token = $1 AND a.completed_at IS NOT NULL
       GROUP BY u.name`,
      [token]
    );
    if (row.rows.length > 0) {
      const r = row.rows[0];
      const first = r.name ? r.name.split(' ')[0] : null;
      const avg = r.avg_score;
      title = first
        ? `${first}'s ArcScore: ${avg}/10 — How do you compare?`
        : `ArcScore: ${avg}/10 — How do you compare?`;
      if (r.top_dim && r.low_dim) {
        description = `Scored ${r.top_dim} highest and ${r.low_dim} lowest across 9 life dimensions. Take your own assessment at ArcScore.`;
      }
    }
  } catch (_) {
    // Non-fatal: serve with default meta if DB query fails
  }

  const htmlPath = path.join(__dirname, 'static', 'shared.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html
    .replace(/__SHARE_TITLE__/g, title)
    .replace(/__SHARE_DESCRIPTION__/g, description)
    .replace(/__SHARE_URL__/g, shareUrl)
    .replace('__GA_SNIPPET__', gaSnippet());
  res.type('html').send(html);
});

// Stripe checkout success — handled by subscription router, which redirects to /dashboard
// The GET /payment/success route lives in routes/subscription.js
app.use('/payment', subscriptionRoutes);

// Admin metrics dashboard — served from app shell with embedded page
// Pricing page — dedicated static page
app.get('/pricing', (req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'pricing.html');
  if (fs.existsSync(htmlPath)) {
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace('__GA_SNIPPET__', gaSnippet());
    res.type('html').send(html);
  } else {
    res.redirect('/');
  }
});

// Admin metrics dashboard — served from app shell with embedded page
app.get('/admin/metrics', (req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'admin-metrics.html');
  if (fs.existsSync(htmlPath)) {
    res.type('html').sendFile(htmlPath);
  } else {
    res.redirect('/');
  }
});

// Admin leads inbox — lists per-reply audit rows from lead_replies
app.get('/admin/leads/inbox', (req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'admin-leads-inbox.html');
  if (fs.existsSync(htmlPath)) {
    res.type('html').sendFile(htmlPath);
  } else {
    res.redirect('/');
  }
});

// ─── START ───

app.listen(port, () => {
  console.log(`ArcScore server running on port ${port}`);
});
