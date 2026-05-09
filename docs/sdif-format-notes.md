# `.hy3` / SDIF format notes

> Reverse-engineered from the MSSAC 2026 Dr. Ralph Hicken Invitational fixture
> (`packages/sdif-parser/tests/__fixtures__/mssac-hicken-2026.zip`).
> No authoritative public spec exists for HY-TEK's `.hy3` internal format;
> community references (`hytek_parser`, USS interchange docs) disagree on
> column ranges and field meanings. **This file is the source of truth for
> what _our parser_ (`packages/sdif-parser`) expects.** When subsequent tasks
> implement A1/B1/C1/D1/E1 parsers they slice columns according to this doc;
> when reality and this doc disagree, this doc must be updated *and* the
> parser tests re-run, not the other way around.

## Two files in the zip — only the `.hy3` is parsed

The MSSAC zip contains two files. They carry overlapping data but use *different* record-code conventions:

| File | Format | Record codes used |
| ---- | ------ | ----------------- |
| `*.hy3` | HY-TEK internal "Meet Manager → Team Manager" dump | A1, B1, B2, C1, C2, C3, D1, E1, E2, F1, F2, F3, G1 |
| `*.cl2` | SDIF / USS standard "Commlink 2" interchange | A0, B1, C1, D0, D3, E0, F0, G0, Z0 |

Public docs that say things like "athletes are D0 records" describe the **`.cl2`** standard. They are *wrong* for `.hy3`. We parse the `.hy3` because it preserves prelim-vs-final round structure, DQ flags, and per-swim metadata more cleanly. The `.cl2` is kept in the fixture for reference but is not parsed in the v1 slice.

## Line format

- ASCII (Latin-1 safe), CRLF line endings.
- Every line is padded with spaces to a fixed width — **130 characters** in the MSSAC fixture.
- Every line ends in a 2-digit ASCII checksum at columns 129-130 (`l[128:130]`). We **don't validate** the checksum in v1 (the `.hy3`'s is a custom, non-standard polynomial; revisiting if we ever encounter corruption in real ingest).
- Columns are documented 1-indexed (so cols 1-2 = the record code).
- Slicing convention: cols *a*-*b* (inclusive, 1-indexed) maps to `line.slice(a-1, b)` in JS / `line[a-1:b]` in Python. Width = `b - a + 1`.

## Record codes present in the `.hy3` fixture

`awk '{print substr($0,1,2)}' *.hy3 | sort | uniq -c | sort -rn`:

| Code | Count | Meaning                                                     | Parser file (this slice) |
| ---- | ----- | ----------------------------------------------------------- | ------------------------ |
| `E1` | 5 646 | Individual swim — entry + finals time + DQ flag             | `swim.ts`                |
| `E2` | 5 646 | Individual swim — prelim time, splits-summary, swim date, status (DQ/Scratch/etc) | `swim.ts` (joins to E1) |
| `G1` | 2 961 | Split-detail (one line per swim that has interval splits)   | _ignored in this slice_  |
| `D1` |   748 | Athlete                                                     | `athlete.ts`             |
| `F1` |   163 | Relay entry                                                 | _ignored in this slice_  |
| `F2` |   163 | Relay swim time                                             | _ignored in this slice_  |
| `F3` |   163 | Relay roster (4 athlete IDs)                                | _ignored in this slice_  |
| `C1` |    10 | Team / club — code + full name                              | `team.ts`                |
| `C2` |    10 | Team / club — postal address                                | `team.ts` (same logical team) |
| `C3` |     1 | Team contact (phone, email)                                 | _ignored in this slice_  |
| `B1` |     1 | Meet info — name, venue, dates                              | `meet.ts`                |
| `B2` |     1 | Meet info — class/course/qualification                      | _ignored in this slice; folded into B1 if needed_ |
| `A1` |     1 | File header — software version, generation timestamp, host  | `header.ts`              |

**There is no `Z0` footer in the `.hy3`.** (`Z0` exists in the `.cl2` standard format.) The parser must therefore tolerate EOF-as-end-of-records; do not assert a trailing terminator record.

