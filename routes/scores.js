// routes/scores.js -- owns /api/scores/* for longitudinal score history views.
// Powers the /timeline page and the embeddable history strip on /results/:id.
// /annotations -- pattern-detection bands for the /timeline page (growth/decline/recovery).
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

const LIFE_EVENT_TYPES = ['career_change', 'relationship', 'health', 'relocation', 'financial', 'loss', 'achievement', 'other'];
const VALID_DIMENSION_KEYS = ['fitness', 'financial', 'relationships', 'career', 'mental_health', 'learning', 'social', 'habits', 'purpose'];
const PHYSICAL_KEY = 'fitness';

// RFC 4180 — wrap a field in quotes if it contains `,`, `"`, `\n`, or `;`,
// doubling any embedded quotes. `;` is included so the `event_tags` triple
// format won't break a CSV row when opened in Excel/Numbers.
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[,"\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function ymd(d) {
  const iso = new Date(d).toISOString();
  return iso.split('T')[0];
}

function formatMonthYear(d) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Resolve the requested date-range filter from the query string.
// Returns { from, to, preset } where `from` and `to` are ISO date strings
// (inclusive, anchored to the start/end of the day) or undefined when no
// bound is set. `preset` echoes the chosen bucket so the client can mark
// the active button without re-deriving it from the URL.
function resolveRangePreset(query) {
  const rangeRaw = (query.range || '').toString().toLowerCase();
  const fromRaw = (query.from || '').toString().trim();
  const toRaw = (query.to || '').toString().trim();

  // Custom window wins when explicit dates are supplied, even if `range`
  // was also sent — the date inputs are the precise intent.
  if (fromRaw || toRaw) {
    return { from: fromRaw || undefined, to: toRaw || undefined, preset: 'custom' };
  }

  if (rangeRaw === '3m' || rangeRaw === '6m' || rangeRaw === '1y') {
    const months = rangeRaw === '3m' ? 3 : rangeRaw === '6m' ? 6 : 12;
    const now = new Date();
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const from = new Date(now.getFullYear(), now.getMonth() - months, now.getDate(), 0, 0, 0, 0);
    return { from: from.toISOString(), to: to.toISOString(), preset: rangeRaw };
  }

  // 'all' (or anything else / nothing) means no bound.
  return { from: undefined, to: undefined, preset: 'all' };
}

// Convert a date-range filter (from resolveRangePreset) into a pair of
// timestamptz values clamped to day boundaries. Returns { fromTs, toTs }
// where each may be null when no bound is set.
function dateRangeBounds(filter) {
  let fromTs = null;
  let toTs = null;
  if (filter.from) {
    const d = new Date(filter.from);
    if (!isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      fromTs = d.toISOString();
    }
  }
  if (filter.to) {
    const d = new Date(filter.to);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      toTs = d.toISOString();
    }
  }
  return { fromTs, toTs };
}

