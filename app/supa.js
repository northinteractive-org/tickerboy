/*
 * supa.js — Supabase client + thin data API (ES module).
 *
 * The publishable key is safe to ship: every table has Row Level Security,
 * so a signed-in user can only ever read or write their own rows.
 * Loaded as a module; it announces itself on `document` via the "tb:supa"
 * event and exposes window.TB_SUPA for the (classic-script) app.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var URL = "https://tikohahprlqsdfvcakgr.supabase.co";
var KEY = "sb_publishable_QLLbyJTwjOMKkJCXUBdHmA_-w0uh15n";

var client = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

var listeners = [];
client.auth.onAuthStateChange(function (_event, session) {
  var user = (session && session.user) || null;
  listeners.forEach(function (cb) { try { cb(user); } catch (e) {} });
});

window.TB_SUPA = {
  client: client,

  // Register a callback that fires now-ish (INITIAL_SESSION) and on changes.
  onAuth: function (cb) { listeners.push(cb); },

  signIn: function (email) {
    return client.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: location.origin + location.pathname }
    });
  },
  signOut: function () { return client.auth.signOut(); },

  saveAttempt: function (a) { return client.from("attempts").insert(a); },

  attemptStats: function () {
    return client.from("attempts").select("predicted,success").then(function (res) {
      if (res.error || !res.data) return null;
      var n = res.data.length, k = 0, sp = 0;
      res.data.forEach(function (r) { k += r.success ? 1 : 0; sp += Number(r.predicted) || 0; });
      return { n: n, successes: k, sumPred: sp };
    });
  },

  submitContribution: function (c) { return client.from("contributions").insert(c); },

  // Shared Census cache (public read; writes go through the cache_census rpc).
  getCensusCache: function (fips) {
    return client.from("census_cache").select("single_share").eq("county_fips", fips).maybeSingle();
  },
  setCensusCache: function (fips, name, share) {
    return client.rpc("cache_census", { p_fips: fips, p_name: name || null, p_share: share });
  },

  savePreferences: function (p) {
    return client.auth.getUser().then(function (r) {
      var u = r.data && r.data.user;
      if (!u) return { error: { message: "Not signed in" } };
      return client.from("preferences").insert(p).then(function (res) {
        // Mark the profile as a woman respondent (best-effort, non-blocking).
        client.from("profiles").update({ gender: "woman", updated_at: new Date().toISOString() }).eq("id", u.id);
        return res;
      });
    });
  }
};

document.dispatchEvent(new Event("tb:supa"));
