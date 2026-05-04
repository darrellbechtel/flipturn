# Flip Turn — Project Brief

**Status:** Pre-build. Strategic context captured; engineering work begins after this brief is reviewed.
**Project name:** Flip Turn (repo: `flipturn`)
**Tagline:** TBD — *not* "Swim Club Platform" (see Branding Notes below)
**Owner:** Darrell Bechtel
**Last updated:** May 2026

---

## One-line summary

A B2C mobile app for Canadian competitive swim parents: pulls swim meet results from public sources, surfaces personal-best progression and time-standard tracking, and adds parent-friendly meet-day features that the existing club software (TeamUnify, PoolQ, SwimTopia) does poorly or not at all.

---

## Strategic context — why this, and why not the alternatives

This project emerged from scoping work for a local Waterloo swim club that was considering replacing PoolQ. Key findings from that exploration:

1. **Backend replacement is a bad wedge.** Replacing the club management system means also replacing meet management (Hy-Tek), Swimming Canada (SNC) registrar integration, billing, registration, and a long tail of operational features. PoolQ does this for ~CA$75/month flat. No room to compete on price; SNC integration alone is a national-governing-body partnership barrier.

2. **The real revenue in club software is payment processing margin.** PoolQ's $75/month is anchor pricing; actual revenue is closer to 2-3x that once Stripe Connect application fees are factored in. Building this revenue stream requires building the entire registration system underneath it.

3. **Parent-facing tools are genuinely underserved.** TeamUnify's OnDeck, PoolQ's parent portal, and Meet Mobile all share the same pattern: functional but ugly, locked in walled gardens, weak on analytics, no progression tracking, no video, no kid-facing engagement layer.

4. **The data is mostly public.** SNC publishes all sanctioned meet results at `results.swimming.ca`. Host clubs publish `.hy3` files on their websites. This means a parent-side app can be built **independent of any club's vendor choice** and doesn't require partnership deals to ship v1.

The wedge: be the app the parent installs because it makes their kid's swim journey legible, regardless of what backend their club happens to use.

---

## Anti-goals (do NOT build)

- **No club-side features.** No registration, no billing, no payment collection, no roster management, no coach tools, no practice planning. These exist in PoolQ/TeamUnify and are not our market.
- **No live timing console integration.** Belongs to Hy-Tek/Colorado Time Systems. Out of scope and unobtainable.
- **No Meet Mobile scraping.** Owned by Comcast/NBC Sports Next. Mobile-only, requires reverse engineering, high legal risk.
- **No bulk Swimcloud scraping.** Their entire business is the data; one-off identity-resolution lookups are fine, systematic crawling is not.
- **No coach-facing UI in v1-v3.** Stay parent + athlete focused.

---

## Target user

Primary: parent of a 8-16 year old competitive swimmer in a Swimming Canada-sanctioned year-round club. Currently using PoolQ, TeamUnify (OnDeck), or SwimTopia for club ops, plus Meet Mobile for live results.

Secondary (later): older athletes themselves (recruiting/college pathway tier).

Geographic priority: Ontario first (Swim Ontario has 130+ clubs; founder-local), then rest of Canada, then US.

---

## Data architecture

### Four-tier latency model for meet result data

| Tier | Source | Latency | Reliability | Effort |
|------|--------|---------|-------------|--------|
| 1 | Live publishing (TouchPadLive, SwimPhone, Swimnerd Live) | seconds | Dirty (DQs reconcile later) | Per-meet config |
| 2 | Session-end Hy-Tek runs on host site | 15min – 2hr | Clean | Medium |
| 3 | End-of-meet results bundle on host site | 4-24hr | Authoritative for that meet | Medium |
| 4 | `results.swimming.ca` canonical archive | 24-72hr | Official, ranked | Easy (single source) |

**v1 ships Tier 3/4 only.** Live (Tier 1) is a v2 feature, gated behind user-pasted meet URLs (not crawler-driven).

### Normalized schema (target)

