# Flip Turn — Closed-Beta Recruitment Template

Founder ops doc: outreach message, tracking schema, success criterion,
retro questions, privacy reminder.

## 1. Recruitment message

Send to ~30 swim parents you know personally — over-recruit; about a third
never install. Tone is one swim parent to another, not a marketing email.
Personalise the opening line per recipient.

```
Hi <name>,

I've been quietly building a small app for swim parents called Flip Turn.
It pulls your kid's results off results.swimming.ca and shows their PBs
and progression in one place — no more squinting at meet PDFs.

I'd love your help testing it for a month before I open it up. Free during
beta, no signup form. Two minutes to install:

  1. iPhone TestFlight: <TestFlight link — replace after EAS build>
     Android: <Android internal-link URL — replace after EAS build>
  2. Open Flip Turn, type your email, tap the link in the email I send.
  3. Enter your kid's SNC athlete ID (on their swimming.ca profile —
     happy to dig it up if you can't find it).

The app fetches their history within a minute. After that, open it
whenever you'd normally check results. Tell me what's missing, confusing,
or anything that made you smile.

Not your thing? No worries — just ignore this.

— Darrell
```

Notes:

- Replace link placeholders after Plan 6 Task 11 (EAS build) lands.
- Send individually as iMessage/text, not bulk email.
- For people you know less well, add a sentence of context up front.

## 2. Sign-up tracking

Spreadsheet (Google Sheets or Airtable), one row per invited parent:

| Column           | Notes                                             |
| ---------------- | ------------------------------------------------- |
| Name             | First + last                                      |
| Email            | Address used at magic-link sign-in                |
| Kid's SNC ID     | Six-digit athlete ID from results.swimming.ca     |
| Date invited     | When you sent the message                         |
| Install date     | First magic-link sign-in (`User.createdAt`)       |
| Last-active date | Latest `Session.lastUsedAt` across their sessions |
| Issues reported  | Free-form notes, dated                            |
| Notes            | Anything else — relationship, follow-up, etc.     |

Sensitive personal data — adult contacts paired with minor athlete IDs.
**Do not commit to the repo.** Private Google Sheet (no link sharing) or
1Password encrypted notes. See section 5.

## 3. 4-week success criterion

Spec §1: 10–20 hand-recruited swim parents install, onboard, and open the
app at least once a week for four consecutive weeks.

Measure with Postgres — `Session.lastUsedAt` is touched on every authed
request, so it's the cleanest weekly-active signal:

```sql
-- Distinct weekly-active users for the last 8 weeks.
-- Run from the API host or via psql tunnel into the Mac Mini.
SELECT
  date_trunc('week', "lastUsedAt") AS week,
  COUNT(DISTINCT "userId")          AS weekly_active_users
FROM "Session"
WHERE "lastUsedAt" >= NOW() - INTERVAL '8 weeks'
  AND "revokedAt" IS NULL
GROUP BY 1
ORDER BY 1 DESC;
```

Bar met when at least 10 distinct `userId` values appear in each of four
consecutive weekly buckets. Cross-reference the spreadsheet to confirm the
same humans are returning, not a churning population.

## 4. Post-beta retro

Week 4 (or 5 if mid-meet), ask each tester 5–7 questions. Prefer a
10-minute call over a survey — side comments are where the signal lives.
If a call won't happen, send as text:

1. What did you use the app for most? (Checking PBs? Looking up a recent
   meet? Just curious?)
2. What was confusing the first time you opened it?
3. What's missing that would make you recommend it to another parent?
4. How often did you check the app outside of meet days?
5. What would you pay for, if anything? (Trying to find the wedge —
   "nothing" is a useful answer.)
6. Anything broken or weird you didn't bother to report?
7. Mind if I follow up in a few months when v2 has <feature they asked for>?

Capture in `docs/beta-retro.md` (post-MVP input). Recurring themes become
Plan 7 headline tasks.

## 5. Privacy note for the founder

The sheet pairs parent emails with minor athletes' SNC IDs — personal
information about minors under PIPEDA. Keep it boring:

- Store in a 2FA-protected Google account (ideally the one that owns
  `flipturn.app`). No link sharing — explicit per-user access only, and
  only you should have access.
- Never paste contents into Slack, email, or any chat tool.
- If a parent asks to be deleted, hit `DELETE /me` for their account and
  remove their row the same day.
- Per spec §10.3 / §10.4: if the beta ends and a parent doesn't convert
  to a paid user, delete their row within 90 days of beta end. Postgres
  follows its own retention rules; this sheet needs its own purge.
- Annual calendar reminder: re-check the sheet is still locked down and
  only contains relevant rows.
