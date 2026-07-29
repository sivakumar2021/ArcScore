// services/email.js — owns outbound email sending via Polsia email proxy.
// Does NOT own templates; callers pass subject/body/html. Does NOT own scheduling.

const EMAIL_PROXY_URL = 'https://polsia.com/api/proxy/email';

/**
 * Send a transactional email via the Polsia email proxy.
 * Fire-and-forget: returns a promise but callers may ignore it.
 * @param {string} to - recipient email address
 * @param {string} subject - email subject line
 * @param {string} body - plain-text version (required)
 * @param {string} [html] - HTML version (optional, recommended)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function sendEmail(to, subject, body, html) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.error('[email] POLSIA_API_KEY not set — cannot send email');
    return { ok: false, error: 'missing_api_key' };
  }

  const payload = { to, subject, body };
  if (html) payload.html = html;

  try {
    const res = await fetch(`${EMAIL_PROXY_URL}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[email] send failed ${res.status}:`, errText);
      return { ok: false, error: `http_${res.status}` };
    }

    return { ok: true };
  } catch (err) {
    console.error('[email] send error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Register a user as a known contact so transactional emails are never rate-limited.
 * Call immediately on signup, before sending any email.
 * @param {string} email
 * @param {string} [name]
 */
async function registerContact(email, name) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) return;

  try {
    await fetch(`${EMAIL_PROXY_URL}/contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email, name: name || undefined, source: 'signup' }),
    });
  } catch (err) {
    console.error('[email] registerContact error:', err.message);
  }
}

/**
 * Welcome email HTML template.
 * Dark-themed, mobile-friendly, matches ArcScore's aesthetic.
 */
function buildWelcomeEmailHtml(name, appUrl) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const dimensions = [
    { icon: '💪', label: 'Physical' },
    { icon: '💰', label: 'Financial' },
    { icon: '❤️', label: 'Relationships' },
    { icon: '🚀', label: 'Career' },
    { icon: '🧠', label: 'Mental' },
    { icon: '📚', label: 'Learning' },
    { icon: '👥', label: 'Social' },
    { icon: '✅', label: 'Habits' },
    { icon: '🎯', label: 'Purpose' },
  ];
  const dimHtml = dimensions.map(d =>
    `<span style="display:inline-block;margin:4px 6px;padding:6px 12px;background:#1e2030;border-radius:20px;font-size:13px;color:#c9d1d9;">${d.icon} ${d.label}</span>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Welcome to ArcScore</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <!-- Header -->
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">
              Arc<span style="color:#7c3aed;">Score</span>
            </div>
            <p style="margin:8px 0 0;font-size:14px;color:#8b949e;">Your personal life assessment tracker</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 20px;font-size:16px;color:#e6edf3;">Hey ${firstName} 👋</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              Welcome to ArcScore. You're set up to score yourself across <strong style="color:#e6edf3;">9 life dimensions</strong> — get a clear picture of where you're thriving and where you've got room to grow.
            </p>
            <!-- Dimensions grid -->
            <div style="margin:0 0 28px;padding:20px;background:#0d1117;border-radius:8px;border:1px solid #21262d;text-align:center;">
              <p style="margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;">The 9 Dimensions</p>
              ${dimHtml}
            </div>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              Your first assessment takes about <strong style="color:#e6edf3;">2 minutes</strong>. Answer honestly — the only person reading your scores is you.
            </p>
            <!-- CTA -->
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${appUrl}/assess" style="display:inline-block;padding:14px 32px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Start My Assessment →
              </a>
            </div>
            <p style="margin:0;font-size:13px;color:#8b949e;line-height:1.5;">
              After you complete it, ArcScore will track your progress over time and surface insights about trends and correlations in your scores.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              You're receiving this because you created an ArcScore account.<br />
              <a href="${appUrl}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Assessment reminder email HTML template.
 */
function buildReminderEmailHtml(name, appUrl) {
  const firstName = name ? name.split(' ')[0] : 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Complete your ArcScore assessment</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <!-- Header -->
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">
              Arc<span style="color:#7c3aed;">Score</span>
            </div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 20px;font-size:16px;color:#e6edf3;">Hey ${firstName} —</p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              You signed up for ArcScore yesterday but haven't completed your first assessment yet.
            </p>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              It takes about <strong style="color:#e6edf3;">2 minutes</strong> — 9 dimensions, quick scores. That's your baseline. Everything useful (trends, insights, correlations) starts from here.
            </p>
            <!-- CTA -->
            <div style="text-align:center;margin:0 0 28px;">
              <a href="${appUrl}/assess" style="display:inline-block;padding:14px 32px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.2px;">
                Take My First Assessment →
              </a>
            </div>
            <p style="margin:0;font-size:13px;color:#8b949e;line-height:1.5;">
              Once you have a baseline, ArcScore tracks your progress automatically.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              You're receiving this because you created an ArcScore account.<br />
              <a href="${appUrl}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── DRIP EMAIL TEMPLATES ─────────────────────────────────────────────────────

const DIM_ICONS = {
  fitness: '💪', financial: '💰', relationships: '❤️', career: '🚀',
  mental_health: '🧠', learning: '📚', social: '👥', habits: '✅', purpose: '🎯'
};

const DIM_LABELS = {
  fitness: 'Physical', financial: 'Financial', relationships: 'Relationships',
  career: 'Career', mental_health: 'Mental', learning: 'Learning',
  social: 'Social', habits: 'Habits', purpose: 'Purpose'
};

// Dimension-specific tips for Day 3 "growth opportunity" email.
// Keyed by dimension key, returns 3 actionable tips.
const DIM_TIPS = {
  fitness:       ['Schedule 3 workouts this week — put them in your calendar like meetings', 'Walk 10 minutes after every meal for 3 days straight', 'Audit your sleep: what one change would give you 30 more minutes tonight?'],
  financial:     ['Track every purchase for 3 days — just awareness, no judgment', 'Set up a $25 auto-transfer to savings this week', 'List 3 subscriptions you haven\'t used in a month and cancel one'],
  relationships: ['Send a message to one person you\'ve been meaning to reach out to', 'Schedule a 30-minute phone call with someone important this week', 'Practice one conversation where your phone stays in your pocket'],
  career:        ['Write down 3 wins from the last 30 days — then share one with your manager', 'Identify one skill gap and find a free resource to start closing it', 'Request one piece of specific feedback from a colleague this week'],
  mental_health: ['Build a 5-minute morning ritual: stretch, breathe, set one intention', 'Identify your biggest energy drain this week and reduce one exposure', 'Write 3 things you\'re grateful for before bed tonight'],
  learning:      ['Read 15 pages of a non-fiction book today — just start', 'Subscribe to one newsletter in a field you\'re curious about', 'Spend 20 minutes learning something you can immediately apply'],
  social:        ['Accept the next social invitation, even if you feel like staying in', 'Reach out to one person outside your immediate circle', 'Attend one local event or group tied to a hobby or interest'],
  habits:        ['Pick one habit, do it at the same time for 7 days — just one', 'Stack it onto something you already do every day', 'Track it with a simple ✓ on paper — visual streaks work'],
  purpose:       ['Write for 10 minutes: what would you do if your current work doubled in impact?', 'Align one task today with something you actually believe in', 'Read one chapter of a biography of someone whose work resonates with you']
};

/**
 * Day 0 drip email — "Your ArcScore Results" recap.
 * Sent immediately after first assessment completion.
 * @param {string} name
 * @param {string} appUrl
 * @param {number} assessmentId
 * @param {number} arcScore - overall average score
 * @param {Array<{key: string, score: number}>} topStrengths - top 2 by score
 * @param {Array<{key: string, score: number}>} focusAreas - bottom 2 by score
 */
function buildDripDay0Html(name, appUrl, assessmentId, arcScore, topStrengths, focusAreas) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const resultsUrl = `${appUrl}/results/${assessmentId}`;

  const buildDimCard = (dim, label) =>
    `<div style="display:inline-block;margin:4px;padding:8px 14px;background:#1e2030;border-radius:8px;font-size:13px;color:#c9d1d9;border:1px solid #30363d;">
      ${DIM_ICONS[dim] || '📊'} ${DIM_LABELS[dim] || label}
    </div>`;

  const strengthCards = topStrengths.map(s => buildDimCard(s.key, s.key)).join('');
  const focusCards = focusAreas.map(s => buildDimCard(s.key, s.key)).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your ArcScore Results</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">
              Arc<span style="color:#7c3aed;">Score</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;color:#e6edf3;">Hey ${firstName} —</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              You completed your first ArcScore assessment. Here's what you found.
            </p>

            <!-- ArcScore number -->
            <div style="text-align:center;margin:0 0 28px;padding:24px;background:#0d1117;border-radius:10px;border:1px solid #21262d;">
              <div style="font-size:48px;font-weight:800;color:#7c3aed;letter-spacing:-2px;">${arcScore}<span style="font-size:24px;color:#8b949e;">/10</span></div>
              <p style="margin:6px 0 0;font-size:13px;color:#8b949e;text-transform:uppercase;letter-spacing:1px;">Your ArcScore</p>
            </div>

            <!-- Strengths -->
            <div style="margin:0 0 20px;">
              <p style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;">Your Top Strengths</p>
              <div>${strengthCards}</div>
            </div>

            <!-- Focus areas -->
            <div style="margin:0 0 28px;">
              <p style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;">Your Focus Areas</p>
              <div>${focusCards}</div>
            </div>

            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#c9d1d9;">
              This is your baseline. In 7 days you can retake the assessment — the deltas are where the real signal lives.
            </p>

            <div style="text-align:center;margin:0 0 20px;">
              <a href="${resultsUrl}" style="display:inline-block;padding:14px 32px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
                View Full Results →
              </a>
            </div>

            <p style="margin:0;font-size:13px;color:#6e7681;text-align:center;">
              Know someone who'd find this useful? Share your results page.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              You're receiving this because you completed an ArcScore assessment.<br />
              <a href="${appUrl}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Day 3 drip email — "Your Growth Opportunity".
 * Focuses on the user's lowest-scoring dimension with 3 actionable tips.
 * @param {string} name
 * @param {string} appUrl
 * @param {string} lowestDimKey - dimension key with lowest score
 * @param {number} lowestScore
 */
function buildDripDay3Html(name, appUrl, lowestDimKey, lowestScore) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const dimName = DIM_LABELS[lowestDimKey] || lowestDimKey;
  const dimIcon = DIM_ICONS[lowestDimKey] || '📊';
  const tips = DIM_TIPS[lowestDimKey] || DIM_TIPS.habits;

  const tipItems = tips.map((tip, i) =>
    `<div style="display:flex;align-items:flex-start;margin:0 0 12px;">
      <span style="min-width:22px;height:22px;background:#7c3aed;border-radius:50%;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-right:12px;margin-top:2px;">${i + 1}</span>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#c9d1d9;">${tip}</p>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Your Growth Opportunity — ArcScore</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">
              Arc<span style="color:#7c3aed;">Score</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;color:#e6edf3;">Hey ${firstName} —</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              Three days ago you scored yourself across 9 dimensions. Here's where the biggest opportunity sits.
            </p>

            <!-- Lowest dimension callout -->
            <div style="margin:0 0 24px;padding:20px;background:#0d1117;border-radius:10px;border:1px solid #21262d;text-align:center;">
              <div style="font-size:32px;margin:0 0 6px;">${dimIcon}</div>
              <div style="font-size:20px;font-weight:700;color:#e6edf3;">${dimName}</div>
              <div style="font-size:28px;font-weight:800;color:#f59e0b;margin:4px 0;">${lowestScore}<span style="font-size:14px;color:#8b949e;">/10</span></div>
              <p style="margin:6px 0 0;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:1px;">Your lowest score</p>
            </div>

            <p style="margin:0 0 16px;font-size:14px;color:#e6edf3;font-weight:600;">3 things to move the needle this week:</p>

            <div style="margin:0 0 28px;">
              ${tipItems}
            </div>

            <div style="padding:16px;background:#161b22;border:1px solid #30363d;border-radius:8px;margin:0 0 28px;">
              <p style="margin:0;font-size:13px;color:#8b949e;line-height:1.5;">
                📅 <strong style="color:#c9d1d9;">4 more days</strong> until your 7-day retake window opens. Do one thing from the list above, then come back and see if the score moved.
              </p>
            </div>

            <div style="text-align:center;">
              <a href="${appUrl}/dashboard" style="display:inline-block;padding:14px 32px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
                View Dashboard →
              </a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              You're receiving this because you completed an ArcScore assessment.<br />
              <a href="${appUrl}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Day 7 drip email — "Time to Retake".
 * The 7-day cooldown is up. Prompt retake with context on what they'll see.
 * @param {string} name
 * @param {string} appUrl
 * @param {number} arcScore - their original score
 * @param {string} lowestDimKey - dimension they were working on
 */
function buildDripDay7Html(name, appUrl, arcScore, lowestDimKey) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const dimName = DIM_LABELS[lowestDimKey] || lowestDimKey;
  const dimIcon = DIM_ICONS[lowestDimKey] || '📊';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Time to Retake — ArcScore</title>
</head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#c9d1d9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d1117;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#161b22;border-radius:12px;overflow:hidden;border:1px solid #30363d;">
        <tr>
          <td style="padding:32px 32px 24px;text-align:center;border-bottom:1px solid #21262d;">
            <div style="font-size:28px;font-weight:700;color:#e6edf3;letter-spacing:-0.5px;">
              Arc<span style="color:#7c3aed;">Score</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;color:#e6edf3;">Hey ${firstName} —</p>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#c9d1d9;">
              It's been 7 days. Your retake window is open.
            </p>

            <!-- Previous score reminder -->
            <div style="margin:0 0 24px;padding:20px;background:#0d1117;border-radius:10px;border:1px solid #21262d;">
              <p style="margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#8b949e;text-align:center;">Your baseline from 7 days ago</p>
              <div style="display:flex;justify-content:center;align-items:center;gap:24px;text-align:center;">
                <div>
                  <div style="font-size:32px;font-weight:800;color:#7c3aed;">${arcScore}<span style="font-size:14px;color:#8b949e;">/10</span></div>
                  <p style="margin:4px 0 0;font-size:11px;color:#8b949e;">ArcScore</p>
                </div>
                <div style="font-size:24px;color:#30363d;">→</div>
                <div>
                  <div style="font-size:32px;font-weight:800;color:#8b949e;">?<span style="font-size:14px;">/?</span></div>
                  <p style="margin:4px 0 0;font-size:11px;color:#8b949e;">Today</p>
                </div>
              </div>
            </div>

            <!-- What they'll see -->
            <div style="margin:0 0 24px;">
              <p style="margin:0 0 12px;font-size:13px;color:#e6edf3;font-weight:600;">After you retake, you'll see:</p>
              <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;align-items:center;font-size:13px;color:#c9d1d9;gap:10px;">
                  <span style="color:#22c55e;font-weight:700;">↑ ↓ →</span> Delta arrows on every dimension vs your baseline
                </div>
                <div style="display:flex;align-items:center;font-size:13px;color:#c9d1d9;gap:10px;">
                  <span style="color:#7c3aed;font-weight:700;">📊</span> Progress tracking across time on your dashboard
                </div>
                <div style="display:flex;align-items:center;font-size:13px;color:#c9d1d9;gap:10px;">
                  <span style="font-weight:700;">${dimIcon}</span> Did ${dimName} move? Find out.
                </div>
              </div>
            </div>

            <div style="text-align:center;margin:0 0 20px;">
              <a href="${appUrl}/assess" style="display:inline-block;padding:14px 36px;background:#7c3aed;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
                Retake Now →
              </a>
            </div>

            <p style="margin:0;font-size:13px;color:#6e7681;text-align:center;">Takes about 2 minutes.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #21262d;text-align:center;">
            <p style="margin:0;font-size:12px;color:#8b949e;">
              You're receiving this because you completed an ArcScore assessment.<br />
              <a href="${appUrl}/settings" style="color:#7c3aed;text-decoration:none;">Manage email preferences</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

module.exports = {
  sendEmail,
  registerContact,
  buildWelcomeEmailHtml,
  buildReminderEmailHtml,
  buildDripDay0Html,
  buildDripDay3Html,
  buildDripDay7Html,
};
