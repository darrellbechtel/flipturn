import * as cheerio from 'cheerio';
import type { Course, Round, Stroke, Gender } from '@flipturn/shared';
import type { MeetSnapshot, MeetEventRecord } from './types.js';
import { parseSplashDateRange } from './helpers.js';

const DATA_SOURCE = 'results.swimming.ca';

export interface ParseMeetOptions {
  /** Caller-known meet identifier (from the URL slug). */
  readonly externalId: string;
}

export function parseMeetIndex(html: string, options: ParseMeetOptions): MeetSnapshot {
  if (!html || html.length < 200) {
    throw new Error('parseMeetIndex: input too short to be a real page');
  }

  const $ = cheerio.load(html);

  const headerCells = extractHeaderCells($);
  const name = extractMeetName($, headerCells);
  if (!name) {
    throw new Error('parseMeetIndex: could not extract meet name');
  }

  const dateText = extractDateText($, headerCells);
  const { startDate, endDate } = parseSplashDateRange(dateText);
  const course = extractCourse($, headerCells);
  const location = extractLocation($, headerCells);
  const sanctionBody = extractSanctionBody($);

  const events: MeetEventRecord[] = extractEvents($);

  return {
    externalId: options.externalId,
    name,
    course,
    location,
    startDate,
    endDate,
    sanctionBody,
    dataSource: DATA_SOURCE,
    events,
  };
}

// ---------------------------------------------------------------------------
// Header extraction
// ---------------------------------------------------------------------------

interface HeaderCells {
  readonly name: string;
  readonly courseText: string;
  readonly location: string;
  readonly dateText: string;
}

/**
 * SPLASH renders the meet header as a 2x2 table inside `<div id="header">`:
 *
 *   <table>
 *     <tr><td>2026 Speedo Canadian Swimming Open</td><td align="right">Long Course (50m)</td></tr>
 *     <tr><td>Edmonton  (CAN)</td><td align="right">9- - 11-4-2026</td></tr>
 *   </table>
 */
function extractHeaderCells($: cheerio.CheerioAPI): HeaderCells {
  const headerTable = $('#header table').first();
  const rows = headerTable.find('tr');
  const row1 = rows.eq(0).find('td');
  const row2 = rows.eq(1).find('td');
  return {
    name: $(row1[0]).text().trim(),
    courseText: $(row1[1]).text().trim(),
    location: $(row2[0]).text().trim(),
    dateText: $(row2[1]).text().trim(),
  };
}

function extractMeetName($: cheerio.CheerioAPI, cells: HeaderCells): string {
  if (cells.name) return cells.name;
  // Fallback: the <title> tag is "<Meet Name> - SPLASH Meet Manager 11".
  const title = $('title').text().trim();
  return title.replace(/\s*-\s*SPLASH Meet Manager\s*\d*\s*$/i, '').trim();
}

function extractDateText(_$: cheerio.CheerioAPI, cells: HeaderCells): string {
  return cells.dateText;
}

function extractCourse(_$: cheerio.CheerioAPI, cells: HeaderCells): Course {
  const text = cells.courseText.toLowerCase();
  if (/long\s*course/.test(text)) return 'LCM';
  if (/short\s*course\s*meters?/.test(text) || /short\s*course\s*\(25m\)/.test(text)) return 'SCM';
  if (/short\s*course\s*yards?/.test(text) || /scy/.test(text)) return 'SCY';
  if (/lcm/.test(text)) return 'LCM';
  if (/scm/.test(text)) return 'SCM';
  return 'LCM';
}

function extractLocation(_$: cheerio.CheerioAPI, cells: HeaderCells): string | null {
  // SPLASH renders only "City  (COUNTRY)" — collapse runs of whitespace.
  const raw = cells.location.replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  // Normalize "City (CAN)" → "City, CAN". The expected golden form for the
  // 2026 SNC Open is "Edmonton, AB, CAN" — the province is editorial; we
  // surface what the page exposes and let the reconciler enrich later.
  const m = /^(.*?)\s*\(([A-Z]{2,3})\)\s*$/.exec(raw);
  if (m) {
    return `${m[1]!.trim()}, ${m[2]!}`;
  }
  return raw;
}

