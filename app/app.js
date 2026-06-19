/*
 * app.js — model engine + wizard UI for the Cold Approach Odds tool.
 * No build step, no dependencies. Opens straight from the filesystem.
 */
(function () {
  "use strict";

  var D = window.TB_DATA;

  // -------------------- state --------------------
  var state = {
    manAge: 30,
    heightIn: 70,
    race: "Prefer not to say",
    targetMin: 25,
    targetMax: 35,
    venue: "coffee_shop",
    confidence: 3
  };

  var TOTAL_STEPS = 7;
  var step = 0;

  // -------------------- model --------------------
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Share of adult women (18+) whose age falls in [min, max].
  function ageRangeShare(min, max) {
    var num = 0, den = 0;
    for (var a = 18; a <= 90; a++) {
      var w = D.interp(D.FEMALE_AGE_WEIGHT, a);
      den += w;
      if (a >= min && a <= max) num += w;
    }
    return den > 0 ? num / den : 0;
  }

  function compute(s) {
    var lo = Math.min(s.targetMin, s.targetMax);
    var hi = Math.max(s.targetMin, s.targetMax);

    // Weighted average of the "her age" dependent factors across the pool.
    var sumW = 0, single = 0, open = 0, age = 0;
    for (var a = lo; a <= hi; a++) {
      var w = D.interp(D.FEMALE_AGE_WEIGHT, a);
      var pS = D.interp(D.SINGLE_BY_AGE, a);
      var pO = D.interp(D.OPEN_BY_AGE, a);
      var pA = D.pAgeMatch(s.manAge, a);
      sumW += w;
      single += w * pS;
      open += w * pO;
      age += w * pA;
    }
    if (sumW === 0) sumW = 1;
    single /= sumW; open /= sumW; age /= sumW;

    var height = D.pHeight(s.heightIn);
    var venue = D.VENUES[s.venue];
    var location = venue.receptivity;
    var delivery = D.CONFIDENCE[s.confidence].mult;
    var race = 1.0; // neutral by design

    var p = clamp(single * open * age * height * location * delivery * race, 0.005, 0.95);

    // Pool / reality-check metrics.
    var share = ageRangeShare(lo, hi);
    var suitable = venue.footfall * share;
    var perOuting = suitable * p;
    var perNumber = p > 0 ? 1 / p : Infinity;

    return {
      p: p,
      factors: [
        { key: "Single",        val: single },
        { key: "Open to dating", val: open },
        { key: "Age accepted",  val: age },
        { key: "Height",        val: height },
        { key: "Venue",         val: location },
        { key: "Delivery",      val: clamp(delivery, 0, 1.6) / 1.6 }
      ],
      suitable: suitable,
      perOuting: perOuting,
      perNumber: perNumber
    };
  }

  // -------------------- rendering --------------------
  var GAUGE_CIRC = 2 * Math.PI * 52;

  function render() {
    var r = compute(state);
    var pct = Math.round(r.p * 100);

    // Gauge
    var fill = document.getElementById("gaugeFill");
    fill.style.strokeDasharray = GAUGE_CIRC;
    fill.style.strokeDashoffset = GAUGE_CIRC * (1 - r.p);
    fill.style.stroke = r.p < 0.05 ? "#ef4444" : r.p < 0.15 ? "#f59e0b" : "#34d399";
    document.getElementById("gaugePct").textContent = pct + "%";
    document.getElementById("gaugeCaption").textContent = caption(r);

    // Results step
    if (step === 6) renderResults(r);
  }

  function caption(r) {
    var n = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "lots of";
    return "About " + n + " approaches per number.";
  }

  function renderResults(r) {
    var bd = document.getElementById("breakdown");
    bd.innerHTML = "";
    r.factors.forEach(function (f) {
      var row = document.createElement("div");
      row.className = "bar-row";
      var pct = Math.round(f.val * 100);
      row.innerHTML =
        '<span class="bar-label">' + f.key + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-val">' + pct + "%</span>";
      bd.appendChild(row);
    });

    var perNumber = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "—";
    var perOuting = r.perOuting >= 1
      ? "~" + r.perOuting.toFixed(1) + " numbers"
      : (r.perOuting > 0 ? "less than 1 number" : "—");
    document.getElementById("reality").innerHTML =
      '<div class="stat"><b>' + perNumber + "</b><span>approaches per number</span></div>" +
      '<div class="stat"><b>' + Math.round(r.suitable) + "</b><span>women in your range here</span></div>" +
      '<div class="stat"><b>' + perOuting + "</b><span>expected per outing</span></div>";
  }

  function showStep(i) {
    step = clamp(i, 0, TOTAL_STEPS - 1);
    var steps = document.querySelectorAll(".step");
    for (var k = 0; k < steps.length; k++) steps[k].hidden = (k !== step);
    document.getElementById("progressBar").style.width =
      ((step + 1) / TOTAL_STEPS * 100) + "%";
    document.getElementById("backBtn").disabled = (step === 0);
    var next = document.getElementById("nextBtn");
    next.textContent = (step === TOTAL_STEPS - 1) ? "Start over" : "Next";
    render();
  }

  // -------------------- inputs --------------------
  function ft(inches) {
    var f = Math.floor(inches / 12), i = inches % 12;
    return f + "'" + i + '" (' + Math.round(inches * 2.54) + " cm)";
  }

  function wire() {
    // Populate selects
    var race = document.getElementById("race");
    D.RACES.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r; o.textContent = r; race.appendChild(o);
    });
    race.value = state.race;
    race.addEventListener("change", function () { state.race = race.value; render(); });

    var venue = document.getElementById("venue");
    Object.keys(D.VENUES).forEach(function (key) {
      var o = document.createElement("option");
      o.value = key; o.textContent = D.VENUES[key].label; venue.appendChild(o);
    });
    venue.value = state.venue;
    venue.addEventListener("change", function () { state.venue = venue.value; render(); });

    // Confidence segmented control
    var conf = document.getElementById("confidence");
    Object.keys(D.CONFIDENCE).forEach(function (lvl) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = lvl;
      b.className = "seg" + (Number(lvl) === state.confidence ? " active" : "");
      b.addEventListener("click", function () {
        state.confidence = Number(lvl);
        conf.querySelectorAll(".seg").forEach(function (x) { x.classList.remove("active"); });
        b.classList.add("active");
        document.getElementById("confLabel").textContent = D.CONFIDENCE[lvl].label;
        render();
      });
      conf.appendChild(b);
    });
    document.getElementById("confLabel").textContent = D.CONFIDENCE[state.confidence].label;

    // Sliders
    bindRange("manAge", "ageOut", function (v) { state.manAge = v; return v; });
    bindRange("heightIn", "heightOut", function (v) { state.heightIn = v; return ft(v); });
    bindRange("targetMin", "minOut", function (v) {
      state.targetMin = v;
      if (state.targetMin > state.targetMax) syncMax(v);
      return v;
    });
    bindRange("targetMax", "maxOut", function (v) {
      state.targetMax = v;
      if (state.targetMax < state.targetMin) syncMin(v);
      return v;
    });

    document.getElementById("nextBtn").addEventListener("click", function () {
      if (step === TOTAL_STEPS - 1) { showStep(0); } else { showStep(step + 1); }
    });
    document.getElementById("backBtn").addEventListener("click", function () {
      showStep(step - 1);
    });
  }

  function syncMax(v) {
    state.targetMax = v;
    var el = document.getElementById("targetMax");
    el.value = v; document.getElementById("maxOut").textContent = v;
  }
  function syncMin(v) {
    state.targetMin = v;
    var el = document.getElementById("targetMin");
    el.value = v; document.getElementById("minOut").textContent = v;
  }

  function bindRange(id, outId, fn) {
    var el = document.getElementById(id);
    var out = document.getElementById(outId);
    el.addEventListener("input", function () {
      out.textContent = fn(Number(el.value));
      render();
    });
  }

  // -------------------- boot --------------------
  document.addEventListener("DOMContentLoaded", function () {
    wire();
    showStep(0);
  });
})();
