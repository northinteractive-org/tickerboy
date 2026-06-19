# Cold Approach — To-Do

Live app: https://northinteractive-org.github.io/tickerboy/
Supabase project: `cold-approach` (ref `tikohahprlqsdfvcakgr`)
Current build: **v14**

---

## 🔴 Do this first (blocks the whole accounts/data layer)

- [ ] **Set the Supabase Auth URL config.** Dashboard → Authentication → URL Configuration:
  - Site URL: `https://northinteractive-org.github.io/tickerboy/`
  - Redirect URLs: add the same URL
  - Until this is set, sign-in fails and **nothing saves** (attempts, female-track preferences). This is the one thing standing between us and a working backend.
- [ ] **Test sign-in on your phone** once the above is set: tap "Sign in", enter your email, click the magic link, confirm you land back signed in.

## 🟠 Before any real launch

- [ ] **Add custom SMTP in Supabase** (Auth → Emails). The default sender is rate-limited to a few emails/hour and often lands in spam. Needed before real users.
- [x] ~~Activate the Census API key~~ — done and verified working (returns live ACS data).
- [ ] **Decide how the Census key is used** (see question below): per-user prompt (current) vs. baked into the app for zero-friction local data.
- [ ] **Decide on a name + custom domain** (optional). Currently "Cold Approach" on a github.io URL.

## 🟡 Decisions I need from you

- [ ] **Monetization direction** — confirm the ladder: free calculator → paid Pro (tracking/plan) → 1:1 sessions with women coaches. Thumbs up to design toward the coach marketplace?
- [ ] **Race factor** — keep the small population-level weights, or flatten to neutral? (It's modest and labeled now.)
- [ ] **Headline metric** — keep per-approach % as the big gauge number, or switch to the "leave with a number this outing" %?

## 🟢 Backlog — say the word and I'll build it

- [ ] **Analysis view / SQL** over `preferences` + `attempts` (watch responses land, see distributions).
- [ ] **Recalibrate the model from real data** once ~a few hundred female responses are in — replace estimated curves in `data.js` with actual receptivity, height, and age-gap distributions.
- [ ] **Profile / account screen** — save your setup, see your logged history and trend over time.
- [ ] **Coach marketplace** — `coaches` + `bookings` tables, a "browse coaches" screen, Stripe Connect for payouts (Stripe tooling is available here).
- [ ] **Waitlist** for coaching to validate demand before building the marketplace.
- [ ] **Intro polish** — count-up animation on the gauge; collapsible result sections.
- [ ] **Shareable result card** refinements / social preview image.

## ✅ Done

- [x] Probability model, live gauge, odds-by-age curve
- [x] Timing model, optional local Census data (geolocation → FCC → ACS)
- [x] Bayesian self-calibration from logged outcomes
- [x] PWA (installable, offline), shareable result card + deep links
- [x] Action-oriented results: ceiling optimizer, venue ranking, coaching, openers
- [x] Confident copy pass + anti-app ethos
- [x] Design system "The Corner" (frontend-design skill) + light/dark
- [x] Welcome screen (copywriting skill)
- [x] Supabase: accounts (magic link), cloud-synced attempts, RLS on everything
- [x] Female track: preferences survey stored for analysis
