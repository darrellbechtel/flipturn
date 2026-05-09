# Fixtures

## mssac-hicken-2026.zip

- **Source URL:** https://www.gomotionapp.com/onmac/UserFiles/Image/QuickUpload/meet-results-2026-dr-ralph-hicken-invitational-30apr2026-001_008479.zip
- **Meet:** 2026 Dr. Ralph Hicken Invitational
- **Host:** MSSAC (Mississauga Aquatic Club)
- **Date:** 2026-04-30 through 2026-05-03 (per `B1` record in `.hy3`)
- **Venue:** Etobicoke Olympium Pool (50 m, LCM)
- **Fetched:** 2026-05-08
- **Size:** 563 251 bytes (`.zip`); unpacks to two files:
  - `Meet Results-2026 Dr Ralph Hicken Invitational-30Apr2026-001.hy3` — 2 047 848 bytes (HY-TEK proprietary internal format)
  - `Meet Results-2026 Dr Ralph Hicken Invitational-30Apr2026-001.cl2` — 1 555 200 bytes (SDIF/USS standard interchange format)
- **SHA-256 (zip):** `61789925579b6fd1293d5f145200f886cc2e9c70cfbfb910c750cf55e5ebe5f1`
- **License/posture:** publicly published by host club (MSSAC) on its hosted-meets page; no auth, no paywall, no robots block. Used as the canonical end-to-end fixture for the Phase-4 preview slice.

### Why this fixture

Per `docs/superpowers/specs/2026-05-08-03-data-substrate-transition.md` §16, MSSAC was the only club out of a 20-club Ontario survey that publishes complete Hy-Tek zips (`.hy3` + `.cl2`) openly with no auth. This zip is therefore the only no-outreach end-to-end test of the SDIF parser slice.

### Fallback URLs

If the canonical URL above ever 404s, alternates to try (in order):

1. The MSSAC hosted-meets index page: <https://www.gomotionapp.com/team/onmac/page/hosted-meets> — find the "2026 Dr. Ralph Hicken Invitational" entry and grab the current zip URL.
2. The MSSAC main team page: <https://www.gomotionapp.com/team/onmac/page/home> — has a "Meet Results" link.
3. Email mssac directly only as last resort. The zip itself is small (~563 KB); committing it to the repo guarantees test reproducibility even if upstream rotates.

### Reproducibility

The committed `mssac-hicken-2026.zip` is the byte-for-byte file fetched on 2026-05-08 with `User-Agent: FlipTurnBot/0.1 (+https://flipturn.ca/bot)`. To re-verify:

```bash
shasum -a 256 packages/sdif-parser/tests/__fixtures__/mssac-hicken-2026.zip
# expect: 61789925579b6fd1293d5f145200f886cc2e9c70cfbfb910c750cf55e5ebe5f1
```

### What's in the zip

| File | Format | Lines | Purpose |
| ---- | ------ | ----- | ------- |
| `*.hy3` | HY-TEK proprietary internal "Meet Manager → Team Manager" dump | 15 514 | Richer record set; what our parser primarily targets. CRLF line endings, every line padded to 130 chars. |
| `*.cl2` | SDIF / USS standard interchange (CL2 = "Commlink 2") | 9 600 | Public standard format. Useful as a sanity-check secondary source; not parsed in the v1 slice. |

Both files are flat fixed-width ASCII (Latin-1 safe), CRLF-terminated. The `.hy3` is what FlipTurn ingests because it preserves session/round structure and DQ flags more cleanly than the `.cl2`; see `docs/sdif-format-notes.md` for column layouts.