```
athletes(id, names[], dob, gender, club_history[], external_ids{snc, usas, swimcloud})
meets(id, name, sanction_body, course, location, start, end, source_url)
events(id, meet_id, distance_m, stroke, gender, age_band, round)
swims(id, athlete_id, event_id, time_centiseconds, splits[], place, status,
      data_source, scraped_at, supersedes_id)
personal_bests(athlete_id, event_key, swim_id, achieved_at)
```

`supersedes_id` is critical: same swim arrives from multiple tiers; later sources may correct DQ status, splits, or place. Keep all versions; flag the freshest authoritative one as current; surface revisions to the parent.

### Identity resolution

Hardest sustained engineering challenge in the project. Probabilistic matching on `(normalized_name, dob, club, country)` with a confidence score:

- High confidence (>0.95): auto-merge
- Medium (0.7-0.95): flag for parent confirmation in-app
- Low: discard or stage

Bootstrap by accepting SNC athlete ID directly during onboarding (skip matcher for first users). Don't build the fancy matcher until ~user #50.

---

## Tech stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| API | Hono (or Fastify) on Node.js | Lightweight, TypeScript-native, fast cold starts |
| ORM | **Prisma** | Schema-first, type-safe, generated client, excellent DX |
| Scrapers | Node workers + BullMQ | Cron-driven jobs; same language as API |
| DB | Postgres | Standard; relational schema fits the domain |
| Object store | S3 (later) / local disk (early) | Raw artifact archive for replay/audit |
| Hot cache | Redis | Live-watch state; rate-limit budgets; BullMQ backing |
| Mobile | React Native + Expo | Single codebase iOS+Android+PWA fallback |
| Shared types | Prisma + workspace package | Schema generates TS types used in API and mobile |
| AI / LLM | Anthropic SDK (TypeScript) | Claude for conversational + generative features |
| On-device ML | Apple Vision / MediaPipe | Pose detection for stroke analysis (v3+) |
| Payments | Stripe (subscription only, no Connect) | Parent subscriptions; no platform marketplace |
| Errors | Sentry | Already familiar |
| Hosting (early) | Mac Mini M4 (always-on) | Zero infra cost until paying users exist |
| Hosting (later) | AWS via existing numbered corp, or Fly.io | Scales when we cross ~500 paying users |

**Language unification:** the entire stack is TypeScript except for an optional Python ML sidecar if/when classical ML grows beyond what's reasonable in JS. SDIF parser is written in TypeScript (the existing Python and JS parsers are similarly immature, so writing one is the path either way).

**Realistic infra cost:** CA$0/month for v1 → CA$50/month at 500 paying users.

### Hosting evolution

Vendor commitments are made when they solve a problem we have, not at scoping time. The phased path:

| Phase | Trigger | Hosting choice |
|-------|---------|----------------|
| v0 (development) | Day one | Mac Mini M4 always-on, Postgres in Docker locally |
| v0.5 (CI + staging) | First non-self user OR CI setup | Add **Neon** for serverless Postgres with PR branching (pairs cleanly with Prisma) |
| v1 (paying users) | First $1 of revenue | Migrate API to AWS (existing numbered corp) or Fly.io |
| v2+ (web surface emerges) | Marketing site or web admin needed | Add **Vercel** if a Next.js surface is justified |

Re-evaluate at each transition rather than locking now. Vercel has no v1 fit — React Native deploys via EAS, Hono runs cleanly on dedicated infra, and scrapers are long-running workers that don't suit serverless. Neon fits cleanly when the time comes but adds zero value during local Docker development.

---

## Repo layout (monorepo)

```
flipturn/
├── apps/
│   ├── api/          # Hono / Fastify + Prisma client
│   ├── mobile/       # Expo / React Native
│   └── workers/      # BullMQ workers (canonical, post-meet, live loops)
├── packages/
│   ├── sdif-parser/  # TypeScript .hy3/.cl2 parser — candidate for OSS release
│   ├── db/           # Prisma schema + migrations + generated client
│   └── shared/       # Cross-package types, validation, constants
├── docs/
│   └── adr/          # Architecture Decision Records
├── PROJECT_BRIEF.md  # This file
└── README.md
```

