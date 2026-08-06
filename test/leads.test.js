// test/leads.test.js — mocks the pg Pool via require.cache injection so the
// route is exercised end-to-end without a real Postgres. Node 20+'s built-in
// test runner is used so the suite has zero extra deps.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FAKE_DB_PATH = require.resolve('../db');
const ROUTE_PATH = require.resolve('../routes/leads');
const GA_PATH = require.resolve('../services/ga4');

const ga4Calls = [];

function installFakePool(handler) {
  const fakePool = {
    query: (...args) => Promise.resolve(handler(...args))
  };
  require.cache[FAKE_DB_PATH] = {
    id: FAKE_DB_PATH,
    filename: FAKE_DB_PATH,
    loaded: true,
    exports: fakePool
  };
  // If the route was already loaded by a prior test, drop it so the new fake
  // db is picked up.
  delete require.cache[ROUTE_PATH];
  // analytics.js pulls pool from db too; stub it so logEvent's INSERT into
  // analytics_events doesn't blow up.
  const ANALYTICS_PATH = require.resolve('../routes/analytics');
  require.cache[ANALYTICS_PATH] = {
    id: ANALYTICS_PATH,
    filename: ANALYTICS_PATH,
    loaded: true,
    exports: Object.assign(
      () => (req, res) => res.json({ ok: true }),
      { logEvent: () => Promise.resolve() }
    )
  };
  // Stub services/ga4 so the route emits GA4 MP calls without network I/O,
  // and to capture call args for assertions.
  require.cache[GA_PATH] = {
    id: GA_PATH,
    filename: GA_PATH,
    loaded: true,
    exports: {
      ga4Event: (eventName, params, clientId) => {
        ga4Calls.push({ eventName, params, clientId });
        return Promise.resolve();
      }
    }
  };
  ga4Calls.length = 0;
}

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/leads', require('../routes/leads'));
  return app;
}

function postJson(app, body) {
  const http = require('node:http');
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const data = JSON.stringify(body);
      const req = http.request({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/api/leads',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => chunks += c);
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
        });
      });
      req.on('error', (err) => {
        server.close();
        resolve({ status: 0, error: err.message });
      });
      req.write(data);
      req.end();
    });
  });
}

test('POST /api/leads returns 200 and row id for a new email', async () => {
  installFakePool((sql, params) => {
    assert.match(sql, /INSERT INTO ref_leads/);
    assert.equal(params[0], 'ted-ryce');
    assert.equal(params[1], 'a@b.co');
    assert.equal(params[2], 'interstitial');
    return { rows: [{ id: 42, ref_code: 'ted-ryce', email: 'a@b.co', source: 'interstitial', first_seen_at: new Date() }] };
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co', ref: 'ted-ryce' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.id, 42);
  assert.equal(res.body.ref_code, 'ted-ryce');
});

test('POST /api/leads returns 409 on duplicate (23505 unique_violation)', async () => {
  installFakePool(() => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    return Promise.reject(err);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co', ref: 'ted-ryce' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'duplicate_email');
});

test('POST /api/leads returns 400 for an invalid email', async () => {
  installFakePool(() => {
    throw new Error('pool.query should not be called for invalid email');
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_email');
});

test('POST /api/leads fires ga4Event with is_new=true on first write', async () => {
  installFakePool((sql, params) => {
    assert.match(sql, /INSERT INTO ref_leads/);
    return { rows: [{ id: 42, ref_code: 'ted-ryce', email: 'a@b.co', source: 'interstitial', first_seen_at: new Date() }] };
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co', ref: 'ted-ryce' });
  assert.equal(res.status, 200);
  assert.equal(ga4Calls.length, 1);
  assert.equal(ga4Calls[0].eventName, 'ref_lead_captured');
  assert.equal(ga4Calls[0].params.is_new, true);
  assert.equal(ga4Calls[0].params.ref_code, 'ted-ryce');
  assert.equal(ga4Calls[0].params.source, 'interstitial');
  assert.equal(typeof ga4Calls[0].params.landed_path, 'string');
});

test('POST /api/leads fires ga4Event with is_new=false on 409 dedup', async () => {
  installFakePool(() => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    return Promise.reject(err);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co', ref: 'ted-ryce' });
  assert.equal(res.status, 409);
  assert.equal(ga4Calls.length, 1);
  assert.equal(ga4Calls[0].eventName, 'ref_lead_captured');
  assert.equal(ga4Calls[0].params.is_new, false);
  assert.equal(ga4Calls[0].params.source, 'interstitial');
});
