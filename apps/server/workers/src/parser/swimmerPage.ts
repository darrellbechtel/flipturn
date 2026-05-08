import * as cheerio from 'cheerio';
import type { Gender } from '@flipturn/shared';
import type { ParsedSwimmer } from './types.js';

/**
 * Lightweight index-time parser for `https://www.swimming.ca/swimmer/<id>/`.
 *
 * Sibling to `parseAthletePage`, which extracts the full personal-bests table
 * and is the right tool for reconciliation. This parser returns ONLY the
 * fields the priority warmer needs to populate the athlete search index:
 * primaryName, clubName, gender, dobYear.
 *
 * The page embeds a PHP `print_r` dump (inside an HTML comment near the top
 * of <main>) of the SwimRankings REST payload that the SNC theme uses to
 * render the page. That dump is the canonical source for `gender` and
 * `dobYear` — neither of which are exposed in the visible DOM. We pull
 * `primaryName` and `clubName` from the rendered DOM since both are visible
 * and the DOM extraction matches what `parseAthletePage` already does.
 *
 * If a field is genuinely absent from the page (e.g. a swimmer with no
 * registered club, or a stripped-down test page), the corresponding output
 * field is `null` rather than guessed.
 */
export function parseSwimmerProfile(html: string): ParsedSwimmer {
  if (!html || html.length < 200) {
    throw new Error('parseSwimmerProfile: input too short to be a real page');
  }

  const $ = cheerio.load(html);

  const primaryName = extractPrimaryName($);
  if (!primaryName) {
    throw new Error('parseSwimmerProfile: could not extract athlete name');
  }

  const clubName = extractClubName($);
  const gender = extractGender(html);
  const dobYear = extractDobYear(html);

  return { primaryName, clubName, gender, dobYear };
}

// ---------------------------------------------------------------------------
// Identity / club: visible DOM
// ---------------------------------------------------------------------------

function extractPrimaryName($: cheerio.CheerioAPI): string {
  // Mirror parseAthletePage's logic so both parsers agree on what the page
  // says the swimmer's name is.
  const fromDetails = $('section.section--swimmer-details h2').first().text().trim();
  if (fromDetails) return fromDetails;

  const og = $('meta[property="og:title"]').attr('content') ?? '';
  const stripped = og.replace(/\s*-\s*Swimming Canada\s*$/i, '').trim();
  if (stripped && !/^Swimmer\s+\d+$/i.test(stripped)) return stripped;

  return $('h1').first().text().trim();
}

function extractClubName($: cheerio.CheerioAPI): string | null {
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
// Gender / dobYear: embedded print_r dump
// ---------------------------------------------------------------------------

/**
 * Match `[gender] => M` (or F / X) inside the embedded print_r dump.
 *
 * The dump uses PHP's `print_r` text format: lines like `    [key] => value`
 * with arbitrary indentation. We pin the value to a single uppercase letter
 * to avoid accidentally matching club / event entries that don't have a
 * gender field.
 */
const GENDER_RE = /\[gender\]\s*=>\s*([MFX])\b/;

function extractGender(html: string): Gender | null {
  const m = GENDER_RE.exec(html);
  if (!m) return null;
  const code = m[1] as Gender;
  return code;
}

/**
 * Match `[birthdate] => YYYY-MM-DD` inside the embedded print_r dump.
 *
 * Felix's page renders this as `[birthdate] => 2015-01-27`. We capture only
 * the year because that's what the index uses; if a future SNC template
 * change drops the day/month we still get the year.
 */
const BIRTHDATE_RE = /\[birthdate\]\s*=>\s*(\d{4})-\d{2}-\d{2}/;

function extractDobYear(html: string): number | null {
  const m = BIRTHDATE_RE.exec(html);
  if (!m) return null;
  const year = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(year)) return null;
  // Sanity: SNC has registered swimmers from infants to masters. Anything
  // outside [1900, currentYear] is almost certainly a parse mistake.
  const thisYear = new Date().getUTCFullYear();
  if (year < 1900 || year > thisYear) return null;
  return year;
}