The plan's task headers assumed the standard SDIF (CL2) codes A1/B1/C1/D1/E1 and a Z0 footer. The first three of those (`A1`, `B1`, `C1`) happen to coincide with the HY-TEK `.hy3` codes here by chance, but `D1`/`E1` mean something quite different in `.hy3` than in the SDIF spec, and the rest of the `.hy3` codes (`B2`, `C2`, `C3`, `E2`, `F1`-`F3`, `G1`) have no SDIF analog. **Treat this file's record codes — not the plan's — as ground truth.**

---

## A1 — file header (1 record in fixture)

Example:
```
A107Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     05032026  8:28 PMEtobicoke Swim Club                                  05
```

Column ruler (cols 1, 11, 21, …, 121, 130):
```
0         1         2         3         4         5         6         7         8         9         0         1         2  3
1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
A107Results From MM to TM    Hy-Tek, Ltd    MM5 7.0Gb     05032026  8:28 PMEtobicoke Swim Club                                  05
```

| Cols   | Width | Field                  | Example                       | Notes |
| ------ | ----- | ---------------------- | ----------------------------- | ----- |
| 1-2    | 2     | Record code            | `A1`                          | |
| 3-4    | 2     | Org / file-type code   | `07`                          | HY-TEK internal flag; not used by parser. |
| 5-29   | 25    | File description       | `Results From MM to TM    `   | Free text, padded right with spaces. |
| 30-44  | 15    | Software vendor        | `Hy-Tek, Ltd    `             | |
| 45-58  | 14    | Software product / version | `MM5 7.0Gb     `          | "MM5 7.0Gb" = Meet Manager 5, build 7.0Gb. |
| 59-66  | 8     | File-creation date     | `05032026`                    | `MMDDYYYY`. |
| 67-75  | 9     | File-creation time     | `  8:28 PM`                   | Right-aligned, AM/PM suffix (the trailing `M` lives at col 75; the field is 9 chars wide, not 8). |
| 76-128 | 53    | Host / file owner name | `Etobicoke Swim Club` (padded) | Free text. May include the meet host club. |
| 129-130 | 2    | Checksum               | `05`                          | 2-digit; not validated. |

**Parser MUST extract:** software-version string (cols 30-58 trimmed) and file-creation date (cols 59-66 → ISO date). Other fields are nice-to-have metadata and may be exposed as `unknown` typed fields.

---

## B1 — meet info (1 record in fixture)

Example:
```
B12026 Dr. Ralph Hicken Invitational           Etobicoke Olympium Pool                      043020260503202604302026   0        47
```

| Cols    | Width | Field                | Example                                  | Notes |
| ------- | ----- | -------------------- | ---------------------------------------- | ----- |
| 1-2     | 2     | Record code          | `B1`                                     | |
| 3-47    | 45    | Meet name            | `2026 Dr. Ralph Hicken Invitational    ` | Padded right with spaces. |
| 48-92   | 45    | Facility / venue     | `Etobicoke Olympium Pool              `  | Padded right. |
| 93-100  | 8     | Meet **start** date  | `04302026`                               | `MMDDYYYY`. |
| 101-108 | 8     | Meet **end** date    | `05032026`                               | `MMDDYYYY`. |
| 109-116 | 8     | Meet **age-up** date | `04302026`                               | `MMDDYYYY`. The reference date for age-group calculation; usually equals start date. |
| 117-128 | 12    | Misc                 | `   0        `                           | Altitude, pool length code, sanction. Not used by v1 parser. |
| 129-130 | 2     | Checksum             | `47`                                     | |

**Parser MUST extract:** name (3-47 trimmed), venue (48-92 trimmed), start date (93-100 → ISO), end date (101-108 → ISO).

The accompanying `B2` record (1 in the fixture) carries class/course/qualification flags (`060101L1 15.00`-style codes at cols 93-106). It is *not parsed in this slice*; if Phase-4 needs course-of-meet, derive it from the `E1.course` field (col 51) of any swim instead.

---

