// server.js — entry point. Wires middleware, mounts routes, starts listener.
// All business logic lives in routes/ and db/. Keep this file under 300 lines.
const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);

const pool = require('./db');
const { listPublishedPosts, getPostBySlug } = require('./db/posts');
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
const postsRoutes = require('./routes/posts');
const refLeadsRoutes = require('./routes/ref-leads');
const leadsRoutes = require('./routes/leads');
const scoresRoutes = require('./routes/scores');
const waitlistRoutes = require('./routes/waitlist');

const app = express();
const requestedPort = Number(process.env.PORT || 3000);

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.listen(port, '127.0.0.1', () => {
      tester.close(() => resolve(true));
    });
  });
}

function listenOnPort(port) {
  return new Promise(async (resolve, reject) => {
    let candidate = port;
    while (true) {
      if (candidate < 1) {
        candidate = 0;
      }
      const available = await isPortAvailable(candidate);
      if (available) {
        const server = app.listen(candidate, () => {
          const actualPort = server.address().port;
          console.log(`ArcScore server running on port ${actualPort}`);
          resolve(server);
        });
        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(`[server] Port ${candidate} is busy; trying ${candidate + 1}`);
            server.close();
            resolve(listenOnPort(candidate + 1));
            return;
          }
          reject(err);
        });
        return;
      }
      console.warn(`[server] Port ${candidate} is busy; trying ${candidate + 1}`);
      candidate += 1;
    }
  });
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
  store: new PgSession({ pool, createTableIfMissing: true }),
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
app.use('/api/posts', postsRoutes);
app.use('/api/ref-leads', refLeadsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/assessments', assessmentInsightsRoutes);
app.use('/api/scores', scoresRoutes);
app.use('/api/waitlist', waitlistRoutes);

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
Allow: /blog
Disallow: /dashboard
Disallow: /results/
Disallow: /life-events
Disallow: /api/
Disallow: /admin/

Sitemap: https://arcscore-le6r.polsia.app/sitemap.xml`
  );
});

