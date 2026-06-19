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

  var BUILD_VERSION = "v7";

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
        { key: "Single",         val: single,                          ctrl: false },
        { key: "Open to dating", val: open,                            ctrl: false },
        { key: "Age accepted",   val: age,                             ctrl: false },
        { key: "Height",         val: sh.height,                       ctrl: false },
        { key: "Grooming & look", val: Math.min(sh.look, 1),           ctrl: true },
        { key: "Background",     val: Math.min(sh.race, 1),            ctrl: false },
        { key: "Venue + timing", val: sh.location,                     ctrl: true },
        { key: "Delivery",       val: clamp(sh.delivery, 0, 1.6) / 1.6, ctrl: true }
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
    if (s.confidence < 5) add("Sharpen your delivery — opener, calibration, relaxed exit", { confidence: 5 });
    if (s.grooming < 5) add("Level up grooming & style — haircut, fit clothes, skincare", { grooming: 5 });
    if (s.build < 5) add("Get in better shape", { build: 5 });
    var bt = bestTiming(s.venue);
    if (bt.t !== s.timeOfDay || bt.d !== s.dayType)
      add("Go at peak time — " + D.DAYS[bt.d].label.toLowerCase() + " " + D.TIMES[bt.t].label.toLowerCase(), { timeOfDay: bt.t, dayType: bt.d });
    var curRec = clamp(D.VENUES[s.venue].receptivity * D.timingMult(s.venue, s.timeOfDay, s.dayType), 0, 0.9);
    if (curRec < 0.35) add("Approach somewhere more social — a lounge or bar", { venue: "lounge_social" });
    var wider = { targetMin: clamp(Math.min(s.targetMin, s.targetMax) - 4, 18, 70),
                  targetMax: clamp(Math.max(s.targetMin, s.targetMax) + 4, 18, 70) };
    add("Widen the ages you'd approach (more candidates)", wider);
    if (s.facialHair === "clean") add("Try light stubble", { facialHair: "stubble" });
    if (s.hair === "balding") add("Own it — a clean shaved head beats a comb-over", { hair: "shaved" });

    cands.sort(function (a, b) { return b.delta - a.delta; });
    return cands.slice(0, 3);
  }

  // -------------------- rendering --------------------
  var GAUGE_CIRC = 2 * Math.PI * 52;
  var lastResult = null;
  var prevP = null;
  var deltaTimer = null;

  // Semantic colors (kept in sync with the gauge/curve palette).
  var C_BAD = "#fb7185", C_MID = "#fbbf24", C_GOOD = "#34d399";
  function tierColor(p) { return p < 0.05 ? C_BAD : p < 0.15 ? C_MID : C_GOOD; }

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
    el.style.color = up ? C_GOOD : C_BAD;
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
    document.getElementById("gaugeCaption").textContent = caption(r);
    showDelta(r.p);
    renderChart(state);

    if (SHARE) SHARE.updateUrl(state);
    if (step === TOTAL_STEPS - 1) renderResults(r);
  }

  function caption(r) {
    var n = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "lots of";
    return "~" + n + " approaches per number · " + Math.round(r.sessionP * 100) +
      "% to get ≥1 this outing";
  }

  function renderResults(r) {
    var venueLabel = D.VENUES[state.venue].label.toLowerCase();
    var suitable = Math.max(1, Math.round(r.suitable));
    document.getElementById("oddsExplain").innerHTML =
      "If you walk up to one woman in your age range, there's about <b>" + fmtPct(r.p) +
      "%</b> she gives you her number. Over a typical " + venueLabel + " visit (~" + suitable +
      " women your age), about <b>" + Math.round(r.sessionP * 100) +
      "%</b> chance you leave with at least one.";

    // Attraction score
    var aEl = document.getElementById("attraction");
    var sc = r.attraction;
    var tier = sc >= 75 ? "Strong" : sc >= 55 ? "Solid" : sc >= 35 ? "Average" : "Room to grow";
    aEl.innerHTML =
      '<div class="attr-score">' + sc + '<small>/99</small></div>' +
      '<div class="attr-meta"><b>Base attraction: ' + tier + '</b>' +
      '<span>From height + grooming, fitness & hair — the physical basics. ' +
      'Grooming and fitness are the fastest to move.</span></div>';

    // Helping / hurting bars
    var bd = document.getElementById("breakdown");
    bd.innerHTML = "";
    r.factors.forEach(function (f) {
      var pct = Math.round(f.val * 100);
      var row = document.createElement("div");
      row.className = "bar-row" + (f.ctrl ? " ctrl" : "");
      row.innerHTML =
        '<span class="bar-label">' + f.key + (f.ctrl ? ' <i>you control</i>' : '') + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-val">' + pct + "%</span>";
      bd.appendChild(row);
    });

    // Action suggestions
    var acts = suggestImprovements(state);
    var ae = document.getElementById("actions");
    if (acts.length === 0) {
      ae.innerHTML = '<p class="no-actions">You\'ve maxed the levers you control here. Now it\'s reps — log your outcomes below.</p>';
    } else {
      ae.innerHTML = acts.map(function (a) {
        return '<div class="action"><span class="action-label">' + a.label + '</span>' +
          '<span class="action-gain">→ ' + Math.round(a.session * 100) + '% <em>+' +
          Math.round(a.delta * 100) + 'pts</em></span></div>';
      }).join("");
    }

    var perNumber = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "—";
    document.getElementById("reality").innerHTML =
      '<div class="stat"><b>' + Math.round(r.sessionP * 100) + "%</b><span>chance of ≥1 number this outing</span></div>" +
      '<div class="stat"><b>' + Math.round(r.suitable) + "</b><span>women in your range here</span></div>" +
      '<div class="stat"><b>' + perNumber + "</b><span>approaches per number</span></div>";

    renderCalib(r);
  }

  function renderCalib(r) {
    var st = STORE.stats();
    var el = document.getElementById("calib");
    if (st.n === 0) {
      el.textContent = "No logs yet — uses the base model.";
      return;
    }
    var dir = r.personal >= 1 ? "+" + Math.round((r.personal - 1) * 100) + "%"
                              : "-" + Math.round((1 - r.personal) * 100) + "%";
    el.textContent = "Calibrated to " + st.n + " approach" + (st.n === 1 ? "" : "es") +
      " (" + st.successes + " number" + (st.successes === 1 ? "" : "s") + "): your odds " + dir + ".";
  }

  function showStep(i) {
    step = clamp(i, 0, TOTAL_STEPS - 1);
    var steps = document.querySelectorAll(".step");
    for (var k = 0; k < steps.length; k++) steps[k].hidden = (k !== step);
    document.getElementById("progressBar").style.width = ((step + 1) / TOTAL_STEPS * 100) + "%";
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
        status.textContent = "📍 " + loc.name + " — fetching local data…";
        return C.localSingleFactor(loc.stateFips, loc.countyFips, D.NATIONAL_FEMALE_SINGLE_SHARE)
          .then(function (res) {
            localSingleFactor = res.factor;
            var pct = Math.round(res.share * 100);
            status.textContent = "📍 " + loc.name + " — " + pct +
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
            status.textContent = "📍 " + loc.name + " — using national averages.";
          });
      })
      .catch(function () {
        status.textContent = "Couldn't get your location — using national averages.";
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