**Build order:**

1. `packages/db` — Prisma schema modeling athletes, meets, events, swims, PBs.
2. `packages/sdif-parser` — Foundational primitive; testable in isolation against real `.hy3` files; valuable as standalone OSS regardless of project outcome.
3. `apps/workers` — Canonical loop (Tier 4) against `results.swimming.ca`, writing through `packages/db`.
4. `apps/api` — REST/RPC over the Prisma client; identity resolution v1 (manual SNC ID).
5. `apps/mobile` — Onboarding + PB tracking + time-standard view, consuming the API.
6. Iterate to v2/v3.

---

## Feature catalog

Six tiers of features organized by parent need. Tier 1 is the hook; Tiers 2-6 are the moat. Sequencing is in the Roadmap section below — this section is the durable feature reference.

### Tier 1 — Performance tracking (table stakes, the hook)

What gets parents to download. Everyone wants to know "is my kid getting faster?" and existing tools answer it badly.

- **Auto-pulled time history** from public meet results once a parent enters their kid's name + DOB + club. PB tracking, time progressions, splits, drop rates per stroke/distance.
- **PB notifications** — push alert when a new PB is detected. Dopamine hit; primary engagement driver.
- **Time standard tracking** — visual progress bars toward AAA, AAAA, Provincial, National, and Olympic Trials cuts. "Sarah needs to drop 1.4 seconds on her 100 free to qualify for Easterns."
- **Multi-meet split analysis** — how is the kid's race construction changing over time? First-50 vs second-50 splits trending. Genuinely missing from existing tools.
- **Percentile + ranking** — where does my kid rank in their age group provincially / nationally / for their birth year cohort.

### Tier 2 — Meet day parent experience (the differentiator)

Where parents are most stressed and most underserved. Hy-Tek heat sheets are PDFs from 1998.

- **My kid's day at the meet** — pulls heat sheet, shows just their events with estimated swim times, lane assignments, warm-up window. Push notification 10 minutes before each event.
- **Live results integration** — when TouchPadLive / SwimPhone / Swimnerd Live is publishing, show real-time results for the kid's events (parent pastes meet URL during onboarding for the meet).
- **Race video capture + auto-trim** — parent records the whole heat on their phone, app uses event timing to auto-trim just their kid's swim. Solves the "I have 47 unsorted swim videos" problem every swim parent has. **This is the v2 paid hook.**
- **Stroke analysis on captured video** — slow-motion playback, side-by-side compare to a previous swim. AI-assisted stroke fault detection (high elbow on freestyle catch, late breath, asymmetric kick) — feasible on-device with Apple Vision / MediaPipe.
- **Meet logistics** — pool address, parking, where to set up tents, concession info, day-1 vs day-2 schedules. Sourced once per meet, shared across all parents using Flip Turn at that meet.
- **Carpool / ride-share coordination** within a club's parent group — opt-in.

### Tier 3 — Kid-facing engagement (the retention layer)

Parents pay; kids decide whether the app stays installed.

- **Kid mode** with simplified, age-appropriate UI showing times as a streak/progression game. Gamified PB chasing.
- **Goal-setting workflow** — kid picks an event and a target time for the season; app shows progress and what's needed to hit it.
- **Achievement badges** — first PB, first qualifying time, first sub-1:00 hundred, attended X meets. Yes it's gimmicky; yes parents and kids both eat it up.
- **Coach feedback prompts** — kid records a 30-second voice memo answering "what did coach say about your race?" Builds reflection habit; surfaces to parent.
- **AI race recap for kids** — generated parent/kid-friendly narrative of how the race went, what improved, what to focus on next. Age-appropriate language, encouraging tone.

### Tier 4 — Parent community + social (the network layer)

Be careful here — this is where apps get bloated. Real underserved jobs only.

