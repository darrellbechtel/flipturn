import * as cheerio from 'cheerio';
import { parseSwimTime } from '@flipturn/shared';
import type { Course, Round, Stroke, Gender, SwimStatus } from '@flipturn/shared';
import type { AthleteSnapshot, SwimRecord } from './types.js';
import { deriveGenderFromEventHeader, hashMeetExternalId } from './helpers.js';

const DATA_SOURCE = 'www.swimming.ca';

export interface ParseAthleteOptions {
  /** Caller-known SNC ID (from the URL). The page may not echo it. */
  readonly sncId: string;
}

export function parseAthletePage(html: string, options: ParseAthleteOptions): AthleteSnapshot {
  if (!html || html.length < 200) {
    throw new Error('parseAthletePage: input too short to be a real page');
  }

  const $ = cheerio.load(html);

  const primaryName = extractPrimaryName($);
  if (!primaryName) {
    throw new Error('parseAthletePage: could not extract athlete name');
  }
  const homeClub = extractHomeClub($);

  const swims: SwimRecord[] = [];
  let derivedGender: Gender | null = null;

  for (const row of extractSwimRows($)) {
    const swim = swimRecordFromRow(row);
    swims.push(swim);
    if (!derivedGender && (row.gender === 'F' || row.gender === 'M')) {
      derivedGender = row.gender;
    }
  }

  if (!derivedGender) {
    derivedGender = deriveGenderFromBody($);
  }

  return {
    sncId: options.sncId,
    primaryName,
    gender: derivedGender,
    homeClub,
    dataSource: DATA_SOURCE,
    swims,
  };
}

interface SwimRowRaw {
  readonly eventHeader: string;
  readonly gender: Gender | null;
  readonly course: Course;
  readonly distanceM: number;
  readonly stroke: Stroke;
  readonly round: Round;
  readonly ageBand: string | null;
  readonly timeText: string;
  readonly placeText: string | null;
  readonly statusText: string | null;
  readonly meetName: string;
  readonly meetExternalId: string | null;
  readonly dateText: string;
}

// ---------------------------------------------------------------------------
// Identity extraction
// ---------------------------------------------------------------------------

function extractPrimaryName($: cheerio.CheerioAPI): string {
  // The /swimmer/<id>/ template renders the athlete name as <h2> inside
  // section.section--swimmer-details. The first <h1> on the page is part of
  // the page chrome, not the swimmer record.
  const fromDetails = $('section.section--swimmer-details h2').first().text().trim();
  if (fromDetails) return fromDetails;

  // Fallback: og:title meta is "<Name> - Swimming Canada".
  const og = $('meta[property="og:title"]').attr('content') ?? '';
  const stripped = og.replace(/\s*-\s*Swimming Canada\s*$/i, '').trim();
  if (stripped) return stripped;

  return $('h1').first().text().trim();
}

function extractHomeClub($: cheerio.CheerioAPI): string | null {
  // The details list is a sequence of <li><span class="details-label">Label
  // </span><span class="details-value">Value</span></li> items. Find the
  // one whose label is exactly "Club".
  let club: string | null = null;
  $('.details-list li').each((_, el) => {
    const label = $(el).find('.details-label').text().trim();
    if (label.toLowerCase() === 'club') {
      const value = $(el).find('.details-value').text().trim();
      if (value) club = value;
    }
  });
  return club;
}

// ---------------------------------------------------------------------------
// Swim row extraction
// ---------------------------------------------------------------------------

function extractSwimRows($: cheerio.CheerioAPI): SwimRowRaw[] {
  // Find the personal-bests table by looking for a <thead> whose first
  // header cell is "Event" and which has a "Course" column. There is only
  // one such table on the page.
  const candidateTables = $('table').filter((_, t) => {
    const headers = $(t)
      .find('thead th')
      .map((__, th) => $(th).text().trim().toLowerCase())
      .get();
    return headers.includes('event') && headers.includes('course') && headers.includes('time');
  });

  if (candidateTables.length === 0) return [];

  const rows: SwimRowRaw[] = [];

  candidateTables
    .first()
    .find('tbody tr')
    .each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 5) return;

      const eventText = $(tds[0]).text().trim();
      const courseText = $(tds[1]).text().trim();
      const timeText = $(tds[2]).text().trim();
      const dateText = $(tds[3]).text().trim();
      const meetCell = $(tds[4]);
      const statusText = tds.length >= 6 ? $(tds[5]).text().trim() : '';

      const parsedEvent = parseEventText(eventText);
      if (!parsedEvent) return;
      const course = parseCourseCode(courseText);
      if (!course) return;
      if (!timeText) return;
      if (!dateText) return;

      const meetLink = meetCell.find('a').first();
      const meetName = meetLink.text().trim();
      const meetHref = meetLink.attr('href') ?? '';
      const meetExternalId = parseMeetIdFromHref(meetHref);

      rows.push({
        eventHeader: eventText,
        gender: null,
        course,
        distanceM: parsedEvent.distanceM,
        stroke: parsedEvent.stroke,
        round: 'TIMED_FINAL',
        ageBand: null,
        timeText,
        placeText: null,
        statusText: statusText || null,
        meetName,
        meetExternalId,
        dateText,
      });
    });

  return rows;
}