## C1 — team / club, identification (10 records in fixture)

Examples:
```
C1BAD  Burlington Aquatic Devilrays                                                                                   0  0      04
C1ESWIMEtobicoke Swim Club                                                                                            0  0      30
C1MSSACMississauga Aquatic Club                                                                                       0  0      03
```

| Cols    | Width | Field        | Example                          | Notes |
| ------- | ----- | ------------ | -------------------------------- | ----- |
| 1-2     | 2     | Record code  | `C1`                             | |
| 3-7     | 5     | Team code    | `MSSAC`, `BAD  `, `ESWIM`        | HY-TEK club abbreviation; left-aligned, padded right with spaces. Unique within file. |
| 8-37    | 30    | Team name    | `Mississauga Aquatic Club     `  | Free text, padded right. |
| 38-118  | 81    | Misc / blank | mostly spaces                    | Swimmer counts, division flags. Not used by v1. |
| 119-122 | 4     | Athlete counts | `0  0`                         | "F count" + "M count" (4-char field, right-aligned). Currently always 0 in this file (HY-TEK doesn't populate). |
| 129-130 | 2     | Checksum     | `04`                             | |

**Parser MUST extract:** team code (3-7 trimmed) and team name (8-37 trimmed).

A `C2` record (with the address) and optionally a `C3` record (with the contact phone/email) immediately follow each `C1`. The parser may either:
- Emit a single `Team` record per `C1` and silently swallow the next `C2`/`C3`, or
- Emit a multi-line `team` aggregate that joins `C1` + `C2` + (optional) `C3`.

The plan's `team.ts` should choose the second approach so address fields are available downstream without a second pass.

---

## C2 — team / club, postal address (10 records in fixture)

Examples:
```
C25151 New Street                                             Burlington                    ONL7L 1V3                           62
C2RAMAC Aquatic Club            69 Raymore drive              Etobicoke                       M9P1W8    CAN                     99
```

| Cols    | Width | Field           | Example                            | Notes |
| ------- | ----- | --------------- | ---------------------------------- | ----- |
| 1-2     | 2     | Record code     | `C2`                               | |
| 3-32    | 30    | Address line 1  | `5151 New Street              `    | Sometimes the team name is repeated here (RAMAC); usually it's the street address. Treat as free text. |
| 33-62   | 30    | Address line 2  | (blank, or `69 Raymore drive`)     | Optional. |
| 63-92   | 30    | City            | `Burlington                  `     | Free text. May contain the province name on rows where the address-line-2 swallowed the street (RAMAC pattern). |
| 93-94   | 2     | State / Prov    | `ON`, `NF`, `  `                   | 2-letter ISO-style; may be blank. |
| 95-104  | 10    | Postal / ZIP    | `L7L 1V3   `, `M9P1W8    `         | Free text; preserve casing and internal spaces. |
| 105-114 | 10    | Country         | `CAN       `                       | 3-letter ISO 3166 alpha-3. May be blank if domestic. |
| 115-128 | 14    | Misc            | mostly blank                       | |
| 129-130 | 2     | Checksum        | `62`                               | |

**Parser MAY extract:** city, state, country. None of these are required for the v1 ingest (we only need team code + team name → a `Team`/`Club` row).

---

## C3 — team contact (1 record in fixture, optional)

Example:
```
C3                              (647)8870612                                                roman@ramac.ca                      08
```

Carries phone (cols 33-) and email (cols 77-) for the head coach / registrar. **Ignored in v1.** Document only because it appears in the fixture and the parser must skip past it.

---

## D1 — athlete (748 records in fixture)

Examples (5):
```
D1F51553Bailey              Sophie                                   140224737      310509242015 10     0       CAN         N   21
D1M51516Belbin              Noah                                     129189639      306801302010 16     0       CAN         N   10
D1F51539Chow                Fernanda                              L131025787      309104132016 10     0       CAN         N   41
D1F51551Davidov             Michal              Michal              N129220123      310309272010 15     0       CAN         N   64
D1M51550Damecour            Aleksander                              P131012034      310206182010 15     0       CAN         N   44
```

Column ruler:
```
0         1         2         3         4         5         6         7         8         9         0         1         2  3
1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
D1F51553Bailey              Sophie                                   140224737      310509242015 10     0       CAN         N   21
D1F51551Davidov             Michal              Michal              N129220123      310309272010 15     0       CAN         N   64
```

| Cols    | Width | Field                 | Example      | Notes |
| ------- | ----- | --------------------- | ------------ | ----- |
| 1-2     | 2     | Record code           | `D1`         | |
| 3       | 1     | Gender                | `F` / `M`    | Single character. Always `F` or `M` in the fixture (no `X`). |
| 4-8     | 5     | Internal athlete ID   | `51553`      | HY-TEK Meet Manager's local athlete primary key. **Use this** to join D1 ↔ E1/E2 (which carry it at cols 4-8). Not the SNC reg id. |
| 9-28    | 20    | **Last name**         | `Bailey              `, `Williams-Browne     `, `Van Mieghem         ` | Padded right with spaces. May contain spaces (`Van Mieghem`) and hyphens (`Williams-Browne`). Trim trailing spaces. |
| 29-48   | 20    | **First name**        | `Sophie              `, `Aleksander          ` | Padded right. |
| 49-68   | 20    | **Middle name**       | `Michal              ` (Davidov) or all-blank | Padded right; trim and treat empty string as null. |
| 69      | 1     | Citizenship-status indicator | ` ` / `L` / `N` / `P` / `E` / `H` / `G` / `C` | HY-TEK status (Canadian-citizen / landed-immigrant / etc). Not used by v1 parser. |
| 70-78   | 9     | Registration ID       | `140224737`, `129189639` | Swim Canada (SNC) athlete id. 9 digits. **Persist this** — it's the cross-meet stable identity. |
| 79-84   | 6     | _(secondary id / blank)_ | spaces in fixture | |
| 85-88   | 4     | Age key / class       | `3105`, `3068`, `3098` | HY-TEK internal age class. Not used. |
| 89-96   | 8     | **Date of birth**     | `09242015`, `01302010`, `06182010` | `MMDDYYYY`. **Persist this** as ISO date. |
| 97-99   | 3     | Age (years) at meet   | ` 10`, ` 16`, ` 15`, `  9`, `  8` | Right-aligned. Should equal `(meet age-up date) - (DOB)` rounded down. |
| 100-104 | 5     | _(blank / class)_     | spaces                                | |
| 105     | 1     | Status flag           | `0`                                  | Always `0` in fixture. Possibly disability/eligibility. |
| 106-112 | 7     | _(blank)_             | spaces                                | |
| 113-115 | 3     | Country (ISO α-3)     | `CAN`                                 | Always `CAN` in fixture. |
| 116-124 | 9     | _(blank)_             | spaces                                | |
| 125     | 1     | _flag_                | `N`                                   | Always `N` in fixture. |
| 126-128 | 3     | _(blank)_             | spaces                                | |
| 129-130 | 2     | Checksum              | `21`, `64`                            | |

**Parser MUST extract:** gender (col 3), internal athlete id (cols 4-8 trimmed), last name (cols 9-28 trimmed), first name (cols 29-48 trimmed), middle name (cols 49-68 trimmed; treat empty as null), SNC registration id (cols 70-78 trimmed; null if all-spaces), DOB (cols 89-96 → ISO).

⚠️ **There is no separate "middle initial" field.** The fixture uses the full middle-name field (cols 49-68) and leaves it blank for athletes without a middle name. The plan's mention of a "middle initial" field is incorrect for this format. If a single-letter middle is desired, take `middleName.charAt(0)`.

⚠️ **The "first-name initial of last-name" 5-char tag** at E1 cols 9-13 is a *truncation* of the last name to 5 chars — see `E1` section below. It is a join-helper for HY-TEK's internal use, not a separate "preferred-name" field.

---

## E1 — individual swim (5 646 records in fixture)

The `E1` record holds the **principal time** for a swim entry — for swims with both prelim and final, this is the **finals** time; for timed-finals (single-round) swims, this is the only time. The `E2` record that *immediately follows* the same E1 carries the prelim/heat time and the DQ/scratch status flag.

Examples (4):
```
E1M51516BelbiMB    50A 15109  0S 15.00 38B   27.98L   27.98L    0.00    0.00   NN               N                               80
E1F51553BaileFG   100C  0 10  0S 15.00 49A  135.38L  135.38L    0.00    0.00   NN               N                               50
E1F51538ClaydFG   100B  0 10  0S 15.00 79A  110.87L  110.87L    0.00    0.00   NN               N                               70
E1M51293KarpuMB   400A 11 12  0S 20.00 60B  321.74L  321.74L    9.00    0.00   NN               N                               90
```

Column ruler:
```
0         1         2         3         4         5         6         7         8         9         0         1         2  3
1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
E1M51516BelbiMB    50A 15109  0S 15.00 38B   27.98L   27.98L    0.00    0.00   NN               N                               80
E1F51553BaileFG   100C  0 10  0S 15.00 49A  135.38L  135.38L    0.00    0.00   NN               N                               50
```

| Cols    | Width | Field                              | Example       | Notes |
| ------- | ----- | ---------------------------------- | ------------- | ----- |
| 1-2     | 2     | Record code                        | `E1`          | |
| 3       | 1     | Athlete gender                     | `M` / `F`     | |
| 4-8     | 5     | Internal athlete ID                | `51516`       | Joins to `D1` cols 4-8. |
| 9-13    | 5     | Last-name truncation               | `Belbi`, `Baile`, `Karpu` | First 5 chars of last name (a HY-TEK denorm; for our purposes, ignore — the join key is cols 4-8). |
| 14      | 1     | Athlete gender (repeat)            | `M` / `F`     | Same as col 3 in every row. Ignore. |
| 15      | 1     | Boys/Girls indicator               | `B` (Boys) / `G` (Girls) | HY-TEK age-group nomenclature. Same value as col 14 derived. Ignore. |
| 16-21   | 6     | **Distance**                       | `    50`, `   100`, `   200`, `   400`, `   800`, `  1500` | Right-aligned integer in pool-length units (meters or yards per col 51). Both `  50` and `1500` fit; safest to extract via `Number(line.slice(15,21))`. |
| 22      | 1     | **Stroke code**                    | `A`, `B`, `C`, `D`, `E` | HY-TEK letters: **A = Free**, **B = Back**, **C = Breast**, **D = Fly**, **E = IM**. Verified by cross-referencing `.cl2` event codes (where `1=FR`, `2=BK`, `3=BR`, `4=FL`, `5=IM`). |
| 23-25   | 3     | Age-group lower bound              | `  0`, ` 11`, ` 13`, ` 15` | "0" = open (no lower bound). |
| 26-28   | 3     | Age-group upper bound              | ` 10`, ` 12`, ` 14`, `109` | "109" sentinel = unlimited / open upper. |
| 29-31   | 3     | _(unknown — always `  0`)_         | `  0`         | |
| 32      | 1     | **Entry-time course**              | `S` (typical), `A` (sometimes for no-time / DNS) | Course of the entry/seed time; for our parser, the meaningful course is at col 51 (the swum time's course). |
| 33-38   | 6     | Entry / seed time                  | ` 15.00`, ` 20.00`, `  0.00` | `mmss.hh` packed; `15.00` is the HY-TEK "no-time" placeholder for short events; `0.00` for scratched. Not used by v1. |
| 39-41   | 3     | Entry-rank / seed                  | ` 49`, ` 38`, `801` | Right-aligned int. `8xx` indicates "no time / unseeded". Not used by v1. |
| 42      | 1     | Heat letter / session code         | `A`, `B`, `C`, `S` | HY-TEK session/heat label. Not used by v1. |
| 43-50   | 8     | **Final time** (or only-time)      | `   27.98`, `  135.38`, `  321.74` | `ssss.hh` for swims under 100s, `mmss.hh` for swims over 100s — actually it's ALL `ssss.hh` (total seconds, hundredths). E.g. `135.38` = 2:15.38 = 135.38 s. **Always parse as a float total-seconds.** `0.00` → no-swim / DNS / DQ-no-time. |
| 51      | 1     | **Course of final time**           | `L` (LCM), `S` (SCM), `Y` (SCY), or blank | When the final-time is `0.00` (DNS / no-time), the course flag may be blank or `L`; treat the `0.00` value itself as the null sentinel rather than the course flag. |
| 52-59   | 8     | "Best time" duplicate              | `   27.98`, `  135.38` | In timed-finals (single round) swims, equals cols 43-50. In prelim-and-final swims, also equals the final time (cols 43-50). Ignore. |
| 60      | 1     | Course of best-time duplicate      | `L` / `S` / `Y` | Ignore. |
| 61-68   | 8     | Standard-time / qualifying delta   | `    0.00`, `    9.00`, `   13.00` | Seconds under/over the qualifying time. Not used by v1. |
| 69-76   | 8     | _(secondary qualifying delta)_     | `    0.00`    | |
| 77-79   | 3     | _(blank)_                          | `   `         | |
| 80      | 1     | Result-status flag (E1)            | `N`           | Always `N` in fixture; possibly "non-conforming" or "normal". |
| 81      | 1     | Power-points flag                  | `N`           | |
| 82-95   | 14    | _(blank)_                          | spaces        | |
| 96      | 1     | E1 round-of-time                   | ` ` / `T` / `S` | ` ` = swam in finals, `T` = time-trial, `S` = swim-off. 51 `T`s and 5 `S`s in fixture; rest blank. |
| 97      | 1     | _(misc flag)_                      | `N`           | |
| 98-128  | 31    | _(blank)_                          | spaces        | |
| 129-130 | 2     | Checksum                           | `80`, `50`    | |

**Parser MUST extract:** athlete-id link (cols 4-8), distance (cols 16-21 → int), stroke (col 22 → enum), age-group lo/hi (cols 23-28), final time (cols 43-50 → float seconds; null if 0.00), course (col 51).

**Parser MUST resolve DQ status by reading the immediately-following E2 record's col 13** (see E2 section below).

### Time encoding

All time fields are flat **seconds with hundredths**, right-aligned in their slot. There is **no `mmss.hh` packing**. Examples:

| Raw                | As seconds | Conventional |
| ------------------ | ---------- | ------------ |
| `   27.98`         | 27.98      | `0:27.98`    |
| `  135.38`         | 135.38     | `2:15.38`    |
| `  321.74`         | 321.74     | `5:21.74`    |
| `    0.00`         | 0.00       | _no swim_    |

Convert to display by `Math.floor(s/60)`:`(s%60).toFixed(2)`.

### Distance × stroke → event code

| HY-TEK letter | Stroke         | SDIF (`.cl2`) digit |
| ------------- | -------------- | ------------------- |
| `A`           | Freestyle      | `1`                 |
| `B`           | Backstroke     | `2`                 |
| `C`           | Breaststroke   | `3`                 |
| `D`           | Butterfly      | `4`                 |
| `E`           | Individual Medley | `5`              |

Distances seen in fixture: 50, 100, 200, 400, 800, 1500. Always integer; meters because col 51 = `L` (LCM).

---

## E2 — individual swim, supplementary (5 646 records — exactly 1 per E1)

Holds the **prelim/heat time**, **status flag** (DQ / scratch / etc.), the swim **date**, and a compact splits summary. Always immediately follows its corresponding E1 row.

Examples:
```
E2P   28.41L       0 12  6  5  72  0   28.44   28.38    0.00        28.41     0.00     05022026    0                            76
E2F  116.86LQ      0  5  6  0   0  0  116.85  116.87    0.00       116.86     0.00 0.4005032026                           0     47
E2F    0.00LR      0  2  7  0   0  0    0.00    0.00    0.00         0.00     0.00     05022026                           0     45
```

Column ruler (cols 1, 11, 21, …, 121, 130):
```
0         1         2         3         4         5         6         7         8         9         0         1         2  3
1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
E2P   28.41L       0 12  6  5  72  0   28.44   28.38    0.00        28.41     0.00     05022026    0                            76
E2F  116.86LQ      0  5  6  0   0  0  116.85  116.87    0.00       116.86     0.00 0.4005032026                           0     47
```

| Cols    | Width | Field                       | Example                      | Notes |
| ------- | ----- | --------------------------- | ---------------------------- | ----- |
| 1-2     | 2     | Record code                 | `E2`                         | |
| 3       | 1     | Round of *this* swim        | `F` (Final / timed-final), `P` (Prelim) | When the parent E1 has a finals time, the E2's `P` carries the prelim. When the swim is single-round (timed-finals), the E2's `F` carries a duplicate of the E1's only time **with status flag in col 13**. |
| 4-11    | 8     | Time of this round          | `   28.41`, `  116.86`, `    0.00` | Seconds. `0.00` when col 13 indicates the swim wasn't actually swum (R/S markers). |
| 12      | 1     | Course of this time         | `L`                          | Always `L` in this fixture. |
| 13      | 1     | **Status flag**             | ` ` (5 152), `R` (316), `S` (125), **`Q` = DQ (53)** | **`Q` = disqualified.** Other markers in fixture: `R` = "no second round" (the row's E1 is the only swim and this E2 is a placeholder); `S` = "scratched". For v1 the parser only branches on `Q`. |
| 14-65   | 52    | _(packed heat / lane / place / splits block — see note below)_ | `      0 12  6  5  72  0   28.44   28.38    0.00     ` | Holds heat number, lane, place-in-heat, overall place, and partial-split times. Layout to be reverse-engineered in a later slice; **not parsed in v1.** |
| 66-73   | 8     | _(blank or reaction-time)_  | `     0.00` / ` 0.4005`      | Sometimes has reaction time (`0.40`); sometimes blank. |
| 74-87   | 14    | _(varies)_                  |                              | |
| 88-95   | 8     | **Swim date**               | `05022026`, `05012026`, `05032026`, `04302026` | `MMDDYYYY` of the day this round was swum. **Parser MUST extract** to attribute swims to specific days within the meet. |
| 96-128  | 33    | _(misc / blank)_            |                              | |
| 129-130 | 2     | Checksum                    | `76`, `47`                   | |

**Parser MUST extract:** round (col 3), prelim time (cols 4-11 → float; null if 0.00), course (col 12), DQ status (col 13 == `'Q'`), swim date (cols 88-95 → ISO).

The mid-line block at cols 14-65 packs heat/lane/place/splits in a layout we have not yet fully reverse-engineered against the fixture (preliminary inspection suggests heat ~22-23, lane ~25-26, place-in-heat ~28-29, final place ~31-33, with partial-split times in the trailing region — but ranges have not been verified across enough lines to commit to). **For the v1 slice, do NOT parse this block;** the v1 parser doesn't need heat/lane/place, and split data is more reliably read from `G1` records (out of scope for v1). When a later slice needs heat/lane/place, re-derive ranges empirically from the fixture before committing.

---

## What we deliberately do NOT parse in this slice

| Code | Why deferred |
| ---- | ------------ |
| `B2` | Course/class flags. Course is derivable from any swim's `E1.course`. |
| `C3` | Team contact (phone, email). PII; not needed for ingest. |
| `F1`, `F2`, `F3` | Relay records. Relay teams + relay swimmers + 4-athlete roster respectively. The data model for relays is meaningfully different (composite athletes, leg splits) and out of scope for the Phase-4 preview. The parser MUST skip these without erroring. |
| `G1` | Per-50 split detail. Split storage is not yet schema-defined in `packages/db/prisma/schema.prisma`; defer to a later slice that adds a `Split` model. The parser MUST skip these without erroring. |
| (`Z0` footer) | Does not appear in `.hy3`; nothing to do. |

The `parse()` assembler in Task 9 should classify any line whose first two chars are not in `{A1, B1, C1, C2, D1, E1, E2}` as "unhandled" and drop it silently — *not* raise. The fixture would otherwise produce ~3 300 errors per parse for `G1` + `F*` lines alone.

---

## Cross-reference: `.cl2` (SDIF standard) record codes

For sanity-checking the `.hy3` output during early development. **We do NOT parse the `.cl2` in v1.** Counts in this fixture:

```
4834 D0   athlete + per-event swim row (one D0 per swim, not per athlete)
3194 G0   split detail
 748 D3   athlete-detail extension (one per unique athlete)
 648 F0   relay detail
 163 E0   relay event
  10 C1   team
   1 Z0   file footer
   1 B1   meet
   1 A0   file header
```

If our `.hy3` parser ever produces obviously-wrong totals (e.g., 1 000 athletes from 748 `D1`s), the `.cl2` `D3` count (748 unique athletes) is the cross-check.

---

## Open questions / TBD

These are flagged for future slices, **not** blockers for v1:

- **Splits storage.** `G1` records carry per-50 splits ("F 2 50.00 F 4 100.00" pattern). When we add a `Split` model in `packages/db/prisma/schema.prisma`, a follow-up slice can teach the parser to emit `G1`s.
- **Relays.** `F1`/`F2`/`F3` carry relay team + relay swim + 4-leg roster. Whole separate slice.
- **Power-points / standard-time deltas.** `E1` cols 61-68 carry qualifying-time deltas; could feed a "how close to provincials cut" feature later.
- **Time-trial vs swim-off rounds.** `E1` col 96 marks `T` (time trial) and `S` (swim-off). For v1 we treat both as "results-eligible swims"; if an analytics slice ever needs to filter them, the column is documented above.
- **Scratch / DNS encoding.** `E2` col 13 markers `R` and `S` (316 + 125 occurrences) are not unambiguously documented above. They appear correlated with 0.00 times, and we treat them as "not-a-swim" in v1 by virtue of `final_time === null`. If a precise distinction becomes required, re-inspect the fixture.

---

## Edge cases not present in this fixture

The MSSAC fixture is the only `.hy3` we have right now, so some fields that are *always* populated here may be missing/blank/zero in `.hy3` files from other clubs or other meet-management workflows. The parser should defensively handle these even though we can't unit-test them yet — when we eventually receive a non-MSSAC file, the test suite should be extended with a fixture that exercises each.

- **D1 date-of-birth (cols 89-96)** — populated for all 748/748 athletes in this fixture. Some meets may carry all-zero (`00000000`) DOBs for athletes whose birth-year is unknown or who have privacy-suppressed birthdates. **Parser SHOULD treat `00000000` as null DOB** (not as the year 0000). Likewise an all-blank slot.
- **D1 SNC registration id (cols 70-78)** — populated for all 748/748 athletes here. Other meets may carry blanks (e.g. visiting non-Swim-Canada athletes or guest swimmers). The "must extract" line above already says "null if all-spaces" — this remains correct; the call-out here is that we have *no fixture coverage* of that path, so the parser must not assume the field is always non-empty.
- **Athletes with zero swims.** All 748 D1s in this fixture have at least one E1. Other files may include entered-but-scratched athletes with no E1/E2 lines. The parser MUST NOT assume every D1 has a corresponding swim (don't crash on join, don't drop the athlete).
- **Middle name (D1 cols 49-68)** — empty for most, populated for some — already documented at the D1 section. Parser should treat trimmed-empty as null (already covered).
- **E2 status flag (col 13).** Fixture exhibits ` `, `R`, `S`, `Q`. Other meets could plausibly emit additional codes (e.g. `F` for "fouled start", `D` for "did not finish") that we don't have examples of. **Parser SHOULD branch only on `Q` (DQ)** and treat any other non-blank flag as "not-a-swim with unknown reason" rather than failing.
- **Course flag (E1 col 51, E2 col 12).** Fixture is uniformly `L` (LCM). A short-course meet would emit `S` or `Y`. Parser must accept all three (and blank, when paired with `0.00`).
