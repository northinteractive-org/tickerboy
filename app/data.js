/*
 * data.js — tunable data tables and the source notes behind them.
 *
 * Everything here is an APPROXIMATION assembled from publicly available
 * research. The numbers are deliberately easy to read and edit. Treat the
 * output as entertainment + a directional estimate, not destiny.
 *
 * Sources (directional, not exact):
 *  - U.S. Census Bureau / ACS: marital status by age and sex.
 *  - Pew Research Center (2022/2023): roughly half of single adults are not
 *    currently looking for a relationship or dates.
 *  - OkCupid aggregate data ("Dataclysm", C. Rudder): age-preference curves.
 *  - Published surveys on women's height preferences (preference for taller
 *    partners, plateauing well before 6'5").
 *  - Venue receptivity figures are estimates, not measured rates.
 */

(function (global) {
  "use strict";

  // ---- Linear interpolation over an [x, y] knot table -------------------
  function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    var last = table[table.length - 1];
    if (x >= last[0]) return last[1];
    for (var i = 0; i < table.length - 1; i++) {
      var a = table[i], b = table[i + 1];
      if (x >= a[0] && x <= b[0]) {
        var t = (x - a[0]) / (b[0] - a[0]);
        return a[1] + t * (b[1] - a[1]);
      }
    }
    return last[1];
  }

  // ---- P(woman not married & not cohabiting) by age ---------------------
  // Derived from ACS marital-status curves, discounted for cohabitation.
  var SINGLE_BY_AGE = [
    [18, 0.90], [22, 0.80], [25, 0.62], [28, 0.48], [30, 0.40],
    [35, 0.30], [40, 0.27], [45, 0.28], [50, 0.30], [55, 0.34],
    [60, 0.39], [65, 0.45]
  ];

  // ---- P(actively open to dating | single) by age ----------------------
  // Pew: ~half of singles aren't looking; younger skew slightly higher.
  var OPEN_BY_AGE = [
    [18, 0.58], [25, 0.55], [30, 0.50], [35, 0.45], [40, 0.42],
    [45, 0.40], [50, 0.38], [55, 0.35], [60, 0.33], [65, 0.30]
  ];

  // ---- U.S. adult female population weight by age ----------------------
  // Used to (a) weight a representative target across an age range and
  // (b) estimate what share of women at a venue fall in that range.
  var FEMALE_AGE_WEIGHT = [
    [18, 1.00], [25, 1.05], [30, 1.05], [35, 1.00], [40, 0.95],
    [45, 0.92], [50, 0.95], [55, 0.98], [60, 0.95], [65, 0.85],
    [70, 0.70], [80, 0.45], [90, 0.15]
  ];

  // ---- Venue presets ---------------------------------------------------
  // receptivity: P(a suitable woman is open to a respectful cold approach here)
  // footfall:   rough count of women you could realistically cross paths with
  //             in one outing (before age filtering).
  var VENUES = {
    all_average:    { label: "All / average (not sure)", receptivity: 0.25, footfall: 20, cat: "any" },
    bar_nightclub:  { label: "Bar / nightclub",        receptivity: 0.45, footfall: 25, cat: "nightlife" },
    lounge_social:  { label: "Lounge / social event",  receptivity: 0.50, footfall: 20, cat: "social" },
    festival:       { label: "Festival / concert",     receptivity: 0.40, footfall: 60, cat: "social" },
    college_campus: { label: "College campus",         receptivity: 0.35, footfall: 50, cat: "campus" },
    coffee_shop:    { label: "Coffee shop",            receptivity: 0.30, footfall: 8,  cat: "daytime" },
    bookstore:      { label: "Bookstore / library",    receptivity: 0.26, footfall: 6,  cat: "daytime" },
    dog_park:       { label: "Dog park",               receptivity: 0.30, footfall: 5,  cat: "outdoor" },
    beach:          { label: "Beach / pool",           receptivity: 0.28, footfall: 30, cat: "outdoor" },
    park:           { label: "Park",                   receptivity: 0.24, footfall: 12, cat: "outdoor" },
    street_day:     { label: "Street (daytime)",       receptivity: 0.18, footfall: 40, cat: "errand" },
    grocery:        { label: "Grocery / shops",        receptivity: 0.16, footfall: 15, cat: "errand" },
    gym:            { label: "Gym",                     receptivity: 0.12, footfall: 6,  cat: "fitness" },
    transit:        { label: "Public transit",         receptivity: 0.10, footfall: 20, cat: "transit" },
    airport:        { label: "Airport",                receptivity: 0.22, footfall: 30, cat: "travel" },
    airplane:       { label: "Airplane",               receptivity: 0.30, footfall: 3,  cat: "travel" }
  };

  // ---- Time-of-day & day-of-week receptivity multipliers ---------------
  // How welcome a respectful approach is shifts with timing. Multipliers
  // are relative to the venue's baseline receptivity (1.0 = neutral).
  var TIMES = {
    morning:   { label: "Morning" },
    afternoon: { label: "Afternoon" },
    evening:   { label: "Evening" },
    late:      { label: "Late night" }
  };
  var DAYS = { weekday: { label: "Weekday" }, weekend: { label: "Weekend" } };

  // multiplier by venue category × time of day
  var TIMING = {
    nightlife: { morning: 0.3, afternoon: 0.5, evening: 1.15, late: 1.35 },
    social:    { morning: 0.6, afternoon: 0.9, evening: 1.2,  late: 1.1  },
    campus:    { morning: 1.0, afternoon: 1.1, evening: 0.9,  late: 0.6  },
    daytime:   { morning: 1.1, afternoon: 1.0, evening: 0.85, late: 0.5  },
    outdoor:   { morning: 1.0, afternoon: 1.15, evening: 0.9, late: 0.4  },
    errand:    { morning: 0.95, afternoon: 1.05, evening: 0.9, late: 0.5 },
    fitness:   { morning: 1.0, afternoon: 0.95, evening: 1.05, late: 0.6 },
    transit:   { morning: 1.0, afternoon: 1.0, evening: 1.0,  late: 0.7  },
    travel:    { morning: 1.0, afternoon: 1.05, evening: 1.0, late: 0.8  },
    any:       { morning: 1.0, afternoon: 1.0, evening: 1.0,  late: 1.0  }
  };
  // weekend lift/drag by category
  var DAY_BOOST = {
    nightlife: { weekday: 0.75, weekend: 1.15 },
    social:    { weekday: 0.8,  weekend: 1.15 },
    campus:    { weekday: 1.1,  weekend: 0.8  },
    daytime:   { weekday: 0.95, weekend: 1.1  },
    outdoor:   { weekday: 0.9,  weekend: 1.15 },
    errand:    { weekday: 1.0,  weekend: 1.05 },
    fitness:   { weekday: 1.0,  weekend: 0.95 },
    transit:   { weekday: 1.05, weekend: 0.85 },
    travel:    { weekday: 1.0,  weekend: 1.05 },
    any:       { weekday: 1.0,  weekend: 1.0  }
  };

  function timingMult(venueKey, timeKey, dayKey) {
    var cat = (VENUES[venueKey] || {}).cat || "daytime";
    var t = (TIMING[cat] || {})[timeKey];
    var d = (DAY_BOOST[cat] || {})[dayKey];
    if (t == null) t = 1; if (d == null) d = 1;
    return Math.max(0.2, Math.min(1.6, t * d));
  }

  // ---- Execution / delivery multiplier ---------------------------------
  // The lever most under your control: grooming, opener, calibration, exit.
  var CONFIDENCE = {
    1: { label: "Nervous / first attempts", mult: 0.50 },
    2: { label: "Getting comfortable",      mult: 0.80 },
    3: { label: "Solid & relaxed",          mult: 1.00 },
    4: { label: "Smooth, well-calibrated",  mult: 1.30 },
    5: { label: "Charismatic & practiced",  mult: 1.60 }
  };

  // ---- Race (optional, neutral by default) -----------------------------
  // Public data here (dating-app reply rates) is pair-specific, noisy, and
  // easy to misuse, so we keep it visible but NON-weighting (mult = 1.0).
  var RACES = [
    "Prefer not to say", "Asian", "Black", "Hispanic / Latino",
    "Middle Eastern", "Native American", "Pacific Islander",
    "South Asian", "White", "Mixed / other"
  ];

  // Modest, population-level multipliers loosely reflecting aggregate
  // dating-app reply-rate studies (e.g. OkCupid's race/attraction data).
  // Controversial and about populations, NOT any individual. Kept in a
  // tight band so it nudges rather than dominates. "Prefer not to say"
  // is neutral. Easy to flatten to all 1.0 to disable.
  var RACE_FACTORS = {
    "Prefer not to say": 1.00,
    "Asian":             0.94,
    "Black":             0.97,
    "Hispanic / Latino": 1.01,
    "Middle Eastern":    0.98,
    "Native American":   1.00,
    "Pacific Islander":  1.00,
    "South Asian":       0.95,
    "White":             1.03,
    "Mixed / other":     1.02
  };

  // ---- Look / grooming (a rough, mostly-controllable attraction base) --
  // Focused on factors with real, generalizable signal. Grooming, fitness,
  // and facial hair are the levers a man can actually move. Eye/hair COLOR
  // are intentionally omitted — the evidence for them is negligible.
  var GROOM_LABELS = ["", "Unkempt", "Basic", "Average", "Sharp", "Impeccable"];
  var BUILD_LABELS = ["", "Out of shape", "Soft", "Average", "Fit", "Athletic"];
  var GROOM_MULT = [1, 0.82, 0.92, 1.00, 1.12, 1.25];
  var BUILD_MULT = [1, 0.85, 0.93, 1.00, 1.10, 1.20];
  var FACIAL = {
    clean:   { label: "Clean-shaven", mult: 0.98 },
    stubble: { label: "Stubble",      mult: 1.06 },
    beard:   { label: "Full beard",   mult: 1.00 }
  };
  var HAIR = {
    full:    { label: "Full head",            mult: 1.00 },
    thinning:{ label: "Thinning",             mult: 0.96 },
    shaved:  { label: "Shaved / bald (owned)", mult: 1.00 },
    balding: { label: "Balding (unmanaged)",  mult: 0.90 }
  };

  function lookFactor(grooming, build, facial, hair) {
    var g = GROOM_MULT[grooming] || 1;
    var b = BUILD_MULT[build] || 1;
    var f = (FACIAL[facial] || {}).mult || 1;
    var h = (HAIR[hair] || {}).mult || 1;
    return Math.max(0.5, Math.min(1.6, g * b * f * h));
  }

  // A fun 1–99 "base attraction" from the physical/grooming factors.
  function attractionScore(heightFactor, look) {
    return Math.max(1, Math.min(99, Math.round(heightFactor * look * 83)));
  }

  // ---- Openers (mix of warm/situational and bold/direct, by context) --
  var OPENERS = {
    nightlife: [
      { s: "warm", t: "This song is either great or terrible and I can't decide. What's your verdict?" },
      { s: "direct", t: "I saw you from across the room and had to come say hi. I'm ___." }
    ],
    social: [
      { s: "warm", t: "How do you know people here?" },
      { s: "direct", t: "I don't know anyone here yet, and you looked like the best person to fix that. I'm ___." }
    ],
    campus: [
      { s: "warm", t: "This is going to sound like a line, but do you actually know where ___ is? I'm ___, by the way." },
      { s: "direct", t: "I should be studying, but I'd rather meet you. I'm ___." }
    ],
    daytime: [
      { s: "warm", t: "Quick question. What are you drinking? I need a new go-to and I trust a stranger's taste." },
      { s: "direct", t: "I'm making myself be brave today. I saw you and wanted to say hi. I'm ___." }
    ],
    outdoor: [
      { s: "warm", t: "Okay, your dog is cooler than mine. What's their name?" },
      { s: "direct", t: "I'll keep this short so you can get back to your day. I just wanted to meet you. I'm ___." }
    ],
    errand: [
      { s: "warm", t: "Important question. Which of these do I actually buy? You look like you'd know." },
      { s: "direct", t: "This is random, but I saw you and didn't want to walk past without saying hi. I'm ___." }
    ],
    fitness: [
      { s: "warm", t: "Quick one between sets. Are you almost done with this? I'm ___, by the way." },
      { s: "direct", t: "I'll let you get back to it, but I had to introduce myself first. I'm ___." }
    ],
    transit: [
      { s: "warm", t: "I've got about two stops of courage in me, so, hi. I'm ___." },
      { s: "direct", t: "I only have a minute before my stop, so I'll just say it. I wanted to meet you. I'm ___." }
    ],
    travel: [
      { s: "warm", t: "Where are you headed? I'm collecting strangers' travel plans to feel better about mine." },
      { s: "direct", t: "We've got time to kill anyway. I'm ___. Figured I'd say hi properly." }
    ],
    any: [
      { s: "warm", t: "This is a little out of the blue, but I saw you and wanted to introduce myself. I'm ___." },
      { s: "direct", t: "I'll be honest. I think you're cute and I wanted to meet you. I'm ___." }
    ]
  };

  // ---- Coaching: charisma and mindset, not lines and tricks -----------
  var COACHING = [
    { c: "Mindset", t: "Your worth isn't on the line", b: "A stranger can't measure you in three seconds. Most no's are timing, not you. She's busy, distracted, or taken. Take it light and go again." },
    { c: "Mindset", t: "Play the long game", b: "This is a skill, like the gym. Your first approaches will be clumsy. Do them anyway. Reps are the price, and the price is cheap." },
    { c: "Mindset", t: "Want nothing, offer something", b: "Neediness shows instantly. Decide before you walk over that her answer won't change your night. That calm is the attractive part." },
    { c: "Approach", t: "Move in three seconds", b: "See her, decide, go. Waiting only grows the fear. The fastest approach is the easiest one." },
    { c: "Approach", t: "Lead with energy, not a line", b: "Warm smile, open shoulders, easy voice. She remembers how you made her feel, not how clever you were." },
    { c: "Talk", t: "Talk about right now", b: "Comment on what's around you both. The drink, the line, the song, her dog. It's real, it's easy, and it gives her something to grab." },
    { c: "Talk", t: "Ask, then actually listen", b: "Open questions beat statements. Then listen like you mean it. Real attention is rare, and it's magnetic." },
    { c: "Talk", t: "Close before it cools", b: "Two good minutes beat twenty aimless ones. Say it warm. 'I like you. Let's grab a coffee. What's your number?'" }
  ];

  // ---- Model functions -------------------------------------------------

  // P(a suitable woman finds your height acceptable). Logistic in inches,
  // centered ~5'8", rising fast and plateauing near 6'2".
  function pHeight(inches) {
    var p = 0.15 + 0.80 / (1 + Math.exp(-(inches - 68) / 2.2));
    return Math.max(0.10, Math.min(0.95, p));
  }

  // P(a woman of age `herAge` accepts a man of age `manAge`).
  // Gaussian around a preferred gap that grows with her age; large gaps for
  // young women collapse toward zero (the "half + 7" social intuition).
  function pAgeMatch(manAge, herAge) {
    var gap = manAge - herAge;                 // + = he is older
    var preferred = Math.max(0, Math.min(8, 0.12 * (herAge - 21)));
    var width = 5 + 0.18 * herAge;
    var p = Math.exp(-Math.pow(gap - preferred, 2) / (2 * width * width));
    return Math.max(0.02, Math.min(0.98, p));
  }

  global.TB_DATA = {
    interp: interp,
    SINGLE_BY_AGE: SINGLE_BY_AGE,
    OPEN_BY_AGE: OPEN_BY_AGE,
    FEMALE_AGE_WEIGHT: FEMALE_AGE_WEIGHT,
    VENUES: VENUES,
    TIMES: TIMES,
    DAYS: DAYS,
    timingMult: timingMult,
    CONFIDENCE: CONFIDENCE,
    RACES: RACES,
    RACE_FACTORS: RACE_FACTORS,
    GROOM_LABELS: GROOM_LABELS,
    BUILD_LABELS: BUILD_LABELS,
    FACIAL: FACIAL,
    HAIR: HAIR,
    lookFactor: lookFactor,
    attractionScore: attractionScore,
    OPENERS: OPENERS,
    COACHING: COACHING,
    pHeight: pHeight,
    pAgeMatch: pAgeMatch,
    // National baseline: female share (15+) not currently married, used to
    // normalize a locality's Census marital-status data into a multiplier.
    NATIONAL_FEMALE_SINGLE_SHARE: 0.48
  };
})(typeof window !== "undefined" ? window : this);
