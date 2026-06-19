/*
 * share.js — shareable result: deep-linkable URL state + a generated card
 * image via Web Share API (with download / copy-link fallbacks).
 */
(function (global) {
  "use strict";

  // Short keys keep shared links compact.
  var MAP = {
    manAge: "a", heightIn: "h", race: "r", targetMin: "lo", targetMax: "hi",
    venue: "v", timeOfDay: "t", dayType: "d", confidence: "c",
    grooming: "g", build: "b", facialHair: "fh", hair: "ha"
  };

  function encodeState(s) {
    var q = [];
    Object.keys(MAP).forEach(function (k) {
      if (s[k] != null && s[k] !== "") q.push(MAP[k] + "=" + encodeURIComponent(s[k]));
    });
    return q.join("&");
  }

  function readUrlState() {
    var out = {}, found = false;
    var inv = {};
    Object.keys(MAP).forEach(function (k) { inv[MAP[k]] = k; });
    var qs = (location.search || "").replace(/^\?/, "").split("&");
    qs.forEach(function (pair) {
      if (!pair) return;
      var bits = pair.split("="), sk = inv[bits[0]];
      if (!sk) return;
      var val = decodeURIComponent(bits[1] || "");
      var numeric = ["manAge", "heightIn", "targetMin", "targetMax", "confidence", "grooming", "build"];
      out[sk] = numeric.indexOf(sk) >= 0 ? Number(val) : val;
      found = true;
    });
    return found ? out : null;
  }

  function updateUrl(s) {
    try {
      var url = location.pathname + "?" + encodeState(s);
      history.replaceState(null, "", url);
    } catch (e) {}
  }

  function shareUrl(s) {
    return location.origin + location.pathname + "?" + encodeState(s);
  }

  // Draw a square result card to a canvas and return a Blob.
  function buildCard(opts) {
    return new Promise(function (resolve) {
      var W = 1080, c = document.createElement("canvas");
      c.width = W; c.height = W;
      var x = c.getContext("2d");

      var g = x.createLinearGradient(0, 0, W, W);
      g.addColorStop(0, "#0a0b0f"); g.addColorStop(1, "#1b1830");
      x.fillStyle = g; x.fillRect(0, 0, W, W);

      var color = opts.p < 0.05 ? "#fb7185" : opts.p < 0.15 ? "#fbbf24" : "#34d399";

      // Ring
      var cx = W / 2, cy = 430, rad = 250;
      x.lineWidth = 46; x.lineCap = "round";
      x.strokeStyle = "rgba(255,255,255,0.12)";
      x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = color;
      x.beginPath();
      x.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.01, opts.p));
      x.stroke();

      x.fillStyle = "#e8edf7"; x.textAlign = "center";
      x.font = "800 150px -apple-system, Segoe UI, Roboto, sans-serif";
      x.fillText(Math.round(opts.p * 100) + "%", cx, cy + 40);
      x.fillStyle = "#93a0bd"; x.font = "600 34px -apple-system, Segoe UI, Roboto, sans-serif";
      x.fillText("CHANCE PER APPROACH", cx, cy + 110);

      x.fillStyle = "#e8edf7"; x.font = "700 46px -apple-system, Segoe UI, Roboto, sans-serif";
      x.fillText(opts.title || "Cold Approach Odds", cx, 790);
      x.fillStyle = "#93a0bd"; x.font = "400 36px -apple-system, Segoe UI, Roboto, sans-serif";
      x.fillText(opts.caption || "", cx, 855);
      x.fillStyle = color; x.font = "700 30px -apple-system, Segoe UI, Roboto, sans-serif";
      x.fillText("Calculate yours →", cx, 980);

      if (c.toBlob) c.toBlob(function (b) { resolve(b); }, "image/png");
      else resolve(null);
    });
  }

  function share(opts) {
    var link = shareUrl(opts.state);
    return buildCard(opts).then(function (blob) {
      var file = blob ? new File([blob], "cold-approach-odds.png", { type: "image/png" }) : null;
      var payload = { title: "Cold Approach Odds", text: opts.caption + " " + link, url: link };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        payload.files = [file];
        return navigator.share(payload).then(function () { return "shared"; });
      }
      if (navigator.share) return navigator.share(payload).then(function () { return "shared"; });
      // Fallbacks: copy link, and download the image.
      if (navigator.clipboard) { try { navigator.clipboard.writeText(link); } catch (e) {} }
      if (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cold-approach-odds.png";
        a.click();
      }
      return "fallback";
    }).catch(function () { return "error"; });
  }

  global.TB_SHARE = {
    encodeState: encodeState,
    readUrlState: readUrlState,
    updateUrl: updateUrl,
    shareUrl: shareUrl,
    share: share
  };
})(typeof window !== "undefined" ? window : this);
