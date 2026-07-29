// db/assessment-insights.js — owns personalized dimension recommendation data.
// Computes score-range recommendations from a static content map. No external API.
// Does NOT own insight trend detection (routes/insights.js handles that).

const pool = require('./index');

// Score-range thresholds
// low: 0-3, medium: 4-6, high: 7-9, excellent: 10
function getRange(score) {
  if (score <= 3) return 'low';
  if (score <= 6) return 'medium';
  if (score <= 9) return 'high';
  return 'excellent';
}

// Static content map: dimension key → range → { headline, actions[] }
const RECOMMENDATION_CONTENT = {
  fitness: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Start with a 10-minute daily walk — consistency beats intensity early on',
        'Track your sleep: aim for 7–8 hours to support physical recovery',
        'Drink water first thing in the morning; hydration is the lowest-effort win'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Add 2 strength training sessions per week to complement cardio',
        'Batch your meals on Sundays to support consistent nutrition',
        'Schedule workouts like meetings — put them in your calendar'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Introduce periodization: vary intensity each week to prevent plateaus',
        'Explore a new modality (swimming, yoga, rock climbing) to keep engagement high',
        'Log your metrics monthly to stay accountable as you raise the ceiling'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'You\'ve built a model others can learn from — consider coaching or sharing your system',
        'Add recovery protocols (stretching, mobility, sleep optimization) to sustain peak output',
        'Set a new performance goal to stay challenged at this level'
      ]
    }
  },

  financial: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'List all income and expenses this week — awareness is the first step',
        'Open a dedicated savings account and automate a small fixed transfer on payday',
        'Pick one subscription to cancel; redirect that money to an emergency fund'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Build your emergency fund to 3 months of expenses before investing',
        'Review your biggest spending category and set a monthly cap',
        'Learn one investment vehicle (index funds, employer match) that fits your timeline'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Maximize tax-advantaged accounts (401k, IRA, HSA) before taxable investing',
        'Automate savings increases by 1% each year to stay ahead of lifestyle inflation',
        'Review your insurance coverage to make sure your assets are protected'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'Focus on compounding: time and consistency matter more than optimization at this level',
        'Consider estate planning or charitable giving to align wealth with long-term values',
        'Share your framework — teaching financial skills reinforces your own habits'
      ]
    }
  },

  relationships: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Text one person you\'ve been meaning to reconnect with today',
        'Schedule a weekly check-in call or meal with someone close to you',
        'Practice active listening: in your next conversation, ask one follow-up question'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Express appreciation to two people this week — specificity matters more than frequency',
        'Identify one relationship that deserves more intentional time and plan something',
        'Try a shared experience instead of a catch-up call — activities create memories'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Deepen one key relationship through a honest, vulnerable conversation',
        'Audit your circle: make sure your closest relationships are reciprocal and energizing',
        'Set a recurring date (monthly dinner, yearly trip) with someone who matters'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'Relationships this strong are rare — invest in maintaining them through life transitions',
        'Use your relational skills to help others build their networks',
        'Explore whether you can mentor or support someone who struggles with connection'
      ]
    }
  },

  career: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Write down your top 3 career frustrations — clarity on problems is the start of solving them',
        'Have one honest conversation with your manager about growth opportunities',
        'Identify one skill gap and find a free resource (course, book, podcast) to start closing it'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Build a visible win: take on a project slightly outside your current scope',
        'Network internally — meet one person in a different team this month',
        'Document your accomplishments quarterly for easier performance reviews and job searches'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Seek out a stretch assignment or leadership opportunity to accelerate to the next level',
        'Find a mentor in a role 2 steps ahead of where you want to be',
        'Build your professional reputation externally: write, speak, or contribute publicly'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'At this level, your biggest lever is leverage — identify who you can develop and elevate',
        'Make sure your career capital is portable: skills and relationships that travel with you',
        'Consider whether your current trajectory still excites you; recalibrate if needed'
      ]
    }
  },

  mental_health: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Speak with a therapist or counselor — this is the highest-leverage investment you can make right now',
        'Start a 5-minute daily journaling habit to process thoughts before they compound',
        'Reduce one major stressor this week, even temporarily, to create breathing room'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Build a consistent sleep schedule — mental resilience starts with rest',
        'Add a 10-minute mindfulness or breathing practice to your morning',
        'Identify your top stress trigger and design one strategy to reduce its frequency'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Deepen your stress management toolkit: try a new approach (meditation, cold exposure, therapy)',
        'Audit your environment — reduce decision fatigue through routines and clear boundaries',
        'Make sure you have a trusted person to process difficult emotions with'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'Your mental resilience is an asset — protect it by maintaining your core practices',
        'Help someone in your life build better mental habits by sharing what works for you',
        'Explore deeper growth: therapy, introspective retreats, or advanced mindfulness can unlock new levels'
      ]
    }
  },

  learning: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Commit to 15 minutes of learning per day — podcasts, books, or courses all count',
        'Pick one skill directly related to your career and start one free course this week',
        'Replace 30 minutes of passive content consumption with something that teaches you something new'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Set a quarterly learning goal with a concrete output: a project, a blog post, or a skill demonstration',
        'Read one book per month in a domain outside your comfort zone',
        'Join a community (Discord, Slack group, local meetup) organized around a skill you\'re building'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Shift from consuming to creating: teach what you know through writing, speaking, or mentoring',
        'Apply deliberate practice: identify your weakest sub-skill and focus on it specifically',
        'Connect learning to outcomes: map new knowledge to a concrete goal you\'re working toward'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'You\'re a generative learner — use it to build things others can benefit from',
        'Explore meta-learning: study how you learn best and optimize your process',
        'Tackle a domain that genuinely challenges you to maintain the growth edge'
      ]
    }
  },

  social: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Make one small, low-stakes social move today: reply to someone\'s post, say hi to a neighbor',
        'Join one structured social environment (class, club, volunteer group) to remove the awkwardness of starting',
        'Identify whether isolation is situational or feels more entrenched — the answer shapes next steps'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Attend one social event per month outside your regular circle',
        'Be the initiator: invite someone to something instead of waiting to be invited',
        'Deepen surface-level connections by asking more meaningful questions'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Curate intentionally: make sure the social time you do have goes to people who energize you',
        'Host something: a dinner, a game night, a shared experience you design',
        'Build weak ties deliberately — diverse connections create unexpected opportunities'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'Your social capital is an asset — use it to connect others and create value for your network',
        'Make sure social energy is being directed, not just spent; be selective about what you add',
        'Create spaces or rituals that give others the connection you\'ve already found'
      ]
    }
  },

  habits: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Pick one habit you want to build and make it stupidly easy: 2 minutes max to start',
        'Tie the new habit to something you already do (habit stacking) to reduce friction',
        'Track just one habit for 30 days — measurement alone improves consistency'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Design your environment to make good defaults automatic: remove friction for habits you want, add it for ones you don\'t',
        'Review your morning and evening routines — these are the anchor habits that support everything else',
        'Identify one habit that\'s slipping and diagnose why before trying to fix it'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Your habits are working — focus on compounding: upgrade one small behavior at a time',
        'Add accountability: share your habits with someone or use a tracking system',
        'Look for habits you can remove: not every consistent behavior serves you'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'You have a system that works — document it so you can rebuild quickly after disruptions',
        'Use your habit discipline to install a high-leverage new behavior (e.g., daily writing, weekly review)',
        'Help someone else build one habit — teaching reveals blind spots in your own system'
      ]
    }
  },

  purpose: {
    low: {
      headline: 'This dimension needs attention',
      actions: [
        'Write down what you valued most at age 10 and what you value most now — gaps reveal drift',
        'Spend 20 minutes this week on something that feels meaningful with no external reward',
        'Talk to someone whose life direction you admire about what guides their decisions'
      ]
    },
    medium: {
      headline: 'Room for growth here',
      actions: [
        'Define your one-sentence purpose statement — working on it is as valuable as finishing it',
        'Audit how you spend your time: does it reflect what you say matters to you?',
        'Add more of what gives you energy and eliminate one thing that drains it without return'
      ]
    },
    high: {
      headline: 'Strong foundation',
      actions: [
        'Translate purpose into concrete goals: what does living your values look like in the next 90 days?',
        'Deepen the connection between your daily work and your larger "why"',
        'Find a community or cause where your purpose overlaps with others'
      ]
    },
    excellent: {
      headline: 'Exceptional',
      actions: [
        'You have clarity most people search for — protect it when life gets noisy',
        'Channel your sense of purpose into impact: what can you build, create, or contribute that outlasts you?',
        'Revisit your purpose annually; it should evolve as you do'
      ]
    }
  }
};

