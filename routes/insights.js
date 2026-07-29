// routes/insights.js — owns /api/insights/* and insight engine logic.
// Does NOT own assessment CRUD or re-engagement prompts.
const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

const DIMENSION_NAMES = { fitness: 'Physical', financial: 'Financial', relationships: 'Relationships',
  career: 'Career', mental_health: 'Mental', learning: 'Learning', social: 'Social', habits: 'Habits', purpose: 'Purpose' };
const ALL_DIMENSION_KEYS = Object.keys(DIMENSION_NAMES);

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const meanX = sumX / n, meanY = sumY / n;
  const denom = sumX2 - n * meanX * meanX;
  if (Math.abs(denom) < 1e-10) return null;
  const slope = (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  const ssTot = points.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  return { slope, intercept, r2: ssTot < 1e-10 ? 0 : Math.max(0, 1 - ssRes / ssTot) };
}

function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  if (dx < 1e-10 || dy < 1e-10) return 0;
  return num / (dx * dy);
}

function stddev(values) {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length);
}

function generateInsights(assessments, lifeEvents) {
  const insights = [];
  if (!assessments || assessments.length < 2) return insights;

  const dimSeries = {};
  for (const key of ALL_DIMENSION_KEYS) dimSeries[key] = [];
  const overallSeries = [];

  for (const a of assessments) {
    const completed = new Date(a.completed_at);
    const t = completed.getTime() / (1000 * 60 * 60 * 24);
    const scores = Array.isArray(a.scores) ? a.scores : [];
    let total = 0, count = 0;
    for (const key of ALL_DIMENSION_KEYS) {
      const s = scores.find(sc => sc.dimension_key === key);
      if (s) { dimSeries[key].push({ date: completed, t, score: s.score }); total += s.score; count++; }
    }
    if (count > 0) overallSeries.push({ date: completed, t, score: total / count });
  }

  const MIN_POINTS = 3;
  const trendTargets = [{ key: 'overall', label: 'Overall score', series: overallSeries },
    ...ALL_DIMENSION_KEYS.map(k => ({ key: k, label: DIMENSION_NAMES[k], series: dimSeries[k] }))];

  for (const target of trendTargets) {
    const series = target.series;
    if (series.length < MIN_POINTS) continue;
    const reg = linearRegression(series.map(s => ({ x: s.t, y: s.score })));
    if (!reg) continue;
    const changePerMonth = reg.slope * 30;
    const absChange = Math.abs(changePerMonth);
    if (absChange < 0.4 || reg.r2 < 0.25) continue;
    const confidence = parseFloat(Math.min(1, reg.r2 + (series.length / 20)).toFixed(2));
    const isRise = changePerMonth > 0;
    const dimName = target.label, changeStr = absChange.toFixed(1);
    insights.push({ type: isRise ? 'trend_rise' : 'trend_fall', dimension: target.key === 'overall' ? null : target.key,
      pattern: isRise ? `Rising ~${changeStr} pts/month` : `Declining ~${changeStr} pts/month`, confidence,
      description: isRise ? `Your ${dimName} has been steadily improving, gaining about ${changeStr} points per month.`
        : `Your ${dimName} has been gradually declining, dropping about ${changeStr} points per month.`,
      suggestion: isRise ? `Keep it up — consistency is compounding. Reflect on what's working and double down on it.`
        : `Identify one small, concrete action you can take this week to reverse the trend. Small inputs compound too.` });
  }

  for (const key of ALL_DIMENSION_KEYS) {
    const series = dimSeries[key];
    if (series.length < MIN_POINTS) continue;
    const recentScores = series.slice(-Math.min(series.length, 5)).map(s => s.score);
    const sd = stddev(recentScores);
    const mean = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    if (sd <= 0.6 && recentScores.length >= MIN_POINTS) {
      const confidence = parseFloat(Math.min(1, recentScores.length / 6 + (1 - sd / 2)).toFixed(2));
      insights.push({ type: 'plateau', dimension: key, pattern: `Steady at ~${mean.toFixed(1)}`, confidence,
        description: `Your ${DIMENSION_NAMES[key]} score has been stable around ${mean.toFixed(1)} across your last ${recentScores.length} assessments.`,
        suggestion: mean >= 7 ? `You're holding strong here. Consider where else you could direct this momentum.`
          : `A plateau at ${mean.toFixed(1)} is a signal. What would it take to move this to a 7? Name one thing.` });
    }
  }

  const dimPairs = [];
  for (let i = 0; i < ALL_DIMENSION_KEYS.length; i++)
    for (let j = i + 1; j < ALL_DIMENSION_KEYS.length; j++)
      dimPairs.push([ALL_DIMENSION_KEYS[i], ALL_DIMENSION_KEYS[j]]);

  for (const [keyA, keyB] of dimPairs) {
    const seriesA = dimSeries[keyA], seriesB = dimSeries[keyB];
    const shared = [];
    for (const a of seriesA) {
      const match = seriesB.find(b => Math.abs(b.t - a.t) <= 3);
      if (match) shared.push({ scoreA: a.score, scoreB: match.score });
    }
    if (shared.length < 4) continue;
    const r = pearsonCorrelation(shared.map(s => s.scoreA), shared.map(s => s.scoreB));
    if (Math.abs(r) < 0.65) continue;
    const confidence = parseFloat(Math.min(1, Math.abs(r) * (shared.length / 8)).toFixed(2));
    const isPos = r > 0, nameA = DIMENSION_NAMES[keyA], nameB = DIMENSION_NAMES[keyB];
    insights.push({ type: 'correlation', dimension: keyA,
      pattern: isPos ? `${keyA} ↔ ${keyB} (r=${r.toFixed(2)})` : `${keyA} ↔ ${keyB} inverse (r=${r.toFixed(2)})`, confidence,
      description: isPos ? `Your ${nameA} and ${nameB} scores tend to move together — when one rises, so does the other.`
        : `Your ${nameA} and ${nameB} scores tend to move in opposite directions — gains in one often coincide with dips in the other.`,
      suggestion: isPos ? `Investing in either area may lift both. Which one is easier to move right now?`
        : `This tension is worth watching. Can you find a routine that serves both without trading one off against the other?` });
  }

  if (lifeEvents && lifeEvents.length > 0 && assessments.length >= 3) {
    for (const event of lifeEvents) {
      const eventT = new Date(event.occurred_at).getTime();
      const windowMs = 8 * 7 * 24 * 60 * 60 * 1000, minMs = 4 * 7 * 24 * 60 * 60 * 1000;
      const before = assessments.filter(a => { const dt = eventT - new Date(a.completed_at).getTime(); return dt >= minMs && dt <= windowMs; });
      const after = assessments.filter(a => { const dt = new Date(a.completed_at).getTime() - eventT; return dt >= minMs && dt <= windowMs; });
      if (!before.length || !after.length) continue;
      const avgScores = (a) => { const s = Array.isArray(a.scores) ? a.scores.map(sc => sc.score).filter(v => v != null) : []; return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
      const beforeScores = before.map(avgScores).filter(v => v !== null);
      const afterScores = after.map(avgScores).filter(v => v !== null);
      if (!beforeScores.length || !afterScores.length) continue;
      const meanBefore = beforeScores.reduce((a, b) => a + b, 0) / beforeScores.length;
      const meanAfter = afterScores.reduce((a, b) => a + b, 0) / afterScores.length;
      const delta = meanAfter - meanBefore;
      if (Math.abs(delta) < 0.5) continue;
      const confidence = parseFloat(Math.min(1, (before.length + after.length) / 6).toFixed(2));
      const sign = delta > 0 ? '+' : '';
      const eventTitle = event.title.length > 40 ? event.title.slice(0, 40) + '…' : event.title;
      insights.push({ type: 'life_event_impact', dimension: null,
        pattern: `"${eventTitle}" → ${sign}${delta.toFixed(1)} overall`, confidence,
        description: `After "${event.title}", your overall score shifted by ${sign}${delta.toFixed(1)} points compared to the weeks before.`,
        suggestion: delta > 0 ? `This event seems to have had a positive effect. What about it helped you thrive?`
          : `This event may have weighed on your scores. That's expected — major life changes take time to integrate. Keep tracking.` });
    }
  }

  insights.sort((a, b) => b.confidence - a.confidence);
  const seen = new Set(), deduped = [];
  for (const ins of insights) {
    const key = `${ins.type}:${ins.dimension || 'overall'}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(ins); }
  }
  return deduped;
}

router.post('/generate', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const assessmentsResult = await client.query(
      `SELECT a.id, a.completed_at,
              json_agg(json_build_object('dimension_key', d.key, 'dimension_name', d.name, 'score', s.score) ORDER BY d.sort_order) as scores
       FROM assessments a
       LEFT JOIN assessment_scores s ON s.assessment_id = a.id
       LEFT JOIN dimensions d ON d.id = s.dimension_id
       WHERE a.user_id = $1 AND a.completed_at IS NOT NULL GROUP BY a.id ORDER BY a.completed_at ASC`,
      [req.session.userId]
    );
    const assessments = assessmentsResult.rows;
    if (assessments.length < 2) return res.json({ ok: true, insights: [], message: 'Not enough data yet — keep tracking to unlock insights' });

    const eventsResult = await client.query(
      `SELECT id, event_type, title, occurred_at, dimensions_affected FROM life_events WHERE user_id = $1 ORDER BY occurred_at ASC`,
      [req.session.userId]
    );
    const rawInsights = generateInsights(assessments, eventsResult.rows);

    await client.query('BEGIN');
    await client.query('DELETE FROM insights WHERE user_id = $1', [req.session.userId]);
    const stored = [];
    for (const ins of rawInsights) {
      const result = await client.query(
        `INSERT INTO insights (user_id, insight_type, dimension_key, pattern, confidence, description, suggestion, metadata, assessment_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, insight_type, dimension_key, pattern, confidence, description, suggestion, generated_at`,
        [req.session.userId, ins.type, ins.dimension || null, ins.pattern, ins.confidence, ins.description, ins.suggestion,
          JSON.stringify({ dimension2: ins.dimension2 || null }), assessments.length]
      );
      stored.push(result.rows[0]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, insights: stored });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Generate insights error:', err);
    res.status(500).json({ error: 'Failed to generate insights' });
  } finally {
    client.release();
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, insight_type, dimension_key, pattern, confidence, description, suggestion, generated_at, assessment_count
       FROM insights WHERE user_id = $1 ORDER BY confidence DESC, generated_at DESC`,
      [req.session.userId]
    );
    res.json({ insights: result.rows });
  } catch (err) {
    console.error('Get insights error:', err);
    res.status(500).json({ error: 'Failed to load insights' });
  }
});

module.exports = router;
