// db/posts.js — owns posts table queries.
// Does NOT own business logic (routes do that).
// Does NOT own authoring (no admin route in this PR; seed lives in the migration).
const pool = require('./index');

async function listPublishedPosts() {
  const result = await pool.query(
    `SELECT id, slug, title, excerpt, tags, author_name, cover_image_url, published_at
     FROM posts
     WHERE is_published = TRUE
     ORDER BY published_at DESC, id DESC`
  );
  return result.rows;
}

async function getPostBySlug(slug) {
  if (!slug || slug.length > 200) return null;
  const result = await pool.query(
    `SELECT id, slug, title, excerpt, body, tags, author_name, cover_image_url,
            published_at, updated_at
     FROM posts
     WHERE slug = $1 AND is_published = TRUE`,
    [slug]
  );
  return result.rows[0] || null;
}

module.exports = { listPublishedPosts, getPostBySlug };
