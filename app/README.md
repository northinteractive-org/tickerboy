# Cold Approach Odds

A mobile-first, zero-dependency web app that estimates the probability of a
single cold approach succeeding (getting a number), updating live as you set
parameters.

## Run it
Open `index.html` in any browser — no build step, no server required. It works
on a phone and can be dropped on any static host (S3, GitHub Pages, etc.).

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