const EVENT_RE = /^(\d+)\s*m\s+(Freestyle|Backstroke|Breaststroke|Butterfly|Medley|Fly|IM)\b/i;

function parseEventText(text: string): { distanceM: number; stroke: Stroke } | null {
  const match = EVENT_RE.exec(text);
  if (!match) return null;
  const distanceM = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(distanceM) || distanceM <= 0) return null;
  const stroke = mapStrokeWord(match[2]!);
  if (!stroke) return null;
  return { distanceM, stroke };
}

function mapStrokeWord(word: string): Stroke | null {
  const w = word.toLowerCase();
  if (w === 'freestyle') return 'FR';
  if (w === 'backstroke') return 'BK';
  if (w === 'breaststroke') return 'BR';
  if (w === 'butterfly' || w === 'fly') return 'FL';
  if (w === 'medley' || w === 'im') return 'IM';
  return null;
}

function parseCourseCode(text: string): Course | null {
  const u = text.toUpperCase();
  if (u === 'LCM') return 'LCM';
  if (u === 'SCM') return 'SCM';
  if (u === 'SCY') return 'SCY';
  return null;
}

const MEET_HREF_RE = /\/swim-meet\/(\d+)\/?/;

function parseMeetIdFromHref(href: string): string | null {
  const m = MEET_HREF_RE.exec(href);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// Row → SwimRecord
// ---------------------------------------------------------------------------

function swimRecordFromRow(row: SwimRowRaw): SwimRecord {
  const timeCentiseconds = parseSwimTime(row.timeText);
  const swamAt = parseRowDate(row.dateText);
  const meetStartDate = swamAt;
  const meetEndDate = swamAt;
  const meetExternalId = row.meetExternalId
    ? row.meetExternalId
    : hashMeetExternalId({
        meetName:
          row.meetName ||
          `${row.course}-${row.distanceM}-${row.stroke}-${swamAt.toISOString().slice(0, 10)}`,
        startDate: meetStartDate,
      });
  const status = mapStatus(row.statusText);

  return {
    meetExternalId,
    meetName: row.meetName,
    meetStartDate,
    meetEndDate,
    course: row.course,
    distanceM: row.distanceM,
    stroke: row.stroke,
    round: row.round,
    gender: row.gender ?? 'X',
    ageBand: row.ageBand,
    timeCentiseconds,
    splits: [],
    place: null,
    status,
    swamAt,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const MONTH_DAY_YEAR_RE = /^(?<mon>[A-Za-z]+)\s+(?<day>\d{1,2}),\s*(?<year>\d{4})$/;

function parseRowDate(text: string): Date {
  const trimmed = text.trim();

  // SNC swimmer pages render dates as "Dec 16, 2011".
  const m = MONTH_DAY_YEAR_RE.exec(trimmed);
  if (m?.groups) {
    const monKey = m.groups.mon!.toLowerCase();
    const month = MONTHS[monKey];
    const day = Number.parseInt(m.groups.day!, 10);
    const year = Number.parseInt(m.groups.year!, 10);
    if (month && Number.isFinite(day) && Number.isFinite(year)) {
      return new Date(Date.UTC(year, month - 1, day));
    }
  }

  // ISO-like (YYYY-MM-DD) fallback.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d;
  }

  throw new Error(`parseRowDate: unrecognized date ${JSON.stringify(text)}`);
}

function mapStatus(raw: string | null): SwimStatus {
  if (!raw) return 'OFFICIAL';
  const u = raw.toUpperCase().trim();
  if (u === 'DQ') return 'DQ';
  if (u === 'NS' || u === 'NO SHOW') return 'NS';
  if (u === 'DNF') return 'DNF';
  if (u === 'WD' || u === 'WITHDRAWN') return 'WITHDRAWN';
  // SNC also uses "RELAY" and "SPLIT" to flag rows; the SwimStatus enum
  // doesn't model those distinctly, so we surface them as OFFICIAL for now.
  return 'OFFICIAL';
}

// ---------------------------------------------------------------------------
// Gender derivation fallback
// ---------------------------------------------------------------------------

/**
 * The /swimmer/<id>/ HTML page does not group swims by gender header — every
 * row says e.g. "100m Freestyle" with no "Boys"/"Girls" prefix. To infer the
 * athlete's gender we fall back to scanning the bio text for unambiguous
 * cues like "Male Swimmer of the Year" or "Female Swimmer of the Year".
 *
 * We delegate the actual word-matching to deriveGenderFromEventHeader so the
 * matcher rules stay in one place (helpers.ts).
 */
function deriveGenderFromBody($: cheerio.CheerioAPI): Gender | null {
  // Search the visible main-content text for an explicit gender label.
  const textNodes: string[] = [];
  $('section.section--padded-content li').each((_, el) => {
    textNodes.push($(el).text());
  });
  $('section.section--swimmer-details p, section.section--swimmer-details h2').each((_, el) => {
    textNodes.push($(el).text());
  });

  for (const t of textNodes) {
    // Strong signals first: "Male Swimmer of the Year" / "Female Swimmer..."
    if (/\b(male|men)\s+swimmer\b/i.test(t)) return 'M';
    if (/\b(female|women)\s+swimmer\b/i.test(t)) return 'F';
    const fromHeader = deriveGenderFromEventHeader(t);
    if (fromHeader) return fromHeader;
  }
  return null;
}
