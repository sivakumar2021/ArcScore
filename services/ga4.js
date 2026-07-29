// services/ga4.js — fire-and-forget wrapper around the GA4 Measurement Protocol
// (https://www.google-analytics.com/mp/collect). Used for server-side events
// fired from request handlers (e.g. ref_lead_captured from POST /api/leads).
// Errors are swallowed with console.error; callers do not need .catch().
async function ga4Event(eventName, params, clientId) {
  const measurementId = process.env.GA_MEASUREMENT_ID;
  const apiSecret = process.env.GA_API_SECRET;
  if (!measurementId || !apiSecret) return;

  const cid = clientId
    || (params && params.client_id)
    || (typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `srv-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  try {
    await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: cid,
          events: [{ name: eventName, params: params || {} }]
        })
      }
    );
  } catch (err) {
    console.error('ga4Event error:', err.message);
  }
}

module.exports = { ga4Event };
