// db/index.js — owns the single Pool instance for the entire app.
// All other modules import pool from here; no module constructs its own Pool.
const { Pool } = require('pg');

function createFallbackPool() {
  return {
    async query() {
      throw new Error('DATABASE_URL environment variable is required for database access');
    },
    async connect() {
      throw new Error('DATABASE_URL environment variable is required for database access');
    },
    async end() {
      return undefined;
    }
  };
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : createFallbackPool();

module.exports = pool;