- **Club-private parent chat / forum** that's *not* WhatsApp. Topic-organized, searchable, persists when parents leave.
- **Volunteer signup, billet hosting (for travel meets), carpooling** — adjacent to club ops without duplicating club software.
- **Used gear marketplace** within a club — kid outgrew tech suit, sell to a younger swimmer. Recurring need; tech suits are expensive.
- **Anonymous benchmarking** — "parents of 12yo girls swimming AAA times typically train X hours/week, sleep Y hours, etc." Anonymized, opt-in.

### Tier 5 — Health, wellness, training-adjacent

Higher-stakes feature space; regulatory caution required.

- **Practice attendance + dryland tracking** — parent or kid logs "did I go." Pairs with mood/sleep/energy logging.
- **Period tracking for older female swimmers** — performance correlation with menstrual cycle is genuinely underserved in age-group swimming. Sensitive feature; needs careful UX and explicit opt-in by the swimmer themselves, not the parent.
- **Nutrition reminders / meet-day fueling reference** — pre-meet meal timing, between-event snacking, post-meet recovery. Pediatric sports nutrition basics, not personalized advice.
- **Sleep tracking integration** with Apple Health / Garmin / Whoop — surface correlation between sleep and PB occurrence.
- **Coach-set workout viewer** if the coach pushes practice content — mostly out of scope vs. PoolQ but possible if requested.

### Tier 6 — Recruiting / college pathway (long-tail upsell)

For older athletes; different product wedge with higher willingness to pay.

- **Recruiting profile** — auto-generated from existing data: best times, age-up projections, time progression chart, video clips. Exportable PDF for college coaches.
- **NCAA / U Sports time-cut tracking** — what division/conference does the current best time qualify for.
- **Coach contact log** — who's reached out, who you've responded to, application deadlines.
- **AI-assisted recruiting communications** — Claude-generated draft emails to coaches based on the swimmer's profile.

Swimcloud already does some of this for US college recruiting; for Canadian families navigating both U Sports + NCAA, it's underserved.

### Features deliberately NOT planned

- **Anything requiring club admin access.** That's PoolQ/TeamUnify's territory.
- **Practice/training plan authoring.** Coach-facing, not parent-facing.
- **Payments to clubs.** Scope-explosion territory (see anti-goals).
- **Live timing console integration.** Belongs to Hy-Tek/Colorado Time Systems.

---

## AI / ML architecture

Three patterns cover all AI features in the catalog. Each has a different deployment story and cost profile.

### Pattern A — API-call AI (LLM-based, server-side)

Used for: conversational features, generative race recaps, kid-mode summaries, recruiting email drafts, parent Q&A about progress.

- Anthropic SDK in TypeScript, running in `apps/api`
- Model: Claude (Sonnet for most features, Haiku for cheap/fast paths)
- Mobile app calls Flip Turn API → API constructs prompt with relevant athlete data from Postgres → calls Anthropic → streams response back
- Costs are per-token, predictable, no infrastructure to run
- All sensitive data stays server-side; only what's needed for the prompt goes to Anthropic

Example: "Tell me how Sarah's swim went today" → API loads Sarah's swim, splits, prior PB, peer rankings → prompts Claude → returns parent-friendly narrative.

### Pattern B — On-device AI (vision, real-time, privacy-sensitive)

Used for: stroke analysis from video, automatic race detection in long footage, video clip auto-trimming.

- **Apple Vision framework** (iOS) — pose detection, body keypoints, action classification. Free, fast, on-device.
- **MediaPipe / ML Kit** (cross-platform) — Google's pose estimation; runs on iOS and Android.
- **Core ML** (iOS) — for any custom-trained models bundled into the app.
- Exposed to React Native via Expo native modules.

Why on-device: video is huge (uploading meets is expensive), latency must feel instant, and parents are more comfortable with kids' video staying on the phone.

v3 stroke analysis pipeline:
1. Parent records meet with phone
2. App uses Vision/MediaPipe to detect pose keypoints frame-by-frame
3. Custom heuristics flag stroke faults (late breath, dropped elbow, asymmetric kick)
4. Slow-motion playback annotated with the analysis

