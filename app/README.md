# Cold Approach Odds

A mobile-first, zero-dependency web app that estimates the probability of a
single cold approach succeeding (getting a number), updating live as you set
parameters.

## Run it
Open `index.html` in any browser — no build step, no dependencies. It works on a
phone and can be dropped on any static host (S3, GitHub Pages, etc.).

> For the install (PWA), offline, and local-data features, serve it over
> http/https rather than `file://` (e.g. `python3 -m http.server` then open
> `localhost:8000`). The core calculator works from `file://` too.

## Features
- **Live probability gauge** that recalculates on every input.
- **Timing model** — time of day + weekday/weekend shift each venue's receptivity.
- **Local data (optional)** — "Use my location" reverse-geocodes via the FCC API
  (keyless) and, with a free [Census API key](https://api.census.gov/data/key_signup.html),
  refines the "single" factor with real ACS marital-status data for your county.
  Falls back to national averages otherwise.
- **Shareable results** — generates a result-card image (Web Share API, with
  download/copy-link fallback) and a deep-linkable URL that reconstructs the inputs.
- **Bayesian self-calibration** — log real outcomes and a personal correction
  multiplier (Gamma-prior, shrinks toward the base model when data is sparse)
  nudges your future odds toward your observed hit rate. Stored in localStorage.
- **Installable PWA** with offline app-shell caching.

## File map
| File | Purpose |
|------|---------|
| `index.html` / `styles.css` | Mobile-first wizard UI |
| `data.js` | Tunable curves, venue/timing tables, model functions |
| `app.js` | Engine + UI wiring + state |
| `census.js` | Geolocation + FCC/Census local-data refinement |
| `store.js` | localStorage Bayesian calibration |
| `share.js` | URL state + canvas card + Web Share |
| `sw.js` / `manifest.webmanifest` / `icon.svg` | PWA |

## How it works
Per-approach success is modeled as a product of independent factors:

```
P = P(single) × P(open to dating) × P(accepts your age)
  × P(clears height bar) × P(venue receptive) × P(delivery)
```

Each input narrows the estimate and the gauge recalculates continuously. The
results screen breaks down each factor's contribution and adds a reality check
(approaches per number, suitable women at the venue, expected per outing).

## Tuning the model
All numbers live in `data.js` (curves, venue presets, multipliers) with source
notes inline. The engine and UI are in `app.js`; styles in `styles.css`.

## Data sources (directional)
- U.S. Census Bureau / ACS — marital status by age and sex
- Pew Research Center — share of single adults open to dating
- OkCupid aggregate data — age-preference curves
- Published height-preference surveys
- Venue receptivity / footfall figures are estimates

This is entertainment and a nudge toward the factors you control — not a
guarantee. Approach respectfully and read the room.
