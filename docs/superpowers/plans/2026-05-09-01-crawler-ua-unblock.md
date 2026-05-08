# Crawler UA Unblock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the crawler's ability to read `swimming.ca` pages by sending a browser-class User-Agent + `Accept` / `Accept-Language` / `From:` headers, per [ADR 0007](../../adr/0007-crawler-ua-policy.md). One task, ~30 minutes of execution.

**Why now:** v2 athlete-search-impl (PR #44) ships a working warmer that 403s in production because Swimming Canada's WAF blocks our identifiable bot UA. The substrate-transition roadmap (`docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md`) Phase 0 calls for this fix.

**Tech stack reminder:** TypeScript, undici, Vitest. Files affected: `apps/server/workers/src/fetch.ts`, `apps/server/workers/tests/fetch.test.ts`, plus a one-line wording amendment to the v1 design spec.

---

## Task 1: Add browser UA + `From:` + `Accept-*` headers to `politeFetch`

**Files:**
- Modify: `apps/server/workers/src/fetch.ts`
- Modify: `apps/server/workers/tests/fetch.test.ts`
- Modify: `docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md` (one-line wording change at the original spec's UA line — point at ADR 0007)

- [ ] **Step 1: Read the existing `politeFetch` implementation.**

```bash
sed -n '1,120p' apps/server/workers/src/fetch.ts
```
Identify where outbound headers are constructed. The current implementation likely sets only `User-Agent` (the old `FlipTurnBot/0.1` value). The change is to swap that value and add three more headers.

- [ ] **Step 2: Define the headers as named constants.**

Add to `apps/server/workers/src/fetch.ts` near the top of the file (above `politeFetch`):

```typescript
// Header policy — see docs/adr/0007-crawler-ua-policy.md.
// `From:` is the only transparency signal we retain; if it's dropped, ADR 0007's
// justification collapses. The regression test below locks it in.
export const CRAWLER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Safari/605.1.15';
export const CRAWLER_FROM = 'flipturn-ops@flipturn.ca';
export const CRAWLER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
export const CRAWLER_ACCEPT_LANGUAGE = 'en-CA,en;q=0.9,fr-CA;q=0.8';

export const CRAWLER_DEFAULT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'User-Agent': CRAWLER_USER_AGENT,
  'From': CRAWLER_FROM,
  'Accept': CRAWLER_ACCEPT,
  'Accept-Language': CRAWLER_ACCEPT_LANGUAGE,
});
```

- [ ] **Step 3: Wire the headers into the fetch call.**

Find the line(s) inside `politeFetch` that build the request headers (likely a `headers: { 'user-agent': ... }` literal or a `Headers` constructor). Replace the literal with `CRAWLER_DEFAULT_HEADERS` (or spread it: `headers: { ...CRAWLER_DEFAULT_HEADERS, ...userOverrides }`). If the function accepts caller-provided headers, callers' overrides should win — but `From:` and `User-Agent` should still be present unless a caller explicitly clears them, which no caller currently does.

If the existing code passes headers via an `undici.fetch` `init.headers` object, the same spread pattern works. Don't introduce a new HTTP layer — change only the headers construction.

- [ ] **Step 4: Write the regression test FIRST (TDD).**

Add to `apps/server/workers/tests/fetch.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  politeFetch,
  CRAWLER_USER_AGENT,
  CRAWLER_FROM,
  CRAWLER_ACCEPT,
  CRAWLER_ACCEPT_LANGUAGE,
} from '../src/fetch';

describe('politeFetch headers (ADR 0007 lock-in)', () => {
  it('sends browser User-Agent, From, Accept, Accept-Language on every request', async () => {
    // Capture the headers passed to undici (or the underlying fetch primitive).
    // Replace with whatever mock pattern the existing tests use.
    const captured: Record<string, string> = {};
    const mockFetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      Object.assign(captured, init?.headers ?? {});
      return new Response('<html></html>', { status: 200 });
    });
    // If politeFetch accepts an injectable fetch, pass mockFetch.
    // Otherwise stub global fetch / undici via vi.stubGlobal as the existing tests do.
    vi.stubGlobal('fetch', mockFetch);

    await politeFetch({ url: 'https://www.swimming.ca/swimmer/5567334/' });

    expect(captured['User-Agent'] ?? captured['user-agent']).toBe(CRAWLER_USER_AGENT);
    expect(captured['From'] ?? captured['from']).toBe(CRAWLER_FROM);
    expect(captured['Accept'] ?? captured['accept']).toBe(CRAWLER_ACCEPT);
    expect(captured['Accept-Language'] ?? captured['accept-language']).toBe(CRAWLER_ACCEPT_LANGUAGE);
  });

  it('From: header MUST be present on every fetch (ADR 0007 transparency invariant)', async () => {
    const captured: Record<string, string>[] = [];
    const mockFetch = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      captured.push({ ...(init?.headers ?? {}) });
      return new Response('<html></html>', { status: 200 });
    });
    vi.stubGlobal('fetch', mockFetch);

    // Three sequential fetches — the From header must appear on all of them.
    await politeFetch({ url: 'https://www.swimming.ca/swimmer/1/' });
    await politeFetch({ url: 'https://www.swimming.ca/swimmer/2/' });
    await politeFetch({ url: 'https://www.swimming.ca/?s=Felix' });

    expect(captured).toHaveLength(3);
    for (const h of captured) {
      expect(h['From'] ?? h['from']).toBe(CRAWLER_FROM);
    }
  });
});
```

The exact mock pattern depends on what `apps/server/workers/tests/fetch.test.ts` already does — match its conventions. The above is a starter; adapt rather than fight.

- [ ] **Step 5: Run the test, confirm FAIL.**

```bash
pnpm --filter @flipturn/workers test fetch
```
Expected: the new tests fail (current `politeFetch` sends `FlipTurnBot/0.1`, no `From:`).

- [ ] **Step 6: Apply the implementation change from Step 3.**

Update the headers construction inside `politeFetch` to use `CRAWLER_DEFAULT_HEADERS`.

- [ ] **Step 7: Run tests, confirm PASS.**

```bash
pnpm --filter @flipturn/workers test fetch
```
Expected: all `politeFetch headers` tests pass. Existing fetch tests remain green.

- [ ] **Step 8: Update the v1 design spec wording.**

In `docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md` find the line that currently says:

> No User-Agent rotation. We send a static, identifiable User-Agent that names Flipturn and a contact URL...

Replace with a one-line forward reference:

> User-Agent and transparency posture are recorded in [ADR 0007](../../adr/0007-crawler-ua-policy.md), which supersedes the original "transparent identifiable UA" stance after the WAF blocked it during smoke testing.

Don't rewrite the rest of the section — just the relevant paragraph or sentence. The point is to keep the spec from contradicting reality.

- [ ] **Step 9: Run typecheck + full workers suite.**

```bash
pnpm typecheck
pnpm --filter @flipturn/workers test
```
Both must be green. The api package is unaffected by this change but if you want a safety check, run `pnpm -r test`.

- [ ] **Step 10: Manual smoke (optional but high-value).**

If Docker postgres + redis are running locally, fire one curl through the new headers and verify it now returns 200 instead of 403:

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -A "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15" \
  -H "From: flipturn-ops@flipturn.ca" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
  -H "Accept-Language: en-CA,en;q=0.9,fr-CA;q=0.8" \
  "https://www.swimming.ca/?s=Felix+Bechtel"
```
Expected: `HTTP 200`. (The WAF can still 429 us if we burst, but politeness should keep us off that.)

If you have time and the warmer is wired locally, kick off `POST /v1/admin/warmer-run {clubName: "Club Warriors"}` and verify Felix's row (sncId 5567334) lands in the `Athlete` table within ~60s. If the warmer still fails, it's no longer a UA problem and needs separate investigation.

- [ ] **Step 11: Commit.**

```bash
git add apps/server/workers/src/fetch.ts \
        apps/server/workers/tests/fetch.test.ts \
        docs/superpowers/specs/2026-05-08-01-athlete-search-index-design.md \
        docs/adr/0007-crawler-ua-policy.md
git commit -m "$(cat <<'EOF'
feat(workers): browser UA + From header per ADR 0007

The smoke test of v2 athlete-search-impl (PR #44) revealed swimming.ca's
WAF returns 403 for FlipTurnBot/0.1 and 200 for browser UAs. Switch
politeFetch to a static Safari UA with Accept / Accept-Language /
From: flipturn-ops@flipturn.ca headers. The From: header is the only
transparency signal we retain; a regression test locks it in.

ADR 0007 records the values trade-off authoritatively. The original v1
spec's "transparent identifiable UA" wording is amended to reference
the ADR.
EOF
)"
```

(The plan and ADR may already be committed on the branch — adjust the `git add` set to match what's actually new.)

---

## Notes for the implementer

- This task is one commit. The plan is structured as 11 steps for clarity, not for separate commits. Squash reviews work fine.
- The `From:` header is load-bearing for ADR 0007 — if you find yourself accidentally removing it during refactor, the regression test will catch you.
- Don't rotate User-Agents. Don't add IP rotation. Don't add captcha solving. ADR 0007 is explicit that scope creep beyond static-Safari-UA + `From:` requires a new ADR.
- If swimming.ca's WAF still 403s after this change, the next step is **not** to escalate the UA; it's to email Swimming Canada (Phase 0 → Phase 3 acceleration in the roadmap). Don't paper over with more bot-evasion tactics.
- After this lands, PR #44's warmer should be functional. Re-run its smoke test and update the PR description to note the unblock.
