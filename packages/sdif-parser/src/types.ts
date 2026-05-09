/**
 * Type definitions for the SDIF (.hy3) parser.
 *
 * `.hy3` lines are fixed-width (130 chars in the MSSAC fixture) with the
 * 2-character record code in columns 1-2 and the body in columns 3 onward.
 * Per-record column slicing (using the cols *a*-*b* → `line.slice(a-1, b)`
 * convention) is performed in the per-record parsers, not the tokenizer.
 *
 * See `docs/sdif-format-notes.md` for the full format reference.
 */

/** A single tokenized line: 2-char code + remaining body, with original whitespace preserved. */
export interface RawRecord {
  /** 2-char record code, e.g. "A1", "D1", "E1". */
  code: string;
  /** Characters from column 3 onward; original whitespace preserved (column-significant). */
  body: string;
  /** 1-indexed line number in the source file, for error messages. */
  lineNumber: number;
}

export interface ParsedMeet {
  source: { dataSource: string; fixture: string };
  meet: { name: string; startDate: Date; endDate: Date; course: 'SCM' | 'LCM' | 'SCY' };
  teams: ParsedTeam[];
  athletes: ParsedAthlete[];
  swims: ParsedSwim[];
}

export interface ParsedTeam {
  code: string;
  name: string;
}

export interface ParsedAthlete {
  teamCode: string;
  lastName: string;
  firstName: string;
  middleInitial?: string;
  gender: 'M' | 'F';
  dob?: Date;
  /** Host registration ID, if present. */
  preferredId?: string;
}

export interface ParsedSwim {
  athleteRef: { lastName: string; firstName: string; dob?: Date };
  distanceM: number;
  stroke: 'FR' | 'BK' | 'BR' | 'FL' | 'IM';
  round: 'PRELIM' | 'SEMI' | 'FINAL' | 'TIMED_FINAL';
  timeCentiseconds: number;
  splits: number[];
  place?: number;
  status: 'OFFICIAL' | 'DQ' | 'NS' | 'DNF';
}
