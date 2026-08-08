// jobs/send-drip.js — standalone job entry point for polsia.toml cron.
// Calls POST /api/cron/send-drip on the running web service.
// Processes all three drip steps (Day 0, Day 3, Day 7) in a single pass.
const APP_URL = process.env.APP_URL || 'https://arcscore.app';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.warn('[jobs/send-drip] CRON_SECRET not set — request will fail auth check in prod');
}

fetch(`${APP_URL}/api/cron/send-drip`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(CRON_SECRET ? { 'X-Cron-Secret': CRON_SECRET } : {}),
  },
})
  .then(res => res.json())
  .then(data => {
    console.log('[jobs/send-drip] result:', JSON.stringify(data));
    process.exit(0);
  })
  .catch(err => {
    console.error('[jobs/send-drip] error:', err.message);
    process.exit(1);
  });
