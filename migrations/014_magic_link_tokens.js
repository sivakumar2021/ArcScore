'use strict';

module.exports = {
  name: '014_magic_link_tokens',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        id         BIGSERIAL PRIMARY KEY,
        token      VARCHAR(96) NOT NULL UNIQUE,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        email      VARCHAR(320),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_magic_token_expires ON magic_link_tokens (expires_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_magic_token_user ON magic_link_tokens (user_id) WHERE user_id IS NOT NULL`);
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS magic_link_tokens`);
  },
};