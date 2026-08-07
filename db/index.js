// db/index.js — owns the single Pool instance for the entire app.
// All other modules import pool from here; no module constructs its own Pool.
const { Pool } = require('pg');

function createFallbackPool() {
  const fallback = {
    __isFallback: true,
    async query(text, params) {
      const command = String(text || '').trim().split(/\s+/)[0].toUpperCase();
      return {
        rows: [],
        rowCount: 0,
        command,
        oid: null,
        fields: []
      };
    },
    async connect() {
      return {
        query: (text, params) => fallback.query(text, params),
        release: () => {}
      };
    },
    async end() {
      return undefined;
    }
  };
  return fallback;
}

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set; using development fallback pool');
  module.exports = createFallbackPool();
} else {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  module.exports = pool;
}
