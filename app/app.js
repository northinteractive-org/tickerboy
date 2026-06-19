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

  var state = {
    manAge: 30,
    heightIn: 70,
    race: "Prefer not to say",
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

  var TOTAL_STEPS = 8;
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

  function compute(s) {
    var lo = Math.min(s.targetMin, s.targetMax);
    var hi = Math.max(s.targetMin, s.targetMax);

    var sumW = 0, single = 0, open = 0, age = 0;
    for (var a = lo; a <= hi; a++) {
      var w = D.interp(D.FEMALE_AGE_WEIGHT, a);
      sumW += w;
      single += w * D.interp(D.SINGLE_BY_AGE, a);
      open += w * D.interp(D.OPEN_BY_AGE, a);
      age += w * D.pAgeMatch(s.manAge, a);
    }
    if (sumW === 0) sumW = 1;
    single = clamp((single / sumW) * localSingleFactor, 0, 0.98);
    open /= sumW; age /= sumW;

    var height = D.pHeight(s.heightIn);
    var venue = D.VENUES[s.venue];
    var location = clamp(venue.receptivity * D.timingMult(s.venue, s.timeOfDay, s.dayType), 0, 0.9);
    var delivery = D.CONFIDENCE[s.confidence].mult;

    var pBase = clamp(single * open * age * height * location * delivery, 0.005, 0.95);
    var personal = STORE.factor();
    var p = clamp(pBase * personal, 0.003, 0.97);

    var share = ageRangeShare(lo, hi);
    var suitable = venue.footfall * share;

    return {
      p: p,
      personal: personal,
      factors: [
        { key: "Single",         val: single },
        { key: "Open to dating", val: open },
        { key: "Age accepted",   val: age },
        { key: "Height",         val: height },
        { key: "Venue + timing", val: location },
        { key: "Delivery",       val: clamp(delivery, 0, 1.6) / 1.6 }
      ],
      suitable: suitable,
      perOuting: suitable * p,
      perNumber: p > 0 ? 1 / p : Infinity
    };
  }

  // -------------------- rendering --------------------
  var GAUGE_CIRC = 2 * Math.PI * 52;
  var lastResult = null;

  function render() {
    var r = compute(state);
    lastResult = r;
    var pct = Math.round(r.p * 100);

    var fill = document.getElementById("gaugeFill");
    fill.style.strokeDasharray = GAUGE_CIRC;
    fill.style.strokeDashoffset = GAUGE_CIRC * (1 - r.p);
    fill.style.stroke = r.p < 0.05 ? "#ef4444" : r.p < 0.15 ? "#f59e0b" : "#34d399";
    document.getElementById("gaugePct").textContent = pct + "%";
    document.getElementById("gaugeCaption").textContent = caption(r);

    if (SHARE) SHARE.updateUrl(state);
    if (step === 7) renderResults(r);
  }

  function caption(r) {
    var n = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "lots of";
    return "About " + n + " approaches per number.";
  }

  function renderResults(r) {
    var bd = document.getElementById("breakdown");
    bd.innerHTML = "";
    r.factors.forEach(function (f) {
      var pct = Math.round(f.val * 100);
      var row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML =
        '<span class="bar-label">' + f.key + "</span>" +
        '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="bar-val">' + pct + "%</span>";
      bd.appendChild(row);
    });

    var perNumber = isFinite(r.perNumber) ? Math.max(1, Math.round(r.perNumber)) : "—";
    var perOuting = r.perOuting >= 1
      ? "~" + r.perOuting.toFixed(1)
      : (r.perOuting > 0 ? "<1" : "—");
    document.getElementById("reality").innerHTML =
      '<div class="stat"><b>' + perNumber + "</b><span>approaches per number</span></div>" +
      '<div class="stat"><b>' + Math.round(r.suitable) + "</b><span>women in your range here</span></div>" +
      '<div class="stat"><b>' + perOuting + "</b><span>numbers per outing</span></div>";

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

    bindRange("manAge", "ageOut", function (v) { state.manAge = v; return v; });
    bindRange("heightIn", "heightOut", function (v) { state.heightIn = v; return ft(v); });
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

    showStep(0);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  });
})();