function extractSanctionBody($: cheerio.CheerioAPI): string | null {
  // SPLASH stamps "publisher" meta with "Swimming Canada, 62". Use that as
  // the sanction body signal — the index page itself doesn't render a
  // labelled sanction cell.
  const publisher = $('meta[name="publisher"]').attr('content') ?? '';
  if (/swimming\s*canada/i.test(publisher)) return 'SNC';
  if (publisher) return publisher.split(',')[0]!.trim();
  return null;
}

// ---------------------------------------------------------------------------
// Event extraction
// ---------------------------------------------------------------------------

/**
 * SPLASH's tab0 ("Results by Events") renders a wide 12-column grid that
 * pairs the Men's and Women's heats of each stroke side-by-side:
 *
 *   <tr class="trTitle1"><td class="title1 genderM">Men</td>
 *                        <td class="title1 genderF">Women</td></tr>
 *   <tr class="trTitle2"><td class="title2">Freestyle</td>
 *                        <td class="title2">Freestyle</td></tr>
 *   <tr class="trList0"><td class="genderM">50m</td>
 *                       <td class="genderM">Final</td>
 *                       <td class="genderM">Open</td>
 *                       ... (Startlist, Results, separator)
 *                       <td class="genderF">50m</td>
 *                       <td class="genderF">Final</td>
 *                       <td class="genderF">Open</td>
 *                       ... </tr>
 *
 * After the gendered tables there is an "Other Events" table whose rows are
 * single-event 8-column rows with the gender encoded as text ("Mixed",
 * "Men", "Women") in the second cell.
 */
function extractEvents($: cheerio.CheerioAPI): MeetEventRecord[] {
  const events: MeetEventRecord[] = [];

  // The events live inside the first tab (`#tab0`). Walk every row and
  // remember the most recent stroke title (title2 row) so that list rows
  // can resolve their stroke from the surrounding context.
  let currentStroke: Stroke | null = null;

  $('#tab0 tr').each((_, tr) => {
    const $tr = $(tr);

    // Stroke title row: the title2 cell text drives the next list rows.
    const title2 = $tr.find('td.title2').first();
    if (title2.length > 0) {
      currentStroke = mapStrokeWord(title2.text().trim());
      return;
    }

    // List row: identify by trList class.
    const cls = $tr.attr('class') ?? '';
    if (!/\btrList[01]\b/.test(cls)) return;

    const tds = $tr.find('td');
    if (tds.length === 0) return;

    // Case A: gendered side-by-side row. Every cell carries .genderM or
    // .genderF; the Men's distance/round/age band live in the first three
    // .genderM cells and the Women's in the first three .genderF cells.
    const hasGenderM = $tr.find('td.genderM').length > 0;
    const hasGenderF = $tr.find('td.genderF').length > 0;
    if (hasGenderM || hasGenderF) {
      if (!currentStroke) return;
      const mEvent = parseGenderedListRow($, $tr, 'genderM', 'M', currentStroke);
      if (mEvent) events.push(mEvent);
      const fEvent = parseGenderedListRow($, $tr, 'genderF', 'F', currentStroke);
      if (fEvent) events.push(fEvent);
      return;
    }

    // Case B: "Other Events" row — 8 cells: [event#, gender, dist+stroke,
    // round, age band, startlist, results, blank].
    if (tds.length >= 7) {
      const genderText = $(tds[1]).text().trim();
      const distStrokeText = $(tds[2]).text().trim();
      const roundText = $(tds[3]).text().trim();
      const ageBandText = $(tds[4]).text().trim();

      const gender = mapGenderWord(genderText);
      const parsed = parseDistanceAndStroke(distStrokeText);
      const round = mapRound(roundText);
      if (gender && parsed && round) {
        events.push({
          distanceM: parsed.distanceM,
          stroke: parsed.stroke,
          gender,
          ageBand: normalizeAgeBand(ageBandText),
          round,
        });
      }
    }
  });

  return events;
}

function parseGenderedListRow(
  $: cheerio.CheerioAPI,
  // cheerio's element-row type is awkward to express without pulling in
  // domhandler as a direct dep; the row is a <tr> from an .each() iterator.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $tr: cheerio.Cheerio<any>,
  cls: 'genderM' | 'genderF',
  gender: Gender,
  stroke: Stroke,
): MeetEventRecord | null {
  const cells = $tr.find(`td.${cls}`);
  if (cells.length < 3) return null;
  const distText = $(cells[0]).text().trim();
  const roundText = $(cells[1]).text().trim();
  const ageBandText = $(cells[2]).text().trim();

  const distanceM = parseDistance(distText);
  if (distanceM === null) return null;
  const round = mapRound(roundText);
  if (!round) return null;

  return {
    distanceM,
    stroke,
    gender,
    ageBand: normalizeAgeBand(ageBandText),
    round,
  };
}

