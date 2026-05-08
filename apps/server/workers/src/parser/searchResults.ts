import { load } from 'cheerio';

export type ParsedSearchResult = {
  sncId: string; // numeric-only; non-numeric (curated bio slugs) are filtered out
  displayName: string;
  profileUrl: string; // absolute, e.g. https://www.swimming.ca/swimmer/5567334/
};

const NUMERIC_HREF_RE = /^\/swimmer\/(\d+)\/$/;

/**
 * Parse the WordPress site-search HTML at https://www.swimming.ca/?s=<query>
 * and return numeric-id swimmer profile results.
 *
 * Filtering rules:
 * - Match by href shape `/swimmer/<digits>/` only — class names on the WP theme
 *   are not stable, but the URL pattern is.
 * - Skip curated CPT slug pages (e.g. `/swimmer/felix-cowan/`) — those are
 *   National-Team bio pages, not the swim-meet profile we index.
 * - Deduplicate by sncId; the same swimmer can appear in multiple result blocks
 *   (e.g. heading link + "read more" link).
 */
export function parseSearchResults(html: string): ParsedSearchResult[] {
  const $ = load(html);
  const seen = new Set<string>();
  const results: ParsedSearchResult[] = [];

  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') ?? '';
    const m = NUMERIC_HREF_RE.exec(href);
    if (!m) return;
    const sncId = m[1]!;
    if (seen.has(sncId)) return;
    const displayName =
      $(a).text().trim() ||
      $(a).closest('article').find('h2,h3').first().text().trim();
    if (!displayName) return;
    seen.add(sncId);
    results.push({
      sncId,
      displayName,
      profileUrl: `https://www.swimming.ca/swimmer/${sncId}/`,
    });
  });

  return results;
}