app.get('/sitemap.xml', async (req, res) => {
  const baseUrl = 'https://arcscore-le6r.polsia.app';
  const today = new Date().toISOString().split('T')[0];

  let postEntries = '';
  try {
    const result = await pool.query(
      `SELECT slug, updated_at
       FROM posts
       WHERE is_published = TRUE
       ORDER BY published_at DESC`
    );
    postEntries = result.rows.map(r => {
      const safeSlug = String(r.slug || '').replace(/[^a-z0-9-]/gi, '');
      const lastmod = new Date(r.updated_at).toISOString().split('T')[0];
      return `  <url><loc>${baseUrl}/blog/${safeSlug}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`;
    }).join('\n');
  } catch (_) {
    // Non-fatal: fall back to static sitemap without blog posts
  }

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
  <url><loc>${baseUrl}/blog</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
${postEntries}
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

// Blog index — server-rendered card list (no client fetch needed for SEO).
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPostDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildPostListHtml(rows) {
  if (!rows || rows.length === 0) {
    return '<p class="empty-state">No posts yet — check back soon.</p>';
  }
  return rows.map(r => {
    const slug = String(r.slug || '');
    const title = escapeHtml(r.title);
    const excerpt = escapeHtml(r.excerpt);
    const dateLabel = escapeHtml(formatPostDate(r.published_at));
    const tags = Array.isArray(r.tags) ? r.tags : [];
    const tagHtml = tags.map(t => {
      const safe = String(t || '').trim();
      return `<a class="tag-chip" href="/blog?tag=${encodeURIComponent(safe)}">${escapeHtml(safe)}</a>`;
    }).join('');
    return `<a class="post-card" href="/blog/${encodeURIComponent(slug)}">
        <h3>${title}</h3>
        <p class="post-excerpt">${excerpt}</p>
        <div class="post-meta">
          <span class="meta-date">${dateLabel}</span>
        </div>
        ${tagHtml ? `<div class="tag-list">${tagHtml}</div>` : ''}
      </a>`;
  }).join('\n');
}

app.get('/blog', async (req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'blog.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  let postListHtml;
  try {
    const rows = await listPublishedPosts();
    postListHtml = buildPostListHtml(rows);
  } catch (err) {
    console.error('Blog index error:', err.message || err);
    postListHtml = '<p class="empty-state">Posts are temporarily unavailable.</p>';
  }

  html = html
    .replace('__POST_LIST__', postListHtml)
    .replace('__GA_SNIPPET__', gaSnippet());

  res.type('html').send(html);
});

// Blog post detail — SEO-targeted meta + JSON-LD per post.
function buildPostNotFoundHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Post not found — ArcScore</title>
<meta name="robots" content="noindex, nofollow"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: 'DM Sans', sans-serif; background: #fafaf8; color: #0a0a0f; padding: 64px 24px; text-align: center;">
<h1 style="font-family: 'Space Grotesk', sans-serif;">Post not found</h1>
<p>The post you are looking for does not exist or has been unpublished.</p>
<p><a style="color: #e85d26;" href="/blog">← Back to all posts</a></p>
</body></html>`;
}

app.get('/blog/:slug', async (req, res) => {
  const rawSlug = req.params.slug || '';
  if (rawSlug.length > 200 || !/^[\x20-\x7E]+$/.test(rawSlug)) {
    return res.status(404).type('html').send(buildPostNotFoundHtml());
  }

  let post;
  try {
    post = await getPostBySlug(rawSlug);
  } catch (err) {
    console.error('Blog detail error:', err.message || err);
    return res.status(500).type('html').send(buildPostNotFoundHtml());
  }
  if (!post) return res.status(404).type('html').send(buildPostNotFoundHtml());

  const baseUrl = 'https://arcscore-le6r.polsia.app';
  const pagePath = `/blog/${post.slug}`;
  const ogImage = post.cover_image_url || `${baseUrl}/og-image.svg`;
  const tags = Array.isArray(post.tags) ? post.tags : [];
  const tagsHtml = tags.map(t => {
    const safe = String(t || '').trim();
    return `<a class="tag-chip" href="/blog?tag=${encodeURIComponent(safe)}">${escapeHtml(safe)}</a>`;
  }).join('');

  const publishedIso = post.published_at instanceof Date
    ? post.published_at.toISOString()
    : new Date(post.published_at).toISOString();
  const updatedIso = post.updated_at instanceof Date
    ? post.updated_at.toISOString()
    : new Date(post.updated_at).toISOString();

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    url: `${baseUrl}${pagePath}`,
    datePublished: publishedIso,
    dateModified: updatedIso,
    author: { '@type': 'Organization', name: post.author_name || 'ArcScore' },
    publisher: { '@type': 'Organization', name: 'ArcScore' },
    image: ogImage,
    keywords: tags.join(', ')
  });

  const htmlPath = path.join(__dirname, 'static', 'blog-post.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html
    .replace(/__PAGE_TITLE__/g, escapeHtml(`${post.title}`))
    .replace(/__PAGE_DESCRIPTION__/g, escapeHtml(post.excerpt || ''))
    .replace(/__PAGE_ROBOTS__/g, 'index, follow')
    .replace(/__PAGE_PATH__/g, pagePath)
    .replace(/__OG_TITLE__/g, escapeHtml(post.title || ''))
    .replace(/__OG_DESCRIPTION__/g, escapeHtml(post.excerpt || ''))
    .replace(/__OG_IMAGE__/g, ogImage)
    .replace('__JSON_LD__', jsonLd)
    .replace('__POST_TITLE__', escapeHtml(post.title || ''))
    .replace('__POST_DATE__', escapeHtml(formatPostDate(post.published_at)))
    .replace('__POST_TAGS__', tagsHtml)
    .replace('__POST_BODY__', String(post.body || ''))
    .replace('__GA_SNIPPET__', gaSnippet());

  res.type('html').send(html);
});

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

listenOnPort(requestedPort).catch((err) => {
  console.error('Failed to start server:', err.message || err);
  process.exit(1);
});