// ---------------------------------------------------------------------------
// Field-level helpers
// ---------------------------------------------------------------------------

/**
 * Parse a SPLASH stroke title cell. SPLASH uses bare stroke names ("Freestyle",
 * "Backstroke", "Breaststroke", "Butterfly", "Medley") plus "Freestyle Relay"
 * and "Medley Relay" for relays. Relays still resolve to FR / IM stroke codes;
 * the fact that they are relays is signalled by a `4 x 100m`-style distance
 * that downstream code can detect if it cares.
 */
function mapStrokeWord(word: string): Stroke | null {
  const w = word.toLowerCase();
  if (w.includes('freestyle') || w === 'free' || w === 'fr') return 'FR';
  if (w.includes('backstroke') || w === 'back' || w === 'bk') return 'BK';
  if (w.includes('breaststroke') || w === 'breast' || w === 'br') return 'BR';
  if (w.includes('butterfly') || w === 'fly' || w === 'fl') return 'FL';
  if (w.includes('medley') || w === 'im') return 'IM';
  return null;
}

function mapGenderWord(word: string): Gender | null {
  const w = word.toLowerCase();
  if (w === 'men' || w === 'man' || w === 'boys' || w === 'boy' || w === 'male') return 'M';
  if (w === 'women' || w === 'woman' || w === 'girls' || w === 'girl' || w === 'female') return 'F';
  if (w === 'mixed' || w === 'mix') return 'X';
  return null;
}

function mapRound(text: string): Round | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;
  if (t === 'final' || t === 'finals') return 'FINAL';
  if (t === 'prelim' || t === 'prelims' || t === 'preliminary' || t === 'heats') return 'PRELIM';
  if (t === 'semi' || t === 'semis' || t === 'semifinal' || t === 'semi-final') return 'SEMI';
  if (t.startsWith('timed') || t.startsWith('time trial') || t === 'tt' || t === 'swim-off') {
    return 'TIMED_FINAL';
  }
  return null;
}

function normalizeAgeBand(text: string): string | null {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  // SPLASH renders "Open" as the canonical "all ages" label. Anything
  // non-empty (e.g. "13 & Over", "11-12", "S1-S14") passes through.
  return trimmed;
}

/**
 * Parse a distance cell from the gendered tab0 grid. Examples seen:
 *   "50m"        → 50
 *   "100m"       → 100
 *   "1500m"      → 1500
 *   "4 x 100m"   → 100  (relay leg distance — total distance is 400m, but
 *                       SPLASH stores the leg in this cell)
 */
function parseDistance(text: string): number | null {
  const trimmed = text.trim();
  // Relay form: "N x DIST m"  → return DIST (per-leg distance).
  const relay = /^(\d+)\s*[x×]\s*(\d{2,4})\s*m\b/i.exec(trimmed);
  if (relay) {
    return Number.parseInt(relay[2]!, 10);
  }
  const m = /^(\d{2,4})\s*m\b/i.exec(trimmed);
  if (m) {
    return Number.parseInt(m[1]!, 10);
  }
  return null;
}

/**
 * Parse "<distance> <stroke>" from a single cell (used in the "Other Events"
 * table). Examples:
 *   "100m Freestyle"
 *   "4 x 100m Medley"
 *   "200 IM"
 */
function parseDistanceAndStroke(text: string): { distanceM: number; stroke: Stroke } | null {
  const trimmed = text.trim();
  const m =
    /(?:(\d+)\s*[x×]\s*)?(\d{2,4})\s*m?\s+(freestyle|free|backstroke|back|breaststroke|breast|butterfly|fly|individual\s*medley|medley|im)\b/i.exec(
      trimmed,
    );
  if (!m) return null;
  const distanceM = Number.parseInt(m[2]!, 10);
  if (!Number.isFinite(distanceM)) return null;
  const stroke = mapStrokeWord(m[3]!);
  if (!stroke) return null;
  return { distanceM, stroke };
}
