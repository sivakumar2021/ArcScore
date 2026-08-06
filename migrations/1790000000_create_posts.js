'use strict';

// Migration 1790000000_create_posts — adds the posts table backing the public
// /blog index and /blog/:slug post pages. Seeds one SEO-targeted long-form
// guide that ties the eight life-event categories (migrations/002_life_events.js)
// to the three annotation patterns the /timeline detector surfaces
// (routes/scores.js ANNOTATION_LABELS).
module.exports = {
  name: '1790000000_create_posts',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        slug VARCHAR(200) NOT NULL UNIQUE,
        title VARCHAR(300) NOT NULL,
        excerpt TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}',
        author_name VARCHAR(120) DEFAULT 'ArcScore',
        cover_image_url TEXT,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS posts_published_at_idx ON posts (published_at DESC) WHERE is_published`);
    await client.query(`CREATE INDEX IF NOT EXISTS posts_slug_idx ON posts (slug)`);

    const bodyHtml = [
      '<p>Every ArcScore assessment gives you a snapshot of nine life dimensions. Real life, however, is not a series of snapshots — it is a moving arc, and the moves track the events you log. Whether your score is climbing, sliding, or recovering, there is almost always a tagged event in the story.</p>',
      '<p>This guide walks through the eight event categories ArcScore accepts when you log a life event, and shows how each one tends to map onto the three arc patterns the <code>/timeline</code> page auto-detects: a <strong>growth_phase</strong>, a <strong>decline_window</strong>, or a <strong>recovery_curve</strong>. Read it once and the labelled bands on your timeline will start to feel less abstract.</p>',

      '<h2>The eight life-event categories</h2>',
      '<p>When you log an event on the <a href="/life-events">Life Events</a> page, you pick from a fixed taxonomy of eight categories. They were chosen because they each show up repeatedly in arcs and they correspond to predictable dimension swings. The category you choose is what <code>/timeline</code> uses to place a labelled pin on the chart.</p>',

      '<h3>career_change</h3>',
      '<p>Promotions, new roles, layoffs, sabbaticals, career pivots — anything that materially shifts how you spend 40+ hours a week. <code>career_change</code> events almost always precede a <strong>growth_phase</strong> in the Career dimension. If the change is involuntary, expect the <strong>growth_phase</strong> to lag the pin by two or three assessments; volunteering changes usually show a steeper slope because the recovery energy is already in motion when you log the event.</p>',

      '<h3>relationship</h3>',
      '<p>Engagements, marriages, separations, the addition or loss of a close friend, a move in or out of a difficult dynamic. Relationship events are the most dimensionally diffuse — a single <code>relationship</code> pin often drags Relationships, Social, and Mental scores together. In healthy arcs you will see a short <strong>decline_window</strong> immediately after a difficult relationship event followed by a <strong>recovery_curve</strong>; in stable arcs a positive relationship pin is usually the seed of a multi-quarter <strong>growth_phase</strong>.</p>',

      '<h3>health</h3>',
      '<p>Diagnoses, recoveries, the start of an exercise habit, sleep changes, a chronic condition stabilizing. <code>health</code> pins almost always produce the cleanest delays — a Physical <strong>growth_phase</strong> following the start of a new routine typically takes four to eight weeks to register on an assessment, because the new behaviour has to compound before the score moves. A serious health event instead tends to produce a sharp <strong>decline_window</strong> across Physical, Mental, and Habits at once, with a <strong>recovery_curve</strong> whose slope tells you how well your support network is doing.</p>',

      '<h3>relocation</h3>',
      '<p>Moves — across town or across countries. <code>relocation</code> is the category most likely to look like noise in your arc before it makes sense. Relocations classically produce a short <strong>decline_window</strong> in Social (your surface-level network resets) and a parallel <strong>growth_phase</strong> in Learning (you are encountering a new environment constantly). If your Social <strong>decline_window</strong> extends past three assessments without a <strong>recovery_curve</strong>, that is a real signal — not a measurement artefact.</p>',

      '<h3>financial</h3>',
      '<p>Salary changes, debt payoffs, a windfall, a major purchase, the start of a more aggressive savings plan. <code>financial</code> pins are typically the highest-impact, lowest-frequency events you will log. A financial win tends to seed a Financial <strong>growth_phase</strong> that bleeds into Mental and Purpose (because the cognitive load of money drops). The opposite is unfortunately also true: a sustained Financial <strong>decline_window</strong> that does not bend back is one of the early indicators of a broader arc contraction.</p>',

      '<h3>loss</h3>',
      '<p>The death of someone close, a major personal loss, a miscarriage, a pet, a long-held identity. <code>loss</code> is the category whose influence lasts the longest on the timeline. A single loss pin will often be followed by a Mental and Purpose <strong>decline_window</strong> that runs for two or three assessments, then transitions cleanly into a <strong>recovery_curve</strong>. The recovery slope is the metric we care about — it tells you whether your support system is metabolising the loss or whether it is compounding.</p>',

      '<h3>achievement</h3>',
      '<p>Big completions: finishing a degree, publishing something, hitting a fitness goal, completing a long project. <code>achievement</code> events are interesting because the arc response usually lags the event by several assessments — the in-the-moment score raises, calms down, and then the real <strong>growth_phase</strong> shows up two or three cycles later, when the new identity has settled. Lumping achievements in with <code>other</code> makes this delayed signature invisible, which is why the category exists.</p>',

      '<h3>other</h3>',
      '<p>The honest catch-all. Use it for events that don\'t fit the seven categories above — a worldview shift, a long travel stretch, a creative breakthrough that is not strictly an achievement. The downside of <code>other</code> is that <code>/timeline</code> cannot infer a pattern from it, so it appears only as a labelled pin without connecting automatically to a band. Reserve it for genuine ambiguity.</p>',

      '<h2>The three arc patterns on /timeline</h2>',
      '<p>Every labelled band on your <a href="/timeline">score arc</a> is one of three types. The detector in ArcScore looks for them automatically using a small linear-regression test on consecutive assessments, so the band only appears when there is enough data to be honest about it (at minimum three consecutive points).</p>',

      '<h3>growth_phase</h3>',
      '<p>A <strong>growth_phase</strong> band is drawn when an unbroken run of three or more consecutive assessments shows a positive slope of roughly 0.4 score points per month or steeper, with a regression fit (r²) of at least 0.5. In practice this means your arc is genuinely trending up, not just bobbing. <code>career_change</code>, <code>achievement</code>, and the back half of a <code>health</code> pin are the most common precursors to a <strong>growth_phase</strong>. The steeper the slope, the more often it traces back to a single high-impact event in the months preceding the first assessment in the band.</p>',

      '<h3>decline_window</h3>',
      '<p>A <strong>decline_window</strong> is the mirrored condition: a run of three or more consecutive assessments with a negative slope matching the growth threshold. <code>loss</code>, <code>health</code>, and the front of many <code>relationship</code> transitions are the classic openers. What makes a <strong>decline_window</strong> useful is that it tells you how long the slide has been going — if you see a long decline_window band without a <strong>recovery_curve</strong> following it, that is a signal worth acting on rather than a measurement to wait out.</p>',

      '<h3>recovery_curve</h3>',
      '<p>A <strong>recovery_curve</strong> is the third pattern, and the one most people under-use. It is drawn when an assessment is a local trough — strictly lower than every neighbour within two indices — and the assessments that follow show a positive-slope window of three or more. In other words, a <strong>recovery_curve</strong> always begins at a bottom and always follows a <strong>decline_window</strong> or a major negative event. The one-two punch of decline_window followed by recovery_curve is the canonical <code>loss</code> and <code>health</code> signature on the timeline. If you see a <strong>recovery_curve</strong> without a preceding decline, it is almost always a recovery that started before your earliest logged event — go back and log what you missed.</p>',

      '<h2>Reading your own arc</h2>',
      '<p>Open <a href="/timeline">your timeline</a> with this taxonomy in mind and the labelled bands stop being decoration. The growth_phases tell you what is working; the decline_windows tell you what is costing you; the recovery_curves tell you how elastic you are. Between them, the pinned event categories explain <em>why</em> each band started where it did.</p>',
      '<p>The fastest way to put this into practice is to take a fresh assessment and log anything you have not yet logged since your last one. Even two or three well-tagged events are usually enough to see a labelled pin lighting up a portion of your chart that was previously just data. Once you have done that, the next retake will start producing bands — and the next one after that will start producing <strong>recovery_curves</strong>, which is the most useful thing the detector surfaces.</p>',
      '<p>Whenever you are ready, <a href="/assess">take the assessment</a> and then head to your <a href="/timeline">timeline</a> to see which pattern your arc is currently living in.</p>'
    ].join('\n');

    const excerptText = 'Every life event leaves a fingerprint on your arc. Here is how each ArcScore event category maps onto growth phases, decline windows, and recovery curves.';

    const tagsArr = ['life events', 'score arc', 'growth phase', 'decline window', 'recovery curve'];

    await client.query(
      `INSERT INTO posts (slug, title, excerpt, body, tags, author_name, is_published, published_at)
       VALUES ($1, $2, $3, $4, $5::text[], $6, TRUE, $7)
       ON CONFLICT (slug) DO NOTHING`,
      [
        'life-events-and-score-arcs',
        'How Life Events Shape Your Score Arc — A Field Guide',
        excerptText,
        bodyHtml,
        tagsArr,
        'ArcScore',
        '2026-08-01'
      ]
    );
  },
  down: async (client) => {
    await client.query(`DROP TABLE IF EXISTS posts`);
  }
};