/**
 * getAssessmentInsights — compute personalized recommendations for an assessment.
 * Returns insights derived purely from the stored dimension scores.
 * @param {number} assessmentId
 * @param {number} userId  — ownership check
 * @returns {Object|null}  — null if not found
 */
async function getAssessmentInsights(assessmentId, userId) {
  // Ownership + completion check
  const assessmentResult = await pool.query(
    `SELECT a.id, a.completed_at,
            json_agg(json_build_object(
              'dimension_id', s.dimension_id,
              'key', d.key,
              'name', d.name,
              'icon', d.icon,
              'score', s.score
            ) ORDER BY d.sort_order) AS scores
     FROM assessments a
     JOIN assessment_scores s ON s.assessment_id = a.id
     JOIN dimensions d ON d.id = s.dimension_id
     WHERE a.id = $1 AND a.user_id = $2 AND a.completed_at IS NOT NULL
     GROUP BY a.id`,
    [assessmentId, userId]
  );

  if (assessmentResult.rows.length === 0) return null;

  const { scores, completed_at } = assessmentResult.rows[0];

  // Sort by score ascending to find focus areas and strengths
  const sorted = [...scores].sort((a, b) => a.score - b.score);
  const focusAreaKeys = new Set(sorted.slice(0, 2).map(s => s.key));
  const strengthKeys = new Set(sorted.slice(-2).map(s => s.key));
  const lowestDimension = sorted[0];

  // Build per-dimension recommendations
  const dimensionInsights = scores.map(s => {
    const range = getRange(s.score);
    const content = RECOMMENDATION_CONTENT[s.key]?.[range];

    return {
      dimension_key: s.key,
      dimension_name: s.name,
      dimension_icon: s.icon,
      score: s.score,
      range,
      headline: content?.headline || 'Keep going',
      actions: content?.actions || [],
      is_focus_area: focusAreaKeys.has(s.key),
      is_strength: strengthKeys.has(s.key)
    };
  });

  // Days until retake is possible (7-day cooldown)
  const completedAt = new Date(completed_at);
  const daysSince = (Date.now() - completedAt.getTime()) / (1000 * 60 * 60 * 24);
  const daysUntilRetake = Math.max(0, Math.ceil(7 - daysSince));

  return {
    assessment_id: assessmentId,
    lowest_dimension: lowestDimension ? { key: lowestDimension.key, name: lowestDimension.name, score: lowestDimension.score } : null,
    days_until_retake: daysUntilRetake,
    dimension_insights: dimensionInsights
  };
}

module.exports = { getAssessmentInsights };
