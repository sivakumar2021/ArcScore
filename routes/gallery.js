// routes/gallery.js — owns public gallery aggregate data endpoint.
// Does NOT own individual assessment data (routes/assessments.js) or sharing (routes/share.js).
const express = require('express');
const { getDimensionAverages, getGrowthPhases, getTriggerEventCounts } = require('../db/gallery');

const router = express.Router();

// GET /api/gallery — aggregate ArcScore data for public gallery page.
// Returns anonymized averages only — no individual scores or user data.
router.get('/', async (req, res) => {
  try {
    const [dims, phases, triggers] = await Promise.all([
      getDimensionAverages(),
      getGrowthPhases(),
      getTriggerEventCounts()
    ]);

    const totalAssessments = dims.rows.reduce((sum, d) => sum + d.assessment_count, 0);

    res.json({
      summary: { total_assessments: totalAssessments },
      dimension_averages: dims.rows.map(d => ({
        key: d.key,
        name: d.name,
        icon: d.icon,
        avg_score: parseFloat(d.avg_score),
        assessment_count: d.assessment_count
      })),
      growth_phases: phases.rows.map(p => ({
        phase: p.phase,
        user_count: p.user_count,
        avg_assessments: parseFloat(p.avg_assessments)
      })),
      trigger_events: triggers.rows.map(t => ({
        event_type: t.event_type,
        count: t.event_count,
        dimensions: t.dimension_labels || [],
        years: t.years || []
      }))
    });
  } catch (err) {
    console.error('Gallery API error:', err.message || err);
    res.status(500).json({ error: 'Failed to load gallery data' });
  }
});

module.exports = router;