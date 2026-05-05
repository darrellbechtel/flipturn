# Fixtures

Captured samples from Swimming Canada (`www.swimming.ca` and `results.swimming.ca`)
for testing the parser (Plan 3). See [`docs/adr/0002-snc-data-source.md`](../../../docs/adr/0002-snc-data-source.md)
for the full spike findings.

| File                             | Source URL                                                      | Captured   | Notes                                                                                           |
| -------------------------------- | --------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| snc-athlete-sample.html          | https://www.swimming.ca/swimmer/4030816/                        | 2026-05-04 | Ryan Cochrane (3-time Olympian, retired 2016). Public, retired athlete. SNC swimmer ID 4030816. |
| snc-athlete-sample.expected.json | (hand-extracted)                                                | —          | Golden parser output: 10 representative swims across all four strokes + IM, both LCM and SCM.   |
| snc-meet-sample.html             | https://results.swimming.ca/2026_Speedo_Canadian_Swimming_Open/ | 2026-05-04 | 2026 Speedo Canadian Swimming Open, Edmonton AB. Static SPLASH Meet Manager 11 HTML index page. |
| snc-meet-sample.expected.json    | (hand-extracted)                                                | —          | Golden parser output: meet header + 16 representative events (subset of full event list).       |

## Re-capture policy

Re-capture only when the source's HTML structure changes (low frequency — both
WordPress and SPLASH templates are relatively stable). When re-capturing, use
the `FlipTurnBot/0.1` user agent and respect the politeness defaults in
[`docs/adr/0002-snc-data-source.md`](../../../docs/adr/0002-snc-data-source.md).

**Do NOT capture beta-user data here.** Fixtures must be public, non-sensitive,
and ideally feature retired Olympians (long career, low risk of takedown).

## Hand-extraction notes / uncertainty

- **Athlete gender**: Ryan Cochrane's gender is not explicitly rendered on the
  `/swimmer/<id>/` HTML page. The expected JSON marks him as `"M"` based on
  publicly known biography. The parser will need a separate signal (the
  underlying SwimRankings API exposes gender; it could also be inferred from
  meet event genders the athlete competed in).
- **Round**: the swimmer page only shows personal-best rows (one per
  event/course). SPLASH and SNC label these without round metadata, so the
  expected JSON marks all athlete swims as `"TIMED_FINAL"`. Real `meetExternalId`
  links are sometimes blank in the HTML when the meet record is missing on
  SwimRankings; those rows have `"meetName": null` and `"meetExternalId": null`.
- **`status: "RELAY"`** in the SNC table indicates a split from a relay leg
  rather than a stand-alone official race. The expected JSON preserves the
  underlying time but tags the row appropriately.
- **Time encoding**: `centiseconds = minutes*6000 + seconds*100 + cs`. e.g.
  `1:47.60` → `10760`; `25.15` → `2515`; `14:39.63` → `87963`.
- **Meet date**: the SPLASH header renders dates as `"9- - 11-4-2026"`
  (day-day-month-year, with the trailing day field stripped of leading zeroes
  and an inner `-` separator). The parser will need to normalize this. The
  expected JSON uses ISO 8601 `2026-04-09` to `2026-04-11`.
- **Meet location**: SPLASH shows only `"Edmonton  (CAN)"` with no province.
  The expected JSON assumes `"Edmonton, AB, CAN"` based on public knowledge of
  the Kinsmen Sports Centre venue.
- **Meet event list**: the meet-index HTML lists every event row including
  prelims, semis, finals, and time trials. The expected JSON includes 16
  representative events spanning all strokes (free, back, breast, fly, IM)
  plus both genders, plus both prelim and final rounds — not the exhaustive
  full list (60+ events).

## Stroke / course conventions used in expected JSON

- Stroke codes: `FR` (Freestyle), `BK` (Backstroke), `BR` (Breaststroke),
  `FL` (Butterfly), `IM` (Individual Medley).
- Course codes: `LCM` (Long Course Metres, 50m), `SCM` (Short Course Metres,
  25m), `SCY` (Short Course Yards — not seen on SNC, included for spec
  completeness).
- Round codes: `PRELIM`, `FINAL`, `TIMED_FINAL`. The SPLASH `"Time Trial"`
  round in the source HTML maps to `TIMED_FINAL` for our parser purposes.
