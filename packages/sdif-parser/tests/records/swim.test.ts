import { describe, it, expect } from 'vitest';
import { parseSwim } from '../../src/records/swim.js';

/**
 * E1 + E2 bodies below are real lines from the MSSAC 2026 Dr. Ralph Hicken
 * Invitational fixture (`tests/__fixtures__/mssac-hicken-2026.zip`), with the
 * leading 2-char record code (`E1` / `E2`) stripped (and the trailing CRLF
 * removed) — i.e. the same `body` shape produced by `tokenize()`.
 *
 * Per docs/sdif-format-notes.md (E1 + E2 sections) the relevant fields:
 *   E1
 *     col 22         → stroke letter      (A=FR, B=BK, C=BR, D=FL, E=IM)
 *     cols 16-21     → distance (right-aligned int, meters when course=L)
 *     cols 43-50     → final/principal time, seconds.hundredths
 *     col 51         → course flag (L/S/Y/blank)
 *   E2
 *     col 3          → round of THIS pair (`F` final/timed-final, `P` prelim)
 *     col 13         → status flag (` `=normal, `Q`=DQ, `R`/`S`=not-a-swim)
 *
 * Cases chosen for diversity:
 *   1. Belbin 50 FR (E2 = P)              → PRELIM, OFFICIAL, time 28.41
 *   2. Damecour 200 BR (E2 = F, blank)    → TIMED_FINAL, OFFICIAL, time 183.72
 *   3. Clayden 100 BK (E2 = F + Q)        → TIMED_FINAL, DQ, time 116.86 from E2
 *   4. Stree 1500 FR (E2 = F)             → TIMED_FINAL, OFFICIAL, big distance
 *   5. Bailey 100 BR (E2 = F + R)         → status NS (per format-notes:
 *                                            R/S markers treated as not-a-swim)
 *   6. Tan 400 IM (E2 = F + Q)            → TIMED_FINAL, DQ, distance=400, IM
 *   7. Belbin 50 FR with E2 omitted       → status defaults to OFFICIAL
 */

// E1M51516BelbiMB    50A 15109  0S 15.00 38B   27.98L   27.98L    0.00    0.00   NN               N                               80
const E1_BELBIN_50FR =
  'M51516BelbiMB    50A 15109  0S 15.00 38B   27.98L   27.98L    0.00    0.00   NN               N                               80';
// E2P   28.41L       0 12  6  5  72  0   28.44   28.38    0.00        28.41     0.00     05022026    0                            76
const E2_BELBIN_50FR =
  'P   28.41L       0 12  6  5  72  0   28.44   28.38    0.00        28.41     0.00     05022026    0                            76';

// E1M51549DamecMB   200C 15109  0S 15.00  6B  186.49L  186.49L    3.00    0.00   NN               N                               90
const E1_DAMECOUR_200BR =
  'M51549DamecMB   200C 15109  0S 15.00  6B  186.49L  186.49L    3.00    0.00   NN               N                               90';
// E2F  183.72L       0  4  1  6  14  0  183.89    0.00    0.00       183.72     0.00     05012026                           0     56
const E2_DAMECOUR_200BR =
  'F  183.72L       0  4  1  6  14  0  183.89    0.00    0.00       183.72     0.00     05012026                           0     56';

// E1F51538ClaydFG   100B  0 10  0S 15.00 79A  110.87L  110.87L    0.00    0.00   NN               N                               70
const E1_CLAYDEN_100BK =
  'F51538ClaydFG   100B  0 10  0S 15.00 79A  110.87L  110.87L    0.00    0.00   NN               N                               70';
// E2F  116.86LQ      0  5  6  0   0  0  116.85  116.87    0.00       116.86     0.00 0.4005032026                           0     47
const E2_CLAYDEN_100BK =
  'F  116.86LQ      0  5  6  0   0  0  116.85  116.87    0.00       116.86     0.00 0.4005032026                           0     47';