// GET /api/scores/export -- personal data export so users can own their arc.
// ?format=csv (default) streams a CSV; ?format=json returns the same data
// as structured JSON. One row per completed assessment; life events are
// bucketed onto the assessment whose [prev_completed_at, this_completed_at]
// window contains the event. Events before the very first assessment tag
// onto the first row; events after the latest assessment tag onto the last
// row -- so no event is ever silently dropped from the export.
router.get('/export', requireAuth, async (req, res) => {
  const format = (req.query.format || 'csv').toLowerCase();
  if (format !== 'csv' && format !== 'json') {
    return res.status(400).json({ error: 'format must be csv or json' });
  }

  try {
    const [assessmentsResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.created_at, a.completed_at, a.notes,
                json_agg(json_build_object('dimension_key', d.key,
                  'dimension_name', d.name, 'score', s.score) ORDER BY d.sort_order) as scores
         FROM assessments a
         LEFT JOIN assessment_scores s ON s.assessment_id = a.id
         LEFT JOIN dimensions d ON d.id = s.dimension_id
         WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
         GROUP BY a.id ORDER BY a.completed_at ASC`,
        [req.session.userId]
      ),
      pool.query(
        `SELECT id, event_type, title, occurred_at, dimensions_affected
         FROM life_events WHERE user_id = $1 ORDER BY occurred_at ASC`,
        [req.session.userId]
      )
    ]);

    const assessments = assessmentsResult.rows.map(a => {
      const scores = Array.isArray(a.scores) ? a.scores.filter(s => s.dimension_key !== null) : [];
      // Per-row score map keyed by stable lowercase dimension key (matches
      // the CSV column header order and lets a re-import script read
      // body.assessments[i].scores.physical directly).
      const byKey = {};
      for (const s of scores) {
        byKey[s.dimension_key] = s.score;
      }
      const overall = scores.length > 0
        ? parseFloat((scores.reduce((sum, s) => sum + s.score, 0) / scores.length).toFixed(1))
        : null;
      return {
        id: a.id,
        created_at: a.created_at,
        completed_at: a.completed_at,
        notes: a.notes,
        scores: byKey,
        overall_score: overall,
        life_events: []
      };
    });

    // Bucket events onto the assessment at whose completed_at the event
    // "lands": events before the first assessment tag the first row,
    // events after the last assessment tag the last row, and events
    // between two adjacent assessments tag the later one (so the same
    // event isn't tagged twice).
    for (const ev of eventsResult.rows) {
      if (assessments.length === 0) continue;
      const evTime = new Date(ev.occurred_at).getTime();
      const firstTime = new Date(assessments[0].completed_at).getTime();
      const last = assessments[assessments.length - 1];
      const lastTime = new Date(last.completed_at).getTime();
      let target;
      if (evTime < firstTime) {
        target = assessments[0];
      } else if (evTime > lastTime) {
        target = last;
      } else {
        for (const a of assessments) {
          if (new Date(a.completed_at).getTime() >= evTime) { target = a; break; }
        }
      }
      target.life_events.push({
        event_type: ev.event_type,
        title: ev.title,
        occurred_at: ev.occurred_at,
        dimensions_affected: Array.isArray(ev.dimensions_affected) ? ev.dimensions_affected : []
      });
    }

    logEvent(req.session.userId, 'data_export_requested', { format }).catch(() => {});

    const today = new Date().toISOString().split('T')[0];
    const filename = `arcscore-export-${today}.${format}`;

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.json({
        meta: { exported_at: new Date().toISOString(), user_id: req.session.userId, format: 'json' },
        assessments
      });
    }

    // CSV branch — columns in lowercase per the export spec sheet
    const cols = ['physical', 'financial', 'relationships', 'career', 'mental', 'learning', 'social', 'habits', 'purpose'];
    const header = ['assessment_id', 'completed_at', 'notes', ...cols, 'overall_score', 'event_tags'];
    const lines = [header.map(csvField).join(',')];
    for (const a of assessments) {
      const tags = a.life_events.map(e =>
        `${e.event_type}:${e.title}:${ymd(e.occurred_at)}`
      ).join(';');
      const row = [
        a.id,
        a.completed_at ? new Date(a.completed_at).toISOString() : '',
        a.notes || '',
        ...cols.map(c => (a.scores[c] !== undefined ? a.scores[c] : '')),
        a.overall_score !== null ? a.overall_score : '',
        tags
      ];
      lines.push(row.map(csvField).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(lines.join('\n') + '\n');
  } catch (err) {
    console.error('Scores export error:', err);
    res.status(500).json({ error: 'Failed to export scores' });
  }
});

// GET /api/scores/history -- all completed assessments + life events +
// server-computed summary (total, date range, biggest-mover dimension).
// Mirrors the existing /api/assessments/timeline payload shape, but adds
// a pre-computed summary so the page doesn't repeat the math.
// Optional ?range=3m|6m|1y|all and ?from=ISO&to=ISO filter the assessments
// (and the life events that bracket them) to the selected window so the
// /timeline page can scope the score arc without re-querying.
router.get('/history', requireAuth, async (req, res) => {
  const filter = resolveRangePreset(req.query);
  const { fromTs, toTs } = dateRangeBounds(filter);

  try {
    const aParams = [req.session.userId];
    let aWhere = 'a.user_id = $1 AND a.completed_at IS NOT NULL';
    if (fromTs) { aParams.push(fromTs); aWhere += ` AND a.completed_at >= $${aParams.length}`; }
    if (toTs)   { aParams.push(toTs);   aWhere += ` AND a.completed_at <= $${aParams.length}`; }

    const eParams = [req.session.userId];
    let eWhere = 'user_id = $1';
    if (fromTs) { eParams.push(fromTs); eWhere += ` AND occurred_at >= $${eParams.length}`; }
    if (toTs)   { eParams.push(toTs);   eWhere += ` AND occurred_at <= $${eParams.length}`; }

    const [assessmentsResult, eventsResult] = await Promise.all([
      pool.query(
        `SELECT a.id, a.completed_at, a.notes,
                json_agg(json_build_object('dimension_id', s.dimension_id, 'dimension_key', d.key,
                  'dimension_name', d.name, 'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order) as scores
         FROM assessments a
         LEFT JOIN assessment_scores s ON s.assessment_id = a.id
         LEFT JOIN dimensions d ON d.id = s.dimension_id
         WHERE ${aWhere}
         GROUP BY a.id ORDER BY a.completed_at ASC`,
        aParams
      ),
      pool.query(
        `SELECT id, assessment_id, event_type, title, description, occurred_at, dimensions_affected
         FROM life_events WHERE ${eWhere} ORDER BY occurred_at ASC`,
        eParams
      )
    ]);

    const assessments = assessmentsResult.rows.map(a => {
      const scores = Array.isArray(a.scores) ? a.scores.filter(s => s.dimension_id !== null) : [];
      return { ...a, scores };
    });

    const summary = computeHistorySummary(assessments);

    logEvent(req.session.userId, 'timeline_viewed', { source: 'api', range_preset: filter.preset }).catch(() => {});

    res.json({
      assessments,
      life_events: eventsResult.rows,
      summary,
      window: { from: fromTs, to: toTs, preset: filter.preset }
    });
  } catch (err) {
    console.error('Scores history error:', err);
    res.status(500).json({ error: 'Failed to load scores history' });
  }
});

// GET /api/scores/cross-insights -- first cross-domain insight card on
// /timeline. Scoped to a single domain per load (default 'fitness') so the
// UI can paint a strip per domain as those land as later tasks. Window is
// derived from completed assessments whose Physical score bounds the
// the fitness-tagged life event: before = latest assessment within
// [occurred_at - 8w, occurred_at] with a fitness score, after = latest
// assessment at or after occurred_at with a fitness score; require ≥2
// weeks between them so we never label a 3-day blip as an investment.
router.get('/cross-insights', requireAuth, async (req, res) => {
  const domain = (req.query.domain || 'fitness').toString();
  const DIMENSION_DISPLAY = {
    fitness: { key: 'fitness', name: 'Physical', icon: '🏋' },
    career: { key: 'career', name: 'Career', icon: '🚀' }
  };
  const dim = DIMENSION_DISPLAY[domain];

  try {
    const [eventsResult, assessmentsResult] = await Promise.all([
      pool.query(
        `SELECT id, occurred_at, title, dimensions_affected
         FROM life_events WHERE user_id = $1 ORDER BY occurred_at ASC`,
        [req.session.userId]
      ),
      pool.query(
        `SELECT a.id, a.completed_at,
                json_agg(json_build_object('dimension_key', d.key,
                  'dimension_name', d.name, 'dimension_icon', d.icon, 'score', s.score) ORDER BY d.sort_order) as scores
         FROM assessments a
         LEFT JOIN assessment_scores s ON s.assessment_id = a.id
         LEFT JOIN dimensions d ON d.id = s.dimension_id
         WHERE a.user_id = $1 AND a.completed_at IS NOT NULL
         GROUP BY a.id ORDER BY a.completed_at ASC`,
        [req.session.userId]
      )
    ]);

    let insight = null;
    if (dim) {
      const assessments = assessmentsResult.rows;
      const eightWeeks = 8 * 7 * 24 * 60 * 60 * 1000;
      const twoWeeks = 2 * 7 * 24 * 60 * 60 * 1000;
      const thirtyPointFour = 1000 * 60 * 60 * 24 * 30.4375;

      for (const ev of eventsResult.rows) {
        const dims = Array.isArray(ev.dimensions_affected) ? ev.dimensions_affected : [];
        if (!dims.includes(domain)) continue;

        const evTime = new Date(ev.occurred_at).getTime();
        const lower = evTime - eightWeeks;

        let before = null;
        for (const a of assessments) {
          const at = new Date(a.completed_at).getTime();
          if (at < lower || at > evTime) continue;
          const fs = (a.scores || []).find(s => s.dimension_key === domain);
          if (!fs) continue;
          if (!before || new Date(before.completed_at).getTime() < at) before = { ...a, score: fs.score };
        }

        let after = null;
        for (const a of assessments) {
          const at = new Date(a.completed_at).getTime();
          if (at < evTime) continue;
          const fs = (a.scores || []).find(s => s.dimension_key === domain);
          if (!fs) continue;
          if (!after || new Date(after.completed_at).getTime() < at) after = { ...a, score: fs.score };
        }

        if (!before || !after) continue;
        const beforeT = new Date(before.completed_at).getTime();
        const afterT = new Date(after.completed_at).getTime();
        if (afterT - beforeT < twoWeeks) continue;

        const monthsRaw = (afterT - beforeT) / thirtyPointFour;
        const months = Math.round(monthsRaw * 10) / 10;
        const delta = Math.round((after.score - before.score) * 10) / 10;

        insight = {
          months,
          delta,
          before_score: before.score,
          after_score: after.score,
          event_title: ev.title,
          event_id: ev.id,
          before_assessment_id: before.id,
          after_assessment_id: after.id,
          before_completed_at: before.completed_at,
          after_completed_at: after.completed_at
        };
        break;
      }
    }

    logEvent(req.session.userId, 'cross_insight_viewed', {
      domain,
      has_data: !!insight
    }).catch(() => {});

    res.json({ domain, dimension: dim, insight });
  } catch (err) {
    console.error('Scores cross-insights error:', err);
    res.status(500).json({ error: 'Failed to compute cross-domain insights' });
  }
});

// GET /api/scores/annotations -- pattern-detection spans for the /timeline
// page. Returns ordered annotations of three classes:
//   * growth_phase:    overall score rising at >=0.4 pts/month over >=3
//                       consecutive assessments (regression r2 >= 0.5).
//   * decline_window:  same shape, mirrored to negative slope (decline).
//   * recovery_curve:  a local trough (lower than neighbors within +/- 2
//                       assessments) followed by a positive-slope run.
// The detector runs on the same overallSeries math that powers the
// already-shipping /api/insights/generate endpoint so signal stays
// consistent across the R&D pipeline.
router.get('/annotations', requireAuth, async (req, res) => {
  const filter = resolveRangePreset(req.query);
  const { fromTs, toTs } = dateRangeBounds(filter);

  try {
    const aParams = [req.session.userId];
    let aWhere = 'a.user_id = $1 AND a.completed_at IS NOT NULL';
    if (fromTs) { aParams.push(fromTs); aWhere += ` AND a.completed_at >= $${aParams.length}`; }
    if (toTs)   { aParams.push(toTs);   aWhere += ` AND a.completed_at <= $${aParams.length}`; }

    const assessmentsResult = await pool.query(
      `SELECT a.id, a.completed_at,
              json_agg(json_build_object('dimension_key', d.key, 'score', s.score) ORDER BY d.sort_order) as scores
       FROM assessments a
       LEFT JOIN assessment_scores s ON s.assessment_id = a.id
       LEFT JOIN dimensions d ON d.id = s.dimension_id
       WHERE ${aWhere}
       GROUP BY a.id ORDER BY a.completed_at ASC`,
      aParams
    );

    const assessments = assessmentsResult.rows;
    if (assessments.length < 3) {
      return res.json({ annotations: [], window: { from: fromTs, to: toTs, preset: filter.preset } });
    }

    const overallSeries = buildOverallSeries(assessments);
    if (overallSeries.length < 3) {
      return res.json({ annotations: [], window: { from: fromTs, to: toTs, preset: filter.preset } });
    }

    const rawAnnotations = [
      ...detectTrendRuns(overallSeries, 'growth_phase', { positive: true }),
      ...detectTrendRuns(overallSeries, 'decline_window', { positive: false }),
      ...detectRecoveryCurves(overallSeries)
    ];

    const mergedByType = {};
    for (const a of rawAnnotations) {
      if (!mergedByType[a.type]) mergedByType[a.type] = [];
      const list = mergedByType[a.type];
      const last = list[list.length - 1];
      if (last && gapOfOne(last, a)) {
        last.end = a.end;
        last.end_assessment_id = a.end_assessment_id;
        last.end_t = a.end_t;
        last.points = a.end_index - last.start_index + 1;
      } else {
        list.push(a);
      }
    }

    const annotations = [];
    const countsByType = {};
    for (const type of Object.keys(mergedByType)) {
      for (const a of mergedByType[type]) {
        annotations.push(a);
        countsByType[a.type] = (countsByType[a.type] || 0) + 1;
      }
    }
    annotations.sort((x, y) => new Date(x.start).getTime() - new Date(y.start).getTime());

    logEvent(req.session.userId, 'annotations_viewed', { counts_by_type: countsByType }).catch(() => {});

    res.json({ annotations, counts_by_type: countsByType, window: { from: fromTs, to: toTs, preset: filter.preset } });
  } catch (err) {
    console.error('Scores annotations error:', err);
    res.status(500).json({ error: 'Failed to compute annotations' });
  }
});

// POST /api/scores/:id/event -- attach a life event to a specific assessment.
// Mirrors POST /api/life-events but ties the event to the score so it shows
// as a labeled marker on /timeline at the event's date.
router.post('/:id/event', requireAuth, async (req, res) => {
  try {
    const assessmentId = parseInt(req.params.id, 10);
    if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

    const owns = await pool.query(
      'SELECT 1 FROM assessments WHERE id = $1 AND user_id = $2',
      [assessmentId, req.session.userId]
    );
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    const { event_type, title, description, occurred_at, dimensions_affected } = req.body || {};
    if (!event_type || !title || !occurred_at) return res.status(400).json({ error: 'Event type, title, and date are required' });
    if (!LIFE_EVENT_TYPES.includes(event_type)) return res.status(400).json({ error: 'Invalid event type' });
    if (title.length > 200) return res.status(400).json({ error: 'Title must be 200 characters or less' });

    const eventDate = new Date(occurred_at);
    if (isNaN(eventDate.getTime())) return res.status(400).json({ error: 'Invalid date' });

    const dims = Array.isArray(dimensions_affected) ? dimensions_affected : [];
    const invalidDims = dims.filter(d => !VALID_DIMENSION_KEYS.includes(d));
    if (invalidDims.length > 0) return res.status(400).json({ error: 'Invalid dimension keys: ' + invalidDims.join(', ') });

    const result = await pool.query(
      `INSERT INTO life_events (user_id, assessment_id, event_type, title, description, occurred_at, dimensions_affected)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, assessment_id, event_type, title, description, occurred_at, dimensions_affected, created_at`,
      [req.session.userId, assessmentId, event_type, title.trim(), description?.trim() || null, occurred_at, JSON.stringify(dims)]
    );
    res.status(201).json({ life_event: result.rows[0] });
  } catch (err) {
    console.error('Create score event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

function computeHistorySummary(assessments) {
  if (!assessments || assessments.length === 0) {
    return {
      total_assessments: 0,
      first_completed_at: null,
      last_completed_at: null,
      date_range: null,
      biggest_mover: null
    };
  }

  const first = assessments[0];
  const last = assessments[assessments.length - 1];
  const firstDate = new Date(first.completed_at);
  const lastDate = new Date(last.completed_at);
  const dateRange = (firstDate.getFullYear() === lastDate.getFullYear() && firstDate.getMonth() === lastDate.getMonth())
    ? formatMonthYear(firstDate)
    : `${formatMonthYear(firstDate)} – ${formatMonthYear(lastDate)}`;

  let biggestMover = null;
  if (assessments.length >= 2) {
    const keys = new Set();
    assessments.forEach(a => {
      (a.scores || []).forEach(s => keys.add(s.dimension_key));
    });

    for (let i = 0; i < assessments.length - 1; i++) {
      const f = assessments[i];
      const l = assessments[i + 1];
      const pairKeys = new Set();
      (f.scores || []).forEach(s => pairKeys.add(s.dimension_key));
      (l.scores || []).forEach(s => pairKeys.add(s.dimension_key));

      pairKeys.forEach(key => {
        const fs = f.scores.find(s => s.dimension_key === key);
        const ls = l.scores.find(s => s.dimension_key === key);
        if (!fs || !ls) return;
        const delta = ls.score - fs.score;
        const absDelta = Math.abs(delta);
        if (!biggestMover || absDelta > Math.abs(biggestMover.delta)) {
          const firstDate = new Date(f.completed_at);
          const latestDate = new Date(l.completed_at);
          const window = (firstDate.getFullYear() === latestDate.getFullYear() && firstDate.getMonth() === latestDate.getMonth())
            ? formatMonthYear(firstDate)
            : `${formatMonthYear(firstDate)} → ${formatMonthYear(latestDate)}`;
          biggestMover = {
            key,
            name: ls.dimension_name || fs.dimension_name || key,
            icon: ls.dimension_icon || fs.dimension_icon || '',
            delta,
            first_score: fs.score,
            latest_score: ls.score,
            first_assessment_id: f.id,
            latest_assessment_id: l.id,
            first_completed_at: f.completed_at,
            latest_completed_at: l.completed_at,
            window
          };
        }
      });
    }
  }

  return {
    total_assessments: assessments.length,
    first_completed_at: first.completed_at,
    last_completed_at: last.completed_at,
    date_range: dateRange,
    biggest_mover: biggestMover
  };
}

// ── ANNOTATION DETECTION HELPERS ──

// Mirror of the regression used in routes/insights.js so the /annotations
// signal stays aligned with the already-shipping insights engine. Kept
// local on purpose: routes/insights.js is the source of truth for human
// insights and shouldn't take a new dependency.
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

function buildOverallSeries(assessments) {
  const series = [];
  for (const a of assessments) {
    const completed = new Date(a.completed_at);
    const t = completed.getTime() / (1000 * 60 * 60 * 24);
    const scores = Array.isArray(a.scores) ? a.scores.filter(s => s.dimension_key !== null) : [];
    if (scores.length === 0) continue;
    const total = scores.reduce((s, x) => s + x.score, 0);
    series.push({
      assessment_id: a.id,
      index: series.length,
      date: completed,
      t,
      score: total / scores.length
    });
  }
  return series;
}

const ANNOTATION_LABELS = {
  growth_phase: { label: 'Growth phase', color: '#16a34a' },
  decline_window: { label: 'Decline window', color: '#dc2626' },
  recovery_curve: { label: 'Recovery curve', color: '#2563eb' }
};

function passesTrendTest(series, positive) {
  const reg = linearRegression(series.map(p => ({ x: p.t, y: p.score })));
  if (!reg) return false;
  const changePerMonth = reg.slope * 30;
  if (positive) {
    return changePerMonth > 0.4 && reg.r2 >= 0.5;
  }
  return changePerMonth < 0 && Math.abs(changePerMonth) > 0.4 && reg.r2 >= 0.5;
}

// Walks the overallSeries and emits one annotation per maximal run of
// consecutive assessments whose linear-regression slope matches the
// requested sign and magnitude. After extending, `end` is always the
// last index whose window still passes the trend test; the traverser
// then advances past it so annotations never overlap.
function detectTrendRuns(series, type, { positive }) {
  if (series.length < 3) return [];
  const meta = ANNOTATION_LABELS[type];
  const results = [];
  let i = 0;
  while (i + 2 < series.length) {
    if (!passesTrendTest(series.slice(i, i + 3), positive)) { i++; continue; }
    let end = i + 2;
    while (end + 1 < series.length && passesTrendTest(series.slice(i, end + 2), positive)) {
      end++;
    }
    if (end - i + 1 < 3) { i++; continue; }
    results.push(buildAnnotation(type, meta, series[i], series[end]));
    i = end + 1;
  }
  return results;
}

// Walks the series for local troughs (an assessment lower than every
// neighbor within +/- 2 indices) where a positive-slope segment of
// >=3 consecutive assessments follows. Emits the span from the trough
// itself to the last rising assessment before the next plateau or dip.
function detectRecoveryCurves(series) {
  if (series.length < 3) return [];
  const meta = ANNOTATION_LABELS.recovery_curve;
  const results = [];
  for (let i = 0; i < series.length; i++) {
    if (!isLocalTrough(series, i)) continue;
    // Trough + 2 more points is the minimum rising window we care about.
    if (i + 2 >= series.length) continue;
    if (!passesTrendTest(series.slice(i, i + 3), true)) continue;
    let end = i + 2;
    while (end + 1 < series.length && passesTrendTest(series.slice(i, end + 2), true)) {
      end++;
    }
    results.push(buildAnnotation('recovery_curve', meta, series[i], series[end]));
  }
  return results;
}

function isLocalTrough(series, i) {
  // Local trough: an assessment strictly lower than every neighbor
  // within +/- 2 indices, AND it must have at least one neighbor on each
  // side (otherwise a monotonically-rising series would call its
  // first/last point a "trough").
  if (i - 1 < 0 || i + 1 >= series.length) return false;
  const score = series[i].score;
  for (let d = 1; d <= 2; d++) {
    const left = i - d;
    if (left >= 0 && series[left].score <= score) return false;
    const right = i + d;
    if (right < series.length && series[right].score <= score) return false;
  }
  return true;
}

function buildAnnotation(type, meta, startPoint, endPoint) {
  return {
    type,
    label: meta.label,
    color: meta.color,
    start: startPoint.date.toISOString(),
    end: endPoint.date.toISOString(),
    start_assessment_id: startPoint.assessment_id,
    end_assessment_id: endPoint.assessment_id,
    start_index: startPoint.index,
    end_index: endPoint.index,
    start_t: startPoint.t,
    end_t: endPoint.t,
    points: endPoint.index - startPoint.index + 1
  };
}

// True when a single assessment separates two same-type spans — the band
// then renders as one continuous pill rather than two touching tiles.
function gapOfOne(prev, next) {
  return (next.start_index - prev.end_index) === 2;
}

module.exports = router;