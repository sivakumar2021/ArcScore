// routes/posts.js — owns /api/posts/* public read endpoints.
// Does NOT own authoring (no admin route in this PR).
const express = require('express');
const { listPublishedPosts, getPostBySlug } = require('../db/posts');

const router = express.Router();

function isAsciiSlug(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[\x20-\x7E]+$/.test(value);
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// GET /api/posts — published posts, newest first. Listing payload stays light
// (no full body) so the index page loads quickly.
router.get('/', async (req, res) => {
  try {
    const rows = await listPublishedPosts();
    const posts = rows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      tags: Array.isArray(r.tags) ? r.tags : [],
      author_name: r.author_name,
      cover_image_url: r.cover_image_url,
      published_at: toIso(r.published_at)
    }));
    res.json({ posts });
  } catch (err) {
    console.error('Posts list error:', err.message || err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

// GET /api/posts/:slug — single post (includes body). Used to hydrate the
// post-detail page or any future client-side renderer.
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!isAsciiSlug(slug)) {
    return res.status(404).json({ error: 'Post not found' });
  }
  try {
    const row = await getPostBySlug(slug);
    if (!row) return res.status(404).json({ error: 'Post not found' });
    res.json({
      post: {
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        body: row.body,
        tags: Array.isArray(row.tags) ? row.tags : [],
        author_name: row.author_name,
        cover_image_url: row.cover_image_url,
        published_at: toIso(row.published_at),
        updated_at: toIso(row.updated_at)
      }
    });
  } catch (err) {
    console.error('Post detail error:', err.message || err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

module.exports = router;
