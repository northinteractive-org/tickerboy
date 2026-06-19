/*
 * app.js — model engine + wizard UI for the Cold Approach Odds tool.
 * No build step, no dependencies. Opens straight from the filesystem
 * (local-data + install features need it served over http/https).
 */
(function () {
  "use strict";

  var D = window.TB_DATA;
  var C = window.TB_CENSUS;
  var STORE = window.TB_STORE;
  var SHARE = window.TB_SHARE;

  var BUILD_VERSION = "v12";

  var state = {
    manAge: 30,
    heightIn: 70,
    race: "Prefer not to say",
    grooming: 3,
    build: 3,
    facialHair: "stubble",
    hair: "full",
    targetMin: 25,
    targetMax: 35,
    venue: "coffee_shop",
    timeOfDay: "evening",
    dayType: "weekend",
    confidence: 3
  };

  // Local-demographics refinement (1.0 = national baseline).
  var localSingleFactor = 1.0;
  var localName = "";

  var TOTAL_STEPS = 9;
  var step = 0;

  // -------------------- model --------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(v, a, b) { return clamp((v - a) / (b - a), 0, 1); }

  function ageRangeShare(min, max) {
    var num = 0, den = 0;
    for (var a = 18; a <= 90; a++) {
      var w = D.interp(D.FEMALE_AGE_WEIGHT, a);
      den += w;
      if (a >= min && a <= max) num += w;
    }
    return den > 0 ? num / den : 0;
  }

  // Factors that don't depend on the woman's age (shared by every point).
  // Total adult-female population weight, used to size the venue pool by age.
  var TOTAL_ADULT_W = (function () {
    var s = 0;
    for (var a = 18; a <= 90; a++) s += D.interp(D.FEMALE_AGE_WEIGHT, a);
    return s;
  })();

  function sharedFactors(s) {
    var venue = D.VENUES[s.venue];
    return {
      height: D.pHeight(s.heightIn),
      look: D.lookFactor(s.grooming, s.build, s.facialHair, s.hair),
      race: D.RACE_FACTORS[s.race] || 1,
      location: clamp(venue.receptivity * D.timingMult(s.venue, s.timeOfDay, s.dayType), 0, 0.9),
      delivery: D.CONFIDENCE[s.confidence].mult,
      personal: STORE.factor()
    };
  }

  // Full per-approach probability for a target of exactly `herAge`.
  function probAtAge(s, herAge, sh) {
    var pS = clamp(D.interp(D.SINGLE_BY_AGE, herAge) * localSingleFactor, 0, 0.98);
    var pO = D.interp(D.OPEN_BY_AGE, herAge);
    var pA = D.pAgeMatch(s.manAge, herAge);
    var base = clamp(pS * pO * pA * sh.height * sh.look * sh.race * sh.location * sh.delivery, 0.005, 0.95);
    return clamp(base * sh.personal, 0.003, 0.97);
  }

  // Probability curve across her age — drives the live chart.
  function buildCurve(s, aMin, aMax) {
    var sh = sharedFactors(s), pts = [];
    for (var a = aMin; a <= aMax; a++) pts.push({ age: a, p: probAtAge(s, a, sh) });
    return pts;
  }

  function compute(s) {
    var lo = Math.min(s.targetMin, s.targetMax);
    var hi = Math.max(s.targetMin, s.targetMax);
    var sh = sharedFactors(s);

    var footfall = D.VENUES[s.venue].footfall;
    var sumW = 0, single = 0, open = 0, age = 0, pSum = 0, logSurvive = 0;
    for (var a = lo; a <= hi; a++) {
      var w = D.interp(D.FEMALE_AGE_WEIGHT, a);
      var pa = probAtAge(s, a, sh);
      sumW += w;
      single += w * D.interp(D.SINGLE_BY_AGE, a);
      open += w * D.interp(D.OPEN_BY_AGE, a);
      age += w * D.pAgeMatch(s.manAge, a);
      pSum += w * pa;
      // Expected women of this age at the venue, and their contribution to
      // the chance of NOT getting any number (compounded across the pool).
      var nA = footfall * w / TOTAL_ADULT_W;
      logSurvive += nA * Math.log(1 - Math.min(pa, 0.97));
    }
    if (sumW === 0) sumW = 1;
    single = clamp((single / sumW) * localSingleFactor, 0, 0.98);
    open /= sumW; age /= sumW;

    var p = pSum / sumW;                 // average per-approach quality
    var sessionP = 1 - Math.exp(logSurvive); // chance of >=1 number this outing
    var suitable = footfall * ageRangeShare(lo, hi);

    return {
      p: p,
      sessionP: sessionP,
      personal: sh.personal,
      attraction: D.attractionScore(sh.height, sh.look),
      factors: [
        { key: "single",   bar: single,                       raw: single },
        { key: "open",     bar: open,                         raw: open },
        { key: "age",      bar: age,                          raw: age },
        { key: "height",   bar: norm(sh.height, 0.10, 0.95),  raw: sh.height },
        { key: "look",     bar: norm(sh.look, 0.50, 1.60),    raw: sh.look },
        { key: "race",     bar: norm(sh.race, 0.90, 1.06),    raw: sh.race },
        { key: "venue",    bar: clamp(sh.location / 0.9, 0, 1), raw: sh.location },
        { key: "delivery", bar: norm(sh.delivery, 0.50, 1.60), raw: sh.delivery }
      ],
      suitable: suitable,
      perNumber: p > 0 ? 1 / p : Infinity
    };
  }

  // ---- Action engine: what moves your odds the most ----
  // Each candidate is an improvement to a controllable lever; we measure its
  // effect on the cumulative "≥1 this outing" probability.
  function bestTiming(venue) {
    var best = { t: "evening", d: "weekend", m: 0 };
    ["morning", "afternoon", "evening", "late"].forEach(function (t) {
      ["weekday", "weekend"].forEach(function (d) {
        var m = D.timingMult(venue, t, d);
        if (m > best.m) best = { t: t, d: d, m: m };
      });
    });
    return best;
  }

  function suggestImprovements(s) {
    var baseSession = compute(s).sessionP;
    var cands = [];
    function add(label, mod) {
      var ns = Object.assign({}, s, mod);
      var d = compute(ns).sessionP - baseSession;
      if (d > 0.005) cands.push({ label: label, delta: d, session: compute(ns).sessionP });
    }
    if (s.confidence < 5) add("Sharpen your delivery. Opener, calibration, relaxed exit.", { confidence: 5 });
    if (s.grooming < 5) add("Level up grooming and style. Haircut, clothes that fit, skincare.", { grooming: 5 });
    if (s.build < 5) add("Get in better shape", { build: 5 });
    var bt = bestTiming(s.venue);
    if (bt.t !== s.timeOfDay || bt.d !== s.dayType)
      add("Go at peak time: " + D.DAYS[bt.d].label.toLowerCase() + " " + D.TIMES[bt.t].label.toLowerCase(), { timeOfDay: bt.t, dayType: bt.d });
    var curRec = clamp(D.VENUES[s.venue].receptivity * D.timingMult(s.venue, s.timeOfDay, s.dayType), 0, 0.9);
    if (curRec < 0.35) add("Approach somewhere more social, like a lounge or bar", { venue: "lounge_social" });
    var wider = { targetMin: clamp(Math.min(s.targetMin, s.targetMax) - 4, 18, 70),
                  targetMax: clamp(Math.max(s.targetMin, s.targetMax) + 4, 18, 70) };
    add("Open up to a wider age range for more shots", wider);
    if (s.facialHair === "clean") add("Try light stubble", { facialHair: "stubble" });
    if (s.hair === "balding") add("Own it. A clean shaved head beats a comb-over.", { hair: "shaved" });

    cands.sort(function (a, b) { return b.delta - a.delta; });
    return cands.slice(0, 3);
  }

  // Rank every venue by session odds (each at its own best timing, current you).
  function rankVenues(s) {
    return Object.keys(D.VENUES).map(function (key) {
      var bt = bestTiming(key);
      var ns = Object.assign({}, s, { venue: key, timeOfDay: bt.t, dayType: bt.d });
      return { key: key, label: D.VENUES[key].label, session: compute(ns).sessionP, isCurrent: key === s.venue };
    }).sort(function (a, b) { return b.session - a.session; });
  }

  // The ceiling: fixed traits + range, every controllable maxed, best venue/timing.
  function computeCeiling(s) {
    var maxed = Object.assign({}, s, {
      grooming: 5, build: 5, confidence: 5,
      facialHair: "stubble",
      hair: s.hair === "balding" ? "shaved" : s.hair
    });
    var best = null;
    Object.keys(D.VENUES).forEach(function (key) {
      var bt = bestTiming(key);
      var ns = Object.assign({}, maxed, { venue: key, timeOfDay: bt.t, dayType: bt.d });
      var sp = compute(ns).sessionP;
      if (!best || sp > best.session) best = { session: sp, venue: key, t: bt.t, d: bt.d };
    });
    return best;
  }

  // -------------------- rendering --------------------
  var GAUGE_CIRC = 2 * Math.PI * 52;
  var lastResult = null;
  var prevP = null;
  var deltaTimer = null;

  // Semantic colors read live from CSS vars so they adapt to the theme.
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function tierColor(p) {
    return p < 0.05 ? cssVar("--bad", "#9a8a76")
         : p < 0.15 ? cssVar("--mid", "#e6a13c")
         : cssVar("--good", "#ff5a2d");
  }
  function tierWord(p) {
    return p < 0.05 ? "Long shot" : p < 0.15 ? "In the game" : p < 0.30 ? "Strong" : "On fire";
  }

  // Adaptive precision: more decimals as the odds get small, so slider
  // nudges stay visible even down around a couple of percent.
  function fmtPct(p) {
    var v = p * 100;
    if (v >= 10) return v.toFixed(0);
    if (v >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  function showDelta(p) {
    var el = document.getElementById("gaugeDelta");
    if (prevP == null) { prevP = p; el.style.opacity = 0; return; }
    var dPts = (p - prevP) * 100;
    prevP = p;
    if (Math.abs(dPts) < 0.005) { el.style.opacity = 0; return; }
    var up = dPts > 0;
    el.textContent = (up ? "▲ +" : "▼ ") + dPts.toFixed(2) + " pts";
    el.style.color = up ? cssVar("--good", "#34d399") : cssVar("--bad", "#fb7185");
    el.style.opacity = 1;
    if (deltaTimer) clearTimeout(deltaTimer);
    deltaTimer = setTimeout(function () { el.style.opacity = 0; }, 1400);
  }

  // ---- Live probability curve (odds vs her age) ----
  var CH = { w: 320, h: 120, padL: 6, padR: 6, padT: 12, padB: 16, aMin: 18, aMax: 60 };

  function cx(age) {
    return CH.padL + (age - CH.aMin) / (CH.aMax - CH.aMin) * (CH.w - CH.padL - CH.padR);
  }
  function cy(p, scale) {
    return (CH.h - CH.padB) - (p / scale) * (CH.h - CH.padT - CH.padB);
  }

  function renderChart(s) {
    var svg = document.getElementById("curveSvg");
    if (!svg) return;
    var pts = buildCurve(s, CH.aMin, CH.aMax);

    var maxP = 0, peak = pts[0];
    pts.forEach(function (pt) { if (pt.p > maxP) { maxP = pt.p; peak = pt; } });
    // Mostly-fixed scale so delivery/height/venue visibly grow the hump,
    // expanding only for unusually strong scenarios.
    var scale = Math.max(0.25, maxP * 1.1);

    var line = "", area = "";
    pts.forEach(function (pt, i) {
      var x = cx(pt.age).toFixed(1), y = cy(pt.p, scale).toFixed(1);
      line += (i ? "L" : "M") + x + " " + y + " ";
    });
    var x0 = cx(pts[0].age).toFixed(1), xN = cx(pts[pts.length - 1].age).toFixed(1);
    var baseY = (CH.h - CH.padB).toFixed(1);
    area = line + "L" + xN + " " + baseY + " L" + x0 + " " + baseY + " Z";

    var bx0 = cx(Math.min(s.targetMin, s.targetMax));
    var bx1 = cx(Math.max(s.targetMin, s.targetMax));
    var color = tierColor(lastResult ? lastResult.p : 0.1);

    svg.innerHTML =
      '<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.45"/>' +
        '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      '<rect x="' + bx0.toFixed(1) + '" y="' + CH.padT + '" width="' + (bx1 - bx0).toFixed(1) +
        '" height="' + (CH.h - CH.padT - CH.padB) + '" fill="#ffffff" opacity="0.07"/>' +
      '<path d="' + area + '" fill="url(#cg)"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<circle cx="' + cx(peak.age).toFixed(1) + '" cy="' + cy(peak.p, scale).toFixed(1) +
        '" r="3.5" fill="#fff" stroke="' + color + '" stroke-width="2"/>';

    var peakEl = document.getElementById("chartPeak");
    if (peakEl) peakEl.textContent = "Peak " + fmtPct(peak.p) + "% @ age " + peak.age;
  }

  function render() {
    var r = compute(state);
    lastResult = r;

    var fill = document.getElementById("gaugeFill");
    fill.style.strokeDasharray = GAUGE_CIRC;
    fill.style.strokeDashoffset = GAUGE_CIRC * (1 - r.p);
    fill.style.stroke = tierColor(r.p);
    document.getElementById("gaugePct").textContent = fmtPct(r.p) + "%";
    var tier = document.getElementById("gaugeTier");
    tier.textContent = tierWord(r.p);
    tier.style.color = tierColor(r.p);
    document.getElementById("gaugeCaption").textContent = caption(r);
    showDelta(r.p);
    renderChart(state);

    if (SHARE) SHARE.updateUrl(state);
    if (step === TOTAL_STEPS - 1) renderResults(r);
  }

  function caption(r) {
    var n = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "lots of";
    return "About " + n + " approaches per yes · " + Math.round(r.sessionP * 100) +
      "% to leave with a number this outing";
  }

  function renderResults(r) {
    var venueLabel = D.VENUES[state.venue].label.toLowerCase();
    var suitable = Math.max(1, Math.round(r.suitable));
    document.getElementById("oddsExplain").innerHTML =
      "Walk up to one woman in your range and about <b>" + fmtPct(r.p) +
      "%</b> say yes to giving you their number. Work a whole " + venueLabel + " (around " + suitable +
      " women your age) and your shot at leaving with at least one climbs to about <b>" +
      Math.round(r.sessionP * 100) + "%</b>.";

    // Attraction score
    var aEl = document.getElementById("attraction");
    var sc = r.attraction;
    var tier = sc >= 75 ? "Strong" : sc >= 55 ? "Solid" : sc >= 35 ? "Average" : "Room to grow";
    aEl.innerHTML =
      '<div class="attr-score">' + sc + '<small>/99</small></div>' +
      '<div class="attr-meta"><b>Base attraction: ' + tier + '</b>' +
      '<span>Looks are a small slice of the math. What actually moves your odds, you control. Lean in.</span></div>';

    renderBreakdown(r);

    // Action suggestions
    var acts = suggestImprovements(state);
    var ae = document.getElementById("actions");
    if (acts.length === 0) {
      ae.innerHTML = '<p class="no-actions">You\'ve maxed the levers you control here. Now it\'s reps. Go get them, then log your outcomes below.</p>';
    } else {
      ae.innerHTML = acts.map(function (a) {
        return '<div class="action"><span class="action-label">' + a.label + '</span>' +
          '<span class="action-gain">→ ' + Math.round(a.session * 100) + '% <em>+' +
          Math.round(a.delta * 100) + 'pts</em></span></div>';
      }).join("");
    }

    renderCeiling(r);
    renderVenueRanking();
    renderCoaching(r);
    renderOpeners();

    var perNumber = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "—";
    document.getElementById("reality").innerHTML =
      '<div class="stat"><b>' + Math.round(r.sessionP * 100) + "%</b><span>chance of ≥1 number this outing</span></div>" +
      '<div class="stat"><b>' + Math.round(r.suitable) + "</b><span>women in your range here</span></div>" +
      '<div class="stat"><b>' + perNumber + "</b><span>approaches per number</span></div>";

    renderCalib(r);
  }

  // Plain-language meaning + control status + the move, per factor.
  var FACTOR_META = {
    single: {
      label: "Single", tag: "range", tagText: "Place & range",
      text: function (raw, s, lo, hi) {
        return "About " + Math.round(raw * 100) + "% of women aged " + lo + " to " + hi +
          " aren't married" + (localSingleFactor !== 1 ? " (your local data)" : "") + ".";
      },
      advice: "Big cities and wider or older ranges push this up. Tap Use my location for your real numbers."
    },
    open: {
      label: "Open to dating", tag: "fixed", tagText: "Fixed",
      text: function (raw) { return "About " + Math.round(raw * 100) + "% of single women actually want to date right now."; },
      advice: "That's just the math of the room, not you. Nothing to fix here."
    },
    age: {
      label: "Age fit", tag: "range", tagText: "Your range",
      text: function (raw, s) { return "About " + Math.round(raw * 100) + "% of women in your range are open to a guy your age (" + s.manAge + ")."; },
      advice: "Aim closer to your own age and this climbs. Chase much younger and it collapses."
    },
    height: {
      label: "Height", tag: "fixed", tagText: "Fixed",
      text: function (raw, s) { return "How your height (" + ft(s.heightIn) + ") tends to land, on average."; },
      advice: "You can't change it, and in person it matters far less than a photo would. Win on everything else."
    },
    look: {
      label: "Grooming & look", tag: "control", tagText: "You control",
      text: function (raw) {
        var d = raw < 0.95 ? "below average" : raw <= 1.12 ? "around average" : "above average";
        return "Your grooming, fitness and presentation read as " + d + " right now.";
      },
      advice: "Your biggest fast win. Fresh haircut, clothes that fit, and regular gym time."
    },
    race: {
      label: "Background", tag: "fixed", tagText: "Fixed",
      text: function (raw) {
        if (Math.abs(raw - 1) < 0.005) return "Neutral. No effect applied.";
        return "A tiny population-level nudge (" + (raw > 1 ? "+" : "") + Math.round((raw - 1) * 100) + "%). It says nothing about you.";
      },
      advice: "Tiny and fixed. Don't give it a second thought."
    },
    venue: {
      label: "Venue + timing", tag: "control", tagText: "You control",
      text: function (raw, s) {
        return "How open a " + D.VENUES[s.venue].label.toLowerCase() + " is on a " +
          D.DAYS[s.dayType].label.toLowerCase() + " " + D.TIMES[s.timeOfDay].label.toLowerCase() + ".";
      },
      advice: "Pick a friendlier room at a better hour. See Best places above."
    },
    delivery: {
      label: "Delivery", tag: "control", tagText: "You control",
      text: function (raw, s) { return "Your opener, body language and read on the moment: " + D.CONFIDENCE[s.confidence].label.toLowerCase() + "."; },
      advice: "The lever that matters most, and it's pure skill. Practice it and everything moves."
    }
  };

  function renderBreakdown(r) {
    var lo = Math.min(state.targetMin, state.targetMax);
    var hi = Math.max(state.targetMin, state.targetMax);
    document.getElementById("breakdown").innerHTML = r.factors.map(function (f) {
      var m = FACTOR_META[f.key];
      var strength = f.bar >= 0.6 ? "good" : f.bar >= 0.33 ? "mid" : "bad";
      var w = Math.max(4, Math.round(f.bar * 100));
      return '<div class="frow">' +
        '<div class="frow-top"><span class="fname">' + m.label + '</span>' +
        '<span class="ftag ' + m.tag + '">' + m.tagText + '</span></div>' +
        '<div class="fbar"><span class="ffill ' + strength + '" style="width:' + w + '%"></span></div>' +
        '<div class="fdesc">' + m.text(f.raw, state, lo, hi) + '</div>' +
        (m.tag === "fixed"
          ? '<div class="fnote">' + m.advice + '</div>'
          : '<div class="fdo">' + m.advice + '</div>') +
        '</div>';
    }).join("");
  }

  function renderCeiling(r) {
    var c = computeCeiling(state);
    var venue = D.VENUES[c.venue].label;
    var when = D.DAYS[c.d].label.toLowerCase() + " " + D.TIMES[c.t].label.toLowerCase();
    var now = Math.round(r.sessionP * 100);
    var max = Math.round(c.session * 100);
    document.getElementById("ceiling").innerHTML =
      '<div class="ceil-track">' +
        '<div class="ceil-now"><span>You now</span><b>' + now + '%</b></div>' +
        '<div class="ceil-arrow">→</div>' +
        '<div class="ceil-max"><span>Your ceiling</span><b>' + max + '%</b></div>' +
      '</div>' +
      '<p class="ceil-play"><b>Your play:</b> hit a ' + venue.toLowerCase() + ' on a ' + when +
      ' with your delivery sharp and your grooming and fitness dialed in' +
      (state.hair === "balding" ? ', hair shaved clean' : '') +
      '. Same face, same height, same you. Just better habits and a smarter room.</p>';
  }

  function renderVenueRanking() {
    var ranked = rankVenues(state);
    var top = ranked.slice(0, 7);
    var max = top[0].session || 1;
    document.getElementById("venueRank").innerHTML = top.map(function (v) {
      var pct = Math.round(v.session * 100);
      var w = Math.max(4, (v.session / max) * 100);
      return '<div class="vrow' + (v.isCurrent ? ' current' : '') + '">' +
        '<span class="vlabel">' + v.label + (v.isCurrent ? ' <i>you</i>' : '') + '</span>' +
        '<span class="vbar"><span class="vfill" style="width:' + w + '%"></span></span>' +
        '<span class="vval">' + pct + '%</span></div>';
    }).join("");
  }

  function renderCoaching(r) {
    var p = r.p;
    var n50 = (p > 0 && p < 1) ? Math.max(1, Math.ceil(Math.log(0.5) / Math.log(1 - p))) : "lots of";
    var ethos =
      '<div class="coach ethos"><b>Why not just use the apps?</b>' +
      '<span>Apps shrink you to a photo, and that game is rigged for almost every guy. ' +
      'In person she feels your energy, your humor, your calm. That\'s where a normal man wins. ' +
      'Go where it\'s real.</span></div>';
    var dyn =
      '<div class="coach dyn"><b>It\'s a numbers game you can win</b>' +
      '<span>At about <b>' + fmtPct(p) + '%</b> per approach, roughly <b>' + n50 +
      ' solid tries</b> gets you a coin-flip at your first number. Every no moves you closer. ' +
      'Volume plus skill, not luck.</span></div>';
    var tips = D.COACHING.map(function (c) {
      return '<div class="coach"><span class="coach-cat">' + c.c + '</span><b>' + c.t + '</b><span>' + c.b + '</span></div>';
    }).join("");
    document.getElementById("coaching").innerHTML = ethos + dyn + tips;
  }

  function renderOpeners() {
    var cat = D.VENUES[state.venue].cat || "any";
    var list = D.OPENERS[cat] || D.OPENERS.any;
    var lowReceptivity = (cat === "fitness" || cat === "transit");
    var rows = list.map(function (o) {
      return '<div class="opener"><span class="op-style ' + o.s + '">' +
        (o.s === "warm" ? "Warm" : "Direct") + '</span><span class="op-text">' + o.t + '</span></div>';
    }).join("");
    var note = lowReceptivity
      ? '<p class="op-note">Read the room here. This is a tough spot, so only go if she seems open and not rushing.</p>'
      : '';
    document.getElementById("openers").innerHTML = rows + note;
  }

  // ---- Welcome ----
  function showWelcome() {
    var w = document.getElementById("welcome");
    if (w) { w.hidden = false; w.scrollTop = 0; }
  }
  function dismissWelcome() {
    var w = document.getElementById("welcome");
    if (w) w.hidden = true;
    try { localStorage.setItem("tb_welcomed", "1"); } catch (e) {}
  }
  function initWelcome() {
    var seen;
    try { seen = localStorage.getItem("tb_welcomed"); } catch (e) {}
    var w = document.getElementById("welcome");
    if (w) w.hidden = !!seen;
  }

  // ---- Theme ----
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7fb" : "#0a0b0f");
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "☾" : "☀";
    try { localStorage.setItem("tb_theme", theme); } catch (e) {}
  }
  function initTheme() {
    var saved;
    try { saved = localStorage.getItem("tb_theme"); } catch (e) {}
    if (!saved) {
      saved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
    }
    applyTheme(saved);
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "light" ? "dark" : "light");
    render();
  }

  function renderCalib(r) {
    var st = STORE.stats();
    var el = document.getElementById("calib");
    if (st.n === 0) {
      el.textContent = "Log your real approaches and these numbers start learning you.";
      return;
    }
    var dir = r.personal >= 1 ? "up " + Math.round((r.personal - 1) * 100) + "%"
                              : "down " + Math.round((1 - r.personal) * 100) + "%";
    el.textContent = "Tuned to your " + st.n + " logged approach" + (st.n === 1 ? "" : "es") +
      " (" + st.successes + " number" + (st.successes === 1 ? "" : "s") + "). Your odds adjusted " + dir + ".";
  }

  function showStep(i) {
    step = clamp(i, 0, TOTAL_STEPS - 1);
    var steps = document.querySelectorAll(".step");
    for (var k = 0; k < steps.length; k++) steps[k].hidden = (k !== step);
    document.getElementById("progressBar").style.width = ((step + 1) / TOTAL_STEPS * 100) + "%";
    var sc = document.getElementById("stepCount");
    if (sc) {
      var inputSteps = TOTAL_STEPS - 1;
      sc.textContent = step < inputSteps
        ? ("0" + (step + 1)).slice(-2) + " / " + ("0" + inputSteps).slice(-2)
        : "Your results";
    }
    document.getElementById("backBtn").disabled = (step === 0);
    document.getElementById("nextBtn").textContent = (step === TOTAL_STEPS - 1) ? "Start over" : "Next";
    render();
  }

  // -------------------- helpers --------------------
  function ft(inches) {
    var f = Math.floor(inches / 12), i = inches % 12;
    return f + "'" + i + '" (' + Math.round(inches * 2.54) + " cm)";
  }

  function buildSegmented(containerId, options, current, onSelect, labelOut) {
    var box = document.getElementById(containerId);
    box.innerHTML = "";
    Object.keys(options).forEach(function (key) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = options[key].label || key;
      b.dataset.val = key;
      b.className = "seg" + (key == current ? " active" : "");
      b.addEventListener("click", function () {
        box.querySelectorAll(".seg").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        onSelect(key);
        if (labelOut) labelOut(key);
        render();
      });
      box.appendChild(b);
    });
  }

  function bindRange(id, outId, fn) {
    var el = document.getElementById(id), out = document.getElementById(outId);
    el.addEventListener("input", function () {
      out.textContent = fn(Number(el.value));
      render();
    });
  }

  // -------------------- location --------------------
  function useLocation() {
    var status = document.getElementById("locStatus");
    status.textContent = "Locating…";
    C.geolocate()
      .then(function (pos) { return C.reverseGeocode(pos.lat, pos.lon); })
      .then(function (loc) {
        localName = loc.name;
        status.textContent = "📍 " + loc.name + ". Fetching local data…";
        return C.localSingleFactor(loc.stateFips, loc.countyFips, D.NATIONAL_FEMALE_SINGLE_SHARE)
          .then(function (res) {
            localSingleFactor = res.factor;
            var pct = Math.round(res.share * 100);
            status.textContent = "📍 " + loc.name + ". " + pct +
              "% of women here are single (local data applied).";
            render();
          })
          .catch(function (err) {
            if (err && err.message === "no-key") {
              var key = window.prompt(
                "Detected " + loc.name + ".\nPaste a free Census API key for local data " +
                "(api.census.gov/data/key_signup.html), or cancel to use national averages:");
              if (key) {
                C.setKey(key);
                useLocation();
                return;
              }
            }
            status.textContent = "📍 " + loc.name + ". Using national averages.";
          });
      })
      .catch(function () {
        status.textContent = "Couldn't get your location. Using national averages.";
      });
  }

  // -------------------- wiring --------------------
  function syncUI() {
    document.getElementById("manAge").value = state.manAge;
    document.getElementById("ageOut").textContent = state.manAge;
    document.getElementById("heightIn").value = state.heightIn;
    document.getElementById("heightOut").textContent = ft(state.heightIn);
    document.getElementById("grooming").value = state.grooming;
    document.getElementById("groomOut").textContent = D.GROOM_LABELS[state.grooming];
    document.getElementById("build").value = state.build;
    document.getElementById("buildOut").textContent = D.BUILD_LABELS[state.build];
    document.getElementById("race").value = state.race;
    document.getElementById("targetMin").value = state.targetMin;
    document.getElementById("minOut").textContent = state.targetMin;
    document.getElementById("targetMax").value = state.targetMax;
    document.getElementById("maxOut").textContent = state.targetMax;
    document.getElementById("venue").value = state.venue;
  }

  function wire() {
    var race = document.getElementById("race");
    D.RACES.forEach(function (r) {
      var o = document.createElement("option"); o.value = r; o.textContent = r; race.appendChild(o);
    });
    race.addEventListener("change", function () { state.race = race.value; render(); });

    var venue = document.getElementById("venue");
    Object.keys(D.VENUES).forEach(function (key) {
      var o = document.createElement("option");
      o.value = key; o.textContent = D.VENUES[key].label; venue.appendChild(o);
    });
    venue.addEventListener("change", function () { state.venue = venue.value; render(); });

    buildSegmented("timeOfDay", D.TIMES, state.timeOfDay, function (k) { state.timeOfDay = k; });
    buildSegmented("dayType", D.DAYS, state.dayType, function (k) { state.dayType = k; });
    buildSegmented("confidence", D.CONFIDENCE, state.confidence, function (k) {
      state.confidence = Number(k);
    }, function (k) {
      document.getElementById("confLabel").textContent = D.CONFIDENCE[k].label;
    });
    document.getElementById("confLabel").textContent = D.CONFIDENCE[state.confidence].label;
    buildSegmented("facialHair", D.FACIAL, state.facialHair, function (k) { state.facialHair = k; });
    buildSegmented("hair", D.HAIR, state.hair, function (k) { state.hair = k; });

    bindRange("manAge", "ageOut", function (v) { state.manAge = v; return v; });
    bindRange("heightIn", "heightOut", function (v) { state.heightIn = v; return ft(v); });
    bindRange("grooming", "groomOut", function (v) { state.grooming = v; return D.GROOM_LABELS[v]; });
    bindRange("build", "buildOut", function (v) { state.build = v; return D.BUILD_LABELS[v]; });
    bindRange("targetMin", "minOut", function (v) {
      state.targetMin = v;
      if (state.targetMin > state.targetMax) {
        state.targetMax = v;
        document.getElementById("targetMax").value = v;
        document.getElementById("maxOut").textContent = v;
      }
      return v;
    });
    bindRange("targetMax", "maxOut", function (v) {
      state.targetMax = v;
      if (state.targetMax < state.targetMin) {
        state.targetMin = v;
        document.getElementById("targetMin").value = v;
        document.getElementById("minOut").textContent = v;
      }
      return v;
    });

    document.getElementById("locBtn").addEventListener("click", useLocation);
    document.getElementById("themeToggle").addEventListener("click", toggleTheme);
    document.getElementById("startBtn").addEventListener("click", dismissWelcome);
    var brandEl = document.querySelector(".brand");
    if (brandEl) brandEl.addEventListener("click", showWelcome);

    document.getElementById("shareBtn").addEventListener("click", function () {
      if (!SHARE || !lastResult) return;
      var btn = document.getElementById("shareBtn");
      var label = btn.textContent;
      SHARE.share({
        p: lastResult.p,
        title: "Cold Approach Odds",
        caption: caption(lastResult),
        state: state
      }).then(function (res) {
        btn.textContent = res === "fallback" ? "Link copied + image saved" :
                          res === "error" ? "Couldn't share" : "Shared!";
        setTimeout(function () { btn.textContent = label; }, 2200);
      });
    });

    document.getElementById("logYes").addEventListener("click", function () { logOutcome(true); });
    document.getElementById("logNo").addEventListener("click", function () { logOutcome(false); });

    document.getElementById("nextBtn").addEventListener("click", function () {
      showStep(step === TOTAL_STEPS - 1 ? 0 : step + 1);
    });
    document.getElementById("backBtn").addEventListener("click", function () { showStep(step - 1); });
  }

  function logOutcome(success) {
    // Log against the BASE prediction (pre-calibration) to avoid feedback loops.
    var base = lastResult ? lastResult.p / Math.max(0.001, lastResult.personal) : 0.05;
    STORE.log(base, success);
    render();
  }

  // -------------------- boot --------------------
  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initWelcome();
    if (SHARE) {
      var urlState = SHARE.readUrlState();
      if (urlState) Object.keys(urlState).forEach(function (k) { state[k] = urlState[k]; });
    }
    wire();
    syncUI();
    // Re-mark segmented actives from (possibly URL-loaded) state.
    buildSegmented("timeOfDay", D.TIMES, state.timeOfDay, function (k) { state.timeOfDay = k; });
    buildSegmented("dayType", D.DAYS, state.dayType, function (k) { state.dayType = k; });
    buildSegmented("confidence", D.CONFIDENCE, state.confidence, function (k) {
      state.confidence = Number(k);
    }, function (k) { document.getElementById("confLabel").textContent = D.CONFIDENCE[k].label; });
    document.getElementById("confLabel").textContent = D.CONFIDENCE[state.confidence].label;
    buildSegmented("facialHair", D.FACIAL, state.facialHair, function (k) { state.facialHair = k; });
    buildSegmented("hair", D.HAIR, state.hair, function (k) { state.hair = k; });

    var ver = document.getElementById("buildVer");
    if (ver) ver.textContent = BUILD_VERSION;

    showStep(0);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  });
})();
