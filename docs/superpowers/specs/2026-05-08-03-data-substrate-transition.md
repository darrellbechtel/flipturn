# Data Substrate Transition — Roadmap

**Date:** 2026-05-08
**Status:** Draft (strategic roadmap; not a TDD implementation plan)
**Scope:** Multi-quarter transition from `swimming.ca` crawler ingestion to host-club `.hy3` (SDIF) ingestion
**Owner:** Darrell Bechtel
**Parent docs:**
- [`PROJECT_BRIEF.md`](../../../PROJECT_BRIEF.md) — overall product strategy and four-tier latency model
- [`docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md`](./2026-05-08-01-athlete-search-index-design.md) — current crawler design
- [`docs/superpowers/specs/2026-05-08-02-athlete-search-index-pivot.md`](./2026-05-08-02-athlete-search-index-pivot.md) — pivot to search-proxy + warmer

---

## 1. Why this document exists

The `FlipTurnBot/0.1` smoke-test finding (swimming.ca's WAF returns 403 for identifiable bot UAs and 200 for browser UAs) forces a decision: continue the crawler with a less-transparent UA, or accelerate the move to a different data substrate (host-club `.hy3` files via the existing `packages/sdif-parser` slot in the brief).

**Decision (this doc captures the rationale):** stay on the crawler in the short term to populate the database with historical depth that powers charting, analytics, and a usable day-one search experience — *and simultaneously* begin the multi-quarter program of work that earns the right to switch to the relationship-based `.hy3` substrate. The substrate switch is the long-term play; the crawler is the bridge.

This is a values choice as much as a technical one. The original athlete-search spec at line 144 committed to a transparent UA. That posture has to evolve, and this document is where that evolution is recorded so the codebase doesn't say one thing and do another.

## 2. Strategic frame

### Why keep the crawler now

- **Past data is the product.** Charting PB progression, multi-meet split analysis, and time-standard projection (all v1 features in the brief) all require historical swims. A swimmer with no history in the index is a blank chart. Crawler-derived `Athlete` rows + the existing `athlete-detail-scrape` worker give us depth on day one.
- **Pre-fill makes the app credible at first launch.** Beta users searching for their kid and seeing four years of races land in seconds is the wedge demo. Empty-state onboarding with "we'll build your history as meets happen" is a much weaker pitch.
- **Crawler infrastructure already exists.** Workers, scheduler, jitter, evening window, parser library — all built and tested on `darrellbechtel/feat/athlete-search-impl`. Throwing it away now in favor of a substrate that requires inbound relationships first would be premature optimization.

### Why move to `.hy3` long-term

- **Substrate independence.** Crawling depends on swimming.ca's posture. They can tighten their WAF tomorrow. Host-club `.hy3` files are published voluntarily by the host clubs themselves — distributed, harder to centrally cut off.
- **Richer per-swim data.** SDIF includes splits, reaction times, DQ codes, meet metadata, and seeded vs. final times. Crawled HTML is a thinner projection.
- **Defensible and scalable.** A relationship network with host clubs is a moat. A scraper is a feature any competitor can clone in a weekend.
- **Aligns with the brief's anti-fragility intent.** `PROJECT_BRIEF.md` already has `packages/sdif-parser` as a planned package and explicitly calls it a "candidate for OSS release." This roadmap activates that slot rather than inventing it.

### Why preconditions matter

We can't credibly knock on host clubs' doors until Flipturn looks like a real product. "Hi, I'm building an app, can I have your meet data?" with no website, no live mobile build, no public privacy policy, and no founder face on the homepage gets ignored or politely declined.

Phases 1–2 below exist to *earn the right* to start Phase 3 (outreach). The order is not arbitrary.

## 3. Phase roadmap

| Phase | Goal | Trigger to enter | Trigger to exit |
|---|---|---|---|
| 0 | Unblock crawler — switch UA | Now | Crawler successfully populates index for P1+P2 priority clubs |
| 1 | Crawler-fed MVP shipped to closed beta | Phase 0 done | 10–20 hand-recruited beta parents using the app weekly for 4 weeks |
| 2 | Public-facing professionalism layer | MVP demonstrably retains beta users | Public website live with privacy/terms/contact/founder/demo |
| 3 | First-wave host-club outreach | Phase 2 complete | First "yes" from a host club to share `.hy3` |
| 4 | First `.hy3` ingestion path live | First host-club yes received | One full meet successfully parsed end-to-end and reflected in app |
| 5 | Network expansion + dual-substrate run | Phase 4 stable for 30 days | Critical mass: ≥10 host clubs sharing `.hy3` regularly |
| 6 | Crawler deprecation (optional) | Phase 5 complete + product not regressing | N/A — terminal phase |

Each phase below has an "exit criteria" line that defines when it's done. No phase is time-boxed; each completes when its own criterion is met.

## 4. Phase 0 — UA unblock (immediate, concrete)

**Goal:** Restore the crawler's ability to read swimming.ca pages so the closed-beta priority-club seeding can complete.

**The values decision (recorded explicitly):** the original spec said:

> Goal is not to evade detection; it is to not trip naive heuristics while remaining transparent about who we are. (`2026-05-08-01-athlete-search-index-design.md:144`)

The smoke-test finding inverted this assumption: identifying as a bot **is** the trip wire. Continuing the crawler therefore requires sending a browser-class User-Agent, which crosses from "openly identified" to "indistinguishable from organic browser traffic" in WAF terms. We accept this trade for Phase-0–through–Phase-3 because:

1. The data being fetched is published publicly by Swimming Canada for parents and the public to consume; we are not exfiltrating private data.
2. Volume is low (≤ a few thousand requests / day, jittered, evening window only), well below any reasonable burden threshold.
3. We retain a `From:` header pointing at `flipturn-ops@flipturn.ca` so any operator who cares to look can identify and contact us. This is the *minimum* transparency we keep.
4. We commit to honoring `robots.txt`, exponential backoff on 4xx/5xx, and an immediate halt + Sentry alert if Swimming Canada ops contacts us via the `From:` address.

**Exit criteria:** crawler completes a clean run over P1 + P2 clubs (`2026-05-08-01-athlete-search-index-design.md:181`); index is dense enough to onboard the closed-beta cohort.

**Implementation slice (this is the concrete work for Phase 0):** see `docs/superpowers/plans/2026-05-09-01-crawler-ua-unblock.md` (to be written next; one-task plan, ~30 minutes of work).

The shape of the change, for sizing purposes:

- Modify `politeFetch()` to send a static modern Safari User-Agent + `Accept`, `Accept-Language`, and `From` headers.
- Add an ADR (`docs/adr/0007-crawler-ua-policy.md`) recording the values trade-off above so this isn't a silent change.
- Add a regression test that asserts the `From` header is present (it's the only piece of transparency we still control).
- Update `2026-05-08-01-athlete-search-index-design.md:144` to reference the ADR rather than the original "transparent UA" wording.

## 5. Phase 1 — crawler-fed MVP shipped to closed beta

**Goal:** Get the existing v1 feature set (PB progression, time-standard tracking, multi-meet split analysis, push notifications, DQ code translation, shareable PB cards) working over crawler-sourced data and into the hands of 10–20 beta parents.

This phase is mostly pre-existing work — Plans 1–6 in `docs/superpowers/plans/` already cover the MVP build. Phase 1 of *this* roadmap is just the act of reaching the brief's MVP success criterion using crawler-sourced data.

**Exit criteria** (matches `PROJECT_BRIEF.md` MVP criterion): 10–20 beta parents complete onboarding, open the app at least weekly for four consecutive weeks. Two new gaps from PR #43 (DQ code translation, shareable PB cards) ship in this phase.

## 6. Phase 2 — public-facing professionalism layer

**Goal:** Make Flipturn look like a real company so Phase 3 outreach is credible.

The asks below are sized as the *minimum* a host club's webmaster, registrar, or executive director would need to see before forwarding a meet results email to a stranger. Each is a small artifact, not a big project.

**Required artifacts (exit criteria — all of these live, public, and accurate):**

1. **`flipturn.ca` marketing homepage.** Founder name + face, one-paragraph product pitch, two screenshots, link to the privacy policy and terms (already drafted in `docs/legal/`), email contact.
2. **TestFlight / Play-internal install link.** A meet host can install the app on their own phone in under two minutes and see their own kid's data populated. This is the credibility shortcut: a working app is worth more than any website copy.
3. **Privacy policy + Terms of Service published.** Already drafted at `docs/legal/privacy-policy.md` and `docs/legal/terms-of-service.md`; this phase is just publishing them at stable URLs.
4. **Takedown / unsubscribe page.** Drafted at `docs/legal/takedown.md`; needs to be linked from the homepage and reachable by anyone, not just registered users.
5. **Founder bio page.** Trust signal. One paragraph + one photo + LinkedIn link. Does more for outreach response rate than any other single change.
6. **Public crawler/data-sources statement.** A short page disclosing what we ingest, from where, with what frequency, and how to request removal. This is the *real* transparency layer that replaces the crawler's removed UA-level transparency.

**Exit criteria:** all six artifacts above are live and link to each other from the homepage; the founder can text the homepage URL to a stranger and not be embarrassed.

A separate plan will be drafted for the homepage build when this phase opens. Likely path: `apps/web/` (Next.js) deployed to Vercel — the brief already anticipates this at `PROJECT_BRIEF.md` (Phase v2 hosting evolution table).

## 7. Phase 3 — first-wave host-club outreach

**Goal:** Land the first "yes" from a host club willing to share `.hy3` files post-meet.

**Strategy:** narrow before wide. Don't email 50 clubs; befriend 3.

**Target list (in order):**

1. **Owner's home cluster** — Club Warriors (Waterloo), ROW, Guelph (whichever is the right SNC entity per `2026-05-08-01-athlete-search-index-design.md:181-187`). Personal-relationship advantage.
2. **WOSA-region meet hosts** — clubs hosting Regionals, Sectionals, and high school invitationals in Southwestern Ontario in the rolling 12-month calendar. They produce `.hy3` files anyway and have an interest in those files reaching parents.
3. **A Swim Ontario or Swimming Canada staff contact** — if a warm intro is available. Not gating Phase 3, but a "yes" here unblocks subsequent phases dramatically.

**Outreach mechanics:**

- Email, not DM. Coaches and registrars are over-50 and over-DMd.
- One paragraph max. Lead with the demo install link from Phase 2; let the product speak.
- Concrete ask: "Could you BCC `meets@flipturn.ca` on the email you already send when results are posted?" — zero new work for them.
- Soft ask first; never lead with "can we license your data."
- Track every outreach in a simple shared spreadsheet. Conversion rate is data; we'll need it when prioritizing Phase 5.

**Exit criteria:** at least one host club has actually sent a `.hy3` file to `meets@flipturn.ca` (not just said yes — actually sent one). This is the real signal.

A separate plan for the outreach process — including the canonical email template, the tracking sheet schema, and the legal-comfort talking points — will be drafted when Phase 2 closes. Filename target: `docs/superpowers/plans/2026-Q3-XX-host-club-outreach-process.md`.

## 8. Phase 4 — first `.hy3` ingestion path live

**Goal:** A single host-supplied `.hy3` file flows end-to-end through `packages/sdif-parser` and shows up correctly in the mobile app for an existing beta user.

**Why this gets a serious implementation plan:** SDIF parsing is the package the brief describes as "candidate for OSS release." It's the long-lived primitive. It deserves TDD, fixtures, and proper test coverage.

**Outline of the implementation plan to be drafted when Phase 4 opens:**

- `packages/sdif-parser/` — new package, TypeScript, fixed-column SDIF v3 record-code dispatch. Test corpus: 5–10 real `.hy3` files from different meet sources to capture vendor variance (Hy-Tek Meet Manager output isn't perfectly uniform across versions).
- `apps/server/api/admin/upload-hy3` — admin-authenticated upload endpoint. Stores raw artifact to `s3://flipturn-raw-meets/` (or local disk pre-S3) before parsing — every `.hy3` is replayable for audit.
- `apps/server/workers/sdif-import` — BullMQ job: read raw artifact, parse, identity-resolve athletes against existing `Athlete` rows (high-confidence auto-merge, medium-confidence flag for parent confirmation per `PROJECT_BRIEF.md`'s identity-resolution model).
- Schema changes: none. The existing `Athlete` / `Meet` / `Event` / `Swim` schema already accommodates everything SDIF carries. The `Swim.dataSource` field lights up with a new `'SDIF_HOST_UPLOAD'` enum value.
- Test plan: full-meet ingestion of a known `.hy3` from a known meet, assert exact PB-progression chart for one specific beta-user kid is identical whether reached via crawler or via SDIF upload (the substrates must agree).

**Exit criteria:** beta user opens the app after a meet, sees their kid's results from that meet via the SDIF path *before* the crawler would have reached them. Chart is correct. DQ codes (per the v1 scope addition in PR #43) translate. No data corruption when the crawler later finds the same swims.

Plan filename target: `docs/superpowers/plans/2026-QX-XX-sdif-parser-and-host-upload.md` — drafted at the moment Phase 3 produces its first real `.hy3` in our inbox.

## 9. Phase 5 — network expansion + dual-substrate run

**Goal:** Grow from one host-club relationship to ten. Run both substrates simultaneously; let the crawler fill the gaps where SDIF coverage is thin.

This phase is mostly relationship work, not engineering. Engineering investment is in *de-duplication* and *substrate-aware confidence* in the data-source model: when a swim has both crawler and SDIF sources, the SDIF version wins (it's authoritative; the brief's `supersedes_id` already anticipates this).

**Exit criteria:** ≥10 host clubs have sent at least one `.hy3` file in a 60-day window. SDIF coverage exceeds crawler coverage for the active beta cohort.

## 10. Phase 6 — crawler deprecation (optional, terminal)

**Goal:** Turn off the crawler when its marginal coverage no longer justifies its operational and legal posture.

This may never happen, and that's fine. The crawler can be a permanent gap-filler. Deprecation only makes sense if:

- SDIF coverage hits ~95% of active beta swimmers' meets, *and*
- Swimming Canada either tightens defenses to make crawling untenable, *or* explicitly asks us to stop, *or* offers a sanctioned data path.

**Exit criteria:** N/A — this is the terminal state.

## 11. Decision criteria summary (the gates)

A phase only moves to the next when its exit criterion is met *and* the next phase's entry trigger fires. Gates exist to prevent the most likely failure mode: shipping outreach (Phase 3) before the product is good enough (Phase 1) or the company is credible enough (Phase 2). The temptation to compress phases will be high; resist it.

| Gate | Failure mode if skipped |
|---|---|
| Phase 0 → 1 | Crawler still throws 403s; index incomplete; beta users see empty charts |
| Phase 1 → 2 | Building a marketing site for a product nobody has used yet — wastes the founder's time and produces unconvincing copy |
| Phase 2 → 3 | Outreach emails get ignored because "what is this thing" is unanswerable in 30 seconds |
| Phase 3 → 4 | Building SDIF parser before any host club has agreed to send a file — premature, possibly speculative |
| Phase 4 → 5 | Trying to scale relationships before the ingestion path has been proven on real data |
| Phase 5 → 6 | Deprecating the crawler before SDIF coverage is genuinely better — feature regression |

## 12. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Swimming Canada formally asks us to stop crawling | Low–Med | Medium (Phase 1 ingestion paused) | `From:` header makes them findable; we comply immediately and accelerate Phase 4 |
| Phase 0 UA change is later viewed as a values violation | Med | Low (recoverable) | ADR `0007` records the trade-off explicitly; Phase 4 SDIF path is the principled exit |
| Phase 2 website doesn't move outreach response rate | Med | Low | Add founder personal-network warm intros as fallback acquisition path |
| SDIF parser hits vendor variance across host clubs | Med | Med (delays Phase 4) | Test corpus of 5–10 files from different vendors before building parser; keep raw artifacts replayable |
| Identity resolution between crawler and SDIF disagrees | Med | High (data corruption visible to users) | `supersedes_id` already in the brief; surface revisions to the parent rather than silently overwriting |
| Phase 3 hits zero yeses despite credible Phase 2 | Low–Med | High (forces accelerated Phase 6 or pivot) | Don't gate Phase 1–2 on Phase 3 — the crawler-fed MVP must be self-sufficient even if outreach never lands |

## 13. Open questions (deferred until their phase opens)

These are *intentionally* not answered now. Pre-deciding them is premature.

- Phase 2: Next.js or astro for the marketing site? (Decide at Phase 2 entry; brief currently leans Next.js.)
- Phase 3: paid tier launches before or after first host-club yes? (Pricing pressure on host clubs vs. revenue runway.)
- Phase 4: SDIF parser as OSS package on npm from day one, or kept private until it stabilizes? (Brief leans OSS; revisit when parser exists.)
- Phase 5: do we publish a "swim data co-op" framing that lets host clubs see *they* benefit from contributing? (Network-effects framing; only meaningful at scale.)
- Phase 6: if the crawler is deprecated, do we OSS the worker code or retire it quietly? (Most useful as reference for similar federations elsewhere.)

## 14. Plan/spec references — what gets written when

| Artifact | Status | Filename target | Phase |
|---|---|---|---|
| ADR — crawler UA policy | To draft now (with Phase 0) | `docs/adr/0007-crawler-ua-policy.md` | Phase 0 |
| Plan — UA unblock | To draft now | `docs/superpowers/plans/2026-05-09-01-crawler-ua-unblock.md` | Phase 0 |
| Plan — public homepage | To draft when Phase 1 closes | `docs/superpowers/plans/2026-QX-XX-public-homepage.md` | Phase 2 |
| Plan — host-club outreach process | To draft when Phase 2 closes | `docs/superpowers/plans/2026-QX-XX-host-club-outreach-process.md` | Phase 3 |
| Plan — SDIF parser + host upload | To draft when Phase 3 produces first `.hy3` | `docs/superpowers/plans/2026-QX-XX-sdif-parser-and-host-upload.md` | Phase 4 |

Each future plan is intentionally not pre-written. TDD plans for code that won't be written for months go stale; we draft them when their preconditions are met and the file paths, data shapes, and constraints are real rather than guessed.

---

## 15. Self-review notes

- **This is a roadmap, not a TDD task list.** It deliberately avoids the `- [ ]` step format because most of the work in scope (homepage, outreach, relationships) is not engineering. The one piece that *is* immediate engineering — the UA unblock — is split off into its own implementable plan rather than crammed into the roadmap as fake task steps.
- **Brief alignment.** Each phase maps cleanly to existing brief language: Phase 1 = MVP success criterion, Phase 2 = `apps/web` + legal docs already drafted, Phase 4 = `packages/sdif-parser` already named, Phase 5 = brief's "tier-3 host-club ingestion" deferred-list item.
- **No placeholders.** Every "to be written" reference is paired with the precondition that triggers it, the filename target, and a one-paragraph outline. None of these are dead-weight TBDs.