Heuristics first; train custom models only if needed.

### Pattern C — Backend ML (predictions, embeddings, matching)

Used for: PB projection, time-standard ETA, athlete identity matching across meets, anonymous benchmarking.

- Mostly **classical ML** (linear regression, gradient boosting, simple Bayesian models), not LLM
- Run as **scheduled batch jobs** in `apps/workers` — no real-time serving infrastructure
- Results stored in Postgres, served by API as cached projections

Implementation choice:
- **TypeScript-first**: `simple-statistics`, `ml-regression`, custom logic. Sufficient for v1.
- **Python sidecar (later)**: if/when classical ML grows beyond what's reasonable in JS, run a small Python service (FastAPI + scikit-learn + pandas) called by the Node workers. Keeps the main codebase unified while allowing the right tool for heavy ML.

### AI feature mapping

| Feature | Pattern | Phase |
|---------|---------|-------|
| PB notifications | C (rule-based, not really AI) | v1 |
| Identity resolution (athlete matching) | C | v1 → improves over time |
| Time-standard ETA projection | C | v1 |
| AI race recap (parent-facing) | A | v2 |
| AI race recap (kid-facing) | A | v3 |
| Coach feedback prompt generator | A | v3 |
| Stroke analysis from video | B | v3 |
| Auto-trim race clips from long footage | B | v3 |
| Recruiting profile narrative | A | v4 / Tier 6 |
| Recruiting email drafting | A | v4 / Tier 6 |
| Anonymous benchmarking insights | C + A (synthesized via LLM) | v4+ |

---

## Roadmap

### v1 (MVP) — first 3 months

Tier 1 only. Hard scope:

- Onboarding: parent enters kid's name, DOB, SNC ID (or club + name fallback)
- Auto-pull time history from `results.swimming.ca`
- PB tracking per (event, course) with progression chart
- Time standard tracking against Canadian provincial + national standards
- Push notifications: "New PB on 100 free!" (Tier 4 latency, accuracy over speed)
- Multi-meet split analysis
- Free tier with paywall on advanced analytics (TBD which)

**v1 success criterion:** 50 paying parents at CA$8/month within 6 months of launch. If we can't reach that, the wedge is wrong, not the execution.

### v2 — meet day mode (months 4–7)

Tier 2 partial:

- "My kid's day at the meet" — heat sheet parsing, lane assignments, push notifications before events
- Live results integration via user-pasted meet URLs (TouchPadLive, SwimPhone, Swimnerd Live)
- AI race recap (Pattern A) — parent-facing narrative after each event
- Multi-athlete family accounts

### v3 — video + kid engagement (months 8–14)

Tier 2 video features + Tier 3:

- Race video capture + auto-trim (Pattern B)
- Stroke analysis from video (Pattern B)
- Kid mode UI
- Goal-setting workflow
- Achievement badges
- Kid-facing AI race recaps + coach feedback prompts (Pattern A)

### v4+ — community, wellness, recruiting (year 2+)

- Tier 4 (parent community) features as requested
- Tier 5 (wellness) features with care
- Tier 6 (recruiting) as separate higher-priced tier (CA$25–40/month for older athletes)

---

## Legal posture (summary)

**Not legal advice.** A one-hour consult with a Toronto SaaS/data lawyer is required before charging users.

### Per-source posture

| Source | Risk | Approach |
|--------|------|----------|
| `results.swimming.ca` | Low | Polite scraping, attribution, rate-limited |
| Host club sites | Low | Standard scraping etiquette; respect robots.txt |
| TouchPadLive | Medium-high | User-pasted URLs only, never crawled |
| SwimPhone | Medium | User-pasted URLs only |
| Swimnerd Live | Low | Open-link friendly; user-pasted URLs |
| Swimcloud | Medium | One-off identity lookups only; no bulk scraping |
| Meet Mobile | Do not touch | Mobile-only, owned by Comcast |

### Mandatory safeguards from day one

