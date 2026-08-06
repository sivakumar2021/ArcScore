// test/waitlist.test.js — mocks the pg Pool via require.cache injection so the
// route is exercised end-to-end without a real Postgres. Node 20+'s built-in
// test runner is used so the suite has zero extra deps. Mirrors the shape of
// test/leads.test.js (the existing suite) so the two lead-capture flows can
// share the same testing conventions.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const FAKE_DB_PATH = require.resolve('../db');
const ROUTE_PATH = require.resolve('../routes/waitlist');
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
  app.use('/api/waitlist', require('../routes/waitlist'));
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
        path: '/api/waitlist',
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

test('POST /api/waitlist returns 200 and row id for a new email', async () => {
  let refLeadsCalled = false;
  let leadRepliesCalled = false;
  installFakePool((sql, params) => {
    if (/INSERT INTO ref_leads/.test(sql)) {
      refLeadsCalled = true;
      assert.match(sql, /RETURNING id, ref_code, email, source, first_seen_at/);
      assert.equal(params[0], null);
      assert.equal(params[1], 'a@b.co');
      assert.equal(params[2], 'pricing-page-waitlist');
      return { rows: [{ id: 99, ref_code: null, email: 'a@b.co', source: 'pricing-page-waitlist', first_seen_at: new Date() }] };
    }
    if (/INSERT INTO lead_replies/.test(sql)) {
      leadRepliesCalled = true;
      assert.equal(params.length, 2, 'lead_replies insert should take exactly 2 params (status is a SQL literal)');
      assert.equal(params[0], 99);
      assert.equal(params[1], 'pricing-page-waitlist');
      // status is baked in as the SQL literal 'new'.
      assert.match(sql, /'new'/);
      return { rows: [{ id: 7 }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.id, 99);
  assert.equal(res.body.email, 'a@b.co');
  assert.equal(res.body.source, 'pricing-page-waitlist');
  assert.equal(refLeadsCalled, true, 'ref_leads insert must have run');
  assert.equal(leadRepliesCalled, true, 'lead_replies insert must have run after ref_leads');
});

test('POST /api/waitlist returns 409 on duplicate (23505 unique_violation)', async () => {
  let leadRepliesCalled = false;
  installFakePool((sql) => {
    if (/INSERT INTO ref_leads/.test(sql)) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      return Promise.reject(err);
    }
    if (/INSERT INTO lead_replies/.test(sql)) {
      leadRepliesCalled = true;
      return { rows: [{ id: 1 }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'duplicate_email');
  assert.match(res.body.message, /already on the list/i);
  assert.equal(leadRepliesCalled, false, 'lead_replies must NOT be inserted on duplicate');
});

test('POST /api/waitlist returns 400 for an invalid email', async () => {
  installFakePool(() => {
    throw new Error('pool.query should not be called for invalid email');
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'not-an-email' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_email');
});

test('POST /api/waitlist returns 400 for a missing email', async () => {
  installFakePool(() => {
    throw new Error('pool.query should not be called when email is missing');
  });
  const app = buildApp();
  const res = await postJson(app, {});
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_email');
});

test('POST /api/waitlist fires ga4Event with is_new=true on first write', async () => {
  installFakePool((sql) => {
    if (/INSERT INTO ref_leads/.test(sql)) {
      return { rows: [{ id: 99, ref_code: null, email: 'a@b.co', source: 'pricing-page-waitlist', first_seen_at: new Date() }] };
    }
    if (/INSERT INTO lead_replies/.test(sql)) {
      return { rows: [{ id: 7 }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co' });
  assert.equal(res.status, 200);
  assert.equal(ga4Calls.length, 1);
  assert.equal(ga4Calls[0].eventName, 'waitlist_captured');
  assert.equal(ga4Calls[0].params.is_new, true);
  assert.equal(ga4Calls[0].params.source, 'pricing-page-waitlist');
  assert.equal(typeof ga4Calls[0].params.landed_path, 'string');
});

test('POST /api/waitlist fires ga4Event with is_new=false on 409 dedup', async () => {
  installFakePool((sql) => {
    if (/INSERT INTO ref_leads/.test(sql)) {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      return Promise.reject(err);
    }
    throw new Error(`unexpected SQL: ${sql}`);
  });
  const app = buildApp();
  const res = await postJson(app, { email: 'a@b.co' });
  assert.equal(res.status, 409);
  assert.equal(ga4Calls.length, 1);
  assert.equal(ga4Calls[0].eventName, 'waitlist_captured');
  assert.equal(ga4Calls[0].params.is_new, false);
  assert.equal(ga4Calls[0].params.source, 'pricing-page-waitlist');
});
