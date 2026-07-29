// routes/assessment-insights.js — owns GET /api/assessments/:id/insights.
// Returns personalized dimension recommendations based on score ranges for a single assessment.
// Does NOT own trend/pattern insight generation (routes/insights.js handles that).
const express = require('express');
const pool = require('../db');
const { logEvent } = require('./analytics');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Hardcoded recommendation content per dimension key × score band.
// Band thresholds: low 1–3, medium 4–6, high 7–9, excellent 10.
const DIMENSION_CONTENT = {
  fitness: {
    low: {
      label: 'Needs Attention',
      tagline: 'Your body is the foundation — small moves matter.',
      actions: [
        'Start with a 10-minute walk daily — no gym required.',
        'Track sleep this week: aim for 7+ hours per night.',
        'Add one piece of fruit or vegetable to every meal.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Good base — time to build on it.',
      actions: [
        'Add 2 structured workouts per week (strength or cardio).',
        'Set a consistent bedtime and wake time — sleep drives recovery.',
        'Hydration check: 8 glasses of water daily.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'You\'re moving well — protect the habit.',
      actions: [
        'Add mobility or flexibility work to prevent injury.',
        'Experiment with a new activity to stay engaged.',
        'Schedule recovery days as intentionally as workouts.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Elite fitness habits. Use this to anchor everything else.',
      actions: [
        'Coach or mentor someone — teaching deepens your own practice.',
        'Document your routine to replicate it on hard weeks.',
        'Apply the same discipline from fitness to your next lowest dimension.'
      ]
    }
  },
  financial: {
    low: {
      label: 'Needs Attention',
      tagline: 'Financial clarity is the first step — not the last.',
      actions: [
        'List all income and fixed expenses in one place today.',
        'Set up automatic savings, even $10/week to start.',
        'Identify one subscription or expense to cut this month.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Stable footing — now build intentionality.',
      actions: [
        'Build a 3-month emergency fund as the next milestone.',
        'Learn about one investment vehicle (index funds, ISA, 401k).',
        'Review subscriptions and cancel what you haven\'t used this month.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Solid financial habits — optimize and compound.',
      actions: [
        'Automate investment contributions to remove willpower from the equation.',
        'Review insurance coverage and ensure you\'re not over- or under-insured.',
        'Set a 12-month financial goal with quarterly milestones.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Financial mastery. Leverage it intentionally.',
      actions: [
        'Consider tax optimization strategies with a professional.',
        'Explore giving or impact investing as an extension of your values.',
        'Share your approach — teaching locks in your own discipline.'
      ]
    }
  },
  relationships: {
    low: {
      label: 'Needs Attention',
      tagline: 'Connection is a skill — start small, be consistent.',
      actions: [
        'Reach out to one person this week with no agenda — just to check in.',
        'Schedule one face-to-face or video call with someone you care about.',
        'Practice active listening in your next conversation: no phone, full presence.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Decent connections — deepen what you have.',
      actions: [
        'Schedule regular time with your closest relationships (weekly/biweekly).',
        'Express gratitude directly to someone who\'s had a positive impact on you.',
        'Address one lingering tension or unsaid thing — honesty builds trust.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Rich relationships — maintain and invest.',
      actions: [
        'Create a relationship ritual: monthly check-ins, annual trips, etc.',
        'Be intentional about who you spend time with — energy is finite.',
        'Look for ways to support others\' goals, not just share your own.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Deep, thriving relationships. Rare and worth protecting.',
      actions: [
        'Model what you\'ve built — introduce people who\'d benefit from each other.',
        'Invest in community beyond personal relationships: mentoring, volunteering.',
        'Document what makes your key relationships work — then replicate it.'
      ]
    }
  },
  career: {
    low: {
      label: 'Needs Attention',
      tagline: 'Clarity on direction comes before momentum.',
      actions: [
        'Write down what a fulfilling role would look and feel like.',
        'Update your resume or LinkedIn profile this week.',
        'Have one honest conversation with a mentor or peer about your path.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Moving forward — accelerate with intention.',
      actions: [
        'Identify the one skill gap most limiting your next career step.',
        'Find a course, book, or mentor to address that gap in 30 days.',
        'Set one professional goal for the next 90 days and share it with someone.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Career on track — now think legacy.',
      actions: [
        'Mentor someone junior — it sharpens your own thinking.',
        'Build your external reputation: write, speak, or contribute publicly.',
        'Audit your role: are you growing or just performing?'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Career excellence. Now lead and create for others.',
      actions: [
        'Invest in building the people around you — your ceiling is theirs.',
        'Think about what you want your career to mean in 10 years.',
        'Use your position to open doors for others who are earlier in the journey.'
      ]
    }
  },
  mental_health: {
    low: {
      label: 'Needs Attention',
      tagline: 'This is the most important work. Start gentle.',
      actions: [
        'Talk to someone — a friend, therapist, or helpline. Not optional.',
        'Try 5 minutes of box breathing daily: 4 in, 4 hold, 4 out, 4 hold.',
        'Reduce inputs: limit news and social media to set times each day.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Manageable — build resilience proactively.',
      actions: [
        'Start a 5-minute daily journaling habit to surface what\'s weighing on you.',
        'Establish a wind-down routine: 30 minutes screen-free before bed.',
        'Explore a mindfulness app (Headspace, Calm) for guided practice.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Good mental health habits — now build robustness.',
      actions: [
        'Identify your stress triggers and have a plan ready before they hit.',
        'Check in monthly: am I thriving or just coping?',
        'Invest in therapy or coaching as a growth tool, not just crisis management.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Exceptional mental wellbeing. Protect and share it.',
      actions: [
        'Model psychological safety for people around you — it\'s contagious.',
        'Reduce energy spent on things you can\'t control; invest in what you can.',
        'Use your stability to help others build theirs.'
      ]
    }
  },
  learning: {
    low: {
      label: 'Needs Attention',
      tagline: 'Curiosity is a muscle — flex it daily.',
      actions: [
        'Read or listen to 10 minutes of nonfiction each day this week.',
        'Pick one topic you\'ve always been curious about and explore it for 30 days.',
        'Replace one passive media habit with something that teaches you something new.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Learning happening — make it more deliberate.',
      actions: [
        'Apply what you learn: teaching or using knowledge cements it.',
        'Set a quarterly learning goal: one book, one course, one skill.',
        'Find a community around a topic you want to develop.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Active learner — now go deeper, not just wider.',
      actions: [
        'Identify your most important knowledge gap and go deep on it.',
        'Teach something you\'ve learned recently — writing or conversation.',
        'Connect learning to action: what decision does this change?'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Voracious learner. Now turn knowledge into impact.',
      actions: [
        'Write, record, or teach — share what you know at scale.',
        'Seek out people who think differently; your next growth edge is there.',
        'Challenge your own frameworks periodically — expertise can calcify.'
      ]
    }
  },
  social: {
    low: {
      label: 'Needs Attention',
      tagline: 'Community isn\'t built overnight — one step at a time.',
      actions: [
        'Attend one local or online meetup in a topic you care about this month.',
        'Volunteer for 2 hours — shared purpose builds bonds faster than small talk.',
        'Identify one group or cause where you naturally belong and show up.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Some community — deepen it.',
      actions: [
        'Join a recurring group activity (sports league, book club, class) for accountability.',
        'Introduce two people in your network who should know each other.',
        'Show up consistently — frequency builds trust more than intensity.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Well-connected — now lead and give back.',
      actions: [
        'Take an active role in a community you\'re part of — lead something.',
        'Mentor someone newer or younger in your community.',
        'Audit your social energy: are you giving and receiving in balance?'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Exceptional community presence. Amplify it.',
      actions: [
        'Start or co-lead a community initiative that didn\'t exist before.',
        'Connect your networks — be a bridge between communities.',
        'Document what makes your community strong so others can replicate it.'
      ]
    }
  },
  habits: {
    low: {
      label: 'Needs Attention',
      tagline: 'Systems beat willpower every time. Start tiny.',
      actions: [
        'Pick one habit to install this week — 2 minutes, same time every day.',
        'Stack it onto something you already do (habit stacking).',
        'Remove one bad habit trigger from your environment.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Some routines working — systematize them.',
      actions: [
        'Document your daily and weekly routines; identify the gaps.',
        'Track one habit for 30 days — measurement creates momentum.',
        'Design your environment to make good defaults automatic.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Strong routines — optimize and protect them.',
      actions: [
        'Review your habits quarterly: which ones still serve you?',
        'Add one high-leverage habit that compounds over time.',
        'Build recovery into your routine — rest is a habit too.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Exceptional discipline and routine. Hard to shake.',
      actions: [
        'Share your system — writing it down refines it.',
        'Use your habits as a scaffold for installing new ones rapidly.',
        'Stress-test your routines: can you maintain them during disruption?'
      ]
    }
  },
  purpose: {
    low: {
      label: 'Needs Attention',
      tagline: 'Purpose isn\'t found — it\'s built. Start the inquiry.',
      actions: [
        'Write 3 answers to: "What am I doing when time disappears?"',
        'Recall one time you felt most alive — what was common about those moments?',
        'Spend 30 minutes with a journal exploring what you want your life to mean.'
      ]
    },
    medium: {
      label: 'Room for Growth',
      tagline: 'Direction emerging — sharpen it.',
      actions: [
        'Articulate your purpose in one sentence — it doesn\'t need to be perfect.',
        'Identify one way to align your daily work with something that matters to you.',
        'Read or explore a philosophy, tradition, or framework that resonates.'
      ]
    },
    high: {
      label: 'Strong Foundation',
      tagline: 'Clear sense of purpose — live it more fully.',
      actions: [
        'Audit: does how you spend your time match what you say matters?',
        'Share your purpose with someone close — articulation deepens it.',
        'Find one way to serve others through your purpose this month.'
      ]
    },
    excellent: {
      label: 'Exceptional',
      tagline: 'Deeply purposeful. Lead with it.',
      actions: [
        'Help others find theirs — mentoring around purpose multiplies impact.',
        'Document your purpose clearly so it guides decisions in hard moments.',
        'Expand the expression of your purpose to reach more people.'
      ]
    }
  }
};

function getBand(score) {
  if (score <= 3) return 'low';
  if (score <= 6) return 'medium';
  if (score <= 9) return 'high';
  return 'excellent';
}

// GET /api/assessments/:id/insights — personalized dimension recommendations
router.get('/:id/insights', requireAuth, async (req, res) => {
  const assessmentId = parseInt(req.params.id, 10);
  if (isNaN(assessmentId)) return res.status(400).json({ error: 'Invalid assessment ID' });

  try {
    const assessmentResult = await pool.query(
      `SELECT a.id, a.completed_at FROM assessments a WHERE a.id = $1 AND a.user_id = $2 AND a.completed_at IS NOT NULL`,
      [assessmentId, req.session.userId]
    );
    if (assessmentResult.rows.length === 0) return res.status(404).json({ error: 'Assessment not found' });

    const scoresResult = await pool.query(
      `SELECT s.score, d.key, d.name, d.icon FROM assessment_scores s
       JOIN dimensions d ON d.id = s.dimension_id WHERE s.assessment_id = $1 ORDER BY d.sort_order`,
      [assessmentId]
    );
    const scores = scoresResult.rows;

    if (scores.length === 0) return res.status(404).json({ error: 'No scores found for this assessment' });

    // Build per-dimension recommendations
    const recommendations = scores.map(s => {
      const band = getBand(s.score);
      const content = DIMENSION_CONTENT[s.key]?.[band] || {
        label: 'Keep Going',
        tagline: 'Keep tracking to unlock deeper insights.',
        actions: ['Continue assessing regularly to track your progress.']
      };
      return {
        dimension_key: s.key,
        dimension_name: s.name,
        dimension_icon: s.icon,
        score: s.score,
        band,
        label: content.label,
        tagline: content.tagline,
        actions: content.actions
      };
    });

    // Sort by score ascending to highlight weakest areas first
    const sorted = [...recommendations].sort((a, b) => a.score - b.score);
    const focusAreas = sorted.slice(0, 2).map(r => r.dimension_key);
    const strengths = [...recommendations].sort((a, b) => b.score - a.score).slice(0, 2).map(r => r.dimension_key);
    const biggestGrowthOpp = sorted[0];

    // Next retake date: 7 days after completion
    const completedAt = new Date(assessmentResult.rows[0].completed_at);
    const retakeEligibleAt = new Date(completedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const daysUntilRetake = Math.max(0, Math.ceil((retakeEligibleAt - now) / (1000 * 60 * 60 * 24)));

    logEvent(req.session.userId, 'insights_viewed', { assessment_id: assessmentId }).catch(() => {});

    res.json({
      recommendations,
      focus_areas: focusAreas,
      strengths,
      biggest_growth_opportunity: biggestGrowthOpp ? biggestGrowthOpp.dimension_key : null,
      days_until_retake: daysUntilRetake
    });
  } catch (err) {
    console.error('Assessment insights error:', err);
    res.status(500).json({ error: 'Failed to load insights' });
  }
});

module.exports = router;
