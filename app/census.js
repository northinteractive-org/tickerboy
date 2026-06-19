/*
 * census.js — optional local-demographics refinement.
 *
 * Flow: browser geolocation -> FCC reverse geocode (keyless) -> county FIPS.
 * If the user has saved a free Census API key, we pull local female
 * marital-status data and turn it into a multiplier on the national
 * "single" curve. Everything degrades gracefully to national averages.
 *
 * Free key: https://api.census.gov/data/key_signup.html
 */
(function (global) {
  "use strict";

  var KEY_STORE = "tb_census_key";
  var ACS_YEAR = "2022";
  // Shipped default (free, read-only, rate-limited to 500/day). A user can
  // override it with their own via setKey(); rotate at api.census.gov if abused.
  var DEFAULT_KEY = "6203719971b7eff69b1d4c086dd0afe41b5dd0dd";

  function getKey() { try { return localStorage.getItem(KEY_STORE) || DEFAULT_KEY; } catch (e) { return DEFAULT_KEY; } }
  function setKey(k) { try { localStorage.setItem(KEY_STORE, (k || "").trim()); } catch (e) {} }

  function geolocate() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        function (err) { reject(err); },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });
  }

  function reverseGeocode(lat, lon) {
    var url = "https://geo.fcc.gov/api/census/area?lat=" + lat + "&lon=" + lon + "&format=json";
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var res = (j.results && j.results[0]) || null;
      if (!res) throw new Error("No county for location");
      return {
        name: res.county_name + ", " + res.state_code,
        stateFips: res.state_fips,
        countyFips: res.county_fips.slice(2) // county_fips is state+county; drop state prefix
      };
    });
  }

  // ---- Caching ---------------------------------------------------------
  // Two layers: per-device localStorage (instant repeat) and a shared
  // Supabase cache (one Census lookup per county serves everyone).
  var CACHE_STORE = "tb_census_cache";
  var CACHE_TTL = 30 * 24 * 3600 * 1000; // 30 days

  function localCache() { try { return JSON.parse(localStorage.getItem(CACHE_STORE)) || {}; } catch (e) { return {}; } }
  function saveLocalCache(c) { try { localStorage.setItem(CACHE_STORE, JSON.stringify(c)); } catch (e) {} }
  function factorOut(share, baseline, source) {
    return { factor: Math.max(0.6, Math.min(1.5, share / baseline)), share: share, source: source };
  }

  // Returns { factor, share, source } where factor multiplies the single curve.
  function localSingleFactor(stateFips, countyFips, baseline, name) {
    var fips = String(stateFips) + String(countyFips);

    // 1. Per-device cache
    var lc = localCache();
    if (lc[fips] && (Date.now() - lc[fips].t) < CACHE_TTL) {
      return Promise.resolve(factorOut(lc[fips].share, baseline, "device-cache"));
    }

    // 2. Shared Supabase cache
    var supa = (typeof window !== "undefined") ? window.TB_SUPA : null;
    var sharedRead = (supa && supa.getCensusCache)
      ? supa.getCensusCache(fips).then(function (res) {
          return (res && res.data && res.data.single_share != null) ? Number(res.data.single_share) : null;
        }).catch(function () { return null; })
      : Promise.resolve(null);

    return sharedRead.then(function (cachedShare) {
      if (cachedShare != null) {
        lc[fips] = { share: cachedShare, t: Date.now() }; saveLocalCache(lc);
        return factorOut(cachedShare, baseline, "shared-cache");
      }

      // 3. Live Census lookup, then write through both caches
      var key = getKey();
      if (!key) return Promise.reject(new Error("no-key"));
      // B12001 female: _011 total, _012 never married, _018 widowed, _019 divorced
      var vars = "B12001_011E,B12001_012E,B12001_018E,B12001_019E";
      var url = "https://api.census.gov/data/" + ACS_YEAR + "/acs/acs5?get=" + vars +
        "&for=county:" + countyFips + "&in=state:" + stateFips + "&key=" + encodeURIComponent(key);
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error("Census HTTP " + r.status);
        return r.json();
      }).then(function (rows) {
        var v = rows[1];
        var total = +v[0], never = +v[1], widowed = +v[2], divorced = +v[3];
        if (!total) throw new Error("Empty Census data");
        var share = (never + widowed + divorced) / total;
        lc[fips] = { share: share, t: Date.now() }; saveLocalCache(lc);
        if (supa && supa.setCensusCache) { try { supa.setCensusCache(fips, name, share); } catch (e) {} }
        return factorOut(share, baseline, "census");
      });
    });
  }

  global.TB_CENSUS = {
    getKey: getKey,
    setKey: setKey,
    geolocate: geolocate,
    reverseGeocode: reverseGeocode,
    localSingleFactor: localSingleFactor
  };
})(typeof window !== "undefined" ? window : this);