// E1F51515StreeFG  1500A 15109  0S 20.00  1B 1161.27L 1161.27L   16.00    0.00   NN               N                               51
const E1_STREE_1500FR =
  'F51515StreeFG  1500A 15109  0S 20.00  1B 1161.27L 1161.27L   16.00    0.00   NN               N                               51';
// E2F 1153.72L       0  1  7  5   3  0 1153.75    0.00 1153.69      1153.72     0.00     04302026                           0     27
const E2_STREE_1500FR =
  'F 1153.72L       0  1  7  5   3  0 1153.75    0.00 1153.69      1153.72     0.00     04302026                           0     27';

// E1F51553BaileFG   100C  0 10  0S 15.00 49A  135.38L  135.38L    0.00    0.00   NN               N                               50
const E1_BAILEY_100BR =
  'F51553BaileFG   100C  0 10  0S 15.00 49A  135.38L  135.38L    0.00    0.00   NN               N                               50';
// E2F    0.00LR      0  2  7  0   0  0    0.00    0.00    0.00         0.00     0.00     05022026                           0     45
const E2_BAILEY_100BR =
  'F    0.00LR      0  2  7  0   0  0    0.00    0.00    0.00         0.00     0.00     05022026                           0     45';

// E1F50388Tan  FG   400E 13 14  0S 20.00 17A  360.94L  360.94L    0.00    0.00   NN               N                               89
const E1_TAN_400IM =
  'F50388Tan  FG   400E 13 14  0S 20.00 17A  360.94L  360.94L    0.00    0.00   NN               N                               89';
// E2F  365.84LQ      0  4  2  0   0  0    0.00  365.93    0.00       365.84     0.00     05012026                           0     66
const E2_TAN_400IM =
  'F  365.84LQ      0  4  2  0   0  0    0.00  365.93    0.00       365.84     0.00     05012026                           0     66';

