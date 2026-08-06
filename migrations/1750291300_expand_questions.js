module.exports = {
  name: '1750291300_expand_questions',
  up: async (client) => {
    // 7 new questions per dimension × 9 dimensions = 63 rows.
    // Existing questions (sort_order 1-3) are preserved; new ones get sort_order 4-10.
    // dimension_id mapping: 1=Physical, 2=Financial, 3=Relationships, 4=Career,
    // 5=Mental(Health in task), 6=Learning(Personal Growth in task), 8=Social,
    // 9=Purpose, 11=Habits. (No dimension_id=7 in the DB.)

    const questions = [
      // Physical (dimension_id = 1) — 3 existing + 7 new = 10 total
      [1, 'How consistently do you incorporate movement into your daily routine?', 4],
      [1, 'How would you rate your sleep quality over the past month?', 5],
      [1, 'How well does your current diet align with what your body actually needs?', 6],
      [1, 'How often do you exercise at an intensity that challenges your body?', 7],
      [1, 'How large is the gap between your current physical state and where you want it to be?', 8],
      [1, 'How much does your physical state affect your energy and mood throughout the day?', 9],
      [1, 'How open are you to adopting new physical health practices if they were proven to work?', 10],

      // Financial (dimension_id = 2) — 3 existing + 7 new = 10 total
      [2, 'How often do you think about your financial situation in a given week?', 4],
      [2, 'How well does your current income support the life you want to live?', 5],
      [2, 'How would you rate your financial planning habits — budgeting, tracking, forecasting?', 6],
      [2, 'How much financial stress do you carry in your day-to-day life?', 7],
      [2, 'How satisfied are you with the balance between your financial security and your quality of life?', 8],
      [2, 'How effectively are you managing or paying down any debts you have?', 9],
      [2, 'How close are you to having enough saved to handle a significant unexpected expense?', 10],

      // Relationships (dimension_id = 3) — 3 existing + 7 new = 10 total
      [3, 'How often do you feel genuinely heard and understood by the people closest to you?', 4],
      [3, 'How frequently do conflicts or unresolved tensions come up in your key relationships?', 5],
      [3, 'How satisfied are you with the depth and quality of your most important relationships?', 6],
      [3, 'How much emotional energy do you spend managing difficult relationships?', 7],
      [3, 'How invested are you in actively nurturing your most important relationships?', 8],
      [3, 'How lonely do you feel on a typical week?', 9],
      [3, 'How well do your relationships bring out the best version of you?', 10],

      // Career (dimension_id = 4) — 3 existing + 7 new = 10 total
      [4, 'How clearly can you see a path to your next career milestone?', 4],
      [4, 'How much does your current work align with your natural strengths and interests?', 5],
      [4, 'How fairly do you feel you are compensated relative to the value you produce?', 6],
      [4, 'How much do you look forward to going to work on a typical day?', 7],
      [4, 'How much control do you have over how you spend your time at work?', 8],
      [4, 'How supported do you feel by your manager and colleagues?', 9],
      [4, 'How worried are you about job security in your current role?', 10],

      // Mental / Health (dimension_id = 5) — 3 existing + 7 new = 10 total
      // Task dimension "Health" maps to DB dimension "Mental" (id=5)
      [5, 'How consistently do you get the emotional and mental rest your body and mind require?', 4],
      [5, 'How often do physical symptoms — pain, fatigue, illness — interfere with your daily plans?', 5],
      [5, 'How much does your current healthcare and self-care actually address your root health issues?', 6],
      [5, 'How well can you recognize the early signs that your health is deteriorating?', 7],
      [5, 'How supported do you feel by your healthcare providers and your own self-care routines?', 8],
      [5, 'How much are unresolved health concerns weighing on your mind?', 9],
      [5, 'How proactively do you take steps to prevent future health problems?', 10],

      // Learning / Personal Growth (dimension_id = 6) — 3 existing + 7 new = 10 total
      // Task dimension "Personal Growth" maps to DB dimension "Learning" (id=6)
      [6, 'How much time and energy do you invest each month in learning something new?', 4],
      [6, 'How clear are you on what personal growth means for you — not society', 5],
      [6, 'How well do your daily actions align with the growth areas you have identified?', 6],
      [6, 'How much does a sense of stagnation or stagnation anxiety affect you?', 7],
      [6, 'How often do you reflect on your progress and adjust your growth strategy?', 8],
      [6, 'How well are you developing the specific skills and knowledge that matter most to your goals?', 9],
      [6, 'How supported do you feel by your environment — books, people, resources — in your growth journey?', 10],

      // Social (dimension_id = 8) — 3 existing + 7 new = 10 total
      [8, 'How connected do you feel to a community or group of people who share your values?', 4],
      [8, 'How often do social obligations feel like a drain rather than a source of energy?', 5],
      [8, 'How well does your social life reflect the kind of connections you actually want?', 6],
      [8, 'How much does the quality of your social interactions affect your overall mood?', 7],
      [8, 'How comfortable are you being authentic in social settings?', 8],
      [8, 'How often do you reach out to deepen a connection rather than just maintain surface-level contact?', 9],
      [8, 'How satisfied are you with the balance between your social life and the time you spend alone?', 10],

      // Habits (dimension_id = 11) — 3 existing + 7 new = 10 total
      [11, 'How consistent are your daily habits across the areas that matter most to you?', 4],
      [11, 'How much do you rely on willpower vs. your environment to sustain your habits?', 5],
      [11, 'How often do your habits serve your stated goals vs. work against them?', 6],
      [11, 'How satisfied are you with your current morning and evening routines?', 7],
      [11, 'How much accountability do you have for the habits you have committed to building?', 8],
      [11, 'How often do you slip on a habit and have a clear system to get back on track?', 9],
      [11, 'How connected are your habits to each other — does one habit strengthen or weaken another?', 10],
    ];

    for (const row of questions) {
      await client.query(
        'INSERT INTO dimension_questions (dimension_id, question_text, sort_order) VALUES ($1, $2, $3)',
        row
      );
    }
  }
};