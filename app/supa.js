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
  // Every device gets a persistent anonymous identity so attempts and
  // preferences are saved (and de-duplicated) without forcing an email.
  // Signing out drops back to a fresh anonymous identity, never to "no row".
  if (!user) { client.auth.signInAnonymously(); return; }
  listeners.forEach(function (cb) { try { cb(user); } catch (e) {} });
});
// Kick off the anonymous bootstrap if there's no session yet on load.
client.auth.getSession().then(function (r) {
  if (!(r.data && r.data.session)) client.auth.signInAnonymously();
});

window.TB_SUPA = {
  client: client,

  // Register a callback that fires now-ish (INITIAL_SESSION) and on changes.
  onAuth: function (cb) { listeners.push(cb); },

  signIn: function (email) {
    var redirect = location.origin + location.pathname;
    // If we're on an anonymous identity, link the email to the SAME user so
    // their on-device data carries over instead of orphaning under a new id.
    return client.auth.getUser().then(function (r) {
      var u = r.data && r.data.user;
      if (u && u.is_anonymous) {
        return client.auth.updateUser({ email: email }, { emailRedirectTo: redirect });
      }
      return client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirect } });
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

  // Rate-limited + de-duplicated server-side (see submit_contribution rpc).
  submitContribution: function (c) {
    return client.rpc("submit_contribution", {
      p_kind: c.kind || "green_flag",
      p_body: c.body,
      p_venue: c.venue || null,
      p_rating: (c.rating != null ? c.rating : null)
    });
  },

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
      if (!u) return { error: { message: "No identity yet — try again in a moment." } };
      // Upsert on user_id: one evolving record per identity, so re-submitting
      // updates the same row instead of piling up duplicates.
      p.user_id = u.id;
      return client.from("preferences").upsert(p, { onConflict: "user_id" }).then(function (res) {
        // Best-effort, non-blocking: mark the profile as a woman respondent.
        client.from("profiles").upsert(
          { id: u.id, gender: "woman", updated_at: new Date().toISOString() },
          { onConflict: "id" }
        );
        return res;
      });
    });
  }
};

document.dispatchEvent(new Event("tb:supa"));
