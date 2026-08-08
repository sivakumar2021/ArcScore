// jobs/send-reminders.js — standalone job entry point for polsia.toml cron.
// Calls POST /api/cron/send-reminders on the running web service.
// The web endpoint enforces CRON_SECRET auth.
const APP_URL = process.env.APP_URL || 'https://arcscore.app';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.warn('[jobs/send-reminders] CRON_SECRET not set — request will fail auth check in prod');
}

fetch(`${APP_URL}/api/cron/send-reminders`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(CRON_SECRET ? { 'X-Cron-Secret': CRON_SECRET } : {}),
  },
})
  .then(res => res.json())
  .then(data => {
    console.log('[jobs/send-reminders] result:', JSON.stringify(data));
    process.exit(0);
  })
  .catch(err => {
    console.error('[jobs/send-reminders] error:', err.message);
    process.exit(1);
  });