describe('parseSwim (E1 + E2)', () => {
  it('parses a normal prelim swim (Belbin 50 FR, E2 = P, status blank)', () => {
    const result = parseSwim(E1_BELBIN_50FR, E2_BELBIN_50FR);
    expect(result.distanceM).toBe(50);
    expect(result.stroke).toBe('FR');
    expect(result.round).toBe('PRELIM');
    // E2 round = P → use the E2 prelim time (28.41s = 2841 cs).
    expect(result.timeCentiseconds).toBe(2841);
    expect(result.status).toBe('OFFICIAL');
    expect(result.splits).toEqual([]);
    // place block (E2 cols 14-65) deliberately not parsed in v1.
    expect(result.place).toBeUndefined();
    // The athleteRef field is NOT set by parseSwim — the assembler (Task 9)
    // populates it from the surrounding D1.
    expect((result as { athleteRef?: unknown }).athleteRef).toBeUndefined();
  });

  it('parses a final-or-timed-final swim with no DQ (Damecour 200 BR, E2 = F blank)', () => {
    const result = parseSwim(E1_DAMECOUR_200BR, E2_DAMECOUR_200BR);
    expect(result.distanceM).toBe(200);
    expect(result.stroke).toBe('BR');
    // We can't distinguish FINAL from TIMED_FINAL from a single row in v1;
    // E2 col 3 = F maps to TIMED_FINAL.
    expect(result.round).toBe('TIMED_FINAL');
    // E2 round = F → use the E1 finals time (186.49s).
    // Wait — the E2 `F`-row time (183.72) is the actually-swum final. We use
    // E2's time on F-rows because that's the principal swum-time of THIS pair.
    // (The E1 cols 43-50 also carry a copy in many cases, but the canonical
    // value of THIS pair's swim is E2 cols 4-11.)
    expect(result.timeCentiseconds).toBe(18372);
    expect(result.status).toBe('OFFICIAL');
    expect(result.splits).toEqual([]);
  });

  it('parses a DQ swim (Clayden 100 BK, E2 col 13 = Q)', () => {
    const result = parseSwim(E1_CLAYDEN_100BK, E2_CLAYDEN_100BK);
    expect(result.distanceM).toBe(100);
    expect(result.stroke).toBe('BK');
    expect(result.round).toBe('TIMED_FINAL');
    // Time still extracted (116.86s = 11686 cs); status flag is the DQ marker.
    expect(result.timeCentiseconds).toBe(11686);
    expect(result.status).toBe('DQ');
    expect(result.splits).toEqual([]);
  });

  it('parses a long-distance swim (Stree 1500 FR)', () => {
    const result = parseSwim(E1_STREE_1500FR, E2_STREE_1500FR);
    expect(result.distanceM).toBe(1500);
    expect(result.stroke).toBe('FR');
    expect(result.round).toBe('TIMED_FINAL');
    // 1153.72s = 115372 cs. Verifies that 4-digit distances and >1000s times
    // round-trip correctly through the float→centisecond conversion.
    expect(result.timeCentiseconds).toBe(115372);
    expect(result.status).toBe('OFFICIAL');
  });

  it('parses an R-flag swim as NS (Bailey 100 BR, E2 col 13 = R)', () => {
    // Per docs/sdif-format-notes.md "Open questions" + "Edge cases": R/S flags
    // are not unambiguously documented. Format-notes recommends treating any
    // non-Q non-blank flag as "not-a-swim with unknown reason". We map R → NS.
    const result = parseSwim(E1_BAILEY_100BR, E2_BAILEY_100BR);
    expect(result.distanceM).toBe(100);
    expect(result.stroke).toBe('BR');
    expect(result.status).toBe('NS');
    expect(result.splits).toEqual([]);
  });

  it('parses a 400 IM DQ swim (Tan 400 E, E2 col 13 = Q)', () => {
    // Verifies the IM stroke letter (E → IM) and that distance=400 parses.
    const result = parseSwim(E1_TAN_400IM, E2_TAN_400IM);
    expect(result.distanceM).toBe(400);
    expect(result.stroke).toBe('IM');
    expect(result.status).toBe('DQ');
    // 365.84s = 36584 cs.
    expect(result.timeCentiseconds).toBe(36584);
  });

  it('defaults status to OFFICIAL when E2 is undefined', () => {
    // Defensive default: if the assembler hands us an E1 with no following E2
    // (shouldn't happen in the MSSAC fixture, but other .hy3 files might lack
    // a follow-up E2), the status should be OFFICIAL and the time should
    // come from the E1 finals slot (cols 43-50).
    const result = parseSwim(E1_BELBIN_50FR, undefined);
    expect(result.distanceM).toBe(50);
    expect(result.stroke).toBe('FR');
    expect(result.status).toBe('OFFICIAL');
    // No E2 → fall back to the E1 final time (27.98s = 2798 cs).
    expect(result.timeCentiseconds).toBe(2798);
    // Without an E2 we can't tell what round this was; default to TIMED_FINAL.
    expect(result.round).toBe('TIMED_FINAL');
  });

  it('maps every HY-TEK stroke letter A/B/C/D/E to the canonical FR/BK/BR/FL/IM', () => {
    // Synthetic inputs: take the Belbin 50A E1 body and substitute col 22.
    // (col 22 on full line → body[22-3] = body[19] when the leading "E1" is
    // stripped.)
    const bodies: Array<[string, 'FR' | 'BK' | 'BR' | 'FL' | 'IM']> = [
      ['A', 'FR'],
      ['B', 'BK'],
      ['C', 'BR'],
      ['D', 'FL'],
      ['E', 'IM'],
    ];
    for (const [letter, expected] of bodies) {
      const mutated =
        E1_BELBIN_50FR.slice(0, 19) + letter + E1_BELBIN_50FR.slice(20);
      const result = parseSwim(mutated, undefined);
      expect(result.stroke, `letter ${letter}`).toBe(expected);
    }
  });
});