- Identifying User-Agent: `FlipTurnBot/1.0 (+https://flipturn.app/bot)` with contact email
- Rate limit: hard-cap 1 req/5s per source; per-day per-host budgets
- Aggressive caching: never re-scrape a meet once captured
- robots.txt compliance even when technically unnecessary
- PIPEDA-compliant privacy policy + data-deletion endpoint from launch
- Source attribution surfaced in-app
- Public takedown form, fast turnaround, no questions asked
- Store minimum data: year-only DOB unless full needed for matching

### Long-term path

Years 1-2: public-data scraping mode. Year 2+: transition to licensed data via SNC partnership once user count gives leverage. Architecture abstracts data sources behind the normalized schema, so swapping a scraper for an API client is local change.

---

## Open decisions (defer until needed)

- Final tagline (logo currently shows "Swim Club Platform" which contradicts anti-goals — see Branding Notes)
- Pricing model: flat monthly vs. annual vs. freemium-with-paywall — defer until v1 feature scope is locked
- iOS-first vs. Android-first launch — Expo means we ship both, but App Store review matters more for discovery
- Open-source `sdif-parser` immediately or after v1 launch
- Whether to register a separate corporate entity or use existing numbered corp
- US launch timing — likely v2+, after Canadian product-market fit

---

## Branding notes

**Name:** Flip Turn — a swim-specific term (the underwater turn at the wall), instantly recognizable to anyone in the sport, easy to say, available as `.app` and on social handles (verify before locking).

**Logo:** maple leaf silhouette with a swimmer mid-stroke and stylized waves. Strong Canadian-first signal. Works at app-icon size (the swimmer + wave silhouette inside the leaf is the strongest read at small sizes).

**Tagline issue:** the current logo lockup includes "Swim Club Platform," which directly contradicts our anti-goals (we are deliberately *not* building a club platform — that's PoolQ/TeamUnify's territory). Recommended action:

- For app icon and primary brand mark: drop the tagline entirely, let the wordmark stand alone
- For website / App Store listing: pick a parent-facing tagline that signals the actual wedge, e.g.:
  - "Track every swim"
  - "Your swimmer's progress, at a glance"
  - "Where swim parents track progress"
  - "Built for swim parents"
- Avoid anything that implies club-side functionality until/unless we change the strategic direction

**Brand palette** (from logo): red (`#C8332D`-ish maple leaf), navy (`#1F3D5C`-ish wordmark), teal-blue gradient waves. Carries through to the app — Canadian, athletic, not childish, not corporate-cold.

---

## Background context for agents

The owner (Darrell) is an Engineering Manager at Constant Contact's Waterloo office, AI Innovation Lead, with deep multi-agent systems experience. This is a side project run alongside day job and other independent R&D. Bandwidth is real-but-bounded; favor decisions that compound over decisions that require sustained heroic effort.

Stack familiarity is high in: TypeScript, React, Python, Postgres, AWS, Anthropic Agent SDK, Claude Code, multi-agent orchestration. Lower familiarity in: React Native specifics (will lean on Expo defaults), iOS Vision framework, Stripe Connect (intentionally avoided in v1), Prisma (newer to it but the DX is approachable).

The multiagent-team plugin (six-agent FIPA-ACL system: Architect / Mason / Breaker / Shipp / Sentinel / Wiki) is the preferred development workflow. Flip Turn is a good test case for that plugin in a clean greenfield codebase, and a good forcing function for shipping the `.claude/team-profile.md` domain layer that's queued in the plugin roadmap.

This project is **TypeScript-first** end-to-end (mobile, API, workers, parser, schema). A Python ML sidecar is allowed if/when classical ML demands it, but the default answer for new code is TypeScript.

---

## What this brief is NOT

This is not the technical design doc. ADRs go in `docs/adr/`. API contracts go in OpenAPI specs. Database migrations go in version-controlled SQL. This brief stays high-level — strategic context, scope boundaries, anti-goals — and gets updated when those change, not when implementation details change.
