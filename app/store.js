/*
 * store.js — personal Bayesian self-calibration.
 *
 * Each logged approach records the model's predicted probability and the
 * real outcome. We then fit a single correction multiplier so future
 * estimates match your observed hit rate, using a Gamma(a, a) prior centered
 * at 1.0 so sparse data stays close to the base model and only shifts as
 * evidence accumulates:
 *
 *     factor = (successes + a) / (sum_of_predicted + a)
 */
(function (global) {
  "use strict";

  var STORE = "tb_log";
  var PRIOR = 3; // pseudo-count: higher = more conservative

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch (e) { return []; }
  }
  function save(arr) {
    try { localStorage.setItem(STORE, JSON.stringify(arr)); } catch (e) {}
  }

  function log(predicted, success) {
    var arr = load();
    arr.push({ t: Date.now(), p: +predicted, s: success ? 1 : 0 });
    save(arr);
    return stats();
  }

  function stats() {
    var arr = load();
    var n = arr.length, k = 0, sumPred = 0;
    for (var i = 0; i < n; i++) { k += arr[i].s; sumPred += arr[i].p; }
    var factor = (k + PRIOR) / (sumPred + PRIOR);
    factor = Math.max(0.3, Math.min(3, factor));
    return { n: n, successes: k, sumPred: sumPred, factor: factor };
  }

  function factor() { return stats().factor; }

  function reset() { save([]); }

  global.TB_STORE = { log: log, stats: stats, factor: factor, reset: reset };
})(typeof window !== "undefined" ? window : this);
